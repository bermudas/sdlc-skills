# Fluent SDK — ATF tests as version-controlled code (PROVEN END-TO-END)

ServiceNow's official `@servicenow/sdk` ("Fluent") compiles `.now.ts` test
definitions into application metadata (`sys_atf_test` + `sys_atf_step` +
`sys_variable_value`) and installs it on the instance. The SDK serializes the
`glide_var` step inputs **natively** — so for SDK-authored tests you do **not**
need Path B's Scripted-REST `glide_var` workaround at all.

> Provenance: `@servicenow/sdk` is published under the official `@servicenow`
> npm scope, maintained by `buildeng@servicenow.com`. `now-sdk` is its CLI.
> This guide reflects a full end-to-end run proven on a live MFA-enforced
> tenant (author → build → OAuth login → deploy → run → green). Every claim
> below was verified, not assumed. Several older write-ups (including earlier
> versions of this file) were wrong about OAuth and MFA — corrected here.

Further reading (port patterns from these; trust THIS file over them where
they conflict, it reflects a real run):
- Upstream skill: `github.com/aatrey882/servicenow-agent-skills` → `sn-sdk-fluent/SKILL.md`
- Official examples: `github.com/ServiceNow/sdk-examples/tree/main/test-atf-sample`
- `now-sdk explain atf-guide` / `test-api` / `now-config-reference`

---

## 1. SDK path vs Path B — choose deliberately

Pick **Fluent SDK** when: tests must live in version control as code,
reviewed like any other change; you want the *official, vendor-supported*
serializer (no home-grown `glide_var` hack); typed output-variable chaining
(`const r = atf.form.submitForm(...)` → `r.record_id`).

Pick **Path B** (Scripted-REST builder) when: you need **Global-scope** ATF
tests (SDK only installs *scoped apps* — see §5); you need an
**Open Workspace Page** / Custom-UI step (the Fluent API has none — see §4);
zero client install; AI agent emitting JSON specs; or the
`action:"run"` manual-runner dispatch.

Complementary, both land in `sys_atf_test`. Common split: **author with the
SDK** (source of truth), **dispatch runs / Global deploys with Path B**.

---

## 2. Project setup

Node 20+ (tested on v25). Per-project:

```bash
mkdir my-atf && cd my-atf
npx @servicenow/sdk@latest init \
  --appName "My ATF Tests" --packageName "my-atf-tests" \
  --scopeName "x_<companycode>_atf" --template base --auth <alias>
npm install
```

- `now-sdk init` **reserves the scope on the instance** (creates `sys_app` /
  `sys_scope`) — needs a working `--auth` alias; it is a shared-state change.
  Scope = `x_<companycode>_<app>`, **≤ 18 chars**; company code is the
  instance property `glide.appcreator.company.code`
  (`GET /api/now/table/sys_properties?sysparm_query=name=glide.appcreator.company.code`).
- `--template base` = minimal scaffold (no client UI) — right for ATF.
- The scaffold pins `@servicenow/glide` to **its own correct version**.
  **Never hand-pin `@servicenow/glide`** — guessing a version 404s on npm.

### ⚠ now.config.json — the `fluentDir` trap

Default `fluentDir` is **`src/fluent`**, NOT `src`. If `.now.ts` files live
in `src/` (as the official examples do) and you don't set `fluentDir`,
`now-sdk build` **silently emits zero ATF records** (only `sys_module`). Set
it:

```json
{ "scope": "x_<companycode>_atf", "scopeId": "<32-hex from init>",
  "name": "My ATF Tests", "fluentDir": "src" }
```

---

## 3. Auth — OAuth is the MFA answer, and needs ZERO admin setup

```bash
now-sdk auth --add https://INSTANCE.service-now.com --type <basic|oauth> --alias <alias>
now-sdk auth --list
```

**`--type basic` has NO MFA support.** On an MFA account, basic auth
(interactive *and* CI env-var mode `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL` +
`SN_SDK_INSTANCE_URL/USER/USER_PWD`) **detects MFA, logs it, and hard-exits —
it never prompts for the code.** Not a TTY issue; `expect`/`tmux` cannot help
(no prompt exists). Older "type the code interactively" docs are wrong. Use
basic only for non-MFA accounts/PDIs.

**`--type oauth` works with MFA and needs NO instance provisioning.** It uses
a **built-in SDK OAuth client already present on every instance** (you'll see
`client_id=543e5655…` in the URL). There is **no** "register an OAuth API
endpoint" step — that older instruction is wrong. Flow (human, needs a
browser): it opens `…/oauth_auth.do?…redirect_uri=%2Fsdk-oauth.do…`; user
does the **normal web login incl. MFA**; ServiceNow redirects to
`…/sdk-oauth.do` showing an **authorization code**; user pastes it into the
masked CLI prompt; token is stored and **auto-refreshes** (`install` prints
`Access Token has expired, refreshing token` and proceeds — one-time browser
login → unattended redeploys).

Deploy with the stored alias and **without** the CI env vars (they force the
MFA-incompatible CI path):

```bash
env -u SN_SDK_NODE_ENV -u SN_SDK_INSTANCE_URL -u SN_SDK_USER -u SN_SDK_USER_PWD \
  npx @servicenow/sdk install --auth <alias>
```

Fully-unattended CI on an MFA tenant still wants an **MFA-exempt service
account** (then `--type basic` CI mode works).

---

## 4. Writing a test — Fluent is a STATIC AST parser

```typescript
import { Test } from '@servicenow/sdk/core'

export default Test(
    { $id: Now.ID['my-test'], name: 'My ATF Test',
      description: 'single string literal only', active: true, failOnServerError: false },
    (atf) => {
        atf.server.impersonate({ $id: 'imp', user: '<sys_user sys_id>' })
        atf.form.openNewForm({ $id: 'open', table: 'incident', view: '', formUI: 'standard_ui' })
        atf.form.setFieldValue({ $id: 'set', table: 'incident', formUI: 'standard_ui', fieldValues: { short_description: 'x' } })
        const rec = atf.form.submitForm({ $id: 'submit', formUI: 'standard_ui', assert: 'form_submitted_to_server' })
        atf.server.recordValidation({ $id: 'val', table: 'incident', recordId: rec.record_id, fieldValues: 'short_description=x^EQ', enforceSecurity: true, assert: 'record_validated' })
    }
)
```

**Hard constraint — property values must be string LITERALS.** The build
statically analyses the AST; it does **not** execute the file. Concatenation
(`'a' + 'b'`), template literals, computed values, or any expression in a
property value fail with `TS303: Failed to parse property`. Encoded queries,
descriptions, logs — all single inline literals. Plan data accordingly.

`Now.ID['key']` mints a **deterministic** sys_id from the key — stable across
rebuilds; so the test sys_id is stable and `sys_atf_whitelist`/history keyed
to it survive re-deploys.

### API surface

`atf.<group>.<method>({ $id, ...inputs })`. Groups (11 total, per `now-sdk
explain atf-guide`): `server`, `form`, **`form_SP`** (Service Portal form
variants — `Test.d.ts` lines 347-565), **`catalog_SP`** (Service Portal
catalog variants incl. record producers + multi-row variable sets —
`Test.d.ts` lines 569-1000; note `openRecordProducer` param is
`recordProducer:` NOT `catalogItem:`), `rest`, `catalog`,
`applicationNavigator`, `email`, `reporting`, `responsiveDashboard`.
- `server`: `impersonate`, `log`, `recordInsert`, `recordValidation`,
  `recordQuery`, `recordUpdate`, `recordDelete`, `runServerSideScript`, `createUser`.
- `form`: `openNewForm`, `openExistingRecord`, `setFieldValue`, `submitForm`,
  `fieldStateValidation`, `fieldValueValidation`, `clickUIAction`,
  `clickDeclarativeAction`, `uiActionVisibility`, `declarativeActionVisibility`,
  `clickModalButton`.
- `formUI`: `standard_ui | service_operations_workspace | asset_workspace | cmdb_workspace`.
- Output chaining: `const r = atf.form.submitForm(...)` → `r.record_id`
  (also `atf.server.recordInsert`).
- Input shapes: `recordValidation`/`recordQuery` `fieldValues` =
  **encoded-query string**; `setFieldValue`/`recordInsert` `fieldValues` =
  **object**; `recordValidation` also takes `recordId`. Authoritative
  signatures: `node_modules/@servicenow/sdk-core/dist/app/Test.d.ts`.

**No `openWorkspace` / Custom-UI / "Open Workspace Page" step exists in
Fluent.** A workspace-navigation QTest cannot be click-driven via the SDK —
use `openNewForm` (opens the form directly) + server-side outcome
verification, or Path B's `open_workspace`.

**SDK ≠ Path B escape hatch for custom-widget SP failures.** The SDK's
`form_SP` / `catalog_SP` groups invoke the **same OOTB SP step-config sys_ids
as Path B**, so they share the same runner-level ceiling on custom Service
Portal widgets (the `g_form is not defined` failure on portals that ship
widget overrides). The hopeful "use Fluent SDK to bypass the SP failure"
path is **ruled out** — server-side persistence substitution via
`run_server_script` is the correct workaround regardless of authoring
channel. See `references/poc-bench-patterns.md` § "Destructive-cascade
substitution" for the runtime evidence.

---

## 5. Build & deploy — scoped only, install is ADDITIVE

```bash
npx @servicenow/sdk build                       # 100% local, no instance contact
npx @servicenow/sdk install --auth <alias>
```

- `build` emits `dist/app/update/sys_atf_test_*.xml` + `sys_atf_step_*.xml` +
  `sys_variable_value` (glide_var inputs serialized correctly by the official
  toolchain). Sanity-check: `ls dist/app/update | grep -c sys_atf_step` — 0 ⇒
  the `fluentDir` trap (§2).
- **SDK installs SCOPED apps only.** `scope:"global"` install fails ("Could
  not determine app installation status", writes nothing). Tests land in the
  scoped app; the platform shows a cosmetic *"record is in <App>, but Global
  is the current application"* banner — scoped ATF executes fine vs Global
  tables (proven). To truly remove the banner, deploy to Global via Path B.

### ⚠ `install` is ADDITIVE for `sys_atf_step` — orphans WILL break the test

Re-`install` after changing a test's step `$id` set does **not** prune old
steps. They stay with duplicate `order` and **still execute** (a stale broken
step keeps failing your "fixed" test; instance step count >> build count).
Remedy after any step-structure change — **wipe all steps for the test
sys_id, then reinstall** (install recreates exactly the current build):

```bash
TID=<test sys_id>      # stable from Now.ID['key']
for s in $(curl -sS -u "$U:$P" "$HOST/api/now/table/sys_atf_step?sysparm_query=test=$TID&sysparm_fields=sys_id&sysparm_limit=500" \
  | python3 -c "import json,sys;print(' '.join(r['sys_id'] for r in json.load(sys.stdin)['result']))"); do
  curl -sS -o /dev/null -X DELETE -u "$U:$P" "$HOST/api/now/table/sys_atf_step/$s"; done
npx @servicenow/sdk install --auth <alias>
# verify instance step count == ls dist/app/update | grep -c sys_atf_step
```

(`scripts/sdk_wipe_steps.sh <test_sys_id>` ships this.)

---

## 6. THE BATCHING RULE — server steps must not split a UI batch

The most expensive lesson of the proving run. ATF runs UI steps in a browser
batch sharing one `g_form`. A **server-side step (`server.log`,
`server.record*`, `impersonate`) placed *between* UI steps ends the UI batch
and destroys the form context.** The next UI assertion fails:

> `FAILURE: Unable to perform field state validation because g_form is not defined. A valid form must be open before running assertions`

Documented in the SDK's own `test-atf-sample/atf-batching.now.ts`. It bit us:
traceability `server.log` steps between every UI action silently broke every
downstream UI assertion.

**Rule:** keep the whole UI flow **contiguous**
(`openNewForm → setFieldValue → fieldStateValidation → … → submitForm`, zero
`server.*` between). Batch all `impersonate`/`recordValidation`/`log` strictly
**before and after** the UI block. Traceability goes in test/step
descriptions or one `server.log` *before* the UI batch — never interleaved.
Applies to Path B specs that mix server + form steps too.

---

## 7. UI step reality — what works, whitelist, calibration

- **`fieldStateValidation`/`fieldValueValidation` execute on classic
  (`standard_ui`)** even on heavily client-scripted tables (read assertions —
  robust). On **workspace** `formUI` they hit `ATF_INTENT_GENERATOR` timeout
  (architectural) — don't use workspace formUI for field-state asserts.
- **`setFieldValue` can throw** on forms with reactive async-`GlideAjax`
  `onChange`: `Cannot read properties of undefined (reading 'message')` — ATF
  choking on a benign incidental client error, not the thing under test.
- **`sys_atf_whitelist`** downgrades a known-benign client error to `warning`
  per-test so the step proceeds. Legitimate **iff** the error is incidental
  *and* real assertions still prove the outcome (a true defect still fails
  them) — that is NOT defect-masking. Whitelisting the thing under test IS.
  Keep the outcome assertions.
  `./scripts/whitelist_error.sh <test_sys_id> "<error substring>" warning`
- **Calibrate against reality (probe loop).** Don't assume
  mandatory/readonly/visible. Run `fieldStateValidation`; the failure tells
  the true state (`Expected field 'x' to be visible but it was not visible`);
  correct; repeat. Field states are usually **driven by other fields** (a
  classification dropdown flips half the form) — assert state **after** the
  trigger, in order. Asserting state *before* the change that causes it is
  the #1 authoring bug (cost us a full run).

---

## 8. Running an SDK-authored test

Normal `sys_atf_test`. `/api/sn_cicd/testsuite/run` needs a *scheduled*
runner; for a logged-in manual `/atf_test_runner.do` browser dispatch via
Path B `action:"run"` (`scripts/run_test.sh <test_sys_id> [runner_session_id]`).
Pin `runner_session_id` if the manual runner flaps Online/Offline
(auto-discovery silently no-ops when none online at dispatch). Cancel stale
`running`/`pending`/`waiting` `sys_atf_test_result` rows (status `canceled`,
single-L) — they block dispatch.

---

## 9. Example patterns

`assets/fluent-examples/` ships: a server+REST pattern (official-sample
shape) and the **real-steps UI form pattern** (the proven shape) which
encodes §6 (contiguous UI batch, server validations at the ends) and §7
(classic `formUI`, whitelist + calibrated `fieldStateValidation`). Start from
those — the official samples are all server-side / simple `standard_ui` and
don't show the batching discipline a real reactive form needs.

---

## 10. Commands

```bash
now-sdk explain --list | atf-guide | test-api | now-config-reference
now-sdk auth --list
now-sdk download <dir>     # pull existing app
now-sdk transform          # legacy update-set XML -> Fluent
```
