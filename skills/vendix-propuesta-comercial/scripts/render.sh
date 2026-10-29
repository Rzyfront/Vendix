#!/usr/bin/env bash
# Prepares a throwaway virtualenv outside the repo and runs render.py.
# Usage: render.sh propuesta|hardware --data datos.json [--out salida.pdf]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${VENDIX_DOCS_VENV:-${TMPDIR:-/tmp}/vendix-docs-venv}"
if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -c "import jinja2, qrcode, pypdf, PIL" 2>/dev/null; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check jinja2 "qrcode[pil]" pypdf
fi
exec "$VENV/bin/python" -I "$DIR/render.py" "$@"
