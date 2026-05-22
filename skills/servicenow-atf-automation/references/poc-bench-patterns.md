# Bench Patterns — Reusable ATF findings

A curated catalog of patterns proven on real ATF benches that are **reusable
across tenants and projects**. Each pattern is anchored to what observable
it covers, where it beats the obvious UI-driven alternative, and
(where relevant) ServiceNow's own documentation / community references —
saving future implementers from re-investigating closed questions.

---

## Pattern 1 — ACL outcome differential via `enforce_security`

**Capability finding (server-side dimension)**. ATF can probe role-based
access cleanly by pairing two `record_query` steps with opposing
`enforce_security` flags. Non-vacuous by construction.

```jsonc
// PROBE A: under the impersonated role
{ "type": "impersonate", "user": "<role-user-sys_id>" },
{ "type": "record_query",
  "table": "<target_table>",
  "field_values": "<filter>",
  "enforce_security": "true",
  "assert_type": "records_match_query" },

// PROBE B: admin baseline (same query, different security)
{ "type": "record_query",
  "table": "<target_table>",
  "field_values": "<filter>",
  "enforce_security": "false",
  "assert_type": "records_match_query" }
```

**Verdict interpretation**:
- `A.count == B.count` → no ACL gap (role sees everything admin sees for this slice)
- `A.count < B.count` → ACL filtering (proves the boundary's row count)
- `A.count == 0 ∧ B.count > 0` → ACL denial (role can't see the slice at all)

**Bonus**: a third probe against a *parent table* with a *reference-bound*
filter (e.g. `<ref_field>=<sys_id>^enforce_security=true`) can prove the ACL
is reference-bound (through a join table) vs broadly granted — useful for
diagnosing security-model questions.

**Why it's stronger than Playwright**: Playwright asserts what the UI
rendered. ATF asserts the underlying ACL contract. ATF answers "can this
role *see* this slice?" with a rigorous count differential; Playwright can
only assert "the UI rendered these rows" (which conflates ACL with
renderer state).

---

## Pattern 2 — Destructive-cascade substitution via `run_server_script` + count-back anchors

**Substitution pattern**. For destructive flows where ATF can't drive the
UI click (synthetic-event ceiling on workspace web-components — see
`gotchas.md`), provision a throwaway record server-side, perform the
destructive mutation via GlideRecord, and assert count-back on both parent
and child tables.

```jsonc
[
  // 1) Provision server-side (bypasses UI ceiling)
  { "type": "run_server_script",
    "script": "var gr = new GlideRecord('<parent_table>'); gr.initialize(); gr.<field>=<value>; gr.<owner>='<consumer_sys_id>'; <parent_sys_id> = gr.insert(); /* also insert child(ren) */" },

  // 2) ANCHOR A — parent-table read-back
  { "type": "record_query", "table": "<parent_table>",
    "field_values": "sys_id=<parent_sys_id>", "assert_type": "records_match_query" },

  // 3) ANCHOR B — child-table read-back (cascade dependency proof)
  { "type": "record_query", "table": "<child_table>",
    "field_values": "<parent_ref>=<parent_sys_id>", "assert_type": "records_match_query" },

  // 4) Optional UI readiness assert (proves grid is rendered if needed)
  { "type": "open_workspace", "workspace_page_url": "..." },
  { "type": "assert_text_on_page", "text": "<panel heading>", "assert_type": "text_on_page" },

  // 5) DELETE via GlideRecord — OOTB reference-cascade handles child rows
  { "type": "run_server_script",
    "script": "var gr = new GlideRecord('<parent_table>'); if (gr.get('<parent_sys_id>')) gr.deleteRecord();" },

  // 6) COUNT-BACK A — parent gone
  { "type": "record_query", "table": "<parent_table>",
    "field_values": "sys_id=<parent_sys_id>", "assert_type": "no_records_match_query" },

  // 7) COUNT-BACK B — child cascade gone (proves OOTB FK cascade)
  { "type": "record_query", "table": "<child_table>",
    "field_values": "<parent_ref>=<parent_sys_id>", "assert_type": "no_records_match_query" }
]
```

**Why count-back on BOTH tables matters**: a `deleteRecord()` returning true
doesn't guarantee the cascade fired — the parent row could be gone while
child rows orphan. Count-back on both parent and child proves the cascade
is real, not just an in-memory ack.

**Where this beats UI-driven delete**: UI delete on a workspace grid
requires clicking a row checkbox + toolbar Delete button, both of which hit
the synthetic-event ceiling on `seismic-hoist`-overlaid web-component
checkboxes. Server-side cascade-delete sidesteps the ceiling and proves the
same business invariant (record + cascade gone).

---

## Pattern 3 — Server-side REST archive cleanup via `run_server_script` (for tables without DELETE ACL)

**Cleanup primitive**. Many record types grant non-admin roles read+update
but NOT delete. When the test mutates such a table, post-test cleanup
can't be a `record_delete`. Pattern: archive via field update (e.g.
`u_status='archived'`) from a `run_server_script` step running under the
runner's (typically admin-equivalent) role.

```jsonc
{ "type": "run_server_script", "script":
  "var gr = new GlideRecord('<table>');\n" +
  "gr.addQuery('<filter_field>', '<value>');\n" +
  "gr.addQuery('u_status', 'active');\n" +
  "gr.query();\n" +
  "var archivedCount = 0;\n" +
  "while (gr.next()) {\n" +
  "  gr.u_status = 'archived';\n" +
  "  gr.update();\n" +
  "  archivedCount++;\n" +
  "}\n" +
  "if (archivedCount === 0) {\n" +
  "  throw new Error('Cleanup precondition violated: no Active rows to archive — test data drift suspected');\n" +
  "}"
}
```

**Why this pattern matters**: cleanup must execute under a role with
sufficient privilege. Many non-admin roles can't DELETE; the test's
`impersonate` step can't be used for cleanup. `run_server_script` runs
under the runner's privilege (typically admin or admin-equivalent),
bypassing the ACL restriction. The `throw new Error` on zero-rows prevents
false-positive cleanups (the test would have created at least one Active
row).

---

## Pattern 4 — Hybrid coverage decision matrix (when ATF, when Playwright)

ATF and Playwright are **complementary by structural design**, not
opportunistic split. Use this matrix for any new workspace customer-record
/ SP-portal test.

| Observable | ATF capable? | Owner |
|---|---|---|
| Record persistence after mutation (record exists, fields match) | ✅ Yes (server-side `record_query`) | ATF |
| ACL outcome (role can see / can't see) | ✅ Yes (Pattern 1 differential) | ATF |
| Business-rule outcome (downstream record updates, notifications) | ✅ Yes (`record_query` + `record_validation`) | ATF |
| Form-mutation persistence (Set Field Values + Submit, including reference-fields) | ✅ Yes (canonical workspace pattern) | ATF |
| Classic-UI form rendering text | ✅ Yes (light DOM, `assert_text_on_page` works) | ATF |
| Workspace SPA panel heading / column-header text | ✅ Yes (chrome lives in light DOM) | ATF |
| Workspace SPA grid row-cell content | ❌ No (shadow DOM) | Playwright |
| Workspace SPA form field-value rendering text | ❌ No (9-deep shadow DOM + lazy virtualisation) | Playwright |
| Icon-only button labels (aria-bound, no visible text) | ❌ No (`assert_text_on_page` reads visible text only) | Playwright |
| Transient toast affordances (e.g. 3-5s `.alert-success`) | ❌ No (race vs auto-dismiss; positive-only catalogue) | Playwright |
| Workspace web-component row-checkbox selection | ❌ No (synthetic-event ceiling — same family as Choice combobox) | Playwright |
| Visible state-machine transitions on selection (e.g. Delete (1) → Delete (2)) | ❌ No (depends on row-checkbox click) | Playwright |
| Custom Service Portal widgets requiring `g_form` binding | ❌ No (runner-level — confirmed across Path B + Fluent SDK) | Playwright |
| OOTB Service Portal forms (non-custom widgets) | ✅ Yes (SP step group works on OOTB) | ATF |
| Visual regression / screenshot diff | ❌ No (no ATF visual primitive) | Playwright |
| Cross-actor E2E (Customer → Agent in one flow) | ⚠️ Hybrid — server-side persistence proves cross-actor mutations; UI rendering of both halves stays Playwright | Both |

**General rule**: ATF carries the **data + business-rule + ACL contract**.
Playwright (or another UI-layer framework) carries the **visual +
interactive contract**. Plan both from day 1 for any new workspace test.

---

## Pattern 5 — `simple_name_values` input normalization for SP-category step types

**Builder fix landed in `scripts/builder_operation.js`.** Background:

The `Open Service Portal Page` and `Open a Record Producer (SP)` step types
have a `query_params` input of dynamic-column type `simple_name_values` (a
`glide_var` variant). The OOTB ATF description-generator runs
`JSON.parse(query_params || '{}')` to render the description placeholders.
If the value is URL-encoded (`"a=1&b=2"`) instead of JSON-object-string
(`'{"a":"1","b":"2"}'`), `JSON.parse` throws and the **entire description
regeneration aborts** — making all OTHER inputs' successful writes look
like failures (their placeholders render empty too). At runtime the test
times out at the 600s ATF max-execution ceiling.

The builder now normalizes URL-encoded `query_params` to JSON-object-string
before the write:

```javascript
// In builder_operation.js — normalize SP-category query_params before write
var SIMPLE_NAME_VALUES_INPUTS = {
    'open_service_portal_page': ['query_params'],
    'open_record_producer_sp':  ['query_params']
};
// ...
if (snvForType.indexOf(key) >= 0) rawVal = normalizeSimpleNameValues(rawVal);
step.inputs[key] = rawVal;
```

**Diagnostic** (saves 600s timeouts on misshapen input): a post-write
placeholder detector flags empty-placeholder descriptions at build time
with an HTTP 207 warning before the test ever runs.

**Generalization**: the `simple_name_values` type may appear on other
SP-category step types beyond `open_service_portal_page` /
`open_record_producer_sp`. If a future SP-category step type renders
empty-placeholder descriptions, add it to the `SIMPLE_NAME_VALUES_INPUTS`
map.

---

## Operational patterns

### Single-runner state accumulation

Single online manual `sys_atf_agent` runners accumulate browser-session
state across dispatches. After 3-6 workspace-SPA-open tests in the same
runner session, subsequent dispatches stall at the `Open Workspace Page`
step (600s ATF max-execution ceiling reached, `start_time` never
populates). **Operator-restart recovery** is durable for 3-6 fresh
dispatches; state accumulates again.

**Operational mitigations** (in order of cost):
1. **Cooldown** — wait ~6 min between same-runner workspace dispatches (works for short bursts).
2. **Operator restart** — close the runner browser tab + reopen `/atf_test_runner.do`. Resets the session-state accumulator. Fresh budget for 3-6 dispatches.
3. **Multi-runner partition** — provision a second `sys_atf_agent` (second browser tab on a different machine or session). Doubles throughput; load-balances across both.
4. **Scheduled runner** — for CI/CD, switch from manual `type=manual` runners to `type=scheduled`. Required by `/api/sn_cicd/testsuite/run` and avoids the manual-tab-state-accumulation problem entirely.

**Fail-fast diagnostic**: when a test's `Open Workspace Page` step never
populates `start_time` within 60s of dispatch, assume state-accumulation.
Save the 600s wait — cancel and recommend operator-restart instead.

### Pre-flight scope check

Before dispatching any ATF implementation, **read the upstream
spec / acceptance criteria for explicit out-of-scope markers**. Common
hard-reject markers (rename to your tracker's vocabulary):

| Marker | Meaning | Action |
|---|---|---|
| `Status: blocked` | Author found a hard test-data / infrastructure block | Escalate; don't try to author |
| `Status: un-automatable-pending-*` | Capability gap explicitly identified | Escalate; document the gating dependency |
| `Verdict: already-covered(<other-id>)` | Coverage exists under different case ID | Drop or link |
| `DEFER` / `Deferred` at main scope | Author scoped this iteration to a subset | Confirm subset is still worth probing; escalate if not |
| `Iteration 2` carving substantive coverage | Main observable deferred to a future iteration | Escalate |
| `Playwright-intrinsic` / `no ATF envelope` | Author identifies the case as out-of-envelope | Drop |

**Cost of skipping pre-flight**: ~20-30 minutes of implementer
absorb-and-escalate time per missed check. Read the first 60-100 lines of
the spec before any implementation fires.

### Whitelist substring discipline

ATF's `sys_atf_whitelist` substring matching is NOT byte-exact for some
quote-rich error strings. Stripping quoted substrings + standalone numbers
from the error before whitelisting engages reliably.

**Rule of thumb**: if a byte-exact whitelist entry doesn't engage on a
known-recurring warning, broaden the substring to remove quoted tokens and
numeric tokens:

```bash
# Bad — quote-rich; matches inconsistently
./scripts/whitelist_error.sh <test_sys_id> "Provided selected tab index '7' is not a valid index"

# Good — broader prefix substring engages reliably
./scripts/whitelist_error.sh <test_sys_id> "Provided selected tab index"
```

### `assert_text_on_page` reads VISIBLE text, NOT aria-label

Icon-only buttons (the `...` overflow trigger pattern, common across
workspace SPA) carry their labels in `aria-label` and have NO visible text
content. `assert_text_on_page` will not see them.

**Practical implication**: any test that needs to assert presence of an
icon-only affordance via ATF must use a different observable (e.g. a
downstream side-effect of clicking it, OR fall back to Playwright).

---

## What this skill is structurally good for vs structurally limited at

**Good at** (proven across multiple bench cycles):
- Server-side persistence + business-rule verification (the vast majority of bench cases hit this layer cleanly)
- ACL outcome differential probing (Pattern 1 — capability not in Playwright's natural envelope)
- Classic-UI form mutation + assertion (Standalone classic UI, no shadow DOM)
- Workspace sub-record form mutation (canonical pattern + reference-field writes)
- Service Portal flows on OOTB widgets (catalog producers shipped by SN, not custom)
- Workspace SPA chrome-text assertions (panel headings, column headers)

**Structurally limited at** (no engineering action closes these on the current platform):
- Workspace SPA shadow-DOM-bound field-value READING (confirmed via DOM investigation + ServiceNow's own positioning)
- Transient toast / popover affordances on any surface
- Icon-only / aria-only button labels
- Synthetic-event-driven web-component interactions (row-checkbox selection, Choice combobox clicks, drag-drop)
- Visual regression / screenshot diff
- Custom Service Portal widgets requiring `g_form` binding (confirmed runner-level, not authoring-channel)

For everything in the second category, **plan Playwright (or equivalent
UI-layer) coverage from day 1**. ATF covers the persistence half;
Playwright covers the UI half. The split is documented by ServiceNow's own
release cadence (Washington DC 2024 added 2 declarative-action step types
for workspace ATF; no workspace field-value-assertion step types added
through Yokohama 2025).

---

## External references (load-bearing on the structural-ceiling claim)

- **[ServiceNow Tokyo docs: Creating custom test step configurations](https://docs.servicenow.com/en-US/bundle/tokyo-application-development/page/administer/auto-test-framework/concept/atf-custom-step-types.html)** — *"you can define only step configurations that run on the server and not step configurations that run in the browser"* — anchors why custom shadow-piercing JS step types are not a supported extension point.
- **[The SN Nerd: Exploring ATF Support for Configurable Workspaces in Washington DC](https://sn-nerd.com/2024/02/22/exploring-atf-support-for-configurable-workspaces-in-washington-dc-release/)** — definitive analysis of the Washington DC ATF additions (2 declarative-action step types, no field-value step type).
- **[Can We Test Configurable Workspaces with ATF? Sort of...](https://www.servicenow.com/community/next-experience-blog/can-we-test-configurable-workspaces-with-atf-sort-of/ba-p/3281438)** — Yokohama-era confirmation the workspace-ATF gap persists.
- **[Interacting with Nested Shadow DOM in ServiceNow Workspace](https://www.servicenow.com/community/developer-forum/interacting-with-nested-shadow-dom-in-servicenow-workspace/td-p/3106209)** — community thread on manual shadow-traversal; ServiceNow's own response calls it *"not considered the best practice"*.
- **[ATF Custom Step Configuration1 — Get Display value of a Field](https://www.servicenow.com/community/developer-articles/atf-custom-step-configuration1-get-display-value-of-a-field/ta-p/2315648)** — community-standard "read field value from ATF" pattern is server-side via GlideRecord, structurally identical to Pattern 1.
