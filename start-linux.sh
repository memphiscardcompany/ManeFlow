#!/bin/sh
set -e
cd "$(dirname "$0")"
node scripts/first-run.js
if command -v xdg-open >/dev/null 2>&1; then xdg-open http://127.0.0.1:4321 >/dev/null 2>&1 || true; fi
exec node server.js
