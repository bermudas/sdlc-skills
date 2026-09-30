import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAD, DEFAULT_DENY, toRel, isDenied, bashDeniedWrites, decidePreToolUse, decideStop, readBatchSignals, findBatchReport, run,
  structureSection, parseStructurePaths, seedDeny, denyList,
} from './scripts/lead-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CWD = '/proj';
const NOENV = {};
const lead = (tool_name, tool_input, extra = {}) => ({ agent_type: LEAD, cwd: CWD, tool_name, tool_input, ...extra });
const engineer = (tool_name, tool_input) => ({ agent_type: 'test-automation-engineer', agent_id: 'a1', cwd: CWD, tool_name, tool_input });

// The discriminator, verified live (Claude Code 2.1.282): the lead's own tool
// calls carry agent_type test-automation-lead, a dispatched engineer's carry
// its own type — transcript_path and CLAUDE_CODE_AGENT are identical for both.
test('the lead is denied a Write into the test tree; an engineer subagent is not', () => {
  const d = decidePreToolUse(lead('Write', { file_path: '/proj/tests/pages/home.page.ts' }), NOENV);
  assert.equal(d?.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /No code edits/);
  assert.match(d.permissionDecisionReason, /tests\/pages\/home\.page\.ts/);
  assert.equal(decidePreToolUse(engineer('Write', { file_path: '/proj/tests/pages/home.page.ts' }), NOENV), null);
});

test('no agent_type in the payload → fail open, even with the lead env set', () => {
  const p = { cwd: CWD, tool_name: 'Write', tool_input: { file_path: '/proj/tests/x.spec.ts' } };
  assert.equal(decidePreToolUse(p, { CLAUDE_CODE_AGENT: LEAD }), null);
});

test("the lead's own files stay writable: report, verdicts, memory, bench artefacts", () => {
  for (const fp of ['/proj/.agents/automation/slug/report.md', '/proj/.agents/estimation/slug-verdicts.json',
    '/proj/.agents/memory/test-automation-lead/MEMORY.md', '/proj/bench-report.json', '/proj/.agents/testing.md']) {
    assert.equal(decidePreToolUse(lead('Write', { file_path: fp }), NOENV), null, fp);
  }
  // the surface cache is the builder's, not the lead's
  assert.equal(decidePreToolUse(lead('Write', { file_path: '/proj/.agents/automation/surface/board.md' }), NOENV)?.permissionDecision, 'deny');
});

test('Edit, MultiEdit and NotebookEdit are guarded like Write; configs, package files and .env too', () => {
  for (const [tool, fp] of [['Edit', '/proj/playwright.config.ts'], ['MultiEdit', '/proj/package.json'], ['Edit', '/proj/.env.local'],
    ['Edit', '/proj/e2e/login.spec.ts'], ['Edit', '/proj/automation/tests/x.spec.ts'], ['Edit', '/proj/src/test/java/LoginTest.java']]) {
    assert.equal(decidePreToolUse(lead(tool, { file_path: fp }), NOENV)?.permissionDecision, 'deny', `${tool} ${fp}`);
  }
  assert.equal(decidePreToolUse(lead('Edit', { file_path: '/proj/README.md' }), NOENV), null);
  assert.equal(decidePreToolUse(lead('Edit', { file_path: '/elsewhere/tests/x.ts' }), NOENV), null, 'outside the project is not this guard\'s business');
});

// Field shapes from the runs that motivated this: `cat > tests/… <<'EOF'` after a
// checkout, and a python heredoc rewriting a page object.
test('Bash: writes into the test tree are caught in the shapes the lead actually used', () => {
  const deny = DEFAULT_DENY;
  assert.deepEqual(bashDeniedWrites("git checkout -q -b automation/tc-001\ncat > tests/pages/upload.page.ts <<'EOF'\nimport x\nEOF", deny, CWD), ['tests/pages/upload.page.ts']);
  assert.deepEqual(bashDeniedWrites("python3 - <<'E'\np='tests/pages/home.page.ts'\ns=open(p).read()\nopen(p,'w').write(s)\nE", deny, CWD), ['tests/pages/home.page.ts']);
  assert.deepEqual(bashDeniedWrites("sed -i 's/a/b/' tests/board.spec.ts", deny, CWD), ['tests/board.spec.ts']);
  assert.deepEqual(bashDeniedWrites('cp /tmp/x.ts tests/pages/x.ts', deny, CWD), ['tests/pages/x.ts']);
  assert.deepEqual(bashDeniedWrites('rm tests/zz-probe.spec.ts', deny, CWD), ['tests/zz-probe.spec.ts']);
  assert.deepEqual(bashDeniedWrites('echo "BASE_URL=x" >> .env', deny, CWD), ['.env']);
  assert.deepEqual(bashDeniedWrites('p=tests/pages/home.page.ts; cat > "$p" <<EOF\nx\nEOF', deny, CWD), ['tests/pages/home.page.ts']);
  assert.deepEqual(bashDeniedWrites('tee -a tests/x.spec.ts < /dev/null', deny, CWD), ['tests/x.spec.ts']);
});

test('Bash: reads, runs and greps of the test tree pass; writes elsewhere pass', () => {
  const deny = DEFAULT_DENY;
  for (const cmd of [
    'cat tests/pages/home.page.ts', "sed -n '1,40p' tests/board.spec.ts", 'grep -rn toggle tests/', 'ls tests tests/pages',
    'npx playwright test tests/board.spec.ts --reporter=line', 'npx playwright test --grep TC-002 2>&1 | tail -20',
    'git diff main...automation/tc-002 -- tests/', 'git show HEAD:tests/x.spec.ts', 'git checkout -q -b tests/batch-slug',
    "cat > bench-report.json <<'EOF'\n{}\nEOF", 'mkdir -p .agents/automation/slug && cat > .agents/automation/slug/report.md <<EOF\nx\nEOF',
    'cat tasks/todomvc-bulk/TC-002.md .agents/testing.md',
  ]) assert.deepEqual(bashDeniedWrites(cmd, deny, CWD), [], cmd);
});

test('env: SDLC_LEAD_GUARD=off disables, SDLC_LEAD_GUARD_DENY replaces the list', () => {
  assert.equal(decidePreToolUse(lead('Write', { file_path: '/proj/tests/x.ts' }), { SDLC_LEAD_GUARD: 'off' }), null);
  const env = { SDLC_LEAD_GUARD_DENY: 'automation/ karate.config.' };
  assert.equal(decidePreToolUse(lead('Write', { file_path: '/proj/tests/x.ts' }), env), null);
  assert.equal(decidePreToolUse(lead('Write', { file_path: '/proj/automation/x.feature' }), env)?.permissionDecision, 'deny');
  assert.equal(decidePreToolUse(lead('Write', { file_path: '/proj/karate.config.js' }), env)?.permissionDecision, 'deny');
});

test('path helpers', () => {
  assert.equal(toRel('/proj/tests/x.ts', CWD), 'tests/x.ts');
  assert.equal(toRel('./tests/x.ts', CWD), 'tests/x.ts');
  assert.equal(toRel('/other/tests/x.ts', CWD), null);
  assert.equal(isDenied('tests/x.ts', DEFAULT_DENY), true);
  assert.equal(isDenied('docs/tests/notes.md', DEFAULT_DENY), true, 'a nested test dir counts');
  assert.equal(isDenied('test-results/x.json', DEFAULT_DENY), false, 'test-results is a runner artefact, not the tree');
  assert.equal(isDenied('.agents/automation/slug/report.md', DEFAULT_DENY), false);
});

// ---- the seed decides what the test tree IS ----------------------------------
// The default list knows the common layouts. Vividus keeps stories and steps
// under src/main/resources/, qavajs its step definitions beside features/ and a
// root config.ts, .NET a capitalised Tests/ folder — only the seed knows those.
// `.agents/testing.md § Structure` is where scout records them, for any framework.
const VIVIDUS_SEED = `# Testing

## Framework
- **Name + version:** Vividus 0.6 (Java 17, Gradle)

## Structure
- **Tests live in:** \`src/main/resources/story/\` / \`src/main/resources/steps/\`
- **Folder roles**:
  - \`src/main/resources/story/\` — stories, grouped by feature
  - \`src/main/resources/steps/\` — composite steps
  - \`src/main/java/org/acme/steps/\` — Java step implementations
  - \`src/main/resources/properties/\` — environment properties (\`environments/*.properties\`)
  - \`step_definitions/**/*.ts\` — (qavajs projects only)
  - \`config.ts\` — the qavajs config at the root
  - \`Tests/\` — the .NET test project
  - \`<dir>/pages/\` — placeholder left from the template
  - see \`https://docs.vividus.dev/\` and use \`afterEach\` hooks

## Test data strategy
- **Where data lives** (path): \`src/main/resources/data/\`
`;

test('parseStructurePaths: reads only § Structure, normalises to the entry grammar, drops placeholders/URLs/words/glob tails', () => {
  const got = parseStructurePaths(VIVIDUS_SEED);
  assert.deepEqual(got, [
    'src/main/resources/story/', 'src/main/resources/steps/', 'src/main/java/org/acme/steps/',
    'src/main/resources/properties/', 'environments/', 'step_definitions/', 'config.ts', 'Tests/',
  ]);
  assert.equal(structureSection('# x\n## Framework\n- a\n'), '');
  assert.deepEqual(parseStructurePaths('## Structure\n- **Tests live in:** `tests/` / `e2e/` / `cypress/e2e/` /\n  `src/test/java/` / …\n'), ['tests/', 'e2e/', 'cypress/e2e/', 'src/test/java/']);
});

function seededProject(seed) {
  const root = mkdtempSync(join(tmpdir(), 'leadguard-seed-'));
  mkdirSync(join(root, '.agents'), { recursive: true });
  writeFileSync(join(root, '.agents', 'testing.md'), seed);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('the seed EXTENDS the defaults: Vividus stories, qavajs config and the .NET folder are denied to the lead; tests/ still is', () => {
  const p = seededProject(VIVIDUS_SEED);
  try {
    const at = (rel) => decidePreToolUse({ agent_type: LEAD, cwd: p.root, tool_name: 'Write', tool_input: { file_path: join(p.root, rel) } }, NOENV)?.permissionDecision;
    assert.equal(at('src/main/resources/story/Login.story'), 'deny');
    assert.equal(at('src/main/java/org/acme/steps/LoginSteps.java'), 'deny');
    assert.equal(at('config.ts'), 'deny', 'a bare filename from the seed');
    assert.equal(at('src/config.ts'), 'deny', 'a bare filename is a basename family, as the grammar says');
    assert.equal(at('src/main/resources/properties/environments/dev.properties'), 'deny');
    assert.equal(at('Tests/LoginTests.cs'), 'deny');
    assert.equal(isDenied('tests/fixtures/env.ts', ['tests/fixtures/env.ts']), true, 'a slashed file entry matches exactly');
    assert.equal(isDenied('src/tests/fixtures/env.ts', ['tests/fixtures/env.ts']), false, 'and only exactly');
    assert.equal(at('tests/x.spec.ts'), 'deny', 'defaults stay');
    assert.equal(at('README.md'), undefined);
    assert.ok(denyList(NOENV, p.root).includes('src/main/resources/story/'));
    assert.deepEqual(seedDeny('/nonexistent/project'), []);
    // Bash writes into a seeded root are caught too
    assert.deepEqual(bashDeniedWrites("cat > src/main/resources/story/Cart.story <<'EOF'\nx\nEOF", denyList(NOENV, p.root), p.root), ['src/main/resources/story/Cart.story']);
  } finally { p.cleanup(); }
});

test('matching is case-insensitive: Tests/, Cypress/, PLAYWRIGHT.CONFIG.TS', () => {
  assert.equal(isDenied('Tests/Login.cs', DEFAULT_DENY), true);
  assert.equal(isDenied('Cypress/e2e/x.cy.ts', DEFAULT_DENY), true);
  assert.equal(isDenied('PLAYWRIGHT.CONFIG.TS', DEFAULT_DENY), true);
  assert.equal(isDenied('src/Testsuite/x.ts', DEFAULT_DENY), false, 'a directory must match as a whole segment');
});

test('SDLC_LEAD_GUARD_DENY replaces the defaults AND the seed', () => {
  const p = seededProject(VIVIDUS_SEED);
  try {
    const env = { SDLC_LEAD_GUARD_DENY: 'automation/' };
    const at = (rel) => decidePreToolUse({ agent_type: LEAD, cwd: p.root, tool_name: 'Write', tool_input: { file_path: join(p.root, rel) } }, env)?.permissionDecision;
    assert.equal(at('src/main/resources/story/Login.story'), undefined);
    assert.equal(at('tests/x.spec.ts'), undefined);
    assert.equal(at('automation/x.feature'), 'deny');
  } finally { p.cleanup(); }
});

// ---- stop -------------------------------------------------------------------
const jsonl = (...recs) => recs.map((r) => JSON.stringify(r)).join('\n');
const userMsg = (text, ts = '2026-09-29T10:00:00.000Z') => ({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });
const dispatch = (description, prompt) => ({ type: 'assistant', timestamp: '2026-09-29T10:05:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'test-automation-engineer', description, prompt } }] } });

function project({ transcript, report = false, reportOld = false }) {
  const root = mkdtempSync(join(tmpdir(), 'leadguard-'));
  const tp = join(root, 'lead.jsonl');
  writeFileSync(tp, transcript);
  if (report || reportOld) {
    const dir = join(root, '.agents', 'automation', 'slug');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'report.md');
    writeFileSync(f, '# report\n');
    if (reportOld) { const old = new Date('2026-09-01T00:00:00Z'); utimesSync(f, old, old); }
  }
  return { root, tp, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const stopPayload = (p, extra = {}) => ({ hook_event_name: 'Stop', agent_type: LEAD, cwd: p.root, transcript_path: p.tp, stop_hook_active: false, ...extra });

test('stop: a batch (two case ids in the ask) with no report file is blocked once, with the report instruction', () => {
  const p = project({ transcript: jsonl(userMsg('Automate the test cases TC-001 … TC-004 in tasks/x/'), dispatch('Build TC-001..004', 'builder\nUnits: TC-001, TC-002')) });
  try {
    const d = decideStop(stopPayload(p), NOENV);
    assert.equal(d?.decision, 'block');
    assert.match(d.reason, /\.agents\/automation\/<slug>\/report\.md/);
    // the continuation's own stop carries stop_hook_active — never loop
    assert.equal(decideStop(stopPayload(p, { stop_hook_active: true }), NOENV), null);
  } finally { p.cleanup(); }
});

test('stop: two builder dispatches make a batch even when the ask names no ids', () => {
  const p = project({ transcript: jsonl(userMsg('Automate the checkout stories'), dispatch('Build unit 1', 'builder\nUnit: story A'), dispatch('Build unit 2', 'builder\nUnit: story B')) });
  try { assert.equal(decideStop(stopPayload(p), NOENV)?.decision, 'block'); } finally { p.cleanup(); }
});

test('stop: a single unit owes no batch report; a written report satisfies a batch; a stale report does not', () => {
  const single = project({ transcript: jsonl(userMsg('Automate the test case TC-002 in tasks/x/'), dispatch('Build TC-002', 'builder\nUnit: TC-002')) });
  const done = project({ transcript: jsonl(userMsg('Automate TC-001 and TC-002'), dispatch('Build', 'builder\nUnits')), report: true });
  const stale = project({ transcript: jsonl(userMsg('Automate TC-001 and TC-002'), dispatch('Build', 'builder\nUnits')), reportOld: true });
  try {
    assert.equal(decideStop(stopPayload(single), NOENV), null);
    assert.equal(decideStop(stopPayload(done), NOENV), null);
    assert.equal(decideStop(stopPayload(stale), NOENV)?.decision, 'block', 'a report from an earlier session does not count');
  } finally { single.cleanup(); done.cleanup(); stale.cleanup(); }
});

test('stop: fails open — not the lead, no transcript, guard off', () => {
  const p = project({ transcript: jsonl(userMsg('Automate TC-001 and TC-002')) });
  try {
    assert.equal(decideStop(stopPayload(p, { agent_type: 'test-automation-engineer' }), NOENV), null);
    assert.equal(decideStop({ ...stopPayload(p), agent_type: undefined }, { CLAUDE_CODE_AGENT: 'scout' }), null);
    assert.equal(decideStop({ ...stopPayload(p), agent_type: undefined }, { CLAUDE_CODE_AGENT: LEAD })?.decision, 'block', 'the env names the lead when the payload does not');
    assert.equal(decideStop(stopPayload(p, { transcript_path: join(p.root, 'missing.jsonl') }), NOENV), null);
    assert.equal(decideStop(stopPayload(p), { SDLC_LEAD_GUARD: 'off' }), null);
    assert.equal(readBatchSignals(join(p.root, 'missing.jsonl')), null);
    assert.equal(findBatchReport(p.root, Date.now()), null);
  } finally { p.cleanup(); }
});

// ---- the entry point, as Claude Code drives it --------------------------------
test('CLI: pretooluse prints the deny JSON and exits 0; an allowed call prints nothing', () => {
  const script = join(HERE, 'scripts', 'lead-guard.mjs');
  const denyRun = spawnSync('node', [script, 'pretooluse'], { input: JSON.stringify(lead('Write', { file_path: '/proj/tests/x.spec.ts' })), encoding: 'utf8' });
  assert.equal(denyRun.status, 0);
  const out = JSON.parse(denyRun.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  const allowRun = spawnSync('node', [script, 'pretooluse'], { input: JSON.stringify(engineer('Write', { file_path: '/proj/tests/x.spec.ts' })), encoding: 'utf8' });
  assert.equal(allowRun.status, 0);
  assert.equal(allowRun.stdout, '');
  const garbage = spawnSync('node', [script, 'pretooluse'], { input: 'not json', encoding: 'utf8' });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
  assert.deepEqual(run('nonsense', '{}'), { out: null });
});

test('hooks.json registers both guards through run-hook.cmd and keeps the SubagentStop receipt hook', () => {
  const spec = JSON.parse(readFileSync(join(HERE, 'hooks.json'), 'utf8'));
  const cmds = (ev) => (spec[ev] ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds('PreToolUse').some((c) => /run-hook\.cmd" lead-guard pretooluse$/.test(c)));
  assert.match(spec.PreToolUse[0].matcher, /Write\|Edit\|MultiEdit\|NotebookEdit\|Bash/);
  assert.ok(cmds('Stop').some((c) => /run-hook\.cmd" lead-guard stop$/.test(c)));
  assert.ok(cmds('SubagentStop').some((c) => /workflow-return$/.test(c)));
  for (const f of ['lead-guard', 'lead-guard.mjs', 'workflow-return', 'run-hook.cmd']) assert.ok(existsSync(join(HERE, 'scripts', f)), f);
});
