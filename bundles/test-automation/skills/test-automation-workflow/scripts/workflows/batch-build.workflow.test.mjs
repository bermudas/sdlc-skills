import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// The workflow script runs only inside Claude Code's Workflow runtime, which
// wraps the body in an async function and provides agent/pipeline/parallel/
// phase/log/budget/args/workflow as globals — so top-level `return`/`await`
// are legal there but not in bare ESM, and the file cannot be imported here.
// These tests guard what CI can check: the body parses under the runtime's
// wrapping, and the design the script encodes. They pin BEHAVIOUR (schemas,
// the loop, the guards, the return shape) and the few facts a card must carry;
// the doctrine itself lives in the agent bodies and the contracts, and the
// prompt-prose pins that used to live here went with it (2026-09-29 trim).

const FILE = fileURLToPath(new URL('./batch-build.workflow.mjs', import.meta.url));
const text = readFileSync(FILE, 'utf8');
const ENGINEER_BODY = readFileSync(join(dirname(FILE), '../../../../agents/test-automation-engineer/AGENT.md'), 'utf8');
const COMMANDS = readFileSync(join(dirname(FILE), '../../references/commands.md'), 'utf8');

/** The source between two anchors — a dispatch card bounded by its opts object. */
const slice = (start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `anchor not found: ${start}`);
  const j = text.indexOf(end, i);
  assert.ok(j > i, `end anchor not found after ${start}: ${end}`);
  return text.slice(i, j);
};
const BUILD_CARD = slice("card(`builder — ${members", 'label: `build');
const REVIEW_CARD = slice("card(`reviewer — ", 'label: `review:');
const FIX_CARD = slice("card(`builder — fix round", 'label: `fix:');
const MERGE_CARD = slice("card(`merge — ", 'label: `merge:');
const GATE_CARD = slice('Hardening gate for batch', 'label: `gate:');

test('parses under the runtime async-function wrapping', () => {
  const body = text.replace(/^export const meta =/m, 'const meta =');
  new Function('agent', 'pipeline', 'parallel', 'phase', 'log', 'budget', 'args', 'workflow', `"use strict"; return (async () => {\n${body}\n})`);
});

test('meta: canonical name and the five phases; every agent phase is declared', () => {
  assert.match(text, /name: 'ta-batch-build'/);
  for (const ph of ['Triage', 'Execution', 'Build', 'Gate', 'Report']) assert.ok(text.includes(`title: '${ph}'`), `missing phase ${ph}`);
  assert.ok(!text.includes("title: 'Integrate'"), 'integration is continuous, not a phase');
  const declared = new Set([...text.matchAll(/title: '([^']+)'/g)].map((m) => m[1]));
  for (const m of text.matchAll(/phase: '([^']+)'/g)) assert.ok(declared.has(m[1]), `agent phase '${m[1]}' is not in meta.phases`);
  for (const ph of ['Triage', 'Execution', 'Build', 'Gate', 'Report']) assert.match(text, new RegExp(`phase\\('${ph}'\\)`));
});

test('args: stringified args parse, duplicates and removed args fail loudly', () => {
  assert.match(text, /typeof args === 'string' \? JSON\.parse\(args\)/);
  assert.match(text, /duplicate case id\(s\) in args\.cases/);
  assert.match(text, /removed arg\(s\):/);
  for (const a of ['analystConcurrency', 'skipIntegrate', 'analyzeOnly', 'reviewPanel']) assert.ok(text.includes(`'${a}'`), `${a} should be rejected explicitly`);
});

// Runtime invariants: resume replays cached calls keyed on the exact prompt, the
// hook resolves role memory from the agent name, and one working tree has one
// state at a time.
test('runtime invariants: no clock, named agent types, no fan-out, no nesting', () => {
  assert.doesNotMatch(text, /Date\.now|Math\.random|new Date\(\)/);
  for (const t of ['implementer', 'reviewer', 'runner', 'gate', 'reporter']) assert.match(text, new RegExp(`agentType: TYPES\\.${t}`));
  assert.doesNotMatch(text, /Promise\.all|parallel\(|pipeline\(|await workflow\(/);
  assert.match(text, /for \(const unit of \(DEFAULT_ROUTE \? UNITS : \[\]\)\)/);
  assert.match(text, /ONE TREE, ONE MASTER/);
});

// ---- cards are facts, not manuals ----------------------------------------
test('cards start with the shape, then the preamble, then the unit facts', () => {
  assert.match(text, /const card = \(shape, lines\) => `\$\{shape\}\\n\\n\$\{PREAMBLE\}\\n\\n/);
  for (const shape of ['builder — ', 'reviewer — ', 'builder — fix round', 'merge — ', 'gate — Hardening gate for batch', 'triage — batch', 'defect filing — ']) {
    assert.ok(text.includes(`card(\`${shape}`), `no card for ${shape}`);
  }
});

test('the preamble carries dispatch mechanics only: libraries, findings, commit-by-path, denials', () => {
  const pre = slice('const PREAMBLE =', 'const card =');
  assert.match(pre, /Libraries live in \.claude\/skills\/<id>\/ inside this project/);
  assert.match(pre, /never searching \/ or ~/);
  assert.match(pre, /goes in your return\\'s findings\[\]/);
  assert.match(pre, /COMMIT WHAT YOU PRODUCE by exact path/);
  assert.match(pre, /Never clean the tree wholesale/);
  assert.match(pre, /git stash push -- <your paths>/);
  assert.match(pre, /A permission denial blocks an EFFECT, not the task/);
  // what moved to the agent bodies must not creep back
  assert.doesNotMatch(text, /LOCATOR LADDER|Context economy|\{\{base_url\}\}|ADAPT THE PATH|COVERAGE CONTRACT — every delivered spec/);
  assert.doesNotMatch(text, /gitignored/, 'memory is committed by path — the old preamble said the opposite');
});

test('the locator ladder is the engineer body\'s, not the prompt\'s', () => {
  assert.match(ENGINEER_BODY, /surface cache/);
  assert.match(ENGINEER_BODY, /manual-qa's `\.agents\/manual-qa\/` \(read-only\)/);
  assert.doesNotMatch(BUILD_CARD, /cheapest first/i);
});

test('the build card: case source, route, trunk discipline, N, surface cache, landing, return contract', () => {
  assert.match(BUILD_CARD, /THE CASE IS THE SOURCE OF TRUTH and you never edit it/);
  assert.match(BUILD_CARD, /Route \$\{route\}: \$\{provenance\}/);
  assert.match(BUILD_CARD, /git checkout -B \$\{TRUNK\} \$\{BASE\}/);
  assert.match(BUILD_CARD, /never -B an existing trunk — that discards merged units/);
  assert.match(BUILD_CARD, /THEN cut your feature branch FROM \$\{TRUNK\}/);
  assert.match(BUILD_CARD, /never \\`-A\\`/);
  assert.match(BUILD_CARD, /CLUSTER unit:/);
  assert.match(BUILD_CARD, /never flatten distinct expected values into a shared assertion/);
  assert.match(BUILD_CARD, /STABILISE IT YOURSELF — \$\{GATE_N\} CONSECUTIVE green runs/);
  assert.match(BUILD_CARD, /goes BACK into the surface cache/);
  assert.match(BUILD_CARD, /open yours against \$\{TRUNK\}, NOT against \$\{BASE\}/);
  assert.match(BUILD_CARD, /CHECKPOINT_RULE/);
  assert.match(BUILD_CARD, /FOREGROUND_RULE/);
  assert.match(BUILD_CARD, /unit_ids EXACTLY/);
  assert.match(BUILD_CARD, /cannot MINT un-automatable beyond what the intake screening judged/);
  assert.match(BUILD_CARD, /request it with status needs-escalation/);
  assert.match(BUILD_CARD, /expected_red\[\] for every test left red on a ticketed PRODUCT defect/);
});

test('the route facts: combined = first green run is the execution; evidence routes never re-execute', () => {
  assert.match(text, /the FIRST GREEN RUN of your test against the real system IS the case\\'s first execution/);
  assert.match(text, /INVESTIGATION tool at your discretion/);
  assert.match(text, /never a full pre-automation walkthrough/);
  assert.match(text, /do NOT re-execute a case end-to-end in a browser/);
  assert.match(text, /re-buys what the evidence already paid for/);
  assert.match(text, /return status needs-execution and STOP/);
  assert.match(text, /under the manual-qa provider you never execute the case yourself/);
});

test('the reviewer card: contract, one run, edits nothing, exclusion budget, verified coverage, re-review statuses', () => {
  assert.match(REVIEW_CARD, /\$\{CONTRACT\}\/reviewer-contract\.md/);
  assert.match(text, /const CONTRACT = '\.claude\/skills\/test-automation-workflow\/references'/);
  assert.match(REVIEW_CARD, /engineer-TYPED by design/);
  assert.match(REVIEW_CARD, /Run the unit\\'s spec ONCE in a clean process/);
  assert.match(REVIEW_CARD, /YOU EDIT NOTHING on the branch/);
  assert.match(REVIEW_CARD, /-verdicts\.json/);
  assert.match(REVIEW_CARD, /never mint it/);
  assert.match(REVIEW_CARD, /verify per ROW/);
  assert.match(REVIEW_CARD, /TRUE OF THE DIFF, not of your patience/);
  for (const s of ['unaddressed', 'persists', 'external']) assert.match(REVIEW_CARD, new RegExp(`\\\\\`${s}\\\\\``));
  assert.match(REVIEW_CARD, /coverage as you VERIFIED it against the code/);
  assert.match(REVIEW_CARD, /do NOT switch branches/);
});

test('the fix card names the skipped items and demands a reason for anything undone', () => {
  assert.match(FIX_CARD, /receiving-code-review/);
  assert.match(FIX_CARD, /add the regression test that would have caught it/);
  assert.match(FIX_CARD, /THE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND/);
  assert.match(FIX_CARD, /an unexplained gap reads as another skip/);
  assert.match(text, /r\.blocking\.map\(\(b\) => quote\(b\)\)/);
  assert.match(text, /\.map\(\(d\) => quote\(d\.item\)\)/);
});

test('the merge card: --no-ff into the trunk, mechanical-vs-semantic, knowledge lands anyway, tree left on the trunk', () => {
  assert.match(MERGE_CARD, /git merge --no-ff \$\{impl\.branch\}/);
  assert.match(MERGE_CARD, /MECHANICAL \(both sides added/);
  assert.match(MERGE_CARD, /SEMANTIC \(the same function/);
  assert.match(MERGE_CARD, /git merge --abort/);
  assert.match(MERGE_CARD, /LAND THE UNIT'S KNOWLEDGE ANYWAY/);
  assert.match(MERGE_CARD, /-- \.agents\/memory\//);
  assert.match(MERGE_CARD, /Never delete, `rm` or `checkout --ours\/--theirs` a file away/);
  assert.match(MERGE_CARD, /never run the suite \(the gate does\)/);
  assert.match(MERGE_CARD, /LEAVE THE TREE ON \$\{TRUNK\}/);
});

// Field incident (2026-08-17): an unconditional `git push -u origin` + "open the
// PR" got a dispatch refused at spawn in a no-remote repo. Every push/PR
// imperative defers to .agents/profile.md § Automation PR policy.
test('no unconditional push/PR imperatives — every one defers to the PR policy', () => {
  for (const m of text.matchAll(/open (?:the|your) PR|open yours against|git push|push it ONLY|Push \\`/gi)) {
    const ctx = text.slice(Math.max(0, m.index - 400), m.index + 400);
    assert.match(ctx, /Automation PR policy|where the project has a remote|where the project uses/i, `push/PR imperative without policy deference near: …${text.slice(m.index, m.index + 80)}…`);
  }
});

// ---- schemas: the response contract ------------------------------------
test('every worker schema echoes unit_ids and carries findings; coverage uses the closed vocabulary', () => {
  for (const s of ['IMPL_SCHEMA', 'TRIAGE_SCHEMA', 'DEFECT_SCHEMA', 'REVIEW_SCHEMA', 'MERGE_SCHEMA', 'GATE_SCHEMA']) {
    const body = slice(`const ${s} = {`, '\n}\n');
    assert.match(body, /findings: FINDINGS/, `${s} must carry findings[] — the preamble asks every dispatch for it`);
    if (s !== 'TRIAGE_SCHEMA') assert.match(body, /unit_ids: \{ type: 'array'/, `${s} must echo unit_ids`);
  }
  assert.match(text, /\['covered-elsewhere', 'blocked-by-defect', 'un-automatable', 'by-seeded-policy'\]/);
  assert.match(text, /required: \['full', 'excluded'\]/);
  assert.match(text, /required: \['step', 'category', 'referent'\]/);
  assert.match(text, /enum: \['built', 'blocked', 'un-automatable', 'needs-execution', 'needs-escalation'\]/);
  assert.match(text, /enum: \['APPROVED', 'CHANGES_REQUESTED'\]/);
  assert.match(text, /enum: \['unaddressed', 'persists', 'external'\]/);
  assert.match(text, /enum: \['green', 'red', 'not-run', 'incomplete'\]/);
  assert.match(text, /expected_red: \{/);
  assert.match(text, /rerun_causes: \{ type: 'array'/);
});

// ---- triage ---------------------------------------------------------------
test('triage is read-only, reads the seeded provider, never routes a manual-qa project combined', () => {
  assert.match(text, /READ-ONLY routing decision/);
  assert.match(text, /§ Execution provider/);
  assert.match(text, /A missing file or section means \\'self\\'/);
  assert.match(text, /provider 'self' -> route EVERY unit 'combined'/);
  assert.match(text, /run record with verdict PASS/);
  assert.match(text, /NEVER route a manual-qa project 'combined'/);
  assert.match(text, /ONE entry with ids \["A","B"\], never two entries/);
  assert.match(text, /enum: \['manual-qa-verified', 'needs-execution', 'combined'\]/);
  assert.match(text, /model: A\.triageModel \?\? 'haiku', effort: 'low', schema: TRIAGE_SCHEMA/);
});

test('triage routes are reassembled by case coverage (unanimous), a dead triage routes nothing', () => {
  assert.match(text, /const unitOf = new Map\(\)/);
  assert.match(text, /v\.size !== ids\.length\) continue/);
  assert.match(text, /routes\.size !== 1\) continue/);
  assert.match(text, /naming no case in this batch — ignored/);
  assert.match(text, /let DEFAULT_ROUTE = null/);
  assert.match(text, /DEFAULT_ROUTE = TRI\.provider === 'manual-qa' \? 'needs-execution' : 'combined'/);
  assert.match(text, /triage died — the execution-provider policy was never read/);
});

test('missing intake sizing is attested by triage and flagged in the report', () => {
  assert.match(text, /sizing_present: \{ type: 'boolean' \}/);
  assert.match(text, /do not run the pass yourself/);
  assert.match(text, /SIZING_PRESENT = t\.sizing_present === true/);
  assert.match(text, /intake sizing\/screening pass not run — no \.agents\/estimation\//);
});

// ---- execution route -----------------------------------------------------
test('the test-runner gets exactly its own contract prompt; verdicts map PASS/FAIL/BLOCKED; no runner never means self-execution', () => {
  assert.match(text, /`Execute the test case at \$\{SRC\(c\.id\)\} against base_url=\$\{BASE_URL\}`/);
  assert.match(text, /agentType: TYPES\.runner/);
  assert.match(text, /parseRunnerReturn/);
  assert.match(text, /v\.result === 'PASS'/);
  assert.match(text, /v\.result === 'FAIL'/);
  assert.match(text, /outcome: 'defect-found'/);
  assert.match(text, /not automated until the product is fixed/);
  assert.match(text, /File and walk away/);
  assert.match(text, /schema: DEFECT_SCHEMA/);
  assert.match(text, /RUNNER_GONE_NOTE/);
  assert.match(text, /self-execution against the policy is never the fallback/);
  assert.match(text, /runnerGone = true/);
  assert.match(text, /no base URL resolvable/);
  assert.match(text, /Self-execution is never the fallback\./);
});

// ---- the loop ---------------------------------------------------------------
test('the fix loop runs until APPROVED, goes again on unaddressed, stops on cannot-move, unclassified twice, backstop, budget floor', () => {
  assert.match(text, /function loopVerdict/);
  assert.match(text, /if \(unaddressed\.length\) return \{ go: true/);
  assert.match(text, /while \(r && r\.verdict === 'CHANGES_REQUESTED' && \(r\.blocking \?\? \[\]\)\.length\)/);
  assert.match(text, /if \(!v\.go\) \{ stopped = v\.why; stuck = v\.stuck; break \}/);
  assert.match(text, /if \(unclassified >= 2\)/);
  assert.match(text, /FIX_ROUNDS = A\.fixRounds \?\? 8/);
  assert.match(text, /RUNAWAY BACKSTOP, not the working control/);
  assert.match(text, /fix-round backstop \(\$\{FIX_ROUNDS\}\) reached/);
  assert.match(text, /budget floor reached mid-fix/);
  assert.match(text, /after \$\{round\} fix round\(s\)/);
});

// Splitting a stuck unit is the lead's decision now; the script names the stuck
// cases and returns the unit blocked instead of carving code automatically.
test('no automatic carve: a stuck subset is named in the blocked note for the lead to split by hand', () => {
  assert.doesNotMatch(text, /\bcarv|preserved@|QUARANTINE by default/i);
  assert.match(text, /stuck cases: \$\{stuck\.join\(', '\)\}/);
  assert.match(text, /split it by hand if you want it landed/);
});

test('R2 cap counts reruns per root cause, with the total as fallback', () => {
  assert.match(text, /worstCause \? worstCause\[1\] > 2 : impl\.reruns > 2/);
  assert.match(text, /causes not reported/);
});

test('a unit that reviews but cannot merge is parked, not lost', () => {
  assert.match(text, /const parked = \[\]/);
  assert.match(text, /reviewed but NOT merged/);
  assert.match(text, /resolve on the case branch and re-enter/);
  assert.match(text, /parked: parked\.map/);
});

// ---- the gate ----------------------------------------------------------------
test('the gate: its own agent, N consecutive, --cases check, expected_red excluded from the count, never merges/fixes/classifies', () => {
  assert.match(GATE_CARD, /You built none of it and you fix nothing/);
  assert.match(GATE_CARD, /\$\{GATE_N\} CONSECUTIVE deterministic green runs/);
  assert.match(GATE_CARD, /a red anywhere ENDS the attempt/);
  assert.match(GATE_CARD, /run the specs this batch could have BROKEN/);
  assert.match(GATE_CARD, /gate-case\.mjs/);
  assert.match(GATE_CARD, /--cases \$\{mergedIds\.join\(','\)\}/);
  assert.match(GATE_CARD, /MECHANICAL COVERAGE CHECK/);
  assert.match(GATE_CARD, /coverage-invalid/);
  assert.match(GATE_CARD, /RED BY DESIGN — do not count these against the green requirement/);
  assert.match(GATE_CARD, /quote\(r\.ticket, 60\)/);
  assert.match(GATE_CARD, /Do NOT merge anything\. Do NOT classify/);
  assert.match(GATE_CARD, /FOREGROUND_RULE/);
  assert.match(GATE_CARD, /'incomplete' \(not 'not-run'\)/);
  assert.match(GATE_CARD, /coverage_checked=true ONLY if the --cases check actually ran/);
  assert.match(GATE_CARD, /never RAN \(module not found, worker crash, 0ms, collection error\) rather than failed/);
  assert.match(GATE_CARD, /LEAVE THE TREE ON \$\{gateBranch\}/);
  assert.match(text, /batch-stabilize/);
});

// The run shape (one run per call, --n 1, sleep polls, blast radius) is a
// reference the gate slot reads, not prose in every dispatch.
test('the gate run shape lives in commands.md § Hardening gate, and the card points at it', () => {
  assert.match(GATE_CARD, /commands\.md § Hardening gate/);
  assert.match(COMMANDS, /^## Hardening gate/m);
  assert.match(COMMANDS, /--n 1/);
  assert.match(COMMANDS, /timeout: 600000/);
  assert.match(COMMANDS, /sleep 300/);
  assert.match(COMMANDS, /--cases/);
  assert.match(COMMANDS, /hunk by hunk/i);
  assert.match(COMMANDS, /never ran/i);
});

test('gate outcomes: green delivers (except red-by-design → defect-found), no verdict → merged-ungated, red → blocked', () => {
  assert.match(text, /outcome: 'delivered', gate: \{ runs: gate\.runs/);
  assert.match(text, /const red = OUTCOME\[id\]\._expectedRed/);
  assert.match(text, /red by design pending .* the gate ran it but could not count it/);
  assert.match(text, /outcome: 'merged-ungated'/);
  assert.match(text, /UNPROVEN, not blocked/);
  assert.match(text, /gate skipped by arg \(skipGate\)/);
  assert.match(text, /gate says green but coverage_checked=false/);
  assert.match(text, /outcome: 'blocked', note: why/);
  assert.match(text, /A\.gateModel \? \{ model: A\.gateModel \}/);
});

// ---- guards --------------------------------------------------------------------
test('account ceiling halts admission; the breaker stops a dead environment; a stall costs its unit, never the run', () => {
  assert.match(text, /QUOTA_RE/);
  assert.match(text, /ACCOUNT CEILING/);
  assert.match(text, /function breakerCount\(cause, why = ''\)/);
  assert.match(text, /circuit breaker TRIPPED/);
  assert.match(text, /const isStall = \(e\) => \/stall\/i\.test/);
  assert.match(text, /outcome: 'infra-stalled', note: stallNote\('execution', e\)/);
  assert.match(text, /outcome: 'infra-stalled', note: stallNote\('build', e\)/);
  assert.match(text, /breakerCount\('agent-died', String\(e\?\.message \?\? e\)\)/);
  assert.match(text, /build failed:/);
  assert.match(text, /continuing with the next unit/);
  assert.match(text, /budget\.total && budget\.remaining\(\) < RESERVE/);
});

test('checkpoint discipline and the long-jobs rule ride the cards that run long', () => {
  assert.match(text, /const CHECKPOINT_RULE =/);
  assert.match(text, /retry inherits ONLY what is committed/);
  assert.match(text, /const FOREGROUND_RULE =/);
  assert.match(text, /timeout: 600000/);
  assert.match(text, /sleep 300/);
  assert.match(text, /NEVER end a turn while a job is running/);
  assert.match(text, /nothing will wake you/);
  assert.match(text, /NEVER poll at second-level intervals/);
  const rides = (text.match(/^\s*FOREGROUND_RULE,$/gm) ?? []).length;
  assert.ok(rides >= 4, `FOREGROUND_RULE should ride build, review, fix and gate cards; found ${rides}`);
});

// ---- report ---------------------------------------------------------------
test('the report shape is unchanged for its consumers: one row per case, totals, gate, parked, expected_red', () => {
  assert.match(text, /for \(const c of CASES\) OUTCOME\[c\.id\] = \{ id: c\.id, outcome: 'not-started'/);
  assert.match(text, /const \{ _findingKeys, _expectedRed, \.\.\.row \} = OUTCOME\[c\.id\]/);
  for (const k of ['batch: SLUG', 'base: BASE', 'integration_branch:', 'gate: gate ?', 'cases: rows', 'totals,', 'quality_flags: qualityFlags', 'quota_halted: quotaHalted', 'expected_red: EXPECTED_RED', 'parked: parked.map']) {
    assert.ok(text.includes(k), `report field missing: ${k}`);
  }
  assert.match(text, /report_written: wrote\?\.written === true/);
  assert.match(text, /report_path: `\$\{REPORT_DIR\}\/report\.json`/);
  assert.match(text, /delivered \| defect-found \| blocked \| un-automatable \|\n\/\/ needs-execution \| infra-stalled \| not-started/);
});

test('the report is the single disk write, rendered byte-exact, and rows are clipped at the source', () => {
  assert.match(text, /single disk write of this run/);
  assert.match(text, /EXACTLY this JSON, byte for byte/);
  assert.match(text, /Change NOTHING about the data/);
  assert.match(text, /report\.md/);
  assert.match(text, /RETURN THE TREE TO \$\{gateBranch\}/);
  assert.match(text, /const CLIP = 400/);
  assert.match(text, /p\.note = clip\(p\.note\)/);
  assert.match(text, /note: clip\(f\.note\)/);
  assert.match(text, /if \(seen\.has\(key\)\) continue/);
  assert.match(text, /model: A\.reporterModel \?\? 'haiku'/);
  assert.match(text, /A\.mergeModel \?\? A\.workerModel \?\? 'haiku'/);
});

test('next: landing defers to the PR policy and handles declared reds; an ungated trunk orders the report write-back', () => {
  assert.match(text, /LAND IT: one PR from \$\{gateBranch\} to \$\{BASE\} per \.agents\/profile\.md § Automation PR policy/);
  assert.match(text, /quarantine them behind a declared skip that names the ticket/);
  assert.match(text, /automation executions ONLY/);
  assert.match(text, /GATE NEVER RAN/);
  assert.match(text, /WRITE THE VERDICT BACK INTO \$\{REPORT_DIR\}\/report\.json/);
  assert.match(text, /scores as ZERO delivered/);
  assert.match(text, /work-scope\.mjs outcome <ID>=delivered/);
});

test('in-repo case sources replace the snapshot copy in every card', () => {
  assert.match(text, /CASE_PATH = new Map\(CASES\.map/);
  assert.match(text, /\{id, title\?, path\?\}/);
  assert.match(text, /const SRC = \(id\) =>/);
});

// The headroom projection is an UPPER bound anyone can check.
test('the worst-case dispatch projection is a true upper bound', () => {
  assert.match(text, /const perUnit = 3 \+ FIX_ROUNDS \+ \(FIX_ROUNDS \+ 1\)/);
  assert.match(text, /UNITS\.length \* perUnit \+ CASES\.length \+ 3/);
  const perUnit = (fixRounds) => 3 + fixRounds + (fixRounds + 1);
  assert.equal(perUnit(8), 20);
  assert.ok(5 * perUnit(8) + 5 + 3 < 900, 'a default 5-case batch is nowhere near the cap');
  assert.ok(50 * perUnit(8) + 50 + 3 > 900, 'fifty solo units are past the point of warning');
});

test('foreign text reaches prompts only through quote', () => {
  assert.match(text, /const quote = \(s, max = 400\) =>/);
  assert.match(text, /quote\(c\.title, 120\)/);
  assert.match(text, /quote\(c\.title, 80\)/);
  assert.match(text, /quote\(t\.base_url, 200\)/);
  assert.match(text, /quote\(f\.signature|quote\(v\.failure_reason/);
});
