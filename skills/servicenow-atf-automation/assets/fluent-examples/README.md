# Fluent SDK example patterns

Working `.now.ts` patterns for the official `@servicenow/sdk` path. Read
`../../references/fluent-sdk.md` first — these encode its rules.

## Setup recap (see fluent-sdk.md §2–§3)

```bash
npx @servicenow/sdk@latest init --appName "..." --packageName "..." \
  --scopeName "x_<companycode>_atf" --template base --auth <alias>
# now.config.json MUST set "fluentDir": "src"  (default is src/fluent — trap)
npm install
now-sdk auth --add https://INSTANCE --type oauth --alias <alias>   # MFA-safe, zero admin
```

now.config.json:
```json
{ "scope": "x_<companycode>_atf", "scopeId": "<32-hex from init>",
  "name": "...", "fluentDir": "src" }
```

Build / deploy / run:
```bash
npx @servicenow/sdk build                                 # local; check: ls dist/app/update|grep -c sys_atf_step
env -u SN_SDK_NODE_ENV -u SN_SDK_INSTANCE_URL -u SN_SDK_USER -u SN_SDK_USER_PWD \
  npx @servicenow/sdk install --auth <alias>
# after ANY step-structure change: ../scripts/sdk_wipe_steps.sh <test_sys_id> then install again
../../scripts/run_test.sh <test_sys_id> [runner_session_id]
```

## Files

| File | Pattern |
|---|---|
| `server-and-rest.now.ts` | Pure server-side: recordInsert → REST send → response asserts → recordValidation. No UI, no batching concerns. Safest ATF shape. |
| `real-steps-form.now.ts` | The hard one: a classic-UI form driven through field changes with real `fieldStateValidation`/`fieldValueValidation`. Encodes the **batching rule** (§6: contiguous UI batch, server steps only at the ends) and the **calibration loop** (§7: assert field-state AFTER the trigger, in order; the failure tells you the true state). |

## The two rules these encode (re-read if a run fails)

1. **Batching (§6):** never put a `server.*` step between UI steps — it
   destroys `g_form`. Server validations/logs go strictly before/after the
   contiguous UI block.
2. **Calibration (§7):** field mandatory/readonly/visible states are driven
   by other fields. Don't guess them; run `fieldStateValidation`, read the
   failure (`Expected field 'x' to be visible but it was not`), correct,
   repeat. Assert state AFTER the change that causes it.
