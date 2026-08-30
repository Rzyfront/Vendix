#!/usr/bin/env bash
#
# buildcheck.sh — Verificación de compilación one-shot para Vendix.
#
# Objetivo: saber si el código COMPILA sin levantar ningún servidor y sin dejar
# procesos huérfanos consumiendo memoria.
#
#   - Backend  : tsc --noEmit sobre tsconfig.build.json (no emite, no arranca Nest)
#   - Frontend : ngc sobre tsconfig.buildcheck.json (AOT + strictTemplates, no bundle,
#                no prerender, no SSR). Con --deep hace el bundle real pero igual
#                sin prerender ni servidor SSR.
#
# Cada paso corre en su propio process group; al terminar (o al abortar) se mata
# el grupo completo, así los nietos (esbuild, workers de Angular) no sobreviven.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${BUILDCHECK_LOG_DIR:-$ROOT/.buildcheck}"
TIMEOUT="${BUILDCHECK_TIMEOUT:-900}"
BE_MEM="${BUILDCHECK_BE_MEM:-3072}"
FE_MEM="${BUILDCHECK_FE_MEM:-4096}"
TEST_MEM="${BUILDCHECK_TEST_MEM:-2048}"
# Jest sin tope usa cores-1 workers y cada worker de ts-jest levanta su propio
# program de TypeScript (~2.5GB en este repo). Con 16GB y la VM de Docker
# ocupando ~8GB, eso es OOM garantizado.
TEST_WORKERS="${BUILDCHECK_TEST_WORKERS:-2}"
# RAM mínima libre exigida por paso, en MB. La VM de Docker ya retiene lo suyo.
NEED_BE="${BUILDCHECK_NEED_BE:-2048}"
NEED_FE="${BUILDCHECK_NEED_FE:-2560}"
NEED_DEEP="${BUILDCHECK_NEED_DEEP:-4096}"
NEED_TEST="${BUILDCHECK_NEED_TEST:-3072}"

# npm decide por su cuenta si iza un binario de workspace a la raíz o lo deja
# anidado en apps/frontend/node_modules/.bin. El 2026-08-30, al alinear
# @angular/cli de ^21 a ^20.3, `ng` se movió de la raíz al workspace y este
# script —que fijaba la ruta de la raíz— dejó de encontrarlo. La ruta no es un
# hecho estable: hay que resolverla.
resolve_bin() {
  local name="$1" c
  for c in "$ROOT/node_modules/.bin/$name" \
           "$ROOT/apps/frontend/node_modules/.bin/$name" \
           "$ROOT/apps/backend/node_modules/.bin/$name"; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  echo "buildcheck: no encuentro el binario '$name' en ningún node_modules/.bin." >&2
  echo "  ¿Falta un npm install? Buscado en raíz, apps/frontend y apps/backend." >&2
  return 1
}

# PGID del propio script: nunca lo matamos.
SELF_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"

TARGET_BE=0
TARGET_FE=0
TARGET_TEST=0
DEEP=0
MODE_REAP=0
REAP_HARD=0
MODE_TOP=0
FORCE=0
EXPLICIT_TARGET=0
PASSTHRU=""

usage() {
  cat <<'EOF'
Uso: bash scripts/buildcheck.sh [opciones]

  -b, --backend      Solo backend (tsc --noEmit)
  -f, --frontend     Solo frontend (ngc typecheck AOT)
  -t, --test         Jest del backend con tope de workers y de RAM por worker
                     Acepta un filtro de path: `--test src/dominio/x.spec.ts`
                     corre SOLO ese spec con --runInBand (1 proceso, sin pool).
                     Sin filtro corre los 171 specs del repo.
      --all          Backend + frontend (default; NO incluye tests)
      --deep         Frontend con bundle real (ng build --configuration buildcheck,
                     sin prerender ni SSR). Más lento y más RAM.
      --reap         No compila: barre procesos de build/serve/jest huérfanos y sale
      --reap-hard    Igual que --reap pero también mata procesos esbuild sueltos
      --top          Lista procesos node de >300MB con su comando (diagnóstico)
      --force        Ignora el preflight de memoria libre
      --timeout N    Segundos antes de matar un paso (default 900)
  -h, --help         Esta ayuda

Variables de entorno: BUILDCHECK_TIMEOUT, BUILDCHECK_BE_MEM, BUILDCHECK_FE_MEM,
BUILDCHECK_TEST_MEM, BUILDCHECK_TEST_WORKERS, BUILDCHECK_NEED_*, BUILDCHECK_LOG_DIR.

NUNCA arranca servidores. Nada de ng serve, nest start, watch o prerender.
No toca contenedores Docker (esos viven en la VM, fuera del alcance de pkill).
Los pasos corren en serie a propósito: paralelizarlos es lo que agota la RAM.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -b|--backend)  TARGET_BE=1; EXPLICIT_TARGET=1 ;;
    -f|--frontend) TARGET_FE=1; EXPLICIT_TARGET=1 ;;
    -t|--test)     TARGET_TEST=1; EXPLICIT_TARGET=1 ;;
    --all)         TARGET_BE=1; TARGET_FE=1; EXPLICIT_TARGET=1 ;;
    --deep)        DEEP=1 ;;
    --reap)        MODE_REAP=1 ;;
    --reap-hard)   MODE_REAP=1; REAP_HARD=1 ;;
    --top)         MODE_TOP=1 ;;
    --force)       FORCE=1 ;;
    --timeout)     shift; TIMEOUT="${1:-900}" ;;
    -h|--help)     usage; exit 0 ;;
    --)            shift; while [ $# -gt 0 ]; do PASSTHRU="$PASSTHRU $1"; shift; done ;;
    -*) echo "Opción desconocida: $1" >&2; usage; exit 2 ;;
    # Cualquier posicional es un filtro de path para jest: verificar SOLO el
    # spec que se acaba de escribir en vez de los 171 del repo.
    *)             PASSTHRU="$PASSTHRU $1" ;;
  esac
  shift
done

if [ "$EXPLICIT_TARGET" -eq 0 ]; then
  TARGET_BE=1
  TARGET_FE=1
fi

# ---------------------------------------------------------------------------
# Barrido de process groups
# ---------------------------------------------------------------------------

PGIDS=""

reap_pgid() {
  local pgid="$1"
  [ -z "$pgid" ] && return 0
  [ "$pgid" = "$SELF_PGID" ] && return 0   # jamás matar el grupo propio
  kill -TERM "-$pgid" 2>/dev/null
  local i=0
  while [ "$i" -lt 20 ]; do
    kill -0 "-$pgid" 2>/dev/null || return 0
    sleep 0.1
    i=$((i + 1))
  done
  kill -KILL "-$pgid" 2>/dev/null
  return 0
}

cleanup() {
  local pgid
  for pgid in $PGIDS; do
    reap_pgid "$pgid"
  done
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# --reap: barrer huérfanos de corridas anteriores
# ---------------------------------------------------------------------------

reap_orphans() {
  local patterns='ng serve
ng build
@angular/build
angular/build/src/builders
nest start
nest build
ng-server
main.server
jest-worker
processChild
bin/jest'
  if [ "$REAP_HARD" -eq 1 ]; then
    patterns="$patterns
esbuild"
  fi

  local found=0
  local pat
  local IFS_OLD="$IFS"
  IFS=$'\n'
  for pat in $patterns; do
    IFS="$IFS_OLD"
    local pids
    pids="$(pgrep -f "$pat" 2>/dev/null | grep -v "^$$\$" || true)"
    if [ -n "$pids" ]; then
      local p
      for p in $pids; do
        # Nunca matarse a sí mismo ni a su propio grupo.
        local ppgid
        ppgid="$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')"
        [ "$ppgid" = "$SELF_PGID" ] && continue
        echo "  ✖ kill $p  ($(ps -o command= -p "$p" 2>/dev/null | cut -c1-90))"
        kill -TERM "$p" 2>/dev/null
        found=$((found + 1))
      done
    fi
    IFS=$'\n'
  done
  IFS="$IFS_OLD"

  if [ "$found" -eq 0 ]; then
    echo "  Sin procesos de build/serve huérfanos."
  else
    sleep 1
    echo "  $found proceso(s) señalizados con TERM."
  fi
}

if [ "$MODE_REAP" -eq 1 ]; then
  echo "Barrido de procesos de build/serve/jest huérfanos (no toca Docker):"
  reap_orphans
  exit 0
fi

# ---------------------------------------------------------------------------
# --top: qué se está comiendo la RAM
# ---------------------------------------------------------------------------

if [ "$MODE_TOP" -eq 1 ]; then
  echo "Procesos node de más de 300MB (RSS descendente):"
  ps -axo rss=,pid=,command= \
    | awk '$1 > 307200 && /node/ { printf "  %6.2f GB  pid=%-7s %.110s\n", $1/1048576, $2, substr($0, index($0,$3)) }' \
    | sort -rn \
    || true
  echo
  echo "VM de Docker (limactl/qemu/colima) — su RAM no la libera pkill:"
  ps -axo rss=,pid=,command= \
    | awk '/limactl|qemu|colima|docker/ && $1 > 102400 { printf "  %6.2f GB  pid=%-7s %.80s\n", $1/1048576, $2, substr($0, index($0,$3)) }' \
    || true
  exit 0
fi

# ---------------------------------------------------------------------------
# Preflight de memoria libre
# ---------------------------------------------------------------------------

avail_mb() {
  local pagesize stats free inactive spec
  pagesize="$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)"
  stats="$(vm_stat 2>/dev/null)" || { echo 999999; return 0; }
  free="$(echo "$stats"     | awk '/Pages free/        {gsub("\\.","",$3); print $3; exit}')"
  inactive="$(echo "$stats" | awk '/Pages inactive/    {gsub("\\.","",$3); print $3; exit}')"
  spec="$(echo "$stats"     | awk '/Pages speculative/ {gsub("\\.","",$3); print $3; exit}')"
  free="${free:-0}"; inactive="${inactive:-0}"; spec="${spec:-0}"
  echo $(( ((free + inactive + spec) * pagesize) / 1048576 ))
}

preflight() {
  local need="$1"
  local label="$2"
  [ "$FORCE" -eq 1 ] && return 0
  local avail
  avail="$(avail_mb)"
  if [ "$avail" -ge "$need" ]; then
    return 0
  fi
  cat >&2 <<EOF

✖ ABORTADO antes de empezar: memoria libre insuficiente para "$label".
  Disponible: ${avail} MB — necesario: ${need} MB

  Dos consumidores se reparten la RAM: la VM de Docker la retiene aunque los
  contenedores estén ociosos, y el `ng serve` NATIVO (fuera de Docker desde el
  2026-08-30) es el proceso más pesado del host. Opciones:

    pkill -f 'ng serve'              # libera el proceso más pesado (~4-5 GB, nativo)
    docker compose stop              # libera todo el stack dev
    bash scripts/buildcheck.sh --top # ver qué se está comiendo la RAM
    ... --force                      # correr igual, asumiendo el swap

EOF
  return 1
}

# ---------------------------------------------------------------------------
# Ejecución guardada de un paso
# ---------------------------------------------------------------------------

mkdir -p "$LOG_DIR"

FAILED=""

run_step() {
  local label="$1"
  shift
  local log="$LOG_DIR/$label.log"
  local started
  started="$(date +%s)"

  printf '▶ %-22s ' "$label"

  # set -m: el hijo queda como líder de su propio process group (pgid == pid),
  # requisito para poder matar todo el árbol con kill -- -pid.
  set -m
  "$@" >"$log" 2>&1 &
  local pid=$!
  set +m
  PGIDS="$PGIDS $pid"

  (
    sleep "$TIMEOUT"
    if kill -0 "$pid" 2>/dev/null; then
      echo "" >>"$log"
      echo "buildcheck: TIMEOUT tras ${TIMEOUT}s — proceso abortado." >>"$log"
      kill -TERM "-$pid" 2>/dev/null
    fi
  ) &
  local watchdog=$!

  wait "$pid"
  local code=$?

  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  reap_pgid "$pid"

  local elapsed=$(( $(date +%s) - started ))
  if [ "$code" -eq 0 ]; then
    echo "PASS  (${elapsed}s)"
  else
    echo "FAIL  (exit $code, ${elapsed}s)  → $log"
    FAILED="$FAILED $label"
  fi
  return 0
}

echo "buildcheck — solo compilación, sin servidores (timeout ${TIMEOUT}s)"
echo "logs: $LOG_DIR"
echo

echo "RAM libre estimada: $(avail_mb) MB"
echo

if [ "$TARGET_BE" -eq 1 ]; then
  if preflight "$NEED_BE" "backend-typecheck"; then
    # --pretty false: log plano sin códigos ANSI, greppable por humanos y agentes.
    run_step backend-typecheck \
      node "--max-old-space-size=$BE_MEM" "$ROOT/node_modules/.bin/tsc" \
        -p "$ROOT/apps/backend/tsconfig.build.json" --noEmit --pretty false
  else
    FAILED="$FAILED backend-typecheck(preflight)"
  fi
fi

if [ "$TARGET_FE" -eq 1 ]; then
  if [ "$DEEP" -eq 1 ]; then
    if preflight "$NEED_DEEP" "frontend-bundle"; then
      # NG_BUILD_MAX_WORKERS=2: el bundler de Angular abre un pool por cores.
      run_step frontend-bundle \
        bash -c "cd '$ROOT/apps/frontend' && NG_BUILD_MAX_WORKERS=2 exec node '--max-old-space-size=$FE_MEM' '$(resolve_bin ng)' build --configuration buildcheck"
      rm -rf "$ROOT/apps/frontend/dist/buildcheck"
    else
      FAILED="$FAILED frontend-bundle(preflight)"
    fi
  else
    if preflight "$NEED_FE" "frontend-typecheck"; then
      run_step frontend-typecheck \
        bash -c "cd '$ROOT/apps/frontend' && exec node '--max-old-space-size=$FE_MEM' '$(resolve_bin ngc)' -p tsconfig.buildcheck.json --pretty false"
    else
      FAILED="$FAILED frontend-typecheck(preflight)"
    fi
  fi
fi

if [ "$TARGET_TEST" -eq 1 ]; then
  # Con filtro de path basta un proceso: --runInBand no abre pool y es lo más
  # barato para verificar el spec que se acaba de escribir. Sin filtro se corre
  # la suite completa (171 archivos), y ahí sí hacen falta los 2 workers.
  if [ -n "$PASSTHRU" ]; then
    JEST_CONC="--runInBand"
    JEST_NEED=1536
    JEST_LABEL="backend-tests (filtrado:$PASSTHRU)"
  else
    JEST_CONC="--maxWorkers=$TEST_WORKERS --workerIdleMemoryLimit=1024MB"
    JEST_NEED="$NEED_TEST"
    JEST_LABEL="backend-tests (suite completa)"
  fi
  if preflight "$JEST_NEED" "$JEST_LABEL"; then
    # Topes explícitos aunque package.json ya los declare: un agente que corra
    # `npx jest` a mano se salta la config, y sin tope son cores-1 workers.
    run_step backend-tests \
      bash -c "cd '$ROOT/apps/backend' && exec node '--max-old-space-size=$TEST_MEM' '$ROOT/node_modules/.bin/jest' $JEST_CONC --ci --forceExit$PASSTHRU"
  else
    FAILED="$FAILED backend-tests(preflight)"
  fi
fi

echo

# Verificación final: no debe quedar nada vivo de lo que lanzamos.
LEFTOVER=""
for pgid in $PGIDS; do
  if kill -0 "-$pgid" 2>/dev/null && [ "$pgid" != "$SELF_PGID" ]; then
    LEFTOVER="$LEFTOVER $pgid"
  fi
done
if [ -n "$LEFTOVER" ]; then
  echo "⚠ process groups aún vivos:$LEFTOVER — forzando KILL"
  for pgid in $LEFTOVER; do
    kill -KILL "-$pgid" 2>/dev/null
  done
fi

if [ -n "$FAILED" ]; then
  echo "RESULTADO: FAIL —$FAILED"
  for label in $FAILED; do
    # Los fallos de preflight no tienen log: nunca se ejecutó nada.
    [ -f "$LOG_DIR/$label.log" ] || continue
    echo
    echo "──── primeras líneas de error: $label ────"
    grep -nE "error|Error|ERROR|✕|FAIL" "$LOG_DIR/$label.log" | head -30
  done
  exit 1
fi

echo "RESULTADO: PASS — compila y no quedó ningún proceso vivo."
exit 0
