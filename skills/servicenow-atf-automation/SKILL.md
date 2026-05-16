---
name: servicenow-atf-automation
description: Create, run, and inspect ServiceNow Automated Test Framework (ATF) tests programmatically via two proven paths — the official `@servicenow/sdk` Fluent toolchain (`.now.ts` → `now-sdk build`/`install`, version-controlled code, OAuth incl. MFA) and a zero-install Scripted-REST builder ("Path B") that bypasses the platform's `glide_var` Table-API filter. Use whenever the user wants to build an ATF test as code, run an existing ATF test via REST/CLI/SDK, query what tests or step types exist on an instance, or asks why `sys_atf_step.inputs` reads back empty over the Table API. Trigger for phrases like "ATF", "Automated Test Framework", "sys_atf_test", "Fluent SDK", "now-sdk", "create ServiceNow test", "run ATF from CI", "test the form / record / UI on ServiceNow", "build a test for my catalog item", or any ServiceNow test-automation work — even when the user doesn't say "ATF" explicitly.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

# ServiceNow ATF Automation

This skill covers **two proven paths** for ATF tests on any ServiceNow instance:

- **Fluent SDK** (`references/fluent-sdk.md`) — official `@servicenow/sdk`, `.now.ts` as version-controlled code, `now-sdk build`/`install`, OAuth (works with MFA, zero admin provisioning). Proven end-to-end on a live MFA tenant. Use when tests should live in source control.
- **Path B** — a zero-install Scripted-REST builder that bypasses the `glide_var` Table-API filter via server-side GlideRecord. Use for Global-scope tests, Open-Workspace/Custom-UI steps, manual-runner dispatch, or AI-emitted JSON specs.

They are complementary; both land in `sys_atf_test`. **Read `references/fluent-sdk.md` first if the task is "ATF tests as code".** It also documents how to discover step types and existing tests on an instance.

> ⚠ **Universal batching rule** (cost a full debug cycle, applies to BOTH paths): a server-side step (`log`/`record*`/`impersonate`) placed *between* UI steps ends the UI batch and destroys `g_form` — the next UI assertion fails *"g_form is not defined"*. Keep UI steps **contiguous**; batch server steps strictly before/after the UI block. Details: `references/fluent-sdk.md` §6, `references/gotchas.md`.

The skill assumes you have:
- An instance URL, a username, and a password
- The user account holds these roles: `admin` (or at least: `atf_test_admin`, `atf_test_designer`, `atf_ws_designer`)
- Network reach to `/api/now/table/*`, `/api/sn_cicd/*`
- A logged-in ATF Test Runner agent on the instance if you want to **execute** tests (creation works without it)

If any of those are missing, see [references/roles-and-access.md](references/roles-and-access.md) before going further.

## The mental model — why a special approach is needed

`sys_atf_step.inputs` is a `glide_var` field. ServiceNow's public Table API **silently filters** both reads and writes on those dynamic columns — by deliberate architectural choice, not by ACL. This means:

- A POST to `/api/now/table/sys_atf_step` creates the row but **drops the inputs** — the step is functionally empty.
- A GET returns `inputs: ""` even with `admin` — the data exists in storage, just not exposed.
- Even `--type basic` Fluent SDK can't help here because *that filter is below the API layer it talks to*.

What DOES work: **server-side GlideRecord** running inside the platform. Code like `step.inputs.user = '<sys_id>'` writes the real `var__m_*` column. Server scripts (business rules, fix scripts, scripted REST operations) all have this access.

The cleanest, reusable way to expose that capability from outside is a **Custom Scripted REST API** that takes a JSON test spec and uses GlideRecord internally. This skill calls that **Path B**. One-time setup; every subsequent test is a single REST POST.

If you instead want code-in-repo + TypeScript declarative DSL with `now-sdk build && now-sdk install`, see [references/fluent-sdk.md](references/fluent-sdk.md) — a **proven first-class path** (full end-to-end run on a live MFA tenant), not a footnote. The SDK serializes `glide_var` inputs natively, so SDK-authored tests don't need Path B's workaround at all.

## Transport priority — check in this order on every call

**MCP first, bundled scripts second, raw REST last.** Secrets stay out of agent context when an operation goes through MCP, and an MCP-wired project has already invested in permissions / audit the bash scripts can't match. That said, ServiceNow ATF rarely has a dedicated MCP server — so for most projects the bundled scripts ARE the primary path.

1. **MCP tools** — `mcp__<server>__*` for any tool that already covers
   the operation (a project-specific ServiceNow connector, Elitea's
   ServiceNow integration if present, etc.). Discover with the host's
   MCP-listing command (`copilot --list-mcp`, `claude mcp list`, Cursor /
   Windsurf settings panel). Most ServiceNow MCP servers cover record CRUD
   and table queries but NOT the `glide_var` write path this skill needs —
   if all an MCP exposes is `POST /api/now/table/sys_atf_step`, fall
   through to step 2; that endpoint silently drops `var__m_*` inputs (see
   [references/architecture.md](references/architecture.md)).
2. **Bundled scripts** — `scripts/*.sh` co-located with this skill.
   These talk to the **Path B builder** (the Scripted REST API installed
   by `bootstrap_builder.sh`), which runs server-side GlideRecord and
   bypasses the `glide_var` filter. This is the primary author path for
   anything that writes step inputs.
3. **Raw REST** — assemble your own `curl` call to the standard
   ServiceNow endpoints. Reserve for debugging, exotic step types, or
   when both MCP and the bundled scripts are missing the operation.
   `references/api-cheatsheet.md` has copy-pasteable curl for every
   endpoint this skill uses.

If you start an operation on MCP and hit a gap (no glide_var write, auth
error, stale cache), log the gap clearly in your reply, drop down to the
bundled scripts, and surface the gap in your summary so the operator can
fix the MCP config.

Agents are allowed (and encouraged) to fix / extend `scripts/builder_operation.js`
when they hit a missing step type. Use `scripts/discover_steps.sh
<step_config_sys_id>` to learn the input element names, then add them to
`STEP_CONFIGS` and re-run `bootstrap_builder.sh` to redeploy.

## Quick start (5 minutes from zero to first passing test)

Credentials live in your project's `.env` (gitignored). All scripts auto-source it.

```bash
# 1. Add credentials to .env (or copy the slot block from .env.example):
#      SN_ATF_INSTANCE=https://your-instance.service-now.com
#      SN_ATF_USER=your.admin.username       # needs admin or atf_test_admin
#      SN_ATF_PASSWORD=your-password         # store securely; gitignored

# 2. Install the Path B builder API on the instance (one-time, idempotent)
./scripts/bootstrap_builder.sh

# 3. Build a minimal test from a JSON spec
./scripts/build_test.sh assets/example-specs/minimal-impersonate-log.json

# 4. Run it (wraps in a suite, triggers, polls, prints per-step results)
./scripts/run_suite.sh "<test_sys_id>"
```

After step 3 you'll see step descriptions auto-render with the actual values you passed (e.g. `"Impersonate the user: Jane Smith"`) — that's the signal `var__m_*` writes worked. After step 4 you'll see green/red per step.

**Credentials lookup order** (first non-empty wins):
1. Shell environment (`SN_ATF_INSTANCE`, `SN_ATF_USER`, `SN_ATF_PASSWORD`) — useful for one-off overrides
2. `.env` in your project root (walks up to 5 parent directories from `$PWD`) — recommended for everyday use
3. File pointed to by `ATF_ENV_FILE=/abs/path/to/.env` — useful for CI

The loader only imports the three SN_ATF_* keys; it doesn't pollute your shell with other entries from `.env`.

## When to reach for ATF vs. other test approaches

| Want to test… | Use ATF? | Why |
|---|---|---|
| Form behavior on a record type (validators, UI actions, mandatory fields) | **Yes** | ATF runs in-platform, sees real ACLs/business rules/UI policies. |
| End-to-end business workflow inside ServiceNow (case lifecycle, approvals, notifications) | **Yes** | Sequence of impersonations + record assertions; server-side and form steps compose well. |
| Browser/portal UI written in vanilla web (custom JS, third-party widgets) | Often **no** | Use Playwright/Cypress — ATF's UI step support is platform-bound and brittle for non-SN content. |
| REST API contracts of your scripted endpoints | **Yes** | ATF has dedicated REST step types with response assertions. |
| Performance/load | **Yes-ish** | ATF has performance step variants but specialized load tools are usually better. |
| Production smoke (read-only) | Often **no** | ATF impersonates real users and writes real records. Use only against non-prod or with a strict read-only test design. |

## The workflow

Each ATF test has the same shape:

1. **Build** — create `sys_atf_test` + `sys_atf_step` records, populate step inputs.
2. **Wrap** — put the test in a `sys_atf_test_suite` (the run-trigger endpoint takes suites).
3. **Run** — POST `/api/sn_cicd/testsuite/run?test_suite_sys_id=<sys_id>`; get back a progress URL.
4. **Poll** — GET the progress URL until `status_label` is `Successful`, `Failed`, or `Canceled`.
5. **Read results** — query `sys_atf_test_suite_result` for suite-level, `sys_atf_test_result` for test-level, `sys_atf_test_result_step` for per-step output.

Steps 2–5 are uniform across all approaches (they're just standard ServiceNow CI/CD endpoints). Step 1 is where the `var__m_*` filter matters and where this skill differs from naive Table API attempts.

> **`/api/sn_cicd/testsuite/run` requires a `scheduled` runner type.** If your active agent is `type=manual` (a normal logged-in `/atf_test_runner.do` browser session, which is what most devs have), that endpoint will dispatch then immediately Cancel with status_detail "A scheduled client test runner that satisfies these client constraints is not available". Use **`scripts/run_test.sh <test_sys_id>`** instead — it auto-discovers the freshest online manual runner and dispatches via Path B's `action: "run"`. Same poll/result loop, no wrapping in a suite.

## Path B builder — actions beyond `build`

The Path B Scripted REST API at `/api/now/atf_builder/create` started as a one-shot test builder. It now supports **four actions** via the `action` key on the request body. Without `action`, the default behavior is to build a new test.

| Action | Body shape | What it does | Helper script |
|---|---|---|---|
| (none — default) | `{name, description?, active?, failOnServerError?, steps: [...]}` | Creates a new `sys_atf_test` + steps from the spec | `scripts/build_test.sh` |
| `"update"` | `{action:"update", testSysId, steps:[...], name?, description?, ...}` | Replaces an existing test's steps in place — sys_id stable so whitelists, history, and references survive | (use curl + your spec — see `references/api-cheatsheet.md`) |
| `"run"` | `{action:"run", testSysId, runnerSessionId, capturePageData?, retrieveComponentsStep?, useCloudRunner?, isPausingEnabled?, performanceRun?}` | Dispatches to a manual browser runner (bypasses the scheduled-only `/api/sn_cicd/testsuite/run`); optionally triggers the component-capture flow | `scripts/run_test.sh` (regular run) / `scripts/capture_components.sh` (capture run) |
| `"read_step"` | `{action:"read_step", stepSysId}` | Dumps a step's full inputs including the `glide_var` values Table API hides | (curl — see `references/api-cheatsheet.md`) |

## The capture/replay layer — what to use for what

ATF has three ways to interact with UI elements on workspace forms. Pick by interaction type:

| You need to… | Step type | How it works | Catch |
|---|---|---|---|
| Click a stable button (Save, New, list UI action) | Custom UI `Click Component` | `gAutomate.click(mugshot)` — locates by mugshot, fires synthetic click | Works for buttons whose click handler is bound to the element itself |
| Type into a text input | Custom UI `Set Component Values` | Calls the runner's `setValue` on the input | Works when the captured component's `methods` array includes `setValue` |
| Set a **Choice combobox** value (workspace dropdown like Address Classification) | None reliably | Synthetic click on the dropdown option **does not commit** the form's choice value. Native `Test Page` step's `setValue` driver method targets the choice, but requires the `_I` actionable-components registry to be populated, which only happens inside actual test-runner sessions, not on regular page loads. | See `references/gotchas.md` for the full architectural ceiling. **Workaround: drive these from Playwright with CDP trusted events; use ATF for everything else.** |
| Capture component locators (mugshots) for use in subsequent steps | n/a — use Path B `action:"run"` with `retrieveComponentsStep` | Triggers ServiceNow's official ATF component-capture flow (same one Test Designer's "Record Page Components" button uses). Components land in `sys_atf_ui_component` keyed to a new `sys_atf_snapshot`. | `scripts/capture_components.sh <test> <step>` and `scripts/find_components.sh <snapshot> <query>` |

### Component capture in 30 seconds

```bash
# 1. Build a small test with at least one navigation step (e.g., open_workspace)
./scripts/build_test.sh my-spec.json   # returns <test_sys_id>

# 2. Capture components after that step's post-state
./scripts/capture_components.sh <test_sys_id> <navigation_step_sys_id>
# → returns <snapshot_sys_id> + component count

# 3. Find specific components (returns full mugshot JSON ready to paste)
./scripts/find_components.sh <snapshot_sys_id> "Save"
./scripts/find_components.sh <snapshot_sys_id> --tag input --has-method setValue

# 4. Paste the locator JSON as the `component` input of a Custom UI step
#    in your next spec — no need for mugshots_cache_json or the broken
#    Test Designer Recording UI flow.
```

This was a major reverse-engineering find: ServiceNow's component capture works fine via the headless `action:"run"` + `retrieveComponentsStep` path on Path B — the visible Test Designer UI is just a convenience wrapper. The skill ships both layers so you can capture programmatically and reference results in subsequent specs.

## Ignoring known platform errors per-test

ATF treats any client-side JS error as a step failure. Some pages emit benign errors during init (e.g., `Uncaught TypeError: t is not iterable` on certain workspace lists, `Data broker execution for direct load failed` on `csm_consumer` direct loads). Downgrade them to warnings without modifying the test:

```bash
./scripts/whitelist_error.sh <test_sys_id> "Uncaught TypeError: t is not iterable"
```

The whitelist is per-test (writes a row to `sys_atf_whitelist` filtered to your test's sys_id), so it doesn't pollute other tests.

## The JSON spec format

`build_test.sh` accepts a JSON document like:

```json
{
  "name": "Customer creates ticket and agent closes it",
  "description": "End-to-end happy path for our self-service portal",
  "active": true,
  "failOnServerError": true,
  "steps": [
    { "type": "impersonate", "user": "<sys_user sys_id>" },
    { "type": "log", "log": "Phase 1: customer submits" },
    {
      "type": "record_query",
      "table": "sys_user",
      "field_values": "user_name=alice",
      "assert_type": "records_match_query"
    },
    {
      "type": "record_insert",
      "table": "incident",
      "field_values": "short_description=Test^urgency=2"
    }
  ]
}
```

Spec rules — read these once, save yourself debugging time:

1. `steps` is an ordered array. Each item has a `type` (one of the keys in the step-type map) plus the inputs that step type expects.
2. **Inputs are passed by element name** — not by display label. Use `user`, not `User`; `field_values`, not `Conditions`. See [references/step-types-reference.md](references/step-types-reference.md) for each step type's input schema.
3. **References** (user, table, record_id) take **sys_ids** (or the user_name / table_name in some contexts). Always prefer sys_ids — names work for sys_user / table_name but break for ambiguous values.
4. **Encoded queries** (the `field_values` input on Record Query/Validation/Update) use standard ServiceNow syntax: `field=value^otherField=otherValue`. Do **not** append `^EQ` — that's an internal terminator the system adds; if you include it explicitly the query may fail silently.
5. **Choice fields** like `assert_type` take their **stored value**, not the label. For `assert_type` the default is `records_match_query`; for things like `state` use the integer (`3`, not `"Closed"`). When in doubt, query an OOTB step of the same type and look at its description rendering vs. its stored values.

Example specs that work out of the box are under `assets/example-specs/`.

## What to do when something fails

Failures generally fall into three buckets — diagnose by where the failure surfaces:

| Symptom | Likely cause | Fix |
|---|---|---|
| `POST /api/now/atf_builder/create` returns HTTP 4xx with `Unknown step type` | Step type not in the map | Add it to `STEP_CONFIGS` in `scripts/builder_operation.js` and reinstall, or use one of the supported types. See [references/step-types-reference.md](references/step-types-reference.md) for the full instance-side discovery. |
| POST succeeds, but step description shows partial / wrong values | Input element name mismatch (e.g. you passed `User` instead of `user`) | See `references/step-types-reference.md` for canonical element names. Run `scripts/discover_steps.sh <step_config_sys_id>` to list real input variables for any step type on your instance. |
| Test runs but step fails with `FAILURE: ...` | Real test logic — your data doesn't match the assertion, or `assert_type` is wrong | Re-read the step's output message. Common: `assert_type` defaulting to something other than `records_match_query`; choice values being labels instead of stored integers; encoded query referencing a field that doesn't exist on the table. |
| Suite triggered but `Skipped` for everything | No online Test Runner agent | Have someone log in to `/atf/agent.do` in a browser to bring an agent online. Check `sys_atf_agent` for `status=Online`. |
| `Requested URI does not represent any resource` for a `/api/...` endpoint | Wrong base_uri (the path includes a namespace) | Standard SN scripted REST APIs are at `/api/<namespace>/<service_id>/<relative_path>`. For OOTB APIs that namespace is `now` — so the full path is `/api/now/<service_id>/...`, not `/api/<service_id>/...`. |
| `User Not Authenticated` with valid creds | The endpoint requires UI session, not basic auth, OR MFA is required for the route | This skill avoids those endpoints. If you must hit one, use OAuth — see [references/roles-and-access.md](references/roles-and-access.md) for the OAuth setup. |

More gotchas live in [references/gotchas.md](references/gotchas.md).

## Discovering what already exists on the instance

The skill ships with two browse-and-discover scripts for exploring an unfamiliar instance:

### Step type catalog — what methods are available

```bash
# Count by category (quick overview)
./scripts/discover_steps.sh --categories

# Full catalog: every step type, grouped by category, with sys_ids
./scripts/discover_steps.sh

# Inputs for one specific step type — required when extending the spec to new types
./scripts/discover_steps.sh <step_config_sys_id>
```

A standard instance ships with ~102 step types across 13 categories (Server, Form, Service Portal, REST, Email, etc.). The third form is the canonical way to learn what inputs to put in your spec for a step type that isn't pre-mapped — it queries `atf_input_variable` for the element names, types, mandatory flags, and default values.

### Test catalog — what's already built

```bash
# Overall stats: total/active counts, top creators
./scripts/explore_tests.sh

# Browse: list 30 tests with descriptions (--active to filter to active-only, --limit N)
./scripts/explore_tests.sh --list

# Search by keyword (matches name OR description, case-insensitive LIKE)
./scripts/explore_tests.sh --search "manage name"

# Find tests touching a specific table (matches Record Query/Validation steps)
./scripts/explore_tests.sh --by-table incident

# REVERSE-ENGINEER: emit a Path B JSON skeleton for an existing test
# — perfect for "I want to use this OOTB test as a template for my own"
./scripts/explore_tests.sh --dump <test_sys_id>

# DEEP INSPECT: one test's full structure (steps + descriptions)
./scripts/inspect_test.sh <test_sys_id>
./scripts/inspect_test.sh --name "manage"        # search by name (LIKE)
```

`--dump` is the killer feature: it reads an existing test (OOTB or custom) and produces a JSON skeleton in this skill's spec format, with each step's auto-rendered description preserved as a `__description_from_source` field. Copy the JSON, fill in the actual input values from the descriptions, and you have a spec ready for `build_test.sh` — far faster than starting from scratch.

For ad-hoc queries (custom filters, deeper introspection), see [references/api-cheatsheet.md](references/api-cheatsheet.md) — every endpoint this skill uses with copy-pasteable curl.

## A note on test design

The build-and-run loop being easy doesn't mean test design is easy. The same things that make a Playwright/Cypress test good apply: assertions on user-visible state, no flakiness, no shared mutable fixtures, one scenario per test. ATF additionally encourages:

- **Impersonate early and impersonate explicitly** at each role boundary — don't rely on the test runner's logged-in user.
- **Assert on what the user would see**, not on internal sys_ids. `record_validation` against a queryable predicate beats hardcoded sys_id lookups.
- **Set up via `record_insert`** rather than via the UI when the UI step isn't what's being tested — faster, less brittle.
- **Avoid stateful chains** where Step N depends on output from Step M-3 unless that's exactly what you're testing — fragility compounds.

## Reference index

Read these on demand:

| File | When to read |
|---|---|
| [references/architecture.md](references/architecture.md) | "Why doesn't the Table API work for `inputs`?" — the full explanation of the `glide_var` filter and the server-side bypass. |
| [references/roles-and-access.md](references/roles-and-access.md) | Setting up roles, dealing with MFA, OAuth alternative, runner agent lifecycle. |
| [references/step-types-reference.md](references/step-types-reference.md) | The 18 pre-mapped step types, their input schemas, and how to discover more on your instance. |
| [references/spec-schema.md](references/spec-schema.md) | The full JSON spec language (every supported field, every constraint). |
| [references/gotchas.md](references/gotchas.md) | The known traps — `assert_type` values, encoded query syntax, MFA paths, namespace prefixes, choice fields vs labels. |
| [references/api-cheatsheet.md](references/api-cheatsheet.md) | Every endpoint with curl examples — build, run, poll, results, discovery, cleanup. |
| [references/fluent-sdk.md](references/fluent-sdk.md) | **Proven first-class path** — `@servicenow/sdk` Fluent (`.now.ts`). Setup, OAuth-with-MFA (zero admin), the `fluentDir` trap, literals-only AST, additive-install orphan remedy, the batching rule, classic-vs-workspace field-state, whitelist + calibration loop. Read this for "ATF tests as code". |

## Script index

Under `scripts/`:

| Script | Purpose |
|---|---|
| `_env.sh` | Shared. Sourced by every other script. Walks up from `$PWD` to find `.env`, imports `SN_ATF_INSTANCE` / `SN_ATF_USER` / `SN_ATF_PASSWORD`. Shell env vars override `.env`. |
| `bootstrap_builder.sh` | One-time per instance. Creates the `atf_builder` Scripted REST API. Idempotent — safe to re-run. |
| `builder_operation.js` | The server-side GlideRecord script that lives inside the Scripted REST operation. Edit this to add/change step types. |
| `build_test.sh <spec.json>` | POSTs a spec to the builder. Prints the new test's sys_id and per-step descriptions. |
| `run_suite.sh <test_sys_id> [name]` | Wraps the test in a fresh suite, triggers a run, polls progress, prints per-step results. |
| `discover_steps.sh [--categories | step_config_sys_id]` | Step-type catalog: `--categories` for counts, no-arg for full list, sys_id for input schema. |
| `explore_tests.sh [--list / --search / --by-table / --dump]` | Test catalog: stats, listing, search, reverse-engineer existing tests into Path B JSON specs. |
| `inspect_test.sh <test_sys_id \| --name pattern>` | Deep inspect: single test's full step list with descriptions, or name search. |

All scripts read credentials from `.env` via `_env.sh`. None hardcode an instance.
