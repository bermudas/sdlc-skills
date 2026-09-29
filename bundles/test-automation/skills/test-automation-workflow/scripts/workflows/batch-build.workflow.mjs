// Canonical batch workflow for the test-automation pipeline. Claude Code only —
// the lead invokes it by path:
//   Workflow({ scriptPath: '.claude/skills/test-automation-workflow/scripts/workflows/batch-build.workflow.mjs',
//              args: { slug, base, cases: [{id, title?, path?}, …], clusters?, … } })
//
// The lead's unit loop, run by a script instead of by hand:
//   triage    → one read-only dispatch reads .agents/testing.md § Execution
//               provider and routes every unit (manual-qa-verified |
//               needs-execution | combined)
//   per unit, IN ORDER, on the batch trunk:
//     execute → (needs-execution only) manual-qa's test-runner per case
//     build   → one engineer dispatch: case → code on a branch cut from the trunk
//     review  → a fresh engineer walks the case against the diff and runs the
//               spec once; fix rounds until APPROVED (loopVerdict decides)
//     merge   → the unit branch into the trunk; the tree returns to the trunk
//   gate      → once, on the trunk: the batch's specs together, N consecutive
//               green, the blast radius once, the mechanical coverage check
//   report    → one writer, at close
//
// Every dispatch is a CARD — the unit's facts plus the return contract — and
// nothing the agent's own AGENT.md already says. The rules live in the bodies
// and the contracts; the script carries what no agent can know: the trunk, the
// route, the schema, the harness limits. Design rationale (one tree one master,
// no board, outcomes not statuses, prompt determinism, the guards) is in
// references/workflow-accelerant.md § Rules the script encodes.
//
// Runtime invariants: no clock and no randomness in prompts (resume replays
// cached calls keyed on the exact prompt); every agent() names its agentType (the hook resolves role
// memory from it); nothing that writes runs concurrently (one working tree).

export const meta = {
  name: 'ta-batch-build',
  description: 'One batch, one report: triage routes every unit per the seeded execution-provider policy (manual-qa-verified | needs-execution | combined), units run in order on the batch trunk — execute via manual-qa\'s test-runner where policy demands it, build from the case on a branch cut from the trunk (green N× — the builder stabilises), review against the coverage contract with one run of the spec, fix to APPROVED, merge back — then one hardening gate (N consecutive green, blast-radius regression, mechanical coverage check), returning per-case outcomes and findings for the lead to land, classify and replan from',
  whenToUse: 'Orchestrator (test-automation-lead) on Claude Code once a batch of cases has been planned and clustered — it runs the batch end to end; the lead (or a closer) lands it per seeded policy, classifies anything red, and replans the remainder',
  phases: [
    { title: 'Triage', detail: 'one read-only dispatch: reads .agents/testing.md § Execution provider and routes every unit (manual-qa-verified | needs-execution | combined)' },
    { title: 'Execution', detail: 'needs-execution units only: manual-qa\'s test-runner per case; FAIL files a defect, BLOCKED stops the case, no runner → honestly needs-execution' },
    { title: 'Build', detail: 'per unit: one engineer dispatch implements it green N× on a branch cut from the trunk, review with one run of the spec, fix rounds, merge back' },
    { title: 'Gate', detail: 'the batch specs together N consecutive green, plus the mechanical coverage check and one run of the specs the batch could have broken — its own agent, never a builder' },
    { title: 'Report', detail: 'one writer: per-case outcomes + coverage + findings to disk' },
  ],
}

// ---- args ------------------------------------------------------------------
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.slug || !A.base || !Array.isArray(A.cases) || A.cases.length === 0 || A.cases.some((c) => !c?.id)) {
  throw new Error(
    'args required: { slug, base, cases: [{id, title?, path?}, …] (every case needs an id; path = repo-relative source file when the body already lives in this repo — no snapshot copy), clusters?: [[id,…],…], ' +
    'quotaResume?, root?, reportDir?, workItemRef?, baseUrl?, ' +
    'agentTypes?, workerModel?, workerEffort?, reviewerModel?, mergeModel?, reporterModel?, triageModel?, gateModel?, ' +
    'fixRounds?, gateN?, gateCmd?, integrationBranch?, skipGate?, breakerThreshold?, budgetReserve? }'
  )
}
{
  // Args removed by the redesigns fail loudly: silently ignoring one changes
  // behaviour without saying so.
  const gone = ['analystConcurrency', 'skipIntegrate', 'integratorModel', 'integrateScriptPath',
    'tiering', 'analyzeOnly', 'preAnalyzed', 'extendImplementerModel', 'extendRateThreshold', 'reviewPanel']
    .filter((k) => A[k] !== undefined)
  if (gone.length) {
    throw new Error(
      `removed arg(s): ${gone.join(', ')}. Units are strictly sequential, integration happens per unit, `
      + 'the analyst slot is gone (triage routes, the build derives the spec from the case), and the review '
      + 'panel is a hand-run option now. Use `skipGate` to stop after review; drop the rest.'
    )
  }
  const dup = A.cases.map((c) => c.id).filter((id, i, arr) => arr.indexOf(id) !== i)
  if (dup.length) throw new Error(`duplicate case id(s) in args.cases: ${[...new Set(dup)].join(', ')}`)
}
const SLUG = A.slug
const BASE = A.base
const CASES = A.cases
const ROOT = A.root ? `${String(A.root).replace(/\/+$/, '')}/` : ''
// Always dispatch NAMED agent types — the SubagentStart hook resolves role
// memory from the name; an anonymous workflow agent gets none. `runner` is
// manual-qa's agent, present only on co-installed rosters.
const TYPES = {
  implementer: 'test-automation-engineer',
  reviewer: 'test-automation-engineer',   // engineer-typed BY DESIGN: a clean context + the reviewer contract
  runner: 'test-runner',
  gate: 'test-automation-engineer',
  reporter: 'test-automation-engineer',
  ...(A.agentTypes ?? {}),
}
// No model opt = the agent definition's frontmatter `model:` governs. Build,
// reviewer and gate pass NO model so the installed AGENT.md stays the
// configuration surface; args override per run.
const WORKER = {
  ...(A.workerModel ? { model: A.workerModel } : {}),
  ...(A.workerEffort ? { effort: A.workerEffort } : {}),
}
const REV = {
  ...(A.workerEffort ? { effort: A.workerEffort } : {}),
  ...((A.reviewerModel ?? A.workerModel) ? { model: A.reviewerModel ?? A.workerModel } : {}),
}
const QUOTA_RESUME = A.quotaResume === true   // a replayed ceiling note must not re-halt a resumed run
const BREAKER = A.breakerThreshold ?? 3
const RESERVE = A.budgetReserve ?? 60_000
// RUNAWAY BACKSTOP, not the working control: the fix loop ends when the
// reviewer says another round cannot help (loopVerdict), never on a count.
const FIX_ROUNDS = A.fixRounds ?? 8
const GATE_N = A.gateN ?? 3
const GATE_CMD = A.gateCmd ?? null
// THE TRUNK — the known state the whole run returns to. Every unit branches
// from it and merges back into it; it is the single thing the gate proves.
const TRUNK = A.integrationBranch ?? `tests/batch-${SLUG}`
const SKIP_GATE = A.skipGate === true
let BASE_URL = A.baseUrl ? String(A.baseUrl).trim() : null   // resolved by triage when not given
// Intake wrote each case body here; a case whose body already lives in the repo
// (cases[].path) is read from that file instead — one body, no copy.
const CASE_PATH = new Map(CASES.map((c) => [c.id, typeof c.path === 'string' && c.path ? c.path : null]))
const SRC = (id) => {
  const p = CASE_PATH.get(id)
  return p ? `${ROOT}${p}` : `${ROOT}.agents/automation/${SLUG}/cases/${id}.md`
}
const REPORT_DIR = `${ROOT}${A.reportDir ?? `.agents/automation/${SLUG}`}`   // per-wave dirs under a campaign
const CONTRACT = '.claude/skills/test-automation-workflow/references'

// ---- units: clusters (plan-declared) + solos, in caller order --------------
const byId = new Map(CASES.map((c) => [c.id, c]))
const clustered = new Set()
const UNITS = []
for (const cl of (Array.isArray(A.clusters) ? A.clusters : [])) {
  const members = cl.filter((id) => byId.has(id) && !clustered.has(id)).map((id) => byId.get(id))
  if (members.length >= 2) { UNITS.push(members); members.forEach((m) => clustered.add(m.id)) }
}
for (const c of CASES) if (!clustered.has(c.id)) UNITS.push([c])
UNITS.sort((a, b) => CASES.findIndex((c) => c.id === a[0].id) - CASES.findIndex((c) => c.id === b[0].id))
const label = (unit) => unit.map((c) => c.id).join('+')

// FOREIGN TEXT GOES THROUGH HERE: case titles, blocking items, notes, tickets
// are written by the TMS or by other agents and land inside a prompt that IS
// instructions — clamp, defuse fences and headings, keep it a quoted value.
const quote = (s, max = 400) => String(s ?? '')
  .replace(/```+/g, "'''")
  .replace(/^\s{0,3}#{1,6}\s+/gm, '')
  .trim()
  .slice(0, max)

// ---- the three harness facts every card carries -----------------------------
// A foreground call dies at 600s; a slot that ends its turn is forced to report
// 28ms later and nothing wakes it; a killed dispatch is retried with the same
// prompt and inherits only what is committed. Measured, all three.
const FOREGROUND_RULE =
  'LONG JOBS: a foreground call is killed at its `timeout` (default 120s, max 600000ms) — pass timeout: 600000 on a suite run ' +
  'and let it block when the job fits. When it does not fit: run it detached to a file and wait with blocking polls, ONE ' +
  '`sleep <n>; <tail the file>` per call (first poll ~60-120s, then `sleep 300`), never chaining sleeps in one call. ' +
  'NEVER end a turn while a job is running — nothing will wake you and this workflow blocks on your return; ' +
  'NEVER poll at second-level intervals — every turn re-sends your whole context. ' +
  'A job too long even for that: say so in findings[] and run the narrower selection you need.'
const CHECKPOINT_RULE =
  'CHECKPOINT: this dispatch can be killed and re-sent without warning, and the retry inherits ONLY what is committed. ' +
  'Before writing anything, check whether your branch already carries commits from a killed attempt (`git log <trunk>..<branch>`, `git status`): ' +
  'coherent work in progress -> continue it and say so in notes; wrong -> rebuild those parts and say so. ' +
  'Commit as milestones land, by exact path; push per `.agents/profile.md` § Automation PR policy, only where the project has a remote.'
const PREAMBLE =
  'Dispatched from the batch workflow. Load your role memory and the .agents/*.md digests if they are not in your context ' +
  '(memory skill; read the files). Libraries live in .claude/skills/<id>/ inside this project — open one only at the step that ' +
  'names it, never re-invoking a skill you already carry, never searching / or ~. ' +
  'Anything worth telling someone that did NOT stop you — a defect you filed, a place the case disagrees with the product, an open ' +
  'question, a gotcha — goes in your return\'s findings[] with its kind; the report is how the lead hears it. ' +
  'COMMIT WHAT YOU PRODUCE by exact path on your branch — code, the surface cache, memory. Never clean the tree wholesale ' +
  '(`git stash --include-untracked`, `git clean -fd`, `git checkout -- .`, `git reset --hard` delete work you did not write); ' +
  '`git stash push -- <your paths>` instead. ' +
  'A permission denial blocks an EFFECT, not the task: never re-achieve the blocked effect through another shape; a genuinely ' +
  'different allowed route is fine, recorded in notes; none -> the case goes blocked with the denial recorded.'
// A card: the shape on the first line (what the lead's own dispatch card puts
// there), the preamble, then the unit's facts as bullets.
const card = (shape, lines) => `${shape}\n\n${PREAMBLE}\n\n${lines.filter(Boolean).map((l) => `- ${l}`).join('\n')}`

// ---- response schemas ------------------------------------------------------
// findings[] rides every return: orthogonal to whether the work landed.
const FINDINGS = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false,
    required: ['kind', 'note'],
    properties: {
      kind: { type: 'string', enum: ['defect', 'clarification', 'question', 'note'] },
      note: { type: 'string' },
      ref: { type: ['string', 'null'] },
    },
  },
}
// The coverage contract's return shape (mirrors the comment block in the spec).
const EXCLUSION_CATEGORIES = ['covered-elsewhere', 'blocked-by-defect', 'un-automatable', 'by-seeded-policy']
const COVERAGE = {
  type: 'object', additionalProperties: false,
  required: ['full', 'excluded'],
  properties: {
    full: { type: 'boolean' },
    excluded: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['step', 'category', 'referent'],
        properties: {
          step: { type: 'string' },        // '<case-id>/<step number>'
          category: { type: 'string', enum: EXCLUSION_CATEGORIES },
          referent: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
}
// unit_ids echoes the dispatched ids EXACTLY — the telemetry capture keys
// attribution on it from the receipt.
const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'status', 'branch', 'pr', 'reruns', 'coverage', 'notes', 'findings'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['built', 'blocked', 'needs-escalation'] },
    branch: { type: 'string' },
    pr: { type: ['integer', 'null'] },
    reruns: { type: 'integer' },
    rerun_causes: { type: 'array', items: { type: 'string' } },   // the R2 cap is per CAUSE
    // Tests left red on a ticketed product defect — the case's own assertion
    // failing on that step. Declared so the gate runs them without counting
    // them and the case is reported defect-found, not delivered.
    expected_red: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['spec', 'ticket', 'why'],
        properties: {
          spec: { type: 'string' },
          test_id: { type: 'string' },
          ticket: { type: 'string' },
          why: { type: 'string' },
          case_ids: { type: 'array', items: { type: 'string' } },   // omitted = the whole unit
        },
      },
    },
    coverage: COVERAGE,
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
// The build slot adds the stops only an initial build can hit.
const BUILD_SCHEMA = {
  ...IMPL_SCHEMA,
  properties: {
    ...IMPL_SCHEMA.properties,
    status: { type: 'string', enum: ['built', 'blocked', 'un-automatable', 'needs-execution', 'needs-escalation'] },
  },
}
const TRIAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['provider', 'base_url', 'sizing_present', 'units', 'notes'],
  properties: {
    provider: { type: 'string', enum: ['manual-qa', 'self'] },
    base_url: { type: ['string', 'null'] },
    units: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['ids', 'route'],
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          route: { type: 'string', enum: ['manual-qa-verified', 'needs-execution', 'combined'] },
          why: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    notes: { type: 'string' },
    sizing_present: { type: 'boolean' },   // the lead's intake pass, attested — false lands a quality_flag
    findings: FINDINGS,
  },
}
const DEFECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'filed', 'notes', 'findings'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },
    filed: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['case_id', 'ref'],
        properties: { case_id: { type: 'string' }, ref: { type: ['string', 'null'] }, note: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'verdict', 'coverage', 'findings', 'blocking', 'notes'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['APPROVED', 'CHANGES_REQUESTED'] },
    coverage: COVERAGE,                 // as VERIFIED against the code, not echoed
    blocking: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    // On a re-review, WHY each blocker is still here — the loop's real control:
    // unaddressed = go round again; persists / external = stop.
    blocking_detail: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['item', 'status'],
        properties: {
          item: { type: 'string' },
          status: { type: 'string', enum: ['unaddressed', 'persists', 'external'] },
          case_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    findings: FINDINGS,
  },
}
const MERGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'merged', 'head_sha', 'conflict_files', 'notes'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },
    merged: { type: 'boolean' },
    head_sha: { type: 'string' },
    conflict_files: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'verdict', 'coverage_checked', 'runs', 'green_specs', 'failures', 'notes'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },
    // `incomplete` ≠ `not-run`: cut off mid-run with greens already banked says
    // "resume here", not "nothing is known".
    verdict: { type: 'string', enum: ['green', 'red', 'not-run', 'incomplete'] },
    coverage_checked: { type: 'boolean' },   // the --cases mechanical check ran; a green without it is demoted
    runs: { type: 'integer' },
    seconds: { type: 'array', items: { type: 'number' } },
    green_specs: { type: 'array', items: { type: 'string' } },
    failures: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['spec', 'signature'],
        properties: { spec: { type: 'string' }, signature: { type: 'string' }, case_ids: { type: 'array', items: { type: 'string' } } },
      },
    },
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
const WRITE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['written'], properties: { written: { type: 'boolean' }, detail: { type: 'string' } },
}

// ---- outcome recording — one row per input case, one writer at close --------
// OUTCOMES, NOT STATUSES: delivered | defect-found | blocked | un-automatable |
// needs-execution | infra-stalled | not-started, plus the in-flight markers
// (`built`, `reviewed`) and `merged-ungated` for a trunk the gate never proved.
const CLIP = 400
const clip = (s) => {
  const t = String(s ?? '')
  return t.length <= CLIP ? t : `${t.slice(0, CLIP)}… [clipped; full text in the unit's receipt under .agents/telemetry/automation/returns/ (legacy _returns/)]`
}
const OUTCOME = {}
for (const c of CASES) OUTCOME[c.id] = { id: c.id, outcome: 'not-started', note: '', findings: [] }
const record = (id, patch) => {
  const p = { ...patch }
  if (typeof p.note === 'string') p.note = clip(p.note)
  OUTCOME[id] = { ...OUTCOME[id], ...p }
}
// One copy of a finding per case, never the same (kind, note, ref) twice — a
// re-review legitimately repeats what it already said.
const addFindings = (ids, list) => {
  for (const f of (Array.isArray(list) ? list : [])) {
    if (!f?.note) continue
    const entry = { kind: f.kind ?? 'note', note: clip(f.note), ...(f.ref ? { ref: f.ref } : {}) }
    const key = `${entry.kind}\u0000${entry.note}\u0000${entry.ref ?? ''}`
    for (const id of ids) {
      const seen = (OUTCOME[id]._findingKeys ??= new Set())
      if (seen.has(key)) continue
      seen.add(key)
      OUTCOME[id].findings.push(entry)
    }
  }
}
const IMPL_STOP = { blocked: 'blocked', 'un-automatable': 'un-automatable', 'needs-execution': 'needs-execution', 'needs-escalation': 'blocked' }

// ---- guards: account ceiling, dead-environment breaker, stalls, budget ------
// The breaker stops admitting units after N identical stops (a dead env). It
// must never fire on an ACCOUNT ceiling — that is a clock, not a batch defect.
let breakerCause = null
let breakerRun = 0
let breakerTripped = false
let quotaHalted = false
const QUOTA_RE = /(session limit|usage limit|rate.?limit|quota|resets? (at|in) )/i
function noteQuotaHalt(why) {
  if (quotaHalted) return
  quotaHalted = true
  log(`ACCOUNT CEILING reached — halting admission (not a batch failure): ${why}. ` +
      'Re-invoke with the same args plus resumeFromRunId AND quotaResume: true once the limit resets.')
}
function breakerCount(cause, why = '') {
  if (QUOTA_RE.test(why)) { if (!QUOTA_RESUME) noteQuotaHalt(why.slice(0, 160)); return }
  if (cause === breakerCause) breakerRun++
  else { breakerCause = cause; breakerRun = 1 }
  if (!breakerTripped && breakerRun >= BREAKER) {
    breakerTripped = true
    log(`circuit breaker TRIPPED — ${breakerRun} consecutive '${cause}' stops; remaining units stay not-started` +
      (cause === 'agent-died' ? ' (agents dying without a return is also what an account ceiling looks like — check the last transcript first)' : ''))
  }
}
// Stall-retry exhaustion THROWS out of agent(); a stall says nothing about the
// case, so it gets its own outcome and feeds the breaker as an environment fact.
const isStall = (e) => /stall/i.test(String(e?.message ?? e))
const stallNote = (where, e) =>
  `harness stall during ${where}: ${String(e?.message ?? e).slice(0, 140)} — the model stream stopped, nothing was learned ` +
  'about the case; fix the environment before re-entering, and check the unit branch for checkpoint commits first'
function admitUnit(unit, where) {
  const ids = unit.map((c) => c.id)
  if (quotaHalted) { ids.forEach((id) => record(id, { note: `account ceiling — admission halted before ${where}` })); log(`${label(unit)} not started — account ceiling`); return false }
  if (breakerTripped) { ids.forEach((id) => record(id, { note: `circuit breaker: ${breakerRun} consecutive '${breakerCause}' stops` })); log(`${label(unit)} not started — circuit breaker (${breakerCause})`); return false }
  if (budget.total && budget.remaining() < RESERVE) { ids.forEach((id) => record(id, { note: 'token budget reserve reached' })); log(`${label(unit)} not started — budget reserve reached`); return false }
  return true
}

// ---- triage: the router ----------------------------------------------------
const ROUTES = new Map()
const MQ_EVIDENCE = new Map()
const routeKey = (ids) => [...ids].sort().join('+')
let DEFAULT_ROUTE = null      // null = triage died, nothing runs
let SIZING_PRESENT = null
const routeOf = (unit) => ROUTES.get(routeKey(unit.map((c) => c.id))) ?? DEFAULT_ROUTE

async function runTriage() {
  const t = await agent(
    card(`triage — batch ${SLUG}`, [
      'A READ-ONLY routing decision: no git, no browser, no writes of any kind',
      'Read `.agents/testing.md` § Execution provider — WHO executes cases: \'manual-qa\' (that factory co-installs and owns live execution) or \'self\'. A missing file or section means \'self\'. Return the provider you read',
      'Resolve base_url — the live target for test-runner dispatches — from `.agents/testing.md` § Base URL mapping via `.agents/profile.md` § Environment & access or the env files it names; return null if you cannot resolve a real URL, never guess',
      `Check whether the intake sizing pass ran for this scope: \`.agents/estimation/${SLUG}-verdicts.json\` (or a scored verdicts file naming this batch under \`.agents/estimation/\`) — return sizing_present accordingly; do not run the pass yourself`,
      "Route each unit below: provider 'self' -> route EVERY unit 'combined' (the build's first green run against the real system IS the case's first execution). Provider 'manual-qa' -> 'manual-qa-verified' ONLY when EVERY case in the unit has a manual-qa run record with verdict PASS (`reports/RUN-*.md` with the case id showing Pass in its Results table; run age does not matter; a FAIL/flaky/blocked run never qualifies) AND its authored case file exists (commonly `tasks/<suite>/<ID>_*.md`) — list those paths in evidence[] (each case file + the run report; the `.agents/manual-qa/` KB dir once). Anything less — no run, no case file, a non-PASS verdict, your own doubt — routes 'needs-execution'. NEVER route a manual-qa project 'combined': self-execution against the seeded policy is the one wrong answer",
      `Units:\n${UNITS.map((unit) => `  - ${unit.map((c) => `${c.id}${c.title ? ` (${quote(c.title, 80)})` : ''}`).join(' + ')} — snapshots: ${unit.map((c) => SRC(c.id)).join(' , ')}`).join('\n')}`,
      'Return ONE entry per unit with ids EXACTLY as listed — a unit shown as "A + B" is ONE entry with ids ["A","B"], never two entries',
    ]),
    { label: 'triage', phase: 'Triage', agentType: TYPES.implementer, model: A.triageModel ?? 'haiku', effort: 'low', schema: TRIAGE_SCHEMA }
  )
  if (!t) return null
  SIZING_PRESENT = t.sizing_present === true
  if (!BASE_URL && t.base_url) BASE_URL = quote(t.base_url, 200)
  // Reassemble BY CASE COVERAGE: a triage that returns a cluster as per-case rows
  // still routes it when every member voted the same route; an id naming no
  // case does nothing; partial or disagreeing coverage stays on the default.
  const unitOf = new Map()
  for (const unit of UNITS) { const k = routeKey(unit.map((c) => c.id)); for (const c of unit) unitOf.set(c.id, k) }
  const votes = new Map()
  const evid = new Map()
  let foreign = 0
  for (const r of t.units ?? []) {
    if (!Array.isArray(r.ids)) continue
    for (const id of r.ids) {
      const k = unitOf.get(id)
      if (!k) { foreign++; continue }
      if (!votes.has(k)) votes.set(k, new Map())
      votes.get(k).set(id, r.route)
      if (r.route === 'manual-qa-verified') evid.set(k, [...new Set([...(evid.get(k) ?? []), ...(r.evidence ?? [])])].slice(0, 12))
    }
  }
  for (const unit of UNITS) {
    const ids = unit.map((c) => c.id)
    const k = routeKey(ids)
    const v = votes.get(k)
    if (!v || v.size !== ids.length) continue          // partial coverage -> provider default
    const routes = new Set(v.values())
    if (routes.size !== 1) continue                    // members disagree -> provider default
    const route = routes.values().next().value
    ROUTES.set(k, route)
    if (route === 'manual-qa-verified') MQ_EVIDENCE.set(k, evid.get(k) ?? [])
  }
  if (foreign) log(`triage returned ${foreign} id(s) naming no case in this batch — ignored`)
  const counts = {}
  for (const unit of UNITS) { const r = ROUTES.get(routeKey(unit.map((c) => c.id))) ?? (t.provider === 'manual-qa' ? 'needs-execution' : 'combined'); counts[r] = (counts[r] ?? 0) + 1 }
  log(`triage: provider=${t.provider}, base_url=${BASE_URL ?? 'unresolved'} — ${Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ')}`)
  return t
}

// ---- execution: manual-qa's test-runner, per case (their contract, verbatim) --
const parseRunnerReturn = (raw) => {
  if (raw && typeof raw === 'object') return raw.result ? raw : null
  const m = [...String(raw ?? '').matchAll(/```json\s*([\s\S]*?)```/g)].pop()
  if (!m) return null
  try { const j = JSON.parse(m[1]); return j?.result ? j : null } catch { return null }
}
const RUNNER_GONE_NOTE =
  "manual-qa's test-runner could not be dispatched on this host — the seeded policy says manual-qa executes cases, so NOTHING was run " +
  '(self-execution against the policy is never the fallback). Run the manual-qa suite over this case (their test-run-lead), then re-run the batch.'
let runnerGone = false

async function runExecution(unit) {
  const passed = []
  const failed = []
  for (const c of unit) {
    if (quotaHalted || breakerTripped) { record(c.id, { note: `${quotaHalted ? 'account ceiling' : 'circuit breaker'} — halted before execution` }); continue }
    if (runnerGone) { record(c.id, { outcome: 'needs-execution', note: RUNNER_GONE_NOTE }); continue }
    if (!BASE_URL) { record(c.id, { outcome: 'needs-execution', note: 'no base URL resolvable (args.baseUrl / .agents/testing.md § Base URL mapping) — the test-runner dispatch cannot be formed; run the manual-qa suite and re-run the batch' }); continue }
    let raw = null
    try {
      raw = await agent(`Execute the test case at ${SRC(c.id)} against base_url=${BASE_URL}`, { label: `execute:${c.id}`, phase: 'Execution', agentType: TYPES.runner })
    } catch (e) {
      if (isStall(e)) { record(c.id, { outcome: 'infra-stalled', note: stallNote('execution', e) }); breakerCount('agent-died', String(e?.message ?? e)); continue }
      runnerGone = true   // a throw at spawn is an unknown agent type — every later runner dispatch would refuse identically
      record(c.id, { outcome: 'needs-execution', note: RUNNER_GONE_NOTE })
      continue
    }
    const v = parseRunnerReturn(raw)
    if (!v) { record(c.id, { outcome: 'needs-execution', note: raw == null ? `test-runner died without a return — ${RUNNER_GONE_NOTE}` : 'test-runner returned no parseable trailing json verdict — run the manual-qa suite for this case and re-enter' }); continue }
    if (v.result === 'PASS') {
      passed.push({ id: c.id, evidence: `${c.id}: PASS ${v.steps_completed ?? '?'}/${v.steps_total ?? '?'} steps${v.screenshot ? `, screenshot ${quote(v.screenshot, 160)}` : ''}${v.duration_seconds ? `, ${v.duration_seconds}s` : ''} (manual-qa test-runner, this batch)` })
    } else if (v.result === 'FAIL') {
      failed.push({ id: c.id, step: v.failure_step ?? '?', why: quote(v.failure_reason ?? v.notes, 240), screenshot: v.screenshot ? quote(v.screenshot, 160) : null })
    } else if (v.result === 'BLOCKED') {
      record(c.id, { outcome: 'blocked', note: `manual-qa test-runner BLOCKED: ${quote(v.failure_reason ?? v.notes, 200) || 'no reason returned'} — clear the blocker and re-enter` })
    } else {
      record(c.id, { outcome: 'needs-execution', note: `test-runner returned unrecognized verdict '${quote(String(v.result), 40)}' — run the manual-qa suite for this case and re-enter` })
    }
  }
  // FAIL before any build: the live product contradicts the case — file and walk
  // away; the case is not automated until the product is fixed.
  if (failed.length) {
    const fids = failed.map((f) => f.id)
    let filed = null
    try {
      filed = await agent(
        card(`defect filing — ${fids.join(', ')}`, [
          `manual-qa's test-runner executed these against the live product and FAILED:\n${failed.map((f) => `  - ${f.id}: step ${quote(String(f.step), 20)}: ${f.why}${f.screenshot ? ` (screenshot: ${f.screenshot})` : ''}`).join('\n')}`,
          `File ONE defect per case per your defect-filing discipline (${CONTRACT.replace('test-automation-workflow', 'test-automation-implementation')}/defect-filing.md — the pristine-repro gate applies before anything is filed). File and walk away: you do not fix the product, you do not automate the failing case, and you do not re-litigate the runner's verdict — a repro that does NOT reproduce goes in the filed[] note instead of a ticket`,
          `Return: unit_ids EXACTLY [${fids.join(', ')}]; one filed[] entry per case with the tracker ref (null if filing failed — say why in its note)`,
        ]),
        { label: `defects:${fids.join('+')}`, phase: 'Execution', agentType: TYPES.implementer, ...WORKER, schema: DEFECT_SCHEMA }
      )
    } catch (e) {
      log(`defect-filing dispatch ${isStall(e) ? 'infra-stalled' : 'threw'} — FAIL cases keep defect-found, defects must be filed by hand`)
    }
    if (filed) addFindings(fids, filed.findings)
    const refOf = new Map((filed?.filed ?? []).map((f) => [f.case_id, f]))
    for (const f of failed) {
      const r = refOf.get(f.id)
      record(f.id, { outcome: 'defect-found', note: `manual-qa test-runner FAILED at step ${f.step}: ${f.why} — ${r?.ref ? `defect ${r.ref} filed` : `defect NOT filed (${quote(r?.note, 120) || 'filing dispatch produced no ref'}) — file by hand from the runner's evidence`}; not automated until the product is fixed` })
      addFindings([f.id], [{ kind: 'defect', note: `test-runner FAIL at step ${f.step}: ${f.why}`, ref: r?.ref ?? null }])
    }
  }
  return passed
}

// ---- build: one engineer dispatch, case -> code -----------------------------
async function runBuild(members, evidence, route) {
  const ids = members.map((c) => c.id)
  if (!admitUnit(members, 'build')) return null
  const provenance = route === 'combined'
    ? 'the FIRST GREEN RUN of your test against the real system IS the case\'s first execution — no separate "execute the case first" ritual; a live browser is an INVESTIGATION tool at your discretion, targeted probes of minutes, never a full pre-automation walkthrough'
    : `this unit was already executed live by manual-qa — do NOT re-execute a case end-to-end in a browser (a targeted probe for a locator or a wait is fine; a full walkthrough re-buys what the evidence already paid for). Evidence to build from: ${evidence.length ? evidence.join(' ; ') : '(none listed — treat as thin, probe live for what is missing)'} plus the .agents/manual-qa/ KB; cite the manual-qa run as the unit's execution provenance in your PR and notes${route === 'manual-qa-verified' ? '. If the evidence does not hold for a case (no PASS verdict, case file missing, contradicts the snapshot), return status needs-execution and STOP — under the manual-qa provider you never execute the case yourself' : ''}`
  const b = await agent(
    card(`builder — ${members.map((c) => `${c.id}${c.title ? ` (${quote(c.title, 120)})` : ''}`).join(', ')}`, [
      `Case source, read in full first — THE CASE IS THE SOURCE OF TRUTH and you never edit it: ${ids.map((id) => SRC(id)).join(' , ')} (if a snapshot is missing, fetch via the project's TMS adapter, .agents/test-automation.yaml, and note the gap)`,
      `Route ${route}: ${provenance}`,
      `Tree: yours alone, nothing else runs. Ensure the batch trunk first: \`git rev-parse --verify ${TRUNK}\` — check it out if it exists anywhere; if it exists NOWHERE, \`git checkout -B ${TRUNK} ${BASE}\` (never -B an existing trunk — that discards merged units) and push it ONLY where the project has a remote (\`.agents/profile.md\` § Automation PR policy / \`git remote -v\`). THEN cut your feature branch FROM ${TRUNK} — it already carries every unit that finished before you. Stay on your branch, stage ONLY your own paths (never \`-A\`/\`.\`), leave the tree on your branch when you finish`,
      members.length > 1 ? `CLUSTER unit: ${members.length} similar cases on ONE branch. ONE parameterized spec (a data row per case, each row asserting its OWN expected values, its case id on its row so it fails by itself) ONLY where the cases are true variants of one flow — never flatten distinct expected values into a shared assertion; cases that merely share a surface get SEPARATE specs, shared page objects and fixtures are reused` : null,
      `Merge gate N = ${GATE_N}: STABILISE IT YOURSELF — ${GATE_N} CONSECUTIVE green runs in clean processes before you hand off, a flake is yours to remove; ≤ 2 reruns on the SAME root cause, distinct causes each get their own budget`,
      'What live probing teaches you goes BACK into the surface cache `.agents/automation/surface/<feature>.md`, committed on your branch with the code',
      `Land per \`.agents/profile.md\` § Automation PR policy: where the project uses PRs, open yours against ${TRUNK}, NOT against ${BASE} (one PR takes the trunk to ${BASE} after the gate); with no PR mechanism leave the branch ready for the merge step`,
      CHECKPOINT_RULE,
      FOREGROUND_RULE,
      'An ACCOUNT/USAGE LIMIT (not a problem with the app or the case): say exactly that in notes — it stops the batch cleanly',
      `Return: unit_ids EXACTLY [${ids.join(', ')}] (it keys telemetry attribution — never add, drop or reformat ids); status, branch, pr, reruns + rerun_causes (one root-cause label per rerun — the cap is per cause); coverage mirroring the comment blocks in your specs — full=true only when every step of every case is asserted, else excluded[] {step "<case-id>/<step>", category, referent, note} with the CLOSED categories (${EXCLUSION_CATEGORIES.join(' | ')}) — you cannot MINT un-automatable beyond what the intake screening judged, request it with status needs-escalation naming the step and why; expected_red[] for every test left red on a ticketed PRODUCT defect (the case's assertion on that step, failing; never weakened): spec, test_id, ticket, why, and in a multi-case unit the case_ids it holds — the gate runs those without counting them and the case is reported defect-found, an undeclared red blocks every healthy case beside it`,
    ]),
    { label: `build${route === 'combined' ? '' : ':mq'}:${label(members)}`, phase: 'Build', agentType: TYPES.implementer, ...WORKER, schema: BUILD_SCHEMA }
  )
  if (!b) {
    breakerCount('agent-died', '')
    ids.forEach((id) => record(id, { outcome: 'not-started', note: 'build agent died without a return — a harness death, nothing was learned about the case (it re-enters the next batch untouched); several in a row: suspect the account ceiling before the environment' }))
    return null
  }
  addFindings(ids, b.findings)
  if (b.status !== 'built') {
    if (QUOTA_RE.test(b.notes ?? '')) {
      if (!QUOTA_RESUME) noteQuotaHalt((b.notes ?? '').slice(0, 160))
      ids.forEach((id) => record(id, { outcome: 'not-started', note: 'account ceiling — nothing was learned about the case; it re-enters the next batch untouched' }))
      return null
    }
    breakerCount('blocked', b.notes ?? '')
    const oc = IMPL_STOP[b.status] ?? 'blocked'
    ids.forEach((id) => record(id, {
      outcome: oc,
      note: (b.notes || b.status) + (b.status === 'un-automatable'
        ? ' — an ESCALATION: the intake screening did not sanction this; the lead confirms against the automation-scoping verdicts before accepting'
        : b.status === 'needs-execution' ? ' — run the manual-qa suite over this case, then re-run the batch' : ''),
    }))
    log(`${label(members)} → ${oc}: ${clip(b.notes || b.status)}`)
    return null
  }
  breakerCause = null; breakerRun = 0   // a completed build proves the environment is alive
  return b
}

// ---- review: a fresh engineer, the case walked against the diff + one run -----
function review(u, impl, fixNote) {
  const ids = u.members.map((m) => m.id)
  return agent(
    card(`reviewer — ${ids.join(', ')}`, [
      `Unit ${ids.join(', ')} on branch ${impl.branch}${impl.pr ? ` (PR ${impl.pr})` : ''}; the tree is on that branch — read the diff via \`git diff ${TRUNK}...${impl.branch}\` and work from where the tree stands, do NOT switch branches (the merge step moves it)`,
      `Case source: ${ids.map((id) => SRC(id)).join(' , ')} — read each in full before the walk`,
      `Contract: ${CONTRACT}/reviewer-contract.md plus your code-review library (load it if it is not in your context). You are engineer-TYPED by design: independence is the clean context plus that contract`,
      'Run the unit\'s spec ONCE in a clean process (line reporter, tail the failures) and the named covered-elsewhere test when you touch that referent — you fix nothing; YOU EDIT NOTHING on the branch, findings go back through blocking[]/findings[]',
      `Exclusion budget: \`.agents/estimation/${SLUG}-verdicts.json\` where present — an un-automatable the intake screening did not see is blocking; the engineer may REQUEST it, never mint it`,
      ids.length > 1 ? 'Parameterized spec: verify per ROW — every case id maps to a data-table row whose DISTINCT expected values are asserted; a flattened shared assertion is CHANGES_REQUESTED' : null,
      fixNote
        ? `RE-REVIEW after a fix round. Prior blocking findings:\n${fixNote}\n  For EVERY item you still block on, put a blocking_detail[] entry with the status that is TRUE OF THE DIFF, not of your patience: \`unaddressed\` — no serious attempt is visible (nothing in the diff touches the code it names, or the change is cosmetic; forgotten and half-done both count — this sends it back, which is the point); \`persists\` — a genuine attempt against the right code and the problem is still there (say in notes what was tried); \`external\` — not resolvable on this branch at all (a missing framework primitive, a product defect, a broken environment). Scope each entry with case_ids[] unless it binds the whole unit. Reserve \`persists\` for a real attempt that really failed; a NEW item you raise for the first time needs no status`
        : null,
      FOREGROUND_RULE,
      `Return: unit_ids EXACTLY [${ids.join(', ')}]; verdict; blocking[] — what must change before this can land; coverage as you VERIFIED it against the code, not the builder's declaration echoed back; everything else worth saying in findings[]`,
    ]),
    { label: `review:${ids.join('+')}`, phase: 'Build', agentType: TYPES.reviewer, ...REV, schema: REVIEW_SCHEMA }
  )
}

/**
 * Should the fix loop go round again?
 *
 * Keep going while ANY blocking item is `unaddressed` — work nobody attempted
 * is not a reason to stop, it is the reason to continue. Stop only when every
 * remaining blocker is one the same actor cannot move: attempted and still
 * failing (`persists`), or not resolvable on this branch (`external`).
 * Duplicated in batch-campaign.workflow.mjs (no imports in the sandbox); the
 * loop-contract test keeps the two copies identical.
 */
function loopVerdict(review) {
  const detail = review?.blocking_detail ?? []
  if (!detail.length) return { go: true, why: null, unclassified: true }
  const unaddressed = detail.filter((d) => d.status === 'unaddressed')
  if (unaddressed.length) return { go: true, why: null, unaddressed: unaddressed.map((d) => d.item) }
  const external = detail.filter((d) => d.status === 'external').map((d) => d.item)
  const persists = detail.filter((d) => d.status === 'persists').map((d) => d.item)
  // `stuck` names the cases the survivors bind, when every survivor is scoped —
  // the report carries it so the lead can split the unit by hand.
  const scoped = detail.every((d) => Array.isArray(d.case_ids) && d.case_ids.length > 0)
  return {
    go: false,
    stuck: scoped ? [...new Set(detail.flatMap((d) => d.case_ids))] : null,
    why: external.length
      ? `not resolvable on this branch: ${external.join('; ').slice(0, 160)}`
      : `attempted and still failing: ${persists.join('; ').slice(0, 160)}`,
  }
}

const EXPECTED_RED = []      // tests the batch KNOWS are red: ticketed product defects, left failing
const merged = []            // [{ ids, branch, pr }] — units landed on the trunk
const parked = []            // [{ ids, branch, why }] — reviewed but not merged

async function buildUnit(u, impl) {
  const ids = u.members.map((m) => m.id)
  const ul = ids.join('+')
  addFindings(ids, impl.findings)
  // The R2 cap is per ROOT CAUSE, not total; without rerun_causes the total is
  // the fallback.
  const causeCounts = (impl.rerun_causes ?? []).reduce((m, c) => { m[c] = (m[c] ?? 0) + 1; return m }, {})
  const worstCause = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0]
  if (worstCause ? worstCause[1] > 2 : impl.reruns > 2) {
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `R2 cap exceeded (${worstCause ? `${worstCause[1]} reruns on "${worstCause[0]}"` : `${impl.reruns} reruns, causes not reported`}) — classify architectural vs case-drift vs product-change` }))
    return null
  }
  // Red-by-design declarations arrive from the build AND from any fix round;
  // attribution is per entry (case_ids), else the whole unit.
  const noteRed = (list) => {
    const reds = Array.isArray(list) ? list : []
    if (!reds.length) return
    for (const r of reds) EXPECTED_RED.push({ ...r, unit: ul })
    log(`${ul}: ${reds.length} test(s) red by design — ${reds.map((r) => r.ticket).join(', ')}`)
    for (const id of ids) {
      const mine = reds.filter((r) => !Array.isArray(r.case_ids) || r.case_ids.length === 0 || r.case_ids.includes(id))
      if (mine.length) OUTCOME[id]._expectedRed = [...(OUTCOME[id]._expectedRed ?? []), ...mine]
    }
  }
  noteRed(impl.expected_red)
  ids.forEach((id) => record(id, { outcome: 'built', branch: impl.branch, pr: impl.pr ?? undefined, coverage: impl.coverage }))

  let r = await review(u, impl, null)
  if (r) addFindings(ids, r.findings)

  // The loop runs until the reviewer APPROVES. It ends early only when going
  // round again cannot help (loopVerdict), at the runaway backstop, or at the
  // budget floor — a real stop is `blocked` with the reason, for the lead.
  let round = 0
  let stopped = null
  let stuck = null
  let unclassified = 0
  while (r && r.verdict === 'CHANGES_REQUESTED' && (r.blocking ?? []).length) {
    if (round > 0) {
      const v = loopVerdict(r)
      if (!v.go) { stopped = v.why; stuck = v.stuck; break }
      unclassified = v.unclassified ? unclassified + 1 : 0
      if (unclassified >= 2) { stopped = 'reviewer left surviving blockers unclassified twice — cannot tell unaddressed from unfixable, so the loop cannot judge whether another round would help'; break }
    }
    if (round >= FIX_ROUNDS) { stopped = `fix-round backstop (${FIX_ROUNDS}) reached — review/fix pair is not converging`; break }
    if (budget.total && budget.remaining() < RESERVE) { stopped = 'budget floor reached mid-fix'; break }
    round++
    const prior = r.blocking.map((b) => quote(b)).join('\n- ')
    const skipped = (r.blocking_detail ?? []).filter((d) => d.status === 'unaddressed').map((d) => quote(d.item))
    const fix = await agent(
      card(`builder — fix round ${round} for ${ids.join(', ')}`, [
        `Branch ${impl.branch} in the project's ONE working tree — yours alone, no worktree; stay on this branch, stage ONLY your own paths (never \`-A\`/\`.\`), leave the tree on it`,
        'Load your receiving-code-review library if it is not in your context',
        `Address EACH blocking finding (verify against the code first), add the regression test that would have caught it, re-run the affected spec green, commit — and update the PR where the project uses one (\`.agents/profile.md\` § Automation PR policy):\n- ${prior}`,
        skipped.length
          ? `THE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND — no attempt was visible in the diff:\n- ${skipped.join('\n- ')}\n  Do them; if one genuinely cannot be done on this branch, say so in notes with the reason — an unexplained gap reads as another skip and costs the unit another round`
          : null,
        FOREGROUND_RULE,
        `Return: unit_ids EXACTLY [${ids.join(', ')}]; coverage as it stands after your fixes (a fix that closes an exclusion updates the comment block AND the return); expected_red[] for any test left red on a ticket`,
      ]),
      { label: `fix:${ul}:${round}`, phase: 'Build', agentType: TYPES.implementer, ...WORKER, schema: IMPL_SCHEMA }
    )
    if (fix) { addFindings(ids, fix.findings); noteRed(fix.expected_red) }
    if (!fix || fix.status !== 'built') { r = null; break }
    r = await review(u, impl, prior)
    if (r) addFindings(ids, r.findings)
  }

  if (!r) { ids.forEach((id) => record(id, { outcome: 'blocked', note: `review/fix round ${round} failed` })); return null }
  if (r.verdict !== 'APPROVED') {
    const why = stopped ?? 'review CHANGES_REQUESTED'
    const split = stuck && stuck.length && stuck.length < ids.length ? ` — stuck cases: ${stuck.join(', ')}; the rest of the unit is sound, split it by hand if you want it landed (playbook § The loop)` : ''
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `${why} after ${round} fix round(s): ${(r.blocking ?? []).join('; ').slice(0, 200)}${split}` }))
    return null
  }
  ids.forEach((id) => record(id, { outcome: 'reviewed', branch: impl.branch, pr: impl.pr ?? undefined, coverage: r.coverage ?? impl.coverage }))

  // ---- merge into the trunk the moment it is approved, and return the tree ---
  // No budget guard: the unit is built and reviewed; merging is the cheapest
  // agent in the run and the one that makes everything before it count.
  const landed = await agent(
    card(`merge — ${ids.join(', ')} into ${TRUNK}`, [
      'You own the tree; nothing else runs',
      `\`git checkout ${TRUNK}\` (\`git pull --ff-only\` if it tracks a remote), then \`git merge --no-ff ${impl.branch} -m "merge ${ids.join(', ')} into ${TRUNK}"\``,
      `On a conflict classify EVERY conflicted file before touching anything. MECHANICAL (both sides added distinct imports/exports, distinct methods or locators, independent files or spec blocks): keep BOTH sides, stage, conclude. SEMANTIC (the same function/method/locator edited on both sides, assertion or expected-value differences, fixture signature drift, anything not a pure union): \`git merge --abort\`, then LAND THE UNIT'S KNOWLEDGE ANYWAY (\`git checkout ${impl.branch} -- .agents/memory/\`, commit by path as \`docs(memory): ${ids.join(', ')} — learnings from a parked unit\`, skip if unchanged), report merged=false with the conflict files and a one-line reason, and STOP`,
      'Never delete, `rm` or `checkout --ours/--theirs` a file away to make a merge pass; never edit test logic, assertions or expected values while resolving; never run the suite (the gate does)',
      `Push \`${TRUNK}\` ONLY where the project has a remote (\`.agents/profile.md\` § Automation PR policy / \`git remote -v\`) — the gate reads the trunk from there, so an unpushed merge is invisible; say so in notes if the push fails`,
      `LEAVE THE TREE ON ${TRUNK} — the next unit branches from it`,
      `Return: unit_ids EXACTLY [${ids.join(', ')}]; merged, head_sha, conflict_files, notes`,
    ]),
    { label: `merge:${ul}`, phase: 'Build', agentType: TYPES.implementer, ...WORKER, model: A.mergeModel ?? A.workerModel ?? 'haiku', effort: A.workerEffort ?? 'low', schema: MERGE_SCHEMA }
  )
  if (!landed || landed.merged !== true) {
    const why = landed ? `${landed.notes || 'semantic conflict'}${landed.conflict_files?.length ? ` (${landed.conflict_files.slice(0, 4).join(', ')})` : ''}` : 'merge agent failed'
    parked.push({ ids, branch: impl.branch, why })
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `reviewed but NOT merged — ${why}; resolve on the case branch and re-enter` }))
    log(`${ul} reviewed but parked: ${why}`)
    return null
  }
  merged.push({ ids, branch: impl.branch, pr: impl.pr ?? null })
  addFindings(ids, landed.findings)
  log(`${ul} merged into ${TRUNK} (${String(landed.head_sha).slice(0, 8)})`)
  return impl.branch
}

// ---- headroom: the runtime caps a workflow at 1000 agents for its lifetime ---
{
  const perUnit = 3 + FIX_ROUNDS + (FIX_ROUNDS + 1)   // build + merge + defect-filer, plus fixes and reviews
  const worst = UNITS.length * perUnit + CASES.length + 3   // + one runner per case, + triage/gate/reporter
  if (worst > 900) log(`HEADROOM: worst case ~${worst} agents for ${UNITS.length} unit(s) — the runtime's lifetime cap is 1000. Split it into smaller batches (or lower fixRounds) before this becomes a rescue.`)
}

// ---- the unit loop: strictly one at a time ---------------------------------
// ONE TREE, ONE MASTER: a plain `for … await`, no lanes, no fan-out. Throughput
// comes from clustering, not concurrency.
phase('Triage')
let TRI = null
try { TRI = await runTriage() } catch (e) { log(`triage threw (${String(e?.message ?? e).slice(0, 120)}) — no routes exist`) }
if (TRI) DEFAULT_ROUTE = TRI.provider === 'manual-qa' ? 'needs-execution' : 'combined'
else {
  // A dead triage stops the batch HONESTLY: the provider policy was never read
  // and there is no safe default route.
  for (const c of CASES) record(c.id, { note: 'triage died — the execution-provider policy was never read and no unit was routed; every case stays not-started, re-run the batch' })
  log('triage produced no routes — every case stays not-started')
}

for (const unit of (DEFAULT_ROUTE ? UNITS : [])) {
  const route = routeOf(unit)
  let members = unit
  let evidence = null
  if (route === 'needs-execution') {
    phase('Execution')
    if (!admitUnit(unit, 'execution')) continue
    let passed = []
    try {
      passed = await runExecution(unit)
    } catch (e) {
      const stalled = isStall(e)
      unit.forEach((c) => record(c.id, stalled ? { outcome: 'infra-stalled', note: stallNote('execution', e) } : { outcome: 'needs-execution', note: `execution dispatch threw: ${String(e?.message ?? e).slice(0, 160)}` }))
      breakerCount('agent-died', String(e?.message ?? e))
      log(`${label(unit)} ${stalled ? 'infra-stalled' : 'threw'} during execution — continuing with the next unit`)
      continue
    }
    if (!passed.length) { log(`${label(unit)}: no case passed execution — nothing to build`); continue }
    members = unit.filter((c) => passed.some((p) => p.id === c.id))
    evidence = passed.map((p) => p.evidence)
  } else if (route === 'manual-qa-verified') {
    evidence = MQ_EVIDENCE.get(routeKey(unit.map((c) => c.id))) ?? []
  }
  // A thrown build costs its own unit and nothing else — the trunk is where it
  // was, so the next unit starts from a known state.
  try {
    phase('Build')
    const impl = await runBuild(members, evidence, route)
    if (!impl) continue
    await buildUnit({ members }, impl)
  } catch (e) {
    const INFLIGHT = new Set(['not-started', 'built', 'reviewed'])
    const ids = members.map((m) => m.id).filter((id) => INFLIGHT.has(OUTCOME[id]?.outcome))
    if (isStall(e)) {
      ids.forEach((id) => record(id, { outcome: 'infra-stalled', note: stallNote('build', e) }))
      breakerCount('agent-died', String(e?.message ?? e))
      log(`${ids.join('+')} infra-stalled mid-build — the trunk is where it was; continuing with the next unit`)
    } else {
      ids.forEach((id) => record(id, { outcome: 'blocked', note: `build failed: ${String(e?.message ?? e).slice(0, 160)}` }))
      log(`${ids.join('+')} build threw — continuing with the next unit`)
    }
  }
}
// There is no integrate PHASE: each unit merged into the trunk the moment its
// review approved. batch-integrate.workflow.mjs survives as a REPAIR tool.

// ---- the hardening gate: once, on the trunk ---------------------------------
let gate = null
const gateBranch = TRUNK
if (!SKIP_GATE && merged.length) {
  phase('Gate')
  const mergedIds = merged.flatMap((r) => r.ids)
  try {
    gate = await agent(
      card(`gate — Hardening gate for batch ${SLUG}`, [
        `Branch ${gateBranch} (the batch trunk — every approved unit is merged into it), base ${BASE}. You built none of it and you fix nothing: you PROVE it and report exactly what you saw`,
        `Run the batch's new/changed specs TOGETHER, ${GATE_N} CONSECUTIVE deterministic green runs, each a clean process against the live env — a red anywhere ENDS the attempt (N consecutive is the contract, not best-of-N). THEN, ONCE, run the specs this batch could have BROKEN: scope the blast radius by what CHANGED in the non-spec diff (\`git diff ${BASE}...${gateBranch}\`) hunk by hunk — additive hunks have no blast radius, a modified symbol names the specs that reach it`,
        `Mechanics: \`scripts/gate/gate-case.mjs\`${GATE_CMD ? ` with --cmd '${GATE_CMD}'` : ', resolving the suite command from .agents/testing.md § Run commands'}. The run shape (one run per call, --n 1, timeout: 600000, detached + sleep 300 when a run outlives a call), the blast-radius rules and the failed-vs-never-ran distinction are in ${CONTRACT}/commands.md § Hardening gate — read it before the first call. On the FIRST call pass \`--cases ${mergedIds.join(',')}\`: the MECHANICAL COVERAGE CHECK — a \`coverage-invalid\` verdict is a RED for the batch, report each problem verbatim as a failures[] entry and stop`,
        EXPECTED_RED.length
          ? `RED BY DESIGN — do not count these against the green requirement (run them, report what they did; the N-consecutive-green contract covers only the OTHER specs; if one comes back GREEN say so loudly — the product shipped a fix):\n${EXPECTED_RED.map((r) => `  - ${quote(r.spec, 200)}${r.test_id ? ` :: ${quote(r.test_id, 120)}` : ''} — ticket ${quote(r.ticket, 60)} (${quote(r.why, 200)})`).join('\n')}`
          : null,
        'Do NOT merge anything. Do NOT classify a failure (product defect vs flake vs architectural is the lead\'s call). Do NOT fix. A red goes to the report; the lead may dispatch batch-stabilize',
        FOREGROUND_RULE,
        `Return: unit_ids EXACTLY [${mergedIds.join(', ')}]; verdict green ONLY after ${GATE_N} consecutive green runs; 'incomplete' (not 'not-run') if you are cut off mid-run — runs = the greens already banked, green_specs listed, notes saying exactly where to resume; coverage_checked=true ONLY if the --cases check actually ran under this gate (a recorded \`coverage: ok\` for this branch in gate-runs.jsonl counts on a resume); one failures[] entry per failing spec (spec, signature, case_ids), saying in notes when a spec never RAN (module not found, worker crash, 0ms, collection error) rather than failed; both scopes' sizes in notes; LEAVE THE TREE ON ${gateBranch}`,
      ]),
      { label: `gate:${SLUG}`, phase: 'Gate', agentType: TYPES.gate, ...WORKER, ...(A.gateModel ? { model: A.gateModel } : {}), schema: GATE_SCHEMA }
    )
  } catch (e) {
    log(`gate ${isStall(e) ? 'infra-stalled' : 'threw'} (${String(e?.message ?? e).slice(0, 120)}) — merged units stay merged-ungated; re-run the gate on ${gateBranch}`)
  }
  if (gate) addFindings(mergedIds, gate.findings ?? [])
  if (gate?.verdict === 'green' && gate.coverage_checked !== true) {
    log('gate says green but coverage_checked=false — the mechanical coverage check (--cases) never ran; demoting to incomplete, merged units stay merged-ungated')
    gate = { ...gate, verdict: 'incomplete', notes: `${gate.notes ?? ''} [green demoted: the --cases coverage check never ran — re-run the gate with --cases]`.trim() }
  }
}
// The gate proves the TRUNK, so it speaks for exactly the units on it.
const integratedIds = new Set(merged.flatMap((r) => r.ids))
if (gate?.verdict === 'green') {
  let okCount = 0
  for (const id of integratedIds) {
    const red = OUTCOME[id]._expectedRed
    if (red?.length) {
      // Excluded from the count, so the gate says nothing about it: red by
      // design on a ticket is defect-found, never delivered.
      record(id, { outcome: 'defect-found', note: `red by design pending ${red.map((r) => r.ticket).join(', ')} — the gate ran it but could not count it; merged with the batch, re-enter once the product ships` })
      continue
    }
    record(id, { outcome: 'delivered', gate: { runs: gate.runs, seconds: gate.seconds ?? [] } })
    okCount++
  }
  log(`gate GREEN ${gate.runs}/${GATE_N} — ${okCount} case(s) delivered` + (EXPECTED_RED.length ? `, ${integratedIds.size - okCount} held on ticketed defects` : ''))
} else if (merged.length && (SKIP_GATE || !gate || gate.verdict === 'not-run' || gate.verdict === 'incomplete')) {
  // No verdict is NOT a red: merged units are UNPROVEN, not blocked.
  const cut = gate?.verdict === 'incomplete'
  const banked = cut && gate.runs ? ` — ${gate.runs}/${GATE_N} run(s) already green before it was cut off` : ''
  for (const id of integratedIds) {
    record(id, {
      outcome: 'merged-ungated',
      note: SKIP_GATE
        ? `gate skipped by arg (skipGate) — merged on the trunk but unproven; run the gate on ${gateBranch} before landing`
        : cut
          ? `gate CUT OFF mid-run${banked}; merged on the trunk but unproven — resume the gate on ${gateBranch}, then WRITE THE VERDICT BACK into this report`
          : 'gate never produced a verdict (interrupted or dropped) — merged on the trunk but unproven; re-run the gate',
    })
  }
  log(`gate ${SKIP_GATE ? 'skipped' : cut ? `incomplete${banked}` : 'not-run'} — ${integratedIds.size} merged unit(s) UNPROVEN, not blocked; run the gate on ${gateBranch}`)
} else if (gate) {
  const failedIds = new Set((gate.failures ?? []).flatMap((f) => f.case_ids ?? []))
  for (const id of integratedIds) {
    const why = failedIds.has(id)
      ? `gate red: ${(gate.failures.find((f) => (f.case_ids ?? []).includes(id))?.signature ?? '').slice(0, 200)}`
      : 'gate red for the batch — this spec did not itself fail; the batch is not proven until the red is resolved'
    record(id, { outcome: 'blocked', note: why })
  }
  log('gate red — classify (product defect / flake / architectural), then consider batch-stabilize')
}

// ---- the report — ONE writer, at close --------------------------------------
phase('Report')
const rows = CASES.map((c) => { const { _findingKeys, _expectedRed, ...row } = OUTCOME[c.id]; return row })
const totals = rows.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc }, {})
const qualityFlags = []
if (SIZING_PRESENT === false) qualityFlags.push(`intake sizing/screening pass not run — no .agents/estimation/${SLUG}-verdicts.json: un-automatable screening and the reviewer's exclusion budget were unavailable, and effort fields will be missing from the tokenomics export. Run the pass (automation-scoping § verdict pass) before the next batch.`)
const stalledCount = rows.filter((r) => r.outcome === 'infra-stalled').length
if (stalledCount) qualityFlags.push(`${stalledCount} case(s) infra-stalled — the harness killed their slot mid-flight (the model stream stopped; on a quota-limited provider check throttling before blaming the batch); they re-enter the next batch untouched — check their unit branches for checkpoint commits first`)
const needsExecCount = rows.filter((r) => r.outcome === 'needs-execution').length
if (needsExecCount) qualityFlags.push(`${needsExecCount} case(s) needs-execution — the seeded policy says manual-qa executes cases and no PASS evidence exists for these; run the manual-qa suite over them (their test-run-lead), then re-run the batch. Self-execution is never the fallback.`)
const report = {
  batch: SLUG,
  base: BASE,
  ...(A.workItemRef ? { work_item_ref: String(A.workItemRef) } : {}),
  ...(TRI ? { execution_provider: TRI.provider } : {}),
  integration_branch: merged.length ? gateBranch : null,
  gate: gate ? { verdict: gate.verdict, runs: gate.runs, seconds: gate.seconds ?? [], failures: (gate.failures ?? []).map((f) => ({ ...f, ...(typeof f?.signature === 'string' ? { signature: clip(f.signature) } : {}) })) } : null,
  cases: rows,
  totals,
  quality_flags: qualityFlags,
  quota_halted: quotaHalted,
  expected_red: EXPECTED_RED,
  parked: parked.map((p) => ({ ids: p.ids, branch: p.branch, why: clip(p.why) })),
}

// The only disk write in the whole run; everything else that must survive an
// interruption is already in the journal or in git.
let wrote = null
try {
  wrote = await agent(
    'You are the report writer — the single disk write of this run.\n' +
    `Create the directory ${REPORT_DIR} if needed, then Write TWO files:\n` +
    `1. ${REPORT_DIR}/report.json — EXACTLY this JSON, byte for byte, no edits, no commentary:\n` +
    '`````json\n' + JSON.stringify(report, null, 2) + '\n`````\n' +
    `2. ${REPORT_DIR}/report.md — a readable rendering of the same data: a totals line, a table of case id / outcome / note, coverage per delivered case (full, or the excluded steps with categories and referents), findings grouped by kind, the gate verdict with its timings.\n` +
    'Change NOTHING about the data — you are rendering it, not judging it. ' +
    `If the project commits automation artifacts, commit both — then RETURN THE TREE TO ${gateBranch} (\`git checkout ${gateBranch}\`). Otherwise leave them on disk, touch no branch, and say so.`,
    { label: `report:${SLUG}`, phase: 'Report', agentType: TYPES.reporter, model: A.reporterModel ?? 'haiku', effort: 'low', schema: WRITE_SCHEMA }
  )
} catch (e) {
  log(`report writer threw (${String(e?.message ?? e).slice(0, 120)}) — report_written: false; write ${REPORT_DIR}/report.json from this return by hand`)
}

return {
  ...report,
  report_written: wrote?.written === true,
  report_path: `${REPORT_DIR}/report.json`,
  next: quotaHalted
    ? 'ACCOUNT CEILING — nothing to repair. Re-invoke with the SAME args plus resumeFromRunId AND quotaResume: true once the limit resets; completed units replay from cache.'
    : gate?.verdict === 'green'
      ? `Gate green on ${gateBranch}. LAND IT: one PR from ${gateBranch} to ${BASE} per .agents/profile.md § Automation PR policy` +
        (EXPECTED_RED.length ? ` — declared expected_red tests ride the trunk: either .agents/testing.md § Merge gate allows a declared red on base, or quarantine them behind a declared skip that names the ticket (the case stays defect-found; the marker comes off when the fix ships)` : '') +
        `; then your Mirror step (TMS back-write of automation executions ONLY — manual-qa's live runs are their own record — plus each case's status/coverage note, full | partial with the excluded steps, and the PR link), the close sweep, and replan anything not 'delivered'. Where the tokenomics scope contract is active: work-scope.mjs outcome <ID>=delivered … then work-scope.mjs close.`
      : merged.length && (!gate || gate.verdict === 'not-run' || gate.verdict === 'incomplete')
        ? `${gate?.verdict === 'incomplete' ? `GATE CUT OFF MID-RUN (${gate.runs ?? 0}/${GATE_N} banked)` : 'GATE NEVER RAN'} — ${gateBranch} holds ${merged.length} merged unit(s) that are UNPROVEN, not blocked (merged-ungated). Re-run the gate (re-invoke with resumeFromRunId — completed units replay from cache — or dispatch the gate alone on ${gateBranch}); classify nothing until a verdict exists, and treat this run's own totals as a claim, not evidence. THEN WRITE THE VERDICT BACK INTO ${REPORT_DIR}/report.json — gate.verdict, gate.runs, gate.seconds and each case's real outcome ('delivered' on green, 'defect-found' for a declared red): a gate re-run green but never written back scores as ZERO delivered.`
        : `${stalledCount ? `${stalledCount} case(s) infra-stalled — an ENVIRONMENT failure, not a case failure: fix the provider, check their unit branches for checkpoint commits, then re-enter them. ` : ''}${needsExecCount ? `${needsExecCount} case(s) needs-execution — run the manual-qa suite over them, then re-run the batch. ` : ''}Classify each blocked case (product defect → tracker; flake or test-code bug → batch-stabilize on ${gateBranch}; architectural → § Framework), then replan the remainder. ${gateBranch} is NOT landed — nothing reaches ${BASE} until it is green. Record classifications as they land (work-scope.mjs outcome <ID>=blocked, where the scope contract is active).`,
}
