# Session Plan Format Specification

Session grouping lets consecutive **state-compatible** cases share one live
browser session — and, in this team's dispatch model, one `test-runner`
dispatch per **group** instead of per case. The qe-lead builds the plan before
the execute stage; the runner executes a group with verified state inheritance.
(Design adapted from the manual-qa `mobile-testing` skill's session planning —
PR #40 — generalized from app sessions to browser sessions.)

## Cost split — replay set vs execute set (before grouping)

The lead first splits the run list by **re-run cost**:

- **Replay set** — cases carrying a valid `automated_spec` (codified on an
  earlier green run) that this change does **not** touch. These re-run
  deterministically via MODE REPLAY (`npx playwright test` + visual-check) —
  near-zero tokens, no live session, **no session grouping needed.**
- **Execute set** — authoring-delta cases, rewritten cases, anything the curator
  flagged as touched, and any case without a spec. These get a full MODE EXECUTE
  (and a clean pass is codified there for next time).

Only the **execute set** is session-grouped below. A replay drift-FAIL (the spec
no longer runs because the app moved) bounces that case back into the execute
set. Record the split (N replay / M execute) in the trail alongside the groups.

## The grouping algorithm (qe-lead, stage 5a)

1. Take the **execute set** (authoring-delta cases + the touched/un-codified part
   of the regression scope), in run order.
2. Read each case's frontmatter: `precondition_state`, `postcondition_state`,
   `setup_steps`. Either state field absent → the case is **ungroupable**.
3. Walk the list; start a **new group** whenever:
   - the current case is ungroupable, **or**
   - the previous case's `postcondition_state` does **not exactly match** the
     current case's `precondition_state`.
4. Within a group: first case `inherit_state: false`; each subsequent case
   `inherit_state: true`.

No contract, no chaining — ungroupable cases run exactly as before (own group,
full setup). Grouping is an optimization, never a correctness dependency.

## The artifact — `{suite_or_run_dir}/session_plan.md`

YAML frontmatter (machine-read by the lead) + a short human summary:

```yaml
---
run_id: RUN-2026-06-11-001
generated: 2026-06-11
generated_for_tc_ids: [TC-001, TC-002, TC-003, TC-004, TC-005]
tc_count: 5
group_count: 2
groups:
  - group_id: G1
    tcs:
      - {id: TC-001, file: test-cases/smoke/TC-001_login.md,        inherit_state: false}
      - {id: TC-002, file: test-cases/smoke/TC-002_product-list.md, inherit_state: true}
      - {id: TC-003, file: test-cases/smoke/TC-003_add-to-cart.md,  inherit_state: true}
  - group_id: G2
    tcs:
      - {id: TC-005, file: test-cases/smoke/TC-005_logout.md, inherit_state: false}
---

# Session Plan — RUN-2026-06-11-001

5 TCs → 2 session groups. Setups saved: 3.

| Group | TC | Title | inherit_state |
|-------|----|-------|---------------|
| G1 | TC-001 | Login with valid credentials | false |
| …

**Ungroupable** (no state contract — always a fresh setup): TC-004
```

`generated_for_tc_ids` is the staleness check: if the current run list differs,
the plan is regenerated, never partially reused.

## Execution semantics (test-runner, per group dispatch)

- `inherit_state: false` → full setup from step 1 (fresh context: clear
  session/cookies or re-login per the case's preconditions).
- `inherit_state: true` → **verify first**: snapshot the current state and
  confirm it matches the case's `precondition_state` *before* trusting it.
  Match → skip the first `setup_steps` steps (`steps_skipped` recorded).
  Mismatch — including after a previous case's FAIL — → **fall back to the
  full-setup path** and record `fallback_occurred: true`. Inheritance is
  always verified, never assumed.
- A FAIL stops that case (never its group): record it, then continue with the
  next case — whose precondition check will trigger the fallback reset if the
  failure broke the chain.
- Every case still emits its own JSON verdict (the group dispatch returns an
  array), each carrying `group_id`, `steps_skipped`, `fallback_occurred`.

## Why this is safe

The isolation rule is untouched: every case must still run standalone
(`inherit_state: false` path is always available and always correct). The
contract fields only *declare* compatibility; the runner's precondition
verification is what makes inheritance trustworthy. Test-isolation failures
("leftover state") remain distinguishable: deliberate inheritance is recorded
(`inherit_state`/`steps_skipped`), accidental leakage is not.
