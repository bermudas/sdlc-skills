#!/usr/bin/env bash
# explore_tests.sh — browse existing ATF tests on the instance.
#
# Use cases:
#   - "What ATF tests exist? Any I can use as templates?"
#   - "Find OOTB tests touching a specific table/keyword"
#   - "Reverse-engineer an OOTB test into a Path B spec I can edit and redeploy"
#
# Usage:
#   ./explore_tests.sh                              # overall stats (counts active/inactive, top creators)
#   ./explore_tests.sh --list [--limit N] [--active]
#                                                   # list tests with description previews
#   ./explore_tests.sh --search "<pattern>"         # search name + description (LIKE)
#   ./explore_tests.sh --by-table <table_name>      # find tests that touch a specific table
#                                                   #   (matches steps' descriptions)
#   ./explore_tests.sh --dump <test_sys_id>         # emit a Path B JSON skeleton for that test
#                                                   #   (descriptions become input-value hints)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

SN_INSTANCE="$SN_ATF_INSTANCE"
AUTH="$ATF_AUTH"

usage() {
    cat >&2 <<EOF
Usage:
  $0                                  # overall stats
  $0 --list [--limit N] [--active]    # list tests
  $0 --search "<pattern>"             # search by name/description
  $0 --by-table <table_name>          # tests that touch a specific table
  $0 --dump <test_sys_id>             # emit Path B JSON skeleton (for reverse-engineering)
EOF
    exit 2
}

case "${1:-}" in
    "")
        # ── overall stats ────────────────────────────────────────────────
        echo "▸ Fetching test counts from $SN_INSTANCE..." >&2
        TOTAL=$(curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/stats/sys_atf_test?sysparm_count=true" \
          | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['stats']['count'])")
        ACTIVE=$(curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/stats/sys_atf_test?sysparm_query=active=true&sysparm_count=true" \
          | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['stats']['count'])")
        SUITES=$(curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/stats/sys_atf_test_suite?sysparm_count=true" \
          | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['stats']['count'])")

        cat <<EOF
Instance: $SN_INSTANCE
────────────────────────────────────────────────────────────
  $TOTAL  total ATF tests
  $ACTIVE  active (will run when their suite triggers)
  $SUITES  total test suites
────────────────────────────────────────────────────────────

Top creators (active tests only):
EOF
        curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/table/sys_atf_test?sysparm_query=active=true&sysparm_fields=sys_created_by&sysparm_limit=1000" \
          | python3 -c "
import json, sys
from collections import Counter
r = json.load(sys.stdin).get('result', [])
counts = Counter(t.get('sys_created_by','?') for t in r)
for who, n in counts.most_common(10):
    print(f'  {n:>4}  {who}')"

        echo ""
        echo "Next:"
        echo "  $0 --list                # list tests"
        echo "  $0 --search MyKeyword    # search"
        echo "  $0 --dump <sys_id>       # emit Path B skeleton from an existing test"
        ;;

    --list)
        # ── list tests ────────────────────────────────────────────────────
        shift
        LIMIT=30
        QUERY=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --limit)  LIMIT="$2"; shift 2 ;;
                --active) QUERY="active=true^${QUERY}"; shift ;;
                *) echo "Unknown flag: $1" >&2; usage ;;
            esac
        done
        [[ -n "$QUERY" ]] && QUERY="${QUERY}ORDERBYname" || QUERY="ORDERBYname"
        echo "▸ Listing up to $LIMIT tests..." >&2
        curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/table/sys_atf_test?sysparm_query=${QUERY}&sysparm_fields=name,sys_id,active,description,sys_created_by&sysparm_display_value=true&sysparm_limit=${LIMIT}" \
          | python3 -c "
import json, sys
r = json.load(sys.stdin).get('result', [])
print(f'{len(r)} test(s):\n')
for t in r:
    active = '✓' if t.get('active') == 'true' else '·'
    desc = (t.get('description','') or '(no description)').replace('\n',' ')[:80]
    print(f\"  {active}  {t.get('sys_id','?')}\")
    print(f\"     {t.get('name','?')}\")
    print(f\"     {desc}  [by {t.get('sys_created_by','?')}]\")
    print()"
        ;;

    --search)
        # ── search by name/description ────────────────────────────────────
        [[ $# -eq 2 ]] || { echo "Usage: $0 --search <pattern>" >&2; exit 2; }
        PATTERN=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$2")
        echo "▸ Searching tests with name OR description LIKE '$2'..." >&2
        curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/table/sys_atf_test?sysparm_query=nameLIKE${PATTERN}^ORdescriptionLIKE${PATTERN}&sysparm_fields=name,sys_id,active,description&sysparm_display_value=true&sysparm_limit=50" \
          | python3 -c "
import json, sys
r = json.load(sys.stdin).get('result', [])
print(f'{len(r)} match(es)\n')
for t in r:
    active = '✓' if t.get('active') == 'true' else '·'
    print(f\"  {active}  {t.get('sys_id','?')}  {t.get('name','?')[:70]}\")
    if t.get('description'):
        print(f\"          {t['description'][:100]}\")"
        ;;

    --by-table)
        # ── tests touching a specific table (matches step descriptions) ──
        [[ $# -eq 2 ]] || { echo "Usage: $0 --by-table <table_name>" >&2; exit 2; }
        TABLE="$2"
        echo "▸ Finding tests whose steps reference table '$TABLE'..." >&2
        # We match step descriptions because step inputs aren't readable via REST
        # (see references/architecture.md). Description format is e.g.
        #   "Validate there is at least one record in 'incident' matching query: ..."
        curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/table/sys_atf_step?sysparm_query=descriptionLIKE%27${TABLE}%27&sysparm_fields=test.sys_id,test.name,test.active,description&sysparm_display_value=true&sysparm_limit=200" \
          | python3 -c "
import json, sys
r = json.load(sys.stdin).get('result', [])
seen = {}
for s in r:
    tid = s.get('test.sys_id','?')
    if tid in seen: continue
    seen[tid] = (s.get('test.name','?'), s.get('test.active'), s.get('description','')[:90])
print(f'{len(seen)} unique test(s) touch table \"$TABLE\"\n')
for tid, (name, active, desc) in seen.items():
    a = '✓' if active == 'true' else '·'
    print(f'  {a}  {tid}  {name[:60]}')
    print(f'         e.g. step: {desc}')
    print()"
        ;;

    --dump)
        # ── reverse-engineer to Path B JSON skeleton ─────────────────────
        [[ $# -eq 2 ]] || { echo "Usage: $0 --dump <test_sys_id>" >&2; exit 2; }
        TID="$2"
        BUILDER="$SCRIPT_DIR/builder_operation.js"

        # Write API responses to temp files (avoids shell-to-Python quoting
        # hazards when descriptions contain newlines, em-dashes, etc.).
        META_FILE=$(mktemp -t atf_dump_meta.XXXXXX.json)
        STEPS_FILE=$(mktemp -t atf_dump_steps.XXXXXX.json)
        trap 'rm -f "$META_FILE" "$STEPS_FILE"' EXIT

        curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/table/sys_atf_test/${TID}?sysparm_fields=name,description,active,fail_on_server_error" \
          -o "$META_FILE"

        curl -fsS -u "$AUTH" -H "Accept: application/json" \
          "${SN_INSTANCE}/api/now/table/sys_atf_step?sysparm_query=test=${TID}^ORDERBYorder&sysparm_fields=order,description,step_config.sys_id,step_config.name&sysparm_display_value=true&sysparm_limit=100" \
          -o "$STEPS_FILE"

        TID="$TID" BUILDER="$BUILDER" META_FILE="$META_FILE" STEPS_FILE="$STEPS_FILE" python3 <<'PY'
import json, os, re

tid         = os.environ['TID']
meta        = json.load(open(os.environ['META_FILE'])).get('result', {})
steps_data  = json.load(open(os.environ['STEPS_FILE'])).get('result', [])

# Reverse-map step_config sys_ids → type keywords from builder_operation.js
sc_to_type = {}
try:
    with open(os.environ['BUILDER']) as f:
        for m in re.finditer(r"'([a-z_]+)':\s*'([0-9a-f]{32})'", f.read()):
            sc_to_type[m.group(2)] = m.group(1)
except FileNotFoundError:
    pass

print(f'// Reverse-engineered from test sys_id {tid}')
print('// Original name: ' + json.dumps(meta.get('name', '?')))
print('//')
print('// IMPORTANT: This is a SKELETON. The dynamic input values cannot be read')
print('// from the public REST API (see references/architecture.md). The step')
print('// descriptions below contain the rendered values — copy them into the')
print('// spec body as appropriate (e.g. "Impersonate the user: John Smith" → ')
print('//   "user": "<sys_id of John Smith>").')
print('//')

spec = {
    'name': meta.get('name', '?') + ' (Path B copy)',
    'description': meta.get('description') or f'Reverse-engineered from sys_atf_test/{tid}',
    'active': meta.get('active') == 'true',
    'failOnServerError': meta.get('fail_on_server_error') == 'true',
    'steps': []
}

for s in steps_data:
    sc_id = s.get('step_config.sys_id', '')
    sc_name = s.get('step_config.name', '?')
    type_key = sc_to_type.get(sc_id, '__UNMAPPED__')
    step = {
        '__description_from_source': (s.get('description') or '').strip(),
        '__step_config_name': sc_name,
        'type': type_key,
    }
    if type_key == '__UNMAPPED__':
        step['__step_config_sys_id'] = sc_id
        step['__hint'] = (
            'Add this step_config to STEP_CONFIGS in builder_operation.js, '
            f'or run: discover_steps.sh {sc_id} to inspect its inputs'
        )
    spec['steps'].append(step)

print(json.dumps(spec, indent=2))
print()
print('// Next steps:')
print('// 1. Edit the JSON: remove __* helper keys, add real input values')
print('//    based on the descriptions.')
print('// 2. Save as <something>.json and run: ./build_test.sh <something>.json')
print('// 3. Wrap and run: ./run_suite.sh <new test sys_id>')
PY
        ;;

    *)
        usage
        ;;
esac
