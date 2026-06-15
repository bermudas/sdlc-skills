# Requirements Traceability Matrix

The single source of truth for *what we promised* (requirements), *what we built
to check it* (cases), and *what actually happened* (results). One row per
requirement. The matrix is how the **story-analyst** runs **Phase 1
triangulation** — every requirement, case, and result must line up, and every
mismatch is a named gap. A green that isn't traced is not a green.

The matrix covers **axes 1–3** of the triangulation (coverage). **Axes 4–5**
(validation — does the build match the requirement, and does the delivery match
intent) are observations recorded below the grid, not matrix cells — see
*Validation triangulation* at the end.

> **Relation to the skill's reference spec.** This file is the **compact
> per-project working template** of the layout defined in the
> `requirement-traceability` skill's `references/traceability-matrix.md` — that
> reference owns the full column semantics and the verdict logic; where the two
> differ, the reference wins. Vocabulary mapping: `Coverage status: covered`
> here = the reference's `trustworthy-green` verdict; `Last run/build` here
> carries the reference's *Result build* (the build stamp that makes a green
> judgeable); orphan cases appear here as in-grid rows with a blank
> `Requirement ID` rather than the reference's separate orphan table.

Seed one copy of this file per project, then keep it current as requirements
land, cases are authored, and runs complete. It is the artifact the QE gate reads
before a story is allowed to close.

---

## Matrix (axes 1–3 — coverage)

| Requirement ID | Requirement summary | Acceptance criteria | Case ID(s) | Last result | Last run/build | Evidence proves AC? | Coverage status |
|----------------|---------------------|---------------------|------------|-------------|----------------|---------------------|-----------------|
| REQ-001 | <one-line intent> | <AC-1; AC-2 — the testable conditions> | TC-001, TC-014 | PASS | RUN-2026-05-18-001 / build 4.2.0 | YES (error screenshot) | covered |
| REQ-002 | <one-line intent> | <AC-1> | — | — | — | — | uncovered (P1) |
| REQ-003 | <one-line intent> | <AC-1; AC-2> | TC-022 | PASS | RUN-2026-04-02-003 / build 3.9.1 | YES | stale |
| REQ-004 | <one-line intent> | <AC-1> | TC-030 | PASS | RUN-2026-05-18-001 / build 4.2.0 | WEAK (proxy assertion) | weak-evidence |
| — | (no requirement) | — | TC-041 | PASS | RUN-2026-05-18-001 / build 4.2.0 | n/a | orphan |

> Add one row per requirement. Orphan cases (no requirement) are recorded with a
> blank `Requirement ID` so they stay visible — they are scope to either justify
> or delete, not silent extra coverage.

---

## Column reference

| Column | What goes here |
|--------|----------------|
| Requirement ID | The PO/tracker requirement or story ID (e.g. `REQ-001`, `JIRA-1234`). Blank only for orphan rows. |
| Requirement summary | One line — the intent, not the implementation. |
| Acceptance criteria | The testable conditions, AC-by-AC. If empty/ambiguous, the requirement isn't triaged yet — send it back via story triage (Phase 0) before authoring cases. |
| Case ID(s) | Every case that traces to this requirement. `—` if none exist. |
| Last result | Outcome of the most recent run of those cases: `PASS` / `FAIL` / `BLOCKED` / `—` (never run). |
| Last run/build | The run report ID **and** the build/version the result was produced against. Both are required — a result without a build can't be judged stale. |
| Evidence proves AC? | `YES` / `WEAK` / `NO` (+ a word on the proof) — does the captured evidence make the AC's claim true, or just mark the case step "done"? `WEAK`/`NO` on a PASS is what flips a row to `weak-evidence`. |
| Coverage status | One of the legend values below. |

---

## Coverage status legend — the coverage gap classes (axes 1–3)

| Status | Meaning | Severity hint |
|--------|---------|---------------|
| **covered** | Requirement has ≥1 case, the case ran against the current build, and the evidence actually proves the AC. The only clean state. | — |
| **uncovered** | Requirement with no case. A promise nothing checks. Tag the priority of the requirement: `uncovered (P0)` for critical/contractual, `uncovered (P1)` for important. | P0 / P1 |
| **orphan** | Case that traces to no requirement. Waste or scope-creep — either tie it to a requirement or retire it. | P2 |
| **stale** | Case exists and last passed, but was **not** executed against the current build — an untrustworthy green. Re-run before trusting. | P1 / P2 |
| **weak-evidence** | Case "passes" but the evidence doesn't actually prove the AC (asserts the wrong thing, skips the AC, or proves a proxy). A contradiction between result and requirement. | P1 |

A row is **covered** only when none of the other four apply. Anything else is a
finding on the P0–P3 schema, owned by the story-analyst (in its TRIANGULATE dispatch) and
routed by the qe-lead.

---

## Validation triangulation (axes 4–5 — observations, not matrix cells)

Coverage (above) proves the *cases and results* line up with the requirements.
Validation asks the two harder questions, from actually exercising the build:

- **Axis 4 — Functionality vs requirements (spec deviation).** Does the built
  behaviour match the written requirement? Record cases where the implementation
  does **more, less, or other** than the requirement says — even if a test
  "passes." Default **P1** (P0 if it breaks a critical-path requirement).
- **Axis 5 — Delivered vs intended (intent gap).** Does what was delivered match
  what was actually *asked for*? The requirement and build can agree yet still
  miss the stakeholder's intent (the requirement captured it imperfectly).
  Record these as **observations / questions** for the qe-lead/PO — QE surfaces them,
  it does **not** resolve them or edit requirements.

```markdown
## Validation findings (axes 4–5)
| Req ID | Axis | Observation | Evidence | Severity | Routed to |
|--------|------|-------------|----------|----------|-----------|
| REQ-001 | spec-deviation | Build allows empty cart checkout; REQ says it must block | /tmp/checkout-empty.png | P1 | qe-lead → dev |
| REQ-007 | intent-gap | Delivered CSV export; story title/intent implies XLSX was wanted | run note | observation | qe-lead → PO |
```

---

## How to fill it

1. **Requirements in first.** Pull requirements/stories from the tracker / PO —
   docs, tickets, or a matrix imported via the `xlsx-reader` skill. One row each.
   Fill `Requirement ID`, `summary`, `Acceptance criteria`. If the AC is empty,
   vague, or contradictory, the requirement failed Phase 0 triage — do not author
   cases against it; raise it in the gaps & questions report (the question goes
   to the PO via the qe-lead, out-of-band).
2. **Map cases.** For each authored case, find the requirement it traces to and
   add its ID to `Case ID(s)`. A case that maps to nothing gets its own orphan
   row (blank `Requirement ID`).
3. **Post results.** After a run, write `Last result` and `Last run/build` from
   the run report. Always record the build — that's what makes a result judgeable
   later.
4. **Set coverage status (axes 1–3).** Apply the legend to every row.
5. **Record validation findings (axes 4–5).** From exercising the build, log any
   spec deviation or intent gap in the Validation findings table.

## How to read it

- Scan the `Coverage status` column top to bottom — every non-`covered` value is
  a gap to act on.
- **uncovered (P0/P1)** → the case-curator marks them missing and the test-author delivers them. Highest
  priority is uncovered P0.
- **stale** → re-run the cases against the current build before any sign-off.
- **weak-evidence** → the case needs reworking; the current green is not
  trustworthy. Often surfaced by the `verifying-outcomes` goal-backward check.
- **orphan** → flag to the qe-lead whether it's hidden scope (needs a requirement) or
  dead weight (retire it).
- **spec deviation / intent gap** → surfaced to the qe-lead; spec deviations at p0/p1
  block the gate, intent gaps are recorded observations for the PO.
- The QE gate passes only when every requirement row is **covered**, there are no
  open p0/p1 spec deviations, and each remaining exception is explicitly accepted
  by the qe-lead with a recorded rationale.
