#!/usr/bin/env bash
# bootstrap_builder.sh — One-time setup of the Path B Scripted REST API on a target instance.
#
# Creates two records:
#   1. sys_ws_definition  → the API itself ("ATF Builder", base_uri /api/now/atf_builder)
#   2. sys_ws_operation    → the POST /create endpoint, with builder_operation.js as the script
#
# Idempotent: if the API already exists, the script reuses it. Same for the operation.
#
# Required env: SN_INSTANCE, SN_USER, SN_PASSWORD
# Requires: curl, python3 (both on macOS by default)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

OP_SCRIPT="$SCRIPT_DIR/builder_operation.js"
[[ -f "$OP_SCRIPT" ]] || { echo "ERROR: builder_operation.js missing next to this script" >&2; exit 2; }

# Convenience aliases for the rest of the script
SN_INSTANCE="$SN_ATF_INSTANCE"
AUTH="$ATF_AUTH"

# Service identifiers — change these if you want a different name/path
SERVICE_ID="atf_builder"
SERVICE_NAME="ATF Builder"
BASE_URI="/api/now/${SERVICE_ID}"
OPERATION_NAME="create_test"
OPERATION_PATH="/create"

echo "▸ Target instance: $SN_INSTANCE"
echo "▸ Will install API at: $BASE_URI"
echo "▸ Will install operation: POST ${BASE_URI}${OPERATION_PATH}"
echo

# --- 1. Find or create sys_ws_definition ---------------------------------
echo "▸ Looking for existing API definition..."
WSD_SEARCH=$(curl -fsS -u "$AUTH" -H "Accept: application/json" \
  "${SN_INSTANCE}/api/now/table/sys_ws_definition?sysparm_query=service_id=${SERVICE_ID}&sysparm_fields=sys_id&sysparm_limit=1")
WSD_SYSID=$(echo "$WSD_SEARCH" | python3 -c "
import json,sys
r=json.load(sys.stdin).get('result',[])
print(r[0]['sys_id'] if r else '')")

if [[ -n "$WSD_SYSID" ]]; then
    echo "  ✓ API definition already exists (sys_id: $WSD_SYSID)"
else
    echo "  • Creating new API definition..."
    WSD_PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'name': '${SERVICE_NAME}',
    'service_id': '${SERVICE_ID}',
    'namespace': 'now',
    'base_uri': '${BASE_URI}',
    'active': 'true',
    'short_description': 'AI-driven ATF test construction via JSON spec'
}))")
    WSD_RESP=$(curl -fsS -X POST -u "$AUTH" \
      -H "Accept: application/json" -H "Content-Type: application/json" \
      -d "$WSD_PAYLOAD" \
      "${SN_INSTANCE}/api/now/table/sys_ws_definition")
    WSD_SYSID=$(echo "$WSD_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['sys_id'])")
    echo "  ✓ Created API definition (sys_id: $WSD_SYSID)"
fi

# --- 2. Find or create sys_ws_operation ----------------------------------
echo "▸ Looking for existing /create operation..."
OP_SEARCH=$(curl -fsS -u "$AUTH" -H "Accept: application/json" \
  "${SN_INSTANCE}/api/now/table/sys_ws_operation?sysparm_query=web_service_definition=${WSD_SYSID}^relative_path=${OPERATION_PATH}&sysparm_fields=sys_id&sysparm_limit=1")
OP_SYSID=$(echo "$OP_SEARCH" | python3 -c "
import json,sys
r=json.load(sys.stdin).get('result',[])
print(r[0]['sys_id'] if r else '')")

# Build the payload (Python handles JSON-escaping of the script content)
OP_PAYLOAD_FILE=$(mktemp -t atf_op_payload.XXXXXX.json)
python3 <<PY > /dev/null
import json
with open('$OP_SCRIPT') as f:
    script = f.read()
payload = {
    'name': '${OPERATION_NAME}',
    'http_method': 'POST',
    'relative_path': '${OPERATION_PATH}',
    'web_service_definition': '${WSD_SYSID}',
    'active': 'true',
    'requires_acl_authorization': 'false',
    'produces': 'application/json',
    'consumes': 'application/json',
    'operation_script': script
}
with open('$OP_PAYLOAD_FILE', 'w') as f:
    json.dump(payload, f)
PY

if [[ -n "$OP_SYSID" ]]; then
    echo "  ✓ Operation already exists (sys_id: $OP_SYSID) — updating script content"
    curl -fsS -X PATCH -u "$AUTH" \
      -H "Accept: application/json" -H "Content-Type: application/json" \
      --data-binary "@${OP_PAYLOAD_FILE}" \
      "${SN_INSTANCE}/api/now/table/sys_ws_operation/${OP_SYSID}" > /dev/null
    echo "  ✓ Operation script updated"
else
    echo "  • Creating new operation..."
    OP_RESP=$(curl -fsS -X POST -u "$AUTH" \
      -H "Accept: application/json" -H "Content-Type: application/json" \
      --data-binary "@${OP_PAYLOAD_FILE}" \
      "${SN_INSTANCE}/api/now/table/sys_ws_operation")
    OP_SYSID=$(echo "$OP_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['sys_id'])")
    echo "  ✓ Created operation (sys_id: $OP_SYSID)"
fi

rm -f "$OP_PAYLOAD_FILE"

# --- 3. Sanity probe the endpoint ----------------------------------------
echo
echo "▸ Sanity probe..."
PROBE_PAYLOAD='{"name":"_bootstrap_sanity_probe_DELETE_ME","active":false,"steps":[{"type":"log","log":"bootstrap sanity check"}]}'
PROBE_RESP=$(curl -fsS -X POST -u "$AUTH" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -d "$PROBE_PAYLOAD" \
  "${SN_INSTANCE}${BASE_URI}${OPERATION_PATH}")
PROBE_TEST_SYSID=$(echo "$PROBE_RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('result',{})
print(d.get('test_sys_id',''))")

if [[ -n "$PROBE_TEST_SYSID" ]]; then
    echo "  ✓ Probe test created (sys_id: $PROBE_TEST_SYSID) — deleting it"
    curl -fsS -X DELETE -u "$AUTH" \
      "${SN_INSTANCE}/api/now/table/sys_atf_test/${PROBE_TEST_SYSID}" > /dev/null
    echo "  ✓ Probe test cleaned up"
else
    echo "  ✗ Probe failed — endpoint did not return a test_sys_id. Response was:"
    echo "$PROBE_RESP" | python3 -m json.tool >&2
    exit 1
fi

echo
echo "════════════════════════════════════════════════════════════"
echo " ✓ Bootstrap complete"
echo "════════════════════════════════════════════════════════════"
echo " API:        ${SN_INSTANCE}${BASE_URI}${OPERATION_PATH}"
echo " sys_id:     $WSD_SYSID  (sys_ws_definition)"
echo " operation:  $OP_SYSID  (sys_ws_operation)"
echo
echo " Next: build_test.sh <spec.json>"
