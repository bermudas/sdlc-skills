#!/usr/bin/env bash
# sdk_wipe_steps.sh — delete ALL sys_atf_step rows for a test sys_id, so a
# subsequent `now-sdk install` recreates exactly the current build.
#
# WHY: `now-sdk install` is ADDITIVE for sys_atf_step. Re-installing after
# changing a Fluent test's step $id set leaves orphan steps (duplicate order,
# still executed) that break the test. Wipe + reinstall is the remedy.
# See references/fluent-sdk.md §5.
#
# The test sys_id is STABLE (deterministic from Now.ID['key']) so this is
# safe to repeat; whitelist rows / history keyed to the test survive.
#
# Usage:
#   ./sdk_wipe_steps.sh <test_sys_id>
#   then: now-sdk install --auth <alias>
#   then verify: instance step count == (ls dist/app/update | grep -c sys_atf_step)
#
# Required env: SN_ATF_INSTANCE, SN_ATF_USER, SN_ATF_PASSWORD (via _env.sh)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <test_sys_id>" >&2
  exit 2
fi
TID="$1"
HOST="${SN_ATF_INSTANCE%/}"

python3 - "$HOST" "$SN_ATF_USER" "$SN_ATF_PASSWORD" "$TID" <<'PY'
import sys, json, base64, urllib.request
host, user, pw, tid = sys.argv[1:5]
auth = base64.b64encode(f"{user}:{pw}".encode()).decode()
def req(method, path):
    r = urllib.request.Request(host + path, method=method,
        headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
    return urllib.request.urlopen(r)
q = f"/api/now/table/sys_atf_step?sysparm_query=test={tid}&sysparm_fields=sys_id&sysparm_limit=500"
ids = [x["sys_id"] for x in json.load(req("GET", q))["result"]]
print(f"deleting {len(ids)} sys_atf_step rows for test {tid} ...")
d = 0
for sid in ids:
    try:
        req("DELETE", f"/api/now/table/sys_atf_step/{sid}"); d += 1
    except Exception as e:
        print("  delete failed:", sid, e)
remaining = len(json.load(req("GET", q))["result"])
print(f"deleted {d}; remaining {remaining}")
if remaining:
    sys.exit(1)
print("clean. Now run: now-sdk install --auth <alias>")
PY
