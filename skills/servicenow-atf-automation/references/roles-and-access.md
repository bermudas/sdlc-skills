# Roles and Access

What permissions the account driving Path B needs, how to verify them, where credentials live, and what to do when something's missing.

## Where credentials live

Scripts source credentials from `.env` in your project root (`_env.sh` walks up from `$PWD`, max 5 parent directories). The three keys are:

```
SN_ATF_INSTANCE=https://your-instance.service-now.com
SN_ATF_USER=your.admin.username
SN_ATF_PASSWORD=your-password
```

Shell environment variables of the same name override `.env`. For CI, set `ATF_ENV_FILE=/abs/path/to/.env` to point at a non-standard location.

The `.env.example` in this repo documents the slots; copy them into your `.env` (which should be gitignored) and fill in real values.

## Quick check

```bash
# Verify .env loading + basic connectivity
./scripts/discover_steps.sh --categories | head -3

# List your account's roles (use the loaded creds from .env)
source ./scripts/_env.sh && require_creds
curl -sS -u "$ATF_AUTH" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_user_has_role?sysparm_query=user.user_name=$SN_ATF_USER&sysparm_fields=role.name&sysparm_display_value=true&sysparm_limit=200" \
  | python3 -m json.tool | grep -iE 'admin|atf'
```

If `admin` shows up, you're set. If not, see the role matrix below.

## What each role unlocks

| Role | Needed for | Notes |
|---|---|---|
| `admin` | Everything in this skill | Superset; if you have this, you don't need the others |
| `atf_test_admin` | Create/modify/delete ATF tests and step records | Needed if you don't have `admin` |
| `atf_test_designer` | Open Test Designer UI; modify step input values via UI APIs | Useful if you also want UI access |
| `atf_ws_designer` | Build REST step types specifically | Narrow — only needed for `Send REST Request — Inbound` style step types |
| `sn_atf_tg.cloud_runner_mcp` | Invoke the AI Test Generator MCP endpoints (`/api/now/cloud_runner_mcp/*`) | Only if you plan to use the Cloud Runner generator (different from this skill's main flow) |

Path B's Scripted REST API runs with `admin`-level access by default (no ACL on the operation), so as long as your authenticated user has `admin` (or you elevate it via business rule), the operation's GlideRecord block has the permissions it needs regardless of the caller's other roles.

## Verifying via REST

```bash
# Does my user hold a specific role? (direct grants only — not via groups)
curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_user_has_role?sysparm_query=user.user_name=$SN_ATF_USER^role.name=atf_test_admin&sysparm_fields=role.name&sysparm_limit=1"

# What roles do I get via group membership?
GROUPS=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_user_grmember?sysparm_query=user.user_name=$SN_ATF_USER&sysparm_fields=group&sysparm_limit=20" \
  | python3 -c "import json,sys; r=json.load(sys.stdin).get('result',[]); print('^OR'.join([f\"group={x['group']['value']}\" for x in r]))")
[[ -n "$GROUPS" ]] && curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_group_has_role?sysparm_query=$GROUPS&sysparm_fields=role.name&sysparm_display_value=true&sysparm_limit=200" \
  | python3 -m json.tool
```

If neither direct nor inherited grants give you `admin` / `atf_test_admin`, you need to request them from an instance admin.

## MFA — what to watch for

ServiceNow's MFA enforcement is **per-authentication-route**, not per-user. The same user might:

- Authenticate **without** MFA when hitting `/api/now/table/*` and `/api/sn_cicd/*` with HTTP basic auth (this is how Path B works)
- Authenticate **with** MFA when hitting the UI login route used by the Fluent SDK and by some scripted REST APIs that piggy-back on UI session validation
- Authenticate **without** MFA via OAuth if the OAuth app config doesn't require it

If you see `User Not Authenticated` for a route where basic auth normally works, the route may be in the second bucket. Two options:

1. **Use OAuth.** Register an OAuth app in `System OAuth → Application Registry` (Endpoint for external clients). Use grant_type=password or client_credentials. The token bypasses MFA. Configure `now-sdk auth --type oauth --alias <name>` or use the token as a `Bearer` header.

2. **Avoid those routes.** Path B's `/api/now/atf_builder/create` is reachable with basic auth — that's why this skill defaults to it.

## The ATF Test Runner agent

Building tests via REST does not require a runner. **Executing** them does.

A "runner" is a logged-in browser session at `<instance>/atf/agent.do` that registers itself in `sys_atf_agent`. The CI/CD `testsuite/run` endpoint dispatches to whichever runner is `Online` for the relevant user.

Verify a runner is up:

```bash
curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" -H "Accept: application/json" \
  "$SN_ATF_INSTANCE/api/now/table/sys_atf_agent?sysparm_fields=user.user_name,status&sysparm_display_value=true"
```

If everything's `Offline` and you trigger a run, you'll see all steps marked `Skipped` with no error from the trigger endpoint itself.

The runner agent disconnects when the browser session ends (timeout, close, navigate-away). If your CI environment can't keep a browser session open, the alternatives are:

- A dedicated VM with an always-logged-in browser
- ServiceNow's **Cloud Runner** subscription (hosted Chromium, controlled via `/api/now/cloud_runner_mcp/*`)
- Running ATF only on-demand from a developer's local session

For exploratory/manual runs, just having Test Designer or `/atf/agent.do` open in a browser tab is sufficient.

## What about service accounts?

If you're driving this from a CI pipeline, you almost certainly want a **dedicated service account** with:

- `admin` role (or the narrower `atf_test_admin` + `atf_test_designer` set)
- MFA disabled (or member of an MFA-exempt group, depending on instance policy)
- Strong password stored as a CI secret
- Optional: an OAuth token to use instead of basic auth for cleaner audit logs

Document the service account in your project's `.env.example` so the credential slot is reproducible, and never commit the actual password.
