#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Python sidecar on :8001
( cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --port 8001 ) &
PY_PID=$!
trap 'kill $PY_PID 2>/dev/null || true' EXIT

# Rust server on :8000 (serves the frontend, proxies to the sidecar)
cd "$ROOT/server"
SOUFFLEUR_FRONTEND="$ROOT/frontend" SOUFFLEUR_TTS_URL="http://127.0.0.1:8001" \
    cargo run --release
