# Step Types Reference

The step types pre-mapped in `scripts/builder_operation.js`, the inputs they accept, and how to discover step types not yet mapped on your instance.

## Pre-mapped step types

The mapping below is what `builder_operation.js` ships with. Each row shows the `type` keyword you use in the spec, the OOTB `sys_atf_step_config.sys_id` it points to, and the inputs it expects.

### Server category — most useful for scaffolding

| `type` | Inputs (required *) | What it does |
|---|---|---|
| `impersonate` | `user`* (sys_user sys_id) | Switch the test execution context to the named user |
| `log` | `log`* (string) | Append a message to the test log — invaluable for debugging |
| `record_query` | `table`*, `field_values`*, `assert_type`, `enforce_security` | Asserts records match an encoded query |
| `record_validation` | `table`*, `record_id`*, `field_values`, `assert_type`, `enforce_security` | Asserts a specific record's fields satisfy conditions |
| `record_insert` | `table`*, `field_values`* | Creates a new record; output captures the new sys_id for chaining |
| `record_update` | `table`*, `record_id`*, `field_values`* | Updates a record by sys_id |
| `record_delete` | `table`*, `record_id`* | Deletes a record |
| `run_server_script` | `script`* (server-side JS body) | Runs arbitrary GlideRecord/script logic; can set output variables |

### Form category — classic (non-Service-Portal) UI

| `type` | Inputs (required *) | What it does |
|---|---|---|
| `open_new_form` | `table`*, `view` | Opens the new-record form for a table |
| `open_existing` | `table`*, `record_id`* | Opens an existing record |
| `set_field_values` | `field_values`* (encoded query format) | Sets form fields without saving |
| `click_ui_action` | `ui_action`* (sys_ui_action sys_id) | Clicks a named UI action button (Save, Submit, etc.) |
| `submit_form` | `submit_method` | Submits the currently open form |
| `field_values_validation` | `field_values`* | Asserts the form's current field values match expectations |

### Service Portal (SP) — for /sp or custom portals built on the SP framework

| `type` | Inputs (required *) | What it does |
|---|---|---|
| `open_form_sp` | `page`*, `record_id` (optional) | Opens a Service Portal page |
| `set_field_values_sp` | `field_values`* | Sets variable values on a Service Portal form |
| `submit_form_sp` | `submit_button` | Submits a Service Portal form |
| `click_ui_action_sp` | `ui_action`* | Click a UI action in Service Portal context |

### Configurable Workspace

| `type` | Inputs (required *) | What it does |
|---|---|---|
| `open_workspace` | `experience`*, `page`*, `record_id` | Opens an Agent Workspace page |

## Input value formats — what to actually pass

**References (sys_id or stored value)**: always prefer the sys_id. For `user`, `record_id`, `ui_action`, `experience`, `page`, the value is the target record's sys_id.

**Encoded queries (`field_values`)**: ServiceNow's encoded-query syntax. Examples:

```
short_description=Test
short_description=Test^urgency=2
state=3^stage=4
opened_byDYNAMIC8d5ab8a2c0a8016400d04ddd6e2bcde9   # dynamic filter, e.g. "Me"
short_descriptionLIKEpartial%20text
opened_at>=javascript:gs.daysAgoStart(7)
```

Do **not** append `^EQ` — that's an internal terminator the system adds automatically. Including it explicitly may cause the query to fail silently.

**Choice values**: use the stored value, not the display label. For state on a record extending `sn_customerservice_case`, `Closed` is stored as `3`. For stage on Government Service Cases, `Decision` is stored as `4`. When in doubt, query a real record with `sysparm_display_value=false`:

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/<table>?sysparm_fields=state,stage&sysparm_display_value=false&sysparm_limit=3"
```

**`assert_type` on Record Query / Record Validation**: the default value is `records_match_query` (which renders as "Validate there is at least one record"). Other valid choices include `no_records_match_query`. Do **not** invent values like `at_least_one` — they'll be silently coerced and the runtime assertion will be wrong even though the description text looks fine.

## Discovering step types not in the pre-mapped list

Your instance probably has 100+ step types (more if scoped apps add custom ones). To find one that isn't yet mapped, use `discover_steps.sh`:

```bash
# List ALL step types on the instance, grouped by category
./scripts/discover_steps.sh

# Show the input variables for a specific step type
./scripts/discover_steps.sh <step_config_sys_id>
```

The first command produces output like:

```
[Configurable Workspace] (2)
    Open Workspace Page                                b74ae80243700210285ffa73cbb8f2d2
    Test Page                                          33bb3cb343810210285ffa73cbb8f245

[Custom UI] (6)
    Assert Text on Page (Custom UI)                    475e0de3d732130089fca2285e610361
    ...
```

The second command produces output like:

```
Input variables for Impersonate (071ee5b253331200040729cac2dc348d):
  user [reference -> sys_user] * mandatory
```

To use a newly-discovered step type, add it to `STEP_CONFIGS` in `scripts/builder_operation.js`:

```javascript
var STEP_CONFIGS = {
    ...existing entries...,
    'my_new_step_type': '<the_step_config_sys_id_from_discovery>'
};
```

Then re-run `bootstrap_builder.sh` to update the operation script. The script is idempotent — it'll update the existing operation in place.

## When step type names collide

Some step type names exist in both classic and Service Portal flavors (e.g., `Open a Form`, `Set Field Values`, `Submit a Form`). They have different `step_config` sys_ids and slightly different input element names. In the spec, use the `_sp` suffix to disambiguate:

- `set_field_values` → classic native UI
- `set_field_values_sp` → Service Portal

If you're testing a `/sp` or `/gsp` or custom-portal flow, you almost certainly want the `_sp` variants.

## Step types this skill doesn't pre-map (and why)

Some step types have non-trivial input schemas (multi-step setup, references to records you'd need to create) and aren't included in the default map to keep the operation script focused. You can still use them — discover the sys_id with `discover_steps.sh <sc_id>` and add to `STEP_CONFIGS`:

- **Email steps** (`Generate Inbound Email`, `Validate Outbound Email`) — useful but require an email-config setup on the instance
- **REST steps** (`Send REST Request - Inbound`, `Assert Status Code`, etc.) — for testing your own scripted REST APIs
- **Service Catalog steps** — 10+ step types specifically for catalog item/record producer tests
- **Order Guide steps** — multi-row variable sets, navigation
- **Reporting / Dashboard steps** — visibility assertions

The categories above are listed in the ATF documentation; for the full list on your instance, just run `discover_steps.sh`.
