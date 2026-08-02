#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$ROOT/runtime/bin/node" "$ROOT/app/dist/src/cli/index.js" "$@"
