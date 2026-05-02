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
# drunkenslug's public bulk uploader takes the file via `files[]` and reads
# the password out of the NZB's <meta type="password"> tag, so no API key or
# extra metadata is needed here. Override the URL with DRUNKENSLUG_UPLOAD_URL
# if the upstream host changes.
#
# Exit 0 = success; any non-zero exit = failure (stderr is captured into the
# job log and surfaced in the UI).

set -euo pipefail

DRUNKENSLUG_UPLOAD_URL="${DRUNKENSLUG_UPLOAD_URL:-https://nzbs.drunkenslug.com/upload.php}"

: "${INDEXER_NZB_PATH:?INDEXER_NZB_PATH is required}"

if [[ ! -r "$INDEXER_NZB_PATH" ]]; then
    echo "NZB not readable: $INDEXER_NZB_PATH" >&2
    exit 1
fi

RESPONSE="$(
    curl -fsS --max-time 120 \
        -X POST \
        -H "User-Agent: svtplay-dl-webui/1.0" \
        -F "files[]=@${INDEXER_NZB_PATH};type=application/x-nzb" \
        "${DRUNKENSLUG_UPLOAD_URL}"
)" || {
    echo "drunkenslug upload failed" >&2
    exit 1
}

# Echo the indexer's response so it's captured in the job log.
echo "$RESPONSE"
