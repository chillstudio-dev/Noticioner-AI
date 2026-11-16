#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
demo_node="${NOTICIONER_NODE:-}"
if [ -z "$demo_node" ]; then demo_node="$(command -v node || true)"; fi
if [ -z "$demo_node" ] && [ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  demo_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ -z "$demo_node" ]; then echo "Install Node.js 24.8+ or set NOTICIONER_NODE to its executable path." >&2; exit 1; fi
if [ ! -d node_modules/tsx ]; then echo "Install project dependencies with npm ci first." >&2; exit 1; fi
if [ ! -f .next/BUILD_ID ]; then "$demo_node" node_modules/next/dist/bin/next build --webpack; fi
exec "$demo_node" --import tsx scripts/demo-server.ts
