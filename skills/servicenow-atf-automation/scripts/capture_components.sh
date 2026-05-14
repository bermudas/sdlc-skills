#!/usr/bin/env bash
# capture_components.sh — trigger ServiceNow's official ATF component-capture
# flow against a test step's post-state. Components and snapshots get written
# into sys_atf_ui_component / sys_atf_snapshot. Use these for subsequent
# Custom UI / Set Component Values / Test Page steps.
#
# This is the programmatic equivalent of Test Designer's "Record Page
# Components" button — no UI page click required. Works via Path B's
# action:run + retrieveComponentsStep mechanism.
#
# Usage:
#   ./capture_components.sh <test_sys_id> <step_sys_id> [runner_session_id]
#
# Arguments:
#   test_sys_id          The sys_atf_test that has at least one navigation step
#   step_sys_id          The sys_atf_step whose post-state should be captured
#                        (capture happens AFTER this step runs)
#   runner_session_id    Optional. If omitted, auto-discovers the freshest
#                        online runner from sys_atf_agent.
#
# Required env: SN_ATF_INSTANCE, SN_ATF_USER, SN_ATF_PASSWORD (loaded from .env)
#
# Preconditions:
#   - A /atf_test_runner.do browser session must be online for your user
#     (run scripts/bootstrap_builder.sh first if you haven't installed
#     the Path B API)
#   - The named test_sys_id must exist and contain at least the navigation
#     step you'll reference as step_sys_id
#
# Output:
#   - Snapshot sys_id of the capture
#   - Component count for that snapshot
#   - Sample components grouped by tag/method
#
# After capture, use find_components.sh to extract specific mugshots.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

if [[ $# -lt 2 ]]; then
    cat >&2 <<EOF
Usage:
  $0 <test_sys_id> <step_sys_id> [runner_session_id]

Triggers ServiceNow's component-capture flow against the test's step post-state.
After this script runs, query sys_atf_ui_component WHERE snapshot=<returned id>
to see the components captured.

Example:
  $0 <test_sys_id> <navigation_step_sys_id>
EOF
    exit 2
fi

TEST_SYS_ID="$1"
STEP_SYS_ID="$2"
RUNNER_SESSION_ID="${3:-}"

HOST="${SN_ATF_INSTANCE%/}"

# Auto-discover runner if not provided
if [[ -z "$RUNNER_SESSION_ID" ]]; then
    echo "▸ Auto-discovering online runner..."
    # Filter to manual browser runners (not cloud / not headless)
    RUNNER_SESSION_ID=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
        "${HOST}/api/now/table/sys_atf_agent?sysparm_query=status%3Donline%5Etype%3Dmanual%5Eis_cloud_runner%3Dfalse%5EORDERBYDESClast_checkin&sysparm_fields=session_id&sysparm_limit=1" \
        | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['session_id'] if r else '')")
    if [[ -z "$RUNNER_SESSION_ID" ]]; then
        echo "  ✗ No online runner found. Open /atf_test_runner.do in your browser first." >&2
        exit 3
    fi
    echo "  ✓ session_id: $RUNNER_SESSION_ID"
fi

# Baselines for delta reporting
SNAP_BASE=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/stats/sys_atf_snapshot?sysparm_count=true" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['stats']['count'])")
COMP_BASE=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/stats/sys_atf_ui_component?sysparm_count=true" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['stats']['count'])")
echo "▸ Baseline: ${SNAP_BASE} snapshots, ${COMP_BASE} components"

# Build the request body via tempfile to avoid heredoc-after-pipe quirks on macOS
REQ_FILE=$(mktemp)
trap 'rm -f "$REQ_FILE"' EXIT
cat > "$REQ_FILE" <<EOF
{
  "action": "run",
  "testSysId": "${TEST_SYS_ID}",
  "runnerSessionId": "${RUNNER_SESSION_ID}",
  "capturePageData": true,
  "retrieveComponentsStep": "${STEP_SYS_ID}"
}
EOF

echo "▸ Dispatching capture run..."
RESP=$(curl -sS -X POST -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    -H "Content-Type: application/json" \
    --data-binary @"$REQ_FILE" \
    "${HOST}/api/now/atf_builder/create")

# Check for error response
if echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if 'execution_tracker_sys_id' in d.get('result',{}) else 1)" 2>/dev/null; then
    TRACKER=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['execution_tracker_sys_id'])")
    echo "  ✓ Tracker: $TRACKER"
else
    echo "  ✗ Dispatch failed:"
    echo "$RESP" | python3 -m json.tool 2>&1 | sed 's/^/    /'
    exit 4
fi

# Poll until terminal
echo "▸ Polling for capture completion..."
POLLS=0
MAX_POLLS=60
POLL_INTERVAL=5
while [[ $POLLS -lt $MAX_POLLS ]]; do
    STATE=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
        "${HOST}/api/now/table/sys_execution_tracker/${TRACKER}?sysparm_fields=state" \
        | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['state'])")
    case "$STATE" in
        2) echo "  ✓ state=Complete";    break ;;
        3) echo "  ✗ state=Failure";    break ;;
        4) echo "  ⚠ state=Cancelled";   break ;;
        *) echo "  [$POLLS] state=$STATE — polling..."; sleep $POLL_INTERVAL ;;
    esac
    POLLS=$((POLLS + 1))
done

# Find the new snapshot — newest one with this test's result context
RESULT_ID=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/table/sys_atf_test_result?sysparm_query=test%3D${TEST_SYS_ID}%5EORDERBYDESCsys_created_on&sysparm_fields=sys_id&sysparm_limit=1" \
    | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['sys_id'] if r else '')")
echo "▸ Test result: $RESULT_ID"

# Latest snapshot
SNAP=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/table/sys_atf_snapshot?sysparm_query=ORDERBYDESCsys_created_on&sysparm_fields=sys_id,url&sysparm_limit=1" \
    | python3 -c "import json,sys; r=json.load(sys.stdin)['result'][0]; print(r['sys_id']+'|'+r['url'])")
SNAP_ID="${SNAP%%|*}"
SNAP_URL="${SNAP#*|}"
echo "▸ Snapshot: $SNAP_ID"
echo "  URL: $SNAP_URL"

# Component count for this snapshot
COUNT=$(curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/stats/sys_atf_ui_component?sysparm_count=true&sysparm_query=snapshot%3D${SNAP_ID}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['stats']['count'])")
echo "▸ Components captured for this snapshot: $COUNT"

# Show grouped sample
echo
echo "▸ Components by tag (top 20):"
curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/table/sys_atf_ui_component?sysparm_query=snapshot%3D${SNAP_ID}&sysparm_fields=tag,locator&sysparm_limit=300" \
    | python3 -c "
import json,sys
from collections import Counter
d = json.load(sys.stdin)
items = d.get('result', [])
tag_method_counter = Counter()
for r in items:
    try: loc = json.loads(r.get('locator','{}'))
    except: continue
    tag = r.get('tag','?')
    meths = ','.join(sorted(loc.get('methods',[])))
    tag_method_counter[f'{tag} [{meths}]'] += 1
for (k, v) in tag_method_counter.most_common(20):
    print(f'  {v:>4}  {k}')
"

echo
echo "════════════════════════════════════════════════════════════"
echo " ✓ Capture complete"
echo "════════════════════════════════════════════════════════════"
echo " Snapshot:    $SNAP_ID"
echo " Components:  $COUNT"
echo
echo " Next: ./find_components.sh $SNAP_ID '<search-term>'"
echo "       ./find_components.sh $SNAP_ID --tag input --has-method setValue"
