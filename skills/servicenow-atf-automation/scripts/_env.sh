#!/usr/bin/env bash
# _env.sh — shared credential loader. Sourced by every script in this skill.
#
# Lookup order for each variable (first non-empty wins):
#
#   SN_ATF_INSTANCE / SN_ATF_USER / SN_ATF_PASSWORD
#     1. Pre-existing shell env (e.g. exported by the caller or CI)
#     2. Read from .env file (gitignored — credentials never reach the shell history)
#        Walks up from $PWD looking for .env; max 5 parents.
#        Override the search by setting ATF_ENV_FILE=/path/to/.env.
#
# After resolution, scripts call `require_creds` to assert all three are set
# and to fail with a helpful message if any are missing.
#
# Why scoped names (SN_ATF_*)? Several ServiceNow tools own the SN_ prefix
# (the @servicenow/sdk uses SN_INSTANCE_URL, snc uses ~/.snc/config). Scoping
# to SN_ATF_* keeps this skill's creds independent of other tooling so they
# don't collide on the same machine.

# Find and source .env (no-op if already loaded or no file found)
_atf_load_env() {
    # If caller explicitly set ATF_ENV_FILE, use it.
    if [[ -n "${ATF_ENV_FILE:-}" && -f "${ATF_ENV_FILE}" ]]; then
        _atf_source_env "$ATF_ENV_FILE"
        return
    fi

    # Walk up from $PWD looking for .env (max 5 levels)
    local dir="${PWD}"
    for _ in 1 2 3 4 5; do
        if [[ -f "$dir/.env" ]]; then
            _atf_source_env "$dir/.env"
            return
        fi
        # Stop if we hit the filesystem root
        [[ "$dir" == "/" ]] && break
        dir="$(dirname "$dir")"
    done
}

# Safely source a .env-style file (key=value, # comments, no shell expansion).
# Only loads variables actually used by this skill so we don't pollute the
# shell with everything in .env.
_atf_source_env() {
    local envfile="$1"
    local key val line
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip comments and blank lines
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        # Match KEY=VALUE
        if [[ "$line" =~ ^[[:space:]]*([A-Z_][A-Z0-9_]*)=(.*)$ ]]; then
            key="${BASH_REMATCH[1]}"
            val="${BASH_REMATCH[2]}"
            # Strip surrounding quotes if present
            [[ "$val" =~ ^\"(.*)\"$ ]] && val="${BASH_REMATCH[1]}"
            [[ "$val" =~ ^\'(.*)\'$ ]] && val="${BASH_REMATCH[1]}"

            # Only export keys this skill cares about. If shell already has
            # the var set (non-empty), don't overwrite — shell wins.
            case "$key" in
                SN_ATF_INSTANCE|SN_ATF_USER|SN_ATF_PASSWORD)
                    if [[ -z "${!key:-}" ]]; then export "$key=$val"; fi
                    ;;
            esac
        fi
    done < "$envfile"
}

# Public: assert credentials are usable. Call this in every script's entrypoint.
# If anything is missing, print a clear error and exit with code 2.
require_creds() {
    local missing=()
    [[ -n "${SN_ATF_INSTANCE:-}" ]] || missing+=("SN_ATF_INSTANCE")
    [[ -n "${SN_ATF_USER:-}"     ]] || missing+=("SN_ATF_USER")
    [[ -n "${SN_ATF_PASSWORD:-}" ]] || missing+=("SN_ATF_PASSWORD")

    if (( ${#missing[@]} > 0 )); then
        cat >&2 <<EOF
ERROR: Required credentials are not set: ${missing[*]}

Either:
  1. Add them to .env in your project root (recommended — gitignored):
       SN_ATF_INSTANCE=https://your-instance.service-now.com
       SN_ATF_USER=your.username
       SN_ATF_PASSWORD=your-password

  2. Or export them in your shell (visible in history — less secure):
       export SN_ATF_INSTANCE=...
       export SN_ATF_USER=...
       export SN_ATF_PASSWORD=...

  3. Or point the loader at a specific .env file:
       ATF_ENV_FILE=/abs/path/to/.env $0 ...

See: references/roles-and-access.md (relative to the skill root)
EOF
        exit 2
    fi

    # Normalize: strip trailing slash from instance URL
    SN_ATF_INSTANCE="${SN_ATF_INSTANCE%/}"
    export SN_ATF_INSTANCE

    # The basic-auth string used by every curl invocation in this skill
    export ATF_AUTH="${SN_ATF_USER}:${SN_ATF_PASSWORD}"
}

# Auto-load when sourced — but require_creds is opt-in (the caller asks for it
# when it's ready to validate).
_atf_load_env
