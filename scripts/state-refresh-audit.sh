#!/usr/bin/env bash
# State-refresh audit — Vendix Frontend
#
# Origen: QUI-554. En `store/settings/users` el modal de creación llamaba
# `StoreUsersManagementService.createUser()` por HTTP directo en vez de
# despachar `StoreUsersActions.createUser`. Consecuencia: `createUserSuccess`
# nunca se emitía, el effect `mutationSuccess$` —que ya existía y recarga
# `loadUsers` + `loadStats`— jamás corría, y el usuario creado no aparecía en la
# lista hasta recargar la página a mano.
#
# La clase de bug, no el caso puntual: en un módulo que YA tiene NgRx
# (`state/actions/*.actions.ts`), un componente que muta por HTTP directo se
# salta la cadena acción → effect → refresh. El síntoma siempre es "guardé y no
# se ve", y pasa desapercibido en code review porque el POST sí funciona.
#
# Regla: dentro de un módulo con NgRx, ningún `*.component.ts` debe invocar
# `this.<algo>Service.create|update|delete<Xxx>(...)` y suscribirse. Debe
# despachar la acción del módulo y dejar el refresh al effect que escucha su
# `*Success`.
#
# Alcance: igual que la regla de UI-state de `zoneless-audit.sh`, sólo FALLA por
# los archivos modificados en este PR/rama. La deuda preexistente se reporta
# como warning para que quede a la vista sin bloquear ramas ajenas al problema.
# `--all` fuerza el modo estricto sobre todo el árbol (auditoría deliberada).
#
# Exit 0 si no hay violaciones nuevas; 1 si alguna.
set -eu

STRICT_ALL=0
[ "${1:-}" = "--all" ] && STRICT_ALL=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/frontend/src/app"

# Base ref del PR (lo inyecta CI); 'main' para runs locales.
BASE_REF="${BASE_REF:-main}"
SAFE_BASE=$(printf '%s' "$BASE_REF" | tr -cd '[:alnum:]./_-')

FAILED=0
fail() { echo "❌ $1"; FAILED=1; }
ok() { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }

# Mutación por servicio invocada desde el componente. `\s*` cruza saltos de
# línea en Rust regex (rg -U), así que cubre la forma de una línea y también:
#   this.storeUsersService
#     .createUser(dto)
MUTATION_CALL='this\.[A-Za-z0-9_]*[Ss]ervice\s*\.(create|update|delete)[A-Z][A-Za-z0-9_]*\s*\('

# Exentos permanentes: los specs simulan servicios a propósito.
EXEMPT='(\.spec\.ts$)'

cd "$APP_DIR"

echo "state-refresh audit — mutación sin dispatch en módulos con NgRx"
echo ""

# Módulos con NgRx: los que declaran acciones.
NGRX_MODULES=$(find . -path '*state/actions*' -name '*.actions.ts' \
  | xargs -n1 dirname | xargs -n1 dirname | xargs -n1 dirname | sort -u)

if [ -z "$NGRX_MODULES" ]; then
  fail "no se encontró ningún módulo con state/actions — ¿cambió la convención?"
  echo ""
  echo "❌ State-refresh audit FAILED"
  exit 1
fi

# Todas las violaciones del árbol (rutas relativas a apps/frontend/src/app).
ALL_VIOLATIONS=""
for mod in $NGRX_MODULES; do
  candidates=$(rg -lU "$MUTATION_CALL" --glob '*.component.ts' "$mod" 2>/dev/null \
    | grep -vE "$EXEMPT" || true)
  for f in $candidates; do
    # Sólo cuenta si además se suscribe: descarta menciones en comentarios o
    # tipos y confirma que la llamada se ejecuta desde el componente.
    if rg -q '\.subscribe\(' "$f" 2>/dev/null; then
      ALL_VIOLATIONS="${ALL_VIOLATIONS}${f#./}
"
    fi
  done
done

violation_list() { printf '%s' "$ALL_VIOLATIONS" | grep . || true; }
total=$(violation_list | wc -l | tr -d ' ')

if [ "$STRICT_ALL" = "1" ]; then
  if [ "$total" = "0" ]; then
    ok "0 componentes mutan por HTTP directo en módulos con NgRx (árbol completo)"
  else
    fail "$total componente(s) mutan por HTTP directo dentro de un módulo con NgRx:"
    violation_list | sed 's/^/     /'
  fi
else
  # Sólo los archivos tocados en este PR/rama pueden hacer fallar el audit.
  CHANGED=$(cd "$REPO_ROOT" && git diff --name-only "origin/${SAFE_BASE}...HEAD" 2>/dev/null \
    | grep '\.component\.ts$' || true)

  new_violations=""
  if [ -n "$CHANGED" ]; then
    for changed in $CHANGED; do
      # `git diff` devuelve rutas desde la raíz del repo; las violaciones son
      # relativas a apps/frontend/src/app.
      rel="${changed#apps/frontend/src/app/}"
      if violation_list | grep -qxF "$rel"; then
        new_violations="${new_violations}${rel}
"
      fi
    done
  fi

  new_count=$(printf '%s' "$new_violations" | grep -c . || true)
  if [ "$new_count" = "0" ]; then
    ok "0 violaciones nuevas en los archivos de esta rama"
  else
    fail "$new_count componente(s) modificados en esta rama mutan por HTTP directo:"
    printf '%s' "$new_violations" | grep . | sed 's/^/     /'
  fi

  if [ "$total" != "0" ]; then
    warn "deuda preexistente: $total componente(s) en el árbol (informativo — correr con --all para verlos)"
  fi
fi

if [ "$FAILED" != "0" ]; then
  echo ""
  echo "     Deben despachar la acción del módulo (createX/updateX/deleteX) y"
  echo "     dejar la recarga al effect que escucha su *Success. Ver QUI-554 y"
  echo "     la skill vendix-frontend-state."
fi

echo ""
if [ "$FAILED" = "0" ]; then
  echo "✅ State-refresh audit PASSED"
  exit 0
else
  echo "❌ State-refresh audit FAILED"
  exit 1
fi
