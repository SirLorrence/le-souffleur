#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

LIB_DIR="$ROOT/extension/lib"
mkdir -p "$LIB_DIR"

cp "$ROOT/frontend/js/api.js" "$LIB_DIR/"
cp "$ROOT/frontend/js/reader.js" "$LIB_DIR/"
cp "$ROOT/frontend/js/sync.js" "$LIB_DIR/"
cp "$ROOT/frontend/js/player.js" "$LIB_DIR/"
cp "$ROOT/frontend/js/controls.js" "$LIB_DIR/"
cp "$ROOT/frontend/styles.css" "$LIB_DIR/"

echo "Build done: copied files into $LIB_DIR"
