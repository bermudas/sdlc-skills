---
name: requirement-traceability
description: Use when triaging requirements/stories for testability or running the 5-axis triangulation (tested↔cases↔requirements↔functionality↔intent) — emitting a gaps-and-questions report and a traceability matrix with uncovered / orphan / stale / weak-evidence coverage findings plus spec-deviation and intent-gap validation findings.
license: Apache-2.0
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

## Requirement Traceability — the QE coverage discipline

This skill is the methodology the **`story-analyst`** seat loads in the **quality-engineering** bundle for the two analytical ends of in-sprint testing. There, it is **agent-orchestrated**: the `qe-lead` dispatches the analyst (an isolated, single-duty seat) to triage a story or to triangulate coverage; the analyst runs the phases below and returns a report to the lead. Orchestration (dispatch order, who authors, who executes, who reviews, the QE gate) is the `qe-lead`'s job; this skill owns the analysis: requirement testability up front, and the 5-axis triangulation at the back.

**Standalone use (no bundle, no lead).** Installed on its own, either phase runs directly off a plain request — "triage this story / is this testable" → Phase 0; "audit our coverage / does the green prove the requirement" → Phase 1. Everything below applies unchanged except routing: return the report to whoever asked, and read "return to the `qe-lead` / file to the PO via the lead" as "hand the question or finding to the requester (or straight to the tracker)".

This is the **in-sprint** governance/coverage discipline — there is no framework automation and no AFS-for-automation handoff. Cases are authored and executed by exploration (separate seats driving the running build with whatever browser/API tooling is wired); this skill governs whether those requirements were testable in the first place and whether the cases, results, and the build itself actually satisfy them.

**Core philosophy:** coverage is a *relation*, not a count. "We have 200 test cases" says nothing — the question is which requirements those cases trace to, whether any case traces to nothing, and whether the green results were produced against the build under audit. A high case count with broken traceability is worse than fewer honest cases, because it manufactures false confidence. Every finding here points at a concrete artifact — a requirement ID, a case file, a run record — never a vibe.

**The pipeline this skill bookends.** The QE bundle runs `story triage → case curation → authoring → case review → exploration execution → reporting → triangulation`, each stage its own isolated seat. This skill owns **Phase 0** (the front gate — story triage) and **Phase 1** (the back gate — 5-axis triangulation); the analyst also runs the cold case review between them. The middle is other seats' craft: `case-curator` (reuse-first assessment, via `case-curation`), `test-author`, `test-runner`, `test-reporter`. Both phases report back to the `qe-lead`, who routes — there is no seat-to-seat handoff.

## Two phases, two gates

| Phase | When | Input | Output | Gate it enforces |
|---|---|---|---|---|
| **Phase 0 — Story Triage** | Before any case is authored | Requirements / stories / acceptance criteria | **Requirement gaps & questions** report → PO (via the lead, out-of-band) | No case authoring against un-triaged requirements |
| **Phase 1 — Triangulation** | After cases exist and a run has executed | Requirements + cases + results | **Traceability matrix** + p0–p3 findings | No "trustworthy green" without fresh results against the current build |

Run Phase 0 when the request is "review this story", "is this testable", "what's missing before we test". Run Phase 1 when the request is "audit our coverage", "is this requirement covered", "do our results prove the requirement". If a request spans both (a fresh epic with stories *and* a half-built case suite), run Phase 0 on the un-triaged stories first, then Phase 1 on what's already authored.

---

## Phase 0 — Story Triage (the front gate)

Review each requirement/story for **testability** before a case is written against it. An untestable requirement produces an untestable case, which produces a meaningless result — the rot starts here, so the gate is here.

### What to look for

Read each story / acceptance criterion and classify it against five testability defects:

| Defect | What it looks like | Why it blocks testing |
|---|---|---|
| **Ambiguity** | "should be fast", "user-friendly", "handles errors gracefully" — no measurable predicate | No pass/fail line — two testers would write contradictory cases |
| **Missing acceptance criteria** | Story states an intent but never says what "done" observably looks like | Nothing concrete to assert against |
| **Contradictory criteria** | Two ACs (or an AC vs. the story body, or AC vs. a sibling story) that can't both hold | Any case you write fails one half by construction |
| **Untestable claim** | "system is secure", "scales infinitely", "always available" — unbounded / unobservable | No finite procedure can confirm it; needs reframing into a bounded, observable claim |
| **Hidden assumption** | Relies on an unstated precondition — a role, a feature flag, a data state, an upstream system being up | The case author guesses the precondition; the result is conditional on a guess |
| **Negative / boundary AC** | A prohibition or edge — "user **cannot** select a date before *Valid From*", "**must not** allow…", "**only** admins…", a date/range/count edge | The on-boundary case and each side are left unspecified — is the boundary value itself allowed? what's expected just inside vs just outside? Two testers (and the build) will disagree. Pin the exact boundary **and** the expected behavior on each side, or it's ambiguous |

Use [`verifying-outcomes`](skills/verifying-outcomes/SKILL.md) as the lens: for each AC, ask its five questions backward — *can I state this as a concrete testable outcome? what must be TRUE / EXIST / CONNECTED? where would it break?* An AC that can't survive that reframing is a triage finding, not a testable requirement. **A negative AC ("cannot/​must-not/​only") is the easiest to mis-test** — re-state it as the concrete observable: *what does the user see when the prohibited action is attempted, and what is allowed right at the boundary?*

### Inputs — the whole ticket, not the description

**Triage against a story's description alone is itself a triage defect.** A tracker ticket's authoritative content is spread across its anatomy — read all of it (or demand a dossier that contains it):

| Ticket part | Why it's load-bearing for triage |
|---|---|
| **Description / summary** | The starting claim — but often the *least* current part |
| **AC field(s)** | Acceptance criteria frequently live in a **separate custom field** ("Acceptance Criteria", "Definition of Done"), not the description — a story that "has no ACs" may just be hiding them |
| **Comments (chronological)** | Where decisions actually land. A later PO comment that contradicts the description is either the **newest clarification (it wins — cite it)** or a contradiction finding — never silently ignored |
| **Sub-tasks (content, not just titles)** | The real scope split; a sub-task can carry ACs or constraints the parent never mentions |
| **Linked issues** (blocks / is-blocked-by / relates / duplicates) | Prior art and constraints; *related/duplicate stories often already have test cases* — name them for the curation step |
| **Parent epic / feature** | The **intent baseline** — what was actually asked for; Phase 1's axis 5 (delivered vs intended) is judged against this |
| **Attachments** (mockups, specs) | Often the only testable definition of visual/UX criteria |
| **Linked external docs** (Confluence, spec / design pages) | Frequently the *only* place the real acceptance criteria or intended behavior is written — a story that just links a spec is delegating its ACs there. **Read the linked page, don't just note the link** |
| **Similar / related tickets (by search)** | When the story is thin, sibling stories under the same epic / component / label often carry prior ACs *and existing test cases*. A quick tracker search (JQL by component/label/text) surfaces them; their ids feed the curation step |

Plus the non-tracker sources: requirement/spec docs in the repo or linked, and requirement matrices delivered as Excel — import via [`xlsx-reader`](skills/xlsx-reader/SKILL.md) (`node scripts/read_xlsx.js <reqs.xlsx>`), then read the produced Markdown so each requirement is an addressable row.

**Depth is bounded by relevance, not a fixed hop count — and the boundary is reported.** Read depth 1 (everything the ticket directly references — links, sub-tasks, parent epic, the Confluence/spec pages it points at) always. Go **deeper only for a load-bearing artifact** — one an AC genuinely can't be understood without (a "duplicates" target's cases, a spec page two hops out that holds the real criteria). The stop rule is *relevance*: stop when the next artifact wouldn't change an AC or a test. **When a deeper dive would balloon** — a wiki subtree, a search returning a pile of candidate tickets — **don't spelunk; surface it** ("deeper investigation warranted: {what, why}") so the orchestrator can budget a dedicated pass instead of bloating triage. Always state **which parts you read at which depth and which were empty/unavailable or skipped** — "triaged from description only" is a caveat the reader must see, not a silent default.

### Output — the Requirement gaps & questions report

Emit a report addressed to the **PO** (returned to the `qe-lead`, who files the questions to the tracker / PO **out-of-band** — the pipeline does not block on answers and never edits requirements). Each entry is a finding on the **p0–p3 schema** (§ Finding schema below) plus a concrete **question** that would close it:

```markdown
## Requirement gaps & questions — {epic / story set} ({date})
{N} requirements triaged · {blocking} blocking · {clarifying} clarifying

### {REQ-ID / story title}
- **[p1] Ambiguity** — "{quoted criterion}"
  - Why untestable: {no measurable predicate / no pass line}
  - Question for PO: {the specific question that yields a testable criterion}
  - Suggested testable form: {a concrete rewrite, offered — not imposed}
```

**The gate.** Requirements with a **p0/p1** triage finding are **not ready for case authoring** — return them to the `qe-lead` as blocked-for-authoring. p2/p3 findings are clarifying: authoring may proceed, but the question rides along with the case. Do **not** let case authoring start against a requirement carrying an open p0/p1 testability finding — that is the rot the front gate exists to stop.

---

## Phase 1 — Triangulation (the back gate)

Triangulate across **five axes** — three of *coverage* (read off the requirement ↔ case ↔ result matrix) and two of *validation* (read off the running build). This turns "we ran the suite, it's green" into "here is exactly which requirements that green proves, which it doesn't, and where the build itself diverges from what was asked."

| Axis | Compares | Mismatch finding |
|---|---|---|
| **1 — Tested vs cases** | what was actually executed vs the cases that exist | unexecuted / **stale-result** |
| **2 — Cases vs requirements** | the case set vs the requirement set | **uncovered-requirement** / **orphan-case** |
| **3 — Results vs requirements** | run outcomes vs what the requirement demands | **weak-evidence / contradiction** |
| **4 — Functionality vs requirements** | the build's actual behaviour vs the written requirement | **spec-deviation** |
| **5 — Delivered vs intended** | what was delivered vs what was actually asked/intended | **intent-gap** (observation) |

Axes 1–3 are **coverage**, read off the matrix below. Axes 4–5 are **validation** — observations from exercising the build; QE reports them and does not resolve them (no requirement edits).

> **Evidence over hearsay — the rule that makes triangulation worth running.** Judge every axis against the **artifact**: the captured screenshot/snapshot, the run-record line, the requirement text. **Never** grade against what another seat *reported* ("the author says it covers AC-2", "the runner said PASS"). A pass, a defect, or a coverage claim you cannot tie to a specific piece of captured evidence is **unverified** — class it `weak-evidence` and open the artifact yourself. The independence of this pass is the entire reason it is a separate seat from the ones that authored and executed; trusting their statements collapses it back into self-review.

### The three inputs

Triangulation needs three artifacts, each addressable by ID. Gather all three before building the matrix — a matrix missing any leg can only find a subset of the gap classes.

| Leg | Source | How to ingest |
|---|---|---|
| **Requirements** | Tracker / PO stories / spec docs / a requirement matrix in Excel | Tracker read, repo docs, or [`xlsx-reader`](skills/xlsx-reader/SKILL.md) for `.xlsx` matrices → Markdown rows |
| **Cases** | Manual test-case files (`test-specs/…`, markdown), or a case workbook in Excel, or the TMS | Read the case files; `xlsx-reader` for `.xlsx` case lists; tracker/TMS for managed cases |
| **Results** | Manual run reports (the `test-reporter`'s output), or TMS executions | Read the run report / execution records; note **which build** each result was produced against |

Each requirement, case, and result must carry a stable ID and an explicit link (case → requirement it traces to; result → case it executed). Where the link is missing in the source, that absence is itself a finding (it's how orphans and uncovered requirements surface).

### Build the matrix

Lay out one row per requirement, columns for the cases that trace to it, and the freshest result for each case. The full layout, column semantics, and a worked example live in [`references/traceability-matrix.md`](references/traceability-matrix.md). The matrix is the artifact; the coverage gap classes (axes 1–3) below are read **off** it, while the validation findings (axes 4–5) come from exercising the build.

### Axes 1–3 — the coverage gap classes

Every *coverage* finding falls into exactly one class, read off the matrix. Each maps to a default priority band on the p0–p3 schema — adjust per the requirement's own priority and the evidence strength.

1. **Uncovered requirement** — a requirement with **no case** tracing to it. The coverage hole. Default **p0** for a p0/p1 (must-work / critical-path) requirement, **p1** otherwise. This is the highest-stakes class: a critical requirement nobody is testing.

2. **Orphan case** — a case tracing to **no requirement**. Waste or scope-creep: effort spent testing something no requirement asked for (or a requirement that was deleted/renamed and the link rotted). Default **p2**. Not a coverage *hole*, but a signal the suite has drifted from the requirement set — either link it to its real requirement or retire it.

3. **Stale result** — a case that exists and traces correctly, but was **not executed against the current build** (last run is against an older build, or never run). The result is **untrustworthy green**: the suite "passes" on a build nobody verified. Default **p1** if it covers a p0/p1 requirement, **p2** otherwise. Green-on-stale is the most dangerous illusion in the matrix because it *reads* as covered.

4. **Contradiction / weak evidence** — a case that "passes", but the **evidence doesn't actually prove the requirement**. The case asserts something adjacent, the result lacks the proof the assertion implies, or the case and requirement quietly contradict. Default **p1** — a green that doesn't prove its requirement is functionally an uncovered requirement wearing a pass badge. Apply the [`verifying-outcomes`](skills/verifying-outcomes/SKILL.md) lens to the result: does the captured evidence make the requirement's claim *TRUE*, or just make the case step "done"?

### Axes 4–5 — validation findings (from exercising the build)

Coverage (axes 1–3) proves the *cases and results* line up with the requirements. Validation asks whether the **build** does — surfaced by driving the running feature, not read off the matrix.

- **Spec deviation** (axis 4 — functionality vs requirement) — the built behaviour does **more, less, or other** than the written requirement, even where a case "passes". The implementation and the requirement disagree. Default **p1**; **p0** if it breaks a critical-path requirement. Report it with evidence (build behaviour vs requirement); route to the PM for a dev fix or a requirement correction.
- **Intent gap** (axis 5 — delivered vs intended) — the requirement and the build *agree*, yet neither matches what the stakeholder actually asked for (the requirement captured the intent imperfectly). **"Intended" has concrete sources: the parent epic/feature, the story's stated user value, and the PO's clarifying comments** (the ticket anatomy from Phase 0's inputs) — judge against those, not against your own guess of intent. QE does **not** resolve this: surface it as an **observation / question** to the PM/PO — what was delivered vs what appears to have been intended. Never edit the requirement yourself.

### Output — matrix + findings

Return two things to the `qe-lead` (or whoever dispatched you):

1. The **traceability matrix** (per [`references/traceability-matrix.md`](references/traceability-matrix.md)) — the coverage relation, every cell traceable.
2. A **findings list** on the p0–p3 schema, each tagged with its class and routed by the `qe-lead`: uncovered → the authoring delta (a `test-author` dispatch); orphan → retire/relink; stale → re-execute against the current build; weak-evidence → strengthen the case or re-run with the missing proof; **spec-deviation** → dev fix or requirement correction; **intent-gap** → recorded observation for the PO.

**The gate.** No requirement is reported as **covered** ("trustworthy green") unless a case traces to it **and** that case has a **fresh result against the current build** **and** the result's evidence proves the requirement's claim. Coverage = case ∧ fresh-result ∧ sufficient-evidence. Any leg missing flips it from green to a finding. State the build/version the matrix was triangulated against in the report header — a matrix without a build stamp is itself stale.

---

## Finding schema

Both phases emit findings in this shape — a p0–p3 schema the `qe-lead` can rank and gate on:

```json
{
  "title": "Short descriptive title",
  "phase": "triage | triangulation",
  "gap_class": "uncovered-requirement | orphan-case | stale-result | weak-evidence | spec-deviation | intent-gap | testability",
  "priority": "p1",
  "confidence": 8,
  "requirement_ref": "REQ-123 / story link",
  "artifact_ref": "TC-045 / run-2026-05-12 / story body",
  "reasoning": "Why this breaks coverage or testability, and the impact",
  "suggested_fix": "Plain-English action (author case / relink / re-execute / ask PO …)",
  "question_for_po": "(triage only) the specific question that closes the gap"
}
```

**Priority.** `p0` = critical (a must-work requirement uncovered, or a triage defect that blocks all authoring on a critical path); `p1` = high (uncovered non-critical requirement, stale result on a critical case, weak evidence on a key claim, blocking ambiguity); `p2` = medium (orphan case, stale result on a low-priority case, clarifying gap with a workaround); `p3` = low (cosmetic traceability hygiene, minor wording question).

**Confidence (1–10).** 8–10 = definite (the link is provably absent / the result is provably against an older build / the evidence provably omits the claim); 5–7 = likely (strong indirect indicators — e.g. a result with no build stamp); 1–4 = possible (the source data is incomplete and you're inferring). Never fabricate a link or a result to fill a matrix cell — an unknown cell is a finding ("traceability data missing"), not a guess.

## Anti-patterns

- **Authoring against an un-triaged requirement.** The front gate exists precisely to stop this. If a case is being written against a story carrying an open p0/p1 testability finding, the rot is already in.
- **Counting cases as coverage.** "200 cases" is not a coverage statement. Coverage is the requirement↔case↔result relation, read off the matrix.
- **Trusting green without a build stamp.** A pass produced against an unknown or older build is a stale-result finding, not coverage. Always pin the build.
- **Confusing orphan cases with uncovered requirements.** Orphans are cases pointing nowhere (waste); uncovered requirements are requirements nobody tests (holes). Opposite ends of the relation — don't conflate them in the report.
- **Accepting "the case passed" as proof the requirement holds.** A pass proves the *case* ran; weak-evidence triangulation asks whether the case actually proves the *requirement*. Apply the goal-backward lens.
- **Fabricating a matrix cell.** An unfilled link is a finding, not a number to invent. Lower confidence and flag the missing data.
- **Acting as the orchestrator.** In a triage or triangulation dispatch you own the *analysis*; the `qe-lead` owns dispatch order, the separation of duties, and the QE gate. Report findings and route recommendations back to the lead — don't dispatch other agents yourself.
- **Editing the requirement instead of asking.** Triage *files a question* to the PO (via the PM, out-of-band); it never rewrites the requirement. Same at triangulation — an intent gap is an observation, not an edit.

## References

- [`references/traceability-matrix.md`](references/traceability-matrix.md) — the matrix layout, column semantics, build-stamp rule, and a worked example showing the coverage gap classes (axes 1–3).
- [`skills/verifying-outcomes/SKILL.md`](skills/verifying-outcomes/SKILL.md) — goal-backward verification; the lens for triage testability and weak-evidence triangulation.
- [`skills/xlsx-reader/SKILL.md`](skills/xlsx-reader/SKILL.md) — importing requirement / case matrices delivered as Excel into addressable Markdown rows.
- The p0–p3 finding schema is defined inline above (§ Finding schema) — self-contained; no other skill needs to be installed for QE findings to rank and gate.
