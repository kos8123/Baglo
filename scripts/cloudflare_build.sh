#!/usr/bin/env bash
set -euo pipefail
: "${BAGLO_API_BASE:?Set BAGLO_API_BASE to the public AWS API Gateway HTTPS URL}"
export CI=${CI:-true}
if [[ -n "${BAGLO_NODE_BIN:-}" ]]; then
  [[ -x "$BAGLO_NODE_BIN" ]] || { echo 'BAGLO_NODE_BIN is not executable'; exit 1; }
else
  command -v node >/dev/null || { echo 'Node.js is required'; exit 1; }
fi
command -v pnpm >/dev/null || corepack enable
pnpm --dir frontend install --frozen-lockfile
python3 scripts/build_frontend.py --output dist --api-base "$BAGLO_API_BASE" --landing
test -f dist/index.html
test -f dist/terminal.html
test -f dist/privacy.html
test -f dist/terms.html
