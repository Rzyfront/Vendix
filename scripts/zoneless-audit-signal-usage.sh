#!/usr/bin/env bash
# Para cada *.component.ts con declaraciones signal/input/computed/toSignal,
# busca en el *.html hermano usos de esos nombres sin ().

set -euo pipefail
ROOT="apps/frontend/src/app"
violations=0

while IFS= read -r ts; do
  html="${ts%.ts}.html"
  [ -f "$html" ] || continue
  # Extraer nombres de props que son signals/inputs/computed/toSignal
  names=$(grep -oE "readonly\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*(signal|input(\.required)?|computed|toSignal)" "$ts" \
    | awk '{print $2}' | sort -u)
  for n in $names; do
    # Buscar uso SIN paréntesis en el template (heurística: nombre seguido de no-paréntesis)
    if grep -nE "[^a-zA-Z0-9_\$\.]${n}[^a-zA-Z0-9_\(]" "$html" \
       | grep -vE "\[${n}\]|\(${n}\)|${n}Change|#${n}" >/dev/null 2>&1; then
      echo "POSIBLE BUG: $html usa '$n' sin ()"
      violations=$((violations+1))
    fi
  done
done < <(grep -rln "= signal\|= input\|= computed\|= toSignal" "$ROOT" --include="*.component.ts")

echo "Total posibles violaciones: $violations"
