# Test Case Format Specification

QE authors **manual** test cases in this format — plain Markdown, executed by
hand against the running build. Every case **traces to a requirement** (the
`requirements:` field is mandatory here — it's what the triangulation keys off).
This is **not** an Automation-Friendly Spec for a downstream automation engineer;
it's a finished manual case a human (or an isolated executor dispatch) runs as-is.

## File Location & Naming

```
test-cases/
  <suite-name>/
    TC-001_<slug>.md
    TC-002_<slug>.md
    ...
```

- **Suite name** = feature or requirement area: `checkout`, `authentication`, `REQ-101-tax`
- **ID format** = `TC-` + 3-digit zero-padded number: `TC-001`, `TC-042`
- **Slug** = lowercase, hyphens: `login-valid-credentials`, `forgot-password-flow`

---

## What Makes a Good Test Case

| ✅ Good | ❌ Bad |
|--------|--------|
| Traces to a specific requirement id | No `requirements:` — an **orphan** in triangulation |
| Tests exactly ONE behaviour | Multiple conditions bundled together |
| Preconditions are explicit and literal | "System is ready" (vague) |
| Each step = one verb + one object | Steps that contain multiple actions |
| Expected result is measurable (`redirects to /dashboard`) | "Login works" |
| Self-contained — no dependency on other test cases | Assumes prior test ran and set up state |
| Test data values are literal (`test@example.com`) | "Enter any valid email" |
| Failure is easy to pinpoint | 20-step monolith — impossible to isolate |

---

## File Format (Full Template with Annotations)

```markdown
---
id: TC-001
title: Login with valid credentials          # short, verb+object
priority: critical                           # critical | high | medium | low
type: functional                             # functional | regression | smoke | integration | exploratory
module: authentication                       # feature area
requirements: [REQ-001, REQ-002]             # REQUIRED — the requirement id(s) this case proves
tags: [smoke, login, happy-path]             # free-form, used for filtering
---

# TC-001: Login with Valid Credentials

**Module:** Authentication | **Priority:** Critical | **Type:** Functional / Smoke | **Traces:** REQ-001, REQ-002

## Preconditions
- App is reachable at `{{base_url}}`
- Test user exists: email=`test@example.com`, password=`Test1234!`
- Browser cache and cookies are cleared

## Test Data

| Field    | Value              |
|----------|--------------------|
| Email    | test@example.com   |
| Password | Test1234!          |

## Steps

| # | Action                                             | Expected Result                              |
|---|----------------------------------------------------|----------------------------------------------|
| 1 | Navigate to `{{base_url}}/login`                   | Login page loads, Email and Password visible |
| 2 | Fill Email field with `test@example.com`           | Email value is set                           |
| 3 | Fill Password field with `Test1234!`               | Password input is masked                     |
| 4 | Click "Sign In" button                             | Page redirects to `/dashboard`               |
| 5 | Check page header for text "Welcome, Test User"    | Welcome message is visible                   |

## Expected Final State
User is authenticated and on the dashboard. No error messages visible. URL is `{{base_url}}/dashboard`.

## Teardown
- Navigate to `{{base_url}}/logout`
```

---

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Never reuse or reassign. |
| `title` | Yes | Concise name. Start with a verb: "Login with...", "Submit form when...", "Verify that..." |
| `priority` | Yes | `critical` = blocks release if fails; `high` = major feature; `medium` = secondary; `low` = cosmetic |
| `type` | Yes | `smoke` = quick sanity; `functional` = feature logic; `regression` = verifying no breakage; `integration` = cross-system; `exploratory` = freeform |
| `module` | Yes | The feature/component under test |
| `requirements` | **Yes** | The requirement id(s) this case proves. **Mandatory in QE** — a case with no requirement is an orphan and is flagged in triangulation (axis 2). |
| `tags` | No | Arbitrary labels for filtering runs (e.g. `smoke`, `slow`, `needs-2fa`) |
| `precondition_state` | No | **State contract** — a short label for the app state this case starts from (e.g. `logged-in:standard-user@home`). Enables session grouping (see below). Absent → the case is *ungroupable* and always gets a full setup. |
| `postcondition_state` | No | The state this case leaves behind on PASS (same label vocabulary). The session planner chains a case whose `precondition_state` exactly matches the previous case's `postcondition_state`. |
| `setup_steps` | No | How many leading steps are pure setup (login, navigation) that an `inherit_state` run may skip. Default `0` — without it, chaining still works but saves nothing. |
| Preconditions | Yes | Exact system state before test starts. Each bullet is a verifiable fact. |
| Test Data | If applicable | All literal values used in steps. Makes test data easy to change in one place. |
| Steps table | Yes | # / Action / Expected Result — one row per action |
| Expected Final State | Yes | Single paragraph describing the overall end state |
| Teardown | No | Steps to clean up after test. Required if test creates data or modifies persistent state. |

---

## State contracts & session grouping

Self-containment stays the rule — every case **must** be runnable standalone
from step 1. The state-contract fields don't weaken that; they declare, for the
session planner, when consecutive cases *may* share a live session instead of
paying a fresh setup each (login + navigation, and a separate runner dispatch).
The qe-lead chains cases whose contracts match into **session groups**
(`session_plan.md`, format in `session-plan-format.md`); the runner **verifies**
an inherited state before trusting it and falls back to a full reset on
mismatch — deliberate inheritance, never accidental leakage. Cases without
contracts simply never group: correct, just slower.

## The `{{base_url}}` Placeholder

All URLs in the case use `{{base_url}}` as a prefix. The executor substitutes the
real URL at run time, keeping cases environment-agnostic (dev, staging, QA). The
build/version actually exercised is recorded with the **result**, not in the case
— that's what lets triangulation flag a stale green.

**Example:** `{{base_url}}/login` → `https://staging.app.com/login`

---

## Priority Definitions

| Priority | Meaning | Typical examples |
|----------|---------|-----------------|
| `critical` | Core user journey — failure blocks release | Login, checkout, data save |
| `high` | Important feature — failure warrants urgent fix | Search, filters, notifications |
| `medium` | Secondary feature — fix in next cycle | Sorting, pagination, tooltips |
| `low` | Cosmetic or edge case — low urgency | UI spacing, copy typos |
