#!/usr/bin/env bash
# inspect_test.sh — Read an existing ATF test's steps with descriptions.
#
# Useful for:
#   - Reverse-engineering OOTB tests as templates for your own
#   - Verifying a Path B build produced the steps you expected
#   - Inspecting any test by sys_id or by name pattern
#
# Usage:
#   ./inspect_test.sh <test_sys_id>           # full info for one test
#   ./inspect_test.sh --name "<pattern>"      # list tests matching a name pattern
#
# Required env: SN_INSTANCE, SN_USER, SN_PASSWORD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

if [[ $# -lt 1 ]]; then
    cat >&2 <<EOF
Usage:
  $0 <test_sys_id>           # show test metadata + ordered steps
  $0 --name "<pattern>"      # search tests by name (LIKE)
EOF
    exit 2
fi

SN_INSTANCE="$SN_ATF_INSTANCE"
AUTH="$ATF_AUTH"

if [[ "$1" == "--name" ]]; then
    [[ $# -eq 2 ]] || { echo "Usage: $0 --name <pattern>" >&2; exit 2; }
    PATTERN=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$2")

    echo "▸ Searching tests with name like '$2'..." >&2
    RESP_FILE=$(mktemp -t atf_inspect_name.XXXXXX.json)
    trap 'rm -f "$RESP_FILE"' EXIT
    curl -fsS -u "$AUTH" -H "Accept: application/json" \
      "${SN_INSTANCE}/api/now/table/sys_atf_test?sysparm_query=nameLIKE${PATTERN}&sysparm_fields=name,sys_id,active,sys_created_by,sys_created_on&sysparm_display_value=true&sysparm_limit=30" \
      -o "$RESP_FILE"

    RESP_FILE="$RESP_FILE" python3 <<'PY'
import json, os
r = json.load(open(os.environ['RESP_FILE'])).get('result', [])
print(f"{len(r)} match(es)\n")
for t in r:
    active = '✓' if t.get('active') == 'true' else '·'
    print(f"  {active}  {t.get('sys_id','?')}  {t.get('name','?')[:60]:<60s}  by={t.get('sys_created_by','?')}  on={t.get('sys_created_on','?')}")
PY
    exit 0
fi

# ── single test by sys_id ─────────────────────────────────────────────────
TEST_SYSID="$1"

# 1. Test metadata
echo "▸ Fetching test metadata..." >&2
META_FILE=$(mktemp -t atf_inspect_meta.XXXXXX.json)
STEPS_FILE=$(mktemp -t atf_inspect_steps.XXXXXX.json)
trap 'rm -f "$META_FILE" "$STEPS_FILE"' EXIT

curl -fsS -u "$AUTH" -H "Accept: application/json" \
  "${SN_INSTANCE}/api/now/table/sys_atf_test/${TEST_SYSID}?sysparm_fields=name,sys_id,description,active,fail_on_server_error,sys_created_by,sys_created_on,sys_updated_on,sys_policy" \
  -o "$META_FILE" \
  || { echo "ERROR: test sys_id $TEST_SYSID not found" >&2; exit 1; }

META_FILE="$META_FILE" python3 <<'PY'
import json, os
d = json.load(open(os.environ['META_FILE'])).get('result', {})
print(f"Test:     {d.get('name','?')}")
print(f"sys_id:   {d.get('sys_id','?')}")
print(f"Active:   {d.get('active','?')}")
print(f"FoSE:     {d.get('fail_on_server_error','?')}     (fail on server error)")
print(f"Policy:   {d.get('sys_policy','(none)') or '(none)'}")
print(f"Created:  {d.get('sys_created_on','?')} by {d.get('sys_created_by','?')}")
print(f"Updated:  {d.get('sys_updated_on','?')}")
desc = d.get('description','')
if desc:
    print("\nDescription:")
    for line in desc.split('\n'):
        print(f"  {line}")
print()
PY

# 2. Steps
echo "Steps:"
curl -fsS -u "$AUTH" -H "Accept: application/json" \
  "${SN_INSTANCE}/api/now/table/sys_atf_step?sysparm_query=test=${TEST_SYSID}^ORDERBYorder&sysparm_fields=order,description,step_config.name,step_config.sys_id,active,sys_id&sysparm_display_value=true&sysparm_limit=100" \
  -o "$STEPS_FILE"

STEPS_FILE="$STEPS_FILE" python3 <<'PY'
import json, os
r = json.load(open(os.environ['STEPS_FILE'])).get('result', [])
print(f"  ({len(r)} step{'s' if len(r) != 1 else ''})\n")
for s in r:
    active = '✓' if s.get('active') == 'true' else '·'
    sc_name = s.get('step_config.name','?')
    sc_id = s.get('step_config.sys_id','?')
    order = s.get('order','?')
    sys_id = s.get('sys_id','?')
    desc = (s.get('description','') or '(no description — input values may be unset)').replace('\n', '\n      ')
    print(f"  #{order:>4}  {active}  {sc_name:<30s}  sys_id={sys_id}")
    print(f"          step_config={sc_id}")
    for ln in desc.split('\n'):
        print(f"      {ln}")
    print()
PY

# 3. Hint about how to use this output
cat <<EOF

Notes:
  - 'step_config' is the type-identifier sys_id. Map it to a step-type keyword
    by looking it up in scripts/builder_operation.js (STEP_CONFIGS map) or by
    running: ./discover_steps.sh <step_config_sys_id>
  - 'description' is auto-rendered from the step's inputs. If it's empty or has
    placeholder values, the input writes didn't take (likely you tried to write
    via Table API; use Path B instead).
EOF
