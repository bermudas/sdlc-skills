# Quality Engineering Team — shared conventions

This is an **in-sprint testing team**: it takes a story from requirement intake
to a triangulated verdict on the build. Separation of duties is **structural** —
each pipeline stage is a distinct single-purpose agent, dispatched in an
isolated context by the **qe-lead**, so the seat that authors a case is never
the seat that executes it, and the seats that review and triangulate never
produced what they judge.

There is **no framework automation in this bundle**: no generated test suites,
no AFS-for-automation hand-off. Execution is **exploration-driven** — the
runner drives the live build (Playwright MCP preferred, `browser-verify` over
CDP as fallback) and records evidence. If automation is warranted, that's a
finding for the lead to flag, not something this team produces.

## The pipeline — one stage, one seat, one dispatch

You talk to the **qe-lead**; it dispatches everything and owns the gates,
the tracker, and the **audit trail** (`reports/trail/{STORY-ID}.md`). There is
no seat-to-seat handoff.

1. **Triage** — `story-analyst` challenges the story for testability (ambiguity,
   missing/contradictory ACs, untestable claims) → *gaps & questions*. The lead
   files questions to the PO **out-of-band**: the pipeline doesn't block on
   answers and **never edits requirements** — open questions ride as recorded
   risk.
2. **Curate** — `case-curator` assesses the **existing** case base: matches
   cases to ACs, classifies **keep / update / rewrite / retire / missing**,
   surfaces case-vs-story contradictions, and returns the **minimal authoring
   delta** plus the **regression scope**. Reuse before writing.
3. **Author** — `test-author` delivers exactly the delta: updates in place,
   rewrites under the same id, new cases only for true gaps — every case cites
   its `requirements:` ids, steps grounded by exploring the implemented build.
4. **Review** — `story-analyst` (cold — it wrote nothing) reviews the cases:
   AC coverage, traceability, testability, delta integrity.
5. **Execute** — the lead first builds the **session plan** (cases whose
   declared `precondition_state`/`postcondition_state` contracts chain share
   one live session — `session_plan.md`, setups saved counted), then dispatches
   `test-runner` **once per session group**: snapshot-verified steps, verified
   state inheritance (mismatch → full-reset fallback), evidence, a JSON verdict
   per case **with the build stamp**. The lead files defects from the evidence
   — runners never touch the tracker.
6. **Report** — `test-reporter` aggregates the verdicts into
   `reports/{run_id}.md` per the seeded format — build stamps and traces are
   mandatory columns.
7. **Fix-verify** — when a defect comes back fixed, the lead dispatches
   `test-runner` in VERIFY-FIX mode: the **original repro re-run on the new
   build with fresh evidence**, plus the regression-scope neighbors. "Verified"
   requires the previously-failing observable to pass — a vanished repro path
   is `cannot-verify`, never `verified`.
8. **Triangulate** — `story-analyst` (it executed nothing) runs the **5-axis
   triangulation**: tested↔cases, cases↔requirements, results↔requirements,
   functionality↔requirements (*spec deviation*), delivered↔intended (*intent
   gap*) — and independently reviews the run itself.

## Requirements are the anchor; reuse is the default; the gate is earned

Every case traces to a requirement id — an untraced case is an **orphan**, an
untouched AC is **uncovered**, a green from another build is **stale**, a pass
whose evidence doesn't prove its AC is **weak-evidence**. New cases are written
only when the curator's match found a true gap — updates and rewrites preserve
the suite's history.

## Definition of done (team-wide)

A story is done when:

- **Triaged** — testability gaps surfaced; p0/p1 questions filed to the PO and
  recorded as risk.
- **Curated** — the existing base was matched first; the delta is minimal;
  contradictions are surfaced, not silently reconciled.
- **Covered & reviewed** — every AC has a traced case; the case set passed the
  analyst's cold review.
- **Fresh** — every relevant case (delta + regression scope) executed against
  the current build with evidence; defects filed; fixes verified with fresh
  evidence.
- **Triangulated** — no open p0/p1 findings on any of the five axes; intent
  gaps surfaced as observations; the audit trail accounts for every stage.

"The suite is green" is not done. The QE gate is the triangulation with no open
p0/p1 findings — produced, executed, and judged by separated seats, with the
trail to prove it.
