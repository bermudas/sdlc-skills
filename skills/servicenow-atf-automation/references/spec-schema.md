# Spec Schema

The full JSON shape that `build_test.sh` posts to the Path B endpoint, with every field documented.

## Top-level

```jsonc
{
  "name": "string, required",
  "description": "string, optional",
  "active": true,                    // optional, default true
  "failOnServerError": true,         // optional, default true
  "steps": [
    { "type": "...", "...": "..." }  // ordered array, at least one step
  ]
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | string | yes | — | Becomes `sys_atf_test.name`. Should be unique within your namespace. |
| `description` | string | no | `""` | Shows in Test Designer and reports. |
| `active` | boolean | no | `true` | If `false`, the test exists but won't run from suites. |
| `failOnServerError` | boolean | no | `true` | If `true`, any uncaught server error during execution fails the test. |
| `steps` | array | yes | — | Ordered. Execution is sequential; later steps see earlier steps' impersonation context. |

## Step object

```jsonc
{
  "type": "string, required",        // one of the pre-mapped types
  "active": true,                    // optional, default true
  "<element_1>": "<value_1>",        // type-specific inputs
  "<element_2>": "<value_2>"
}
```

| Field | Notes |
|---|---|
| `type` | The step type keyword from `STEP_CONFIGS` in `builder_operation.js`. See `step-types-reference.md`. |
| `active` | If `false`, the step exists but is skipped during execution. Useful for staging incomplete tests. |
| `<element_name>` | Input variable name as defined in `atf_input_variable.element` for that step type. Pass values directly — the operation script copies each non-`type`/non-`active` field into `step.inputs[element]`. |

The element name is **case-sensitive** and uses the internal name (e.g., `user`, not `User`). Use `discover_steps.sh <step_config_sys_id>` to list the exact element names for any step type.

## Examples

### Minimal — impersonate + log

```json
{
  "name": "Trivial probe",
  "active": true,
  "steps": [
    { "type": "impersonate", "user": "6816f79cc0a8016401c5a33be04be441" },
    { "type": "log", "log": "Hello from server-side GlideRecord" }
  ]
}
```

### Two-role record flow

```json
{
  "name": "Customer creates, agent closes",
  "description": "End-to-end happy path",
  "steps": [
    { "type": "impersonate", "user": "<customer sys_id>" },
    { "type": "record_insert",
      "table": "incident",
      "field_values": "short_description=ATF test^urgency=2"
    },
    { "type": "impersonate", "user": "<agent sys_id>" },
    { "type": "record_validation",
      "table": "incident",
      "record_id": "<sys_id of the incident just created>",
      "field_values": "state=2",
      "assert_type": "records_match_query"
    }
  ]
}
```

Note: `record_id` referring to "the record from a previous step" is a known limitation of pure Path B. ATF supports cross-step references via expressions like `{{Step 2: Record Insert.Record}}` in the Test Designer UI; reproducing that via JSON spec requires extending `builder_operation.js` to translate a step-output reference into the cross-step expression. See "Extending the builder" below.

### Record Query with no records expected (negative assertion)

```json
{
  "name": "No duplicate users",
  "steps": [
    { "type": "record_query",
      "table": "sys_user",
      "field_values": "email=fake@example.com",
      "assert_type": "no_records_match_query"
    }
  ]
}
```

## Response shape from `/api/now/atf_builder/create`

Successful (HTTP 201):

```json
{
  "result": {
    "test_sys_id": "<32-char hex>",
    "test_name": "...",
    "steps_created": [
      {
        "order": "100",
        "sys_id": "...",
        "type": "impersonate",
        "step_config_name": "Impersonate",
        "description": "Impersonate the user: Jane Smith with user Id: jane.smith"
      },
      ...
    ],
    "errors": []
  }
}
```

Partial success (HTTP 207, Multi-Status):

```json
{
  "result": {
    "test_sys_id": "<32-char hex>",
    "steps_created": [ /* what succeeded */ ],
    "errors": [
      { "step_index": 2, "error": "Unknown step type: \"foo\"" }
    ]
  }
}
```

The test record is always created; individual step failures are accumulated. Decide whether to delete the partially-built test or fix the spec and PATCH the failing steps individually.

## Validation rules baked into the builder

These are enforced by the server-side operation script:

1. Body must be a JSON object with `name` (non-empty string) and `steps` (array).
2. Each step must have a `type` that exists in `STEP_CONFIGS`. Unknown types → recorded as a step error, the rest of the steps still process.
3. `active`, `failOnServerError` accept boolean or string-cast-of-boolean; `"false"` is treated as `false`.
4. All other fields on a step are passed verbatim to `step.inputs[<field>]`. If the field doesn't correspond to a real input element for that step type, the assignment becomes a no-op (silently dropped by Glide) — the step exists but is partially configured. This is a known limitation; the operation script could check `atf_input_variable.element` to validate field names but currently doesn't.

## Extending the builder

To add support for things the current operation script doesn't handle:

- **More step types** — edit `STEP_CONFIGS` in `builder_operation.js`, add the new type → sys_id mapping, re-run `bootstrap_builder.sh`. See `step-types-reference.md` for discovery.
- **Cross-step references** — modify the input-write loop to recognize a special placeholder like `"<<step:2:record_id>>"` and translate it to the ATF cross-step expression `{{Step 2: Record Insert.Record}}`.
- **Test variables** — currently the builder doesn't create `atf_input_variable` records for test-level variables. Add a top-level `variables` array to the spec and have the operation script insert them via GlideRecord on `sys_atf_variable`.
- **Test suites in the spec** — currently `build_test.sh` returns a test sys_id and `run_suite.sh` wraps it. You could merge the two: extend the spec with a `suite` field and have the builder create the suite + link in one round-trip.

Edit the operation script and re-run `bootstrap_builder.sh` to update. The script is idempotent — it updates the existing operation rather than duplicating it.

## Special step keys (not glide_var inputs)

These map to top-level columns or builder behavior, not to `step.inputs`:

| Key | What it does |
|---|---|
| `type` | Step type lookup key — maps to `step_config` sys_id via `STEP_CONFIGS` in `builder_operation.js`. Required. |
| `active` | Sets `sys_atf_step.active` boolean. Optional, defaults true. |
| `_cols` | Object of `{column_name: value}` pairs. Writes directly to top-level columns on `sys_atf_step` (not glide_var inputs). Useful for `timeout`, `notes`, `mugshots_cache_json`, `snapshot`, `description`. Direct property assignment is used (rather than `setValue`) so `json`-typed columns persist correctly. |

Example using `_cols`:
```json
{
  "type": "assert_text_on_page",
  "text": "Address Classification",
  "assert_type": "text_on_page",
  "_cols": { "timeout": "1970-01-01 00:00:20" }
}
```

## Inline mugshot pattern (recommended for Custom UI steps)

The Custom UI step types (`click_component`, `set_component_values`, `assert_text_on_page`, etc.) accept the full mugshot JSON inline as `component` / one of the `component_values` keys, instead of needing the `mugshots_cache_json` field to be populated.

Why this exists: the `mugshots_cache_json` column is type `json` and ServiceNow's type converter strips the value on write through the public Table API and on direct GlideRecord assignment for nested-JSON-strings. The runner's `getMugshot()` falls back to returning the input string verbatim if cache lookup fails — and the caller does `JSON.parse(mugshot)` on the result. So if you put the FULL locator JSON as the `component` value, the runner parses it directly.

Get the locator JSON via `scripts/find_components.sh`:
```bash
./scripts/find_components.sh <snapshot_sys_id> "Save"
```
The output prints the full JSON ready to paste. The same pattern works for `Set Component Values` — each entry's hash position takes a full mugshot:
```
{full_mugshot_json_1}=value1^{full_mugshot_json_2}=value2^
```
Note the trailing `^` is required (the parser uses `for i in [0, length-1)`).

## Path B custom actions (alternatives to building a new test)

The default request body builds a new test. Set the top-level `action` key to one of these for in-place operations:

### `action: "update"`
Replace an existing test's steps in place. The test's sys_id stays stable, so any `sys_atf_whitelist` entries, test run history, and external references survive.
```json
{
  "action": "update",
  "testSysId": "<existing sys_atf_test sys_id>",
  "name": "Updated name (optional)",
  "description": "Updated description (optional)",
  "active": true,
  "failOnServerError": false,
  "steps": [ /* same shape as build */ ]
}
```
Response includes `{mode: "update", steps_replaced: <count>, steps_created: [...]}`.

### `action: "run"`
Dispatch the test to a `type=manual` browser runner (the kind you get from a normal `/atf_test_runner.do` session). Bypasses the `scheduled`-runner restriction on `/api/sn_cicd/testsuite/run`.
```json
{
  "action": "run",
  "testSysId": "<test sys_id>",
  "runnerSessionId": "<sys_atf_agent.session_id of an online runner>",
  "capturePageData": true,
  "retrieveComponentsStep": "<optional: sys_atf_step.sys_id to capture components after>",
  "useCloudRunner": false,
  "isPausingEnabled": false,
  "performanceRun": false
}
```
- `capturePageData: true` enables snapshot capture during the run
- `retrieveComponentsStep` is the **key flag** that turns this into a component-capture-only run. The runner executes up to and including the named step, captures the resulting DOM into `sys_atf_snapshot` + `sys_atf_ui_component`, then rolls back. Subsequent steps are skipped with message `"This step didn't execute since the test was run to retrieve components for a previous step"`.

Response includes `{dispatched: true, execution_tracker_sys_id, runner_agent_sys_id, runner_browser}` — poll the tracker for state.

### `action: "read_step"`
Dump a step's full inputs including `glide_var` values that the public Table API hides. Used to reverse-engineer OOTB steps as templates.
```json
{ "action": "read_step", "stepSysId": "<sys_atf_step sys_id>" }
```
Response includes `{sys_id, test, step_config, step_config_name, order, description, mugshots_cache_json, inputs: { <key>: <value>, ... }}`.
