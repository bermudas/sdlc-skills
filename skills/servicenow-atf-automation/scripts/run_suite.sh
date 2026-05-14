#!/usr/bin/env bash
# run_suite.sh — Wrap a test in a suite, trigger via /api/sn_cicd/testsuite/run,
# poll progress, and print per-step results.
#
# Usage:   run_suite.sh <test_sys_id> [suite_name]
# Exit:    0 if Successful, 1 if Failed/Canceled, 2 on protocol/setup error.
#
# Required env: SN_INSTANCE, SN_USER, SN_PASSWORD
# Requires: an ATF Test Runner agent online on the instance (see references/roles-and-access.md).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <test_sys_id> [suite_name]" >&2
    exit 2
fi
TEST_SYSID="$1"
SUITE_NAME="${2:-ATF run wrapper $(date +%Y%m%d-%H%M%S)}"

SN_INSTANCE="$SN_ATF_INSTANCE"
AUTH="$ATF_AUTH"
POLL_INTERVAL="${POLL_INTERVAL:-5}"   # seconds between progress polls
MAX_POLLS="${MAX_POLLS:-60}"          # 60 × 5s = 5 minutes default ceiling

# --- 1. Verify the test exists ------------------------------------------
echo "▸ Verifying test $TEST_SYSID exists..." >&2
TEST_NAME=$(curl -fsS -u "$AUTH" -H "Accept: application/json" \
  "${SN_INSTANCE}/api/now/table/sys_atf_test/${TEST_SYSID}?sysparm_fields=name" \
  | python3 -c "
import json,sys
try:
  print(json.load(sys.stdin)['result']['name'])
except: print('')")
[[ -n "$TEST_NAME" ]] || { echo "ERROR: test sys_id $TEST_SYSID not found" >&2; exit 2; }
echo "  ✓ Test: $TEST_NAME" >&2

# --- 2. Create a fresh suite for this run -------------------------------
# Build JSON via tempfile (avoids brittle shell-to-Python quoting when
# SUITE_NAME contains spaces, em-dashes, brackets, etc.).
echo "▸ Creating run-wrapper suite: $SUITE_NAME" >&2
SUITE_PAYLOAD=$(mktemp -t atf_suite_payload.XXXXXX.json)
LINK_PAYLOAD=$(mktemp -t atf_link_payload.XXXXXX.json)
trap 'rm -f "$SUITE_PAYLOAD" "$LINK_PAYLOAD"' EXIT

SUITE_NAME="$SUITE_NAME" SUITE_PAYLOAD_FILE="$SUITE_PAYLOAD" python3 <<'PY'
import json, os
json.dump({'name': os.environ['SUITE_NAME'], 'active': 'true'},
          open(os.environ['SUITE_PAYLOAD_FILE'], 'w'))
PY

SUITE_RESP=$(curl -fsS -X POST -u "$AUTH" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  --data-binary "@$SUITE_PAYLOAD" \
  "${SN_INSTANCE}/api/now/table/sys_atf_test_suite")
SUITE_SYSID=$(echo "$SUITE_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['sys_id'])")
echo "  ✓ Suite sys_id: $SUITE_SYSID" >&2

# --- 3. Link the test into the suite ------------------------------------
SUITE_SYSID="$SUITE_SYSID" TEST_SYSID="$TEST_SYSID" LINK_PAYLOAD_FILE="$LINK_PAYLOAD" python3 <<'PY'
import json, os
json.dump({'test_suite': os.environ['SUITE_SYSID'],
           'test':       os.environ['TEST_SYSID'],
           'order':      '100'},
          open(os.environ['LINK_PAYLOAD_FILE'], 'w'))
PY

curl -fsS -o /dev/null -X POST -u "$AUTH" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  --data-binary "@$LINK_PAYLOAD" \
  "${SN_INSTANCE}/api/now/table/sys_atf_test_suite_test"
echo "  ✓ Test linked into suite" >&2

# --- 4. Trigger the run via CI/CD endpoint ------------------------------
echo "▸ Triggering run..." >&2
RUN_RESP=$(curl -fsS -X POST -u "$AUTH" -H "Accept: application/json" \
  "${SN_INSTANCE}/api/sn_cicd/testsuite/run?test_suite_sys_id=${SUITE_SYSID}")
PROGRESS_URL=$(echo "$RUN_RESP" | python3 -c "
import json,sys
print(json.load(sys.stdin)['result']['links']['progress']['url'])")
echo "  ✓ Progress URL: $PROGRESS_URL" >&2

# --- 5. Poll progress ---------------------------------------------------
echo "▸ Polling (every ${POLL_INTERVAL}s, max ${MAX_POLLS} polls)..." >&2
FINAL_STATUS=""
for ((i=1; i<=MAX_POLLS; i++)); do
    sleep "$POLL_INTERVAL"
    R=$(curl -fsS -u "$AUTH" -H "Accept: application/json" "$PROGRESS_URL")
    STATUS_LINE=$(echo "$R" | python3 -c "
import json,sys
r=json.load(sys.stdin)['result']
print(f\"{r.get('status_label','?')} {r.get('percent_complete','?')}% — {r.get('status_message','')[:80]}\")")
    echo "  [poll $i] $STATUS_LINE" >&2
    if echo "$R" | grep -qE '"status_label":"(Successful|Failed|Cancel(?:l)?ed)"'; then
        FINAL_STATUS=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['status_label'])")
        break
    fi
done

[[ -n "$FINAL_STATUS" ]] || { echo "  ✗ Run did not terminate within $((MAX_POLLS * POLL_INTERVAL))s" >&2; exit 2; }

# --- 6. Fetch per-step results -----------------------------------------
echo >&2
echo "▸ Per-step results:" >&2
RESULT_ID=$(curl -fsS -u "$AUTH" -H "Accept: application/json" \
  "${SN_INSTANCE}/api/now/table/sys_atf_test_result?sysparm_query=test=${TEST_SYSID}^ORDERBYDESCsys_created_on&sysparm_fields=sys_id&sysparm_limit=1" \
  | python3 -c "
import json,sys
r=json.load(sys.stdin).get('result',[])
print(r[0]['sys_id'] if r else '')")

if [[ -n "$RESULT_ID" ]]; then
    RESULTS_FILE=$(mktemp -t atf_run_results.XXXXXX.json)
    trap 'rm -f "$RESULTS_FILE"' EXIT
    curl -fsS -u "$AUTH" -H "Accept: application/json" \
      "${SN_INSTANCE}/api/now/table/sys_atf_test_result_step?sysparm_query=test_result=${RESULT_ID}&sysparm_fields=step.order,step.step_config.name,status,output&sysparm_display_value=true" \
      -o "$RESULTS_FILE"

    RESULTS_FILE="$RESULTS_FILE" python3 <<'PY' >&2
import json, os
r = json.load(open(os.environ['RESULTS_FILE'])).get('result', [])
r.sort(key=lambda x: int(x.get('step.order') or 999))
for s in r:
    icon = {'Success':'✅','Failure':'❌','Skipped':'⏭️','Pending':'⏳'}.get(s.get('status','?'),'?')
    out = (s.get('output','') or '').replace('\n', ' / ')[:140]
    print(f"  {icon} #{s.get('step.order','?'):>3} {s.get('step.step_config.name','?'):25s} | {out}")
PY
fi

echo >&2
echo "════════════════════════════════════════════════════════════" >&2
echo " SUITE: $FINAL_STATUS" >&2
echo "════════════════════════════════════════════════════════════" >&2

# Print the suite's sys_id on stdout so callers can pipe-chain
echo "$SUITE_SYSID"

case "$FINAL_STATUS" in
    Successful) exit 0 ;;
    *)          exit 1 ;;
esac
