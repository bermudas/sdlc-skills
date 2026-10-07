# Test Automation Team — shared conventions

This team **compiles ready-made test cases into merged, honest automated
tests** — universal across any framework, any test type (UI, API, mobile,
performance, …), and any TMS. Input: cases from the TMS or from
`tasks/<suite>/TC-*.md`, plus execution evidence when it exists. Writing cases
and executing them live belong to the manual-qa factory when it is installed.
These are team-wide defaults — scout refines them per project in `AGENTS.md`
and `.agents/`, which always win over this file.

## Team shape

- **`test-automation-lead` (Tal)** is the orchestrator: runs the batch
  pipeline, routes each unit, owns test-framework architecture and the
  automation merge gate. **The user launches Tal directly**
  (`claude --agent test-automation-lead`) — he is a top-level orchestrator,
  not a subagent. If the project isn't seeded he self-orients by running
  `seeding-automation-project` himself; a deliberate scout run stays the
  thorough path.
- **`scout` (Kit)** seeds the project first: framework, TMS adapter, base
  branch, merge policy, credential matrix — plus `.agents/testing.md
  § Execution provider` (`manual-qa` | `self`) and `§ Coverage idiom`.
- **`test-automation-engineer` (Axel)** fills the **implementer** slot —
  derives what to build straight from the case, writes the code through the
  project's abstraction layer, files defects and walks away — and the
  **reviewer** slot as a *fresh* engineer-typed dispatch (clean context +
  `code-review` + the reviewer contract; independence comes from the
  contract, not a different agent).

## The pipeline

```
User launches Tal → drops cases, a story with acceptance criteria, or a
  tech task (a single unit is a batch of one)
  Take in: read in full, dedup, snapshot external bodies to
          `.agents/automation/<slug>/cases/<ID>.md`, size each unit —
          un-automatable / already-covered verdicts are made HERE by Tal
  Route per unit — from `.agents/testing.md § Execution provider`:
          self      → combined (everything)
          manual-qa → manual-qa-verified: PASS run record + authored case
                        exist → build from that evidence, NO re-execution,
                        cite the run id
                      needs-execution: dispatch manual-qa's test-runner per
                        case — PASS → build; FAIL → defect filed, outcome
                        defect-found; BLOCKED → blocked; dispatch impossible
                        → the unit STAYS needs-execution (never silently
                        self-execute when policy says manual-qa)
  Build, one unit at a time on its own branch (per `.agents/workflow.md`):
          engineer green N consecutive runs (§ Merge gate, default 3), PR open
          per § Automation PR policy, coverage declaration in the spec.
          Combined: the first green run of the automated test IS the case's
          first execution; the engineer may walk a new surface live first,
          files a defect if the scenario does not work, probes once cached —
          locator ladder: surface cache → manual-qa knowledge (read-only) →
          the case file → live probe. Learned handles go back to the cache.
  Review: fresh engineer-typed dispatch — walks the case step-by-step against
          the coverage declaration and runs the spec once; edits nothing; fix
          rounds go through the lead until approved
  Prove (two or more units) — every such batch ends with it, landed or
          not; its own agent, none of the builders: the batch's specs
          together N consecutive green on the trunk + the specs a modified
          symbol reaches, once + CI selection check. An ask packed into ONE unit
          (one case, or up to five cases on one surface) is proven
          by its builder's N runs and the reviewer's run.
  Merge per policy → mirror tracker/TMS → next unit. A batch trunk gets one
          gate before base. Report once per batch, as a file.
  (Claude Code, when a batch is asked to run as a workflow: same loop on a
   batch trunk with one report — `test-automation-workflow` accelerant)
```

## Working agreements (team-wide)

- **The coverage declaration is contract law.** Every delivered spec carries a
  machine-findable comment block — `TC-<id> coverage: <steps>` /
  `TC-<id> excluded: <step> (<category>: <referent>)`. Exclusion categories
  are a closed vocabulary (`covered-elsewhere` / `blocked-by-defect` /
  `un-automatable` / `by-seeded-policy`), each requiring a verifiable
  referent; free-text reasons are invalid grammar — blocking at review and
  gate. The engineer cannot mint un-automatability the intake screening
  didn't see — only request it via the lead. Full grammar: the
  `test-automation-workflow` skill.
- **Cases are read-only.** Two sources of truth: the case (TMS or `tasks/`
  file — TA never edits it) and the code.
- **Execution provider is policy, not preference.** `self` → combined;
  `manual-qa` → verified/needs-execution as above. Absent from `.agents/testing.md` (seeded by
  another factory's scout, or by hand) → `self`; the lead flags the gap and
  adds the section at close. Never fall back to
  self-execution silently when policy says manual-qa.
- **manual-qa's area is a read-only warm start.** `tasks/`, `reports/`,
  `.agents/manual-qa/` — read and reference, never write. Before writing an
  app fact to the surface cache, check their knowledge/ — if present,
  reference it, never copy (copies drift).
- **No defect masking.** `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`,
  and weakened assertions for product defects are forbidden. A product bug
  means file a ticket, keep the assertion the case demands and let the test
  fail on that step, write the remaining steps honestly, return
  `defect-found`; the PR is parked with its ticket and lands with no rewrite
  when the fix ships. `blocked-by-defect: <ticket>` excludes only a step that
  cannot be exercised at all — never one that fails, never to turn a red into
  a green. And never re-aimed: the decisive step acts on the control
  the case names; a named control that does not do what the case says is a
  defect (ticket + red test), not a reason to drive a neighbouring control
  that "works". The named control is the one a user operates: a test stays
  on the part a person would click or type into, and a broken part behind it
  (an input its label is not bound to, mouse works and keyboard does not) is
  always filed as a defect, never left as a comment. A path adaptation — a renamed
  button, a changed route, a new interstitial, reworded copy for the same
  observable — is fine when declared in the spec and the Run Report and filed
  as a `clarification`; wording alone is never a defect, behaviour is.
  "The product is consistent with itself" never overrides the case. No
  tracker seeded → the defect record is a file,
  `.agents/automation/defects/<ID>.md`, and its path is the ticket.
  Reviewers edit nothing on the branch they judge; a `defect-found` return is
  reviewed like any other.
- **Reuse to travel and to know — never to conclude.** Reuse the suite to
  REACH areas fast and the surface cache to KNOW handles — but a coverage
  judgment stands on the automated test's own green run against the real
  system. `covered-elsewhere` may point only at a test merged to base, by name
  (a project may widen this in `.agents/testing.md § Coverage idiom`).
- **A factory install/update reaches NEW sessions only.** `npx … init
  --update` changes the disk, not a running lead's context. After any update:
  finish or park the in-flight batch, then start a fresh session.
- **One unit, one synchronous dispatch, one Run Report — on every host.** The
  lead runs the per-unit loop itself (route → build → review → merge; one gate per batch trunk);
  a batch is that loop N times. On Claude Code the shipped workflow scripts
  (`batch-build` / `batch-campaign` under `test-automation-workflow`;
  `batch-integrate` and `batch-stabilize` are repair tools) run the same loop
  faster **when the user or the seed asks for a batch workflow** — installing
  this factory is the multi-agent opt-in the Workflow tool asks for, so the
  lead does not re-litigate it. Nothing about the contract changes off Claude
  Code, only who executes the loop.
- **Nothing wakes a waiting agent.** No host sends a notification when a
  background job or a subagent finishes. Wait only inside a blocking call
  (`sleep 300` polls with a 600 s timeout); a turn that ends with "I'll wait"
  ended with nothing delivered. Images stay on disk: text first, a picture only when it answers what text
  cannot, never the same screenshot twice, well under the host cap of 20 per
  dispatch;
  a dispatch that dies on a context or image limit is split into smaller
  units, never retried with the same prompt.
- **Dispatch is the work.** A routing turn without an actual subagent dispatch
  in the same reply did nothing.
- **Everything of yours is inside this repository.** Skills, agent files and
  reference docs sit in this project's host directories (the hooks name the
  absolute paths at start). Never run a search or listing rooted at `/`, `~`
  or another project — for anything: not a library, not a tool's output
  file, not a cache, not the product's source. A file a tool mentions
  (`.playwright-mcp/…`) is under the project root; what is not inside the
  project is reported missing, not hunted.
- **The batch report is a file.** `.agents/automation/<slug>/report.md`, one
  row per unit, written before the lead's last message; that message carries
  the path and the outcome column, not the report.
- **Tool-call economy.** Independent tool calls go out together in one
  message — one `git show <sha>` for a whole diff, one grep with alternation,
  one ranged `sed`, no `ls`-probing before the real command. Measured: the same
  review took 14 tool calls batched and 36 sequential.
- **Done means delivered AND tracked.** A `delivered` case is green N times under its builder, green once more
  under review, merged with a valid coverage declaration; a masked green is
  `blocked`.
- **TMS-agnostic; back-write is dual-write.** The adapter skill loads only
  when the project declares it (e.g. `tms.adapter: xray` → `xray-testing`).
  TA back-writes **only automation executions** (gate outcomes, case
  status/coverage note, PR link); manual-qa's live runs are their own record —
  TA never writes those.
- **No unsolicited integrations; external writes follow the seeded way of
  work.** Scaffolding wires only what's needed to run tests. TMS updates,
  defect tickets and tracker posts are performed per the policy seeding
  recorded in `.agents/*` — do the writes the seed establishes, skip the ones
  it doesn't, never invent or drop one per run.

## Knowledge routing

| What | Where |
|---|---|
| Hot handles, waits, quirks (high churn) | `.agents/automation/surface/<feature>.md` — TA's working cache; engineers write back what live probing revealed |
| Durable, verified, cross-role system facts | promote to `.agents/knowledge/` via `knowledge-curation` — admission: cross-role + verified + durable + costly to rediscover; the only two-way cross-factory channel |
| Process / personal lessons | `.agents/memory/<role>/` via the `memory` skill — local only, invisible to other roles |
| manual-qa's `.agents/manual-qa/**` | read-only; reference, never copy |

Correct or delete a shared note the moment it stops being true — a stale one
misleads every role at once. Never commit an unverified claim.
