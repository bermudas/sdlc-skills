#!/usr/bin/env node
// visual-check — agent-driven visual regression against the LIVE browser the agent is already driving.
//
// It connects to a running Chrome over CDP (the same one Playwright MCP / chrome-devtools MCP /
// browser-verify use, default :9222), screenshots the page the agent is currently on, and either
// CREATES a baseline (first time) or COMPARES against it (pixelmatch). It never launches its own
// browser and never re-navigates — the comparison happens in the agent's live session.
//
// Commands:
//   check <name>      Auto: create baseline if missing, else compare a PIXEL screenshot. (everyday call)
//   aria  <name>      Auto: create-or-compare an ARIA (accessibility-tree) snapshot — structure over
//                     pixels. Platform-independent, survives cosmetic drift; great for agent testing.
//   update <name>     Gated baseline refresh -> writes to pending/, never overwrites live baseline.
//   approve <name>    Promote pending/<name> -> baseline (the human-gated step).
//   list              List existing baseline names + their config.
//   help
//
// Parity with Playwright toHaveScreenshot(): same pixelmatch comparator, threshold/maxDiffPixelRatio/
// maxDiffPixels gates, mask/maskColor/clip/fullPage/scale/omitBackground, platform-namespaced baselines,
// and the "retry until two consecutive screenshots match" stabilization loop. The difference: this runs
// as a live tool against the agent's own browser, with no @playwright/test runner.
//
// Output: a JSON object on stdout (machine signal) + a human summary on stderr (suppress with --quiet).
// Exit codes: 0 = created/pass/updated/update_pending, 2 = fail, 1 = error.
//
// Deps: playwright-core, pixelmatch, pngjs  (run `npm install` in the skill dir once).

import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

// ----------------------------------------------------------------------------- arg parsing
const RAW = process.argv.slice(2);
const command = RAW[0] && !RAW[0].startsWith('-') ? RAW.shift() : 'check';

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    a = a.slice(2);
    let val;
    if (a.includes('=')) { [a, val] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]; }
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { val = argv[++i]; }
    else { val = true; } // boolean flag
    // repeatable flags accumulate into arrays
    if (a === 'mask' || a === 'aria-redact') { (opts[a] ||= []).push(...String(val).split(',').map(s => s.trim()).filter(Boolean)); }
    else opts[a] = val;
  }
  return opts;
}
const opts = parseArgs(RAW);
const name = opts._[0];

// ----------------------------------------------------------------------------- config / paths
const CDP_URL = opts.cdp || process.env.VISUAL_CDP_URL || 'http://127.0.0.1:9222';
const ROOT = path.resolve(opts.root || process.env.VISUAL_ROOT || './visual-tests');
const DIRS = {
  baselines: path.join(ROOT, 'baselines'),
  diffs: path.join(ROOT, 'diffs'),
  actuals: path.join(ROOT, 'actuals'),
  pending: path.join(ROOT, 'pending'),
  requests: path.join(ROOT, 'pending', 'requests'),
  scenarios: path.join(ROOT, 'scenarios'),
  benchmark: path.join(ROOT, 'benchmark'),
};
const QUIET = !!opts.quiet;
const warnings = [];
function warn(msg) { warnings.push(msg); if (!QUIET) process.stderr.write(`  ⚠ ${msg}\n`); }
function info(msg) { if (!QUIET) process.stderr.write(`${msg}\n`); }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

// platform namespacing — baselines are render-environment specific (fonts, OS, GPU).
const BROWSER = 'chromium';
const PLATFORM = process.platform; // darwin | linux | win32
const KEY = `${BROWSER}-${PLATFORM}`;

function validName(n) { return typeof n === 'string' && /^[a-z0-9._-]+$/.test(n); }
const baselinePng = (n) => path.join(DIRS.baselines, `${n}__${KEY}.png`);
const sidecarPath = (n) => path.join(DIRS.baselines, `${n}.config.json`);
const pendingPng = (n) => path.join(DIRS.pending, `${n}__${KEY}.png`);
// ARIA snapshots are the rendered accessibility tree — platform-INDEPENDENT, so one baseline serves
// every OS (no __chromium-<platform> suffix needed).
const ariaBaseline = (n) => path.join(DIRS.baselines, `${n}.aria.yaml`);
const ariaSidecar = (n) => path.join(DIRS.baselines, `${n}.aria.json`);

// ----------------------------------------------------------------------------- stable identity
// A baseline's identity is INTENT-addressed (which checkpoint), never content-addressed (what the page
// looks like) — the key must survive the very change we detect. We derive a stable, machine prefix from
// the route + the scoped region's stable handle (data-testid / non-generated id / role), and the agent
// adds a --state word. Identity is stored in the sidecar so a later run can detect "you're about to
// create a duplicate of an existing baseline under a different name".
function sanitizeSeg(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}
// The test-case / scenario id namespaces a baseline: the SAME page+region in two different test cases is
// two different baselines. --test is an alias for --scenario.
function scenarioId() { return opts.scenario || opts.test || null; }
function normalizeRoute(urlStr) {
  let u; try { u = new URL(urlStr); } catch { return 'page'; }
  // file:// URLs carry the whole filesystem path — only the basename is meaningful as a route key.
  if (u.protocol === 'file:') {
    const base = (u.pathname.split('/').filter(Boolean).pop() || 'home').replace(/\.[a-z0-9]+$/i, '');
    return sanitizeSeg(base) || 'home';
  }
  const dyn = (s) => /^\d+$/.test(s) || /^[0-9a-f]{8,}$/i.test(s) || /^[0-9a-f-]{16,}$/i.test(s);
  const pathSegs = u.pathname.split('/').filter(Boolean);
  const hashSegs = (u.hash || '').replace(/^#\/?/, '').split(/[/?]/).filter(Boolean); // SPA hash routes
  const segs = [...pathSegs, ...hashSegs].map(s => dyn(s) ? 'id' : sanitizeSeg(s)).filter(Boolean);
  if (u.pathname.endsWith('.html')) { const f = pathSegs[pathSegs.length - 1].replace(/\.html$/, ''); if (f) segs[segs.length - 1] = sanitizeSeg(f); }
  return segs.join('.') || 'home';
}
async function deriveRegionKey(page, sel) {
  if (!sel) return null;
  try {
    const a = await page.locator(sel).first().evaluate(n => ({
      testid: n.getAttribute('data-testid') || n.getAttribute('data-test') || n.getAttribute('data-qa') || n.getAttribute('data-cy'),
      id: n.id || null, role: n.getAttribute('role') || null, label: n.getAttribute('aria-label') || null, tag: n.tagName.toLowerCase(),
    }));
    const generated = (id) => !id || /[0-9]{3,}|^:r|--|[a-f0-9]{8,}|^ember|^mui-|^radix-|^headlessui/i.test(id);
    if (a.testid) return sanitizeSeg(a.testid);
    if (a.id && !generated(a.id)) return sanitizeSeg(a.id);
    if (a.role && a.label) return sanitizeSeg(`${a.role}-${a.label}`);
    return sanitizeSeg(a.role || a.tag);
  } catch { return null; }
}
async function ariaSkeletonHash(page, sel) {
  try {
    const snap = await page.locator(sel || 'body').first().ariaSnapshot();
    const skel = String(snap).split('\n')
      .map(l => l.replace(/"[^"]*"/g, '""').replace(/:\s.*$/, ':').replace(/\d+/g, '#')).join('\n');
    return createHash('sha1').update(skel).digest('hex').slice(0, 12);
  } catch { return null; }
}
async function buildIdentity(page, sel) {
  const url = page.url();
  const raw = scenarioId();
  return {
    url,
    scenario: raw ? sanitizeSeg(raw) : null,   // sanitized id used for naming + matching
    scenarioRaw: raw || null,                  // original-case id for traceability (TestRail/Jira/…)
    title: opts.title || null, source: opts.source || null,
    routeKey: normalizeRoute(url), regionKey: await deriveRegionKey(page, sel), ariaHash: await ariaSkeletonHash(page, sel),
  };
}
// Name = [<test-case>.]<route>.<region>[.<state>] — the test-case prefix keeps the same page's baseline
// distinct across test cases.
function suggestName(identity, state) {
  return [identity.scenario, identity.routeKey, identity.regionKey, state ? sanitizeSeg(state) : null].filter(Boolean).join('.').replace(/\.+/g, '.').slice(0, 120) || 'page';
}
function allSidecars() {
  if (!fs.existsSync(DIRS.baselines)) return [];
  const out = [];
  for (const f of fs.readdirSync(DIRS.baselines)) {
    const isPixel = f.endsWith('.config.json'), isAria = f.endsWith('.aria.json');
    if (!isPixel && !isAria) continue;
    try { out.push({ kind: isAria ? 'aria' : 'pixel', cfg: JSON.parse(fs.readFileSync(path.join(DIRS.baselines, f), 'utf8')) }); } catch { /* skip */ }
  }
  return out;
}
// Find existing baselines whose identity matches the live page's route+region/structure. Split into:
//  - sameTest: a match under the SAME test id (→ authoritative reuse).
//  - crossTest: matches under a DIFFERENT test id. These are the tell-tale of a non-deterministic test
//    id (the model minted "checkout-happy" last run, "checkout-happy-path" this run). We surface them so
//    the agent reconciles to the canonical id instead of silently forking the namespace.
function findMatches(identity, excludeName) {
  let sameTest = null; const crossTest = [];
  for (const { kind, cfg } of allSidecars()) {
    if (cfg.name === excludeName) continue;
    const id = cfg.identity; if (!id || !id.routeKey || id.routeKey !== identity.routeKey) continue;
    const regionSame = id.regionKey && identity.regionKey && id.regionKey === identity.regionKey;
    const ariaSame = id.ariaHash && identity.ariaHash && id.ariaHash === identity.ariaHash;
    const bothNoRegion = !id.regionKey && !identity.regionKey;
    if (!(regionSame || ariaSame || bothNoRegion)) continue;
    const entry = { name: cfg.name, kind, scenario: id.scenario || null, matchOn: regionSame ? 'route+region' : ariaSame ? 'route+structure' : 'route' };
    if ((id.scenario || '') === (identity.scenario || '')) { if (!sameTest) sameTest = entry; }
    else crossTest.push(entry);
  }
  return { sameTest, crossTest };
}
const uniqScenarios = (arr) => [...new Set(arr.map(c => c.scenario || '(no test id)'))];

// Test-case registry: "which test ids exist, what do they cover?" Reconciled from the sidecars (so it
// never goes stale), enriched with title/source from the index snapshot or the scenario file. An agent
// consults this BEFORE authoring to reuse an existing test id instead of minting a variant.
function buildRegistry() {
  const idxPath = path.join(DIRS.scenarios, 'index.json');
  let prior = {};
  if (fs.existsSync(idxPath)) { try { prior = (JSON.parse(fs.readFileSync(idxPath, 'utf8')).tests) || {}; } catch { /* ignore */ } }
  const reg = {};
  for (const { cfg } of allSidecars()) {
    const idn = cfg.identity || {}; const id = idn.scenario; if (!id) continue;
    const t = reg[id] ||= { id, rawId: idn.scenarioRaw || prior[id]?.rawId || id, title: idn.title || prior[id]?.title || null, source: idn.source || prior[id]?.source || null, baselines: [], routes: [] };
    if (!t.baselines.includes(cfg.name)) t.baselines.push(cfg.name);
    if (idn.routeKey && !t.routes.includes(idn.routeKey)) t.routes.push(idn.routeKey);
  }
  for (const id of Object.keys(reg)) {
    const sf = path.join(DIRS.scenarios, `${id}.json`);
    if (fs.existsSync(sf)) { try { const s = JSON.parse(fs.readFileSync(sf, 'utf8')); reg[id].title = reg[id].title || s.title || null; reg[id].source = reg[id].source || s.source || null; if (s.id) reg[id].rawId = s.id; } catch { /* ignore */ } }
  }
  return reg;
}
function writeRegistry(reg) {
  ensureDir(DIRS.scenarios);
  fs.writeFileSync(path.join(DIRS.scenarios, 'index.json'), JSON.stringify({ updatedAt: new Date().toISOString(), tests: reg }, null, 2));
}
function refreshRegistry() { try { writeRegistry(buildRegistry()); } catch { /* registry is best-effort */ } }

// ----------------------------------------------------------------------------- output helpers
function emit(result, code) {
  result.warnings = warnings;
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(code);
}
function fatal(message) {
  process.stdout.write(JSON.stringify({ status: 'error', name, message, warnings }, null, 2) + '\n');
  process.exit(1);
}

// ----------------------------------------------------------------------------- sidecar store
function readSidecar(n) {
  const p = sidecarPath(n);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { warn(`sidecar ${p} is corrupt; ignoring`); return null; }
}
function callerConfig() {
  const c = {};
  if (opts.locator) c.locator = opts.locator;
  if (opts.mask && opts.mask.length) c.mask = opts.mask;
  if (opts['mask-color']) c.maskColor = opts['mask-color'];
  if (opts.clip) c.clip = parseClip(opts.clip);
  if (opts.viewport) c.viewport = parseViewport(opts.viewport);
  if (opts.threshold != null) c.threshold = Number(opts.threshold);
  if (opts['max-diff-ratio'] != null) c.maxDiffPixelRatio = Number(opts['max-diff-ratio']);
  if (opts['max-diff-pixels'] != null) c.maxDiffPixels = Number(opts['max-diff-pixels']);
  if (opts.scale) c.scale = opts.scale;                 // 'css' | 'device'
  if (opts['omit-background']) c.omitBackground = true;
  if (opts['full-page']) c.fullPage = true;
  if (opts.wait) c.wait = opts.wait;
  return c;
}
// Stabilization (the "two consecutive screenshots must match" loop) doesn't affect what's compared,
// only how settled the capture is — so it's a caller knob, not a replayed sidecar param.
function stabilizeSettings() {
  return {
    stabilize: !opts['no-stabilize'],
    stabilizeRetries: opts['stabilize-retries'] != null ? Number(opts['stabilize-retries']) : 3,
  };
}
function parseClip(s) {
  if (typeof s !== 'string') return null;
  const [x, y, width, height] = s.split(',').map(Number);
  if ([x, y, width, height].some(Number.isNaN)) { warn(`--clip "${s}" is not "x,y,w,h"; ignoring`); return null; }
  return { x, y, width, height };
}
function parseViewport(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d+)x(\d+)$/.exec(s.trim());
  if (!m) { warn(`--viewport "${s}" is not "WxH"; ignoring`); return null; }
  return { width: Number(m[1]), height: Number(m[2]) };
}

// On capture we persist the caller's params. On compare we REPLAY the sidecar's params and ignore
// divergent caller params (logging a warning) — otherwise run N would mask/clip differently from run 1
// and the comparison would be meaningless.
function resolveCompareConfig(sidecar) {
  const caller = callerConfig();
  const diverged = [];
  for (const k of ['locator', 'mask', 'maskColor', 'clip', 'viewport', 'threshold', 'maxDiffPixelRatio', 'maxDiffPixels', 'scale', 'omitBackground', 'fullPage']) {
    if (caller[k] != null && JSON.stringify(caller[k]) !== JSON.stringify(sidecar[k])) diverged.push(k);
  }
  if (diverged.length) warn(`compare ignores caller params [${diverged.join(', ')}] — replaying baseline sidecar instead (edit the sidecar or re-baseline to change them)`);
  return {
    locator: sidecar.locator || null,
    mask: sidecar.mask || [],
    maskColor: sidecar.maskColor || '#FF00FF',
    clip: sidecar.clip || null,
    viewport: sidecar.viewport || null,
    threshold: sidecar.threshold ?? 0.2,
    maxDiffPixelRatio: sidecar.maxDiffPixelRatio ?? 0.01,
    maxDiffPixels: sidecar.maxDiffPixels ?? null,
    scale: sidecar.scale || 'css',
    omitBackground: !!sidecar.omitBackground,
    fullPage: !!sidecar.fullPage,
    wait: sidecar.wait || opts.wait || null,
    ...stabilizeSettings(),
  };
}
function resolveCaptureConfig() {
  const c = callerConfig();
  return {
    locator: c.locator || null,
    mask: c.mask || [],
    maskColor: c.maskColor || '#FF00FF',
    clip: c.clip || null,
    viewport: c.viewport || null,
    threshold: c.threshold ?? 0.2,
    maxDiffPixelRatio: c.maxDiffPixelRatio ?? 0.01,
    maxDiffPixels: c.maxDiffPixels ?? null,
    scale: c.scale || 'css',
    omitBackground: !!c.omitBackground,
    fullPage: !!c.fullPage,
    wait: c.wait || null,
    ...stabilizeSettings(),
  };
}

// ----------------------------------------------------------------------------- browser session
async function connect() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 });
  } catch (e) {
    fatal(`Could not connect to a browser at ${CDP_URL}. Is Chrome running with --remote-debugging-port? ` +
          `Start one with browser-verify's chrome-launcher.sh, or point Playwright MCP at this endpoint. (${e.message})`);
  }
  return browser;
}

// Pick the page the AGENT is looking at. A visible (foreground) tab with a real URL is the strongest
// signal; fall back to the last real page. --url-contains / --page-index override.
async function pickPage(browser) {
  const all = browser.contexts().flatMap(c => c.pages());
  if (!all.length) fatal('Connected to the browser but it has no open pages. Navigate first (Playwright MCP), then call visual-check.');

  const junk = (u) => !u || u === 'about:blank' || /^(devtools|chrome|chrome-extension|edge):\/\//.test(u);
  let candidates = all.filter(p => !junk(p.url()));
  if (!candidates.length) candidates = all; // everything is blank-ish; use it anyway

  if (opts['url-contains']) {
    const filtered = candidates.filter(p => p.url().includes(opts['url-contains']));
    if (!filtered.length) warn(`no page url contains "${opts['url-contains']}"; using best available`);
    else candidates = filtered;
  }
  if (opts['page-index'] != null) {
    const idx = Number(opts['page-index']);
    if (candidates[idx]) return candidates[idx];
    warn(`--page-index ${idx} out of range (have ${candidates.length}); using best available`);
  }

  // Prefer a foreground/visible tab.
  for (const p of candidates.slice().reverse()) {
    try { if (await p.evaluate(() => document.visibilityState) === 'visible') return p; } catch { /* ignore */ }
  }
  return candidates[candidates.length - 1];
}

// ----------------------------------------------------------------------------- determinism + shot
const HIDE_STYLE = `
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  caret-color: transparent !important; scroll-behavior: auto !important;
}`;

async function stabilize(page, cfg) {
  if (cfg.viewport) {
    try { await page.setViewportSize(cfg.viewport); }
    catch (e) { warn(`could not set viewport ${cfg.viewport.width}x${cfg.viewport.height} on a shared browser (${e.message}); capturing at current size`); }
  }
  try { await page.evaluate(() => (document.fonts ? document.fonts.ready : null)); } catch { /* ignore */ }
  try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /* already idle or still busy; best-effort */ }
  if (cfg.wait) {
    try { await page.locator(cfg.wait).first().waitFor({ state: 'visible', timeout: 5000 }); }
    catch { warn(`--wait selector "${cfg.wait}" never became visible (5s)`); }
  }
  // Force a fresh composited frame. visual-check connects over its OWN CDP session, so a DOM/style
  // change driven by another client (Playwright MCP, chrome-devtools MCP) may not have been
  // composited yet — Page.captureScreenshot would then grab a stale frame. Two rAFs guarantee a
  // full style→layout→paint→composite cycle reflecting the latest state before we shoot.
  try { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))); } catch { /* ignore */ }
}

async function validateMasks(page, cfg) {
  const live = [];
  for (const sel of cfg.mask || []) {
    let count = 0;
    try { count = await page.locator(sel).count(); } catch { count = 0; }
    if (count === 0) warn(`mask selector "${sel}" matched 0 elements — nothing was painted over (a "pass" may be hiding nothing)`);
    else live.push(sel);
  }
  return live;
}

async function screenshot(page, cfg) {
  const shotOpts = {
    animations: 'disabled',
    caret: 'hide',
    style: HIDE_STYLE,
    type: 'png',
  };
  if (cfg.scale) shotOpts.scale = cfg.scale;             // 'css' (default, HiDPI-stable) | 'device'
  if (cfg.omitBackground) shotOpts.omitBackground = true;
  if (cfg.mask && cfg.mask.length) {
    shotOpts.mask = cfg.mask.map(s => page.locator(s));
    shotOpts.maskColor = cfg.maskColor || '#FF00FF';
  }
  if (cfg.locator) {
    if (cfg.clip) warn('both --locator and --clip given; --clip is ignored when a locator scopes the shot');
    const loc = page.locator(cfg.locator).first();
    const n = await loc.count();
    if (n === 0) fatal(`--locator "${cfg.locator}" matched 0 elements; cannot scope the screenshot`);
    return await loc.screenshot(shotOpts);
  }
  if (cfg.clip) shotOpts.clip = cfg.clip;
  if (cfg.fullPage) shotOpts.fullPage = true;
  if (!cfg.locator && !cfg.clip && !cfg.fullPage && !opts['allow-full-page']) {
    warn('capturing the full viewport with no --locator/--clip. Region-scoped checkpoints are far less brittle; pass --allow-full-page to silence this.');
  }
  return await page.screenshot(shotOpts);
}

// Playwright's best flake defense, replicated: take a shot, wait a beat, take another; only proceed once
// two CONSECUTIVE captures are byte-identical (modulo anti-aliasing). A page mid-animation/mid-load keeps
// differing, so this rejects unsettled frames instead of baking jitter into a baseline or a "fail".
async function captureStable(page, cfg) {
  const retries = cfg.stabilize === false ? 0 : (cfg.stabilizeRetries ?? 3);
  let prev = await screenshot(page, cfg);
  for (let i = 1; i <= retries; i++) {
    try { await page.waitForTimeout(80 + i * 70); } catch { /* ignore */ }
    let next;
    try { next = await screenshot(page, cfg); } catch { return prev; }
    try {
      const a = PNG.sync.read(prev), b = PNG.sync.read(next);
      if (a.width === b.width && a.height === b.height) {
        const out = new PNG({ width: a.width, height: a.height });
        if (pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1, includeAA: false }) === 0) return next;
      }
    } catch { /* if either won't decode, just keep going */ }
    prev = next;
  }
  if (retries > 0) warn(`screenshot not byte-stable after ${retries} retries — the page may still be animating/loading; using the last frame`);
  return prev;
}

// ----------------------------------------------------------------------------- diff
function diffPngs(baselineBuf, actualBuf) {
  const a = PNG.sync.read(baselineBuf);
  const b = PNG.sync.read(actualBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { dimensionMismatch: true, baseline: { w: a.width, h: a.height }, actual: { w: b.width, h: b.height } };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const threshold = readThreshold();
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold, includeAA: false });
  return { dimensionMismatch: false, width: a.width, height: a.height, diffPixels, diffBuf: PNG.sync.write(diff) };
}
let _threshold = 0.2;
function readThreshold() { return _threshold; }

// Redact volatile text from an ARIA snapshot (the structural analog of a pixel --mask): each pattern is
// a JS regex; matches become «redacted» so a ticking clock / session id / order number can't fail the tree.
function redactText(s, patterns) {
  let out = s;
  for (const p of patterns || []) {
    let re;
    try { re = new RegExp(p, 'g'); } catch { warn(`--aria-redact "${p}" is not a valid regex; skipping`); continue; }
    out = out.replace(re, '«redacted»');
  }
  return out;
}

// LCS line diff for ARIA snapshots — produces unified-style ` ctx`, `-removed`, `+added` lines.
function lineDiff(aText, bText) {
  const a = aText.split('\n'), b = bText.split('\n');
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0, added = 0, removed = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push('  ' + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push('- ' + a[i]); i++; removed++; }
    else { out.push('+ ' + b[j]); j++; added++; }
  }
  while (i < m) { out.push('- ' + a[i++]); removed++; }
  while (j < n) { out.push('+ ' + b[j++]); added++; }
  return { text: out.join('\n'), added, removed };
}

// ----------------------------------------------------------------------------- benchmark record
function writeBenchmark(record) {
  const target = (typeof opts.benchmark === 'string') ? path.resolve(opts.benchmark) : path.join(DIRS.benchmark, 'runs.jsonl');
  ensureDir(path.dirname(target));
  fs.appendFileSync(target, JSON.stringify(record) + '\n');
}

// ----------------------------------------------------------------------------- commands
async function cmdList() {
  ensureDir(DIRS.baselines);
  const item = (cfg, kind) => ({
    name: cfg.name, kind,
    scenario: cfg.identity?.scenario || cfg.createdBy?.scenario || null,
    routeKey: cfg.identity?.routeKey || null,
    regionKey: cfg.identity?.regionKey || null,
    platforms: kind === 'aria' ? ['any'] : (cfg.platforms || []).filter(k => fs.existsSync(path.join(DIRS.baselines, `${cfg.name}__${k}.png`))),
    locator: cfg.locator || (kind === 'aria' ? 'body' : null),
  });
  let items = allSidecars().map(({ kind, cfg }) => item(cfg, kind));
  // Filters: scope the listing to a test case and/or a page (route).
  const fScenario = scenarioId();
  const fRoute = opts.route || opts.page || null;
  if (fScenario) items = items.filter(b => (b.scenario || '') === sanitizeSeg(fScenario));
  if (fRoute) items = items.filter(b => (b.routeKey || '').startsWith(sanitizeSeg(fRoute)));
  // Group by test case so the agent sees what's already covered per scenario.
  const byScenario = {};
  for (const b of items) (byScenario[b.scenario || '(no test case)'] ||= []).push(b.name);
  emit({ status: 'ok', root: ROOT, count: items.length, filters: { scenario: fScenario || null, route: fRoute || null }, byScenario, baselines: items }, 0);
}

// Registry of test cases — call BEFORE authoring to find an existing test id for this flow (so you reuse
// it instead of minting a variant). `--route <key>` answers "which test(s) already cover this page?".
async function cmdTests() {
  ensureDir(DIRS.baselines);
  const reg = buildRegistry();
  writeRegistry(reg);
  let tests = Object.values(reg);
  const fRoute = opts.route || opts.page || null;
  if (fRoute) tests = tests.filter(t => t.routes.some(r => r.startsWith(sanitizeSeg(fRoute))));
  for (const t of tests.sort((a, b) => a.id.localeCompare(b.id)))
    info(`  ${t.rawId}${t.title ? `  — ${t.title}` : ''}  [${t.source || 'adhoc'}]  routes=${t.routes.join(',') || '-'}  baselines=${t.baselines.length}`);
  if (!tests.length) info(fRoute ? `  (no test case covers route "${fRoute}")` : '  (no test cases registered yet)');
  emit({ status: 'ok', root: ROOT, count: tests.length, filter: { route: fRoute || null }, indexPath: path.join(DIRS.scenarios, 'index.json'), tests }, 0);
}

// Propose a stable, reusable name for the CURRENT page state, and say whether it should REUSE an existing
// baseline (→ next call compares) or CREATE a new one. This is how an agent matches run 1's name on run N
// without a scenario: derive the same route+region key, then check what already exists.
async function cmdSuggest() {
  ensureDir(DIRS.baselines);
  await withPage(async (page) => {
    const sel = opts.locator || null;
    if (sel) { const c = await page.locator(sel).count().catch(() => 0); if (c === 0) warn(`--locator "${sel}" matched 0 elements; region key falls back to route only`); }
    await stabilize(page, { ...stabilizeSettings() });
    const identity = await buildIdentity(page, sel);
    const candidate = suggestName(identity, opts.state || null);
    const existsExact = fs.existsSync(sidecarPath(candidate)) || fs.existsSync(ariaSidecar(candidate));
    const { sameTest, crossTest } = findMatches(identity, null);
    let action, name, note;
    if (existsExact) { action = 'reuse'; name = candidate; note = `baseline "${candidate}" already exists → next check/aria call COMPARES against it`; }
    else if (sameTest) { action = 'reuse'; name = sameTest.name; note = `this page matches existing baseline "${sameTest.name}" (${sameTest.matchOn}) → reuse that name so you COMPARE, not create a duplicate`; }
    else { action = 'create'; name = candidate; note = `nothing matches under test "${identity.scenario || '(none)'}" → first call CREATES "${candidate}"`; }
    info(`suggested name: ${name}   [${action}]`);
    info(`  ${note}`);
    // The non-deterministic-test-id guard: this exact page is baselined under a DIFFERENT test id.
    if (action === 'create' && crossTest.length)
      warn(`this page is already baselined under test id(s): ${uniqScenarios(crossTest).join(', ')}. If you mean the SAME test, re-run with that --test id (don't mint a new variant); pass a fresh id only for a genuinely different test case.`);
    if (!sel) info(`  tip: pass --locator to get a region-scoped key (e.g. ${identity.routeKey}.cart-panel) and a less brittle baseline`);
    emit({ status: 'ok', suggestedName: name, action, candidate, matchedExisting: sameTest || null, crossTestMatches: crossTest, identity, locator: sel, state: opts.state || null }, 0);
  });
}

async function cmdApprove() {
  if (!validName(name)) fatal('approve requires a valid <name>');
  if (opts.aria) {
    const pend = path.join(DIRS.pending, `${name}.aria.yaml`);
    if (!fs.existsSync(pend)) fatal(`no pending ARIA baseline for "${name}" (expected ${pend})`);
    ensureDir(DIRS.baselines);
    fs.copyFileSync(pend, ariaBaseline(name));
    fs.rmSync(pend);
    info(`✓ promoted pending → ARIA baseline for ${name}`);
    emit({ status: 'approved', name, kind: 'aria', baselinePath: ariaBaseline(name) }, 0);
  }
  const pend = pendingPng(name);
  if (!fs.existsSync(pend)) fatal(`no pending baseline for "${name}" on ${KEY} (expected ${pend})`);
  ensureDir(DIRS.baselines);
  fs.copyFileSync(pend, baselinePng(name));
  fs.rmSync(pend);
  const sc = readSidecar(name) || { name };
  sc.platforms = Array.from(new Set([...(sc.platforms || []), KEY]));
  sc.approvedAt = new Date().toISOString();
  fs.writeFileSync(sidecarPath(name), JSON.stringify(sc, null, 2));
  info(`✓ promoted pending → baseline for ${name} (${KEY})`);
  emit({ status: 'approved', name, baselinePath: baselinePng(name) }, 0);
}

async function withPage(fn) {
  const browser = await connect();
  let result;
  try {
    const page = await pickPage(browser);
    result = await fn(page);
  } finally {
    // NEVER browser.close() — this is the agent's shared browser. Drop the CDP socket by exiting.
  }
  return result;
}

async function cmdCheck(mode) {
  if (!validName(name)) fatal(`<name> is required and must match ^[a-z0-9._-]+$ (got ${JSON.stringify(name)}). Use \`visual-check list\` to see existing names.`);
  ensureDir(DIRS.baselines);
  const baseExists = fs.existsSync(baselinePng(name));
  const started = Date.now();

  await withPage(async (page) => {
    const pageUrl = page.url();
    const pageTitle = await page.title().catch(() => '');

    // ---- gated update ----
    if (mode === 'update') {
      const sidecar = readSidecar(name);
      const cfg = sidecar ? resolveCompareConfig(sidecar) : resolveCaptureConfig();
      _threshold = cfg.threshold;
      await stabilize(page, cfg);
      cfg.mask = await validateMasks(page, cfg);
      const buf = await captureStable(page, cfg);
      ensureDir(DIRS.pending); ensureDir(DIRS.requests);
      fs.writeFileSync(pendingPng(name), buf);
      const req = {
        name, platform: KEY, ts: new Date().toISOString(),
        currentBaseline: baseExists ? baselinePng(name) : null,
        candidate: pendingPng(name),
        rationale: opts.note || opts.rationale || '(none provided)',
        scenario: opts.scenario || null, checkpoint: opts.checkpoint || name,
        pageUrl,
      };
      fs.writeFileSync(path.join(DIRS.requests, `${name}.${ts()}.json`), JSON.stringify(req, null, 2));
      info(`↪ update is GATED: wrote candidate to ${pendingPng(name)} and left the live baseline untouched.`);
      info(`  A human promotes it with:  visual-check approve ${name}`);
      emit({ status: 'update_pending', name, baselinePath: baseExists ? baselinePng(name) : null, pendingPath: pendingPng(name), pageUrl, pageTitle }, 0);
    }

    // ---- create (no baseline yet) ----
    if (!baseExists) {
      const cfg = resolveCaptureConfig();
      _threshold = cfg.threshold;
      await stabilize(page, cfg);
      cfg.mask = await validateMasks(page, cfg);
      // Identity check: did the agent just invent a new name (or a variant test id) for an existing page?
      const identity = await buildIdentity(page, cfg.locator);
      const { sameTest, crossTest } = findMatches(identity, name);
      if (sameTest) warn(`creating NEW baseline "${name}", but this page already has baseline "${sameTest.name}" in the same test (${sameTest.matchOn}). To compare instead: visual-check check ${sameTest.name}.`);
      else if (crossTest.length) warn(`creating "${name}" under test "${identity.scenario || '(none)'}", but this exact page is baselined under test id(s) ${uniqScenarios(crossTest).join(', ')} — likely a non-deterministic test id. If it's the same test, use that --test id.`);
      const buf = await captureStable(page, cfg);
      fs.writeFileSync(baselinePng(name), buf);
      const sidecar = readSidecar(name) || {};
      const merged = {
        name,
        viewport: cfg.viewport || sidecar.viewport || null,
        locator: cfg.locator || sidecar.locator || null,
        mask: cfg.mask.length ? cfg.mask : (sidecar.mask || []),
        maskColor: cfg.maskColor,
        clip: cfg.clip || sidecar.clip || null,
        fullPage: cfg.fullPage,
        scale: cfg.scale,
        omitBackground: cfg.omitBackground,
        threshold: cfg.threshold,
        maxDiffPixelRatio: cfg.maxDiffPixelRatio,
        maxDiffPixels: cfg.maxDiffPixels,
        wait: cfg.wait || sidecar.wait || null,
        identity,
        createdBy: sidecar.createdBy || { date: new Date().toISOString(), scenario: opts.scenario || null, model: opts.model || null },
        platforms: Array.from(new Set([...(sidecar.platforms || []), KEY])),
      };
      fs.writeFileSync(sidecarPath(name), JSON.stringify(merged, null, 2));
      refreshRegistry();
      if (opts.benchmark) writeBenchmark({ ts: new Date().toISOString(), scenario: opts.scenario || null, checkpoint: name, status: 'created', durationMs: Date.now() - started, pageUrl });
      info(`✓ created baseline ${baselinePng(name)} — NO prior image to diff against.`);
      info(`  → Eyeball it (Read the PNG). "created" is NOT a pass; it only records what you saw on run 1.`);
      emit({
        status: 'created', name, mode, browser: BROWSER, platform: KEY,
        baselinePath: baselinePng(name), configResolved: merged,
        agentReviewRequired: true, pageUrl, pageTitle, scenario: opts.scenario || null, checkpoint: opts.checkpoint || name,
      }, 0);
    }

    // ---- compare ----
    const sidecar = readSidecar(name) || {};
    const cfg = resolveCompareConfig(sidecar);
    _threshold = cfg.threshold;
    await stabilize(page, cfg);
    cfg.mask = await validateMasks(page, cfg);
    const actualBuf = await captureStable(page, cfg);
    const baselineBuf = fs.readFileSync(baselinePng(name));
    const d = diffPngs(baselineBuf, actualBuf);

    if (d.dimensionMismatch) {
      ensureDir(DIRS.actuals);
      const actualPath = path.join(DIRS.actuals, `${name}__${KEY}.${ts()}.png`);
      fs.writeFileSync(actualPath, actualBuf);
      warn(`dimension mismatch: baseline ${d.baseline.w}x${d.baseline.h} vs live ${d.actual.w}x${d.actual.h}. Usually viewport drift — pin --viewport / scenario viewport.`);
      if (opts.benchmark) writeBenchmark({ ts: new Date().toISOString(), scenario: opts.scenario || null, checkpoint: name, status: 'fail', reason: 'dimension-mismatch', durationMs: Date.now() - started, pageUrl });
      emit({
        status: 'fail', reason: 'dimension-mismatch', name, mode, browser: BROWSER, platform: KEY,
        baselinePath: baselinePng(name), actualPath, dimensions: { baseline: d.baseline, actual: d.actual },
        configResolved: cfg, agentReviewRequired: false, pageUrl, pageTitle, scenario: opts.scenario || null, checkpoint: opts.checkpoint || name,
      }, 2);
    }

    const total = d.width * d.height;
    const diffRatio = d.diffPixels / total;
    // Gate on BOTH the ratio and (if set) an absolute pixel budget, like Playwright — the stricter wins.
    let allowedPixels = Math.floor(cfg.maxDiffPixelRatio * total);
    if (cfg.maxDiffPixels != null) allowedPixels = Math.min(allowedPixels, cfg.maxDiffPixels);
    const pass = d.diffPixels <= allowedPixels;
    const base = { name, mode, browser: BROWSER, platform: KEY, baselinePath: baselinePng(name), diffPixels: d.diffPixels, diffRatio: Number(diffRatio.toFixed(6)), allowedPixels, threshold: cfg.threshold, maxDiffPixelRatio: cfg.maxDiffPixelRatio, maxDiffPixels: cfg.maxDiffPixels, configResolved: cfg, pageUrl, pageTitle, scenario: opts.scenario || null, checkpoint: opts.checkpoint || name };

    if (pass) {
      if (opts.benchmark) writeBenchmark({ ts: new Date().toISOString(), scenario: opts.scenario || null, checkpoint: name, status: 'pass', diffPixels: d.diffPixels, diffRatio, durationMs: Date.now() - started, pageUrl });
      info(`✓ pass — ${d.diffPixels} px differ (≤ ${allowedPixels} allowed; ratio ${diffRatio.toFixed(6)}).`);
      emit({ status: 'pass', ...base, agentReviewRequired: false }, 0);
    }

    // fail: persist actual + diff for the agent to read
    ensureDir(DIRS.diffs); ensureDir(DIRS.actuals);
    const stamp = ts();
    const diffPath = path.join(DIRS.diffs, `${name}__${KEY}.${stamp}.png`);
    const actualPath = path.join(DIRS.actuals, `${name}__${KEY}.${stamp}.png`);
    fs.writeFileSync(diffPath, d.diffBuf);
    fs.writeFileSync(actualPath, actualBuf);
    if (opts.benchmark) writeBenchmark({ ts: new Date().toISOString(), scenario: opts.scenario || null, checkpoint: name, status: 'fail', diffPixels: d.diffPixels, diffRatio, durationMs: Date.now() - started, pageUrl });
    info(`✗ FAIL — ${d.diffPixels} px differ (> ${allowedPixels} allowed; ratio ${diffRatio.toFixed(6)}).`);
    info(`  baseline: ${baselinePng(name)}`);
    info(`  actual:   ${actualPath}`);
    info(`  diff:     ${diffPath}   ← Read this PNG, then triage (regression vs intended change vs flake).`);
    emit({ status: 'fail', ...base, diffPath, actualPath, agentReviewRequired: false }, 2);
  });
}

// ----------------------------------------------------------------------------- aria snapshots
// Capture/compare the accessibility tree (roles + names + structure) instead of pixels. This catches
// "the checkout button disappeared" or "the price label changed" while IGNORING color/spacing/font
// drift — and it's platform-independent, so a single baseline works on every OS. Ideal for agents:
// cheaper, far less flaky than pixels, and the diff is human-readable text.
async function cmdAria(mode) {
  if (!validName(name)) fatal(`<name> is required and must match ^[a-z0-9._-]+$ (got ${JSON.stringify(name)}).`);
  ensureDir(DIRS.baselines);
  const basePath = ariaBaseline(name);
  const exists = fs.existsSync(basePath);
  const started = Date.now();

  await withPage(async (page) => {
    const pageUrl = page.url();
    const pageTitle = await page.title().catch(() => '');
    const stored = exists ? (JSON.parse(fs.readFileSync(ariaSidecar(name), 'utf8').toString())) : null;
    const cfg = {
      locator: (stored && stored.locator) || opts.locator || null,
      viewport: stored ? stored.viewport : parseViewport(opts.viewport),
      wait: (stored && stored.wait) || opts.wait || null,
      redact: (stored && stored.redact) || opts['aria-redact'] || [],
      ...stabilizeSettings(),
    };
    if (stored && opts['aria-redact'] && JSON.stringify(opts['aria-redact']) !== JSON.stringify(stored.redact || []))
      warn(`compare replays the baseline's --aria-redact patterns; caller's differ and are ignored (edit ${path.basename(ariaSidecar(name))} or re-baseline)`);
    await stabilize(page, cfg);
    const sel = cfg.locator || 'body';
    let snap;
    try { snap = await page.locator(sel).first().ariaSnapshot(); }
    catch (e) { fatal(`ariaSnapshot failed for locator "${sel}": ${e.message}. (Needs playwright-core with ariaSnapshot support.)`); }
    snap = redactText(String(snap).replace(/\s+$/g, '') + '\n', cfg.redact);

    // gated update
    if (mode === 'update') {
      ensureDir(DIRS.pending); ensureDir(DIRS.requests);
      const pend = path.join(DIRS.pending, `${name}.aria.yaml`);
      fs.writeFileSync(pend, snap);
      fs.writeFileSync(path.join(DIRS.requests, `${name}.aria.${ts()}.json`), JSON.stringify({
        name, kind: 'aria', ts: new Date().toISOString(),
        currentBaseline: exists ? basePath : null, candidate: pend,
        rationale: opts.note || '(none provided)', scenario: opts.scenario || null, pageUrl,
      }, null, 2));
      info(`↪ aria update is GATED: wrote candidate to ${pend}; promote with: visual-check approve ${name} --aria`);
      emit({ status: 'update_pending', name, kind: 'aria', baselinePath: exists ? basePath : null, pendingPath: pend, pageUrl, pageTitle }, 0);
    }

    // create
    if (!exists) {
      const identity = await buildIdentity(page, cfg.locator);
      const { sameTest, crossTest } = findMatches(identity, name);
      if (sameTest) warn(`creating NEW ARIA baseline "${name}", but this page already has baseline "${sameTest.name}" in the same test. To compare instead: visual-check aria ${sameTest.name}.`);
      else if (crossTest.length) warn(`creating ARIA "${name}" under test "${identity.scenario || '(none)'}", but this page is baselined under test id(s) ${uniqScenarios(crossTest).join(', ')} — likely a non-deterministic test id.`);
      fs.writeFileSync(basePath, snap);
      fs.writeFileSync(ariaSidecar(name), JSON.stringify({
        name, kind: 'aria', locator: cfg.locator || null, viewport: cfg.viewport || null, wait: cfg.wait || null,
        redact: cfg.redact || [], identity,
        createdBy: { date: new Date().toISOString(), scenario: opts.scenario || null, model: opts.model || null },
      }, null, 2));
      refreshRegistry();
      if (opts.benchmark) writeBenchmark({ ts: new Date().toISOString(), scenario: opts.scenario || null, checkpoint: name, kind: 'aria', status: 'created', durationMs: Date.now() - started, pageUrl });
      info(`✓ created ARIA baseline ${basePath} (platform-independent). "created" is NOT a pass — read it and confirm the tree is right.`);
      emit({ status: 'created', name, kind: 'aria', baselinePath: basePath, locator: sel, agentReviewRequired: true, pageUrl, pageTitle, scenario: opts.scenario || null, checkpoint: opts.checkpoint || name }, 0);
    }

    // compare
    const baseSnap = fs.readFileSync(basePath, 'utf8');
    if (baseSnap.trim() === snap.trim()) {
      if (opts.benchmark) writeBenchmark({ ts: new Date().toISOString(), scenario: opts.scenario || null, checkpoint: name, kind: 'aria', status: 'pass', durationMs: Date.now() - started, pageUrl });
      info(`✓ pass — accessibility tree matches baseline.`);
      emit({ status: 'pass', name, kind: 'aria', baselinePath: basePath, locator: sel, agentReviewRequired: false, pageUrl, pageTitle, scenario: opts.scenario || null, checkpoint: opts.checkpoint || name }, 0);
    }
    const dd = lineDiff(baseSnap.replace(/\s+$/g, ''), snap.replace(/\s+$/g, ''));
    ensureDir(DIRS.diffs); ensureDir(DIRS.actuals);
    const stamp = ts();
    const diffPath = path.join(DIRS.diffs, `${name}.aria.${stamp}.diff`);
    const actualPath = path.join(DIRS.actuals, `${name}.aria.${stamp}.yaml`);
    fs.writeFileSync(diffPath, dd.text + '\n');
    fs.writeFileSync(actualPath, snap);
    if (opts.benchmark) writeBenchmark({ ts: new Date().toISOString(), scenario: opts.scenario || null, checkpoint: name, kind: 'aria', status: 'fail', added: dd.added, removed: dd.removed, durationMs: Date.now() - started, pageUrl });
    info(`✗ FAIL — accessibility tree changed: +${dd.added} / -${dd.removed} lines.`);
    info(`  diff:   ${diffPath}   ← Read it; structural change (missing/added/renamed elements).`);
    emit({ status: 'fail', name, kind: 'aria', baselinePath: basePath, actualPath, diffPath, addedLines: dd.added, removedLines: dd.removed, locator: sel, agentReviewRequired: false, pageUrl, pageTitle, scenario: opts.scenario || null, checkpoint: opts.checkpoint || name }, 2);
  });
}

// ----------------------------------------------------------------------------- main
const HELP = `visual-check — visual regression against the live browser the agent is driving.

  visual-check check <name> [opts]    PIXEL: create baseline if missing, else compare (everyday call)
  visual-check aria <name> [opts]      ARIA: create-or-compare the accessibility tree (structure, not
                                       pixels). Platform-independent, low-flake, human-readable diff.
  visual-check update <name> [opts]    gated refresh -> pending/, never overwrites a live baseline
                                       (add --aria to refresh an ARIA baseline)
  visual-check suggest [--test <id>] [--locator <sel>] [--state <word>]   propose a STABLE name for the
                                       current page state; says whether to REUSE an existing baseline or CREATE
  visual-check approve <name> [--aria] promote pending/<name> -> baseline (human-gated)
  visual-check list [--test <id>] [--route <key>]   list baselines, optionally scoped to a test case / page
  visual-check tests [--route <key>]   registry of test ids (id/title/source/routes) — consult BEFORE
                                       authoring to reuse an existing test id instead of minting a variant

Stable naming (so run N reuses run 1's name):
  name = [<test>.]<route>.<region>[.<state>]   e.g. checkout-happy-path.checkout.cart-panel.populated
   test   = the scenario/test-case id (--test / --scenario) — same page in two tests = two baselines;
   route  = normalized URL path (dynamic ids -> "id"); region = locator's data-testid / stable id / role;
   state  = your intent word via --state. "suggest" derives test+route+region for you; you add the state.
   On create, visual-check stores this identity and WARNS if you're duplicating an existing baseline
   (within the same test case).

Scope / determinism:
  --locator <sel>        scope the shot to a region (STRONGLY preferred over full page)
  --mask <sel>           paint over dynamic elements; repeatable or comma-separated
  --mask-color <#hex>    mask fill color (default #FF00FF)
  --clip x,y,w,h         restrict to a rectangle (ignored if --locator is set)
  --full-page            capture the whole scrollable page
  --allow-full-page      silence the full-viewport brittleness warning
  --viewport WxH         pin viewport before shooting (persisted to the sidecar)
  --scale css|device     screenshot scale (default css — HiDPI-stable)
  --omit-background      capture without the default white backdrop (transparent PNG)
  --wait <sel>           wait until selector is visible before shooting
  --threshold <0..1>     pixelmatch per-pixel sensitivity (default 0.2)
  --max-diff-ratio <0..1> acceptable diff-pixel ratio gate (default 0.01)
  --max-diff-pixels <n>  absolute diff-pixel budget; combined with the ratio, the stricter wins
  --no-stabilize         skip the "two consecutive shots must match" settle loop
  --stabilize-retries <n> settle attempts before giving up (default 3)

ARIA snapshots (visual-check aria <name>):
  --locator <sel>        subtree to snapshot (default body) — scope to a stable region
  --aria-redact <regex>  replace volatile text (clocks, ids) before comparing; repeatable. The
                         structural analog of --mask, e.g. --aria-redact '\\d{2}:\\d{2}:\\d{2}'

Connection / paths / page:
  --cdp <url>            CDP endpoint (default http://127.0.0.1:9222, env VISUAL_CDP_URL)
  --root <dir>           data root (default ./visual-tests, env VISUAL_ROOT)
  --url-contains <s>     pick the page whose URL contains <s>
  --page-index <n>       pick the n-th real page

Bookkeeping:
  --test <id> / --scenario <id>   the test-case id (ideally a hard id from your test system: TestRail
                         C12345, Xray/Jira PROJ-T123, spec path) — namespaces every baseline
  --title <text>         human label for the test case (recorded in the registry; not part of identity)
  --source <name>        where the id came from (testrail|xray|jira|file|adhoc) — recorded in the registry
  --checkpoint <n>       checkpoint label for reports
  --note <text>          rationale (used by update / benchmark)
  --benchmark [path]     append a per-run JSONL record (default <root>/benchmark/runs.jsonl)
  --quiet                JSON only (no human summary on stderr)

The first call for a <name> CREATES a baseline (status:"created", not a pass — eyeball it).
Later calls COMPARE and replay the baseline's stored params from its sidecar.`;

try {
  if (command === 'help' || opts.help) { process.stdout.write(HELP + '\n'); process.exit(0); }
  else if (command === 'list') await cmdList();
  else if (command === 'tests') await cmdTests();
  else if (command === 'suggest') await cmdSuggest();
  else if (command === 'approve') await cmdApprove();
  else if (command === 'aria') await cmdAria(opts.update ? 'update' : 'auto');
  else if (command === 'update') await (opts.aria ? cmdAria('update') : cmdCheck('update'));
  else if (command === 'check') await cmdCheck('auto');
  else fatal(`unknown command "${command}". Try: check | aria | suggest | tests | update | approve | list | help`);
} catch (e) {
  fatal(e && e.stack ? e.stack : String(e));
}
