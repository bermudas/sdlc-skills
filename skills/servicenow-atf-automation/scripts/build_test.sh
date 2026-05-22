#!/usr/bin/env bash
# build_test.sh — POST a JSON spec to the Path B builder and print the result.
#
# Usage:    build_test.sh <path/to/spec.json>
# Output:   prints test_sys_id (stdout) + per-step descriptions (stderr)
# Required env: SN_INSTANCE, SN_USER, SN_PASSWORD
#
# Exit codes: 0 on full success, 2 on partial (some step errors), >0 on failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <path/to/spec.json>" >&2
    exit 2
fi
SPEC="$1"
[[ -f "$SPEC" ]] || { echo "ERROR: spec file not found: $SPEC" >&2; exit 2; }

SN_INSTANCE="$SN_ATF_INSTANCE"
AUTH="$ATF_AUTH"
BUILDER_URL="${SN_INSTANCE}/api/now/atf_builder/create"

echo "▸ Posting spec to: $BUILDER_URL" >&2
echo "▸ Spec: $SPEC" >&2

RESP_FILE=$(mktemp -t atf_build_resp.XXXXXX.json)
HTTP_CODE=$(curl -sS -X POST -u "$AUTH" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  --data-binary "@${SPEC}" \
  -o "$RESP_FILE" -w "%{http_code}" \
  "$BUILDER_URL")

echo "▸ HTTP $HTTP_CODE" >&2

if [[ "$HTTP_CODE" != "201" && "$HTTP_CODE" != "207" && "$HTTP_CODE" != "200" ]]; then
    echo "✗ Build failed" >&2
    python3 -m json.tool "$RESP_FILE" >&2 || cat "$RESP_FILE" >&2
    rm -f "$RESP_FILE"
    exit 1
fi
# Note: HTTP 200 is the success code for action:"update" (existing test
# re-spec); 201 is for fresh creates; 207 is partial success (some step errors).

TEST_SYSID=$(python3 -c "
import json
d = json.load(open('$RESP_FILE'))
print(d.get('result',{}).get('test_sys_id',''))")

if [[ -z "$TEST_SYSID" ]]; then
    echo "✗ No test_sys_id in response" >&2
    python3 -m json.tool "$RESP_FILE" >&2
    rm -f "$RESP_FILE"
    exit 1
fi

# Print summary to stderr (so callers can capture just the sys_id from stdout)
python3 <<PY >&2
import json
d = json.load(open('$RESP_FILE'))['result']
print(f"  ✓ Test created: {d['test_name']}")
print(f"  ✓ sys_id:       {d['test_sys_id']}")
print(f"  ✓ Steps:        {len(d['steps_created'])}")
for s in d['steps_created']:
    desc = (s.get('description','') or '(no description)').replace('\\n', ' / ')[:120]
    print(f"    #{s['order']:>3}  {s['step_config_name']:25s}  {desc}")
errs = d.get('errors', [])
if errs:
    print(f"  ⚠ {len(errs)} step error(s):")
    for e in errs: print(f"    • {e}")
PY

rm -f "$RESP_FILE"

# Test sys_id on stdout for pipeline use
echo "$TEST_SYSID"

# Exit 2 if there were partial errors (HTTP 207)
[[ "$HTTP_CODE" == "207" ]] && exit 2 || exit 0
