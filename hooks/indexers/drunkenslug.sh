#!/usr/bin/env bash
# drunkenslug.sh — indexer hook for svtplay-dl-webui targeting drunkenslug.
#
# Wire it up by setting INDEXER_HOOK_SCRIPT=/app/hooks/indexers/drunkenslug.sh
# (the path inside the container — the hooks/ folder is baked into the image).
#
# CONTRACT (shared by every hook in this folder):
#   Invoked with no args, after the NZB has been written. Inputs come in as
#   environment variables:
#     INDEXER_NZB_PATH    Absolute path to the .nzb file (required)
#     INDEXER_TITLE       Release title (basename of the media file)
#     INDEXER_CATEGORY    Newznab category id, may be empty
#     INDEXER_PASSWORD    RAR password (per-job, random)
#     INDEXER_GROUP       First Usenet group the post was sent to
#     INDEXER_MEDIA_PATH  Original media file path (optional)
#
# Per-indexer config goes in its own env vars (apiUrl + apiKey), so multiple
# hooks can coexist without trampling each other's settings.
#
# Exit 0 = success; any non-zero exit = failure (stderr is captured into the
# job log and surfaced in the UI).

set -euo pipefail

DRUNKENSLUG_API_KEY="${DRUNKENSLUG_API_KEY:-}"
DRUNKENSLUG_API_URL="${DRUNKENSLUG_API_URL:-https://drunkenslug.com/api}"

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

RESPONSE="$(
    curl -fsS --max-time 120 \
        -X POST \
        -H "User-Agent: svtplay-dl-webui/1.0" \
        -F "apikey=${DRUNKENSLUG_API_KEY}" \
        -F "category=${INDEXER_CATEGORY:-}" \
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
