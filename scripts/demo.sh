#!/usr/bin/env bash
# Start the source sandbox, the hub, and the operator console.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://hub:hub@127.0.0.1:54329/contexthub}"
export MOCK_BASE_URL="${MOCK_BASE_URL:-http://127.0.0.1:8001}"
export HUB_BASE_URL="${HUB_BASE_URL:-http://127.0.0.1:8000}"
export BLOB_DIR="${BLOB_DIR:-$PWD/data/raw}"
mkdir -p "$BLOB_DIR"

.venv/bin/python -m mock_sources &
MOCK_PID=$!
.venv/bin/python -m hub &
HUB_PID=$!

cleanup() {
  kill "$MOCK_PID" "$HUB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Context Hub console: http://127.0.0.1:5173"
cd dashboard
npm run dev -- --host 127.0.0.1 --port 5173
