# Test Run Report Format Specification

The run report is what **triangulation reads** — every result must carry its
**build stamp** and its **requirement traces**, or the downstream coverage
verdicts can't be computed. The test-reporter writes it; the story-analyst's
TRIANGULATE pass and the qe-lead's gate consume it.

## File Location & Naming

```
reports/
  RUN-YYYY-MM-DD-NNN.md         ← main report (sequence resets per day)
  screenshots/
    TC-031_YYYY-MM-DD.png
  trail/
    {STORY-ID}.md               ← the qe-lead's audit trail (separate artifact)
```

## Full Report Template

```markdown
---
run_id: RUN-2026-06-11-001
story: SCRUM-1234
environment: https://staging.app.example.com
build: v4.2.0-rc2
date: 2026-06-11
---

# Test Run Report: SCRUM-1234 — 2026-06-11

**Environment:** https://staging.app.example.com | **Build:** v4.2.0-rc2

## Summary

| Total | Passed | Failed | Blocked | Pass rate |
|-------|--------|--------|---------|-----------|
| 14    | 11     | 2      | 1       | 79%       |

By priority: critical 4/4 · high 5/6 · medium 2/3 · low 0/1
Session groups: 14 TCs → 5 groups · setups saved: 9 · fallbacks: 1   ← only when group_ids present

## Results

| TC | Title | Traces | Result | Build | Group | Evidence |
|----|-------|--------|--------|-------|-------|----------|
| TC-031 | Card declined shows error | REQ-104 | PASS | v4.2.0-rc2 | G1 (skipped 2) | [png](screenshots/TC-031_2026-06-11.png) |
| TC-012 | Checkout reordered flow   | REQ-104 | FAIL | v4.2.0-rc2 | G1 ⤳fallback | [png](screenshots/TC-012_2026-06-11.png) |

## Failed / Blocked

### TC-012 — FAIL (App behaviour)
- **Step 4 of 7** — expected redirect to `/payment`, snapshot shows `/address` with validation error "Postal code required"
- **Next step:** genuine defect — qe-lead files it
- Evidence: screenshots/TC-012_2026-06-11.png · console: [] · network: ["POST /api/address → 500"]

## Fix verifications

| Defect | Verdict | Build | Neighbors |
|--------|---------|-------|-----------|
| BUG-88 | verified | v4.2.0-rc2 | TC-031 PASS, TC-014 PASS |

## ⚠ Build-stamp anomalies        ← only when triggered
| TC | Issue |
|----|-------|
| TC-055 | result stamped v4.1.9 — ran against a different build than this run |

## ⚠ Untraced results             ← only when triggered
| TC | Issue |
|----|-------|
| TC-077 | empty `requirements:` — orphan at triangulation |

## Performance Metrics            ← only when usage data present
| TC | Tokens | Tool uses | Duration |
|----|--------|-----------|----------|
```

## Field rules

| Rule | Why |
|---|---|
| `build` in frontmatter **and** per result row | A green from another build is a **stale** finding, not coverage — triangulation needs both to compare |
| `Traces` per row, from the case's `requirements:` | Axis-2/3 of the triangulation key off it; empty → ⚠ Untraced |
| Anomaly sections appear only when triggered | Empty warning sections train readers to skip warnings |
| Verdicts are copied, never re-graded | The reporter classifies failures; the runner's PASS/FAIL stands as emitted |
| `network_failures` / `console_errors` shown per result; a **PASS carrying either gets a ⚠ note** in its row | A clean UI over a failed request may still be a defect — that judgment is the lead's, so the report surfaces it instead of burying it |
| Fix verifications carry neighbor outcomes | A fix that breaks a neighbor case is a finding, not a pass |
