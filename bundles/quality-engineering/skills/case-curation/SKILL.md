---
name: case-curation
description: Use when assessing an existing test-case base against a story or requirement change — inventory and match cases to acceptance criteria, classify each as keep/update/rewrite/retire/missing, surface case-vs-story contradictions, and emit a minimal authoring delta plus a regression scope.
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Case Curation — reuse before you write

Assess the **existing** test-case base against an incoming story or requirement
change, and decide what to reuse, what to touch, and what is genuinely missing —
**before** anyone authors a new case.

In the **quality-engineering** bundle this skill is agent-orchestrated: the
`qe-lead` dispatches the `case-curator` seat with a triaged story, and the
curator returns the curation report below. **Standalone** (no bundle, no lead),
either ask runs it directly — "what do our existing cases cover of this story?",
"what should we re-run for this change?" — return the report to whoever asked.

**Core philosophy: the cheapest case is the one you don't write.** An existing
case is an asset — it has execution history, known stability, and a place in the
suite. Authoring a duplicate of it wastes the writing, splits the history, and
doubles the maintenance. New cases are for **true gaps only**; everything else
is an update, a rewrite, or a retirement — in that order of preference.

## Inputs

1. **The story / requirement change** — triaged (post story-triage: testable ACs
   with stable requirement ids). Don't curate against an un-triaged story; the
   match step needs ACs you can quote.
2. **The existing case base** — wherever it lives:
   - TC files in the repo (`Glob` for `TC-*.md` / the project's case tree),
   - a case workbook in Excel — import via [`xlsx-reader`](skills/xlsx-reader/SKILL.md),
   - a TMS — read via the project's tracker/TMS access (read-only; you classify,
     you don't edit the TMS).
3. **Prior run reports** (when present) — execution history feeds the
   stability signal and the regression scope.

## Step 1 — Inventory

Find every case that *could* relate to the story. Search wide, then narrow:
by `requirements:` ids (direct traces), by `module:`/`tags:` frontmatter, by the
feature's nouns and routes in case titles and steps, by suite membership — **and
by the similar/related stories the dossier names** (cases tracing to a duplicate
or sibling story are prime reuse candidates; pull them into the candidate set).
Record the candidate set with file paths / case ids — the report cites every
decision.

## Step 2 — Match

Map each candidate case to the story's ACs — **by reading its steps and expected
results, never by title alone.** A match must be quotable: name the step/expected
line that exercises the AC. One case may cover several ACs; one AC may need
several cases. The output of this step is the case ↔ AC relation the rest of the
skill (and later triangulation) works from.

## Step 3 — Classify

Every candidate case gets exactly one classification:

| Class | Criteria | Action it implies |
|---|---|---|
| **keep** | Covers its AC(s) as written; data, routes, and labels still match the product | None — schedule in the run |
| **update** | Right scenario, drifted details — test data, URL, label text, one added/changed AC clause | Targeted edit; history and id preserved |
| **rewrite** | Scenario still required but the case's structure no longer matches the behavior (flow reordered, screens merged, assertions obsolete) — patching costs more than rewriting | New body under the **same id** (or explicit supersede), trace kept |
| **retire** | The behavior it tests was removed or superseded; or it traces to no current requirement (orphan) | Propose retirement — flag, don't delete; the lead routes it |
| *(gap)* **missing** | An AC no existing case reaches | The only place a **new** case is justified |

When in doubt between update and rewrite, count the surviving lines: if most
steps survive, it's an update. When in doubt between retire and keep, check
whether the case is the **only** coverage of some *other* requirement before
proposing retirement.

## Step 4 — Contradictions

While matching, you will hit conflicts. **Surface them — never silently
"fix" a case to match the story** (the conflict may be the story's bug):

| Class | Looks like | Route |
|---|---|---|
| **case-vs-AC** | An existing case asserts behavior the new story changes or forbids | Question to the PO (via the lead): intended change or requirement error? Case is *blocked-for-update* until answered |
| **case-vs-case** | Two cases assert incompatible outcomes for the same flow | One of them is stale — find which against the current ACs; classify the loser update/retire |
| **case-vs-build** | The case text contradicts the live product and the ACs are silent | Flag as drift; route to verification against the build before classifying |

Each contradiction is a finding with the concrete artifacts named (case id, AC
id, the conflicting lines quoted) and a question that closes it.

## Step 5 — The authoring delta

Emit the **minimal ordered work list** for the author — updates first, rewrites
second, new cases last:

```markdown
## Authoring delta — {story} ({date})
reuse: {kept} kept · {upd} updates · {rw} rewrites · {ret} retirements proposed · {new} new
| # | Case | Class | What changes | Covers |
|---|------|-------|--------------|--------|
| 1 | TC-031 | update | new error text "Card declined" (was "Payment failed") | REQ-104/AC-2 |
| 2 | TC-012 | rewrite | checkout flow reordered: address now before payment | REQ-104/AC-1,3 |
| 3 | — | new | guest checkout with saved-cart merge — no case reaches AC-4 | REQ-104/AC-4 |
```

Every row names its AC(s). A delta where `new` outnumbers `update + rewrite` on
a change to an **existing** feature is a smell — re-check Step 2 matching.

## Step 6 — The regression scope

Select which **existing** cases must re-run for this change — scoped, not "run
everything":

1. **Direct traces** — every case tracing to the changed requirement(s).
2. **Shared surface** — cases exercising the same module/flow/route the change
   touches (frontmatter `module:`, route mentions in steps).
3. **History** — cases that prior run reports show breaking when this area
   changed before.
4. **Core-flow guard** — the smoke set, when the change touches a critical path.

Output an ordered list with a one-line rationale per case and a total size
estimate. State what was deliberately **excluded** and why — a scope is only
trustworthy when its boundary is explicit.

## Output — the curation report

One report, returned to the dispatcher: inventory stats (candidates found /
sources searched), the case↔AC match table, classifications with one-line
rationale each, contradictions (with questions), the authoring delta, and the
regression scope. Every claim cites a case id and a quotable line — a
classification without a quoted basis is a guess, and you don't ship guesses.

## Anti-patterns

- **Authoring-first.** Writing a new case without inventorying what exists — the
  precise waste this skill exists to prevent.
- **Title-match curation.** Classifying from names without reading steps; titles
  lie, steps don't.
- **Silent reconciliation.** Rewriting a case that contradicts the story without
  surfacing the contradiction — the story may be the wrong side.
- **Unscoped regression.** "Run the full suite" (no boundary) or "nothing else
  affected" (no rationale) — both are non-answers; the scope needs named cases
  and named exclusions.
- **Deleting instead of retiring.** Retirement is a proposal the lead routes;
  curation never destroys cases or edits the TMS.

## References

- [`skills/xlsx-reader/SKILL.md`](skills/xlsx-reader/SKILL.md) — importing case
  workbooks / requirement matrices from Excel.
- [`skills/requirement-traceability/SKILL.md`](skills/requirement-traceability/SKILL.md)
  — the requirement↔case↔result relation this skill's match step feeds; its
  triangulation later audits what curation decided.
- The team's case format (e.g. `.agents/quality-engineering/knowledge/test-case-format.md`
  on QE installs) — what updates/rewrites must conform to.
