#!/usr/bin/env bash
# Arranca `ng serve` NATIVO en macOS (el frontend salió del esquema Docker; ver
# README, "Arranque local"). nginx lo proxya desde la VM vía
# host.docker.internal:4200, así que el acceso sigue siendo https://vendix.com
# y NUNCA localhost:4200 — la app resuelve su app_type por hostname.
#
# Este script existe porque el guard anterior (`predev:fe` ->
# check-node-version.js) sólo sabía DIAGNOSTICAR: un proceso hijo no puede
# cambiar el PATH de su padre, así que detectaba el Node equivocado y te
# mandaba a arreglarlo a mano en cada terminal nueva. Aquí sí se puede: el
# script antepone al PATH el Node correcto y luego ejecuta, en el mismo
# proceso, de modo que `nvm use` deja de ser un paso obligatorio.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="full"
[ "${1:-}" = "--lite" ] && MODE="lite"

# --- 1. Resolver un Node dentro de la matriz de Angular 20 -------------------
# La matriz es ^20.19 || ^22.12 || ^24. El Node de Homebrew (hoy 26.x) suele
# ganar el PATH sobre el de nvm, así que no basta con confiar en `node -v`.
en_matriz() {
  "$1" -e '
    const [M,m] = process.versions.node.split(".").map(Number);
    process.exit((M===20&&m>=19)||(M===22&&m>=12)||M===24 ? 0 : 1);
  ' 2>/dev/null
}

NODE_BIN=""

# 1a. ¿El del PATH ya sirve? Entonces no tocamos nada.
if command -v node >/dev/null 2>&1 && en_matriz "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
else
  # 1b. Buscar en nvm, preferiendo el major que fija .nvmrc.
  WANT="$(tr -d '[:space:]' < "$ROOT/.nvmrc" 2>/dev/null || echo 22)"
  for dir in "$HOME/.nvm/versions/node/v$WANT."* \
             "$HOME/.nvm/versions/node/v24."* \
             "$HOME/.nvm/versions/node/v22."* \
             "$HOME/.nvm/versions/node/v20."*; do
    [ -x "$dir/bin/node" ] || continue
    if en_matriz "$dir/bin/node"; then NODE_BIN="$dir/bin/node"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  cat >&2 <<MSG

  No encuentro ningún Node dentro de la matriz de Angular 20.
  Soportado: 20.19+, 22.12+ o 24.x     (este repo fija $(cat "$ROOT/.nvmrc" 2>/dev/null || echo 22) en .nvmrc)

  En el PATH hay: $(node -v 2>/dev/null || echo 'ninguno')
  Busqué también en ~/.nvm/versions/node/ y no había ninguno servible.

  Instálalo con:   nvm install

MSG
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):$PATH"

# --- 2. Palancas de memoria y paralelismo ------------------------------------
# Fuera del cgroup de Docker ya no hay SIGKILL por CONSTRAINT_MEMCG: el techo
# real es la RAM física. `--max-semi-space-size` agranda el new space para que
# el scavenger recoja la basura efímera del rebuild sin promoverla al old
# space. El worker de compilación de Angular hereda NODE_OPTIONS, que es
# justo lo que fallaba con 2048 dentro del contenedor.
if [ "$MODE" = "lite" ]; then
  # Para cuando corres algo pesado EN PARALELO (buildcheck, jest, otro agente).
  # Ojo: 3072 queda justo — se ha medido el proceso en ~3,2 GB de RSS tras una
  # ráfaga de rebuilds. Si el worker muere con "falsy value: (compilation)",
  # es este techo, no un bug del código: vuelve a `dev:fe`.
  export NODE_OPTIONS="--max-old-space-size=3072"
  export NG_BUILD_MAX_WORKERS=2
else
  export NODE_OPTIONS="--max-old-space-size=6144 --max-semi-space-size=64"
  export NG_BUILD_MAX_WORKERS=4
fi

# --- 3. Bitácora acotada para los agentes ------------------------------------
# El frontend ya no es un contenedor, así que `docker logs vendix_frontend`
# dejó de existir y con él la única forma que tenía un agente de ver el estado
# del watch. Esta bitácora la devuelve, y la lee `buildcheck.sh --watch`.
#
# NO acumula: el filtro awk guarda ÚNICAMENTE el ciclo de compilación en curso
# y REESCRIBE el archivo en cada volcado. Techo medido: 16 KB (800 líneas).
# Como sólo un proceso puede tomar el :4200, hay un único escritor — no se
# repite el problema del log compartido entre agentes en paralelo.
LOG_DIR="$ROOT/.dev"
LOG="$LOG_DIR/frontend-watch.log"
mkdir -p "$LOG_DIR"
: > "$LOG"

echo "ng serve nativo · node $("$NODE_BIN" -v) · modo $MODE · workers $NG_BUILD_MAX_WORKERS"
echo "abre https://vendix.com (NO localhost:4200)"
echo "estado para agentes: bash scripts/buildcheck.sh --watch"
echo

# Sustitución de procesos, NO una tubería: así se conserva el `exec` y el
# código de salida es el de `npm`, sin reintroducir el cuelgue de pipe que ya
# mordió a buildcheck.sh.
exec > >(awk -f "$ROOT/scripts/dev-fe-log.awk" -v LOG="$LOG") 2>&1

exec npm run start -w apps/frontend
