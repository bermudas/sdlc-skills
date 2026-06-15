---
id: TC-NNN
title: <verb + subject, e.g. "Login with valid credentials">
priority: critical     # critical | high | medium | low
type: functional       # functional | regression | smoke | integration | exploratory
module: <feature area>
requirements: [REQ-NNN]  # REQUIRED — every QE case traces to ≥1 requirement id
tags: []               # [smoke, login, happy-path]
precondition_state:    # optional state contract, e.g. logged-in:standard-user@home (enables session grouping)
postcondition_state:   # state left behind on PASS, same vocabulary
setup_steps: 0         # leading steps an inherited session may skip (login/navigation)
---

# TC-NNN: <Title>

**Module:** <Module> | **Priority:** <Priority> | **Type:** <Type> | **Traces:** <REQ-NNN>

## Preconditions
- App is reachable at `{{base_url}}`
- <List each prerequisite as a concrete, verifiable fact>

## Test Data

| Field | Value |
|-------|-------|
| <Field name> | <Literal value> |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | <One action — verb + object> | <Measurable expected outcome> |
| 2 | | |
| 3 | | |

## Expected Final State
<Single paragraph describing the overall end state after all steps complete successfully.>

## Teardown
- <Step to clean up, e.g. "Navigate to `{{base_url}}/logout`">
- _(Remove this section if test leaves no persistent state)_
