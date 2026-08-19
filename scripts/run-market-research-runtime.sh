#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
set -a
source "$ROOT/.env.market-research"
set +a

NODE_BIN="${MARKET_RESEARCH_NODE_BIN:-/opt/homebrew/bin/node}"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

cd /tmp
exec "$NODE_BIN" "$ROOT/dist/market-research/src/api/server.js"
