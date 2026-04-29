#!/usr/bin/env bash
# drunkenslug-upload.sh — example indexer hook for svtplay-dl-webui.
#
# This script gets invoked by the Usenet pipeline once an NZB has been
# generated. Wire it up by setting INDEXER_HOOK_SCRIPT=/path/to/this.sh.
#
# CONTRACT (required by svtplay-dl-webui):
#   Upload mode: invoked with no args. Env vars:
#     INDEXER_NZB_PATH    Absolute path to the .nzb file (required)
#     INDEXER_TITLE       Release title (basename of the media file)
#     INDEXER_CATEGORY    User-supplied category, may be empty
#     INDEXER_PASSWORD    RAR password (per-job, random)
#     INDEXER_GROUP       First Usenet group the post was sent to
#     INDEXER_MEDIA_PATH  Original media file path (optional)
#   Check mode: invoked as `script.sh --check` with no INDEXER_* vars.
#     Must validate connectivity/credentials and exit 0/non-zero WITHOUT
#     uploading anything. Used by the Settings → "Test indexer" button.
#
# Exit 0 = success; any non-zero exit = failure (stderr is captured into the
# job log and surfaced in the UI).

set -euo pipefail

# ────────────── User configuration ──────────────
# Either hard-code these or supply them via the environment when launching
# the svtplay-dl-webui container.
DRUNKENSLUG_API_KEY="${DRUNKENSLUG_API_KEY:-}"
DRUNKENSLUG_API_URL="${DRUNKENSLUG_API_URL:-https://drunkenslug.com/api}"

# Map your local "category" string onto a drunkenslug numeric category id.
# Defaults: 5000 = TV, 2000 = Movies. Adjust to suit your indexer.
map_category() {
    case "${1:-}" in
        tv|TV)        echo "5000" ;;
        movies|Movie) echo "2000" ;;
        "" )          echo "5000" ;; # default to TV
        *)            echo "$1"   ;; # already numeric
    esac
}

# ────────────── Connectivity check ──────────────
if [[ "${1:-}" == "--check" ]]; then
    if [[ -z "$DRUNKENSLUG_API_KEY" ]]; then
        echo "DRUNKENSLUG_API_KEY is not set" >&2
        exit 1
    fi
    # Simple GET that requires a valid api key. Adjust per indexer:
    # drunkenslug exposes /api?t=caps (capabilities) which works without auth,
    # but we hit a t=search call to also exercise the auth path.
    if ! curl -fsS --max-time 10 \
        "${DRUNKENSLUG_API_URL}?t=search&apikey=${DRUNKENSLUG_API_KEY}&limit=1&o=json" \
        > /dev/null
    then
        echo "drunkenslug API check failed (auth or network)" >&2
        exit 1
    fi
    echo "drunkenslug API reachable, key accepted"
    exit 0
fi

# ────────────── Upload mode ──────────────
: "${INDEXER_NZB_PATH:?INDEXER_NZB_PATH is required}"
: "${INDEXER_TITLE:?INDEXER_TITLE is required}"

if [[ -z "$DRUNKENSLUG_API_KEY" ]]; then
    echo "DRUNKENSLUG_API_KEY is not set — refusing to upload" >&2
    exit 1
fi

if [[ ! -r "$INDEXER_NZB_PATH" ]]; then
    echo "NZB not readable: $INDEXER_NZB_PATH" >&2
    exit 1
fi

CATEGORY_ID="$(map_category "${INDEXER_CATEGORY:-}")"

# Build a multipart upload. The exact field names vary between indexers;
# drunkenslug accepts an `nzb` file part and form fields for category +
# password. Refer to your indexer's upload API docs.
RESPONSE="$(
    curl -fsS --max-time 120 \
        -X POST \
        -H "User-Agent: svtplay-dl-webui/1.0" \
        -F "apikey=${DRUNKENSLUG_API_KEY}" \
        -F "category=${CATEGORY_ID}" \
        -F "password=${INDEXER_PASSWORD:-}" \
        -F "title=${INDEXER_TITLE}" \
        -F "nzb=@${INDEXER_NZB_PATH};type=application/x-nzb" \
        "${DRUNKENSLUG_API_URL}/upload"
)" || {
    echo "drunkenslug upload failed" >&2
    exit 1
}

# Echo the indexer's response so it's captured in the job log.
echo "$RESPONSE"
