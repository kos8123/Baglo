#!/usr/bin/env bash
set -euo pipefail
: "${BAGLO_API_BASE:?Set BAGLO_API_BASE to the public AWS API Gateway HTTPS URL}"
export CI=${CI:-true}
if [[ -n "${BAGLO_NODE_BIN:-}" ]]; then
  [[ -x "$BAGLO_NODE_BIN" ]] || { echo 'BAGLO_NODE_BIN is not executable'; exit 1; }
else
  command -v node >/dev/null || { echo 'Node.js is required'; exit 1; }
fi
if [[ -n "${BAGLO_PNPM_CLI:-}" ]]; then
  "$BAGLO_NODE_BIN" "$BAGLO_PNPM_CLI" --dir frontend install --frozen-lockfile
else
  command -v npx >/dev/null || { echo 'npx is required to install the pinned pnpm version'; exit 1; }
  npx --yes pnpm@11.25.0 --dir frontend install --frozen-lockfile
fi
python3 scripts/build_frontend.py --output dist --api-base "$BAGLO_API_BASE" --landing
test -f dist/index.html
test -f dist/terminal.html
test -f dist/privacy.html
test -f dist/terms.html
