#!/usr/bin/env bash
# discover_steps.sh — list step types on the instance, or the input schema of one.
#
# Usage:
#   ./discover_steps.sh                       # list all step types, grouped by category
#   ./discover_steps.sh <step_config_sys_id>  # list input variables for that step type
#
# Required env: SN_INSTANCE, SN_USER, SN_PASSWORD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_env.sh
source "$SCRIPT_DIR/_env.sh"
require_creds

SN_INSTANCE="$SN_ATF_INSTANCE"
AUTH="$ATF_AUTH"

# Support --categories (just counts by category, no full step list)
if [[ "${1:-}" == "--categories" ]]; then
    echo "▸ Categories on $SN_INSTANCE:" >&2
    curl -fsS -u "$AUTH" -H "Accept: application/json" \
      "${SN_INSTANCE}/api/now/table/sys_atf_step_config?sysparm_fields=category&sysparm_display_value=true&sysparm_limit=500" \
      | python3 -c "
import json,sys
from collections import Counter
r = json.load(sys.stdin).get('result', [])
counts = Counter()
for t in r:
    cat = t.get('category')
    if isinstance(cat, dict): cat = cat.get('display_value','(uncategorised)')
    counts[cat or '(uncategorised)'] += 1
print(f'{sum(counts.values())} step types across {len(counts)} categories:')
for cat, n in counts.most_common():
    print(f'  {n:>3}  {cat}')"
    exit 0
fi

if [[ $# -eq 0 ]]; then
    # ── list all step types ────────────────────────────────────────────────
    echo "▸ Fetching step types from $SN_INSTANCE..." >&2
    LIST_FILE=$(mktemp -t atf_steps_list.XXXXXX.json)
    trap 'rm -f "$LIST_FILE"' EXIT
    curl -fsS -u "$AUTH" -H "Accept: application/json" \
      "${SN_INSTANCE}/api/now/table/sys_atf_step_config?sysparm_fields=name,sys_id,category&sysparm_display_value=true&sysparm_limit=200" \
      -o "$LIST_FILE"

    LIST_FILE="$LIST_FILE" python3 <<'PY'
import json, os
from collections import defaultdict

r = json.load(open(os.environ['LIST_FILE'])).get('result', [])
print(f"{len(r)} step types found\n")

by_cat = defaultdict(list)
for t in r:
    cat_field = t.get('category')
    if isinstance(cat_field, dict):
        cat = cat_field.get('display_value') or '(uncategorised)'
    else:
        cat = cat_field or '(uncategorised)'
    by_cat[cat].append((t.get('name', '?'), t.get('sys_id', '?')))

for cat in sorted(by_cat):
    print(f"  [{cat}] ({len(by_cat[cat])})")
    for name, sys_id in sorted(by_cat[cat]):
        print(f"    {name:<50s} {sys_id}")
    print()

print("To inspect a step type's inputs:  ./discover_steps.sh <sys_id>")
PY

else
    # ── input variables for a specific step type ──────────────────────────
    SC_ID="$1"
    echo "▸ Fetching input variables for step_config $SC_ID..." >&2

    # First fetch the step type itself for context — write to tmp file to
    # avoid shell-to-python JSON interpolation hazards with embedded quotes.
    META_FILE=$(mktemp -t atf_meta.XXXXXX.json)
    trap 'rm -f "$META_FILE"' EXIT
    curl -fsS -u "$AUTH" -H "Accept: application/json" \
      "${SN_INSTANCE}/api/now/table/sys_atf_step_config/${SC_ID}?sysparm_fields=name,category&sysparm_display_value=true" \
      -o "$META_FILE"
    python3 <<PY >&2
import json
r = json.load(open('$META_FILE')).get('result', {})
cat = r.get('category')
if isinstance(cat, dict): cat = cat.get('display_value','?')
print(f"  Step type: {r.get('name','?')}  [{cat or '?'}]")
print()
PY

    # Fetch inputs and write to temp file (heredoc would otherwise capture
    # stdin and the curl output would be discarded).
    INPUTS_FILE=$(mktemp -t atf_inputs.XXXXXX.json)
    trap 'rm -f "$META_FILE" "$INPUTS_FILE"' EXIT
    curl -fsS -u "$AUTH" -H "Accept: application/json" \
      "${SN_INSTANCE}/api/now/table/atf_input_variable?sysparm_query=model_id=${SC_ID}^ORDERBYorder&sysparm_fields=element,column_label,internal_type,reference,mandatory,default_value,hint&sysparm_display_value=true" \
      -o "$INPUTS_FILE"

    INPUTS_FILE="$INPUTS_FILE" python3 <<'PY'
import json, os

r = json.load(open(os.environ['INPUTS_FILE'])).get('result', [])
print(f"{len(r)} input variable(s):\n")

if not r:
    print("  (none — this step type takes no inputs)")
else:
    for v in r:
        itype = v.get('internal_type')
        if isinstance(itype, dict):
            itype = itype.get('value', '?')
        ref = v.get('reference')
        if isinstance(ref, dict):
            ref = ref.get('value', '')
        mandatory = '*' if v.get('mandatory') == 'true' else ' '
        default = v.get('default_value', '') or ''
        hint = v.get('hint', '') or ''
        type_str = itype + (f" -> {ref}" if ref else '')

        print(f"  {mandatory} {v.get('element','?'):<25s} [{type_str}]")
        if v.get('column_label') and v['column_label'] != v.get('element'):
            print(f"      label:   {v['column_label']}")
        if default:
            print(f"      default: {default}")
        if hint:
            print(f"      hint:    {hint}")
        print()

    print("Element names (the keys to use in your spec):")
    elements = [v.get('element','?') for v in r]
    print(f"  {', '.join(elements)}")
PY
fi
