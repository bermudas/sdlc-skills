# Fluent SDK — The Alternative Path

ServiceNow's official `@servicenow/sdk` (Fluent) compiles `.now.ts` test definitions into update set XML that ServiceNow ingests via its internal serializer. The internal serializer sets `var__m_*` columns server-side, so Fluent works for the same underlying reason as Path B — it ends up running inside the platform.

This file documents Fluent enough to choose between paths and to spin up a working setup. If you commit to Fluent, the [official docs](https://www.servicenow.com/docs/r/yokohama/application-development/servicenow-sdk/) cover the rest.

## When to choose Fluent over Path B

Pick Fluent if:

- Your team wants ATF tests committed as TypeScript files in version control, reviewable like any other code
- You already use the ServiceNow SDK for app development (shared toolchain)
- Type safety on test definitions matters more than zero-install footprint
- You can deal with the auth setup (interactive on first install; OAuth after)

Pick Path B if:

- You want zero client-side install (just `curl`)
- You're driving from an AI agent that emits JSON specs
- The team doesn't standardize on ServiceNow SDK for other work
- MFA on basic-auth is a blocker for your CI and OAuth setup isn't worth it

Both paths produce identical `sys_atf_test` records on the instance. Choosing one doesn't lock you out of the other.

## Installation

```bash
npm install -g @servicenow/sdk          # provides the `now-sdk` binary
# or, per-project:
mkdir my-atf-tests && cd my-atf-tests
npm init -y && npm install @servicenow/sdk
# now-sdk is at ./node_modules/.bin/now-sdk
```

Requires Node 20+. The `now-sdk` binary is also aliased as `sdk` and `@servicenow/sdk`.

## Authentication

```bash
now-sdk auth --add https://your-instance.service-now.com --type basic --alias mysn
```

The command prompts interactively for username and password. **It does not accept piped stdin** — the prompt library re-renders on every keystroke and breaks `expect` automation. You have to type credentials manually (or use OAuth, below).

Credentials are stored in your OS keychain (macOS Keychain, Linux libsecret, Windows Credential Manager).

### MFA gotcha

If your account requires MFA, the basic-auth login flow will fail with `Your account requires Multi-factor authentication. Please enter the 6-digit code...`. The SDK does accept the code if you type it interactively, but you'll be entering it on every `now-sdk install`. For CI this is unworkable. Two fixes:

1. **OAuth** (recommended for CI). Register an OAuth app on the instance:
   - `System OAuth → Application Registry → New`
   - `Create an OAuth API endpoint for external clients`
   - Save the client ID and secret
   - `now-sdk auth --add <instance> --type oauth --alias mysn` — provides the client ID/secret, follows OAuth code grant. Token bypasses MFA.

2. **MFA-exempt service account.** Some instances allow excluding specific users from MFA via a group. If your admin can put a dedicated CI user in that group, basic auth works without prompts.

## Project init

```bash
now-sdk init \
  --auth mysn \
  --appName "My ATF Tests" \
  --packageName "@mycompany/atf-tests" \
  --scopeName "x_mc_atf" \
  --template typescript.basic
```

This creates `now.config.json`, `tsconfig.json`, and a project skeleton. `--scopeName` must start with a vendor prefix on most instances (typically `x_`) and is limited to 18 characters.

## Writing a test

Create `src/atf/my-test.now.ts`:

```typescript
import { Test } from "@servicenow/sdk/core";
import "@servicenow/sdk/global";

Test(
  {
    $id: Now.ID["my_test_id"],         // unique within your app
    name: "My ATF Test",
    description: "...",
    active: true,
    failOnServerError: true,
  },
  (atf) => {
    atf.server.impersonate({
      $id: Now.ID["step_imp_customer"],
      user: "<sys_user sys_id>",
    });

    atf.server.log({
      $id: Now.ID["step_log_1"],
      log: "Customer phase begin",
    });

    atf.server.recordValidation({
      $id: Now.ID["step_validate_1"],
      table: "incident",
      record_id: "<sys_id>",
      conditions: "state=3",
    });
  },
);
```

Key concepts:

- **`Test()`** declares a `sys_atf_test`. The first arg is metadata, the second is a callback that builds steps.
- **`Now.ID["name"]`** mints stable sys_ids. The name is your local key; the SDK persists the mapping in a `keys.ts` file so the same logical step always gets the same sys_id across rebuilds.
- **`atf.<category>.<method>`** is the step-builder API. Categories include `server`, `form`, `form_SP`, `rest`, `catalog`, `catalog_SP`, `email`, `applicationNavigator`, `reporting`, `responsiveDashboard`.
- **All step methods take a `$id` plus the step-specific inputs** (matching the input element names from `atf_input_variable`).

For the full method surface, run:

```bash
now-sdk explain atf-guide   # the strategic guide
now-sdk explain test-api    # the API reference
```

## Build and deploy

```bash
now-sdk build       # compiles all .now.ts files into an installable package
now-sdk install     # uploads to the instance configured by your auth alias
```

If you re-run `install`, the SDK does a delta update — unchanged records are skipped, changes are applied via update set.

To re-create from scratch (e.g., if local and instance state diverge): `now-sdk install --reinstall` — *uninstalls* the app on the instance first, then reinstalls. **Records created on-instance that aren't in your local source will be lost.** Use carefully.

## Running tests created via Fluent

Same as Path B — the `sys_atf_test` records that Fluent produces are normal ATF tests. Wrap in a suite, trigger via `/api/sn_cicd/testsuite/run`, poll, read results. The Path B `run_suite.sh` works equally well for Fluent-built tests:

```bash
# Source the Path B env loader so $SN_ATF_INSTANCE and $ATF_AUTH are populated
source ./scripts/_env.sh && require_creds

# Find your Fluent-built test by name
TEST_SYSID=$(curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_test?sysparm_query=name=My%20ATF%20Test&sysparm_fields=sys_id&sysparm_limit=1" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['sys_id'])")

# Run it via the Path B run-suite script
./scripts/run_suite.sh "$TEST_SYSID"
```

## When to combine Fluent + Path B

A reasonable pattern for teams that adopt both:

- **Fluent for stable, long-lived tests** that should live in source control and be reviewed
- **Path B for ephemeral / generated / AI-driven test construction** — exploratory tests, tests built from external data, throwaway smoke checks

The tests don't conflict — they all land in `sys_atf_test`. Just adopt naming prefixes so it's clear which framework produced which test.

## What Fluent can do that Path B can't (yet)

- **Type-checked references** — passing a string where a `Record<'sys_user'>` is expected fails at compile time
- **Cross-step output capture** — `const newCase = atf.server.recordInsert({...})` returns a typed handle you can pass to later steps; the SDK generates the `{{Step N: ...}}` expression for you
- **Versioned updates** — the SDK tracks what was previously deployed and only sends deltas

Path B can be extended to handle these (see `spec-schema.md` § Extending the builder) but it's a "build it yourself" situation, while Fluent gives them out of the box.

## Useful Fluent commands

```bash
now-sdk explain --list                # list all available documentation topics
now-sdk explain atf-guide             # high-level strategy
now-sdk explain test-api              # the Test() function and ATF categories
now-sdk explain fluent-overview       # general Fluent intro
now-sdk download <directory>          # download an existing app from the instance
now-sdk transform                     # convert legacy update-set XML to Fluent TS
now-sdk dependencies                  # download type definitions for tables you reference
```
