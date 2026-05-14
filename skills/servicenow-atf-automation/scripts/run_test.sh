#!/usr/bin/env bash
# run_test.sh — dispatch a single ATF test against an online manual browser
# runner, via Path B's action:run. Avoids the suite/CI-CD wrapper of
# run_suite.sh and the "scheduled runner only" restriction of
# /api/sn_cicd/testsuite/run.
#
# Use this when:
#   - You have a regular /atf_test_runner.do browser session open (type=manual)
#   - You don't want to wrap your test in a suite
#   - run_suite.sh fails with "no scheduled client test runner available"
#
# Usage:
#   ./run_test.sh <test_sys_id> [runner_session_id]
#
# Required env: SN_ATF_INSTANCE, SN_ATF_USER, SN_ATF_PASSWORD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

if [[ $# -lt 1 ]]; then
    cat >&2 <<EOF
Usage:
  $0 <test_sys_id> [runner_session_id]

Dispatches the test to a manual browser runner via Path B action:run.
If runner_session_id is omitted, auto-discovers the freshest online runner.

Example:
  $0 <test_sys_id>     # auto-discover the freshest online manual runner
  $0 <test_sys_id> <runner_session_id>
EOF
    exit 2
fi

TEST_SYS_ID="$1"
RUNNER_SESSION_ID="${2:-}"
HOST="${SN_ATF_INSTANCE%/}"

if [[ -z "$RUNNER_SESSION_ID" ]]; then
    echo "▸ Auto-discovering online runner..."
    # Filter to manual browser runners (not cloud / not headless)
    RUNNER_SESSION_ID=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
        "${HOST}/api/now/table/sys_atf_agent?sysparm_query=status%3Donline%5Etype%3Dmanual%5Eis_cloud_runner%3Dfalse%5EORDERBYDESClast_checkin&sysparm_fields=session_id&sysparm_limit=1" \
        | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['session_id'] if r else '')")
    if [[ -z "$RUNNER_SESSION_ID" ]]; then
        echo "  ✗ No online runner found. Open /atf_test_runner.do first." >&2
        exit 3
    fi
    echo "  ✓ $RUNNER_SESSION_ID"
fi

REQ=$(mktemp); trap 'rm -f "$REQ"' EXIT
cat > "$REQ" <<EOF
{"action":"run","testSysId":"${TEST_SYS_ID}","runnerSessionId":"${RUNNER_SESSION_ID}","capturePageData":true,"useCloudRunner":false}
EOF

# Pre-flight: cancel stale pending/waiting test_result rows for this test that
# would otherwise block the runner's claim cycle. These accumulate from earlier
# failed dispatches (cloud runners going offline, stale session refs, etc.).
echo "▸ Pre-flight: cancelling stale pending/waiting test results for this test..."
STALE_IDS=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/table/sys_atf_test_result?sysparm_query=test%3D${TEST_SYS_ID}%5EstatusINpending,waiting&sysparm_fields=sys_id" \
    | python3 -c "import json,sys; print(' '.join(r['sys_id'] for r in json.load(sys.stdin).get('result', [])))")
for s in $STALE_IDS; do
    curl -sS -X PATCH -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
        -H "Content-Type: application/json" -d '{"status":"canceled"}' \
        "${HOST}/api/now/table/sys_atf_test_result/$s" > /dev/null
    echo "  ✓ cancelled $s"
done
[[ -z "$STALE_IDS" ]] && echo "  (none)"

echo "▸ Dispatching..."
RESP=$(curl -sS -X POST -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    -H "Content-Type: application/json" --data-binary @"$REQ" \
    "${HOST}/api/now/atf_builder/create")

TRACKER=$(echo "$RESP" | python3 -c "import json,sys; r=json.load(sys.stdin).get('result',{}); print(r.get('execution_tracker_sys_id',''))")
if [[ -z "$TRACKER" ]]; then
    echo "$RESP" | python3 -m json.tool 2>&1 | sed 's/^/  /'
    exit 4
fi
echo "  ✓ tracker=$TRACKER"

echo "▸ Polling..."
POLLS=0
MAX_POLLS=120
INTERVAL=5
while [[ $POLLS -lt $MAX_POLLS ]]; do
    STATE=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
        "${HOST}/api/now/table/sys_execution_tracker/${TRACKER}?sysparm_fields=state" \
        | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['state'])")
    case "$STATE" in
        2) echo "  ✓ Complete"; break ;;
        3) echo "  ✗ Failure";  break ;;
        4) echo "  ⚠ Cancelled"; break ;;
        *) echo "  [$POLLS] state=$STATE"; sleep $INTERVAL ;;
    esac
    POLLS=$((POLLS + 1))
done

RID=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/table/sys_atf_test_result?sysparm_query=test%3D${TEST_SYS_ID}%5EORDERBYDESCsys_created_on&sysparm_fields=sys_id,status&sysparm_limit=1" \
    | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['sys_id']+'|'+r[0]['status'])")
RID_VAL="${RID%%|*}"
RID_STATUS="${RID#*|}"
echo "▸ Test result: $RID_VAL ($RID_STATUS)"

echo
echo "════ Step results ════"
curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/table/sys_atf_test_result_step?sysparm_query=test_result%3D${RID_VAL}%5EORDERBYstep_order&sysparm_fields=status,summary,step.display_name&sysparm_display_value=all" \
    | python3 -c "
import json,sys
from collections import Counter
counts = Counter()
for r in json.load(sys.stdin)['result']:
    s = r.get('status',{}).get('display_value','?')
    n = r.get('step.display_name',{}).get('display_value','?')
    smy = r.get('summary',{}).get('display_value','')[:200]
    sym = {'Success':'✅','Success with Warning(s)':'⚠️','Failure':'❌','Skipped':'⏭️'}.get(s, s)
    counts[s] += 1
    print(f'  {sym} {n:34s} | {smy}')
print()
print('Summary:', dict(counts))
"
