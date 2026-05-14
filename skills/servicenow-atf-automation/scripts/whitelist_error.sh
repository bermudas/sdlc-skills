#!/usr/bin/env bash
# whitelist_error.sh — add a per-test sys_atf_whitelist entry to downgrade a
# known platform-emitted client error from "step fail" to "warning" or "ignore".
#
# Use for benign init-time errors that the page recovers from but ATF still
# flags as a fatal step failure (e.g., "Uncaught TypeError: t is not
# iterable" on workspace list pages, data broker direct-load errors on some
# csm_consumer record pages, etc.).
#
# Usage:
#   ./whitelist_error.sh <test_sys_id> "<error_message_substring>" [warning|ignored]
#
# Default report_level: warning (step still passes, error becomes a warning
# attached to the result).
#
# Required env: SN_ATF_INSTANCE, SN_ATF_USER, SN_ATF_PASSWORD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

if [[ $# -lt 2 ]]; then
    cat >&2 <<EOF
Usage:
  $0 <test_sys_id> "<error_message>" [warning|ignored]

Examples:
  $0 <test_sys_id> "Uncaught TypeError: t is not iterable"
  $0 <test_sys_id> "Data broker execution for direct load failed" warning
  $0 <test_sys_id> "Provided selected tab index '1' is not a valid index"
EOF
    exit 2
fi

TEST_SYS_ID="$1"
ERROR_MSG="$2"
LEVEL="${3:-warning}"
HOST="${SN_ATF_INSTANCE%/}"

REQ=$(mktemp); trap 'rm -f "$REQ"' EXIT
python3 - "$TEST_SYS_ID" "$ERROR_MSG" "$LEVEL" > "$REQ" <<'PYEOF'
import json, sys
test, err, lvl = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({
    "test": test,
    "error_message": err,
    "report_level": lvl,
    "active": "true",
    "description": "Added programmatically by whitelist_error.sh"
}))
PYEOF

RESP=$(curl -sS -X POST -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    -H "Content-Type: application/json" --data-binary @"$REQ" \
    "${HOST}/api/now/table/sys_atf_whitelist")

ROW_SYS_ID=$(echo "$RESP" | python3 -c "import json,sys; r=json.load(sys.stdin).get('result',{}); print(r.get('sys_id',''))")
if [[ -n "$ROW_SYS_ID" ]]; then
    echo "  ✓ whitelisted: $ROW_SYS_ID  level=$LEVEL  msg='$ERROR_MSG'"
else
    echo "$RESP" | python3 -m json.tool 2>&1 | sed 's/^/  /' >&2
    exit 3
fi
