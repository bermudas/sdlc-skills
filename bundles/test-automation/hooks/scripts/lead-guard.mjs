#!/usr/bin/env node
// lead-guard.mjs — two Claude Code guards for the test-automation lead.
//
//   pretooluse  The lead never edits the test tree, the abstraction layer,
//               fixtures, framework configs, package files or .env* (AGENT.md
//               § Rules → No code edits). Field measurement (ta-bench core set,
//               2026-09-29): in 6 of 18 single-unit runs the lead read the app's
//               source, saw the bug, and wrote the spec itself with no dispatch
//               at all. Prose did not stop it; this does. A Write/Edit into a
//               guarded path, or a Bash command that writes there, is DENIED
//               with the rule quoted — the lead dispatches a builder instead.
//   stop        A batch ends with a report FILE (AGENT.md § The loop). Same
//               measurement: report.md in 11 of 24 Claude batches. When the
//               session was a batch and no report exists, the lead's stop is
//               BLOCKED once with the instruction to write it.
//
// The discriminator is the payload's `agent_type` (verified live on Claude Code
// 2.1.282): the lead's own tool calls carry `test-automation-lead`, a dispatched
// engineer's carry `test-automation-engineer` — while `transcript_path` and the
// CLAUDE_CODE_AGENT env are identical for both. So the guard can never hit a
// builder's write. No `agent_type` in the payload (an older host) → fail open.
//
// Contract: fail OPEN on any doubt — a guard that breaks the pipeline is worse
// than none. Never throw. Stdout carries only the decision JSON.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEAD = 'test-automation-lead';

// Guarded paths = this default list ∪ every path `.agents/testing.md § Structure`
// names (scout records where tests, page objects, step definitions, stories and
// fixtures live for whatever framework the project uses — Vividus stories under
// src/main/resources/, qavajs step_definitions/, a .NET Tests/ folder — none of
// which a static list can know). Entry grammar, matched case-insensitively:
//   `dir/`        a directory anywhere in the path (`tests/`, `src/main/resources/story/`)
//   `a/b/file.x`  exactly that project-relative file
//   `file.x`      any file whose basename starts with it (`playwright.config.`, `.env`)
// SDLC_LEAD_GUARD_DENY (space-separated, same grammar) REPLACES both lists;
// SDLC_LEAD_GUARD=off disables both guards.
export const DEFAULT_DENY = [
  'tests/', 'test/', 'spec/', 'specs/', 'e2e/', '__tests__/', 'features/', 'src/test/', 'cypress/',
  '.agents/automation/surface/',
  'playwright.config.', 'cypress.config.', 'jest.config.', 'vitest.config.', 'wdio.conf.', 'pytest.ini', 'conftest.py',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'pyproject.toml', 'requirements', 'pom.xml', 'build.gradle',
  '.env',
];

/** The `## Structure` section of a testing.md, or '' when absent. */
export function structureSection(text) {
  const m = /^##\s+Structure\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/mi.exec(text || '');
  return m ? m[1] : '';
}

/**
 * Deny entries from the seed: every backticked path in `## Structure`, normalised
 * to the entry grammar. Placeholders (`<dir>/pages/`), URLs, shell words and
 * globs' wildcard tails are dropped; `tests/**\/*.spec.ts` contributes `tests/`.
 */
export function parseStructurePaths(text) {
  const out = new Set();
  for (const m of structureSection(text).matchAll(/`([^`\n]+)`/g)) {
    let t = m[1].trim();
    if (!t || /\s/.test(t) || /^[<$({]/.test(t) || /^https?:/.test(t)) continue;
    if (!/[\/.]/.test(t)) continue;                           // `describe`, `afterEach` — words, not paths
    t = t.replace(/^\.\//, '');
    const star = t.indexOf('*');
    if (star >= 0) { t = t.slice(0, star); t = t.slice(0, t.lastIndexOf('/') + 1); if (!t) continue; }
    if (!/^[\w.@~+\-\/]+$/.test(t)) continue;
    if (!t.endsWith('/') && !/\.[A-Za-z0-9]+$/.test(t.split('/').pop())) t += '/';   // an extension-less token is a directory
    out.add(t);
  }
  return [...out];
}

/** Seed-declared guarded paths for the project at `cwd`; [] when there is no seed. */
export function seedDeny(cwd) {
  try {
    const f = join(cwd, '.agents', 'testing.md');
    return existsSync(f) ? parseStructurePaths(readFileSync(f, 'utf8')) : [];
  } catch { return []; }
}

export function denyList(env = process.env, cwd = process.cwd()) {
  const raw = (env.SDLC_LEAD_GUARD_DENY || '').trim();
  if (raw) return raw.split(/\s+/);
  return [...new Set([...DEFAULT_DENY, ...seedDeny(cwd)])];
}

/** Normalise a path token to project-relative posix form; null when it is outside the project. */
export function toRel(p, cwd) {
  if (typeof p !== 'string' || !p) return null;
  let s = p.replace(/\\/g, '/').replace(/^["']|["']$/g, '');
  if (isAbsolute(s)) {
    const r = relative(cwd, s).replace(/\\/g, '/');
    if (!r || r.startsWith('..')) return null;
    s = r;
  }
  return s.replace(/^\.\//, '');
}

export function isDenied(rel, deny) {
  if (!rel) return false;
  const lc = rel.toLowerCase();
  const withSlash = `/${lc}`;
  const base = basename(lc);
  return deny.some((d0) => {
    const d = d0.toLowerCase();
    if (d.endsWith('/')) return withSlash.includes(`/${d}`);   // a directory anywhere in the path
    if (d.includes('/')) return lc === d;                      // exactly that file
    return base.startsWith(d);                                 // a basename family
  });
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Guarded paths a shell command WRITES to. Reads (cat, grep, sed -n, a runner) pass. */
export function bashDeniedWrites(cmd, deny, cwd) {
  if (typeof cmd !== 'string' || !cmd) return [];
  const tokens = [...new Set([...cmd.matchAll(/[A-Za-z0-9_.\/@~+-]+/g)].map((m) => m[0]))];
  const candidates = tokens.filter((t) => t.includes('/') || t.includes('.')).map((t) => [t, toRel(t, cwd)]).filter(([, r]) => isDenied(r, deny));
  if (!candidates.length) return [];
  const hits = new Set();
  const interpreterWrites = /open\([^)]*['"][wa]|\.write\(|writeFileSync|writeFile\(|Path\([^)]*\)\.write_text/.test(cmd);
  const redirectIntoVar = />>?\s*["']?\$/.test(cmd);
  const inPlace = /\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i/.test(cmd);
  for (const [tok, rel] of candidates) {
    const e = esc(tok);
    if (new RegExp(`(>>?|\\btee(\\s+-a)?)\\s*["']?${e}`).test(cmd)) hits.add(rel);
    if (inPlace) hits.add(rel);
    if (new RegExp(`\\b(cp|mv|rm|touch|mkdir|rmdir|install|ln)\\b[^;&|]*\\s["']?${e}`).test(cmd)) hits.add(rel);
    if (interpreterWrites || redirectIntoVar) hits.add(rel);
  }
  return [...hits];
}

const REASON = (paths) =>
  `test-automation-lead guard: the lead never edits the test tree, the abstraction layer, fixtures, framework configs, package files or .env* (AGENT.md § Rules → No code edits; the guarded paths are the common defaults plus what .agents/testing.md § Structure names). Denied: ${paths.join(', ')}. Dispatch a builder — or a fix-only dispatch — for this change; a refusal is the rule working, not an obstacle to route around.`;

/** PreToolUse decision. Returns null (allow) or the hookSpecificOutput object (deny). */
export function decidePreToolUse(payload, env = process.env) {
  if (!payload || env.SDLC_LEAD_GUARD === 'off') return null;
  if (payload.agent_type !== LEAD) return null;          // an engineer's write, or a host with no agent_type → allow
  const cwd = payload.cwd || process.cwd();
  const deny = denyList(env, cwd);
  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  let denied = [];
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const rel = toRel(input.file_path || input.notebook_path, cwd);
    if (isDenied(rel, deny)) denied = [rel];
  } else if (tool === 'Bash') {
    denied = bashDeniedWrites(input.command, deny, cwd);
  }
  if (!denied.length) return null;
  return { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON(denied) };
}

// ---- stop: a batch owes a report file ----------------------------------------
const MAX_TRANSCRIPT = 64 * 1024 * 1024;

/** { builders, tcIds, startedAt } from a lead transcript; null when unreadable. */
export function readBatchSignals(transcriptPath) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath) || statSync(transcriptPath).size > MAX_TRANSCRIPT) return null;
    const lines = readFileSync(transcriptPath, 'utf8').split('\n');
    let builders = 0; let firstUser = null; let startedAt = null;
    const tcIds = new Set();
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (!startedAt && rec.timestamp) startedAt = Date.parse(rec.timestamp) || null;
      const content = rec.message?.content;
      if (rec.type === 'user' && firstUser === null) {
        if (typeof content === 'string') firstUser = content;
        else if (Array.isArray(content)) { const t = content.find((p) => p?.type === 'text'); if (t) firstUser = t.text || ''; }
      }
      if (rec.type === 'assistant' && Array.isArray(content)) {
        for (const p of content) {
          if (p?.type !== 'tool_use' || p.name !== 'Agent') continue;
          const head = `${p.input?.description ?? ''}\n${String(p.input?.prompt ?? '').split('\n').find((l) => l.trim()) ?? ''}`;
          if (/\b(builder|build)\b/i.test(head)) builders++;
        }
      }
    }
    for (const m of (firstUser || '').matchAll(/\b(TC-\d+)\b/g)) tcIds.add(m[1]);
    return { builders, tcIds, startedAt };
  } catch { return null; }
}

/** Newest report.md under <cwd>/.agents/automation/<slug>/, written at or after `since` (ms). */
export function findBatchReport(cwd, since) {
  try {
    const root = join(cwd, '.agents', 'automation');
    if (!existsSync(root)) return null;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const f = join(root, d.name, 'report.md');
      if (!existsSync(f)) continue;
      if (!since || statSync(f).mtimeMs >= since - 5 * 60 * 1000) return f;
    }
    return null;
  } catch { return null; }
}

const STOP_REASON =
  'test-automation-lead guard: this batch has no report file. Write `.agents/automation/<slug>/report.md` — one row per unit (id, outcome, note), coverage per delivered unit, findings by kind, the gate verdict — then finish; your last message carries its path and the outcome column (AGENT.md § The loop). A batch report in a chat message is not a report.';

/** Stop decision. Returns null (allow) or { decision: 'block', reason }. */
export function decideStop(payload, env = process.env, io = { readBatchSignals, findBatchReport }) {
  if (!payload || env.SDLC_LEAD_GUARD === 'off') return null;
  const role = payload.agent_type || env.CLAUDE_CODE_AGENT;
  if (role !== LEAD) return null;
  if (payload.stop_hook_active) return null;               // we already asked once — never loop
  const sig = io.readBatchSignals(payload.transcript_path);
  if (!sig) return null;                                    // unreadable → fail open
  const isBatch = sig.builders >= 2 || sig.tcIds.size >= 2;
  if (!isBatch) return null;
  const cwd = payload.cwd || process.cwd();
  if (io.findBatchReport(cwd, sig.startedAt)) return null;
  return { decision: 'block', reason: STOP_REASON };
}

// ---- entry ----------------------------------------------------------------------
export function run(mode, stdinText, env = process.env) {
  let payload = null;
  try { payload = JSON.parse(stdinText); } catch { return { out: null }; }
  if (mode === 'pretooluse') {
    const d = decidePreToolUse(payload, env);
    return { out: d ? { hookSpecificOutput: d } : null };
  }
  if (mode === 'stop') {
    const d = decideStop(payload, env);
    return { out: d };
  }
  return { out: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let text = '';
  try { text = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  const { out } = run(process.argv[2], text);
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
