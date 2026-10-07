#!/usr/bin/env node
// lead-guard.mjs — two guards for the test-automation lead.
//
//   pretooluse  The lead never edits the test tree, the abstraction layer,
//               fixtures, framework configs, package files or .env* (AGENT.md
//               § Rules → No code edits). Field measurement (ta-bench core set,
//               2026-09-29): in 6 of 18 single-unit runs the lead read the app's
//               source, saw the bug, and wrote the spec itself with no dispatch
//               at all. Prose did not stop it; this does. A Write/Edit into a
//               guarded path, or a shell command that writes there, is DENIED
//               with the rule quoted — the lead dispatches a builder instead.
//               Runs on Claude Code (PreToolUse) and the Copilot CLI (preToolUse).
//   stop        A batch ends with a report FILE (AGENT.md § The loop). Same
//               measurement: report.md in 11 of 24 Claude batches. When the
//               session was a batch and no report exists, the lead's stop is
//               BLOCKED once with the instruction to write it. Claude only —
//               the Copilot CLI has no Stop hook.
//
// Telling the lead from its engineers — the whole point, since the guard must
// never hit a builder's write:
//   Claude Code   the payload's `agent_type` (verified live on 2.1.282): the
//                 lead's own tool calls carry `test-automation-lead`, a dispatched
//                 engineer's `test-automation-engineer` — while `transcript_path`
//                 and the CLAUDE_CODE_AGENT env are identical for both.
//   Copilot CLI   the payload carries NO agent field (verified live on 1.0.87:
//                 sessionId, toolName, toolArgs, cwd, timestamp), but a dispatched
//                 subagent's calls arrive under a sessionId of their own. The root
//                 session's agent is on disk: ~/.copilot/session-state/<sessionId>/
//                 events.jsonl opens with a `subagent.selected {agentName}` event —
//                 the same lookup hooks/lib.sh::resolve_cli_session_agent uses to
//                 find the launch role. A subagent's sessionId has no such
//                 directory, so it resolves to nothing and passes.
//   VS Code       (Copilot Chat 0.65 source) PreToolUse is {tool_name, tool_input,
//                 tool_use_id, session_id, transcript_path, hook_event_name} — no
//                 agent field, and runSubagent runs the engineer INSIDE the lead's
//                 chat session, so session_id is the same for both. What differs
//                 is the hook SET: a subagent runs workspace hooks plus its OWN
//                 .agent.md frontmatter `hooks:`, the primary its own. So the
//                 installer puts this guard into the lead's .agent.md frontmatter
//                 with SDLC_HOOK_ROLE=test-automation-lead in its env — the file
//                 is the role — and the engineer's file carries no such entry.
//                 The workspace-level entry (needed for the CLI) also fires there
//                 for everyone, resolves no role, and allows.
// No role resolvable (an older host, a moved state dir) → fail open.
//
// Contract: fail OPEN on any doubt — a guard that breaks the pipeline is worse
// than none. Never throw. Stdout carries only the decision JSON, in the host's
// shape: Claude/VS Code read `hookSpecificOutput`, the Copilot CLI reads a
// top-level `permissionDecision` (verified: the model gets the reason back as
// the tool's error, `code: denied`, and carries on).
import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
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

/** Guarded paths a shell command WRITES to (bash or PowerShell). Reads (cat, grep, sed -n, a runner) pass. */
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
    if (new RegExp(`\\b(cp|mv|rm|touch|mkdir|rmdir|install|ln|Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item)\\b[^;&|]*\\s["']?${e}`, 'i').test(cmd)) hits.add(rel);
    if (interpreterWrites || redirectIntoVar) hits.add(rel);
  }
  return [...hits];
}

const REASON = (paths) =>
  `test-automation-lead guard: the lead never edits the test tree, the abstraction layer, fixtures, framework configs, package files or .env* (AGENT.md § Rules → No code edits; the guarded paths are the common defaults plus what .agents/testing.md § Structure names). Denied: ${paths.join(', ')}. Dispatch a builder — or a fix-only dispatch — for this change; a refusal is the rule working, not an obstacle to route around.`;

// ---- host dialects -------------------------------------------------------------
// Copilot CLI payloads are camelCase (`toolName`, `toolArgs`, `sessionId`) and
// never carry `hook_event_name`; Claude Code, VS Code Copilot Chat and Codex send
// snake_case with `hook_event_name` (same rule as hooks/lib.sh apply_payload_dialect).
export function isCopilotCli(payload) {
  return !!payload && typeof payload.toolName === 'string' && !('hook_event_name' in payload);
}

const SESSION_HEAD = 64 * 1024;   // `subagent.selected` is among the first events; never read a whole batch log per tool call

/**
 * The agent a Copilot CLI session was launched as, from its session-state log;
 * '' when there is none (a dispatched subagent, a relocated state dir, VS Code).
 */
export function cliSessionAgent(sessionId, env = process.env) {
  if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return '';
  const base = env.COPILOT_CONFIG_DIR || env.COPILOT_HOME || join(env.HOME || homedir(), '.copilot');
  const file = join(base, 'session-state', sessionId, 'events.jsonl');
  let fd = null;
  try {
    if (!existsSync(file)) return '';
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(SESSION_HEAD);
    const n = readSync(fd, buf, 0, SESSION_HEAD, 0);
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      if (!line.includes('"subagent.selected"')) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.type === 'subagent.selected') return String(rec.data?.agentName ?? '');
      } catch { /* a truncated last line — keep scanning */ }
    }
    return '';
  } catch { return ''; } finally { if (fd !== null) try { closeSync(fd); } catch { /* ignore */ } }
}

/**
 * The role behind a PreToolUse payload, or '' when the host gives no way to know.
 * Precedence: the payload's own `agent_type` (Claude Code) → the Copilot CLI
 * session-state lookup → SDLC_HOOK_ROLE, set only by a hook entry that lives in
 * one agent's .agent.md frontmatter (VS Code), where the file is the role.
 */
export function roleOf(payload, env = process.env) {
  if (!payload) return '';
  if (typeof payload.agent_type === 'string') return payload.agent_type;
  if (isCopilotCli(payload)) return cliSessionAgent(payload.sessionId, env);
  if (typeof payload.hook_event_name === 'string' && typeof env.SDLC_HOOK_ROLE === 'string') return env.SDLC_HOOK_ROLE;
  return '';
}

/** Paths an apply_patch text touches (`*** Add|Update|Delete File: p`, `*** Move to: p`). */
export function patchPaths(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(/^\*\*\*\s*(?:(?:Add|Update|Delete) File|Move to):\s*(.+?)\s*$/gm)].map((m) => m[1]);
}

/**
 * What a tool call would write, host-independently: { paths: [...] } for an
 * editor tool, { command } for a shell, null for anything else (reads, dispatch).
 */
export function writeTarget(payload) {
  if (isCopilotCli(payload)) {
    const tool = payload.toolName;
    const a = payload.toolArgs && typeof payload.toolArgs === 'object' ? payload.toolArgs : {};
    if (tool === 'create' || tool === 'edit') return { paths: [a.path] };
    if (tool === 'str_replace_editor') return a.command === 'view' ? null : { paths: [a.path] };
    if (tool === 'apply_patch') return { paths: [...patchPaths(a.input ?? a.patch), ...(a.path ? [a.path] : [])] };
    if (tool === 'bash' || tool === 'powershell') return { command: a.command };
    return null;
  }
  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  // Claude Code
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return { paths: [input.file_path || input.notebook_path] };
  if (tool === 'Bash') return { command: input.command };
  // VS Code Copilot Chat (model-facing names; Chat 0.65)
  if (tool === 'create_file' || tool === 'replace_string_in_file' || tool === 'insert_edit_into_file' || tool === 'edit_notebook_file') return { paths: [input.filePath] };
  if (tool === 'multi_replace_string_in_file') return { paths: (Array.isArray(input.replacements) ? input.replacements : []).map((r) => r?.filePath) };
  if (tool === 'apply_patch') return { paths: patchPaths(input.input ?? input.patch) };
  if (tool === 'create_directory') return { paths: [input.dirPath] };
  if (tool === 'run_in_terminal') return { command: input.command };
  return null;
}

/** PreToolUse decision. Returns null (allow) or { hookEventName, permissionDecision, permissionDecisionReason } (deny). */
export function decidePreToolUse(payload, env = process.env) {
  if (!payload || env.SDLC_LEAD_GUARD === 'off') return null;
  if (roleOf(payload, env) !== LEAD) return null;        // an engineer's write, or a host that cannot say → allow
  const cwd = payload.cwd || process.cwd();
  const deny = denyList(env, cwd);
  const target = writeTarget(payload);
  if (!target) return null;
  let denied = [];
  if (target.paths) denied = [...new Set(target.paths.map((p) => toRel(p, cwd)).filter((rel) => isDenied(rel, deny)))];
  else denied = bashDeniedWrites(target.command, deny, cwd);
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
    if (!d) return { out: null };
    // The CLI reads the decision at top level; Claude Code and VS Code under hookSpecificOutput.
    if (isCopilotCli(payload)) return { out: { permissionDecision: d.permissionDecision, permissionDecisionReason: d.permissionDecisionReason } };
    return { out: { hookSpecificOutput: d } };
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
