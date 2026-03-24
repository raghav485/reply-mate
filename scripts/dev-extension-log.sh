#!/usr/bin/env bash
set -euo pipefail

LOG_PATH="${REPLYMATE_EXTENSION_LOG:-/tmp/replymate-extension-dev.log}"
mkdir -p "$(dirname "$LOG_PATH")"

echo "Writing ReplyMate extension logs to $LOG_PATH"
npm run dev --workspace @replymate/extension 2>&1 | tee "$LOG_PATH"
