#!/usr/bin/env bash
# find_components.sh — query captured ATF UI components by criteria. Returns
# full mugshot JSON ready to drop into a step spec's `component` input.
#
# Usage:
#   ./find_components.sh <snapshot_sys_id> <search_term>
#       Searches locator JSON for the term; returns matching components.
#
#   ./find_components.sh <snapshot_sys_id> --tag <tag> [--has-method <method>] [--aria <substring>]
#       Filter by tag/role/method/aria.
#
#   ./find_components.sh <snapshot_sys_id> --hash <hash>
#       Fetch a specific component by hash.
#
#   ./find_components.sh --latest-snapshot
#       Print the most recently created snapshot sys_id (handy for chaining).
#
# Output: pretty-printed list with hash, tag, role, methods, short description,
# and the full locator JSON on a final line ready to paste as a `component`
# input value in a step spec.
#
# Required env: SN_ATF_INSTANCE, SN_ATF_USER, SN_ATF_PASSWORD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

HOST="${SN_ATF_INSTANCE%/}"

usage() {
    cat >&2 <<'EOF'
Usage:
  find_components.sh <snapshot_sys_id> <search_term>
  find_components.sh <snapshot_sys_id> --tag <tag> [--has-method <method>] [--aria <substring>]
  find_components.sh <snapshot_sys_id> --hash <hash>
  find_components.sh --latest-snapshot

Examples:
  find_components.sh --latest-snapshot
  find_components.sh 9a1a5caa2bb84350946ff865ce91bf6b "Address Classification"
  find_components.sh 9a1a5caa2bb84350946ff865ce91bf6b --tag input --has-method setValue
  find_components.sh 9a1a5caa2bb84350946ff865ce91bf6b --tag button --aria Save
EOF
    exit 2
}

[[ $# -lt 1 ]] && usage

if [[ "$1" == "--latest-snapshot" ]]; then
    curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
        "${HOST}/api/now/table/sys_atf_snapshot?sysparm_query=ORDERBYDESCsys_created_on&sysparm_fields=sys_id,url,sys_created_on&sysparm_limit=1" \
        | python3 -c "
import json,sys
r = json.load(sys.stdin)['result']
if r:
    print('Snapshot sys_id:', r[0]['sys_id'])
    print('Created:        ', r[0]['sys_created_on'])
    print('URL:            ', r[0]['url'])
else:
    print('No snapshots yet — run capture_components.sh first', file=sys.stderr)
    sys.exit(1)
"
    exit
fi

SNAP="$1"
shift

[[ $# -lt 1 ]] && usage

# Build the encoded query
QUERY="snapshot=${SNAP}"
LABEL=""
case "$1" in
    --hash)
        QUERY="${QUERY}^hash=$2"
        LABEL="hash=$2"
        ;;
    --tag)
        QUERY="${QUERY}^tag=$2"
        LABEL="tag=$2"
        shift 2
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --has-method)
                    QUERY="${QUERY}^locatorLIKE\"$2\""
                    LABEL="${LABEL}, method=$2"
                    shift 2
                    ;;
                --aria)
                    QUERY="${QUERY}^locatorLIKE${2}"
                    LABEL="${LABEL}, aria~=$2"
                    shift 2
                    ;;
                *) usage ;;
            esac
        done
        ;;
    *)
        # Free-text search of the locator JSON
        QUERY="${QUERY}^locatorLIKE${1}"
        LABEL="locator~$1"
        ;;
esac

# URL-encode the query (basic — assumes no exotic chars in tag/aria values)
ENCODED_QUERY=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$QUERY', safe=''))")

echo "▸ Snapshot:  $SNAP"
echo "▸ Filter:    $LABEL"
echo

curl -sS -u "$SN_ATF_USER:$SN_ATF_PASSWORD" \
    "${HOST}/api/now/table/sys_atf_ui_component?sysparm_query=${ENCODED_QUERY}&sysparm_fields=hash,tag,locator&sysparm_limit=30" \
    | python3 -c "
import json,sys
d = json.load(sys.stdin)
items = d.get('result', [])
print(f'  Found {len(items)} component(s)')
print()
for i, r in enumerate(items[:30], 1):
    try: loc = json.loads(r.get('locator','{}'))
    except: loc = {}
    role = loc.get('role','')
    meths = loc.get('methods',[])
    short = loc.get('sn_atf_mugshot_short_description','')
    aria = loc.get('aria-label','')
    print(f'─── #{i} ───────────────────────────────')
    print(f'  hash:    {r.get(\"hash\")}')
    print(f'  tag:     {r.get(\"tag\")}')
    print(f'  role:    {role}')
    print(f'  aria:    {aria}')
    print(f'  short:   {short}')
    print(f'  methods: {meths}')
    print(f'  locator JSON (paste as step.component value):')
    print(f'    {r.get(\"locator\")}')
    print()
"
