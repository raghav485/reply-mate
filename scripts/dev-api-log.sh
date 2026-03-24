#!/usr/bin/env bash
set -euo pipefail

LOG_PATH="${REPLYMATE_API_LOG:-/tmp/replymate-api-dev.log}"
mkdir -p "$(dirname "$LOG_PATH")"

echo "Writing ReplyMate API logs to $LOG_PATH"
npm run dev --workspace @replymate/api 2>&1 | tee "$LOG_PATH"
