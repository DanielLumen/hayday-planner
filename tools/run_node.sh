#!/bin/sh
set -eu

if [ -n "${CODEX_NODE:-}" ] && [ -x "$CODEX_NODE" ]; then
  exec "$CODEX_NODE" "$@"
fi

if command -v node >/dev/null 2>&1; then
  exec node "$@"
fi

CODEX_BUNDLED_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ -x "$CODEX_BUNDLED_NODE" ]; then
  exec "$CODEX_BUNDLED_NODE" "$@"
fi

echo "Node.js was not found. Install Node.js or set CODEX_NODE to a node executable." >&2
exit 127
