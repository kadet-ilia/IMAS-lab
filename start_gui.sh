#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v npm >/dev/null 2>&1; then
  echo 'Node.js/npm required for local development' >&2
  exit 1
fi
cd "$ROOT/gui"
if [ ! -d node_modules ]; then npm ci; fi
printf 'IMAS_LaB_test: browser-only http://127.0.0.1:5173\n'
npm start
