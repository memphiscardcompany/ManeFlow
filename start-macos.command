#!/bin/sh
set -e
cd "$(dirname "$0")"
node scripts/first-run.js
open http://127.0.0.1:4321
exec node server.js
