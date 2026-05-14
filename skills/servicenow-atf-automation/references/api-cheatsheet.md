# API Cheatsheet

Every endpoint this skill uses, with copy-pasteable curl. All commands assume credentials are loaded from `.env`:

```bash
# Load .env-sourced credentials (same way the skill's scripts do).
# Adjust the path to wherever the skill is installed — e.g. for Claude Code
# that's `.claude/skills/servicenow-atf-automation/scripts/_env.sh`, for
# Cursor `.cursor/skills/...`, for the monorepo itself
# `skills/servicenow-atf-automation/scripts/_env.sh`.
source skills/servicenow-atf-automation/scripts/_env.sh && require_creds

# Then $SN_ATF_INSTANCE and $ATF_AUTH are available for the curl examples below.
# If you'd rather use one-off shell vars:
#   export SN_ATF_INSTANCE="https://your-instance.service-now.com"
#   export SN_ATF_USER="your.username"
#   export SN_ATF_PASSWORD="your-password"
#   ATF_AUTH="$SN_ATF_USER:$SN_ATF_PASSWORD"
```

## Build

### POST a spec to the Path B builder

```bash
curl -X POST -u "$ATF_AUTH" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  --data-binary @spec.json \
  "$SN_ATF_INSTANCE/api/now/atf_builder/create"
```

Returns 201 with `{test_sys_id, steps_created, errors}` on full success, 207 on partial.

### Inspect an existing ATF test (read its shape)

```bash
# Test metadata
curl -sS -u "$ATF_AUTH" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test/<sys_id>"

# Test's steps, ordered
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_step?sysparm_query=test=<test_sys_id>^ORDERBYorder&sysparm_fields=order,description,step_config.name&sysparm_display_value=true"
```

### List ATF tests matching criteria

```bash
# All active tests
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test?sysparm_query=active=true&sysparm_fields=name,sys_id,description&sysparm_limit=50"

# Tests created by a specific user
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test?sysparm_query=sys_created_by=<username>&sysparm_fields=name,sys_id,sys_created_on&sysparm_display_value=true"

# Tests touching a specific table (via Record Query / Record Validation steps)
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_step?sysparm_query=descriptionLIKE<table_name>^step_configIN2d82e3c7531400109e02ddeeff7b12a7,1f39a288df60220062fe6c7a4df2639d&sysparm_fields=test.name,test.sys_id,description&sysparm_limit=30&sysparm_display_value=true"
```

## Run

### Trigger a test suite

```bash
curl -X POST -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/sn_cicd/testsuite/run?test_suite_sys_id=<suite sys_id>"
```

Returns `{result: {status_label: "Pending", links: {progress: {url: "..."}}}}`.

### Poll progress

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/sn_cicd/progress/<progress_id>"
```

`status_label` cycles `Pending → Running → Successful | Failed | Canceled`. Poll every 3–10 seconds.

### Cancel a queued/running execution

```bash
# Cancel via the progress endpoint (DELETE — confirms with the CI/CD layer)
curl -X DELETE -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/sn_cicd/progress/<progress_id>"
```

## Results

### Suite-level result

```bash
# By results URL (from the trigger response's links.results.url)
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/sn_cicd/testsuite/results/<result_sys_id>"

# By querying the table directly
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test_suite_result?sysparm_query=test_suite=<suite_sys_id>^ORDERBYDESCsys_created_on&sysparm_fields=status,duration,sys_created_on&sysparm_display_value=true&sysparm_limit=1"
```

### Per-test result

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test_result?sysparm_query=test=<test_sys_id>^ORDERBYDESCsys_created_on&sysparm_fields=sys_id,status,output,sys_created_on&sysparm_display_value=true&sysparm_limit=3"
```

### Per-step result (which step failed and why)

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test_result_step?sysparm_query=test_result=<test_result_sys_id>&sysparm_fields=step.order,step.step_config.name,status,output,start_time&sysparm_display_value=true"
```

## Discovery

### All step types on the instance

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_step_config?sysparm_fields=name,sys_id,category&sysparm_display_value=true&sysparm_limit=200"
```

### Input variables for a specific step type

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/atf_input_variable?sysparm_query=model_id=<step_config_sys_id>^ORDERBYorder&sysparm_fields=element,column_label,internal_type,reference,mandatory,default_value&sysparm_display_value=true"
```

### Online ATF Test Runner agents

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_agent?sysparm_query=status=Online&sysparm_fields=sys_id,user.user_name,last_check_in&sysparm_display_value=true"
```

### List all scripted REST APIs (e.g. to verify Path B is installed)

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_ws_definition?sysparm_query=service_id=atf_builder^ORnameSTARTSWITHATF&sysparm_fields=name,service_id,base_uri,active&sysparm_display_value=true"
```

### Verify the user's roles include `admin` / `atf_*`

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_user_has_role?sysparm_query=user.user_name=$SN_ATF_USER^role.nameINadmin,atf_test_admin,atf_test_designer&sysparm_fields=role.name&sysparm_display_value=true"
```

## Cleanup

### Delete a test (cascades to its steps)

```bash
curl -X DELETE -u "$ATF_AUTH" "$SN_ATF_INSTANCE/api/now/table/sys_atf_test/<test_sys_id>"
```

### Delete a suite

```bash
curl -X DELETE -u "$ATF_AUTH" "$SN_ATF_INSTANCE/api/now/table/sys_atf_test_suite/<suite_sys_id>"
```

### Bulk delete tests matching a name pattern (CAREFUL — destructive)

```bash
# Step 1: list what would be deleted (always do this first)
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test?sysparm_query=nameSTARTSWITH<your_namespace_prefix>&sysparm_fields=name,sys_id" \
  | python3 -m json.tool

# Step 2: if the list is what you expect, delete one by one
for SYSID in <sys_id_1> <sys_id_2> ...; do
  curl -X DELETE -u "$ATF_AUTH" "$SN_ATF_INSTANCE/api/now/table/sys_atf_test/$SYSID"
done
```

Bulk DELETE via query isn't available on the public Table API — you must iterate. This is intentional friction so you don't nuke things accidentally.

## Tables — quick reference

| Table | Purpose |
|---|---|
| `sys_atf_test` | The test itself |
| `sys_atf_step` | Steps belonging to a test |
| `sys_atf_step_config` | Available step types (`Impersonate`, `Log`, etc.) |
| `atf_input_variable` | Schema of input variables per step type |
| `sys_atf_test_suite` | Suite (collection of tests) |
| `sys_atf_test_suite_test` | Many-to-many: tests in suites |
| `sys_atf_test_suite_result` | Suite execution result |
| `sys_atf_test_result` | Per-test result (one per test run) |
| `sys_atf_test_result_step` | Per-step result (one per step per test run) |
| `sys_atf_agent` | Registered Test Runner agents |
| `sys_ws_definition` | Scripted REST API (where Path B lives) |
| `sys_ws_operation` | Operations on a Scripted REST API |

## Path B custom actions (in-place test management)

The Path B builder operation `/api/now/atf_builder/create` accepts an `action` field on the JSON body. Without an action, it builds a new test (default behavior). With one, it operates on existing records.

### `action: "update"` — replace an existing test's steps in place

Same shape as build, but pass `testSysId`. The test's sys_id stays stable so whitelists, run history, and external references survive. All existing `sys_atf_step` rows for the test are deleted, then re-created from the spec.

```bash
curl -X POST -u "$ATF_AUTH" \
  -H "Content-Type: application/json" \
  --data-binary @- "$SN_ATF_INSTANCE/api/now/atf_builder/create" <<'JSON'
{
  "action": "update",
  "testSysId": "<existing test sys_id>",
  "name": "Updated name (optional)",
  "description": "Updated description (optional)",
  "steps": [ /* same spec format as build */ ]
}
JSON
```

Returns `{mode: "update", test_sys_id, test_name, steps_replaced, steps_created}`.

### `action: "run"` — dispatch a test to a manual browser runner

`/api/sn_cicd/testsuite/run` requires a `scheduled` runner type. The `run` action here dispatches to a `manual` runner — i.e., a user who opened `/atf_test_runner.do` in their browser. The runner's `session_id` lives on `sys_atf_agent` (find via the table when the runner is online).

```bash
curl -X POST -u "$ATF_AUTH" \
  -H "Content-Type: application/json" \
  --data-binary @- "$SN_ATF_INSTANCE/api/now/atf_builder/create" <<'JSON'
{
  "action": "run",
  "testSysId": "<test sys_id>",
  "runnerSessionId": "<sys_atf_agent.session_id>",
  "capturePageData": true,
  "useCloudRunner": false,
  "isPausingEnabled": false,
  "performanceRun": false
}
JSON
```

Returns `{dispatched: true, test_sys_id, runner_session_id, runner_agent_sys_id, runner_browser, execution_tracker_sys_id}` — poll the tracker for state.

### `action: "read_step"` — dump a step's full inputs (bypass glide_var filter)

```bash
curl -X POST -u "$ATF_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"action":"read_step","stepSysId":"<step sys_id>"}' \
  "$SN_ATF_INSTANCE/api/now/atf_builder/create"
```

Returns `{sys_id, test, step_config, step_config_name, order, description, mugshots_cache_json, inputs: {...}}` — `inputs` includes the actual `var__m_*` values that Table API hides.

## Whitelist client errors per-test (escape hatch for known platform bugs)

Some workspace pages emit client JS errors during init that aren't actually fatal (e.g., `Uncaught TypeError: t is not iterable` on certain list loads). ATF treats every client error as a step failure by default. Add a per-test whitelist row to downgrade specific error patterns to warning:

```bash
curl -X POST -u "$ATF_AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "test": "<test sys_id>",
    "error_message": "Uncaught TypeError: t is not iterable",
    "report_level": "warning",
    "active": "true",
    "description": "Known platform issue — page renders despite this"
  }' \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_whitelist"
```

Or via the test result UI: click "Add all client errors to ignored list" — the UI action `253cece56787030091d005225685ef95` does the same insert.

`report_level` values:
- `warning` — step still passes; error becomes a warning attached to the result
- `ignored` — error is hidden entirely

## Component capture infrastructure

When you dispatch a run with `capturePageData: true`, the ATF runner serializes the workspace's DOM state at certain points (Custom UI step boundaries) into:

- `sys_atf_snapshot` — one row per captured page state (URL + metadata)
- `sys_atf_ui_component` — many rows per snapshot, one per actionable component, each row carries the full mugshot JSON in `locator`

To find what was captured during a specific run, query by `sys_created_by`/`sys_created_on` or by URL:

```bash
curl -sS -u "$ATF_AUTH" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_snapshot?sysparm_query=ORDERBYDESCsys_created_on&sysparm_fields=sys_id,url,sys_created_on&sysparm_limit=10"

curl -sS -u "$ATF_AUTH" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_ui_component?sysparm_query=snapshot=<snapshot_sys_id>^tag=button^textSTARTSWITHSave&sysparm_fields=hash,locator&sysparm_limit=5"
```

The `locator` field contains the full mugshot JSON the Custom UI step's `component` input expects when used inline (skipping the `mugshots_cache_json` cache). This lets you reference components without ever populating the cache:

```json
{ "type": "click_component", "component": "<paste the locator JSON string here>" }
```

This is the workaround for the JSON-column write quirk — `mugshots_cache_json` round-trips through ServiceNow's `json` type and strips contents on write; inlining via `inputs.component` bypasses the cache entirely.

## Programmatic component capture (NO Test Designer UI needed)

Path B's `action: "run"` already supports the official ATF component-capture flow — just pass `retrieveComponentsStep` with the sys_id of the step whose post-state should be captured. The runner executes the test up to and including that step, then halts, captures the resulting DOM into `sys_atf_snapshot` + `sys_atf_ui_component`, and rolls back. Subsequent steps in the test are skipped with the message *"This step didn't execute since the test was run to retrieve components for a previous step"*.

```bash
curl -X POST -u "$ATF_AUTH" \
  -H "Content-Type: application/json" \
  --data-binary @- "$SN_ATF_INSTANCE/api/now/atf_builder/create" <<'JSON'
{
  "action": "run",
  "testSysId": "<test sys_id with at least one navigation step>",
  "runnerSessionId": "<online sys_atf_agent.session_id>",
  "capturePageData": true,
  "retrieveComponentsStep": "<sys_atf_step.sys_id whose post-state you want>"
}
JSON
```

**To capture a specific page state:** add a navigation step (`open_workspace`, `open_existing_record`, etc.) to your test that gets to the page, then call this with `retrieveComponentsStep` = that step's sys_id. Hundreds of component locators get written into `sys_atf_ui_component` scoped to the resulting snapshot.

**Then read them by snapshot:**

```bash
curl -sS -u "$ATF_AUTH" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_ui_component?sysparm_query=snapshot=<snapshot_sys_id>^tag=input^locatorLIKEsetValue&sysparm_fields=hash,locator&sysparm_limit=30"
```

The `locator` JSON has everything a Custom UI / Test Page step needs to reference the component:
- `sn_atf_mugshot_short_description`, `aria-label` — what the component is
- `methods` — what gAutomate methods are available on it (e.g. `["click", "setValue"]`)
- `hash` — stable identity across renders (computed from element properties, not random per-render)
- `interesting_element_path` — DOM path the runner uses to locate it

**Pass the full locator JSON as `component` input** in your Click Component / Set Component Values / Assert Text on Page (Custom UI) step — this bypasses the buggy `mugshots_cache_json` JSON-column write and the runner's getMugshot() fallback handles it natively.

## What the capture buys you (and what it doesn't)

**Buys:** any component with `setValue` in its `methods` array — text inputs, comboboxes that take string values, date inputs — can now be driven via `Set Component Values`. Any component with `click` in its `methods` can be driven via `Click Component`. The captured mugshots are stable across runs.

**Does NOT buy:** workspace Choice combobox option SELECTION. Even with a perfect mugshot of the Choice dropdown option, the runner's `gAutomate.click()` fires a synthetic click event, which workspace Choice components ignore (they require trusted browser events OR direct driver method calls). The option's `methods` array shows only `["click"]` — the driver's `setValue` exists but isn't exposed as a callable ATF action. This is the documented ceiling for `Set Component Values`/`Click Component` against workspace forms with Choice fields.

**Path forward for Choice fields:** the native `Test Page` step calls `uxf.doATFAction(funcName, args, componentId, parentMacroponent)` which targets the driver method directly. But it requires the `_I` (actionable-components) registry to be populated — that registry is bootstrapped only in actual ATF test-runner sessions with proper context. Capturing components via `retrieveComponentsStep` does NOT populate `_I` for subsequent regular runs. The cleanest workaround: drive the UI portion in Playwright (CDP fires trusted events that commit Choice fields cleanly) and use ATF for server-side data validation.
