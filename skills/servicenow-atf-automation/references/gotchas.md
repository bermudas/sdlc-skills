# Gotchas

Every wall I hit when building this workflow, and how to fix it. Most cost an hour the first time.

## `inputs` reads as empty string via REST

**Symptom:** `GET /api/now/table/sys_atf_step/<sys_id>` returns `inputs: ""` even though the step clearly works in the UI.

**Cause:** ServiceNow's Table API filters `glide_var` columns by design. Not an ACL issue — applies even to full `admin`. See [architecture.md](architecture.md) for the long version.

**Fix:** You can't read the raw input values via REST. But you don't need to — every step has an auto-rendered `description` field that includes the input values in human-readable form. Use the description for verification:

```
Impersonate the user: Jane Smith with user Id: jane.smith
Log: My custom message
Validate there is at least one record in 'incident' matching query: state = 2
```

If the description is missing values you'd expect, the input write didn't take.

## POST to `/api/now/table/sys_atf_step` returns 201 but the step does nothing

**Symptom:** You posted a step with body like `{"step_config": "...", "var__m_atf_input_variable_<sc_id>": "<value>"}`. HTTP 201 came back. But the step's `description` is empty and running the test logs `Impersonate the user: ` (blank).

**Cause:** Same as above — write side of the filter. The dynamic-column value was silently dropped.

**Fix:** Don't try to write `var__m_*` via the Table API. Use the Path B builder API (which writes server-side via GlideRecord). If you have a specific reason to write via Table API, fall back to: (a) Fluent SDK (compiles to update-set XML that imports server-side); (b) a custom Scripted REST API that does the GlideRecord write internally (Path B); (c) the ATF Test Designer UI.

## `assert_type` silently coerced; runtime assertion is wrong

**Symptom:** Built a Record Query step with `"assert_type": "at_least_one"`. The description renders as "Validate there is at least one record". But when the test runs and finds 1 record, the step reports `FAILURE: Found 1 records matching query`.

**Cause:** `at_least_one` isn't a valid choice for `assert_type`. The Glide engine coerces the unrecognized value to a default that's different from what the description template uses for rendering. So the description text and the runtime assertion diverge.

**Fix:** Use a valid choice. The default for Record Query and Record Validation is `records_match_query`. The complementary choice is `no_records_match_query`. Look at OOTB step descriptions to learn what each maps to. To check what's valid for any step type's input variable:

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/atf_input_variable?sysparm_query=model_id=<step_config_sys_id>^element=<input_element>&sysparm_fields=default_value,choice_field,internal_type"
```

## Encoded query with `^EQ` suffix fails silently

**Symptom:** `"field_values": "user_name=alice^EQ"` returns zero records when there's clearly a user named alice.

**Cause:** `^EQ` is an internal terminator the encoded-query engine appends when emitting queries. It is **not** part of the query syntax you write. Including it explicitly can cause the entire query to be interpreted as "all conditions must match plus an empty extra condition", which often returns zero results.

**Fix:** Strip the `^EQ`. Plain `user_name=alice` works. For multi-clause: `user_name=alice^active=true`.

## Choice fields use stored values, not labels

**Symptom:** `"field_values": "state=Closed^stage=Decision"` returns no records, but `sysparm_query=state=Closed^stage=Decision` in the Table API works the same way.

**Cause:** Sort of works in Table API because it's lenient about choice values, but doesn't work consistently in ATF Record Query/Validation. Many fields store numeric or codepoint values that display as labels. `state` for `task`-extension tables is usually integer (`1`=New, `2`=Active/In Progress, `3`=Closed Complete, etc.). `stage` on Government Service / Case tables stores integers or single-word slugs depending on the table.

**Fix:** Use the stored value. Find it by querying with `sysparm_display_value=false`:

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/<table>?sysparm_fields=state,stage,priority&sysparm_display_value=false&sysparm_limit=3"
```

Then write the query with those raw values: `state=3^stage=4`.

## Wrong base URI on Scripted REST APIs

**Symptom:** `GET /api/sn_atf_tg/is_cloud_runner_running` returns `400 "Requested URI does not represent any resource"` even though the API definition exists.

**Cause:** The full URL includes a namespace. The `sys_ws_definition.base_uri` field gives the full path. For OOTB-style APIs, namespace is `now`, so the path is `/api/now/<service_id>/<relative_path>`. The pattern `/api/<service_id>/...` doesn't route.

**Fix:** Always use the value from `base_uri`. For the Path B builder, that's `/api/now/atf_builder/create`.

```bash
# Find the actual base_uri for any scripted REST API on the instance:
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_ws_definition?sysparm_query=service_id=<your_service_id>&sysparm_fields=base_uri"
```

## "Operation against file 'sys_ws_operation' was aborted by Business Rule 'Ensure no overlapping routes'"

**Symptom:** Trying to create a new operation at a path that another scripted REST API already uses returns this error.

**Cause:** Two operations can't share the same `(http_method, relative_path)` tuple — the platform rejects to prevent ambiguous routing.

**Fix:** Change `relative_path` in your operation. E.g., from `/build` (likely taken) to `/create`, `/atf-test`, `/v1/build`, etc.

## SDK auth via `now-sdk auth --type basic` fails on MFA-enabled accounts

**Symptom:** `now-sdk auth --add <instance> --type basic` prompts for username and password, then errors with `Your account requires Multi-factor authentication. Please enter the 6-digit code generated by the authenticator app...`.

**Cause:** Fluent SDK's basic-auth flow goes through `/api/sn_chrome/v1/ui/restspec/.../ui_token/login`, which behaves like a UI login. UI logins enforce MFA.

**Fix options:**
1. Enter the MFA code each time (annoying for CI).
2. Use OAuth: register an OAuth app on the instance, then `now-sdk auth --add <instance> --type oauth --alias <name>`. OAuth tokens bypass MFA.
3. Use a different user account that's in an MFA-exempt group (common pattern: dedicated CI service account).
4. Use Path B (this skill) instead — it uses Table API basic auth, which is MFA-exempt on most instances.

## Suite runs but every step is "Skipped"

**Symptom:** `testsuite/run` returns "Successful" or "Failed" within seconds; per-step results all say `Skipped: This step did not execute due to a failure in a previous step`.

**Cause:** Usually no online Test Runner agent.

**Fix:** Have someone open `<instance>/atf/agent.do` in a browser. The page registers a runner agent. Verify:

```bash
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_agent?sysparm_fields=user.user_name,status&sysparm_display_value=true"
```

You want at least one row with `status=Online`. Then re-trigger.

## `GET /api/sn_cicd/testsuite/run?test_suite_sys_id=...` returns 400 "Missing parameter: test suite sys_id or name required"

**Symptom:** You include the suite sys_id but get this error anyway.

**Cause:** The parameter name is `test_suite_sys_id`, not `sys_id` or `suite_sys_id` or `name`. Also, the param goes in the URL query string, not the body.

**Fix:**
```bash
curl -X POST -u "$ATF_AUTH" \
  "$SN_ATF_INSTANCE/api/sn_cicd/testsuite/run?test_suite_sys_id=<suite sys_id>"
```

## Single-test run with `/api/sn_cicd/test/run` returns 400

**Symptom:** Looking for an endpoint to run a single test (not a suite) and getting `Requested URI does not represent any resource`.

**Cause:** The standard CI/CD API only exposes `testsuite/run` (and various queue endpoints). There's no single-test runner.

**Fix:** Wrap your test in a one-test suite, then trigger that suite. `run_suite.sh` does this automatically:

```bash
./scripts/run_suite.sh <test_sys_id>
```

It creates a fresh suite, links your test, triggers, polls, and prints results.

## OOTB test (`sys_policy=read`) refuses PATCH

**Symptom:** You try to modify an OOTB ATF test (or its steps) via PATCH and get 403.

**Cause:** OOTB tests have `sys_policy=read` to protect demo content from accidental changes.

**Fix:** Don't modify OOTB tests. Create a copy via the Path B builder if you want to start from an OOTB structure:

```bash
./scripts/inspect_test.sh <ootb_test_sys_id>  # see its shape
# build your own spec mirroring it, then:
./scripts/build_test.sh <your_spec.json>
```

## Two runner agents for the same user, one online + one offline

**Symptom:** `sys_atf_agent` shows multiple entries for the same user — some Online, some Offline. Confusing.

**Cause:** Each browser session that visits `/atf/agent.do` registers a fresh agent. Old sessions don't auto-clean.

**Fix:** Ignore the Offline ones — they're stale. The CI/CD trigger picks any Online agent for the user. Optionally delete Offline records for cosmetics:

```bash
curl -X DELETE -u "$ATF_AUTH" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_agent/<offline_agent_sys_id>"
```

## "Restricted Caller Access privileges pending review" warning on instance load

**Symptom:** When logging in (or sometimes when an ATF test runs), a yellow banner appears: *"This application 'Global' has requested 7 Restricted Caller Access Privileges which are pending..."*.

**Cause:** Yokohama+ introduced RCA — cross-scope script calls require explicit approval. Global-scope tests that call into scoped apps (HR, Doc Templates, etc.) hit this. The banner is platform-wide, not specific to your ATF work.

**Fix:** Mostly ignorable for our scaffolding (impersonate, log, record_query, record_validation in global scope don't trigger RCA). If a step that legitimately needs cross-scope access fails with an RCA error, an admin has to approve the request in `System Security → Restricted Caller Access Privileges`.

## The test runs immediately but logs say it ran ages ago

**Symptom:** Running a test multiple times in a row, the `sys_atf_test_result.sys_created_on` for the latest result is from a previous run.

**Cause:** When polling progress and reading results, you're querying by `test=<sys_id>^ORDERBYDESCsys_created_on` — that returns the most recent result by creation time, but if your machine clock differs from the instance clock, "most recent" can be ambiguous.

**Fix:** `run_suite.sh` handles this by capturing the suite sys_id before triggering and querying results by `parent.sys_id` instead of just by test. For ad-hoc queries, include a `sys_created_onRELATIVEGT@minute@ago@1` filter to bound the result set to runs from the last minute.

## Workspace Choice combobox click does NOT commit selection via Custom UI

**Symptom:** Test has `Click Component (Custom UI)` on a dropdown option (Manual address entry, Unknown, etc.). The runner reports `Successfully clicked component 'Text <div>: Manual address entry'`. But the form's classification stays at the original value — the click was visual only, not committed to the form's model. Downstream `Set Component Values` then fails with "field is read-only" because the form mode never actually changed.

**Cause:** Workspace forms render Choice fields as Web Components (`now-select`, `sn-record-choice-connected`). Their selection logic listens for **trusted user events** dispatched by the browser engine — not synthetic events fired via `Element.click()` or `dispatchEvent(new MouseEvent(...))`. ATF's `gAutomate.click()` uses synthetic events: it locates the element by mugshot then calls `click()`. Workspace Choice components ignore that path entirely.

**Confirmed test cases (don't try these — they consistently fail to commit):**
- Click on the inner `<div>` of the dropdown option (e.g., `Text <div>: Manual address entry`)
- Click on the outer `<td role="gridcell">` wrapping the option
- Synthetic `keydown`+`keypress`+`keyup` for ArrowDown+Enter sequences
- `Set Component Values` on the combobox button (errors with "component not found")

**What DOES work:**
- The native `Test Page` step (Configurable Workspace category) calls `uxf.doATFAction(funcName, args, componentId, parentMacroponent, expectedReturn)` — this invokes the component's driver method directly (trusted, bypasses events). But it requires the `_I` actionable-components registry to be populated, and that registry is only bootstrapped inside the actual `/atf_test_runner.do` browser session in ATF debug mode. The registry's `_I` Map is module-local — no public API to populate it externally.
- Playwright (or any CDP-driven framework) firing trusted events at the browser-engine level.

**Practical workaround:** For tests that need to interact with workspace Choice fields, do the UI portion in Playwright (the existing repo framework on most projects) and use ATF for server-side assertions (`Record Query`, `Record Validation`) on the resulting records.

## Native `hierarchical_progress_viewer` UI page may be absent

**Symptom:** Reading ATF documentation or source you see references to `new GlideModal("hierarchical_progress_viewer")` or its `retrieve_components_*` variant used by Test Designer's "Record Page Components" flow. You try to invoke it and the modal renders empty / returns 200 with no body.

**Cause:** Some ServiceNow tenant flavors (notably CSM/FSM Configurable Workspace setups) ship without the `hierarchical_progress_viewer` family of UI pages. Verify via:
```bash
curl -sS -u "$ATF_AUTH" "$SN_ATF_INSTANCE/api/now/table/sys_ui_page?sysparm_query=nameLIKEhierarchical_progress&sysparm_fields=name,sys_id"
```
Empty result = pages missing. The component-capture flow for Test Designer Recording can't run, which means workspace-form tests have to be hand-crafted with carefully captured mugshots — and those mugshots only support stable elements (buttons), not Choice combobox interactions (see preceding gotcha).

**Fix:** Have a platform admin re-import the base ATF plugin (`com.glide.automated_testing_framework`) — these UI pages live there. If that's not feasible, use Playwright for workspace UI flows and ATF for the rest.

## Configurable Workspace native step `Test Page` — full mechanics

**What it does:** Calls `uxf.doATFAction(funcName, args, componentId, parentMacroponent, expectedReturn)` inside the test runner's browser. Bypasses synthetic events — uses the component driver's methods directly.

**Step inputs (glide_var, write via Path B):**
- `component` — the component instance ID *suffix after the last hyphen* (e.g., `list` from `<random>-list`; `3988` from `<session>-3988`)
- `function_to_call` — the driver method name (e.g., `clickUIAction`, `isUIActionVisible`, `setValue`)
- `action_parameters` — string passed to the driver method; for declarative UI actions, this is a `sys_declarative_action_assignment` sys_id; for setValue, the value string
- `hidden_parent_macroponent` — sys_id of the host `sys_ux_macroponent` (find via `sys_ux_macroponent` table; OOTB examples on this instance use the "List" macroponent `2c08111d0fc21010036a83fa68767ef6`)
- `hidden_function_description` — human-readable label that renders in the step description

**Algorithm (from doATFAction's compiled source):**
```js
const i = Object.entries(getComponentInstances()).find(([id, inst]) => {
    const suffix = id.substring(id.lastIndexOf('-') + 1);
    return suffix === component && inst.appendToMeta[<macroponentKey>] === parentMacroponent;
});
if (!i) console.error("Could not find actionable component. Returning.");
const driver = await getDriver(i[1]);
return driver[functionName].apply(driver, JSON.parse(action_parameters));
```

**Why it usually requires Test Designer Recording:** the `getComponentInstances()` registry (`_I` in the minified bundle) is only populated when the page bootstraps in full ATF runner context. Form fields use auto-generated numeric componentId suffixes that change every render — only stably accessible by *capturing them at recording time*. List components have stable alphabetic suffixes (`-list`) so OOTB List tests work without recording.

**Pattern of the only OOTB examples (all 7 are List clicks):**
```json
{
  "type": "test_page",
  "component": "list",
  "function_to_call": "clickUIAction",
  "action_parameters": "<sys_declarative_action_assignment sys_id>",
  "hidden_parent_macroponent": "2c08111d0fc21010036a83fa68767ef6",
  "hidden_function_description": "Click a list UI action Button"
}
```

Path B supports the `test_page` step type; the spec keys above map 1:1 to the `inputs` glide_var elements.

## `sys_ui_page` table HIDES system-protected UI pages — don't trust empty queries

**Symptom:** `curl /api/now/table/sys_ui_page?sysparm_query=name=hierarchical_progress_viewer` returns 0 rows even though the page is real and used everywhere on the platform (progress modals for update set commit, ATF runs, scoped app install, etc.).

**Cause:** ServiceNow ships a small set of system-protected UI pages that don't surface in `sys_ui_page` table queries — admin role doesn't matter, the filtering is at the metadata layer. The hidden ones are still fully renderable via the classic UI's `GlideModal` / `GlideDialogWindow` APIs.

**Verify it exists in your instance** (run on any classic page like `sys_user.do`, NOT a workspace SPA which doesn't load GlideModal):
```js
new GlideModal('hierarchical_progress_viewer', false, '40em', '10.5em').render();
```
An empty gray modal pops; check the DOM for `[id="hierarchical_progress_viewer_closemodal"]` and `[id="hierarchical_progress_viewer_title"]` to confirm.

**Don't conclude "page is missing" from a `sys_ui_page` query alone** — for ATF specifically, the `hierarchical_progress_viewer` is the host UI page for both progress tracking AND component capture (different preferences select between them).

## Test Designer's `openRefreshComponents` has a typo — calls a non-existent page

**Symptom:** Clicking Add Test Step → any Custom UI step type → Next in classic Test Designer either errors silently or never opens the capture dialog.

**Cause:** The `sys_atf_step_creator` UI page (the modal you get when clicking "Add Test Step") has source that does:
```js
var dialog = new GlideModal("retrieve_components_hierarchical_progress_viewer");
```
That long prefixed name is NOT a real UI page — there is only the base `hierarchical_progress_viewer`. The same UI page, invoked with different `sysparm_ajax_processor*` preferences, becomes the component-retrieval dialog when those flags are set. The Test Designer source contains a confused reference to a "retrieve_components_*" variant that was probably never split out from the base page.

**Fix (programmatic):** invoke `hierarchical_progress_viewer` directly with the component-capture preferences. This is the same as fixing the Test Designer source, just done client-side.

```js
// Run from a classic page like sys_atf_test.do. Reuses your logged-in test
// runner agent's session_id (from sys_atf_agent.session_id).
const dlg = new GlideModal('hierarchical_progress_viewer', false, '40em', '10.5em');
dlg.setTitle('Capture page components');

// What kind of step the capture will eventually create:
dlg.setPreference('table_name', 'sys_atf_step');
dlg.setPreference('step_config_id', '<sys_atf_step_config sys_id>');  // e.g. Click Component (Custom UI) = def25c4b73730300c79260bdfaf6a700
dlg.setPreference('step_name', 'Click Component (Custom UI)');
dlg.setPreference('step_order', <order>);
dlg.setPreference('step_config_category', '<sys_atf_step_config_category sys_id>');  // Custom UI = 581a597353d21300ac15ddeeff7b12a6
dlg.setPreference('test_id', '<sys_atf_test sys_id>');
dlg.setPreference('test_needs_snapshot', true);
dlg.setPreference('is_new_step', true);

// The crucial ATF capture wiring:
dlg.setPreference('sysparm_ajax_processor', 'TestExecutorAjax');
dlg.setPreference('sysparm_ajax_processor_ut_test_id', '<sys_atf_test sys_id>');
dlg.setPreference('sysparm_ajax_processor_page_data_capture', true);
dlg.setPreference('sysparm_ajax_processor_retrieve_components_step', '<sys_atf_step sys_id whose post-state will be captured>');
dlg.setPreference('sysparm_ajax_processor_test_runner_session_id', '<runner session_id from sys_atf_agent>');

// Progress renderer chrome:
dlg.setPreference('sysparm_renderer_bubble_up_messages', true);
dlg.setPreference('sysparm_renderer_allow_shrink', true);
dlg.setPreference('sysparm_renderer_expanded_levels', '0');
// Set this FALSE so the renderer auto-starts (true = manual trigger via UI button):
dlg.setPreference('sysparm_delay_progress_renderer_start', false);

dlg.render();
```

**What this does:**
1. The modal asks `TestExecutorAjax.runUserTest()` to run the test up to (and including) `retrieve_components_step`
2. The runner session (identified by `test_runner_session_id`) navigates and executes the prior steps
3. When complete, the runner captures the post-state DOM into `sys_atf_snapshot` + `sys_atf_ui_component` (rows scoped to the specified test)
4. The captured components include their driver method names — including `setValue` for Choice fields, `clickUIAction` for list actions, etc.
5. Subsequent Custom UI or Test Page steps can reference those captured components by hash / driver

**This is the path that unblocks workspace Choice combobox interactions.** The captured `now-select` / `sn-record-choice-connected` components have `setValue` registered with the workspace's component driver — that's the trusted-path method that mutates form state, not a synthetic click. Replaying via `Set Component Values` against these captured components targets the driver, not synthetic events.

**Required preconditions:**
- A logged-in `/atf_test_runner.do` browser session for the user invoking capture (sys_atf_agent row with `status=online`)
- The test runner's session_id (from `sys_atf_agent.session_id`)
- An existing earlier step in the target test that navigates to the page you want components for (the capture happens AFTER that step's state)

**Path B builder can drive this fully** — add a wrapper script that:
1. Opens `sys_atf_test.do?sys_id=<test>` in the user's logged-in classic browser (or any classic page)
2. Runs the snippet above via the browser's JS execution
3. Polls `sys_atf_ui_component` for new rows tied to the snapshot
4. Returns the new component hashes for the spec to reference

This is the missing piece that closes the workspace-form coverage gap. The user-facing Test Designer "Record Page Components" button is just this snippet behind a UI affordance with one typo (`retrieve_components_` prefix that doesn't resolve to a real page).

## ✅ THE working path for workspace Choice combobox: Form > Set Field Values (not Custom UI)

**TL;DR:** Use Form-category `Set Field Values` + `Submit a Form` with `form_ui='service_operations_workspace'`. NOT Custom UI Click Component on the dropdown option (which only fires a synthetic click that the workspace ignores).

**Why this works:** Form-category steps call ServiceNow's platform field-data layer directly (the same layer that the workspace form's setValue / setChoice methods invoke internally). This is a *trusted* mutation — UI Policies fire, dependent fields unlock, validation triggers as if the user typed it. The Custom UI `Click Component` path uses `gAutomate.click()` which dispatches a synthetic DOM event — and workspace Choice combobox options ignore synthetic clicks at the selection-commit layer (they listen for trusted user events from the browser engine).

**Minimal example** — setting a single Choice field on a child table inside CSM/FSM Configurable Workspace:

```json
{
  "type": "set_field_values",
  "table": "<child_table>",
  "form_ui": "service_operations_workspace",
  "field_values": "<choice_field>=<stored_value>"
}
```

Output (on success): `Successfully set field '<choice_field>' to value '<stored_value>'`. If the value is the Choice's *display label* rather than the stored value, the platform either silently ignores the write or reports a coercion warning — always pass the stored value (use `sysparm_display_value=false` to discover it).

**Critical: split into multiple `set_field_values` steps when UI Policies depend on field values.**

When a Choice field gates other fields' read-only state via a UI Policy (e.g. switching an address record between a lookup mode and a manual-entry mode), the policy fires AFTER the gating field commits and transitions the dependent fields from read-only → editable. ATF executes the inputs of one Set Field Values step sequentially without waiting for inter-field policy re-evaluation. So setting `<gating_choice>` AND `<dependent_field>` in the same step fails with "Field '<dependent_field>' is not editable" — because the dependent field was still read-only when the runner moved to it.

**Pattern that works** (synthetic example — adapt the table and field names to your form):
```json
[
  { "type": "set_field_values", "table": "<child_table>", "form_ui": "service_operations_workspace",
    "field_values": "<gating_choice>=<stored_value>" },
  // After this step, the page waits for calm → UI Policy fires → fields unlock
  { "type": "set_field_values", "table": "<child_table>", "form_ui": "service_operations_workspace",
    "field_values": "<dependent_text>=...^<dependent_ref>=<sys_id>^<dependent_date>=2026-05-14" }
]
```

### Discovering the UI label → column mapping for your form

Workspace forms display friendly labels; ATF Set Field Values needs the underlying column name. The mapping is instance-specific (custom `u_*` columns, extension tables, etc.) — discover it on YOUR instance with one of:

1. **`sys_dictionary` query** — given a label and a table, return the column:
   ```bash
   curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
     "$SN_ATF_INSTANCE/api/now/table/sys_dictionary?sysparm_query=name=<table>^column_label=<UI label>&sysparm_fields=element,internal_type,reference,mandatory,read_only"
   ```
2. **`sys_choice` for Choice fields** — list the stored values vs labels:
   ```bash
   curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
     "$SN_ATF_INSTANCE/api/now/table/sys_choice?sysparm_query=name=<table>^element=<column>&sysparm_fields=label,value,sequence"
   ```
3. **`scripts/explore_tests.sh --dump <existing_test_sys_id>`** — if an OOTB or earlier test already targets the same form, dump it and read the resolved column names from the step descriptions.

Watch out for fields the form auto-fills or auto-derives — typically an audit-trail status, a parent-reference link, or a system-generated identifier. Setting them via Set Field Values usually fails with "is not editable". When in doubt, set only what the user would type; let the form fill the rest.

## ✅ THE CANONICAL WORKING PATTERN for workspace sub-record forms

After many iterations on a workspace sub-record form (any child record reachable from a parent record's related list — addresses on a customer record, attachments on a case, line items on an order, etc.), here's the pattern that actually delivers a **green** end-to-end test:

```jsonc
[
  { "type": "impersonate", "user": "<agent sys_user sys_id>" },

  // Navigate DIRECTLY to the sub-record URL — bypass Click New, bypass tab
  // content rendering, bypass the Choice combobox click-commit ceiling.
  { "type": "open_workspace",
    "workspace_page_url":
      "/now/cwf/agent/record/<parent_table>/<parent_sys_id>"
      "/sub/record/<child_table>/-1_uid_1"
      "/params/query/<linking_field>%3D<parent_sys_id>"
      "/extra-params/query%2F<linking_field>%3D<parent_sys_id>"
      "%2FparentTable%2F<parent_table>"
      "%2FparentRecordSysId%3D<parent_sys_id>" },

  // Wait for the sub-form to render
  { "type": "assert_text_on_page",
    "text": "<a field label that's always present on the form>",
    "assert_type": "text_on_page",
    "_cols": { "timeout": "1970-01-01 00:00:30" } },

  // Set Choice fields and any fields that trigger UI Policies FIRST, alone:
  { "type": "set_field_values",
    "table": "<child_table>",
    "form_ui": "service_operations_workspace",
    "field_values": "<choice_field>=<stored_value>" },

  // Then set all the now-editable fields in a second Set step
  // (UI Policies fire between steps, NOT between fields within a step):
  { "type": "set_field_values",
    "table": "<child_table>",
    "form_ui": "service_operations_workspace",
    "field_values":
      "<text_field_1>=<value>^"
      "<text_field_2>=<value>^"
      "<ref_field>=<sys_id>^"
      "<date_field>=<yyyy-MM-dd>" },

  // Save via platform's Save UI action
  { "type": "submit_form", "form_ui": "service_operations_workspace" },

  // Verify
  { "type": "record_query",
    "table": "<child_table>",
    "field_values": "<encoded query>",
    "assert_type": "records_match_query",
    "enforce_security": "false" }
]
```

**Why this works** (each layer addresses a specific architectural ceiling):

| Layer | Bypasses what | How |
|---|---|---|
| Direct sub-record URL | Click New synthetic-click need + related-list tab content rendering | Navigates to the URL pattern Click New produces internally |
| Form > Set Field Values | Custom UI synthetic-click ceiling on Choice combobox | Routes through platform's field-data layer (trusted setValue, not synthetic click) |
| Split into two Set steps | UI Policies firing AFTER field changes (within-step ordering issue) | Each step waits for page-calm; UI Policy fires; next step sees unlocked fields |
| Submit a Form | "Save" button click via platform's Save UI action | Avoids capturing/clicking a Save mugshot |
| Record Query | UI-level validation that auto-sets a field (e.g. a status column) | Verifies the actual persisted record |

This pattern has been validated end-to-end against several real workspace sub-record flows: typically 6–8 steps, with one warning expected when the page emits a benign platform-side data-broker error that's whitelisted per § "Whitelisting known platform errors" below.

**This pattern generalises**: any workspace sub-record form can be filled this way without needing to capture Custom UI mugshots for buttons / tabs / options.

---

## Fluent SDK gotchas (proven on a live MFA tenant — see references/fluent-sdk.md)

### THE BATCHING RULE (universal — Path B too): server steps must not split a UI batch
ATF runs UI steps in one browser batch sharing `g_form`. A server-side step
(`server.log` / `server.record*` / `impersonate`) placed **between** UI steps
ends the UI batch; the next UI assertion fails:
`Unable to perform field state validation because g_form is not defined`.
Keep the whole UI flow contiguous (`openNewForm → setFieldValue →
fieldStateValidation → … → submitForm`, zero server steps between); batch
server/log/validation steps strictly before and after the UI block. (The
SDK's own `test-atf-sample/atf-batching.now.ts` documents this.) Symptom we
hit: traceability `server.log` between every UI action silently broke every
downstream UI assertion.

### `now-sdk install` is ADDITIVE for `sys_atf_step`
Re-installing after changing a test's step `$id` set does NOT prune old
steps — orphans remain with duplicate `order` and still execute (a stale
broken step keeps failing your "fixed" test; instance step count >> build
count, interleaved old/new). Remedy: wipe ALL `sys_atf_step` for the test
sys_id, then `now-sdk install` (recreates exactly the current build).
`scripts/sdk_wipe_steps.sh <test_sys_id>` ships this. Test sys_id is stable
(deterministic from `Now.ID['key']`) so whitelist/history survive.

### now.config.json default `fluentDir` is `src/fluent`, NOT `src`
`.now.ts` in `src/` without `"fluentDir": "src"` ⇒ `now-sdk build` silently
emits zero ATF (only `sys_module`). Always verify
`ls dist/app/update | grep -c sys_atf_step` > 0 after build.

### Fluent build is a STATIC AST parser — string literals only
No concatenation / template literals / computed values / expressions in any
property value (`TS303: Failed to parse property`). Encoded queries,
descriptions, logs must be single inline literals.

### SDK auth: basic has NO MFA; OAuth has MFA + needs ZERO admin setup
`--type basic` (interactive AND CI env-var mode) hard-exits on an MFA account
without ever prompting for the code — not fixable by `expect`/`tmux`.
`--type oauth` uses a built-in SDK OAuth client already on every instance
(`client_id=543e5655…`, NO Application-Registry step): browser login handles
MFA, paste the `/sdk-oauth.do` code, token auto-refreshes (one-time login →
unattended redeploys). Deploy with `--auth <alias>` and `env -u
SN_SDK_NODE_ENV -u SN_SDK_INSTANCE_URL -u SN_SDK_USER -u SN_SDK_USER_PWD`
(the CI env vars force the MFA-incompatible path).

### SDK installs SCOPED apps only
`scope:"global"` install fails ("Could not determine app installation
status", writes nothing). Scoped ATF tests vs Global tables show a cosmetic
*"record is in <App>, but Global is the current application"* banner —
execution is unaffected (proven). Global deploy requires Path B.

### Don't hand-pin `@servicenow/glide`
The `now-sdk init` scaffold pins it to its own correct version. Guessing a
version (e.g. matching the sdk version) 404s on npm.

### Field-state assertions: classic works, workspace times out; calibrate
`fieldStateValidation`/`fieldValueValidation` execute on `standard_ui` even on
heavily client-scripted forms (read asserts — robust). On workspace `formUI`
they hit `ATF_INTENT_GENERATOR` timeout (architectural). `setFieldValue` can
throw on reactive async-`GlideAjax onChange` forms (`Cannot read properties of
undefined (reading 'message')`) — whitelist that benign incidental error
(warning) IFF outcome assertions still prove correctness (not defect-masking).
Never assume field states: run the assertion, the failure tells the true
state, correct, repeat. States are usually driven by OTHER fields — assert
AFTER the trigger, in order. Asserting state *before* the change that causes
it is the #1 authoring bug.

---

## Workspace SPA shadow-DOM ceilings — structural, not tooling

### `assert_text_on_page` is blind to workspace SPA shadow DOM (field values, grid row-cells)

**Symptom**: a record-form field is plainly visible in the workspace SPA, but `assert_text_on_page text='<value>'` fails with *"Text '<value>' was not on the page"*.

**Cause**: the field text lives inside a chain of nested shadow roots (commonly 9+ deep on workspace forms: `now-input → sn-record-input-connected → now-record-form-section-column-layout → macroponent → sn-canvas-screen → sn-canvas-main → macroponent → sn-canvas-appshell-main → macroponent → body`). `document.body.innerText` does NOT include shadow-scoped text. The same applies to workspace grid row-cell content.

**This is structural, not a tooling oversight.** ServiceNow's own documentation states custom client-side step environments are not a supported extension point (Tokyo+ docs). No future minor patch will close it. Washington DC (Feb 2024) added 2 workspace ATF step types — both declarative-action, neither field-value-assertion. Through Yokohama (2025) no additional workspace field-value step types were added. **Do not invest in a custom shadow-piercing step.**

**Workaround**: server-side `record_query` proves the data layer; let Playwright (or any CDP-driven framework) own the UI rendering assertion. See `references/poc-bench-patterns.md` § Pattern 4 (hybrid coverage decision matrix) for the per-observable split.

### Lazy virtualisation on workspace Details-tab record-form sections

**Symptom**: even a shadow-walking JS expression returns empty results for a Details-tab section's field values.

**Cause**: workspace SPA virtualises the section's child inputs — they aren't mounted in DOM until the section is scrolled into view (~2500/3200px on 1080p viewports). Empty results before scroll are an artifact of the renderer, not the data.

**Implication**: even hypothetical client-side shadow-piercing would need to drive a scroll first. Combined with the no-custom-client-step constraint, this is another reason the ceiling is structural.

### `assert_text_on_page` reads VISIBLE text, NOT aria-label / data attributes

**Symptom**: an icon-only button (the `...` overflow trigger pattern, common across workspace toolbars) carries an `aria-label="More Actions"` but no visible text. `assert_text_on_page text='More Actions'` fails — yet the button is present in DOM.

**Cause**: `assert_text_on_page` reads visible text content (innerText-equivalent). Aria-bound labels and data-attribute values are not included.

**Workaround**: assert a downstream side-effect of clicking the affordance (if reachable via ATF) OR fall back to Playwright. There's no ATF primitive for attribute-based text assertion across the OOTB step catalogue.

### Whitelist substring matching is NOT byte-exact for quote-rich errors

**Symptom**: a `sys_atf_whitelist` row with the literal recurring error string (e.g. `Provided selected tab index '7' is not a valid index`) does NOT engage; the warning still fails the step.

**Cause**: empirical — quote-rich and numeric-rich error strings don't reliably match the runner's substring comparison.

**Workaround**: broaden the whitelist substring to strip quoted tokens and standalone numbers:

```bash
# Bad — quote-rich; engagement is unreliable
./scripts/whitelist_error.sh <test_sys_id> "Provided selected tab index '7' is not a valid index"

# Good — broader prefix substring engages reliably
./scripts/whitelist_error.sh <test_sys_id> "Provided selected tab index"
```

Rule of thumb: **strip every quoted substring + every standalone number** from the error before whitelisting.

### Single-runner state accumulation degrades workspace-SPA-open across dispatches

**Symptom**: After 3-6 workspace-SPA-open tests in the same `sys_atf_agent` browser session, subsequent dispatches stall at `Open Workspace Page` — the test_result row sits in `state=1` for the full 600s ATF max-execution ceiling, `start_time` never populates on the step.

**Cause**: workspace SPA holds session/cache state across navigations. After enough cumulative navigations to different sub-records / parent contexts, the SPA's internal state machine wedges and new `open_workspace` requests don't complete.

**Workarounds** (in order of cost):
1. **Cooldown ~6 min** between same-runner workspace dispatches (works for short bursts).
2. **Operator restart** — close the runner browser tab, reopen `/atf_test_runner.do`. Resets the accumulator. Fresh budget for 3-6 dispatches.
3. **Multi-runner partition** — provision a second `sys_atf_agent` on a different machine/session. Doubles throughput; load-balances.
4. **Scheduled runner** (CI/CD) — switch from `type=manual` to `type=scheduled` runners. Avoids the manual-tab state problem entirely. Required by `/api/sn_cicd/testsuite/run`.

**Fail-fast diagnostic**: if `Open Workspace Page` `start_time` doesn't populate within 60s of dispatch, assume state-accumulation. Cancel the run rather than waiting 600s.

### `simple_name_values` input normalization (SP-category step types)

**Symptom (closed by builder fix)**: SP-category step types (`open_service_portal_page`, `open_record_producer_sp`) rendered with empty-placeholder descriptions (`"Open  page in the  portal"` / `"Open Record Producer."`) after build, then timed out at 600s at runtime.

**Root cause**: `query_params` input is type `simple_name_values`. The OOTB description-generator runs `JSON.parse(query_params || '{}')`. URL-encoded shape (`"a=1&b=2"`) makes `JSON.parse` throw — aborting the entire description regeneration and masking other inputs' successful writes.

**Fix landed in `scripts/builder_operation.js`**: the builder normalizes URL-encoded `query_params` to JSON-object-string for SP-category step types. Spec authors can use either input shape — both pass through cleanly. See `references/poc-bench-patterns.md` § "`simple_name_values` normalization" for the full diff + diagnostic detector.
