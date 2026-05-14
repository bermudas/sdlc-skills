# Why the Public Table API Can't Build ATF Tests

This is the "why" — the architectural reason this skill exists. Read it once; it saves a lot of confusion later.

## The short version

ATF step inputs live in fields with the `glide_var` internal type — a model-driven, dynamic-column storage scheme. ServiceNow's public Table API **deliberately filters those fields out** of both reads and writes. The filter is in the API layer, not in any ACL. Even a user with the full `admin` role cannot read or write those fields via `/api/now/table/sys_atf_step`. Server-side Glide engine code — running inside the platform — is **not** subject to the filter and can manipulate the fields normally.

The "trick" this skill uses is to expose a *server-side* code path through a *public* endpoint by way of a Scripted REST API. The API receives a JSON spec, then a server-side GlideRecord block creates the test and steps, including the `inputs.<element>` writes that the public API would have dropped.

## The long version

### What `glide_var` actually is

A `glide_var` field is a placeholder declared on the parent table (`sys_atf_step` has a single `inputs` column declared as `glide_var`). The actual data lives in dictionary-extended columns named like `var__m_atf_input_variable_<step_config_sys_id>`, one per step config that has been instantiated on the table. The variable schema is declared in the `atf_input_variable` table — each row describes one input "element" (e.g. `user`, `log`, `table`, `field_values`) along with its type, mandatory flag, and reference target.

You can see all the dynamic columns on `sys_dictionary` filtered by table — but they don't show up the way you might expect, because they're added as extensions, not as primary columns.

### What you observe from the outside

Three observable symptoms make the filter visible:

1. **POST creates an empty step.** A POST to `/api/now/table/sys_atf_step` with body containing `var__m_atf_input_variable_<sc_id>: "<value>"` returns 201, the step exists, but its auto-generated `description` is empty (e.g., `"Impersonate the user: "`). The dynamic column write was silently dropped.

2. **GET returns `inputs: ""` even with `admin`.** Querying the step record returns `inputs: { "display_value": "", "value": "" }`. The actual data is still in storage (you can see the auto-rendered `description` and you can run the test successfully if it was built via the UI) — it's just not exposed through this API.

3. **Filter predicates on `var__m_*` are silently ignored.** `sysparm_query=var__m_atf_input_variable_<sc_id>=<sys_id>` returns the same number of rows as the same query without that clause. The unknown column predicate is dropped; the rest of the filter still applies.

These three behaviors are consistent, repeatable, and survive every credential combination (trial user, read-only admin, full admin), every variant of `sysparm_display_value` and `sysparm_view`, the legacy `.do?XML=true` exporter, and the update-set XML serializer when the record isn't explicitly tracked.

### Why ServiceNow built it this way

Speculatively: ATF step inputs reference foreign objects (users, tables, records, fields) and have type-specific validation logic that lives inside the ATF runtime. Exposing raw read/write through the Table API would (a) bypass that validation, (b) create coupling between schema-extension columns and external API consumers, and (c) expose internal storage details that ServiceNow wants to be free to change. So they decided the public API doesn't see these fields, and code that legitimately needs them goes through server-side Glide.

You don't have to agree with that choice to work with it. The practical implication: there is no setting, role, or query parameter that lifts the filter from outside. The workaround is to bring the construction *inside*.

## The server-side bypass — the AddTestTemplateAjax pattern

Inside the Glide JavaScript engine, `step.inputs[<element>] = <value>` does the right thing:

```javascript
var step = new GlideRecord('sys_atf_step');
step.initialize();
step.test = '<test_sys_id>';
step.step_config = '<step_config_sys_id>';
step.order = 100;
var stepId = step.insert();

// Refetch — this gives a fresh handle with the glide_var accessor wired up
step.get(stepId);

// Set inputs — this writes the real var__m_* dynamic columns
step.inputs.user = '<sys_user_sys_id>';
step.inputs.log = 'Hello';
step.update();
```

This pattern comes straight from OOTB `AddTestTemplateAjax._setInputVariablesWithDefault` and `AddTestTemplateAjax._createStep`. ServiceNow's own UI uses this same approach when you click "Add Step" in Test Designer; the difference is that the UI calls it from inside a UI processor, and we call it from inside a Scripted REST API operation.

## Why a Scripted REST API rather than a background script

You could run the same code as a one-shot background script via `/sys.scripts.do`. The issue is that `/sys.scripts.do` requires a UI session (and the UI session may require MFA for the account). A Scripted REST API:

- Accepts REST basic auth (which on most instances is exempt from MFA for the API surface)
- Is reusable — the script is uploaded once, then every test creation is a single POST
- Is composable — Claude/CI/anything can call it with a JSON spec

The trade-off is one-time setup cost (~5 min) plus the API record lives on the instance. The `bootstrap_builder.sh` script in this skill makes that setup idempotent and recoverable.

## Why Fluent SDK and other approaches are alternative paths, not the only paths

ServiceNow's official Fluent SDK (`@servicenow/sdk`) compiles `.now.ts` test definitions into update set XML that ServiceNow ingests via its internal serializer — which sets the `var__m_*` columns server-side too. So Fluent works for the same underlying reason: it ends up running inside the platform.

The reasons to use Path B (this skill) instead of Fluent:

- **No SDK install** — Fluent requires `@servicenow/sdk` + Node 20+ + auth credentials in a per-machine config
- **No MFA on the SDK auth path** — Fluent's basic-auth login flow goes through `/api/sn_chrome/v1/ui/restspec/.../ui_token/login`, which behaves like a UI login and enforces MFA every time. OAuth fixes this but adds setup
- **No build step** — Fluent compiles TS → update set XML; Path B is direct
- **AI-friendly JSON shape** — easy for LLMs to generate and modify

Reasons to use Fluent over Path B:

- **Code in version control** — tests live as TS files in a repo, reviewable, diffable, refactorable
- **Type safety** — the SDK's types catch shape errors before deploy
- **Team familiarity** — if your team already uses ServiceNow SDK for app development, this fits

Both are valid. This skill goes with Path B as the default because it's the most universal — works on any instance with admin + REST basic auth, no client-side tooling.

## What about the cloud-runner AI generator?

There's a separate ServiceNow Store app called "ATF Test Generator and Cloud Runner" (scope `sn_atf_tg`). It generates tests by having an AI walk the UI through SN-hosted cloud browsers. It's the right tool for *mass regression coverage* (give it a table query, get N candidate tests). It is **not** the right tool for "build this specific test scenario" — it doesn't take a script as input, it explores. If you need broad coverage and have the cloud runner licensed and online, it can supplement Path B. They're complementary, not alternatives.
