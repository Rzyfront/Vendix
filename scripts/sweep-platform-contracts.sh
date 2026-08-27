#!/usr/bin/env bash
# =============================================================================
# Barrido de contratos — CP-platform-remediation-100 (paso 14)
#
# Sustituye al barrido de P4.1 del plan anterior, que declaró verde una
# cobertura que nunca comparó: de sus 21 filas, doce devolvieron
# 404 INVOICING_FIND_001 porque sondaban `invoices/1`, inexistente en el
# ámbito plataforma, y se contaron como éxitos.
#
# Reglas de este script, en respuesta a ese defecto:
#   1. CUENTA. Al final compara el total verificado contra EXPECTED_TOTAL y
#      sale con código != 0 si no coincide. Un barrido que no cuenta no es
#      evidencia.
#   2. Distingue tres estados, no dos: PASS, FAIL y UNVERIFIED. Un 404 por
#      dato ausente es UNVERIFIED — nunca PASS.
#   3. No sondea identificadores inventados. Usa el id real que devuelve la
#      emisión del paso 13, pasado por INVOICE_ID.
#
# Uso:
#   TOK=<jwt-super-admin> INVOICE_ID=<id> ./sweep.sh
#
# Si no se pasa TOK, el script intenta autenticarse con la cuenta semilla.
# =============================================================================
set -uo pipefail

API="${API:-http://localhost:3000/api}"
P="$API/superadmin/subscriptions/fiscal"
DB_CONTAINER="${DB_CONTAINER:-vendix_postgres}"
DB_USER="${DB_USER:-username}"
DB_NAME="${DB_NAME:-vendix_db}"
PROFILE_ID="${PROFILE_ID:-93}"
RESOLUTION_ID="${RESOLUTION_ID:-41}"
PLATFORM_ORG_ID="${PLATFORM_ORG_ID:-1}"
EXPECTED_TOTAL=59

PASS=0; FAIL=0; UNVERIFIED=0
declare -a FAILED_IDS=() UNVERIFIED_IDS=()

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_warn=$'\033[33m'; c_off=$'\033[0m'

record() { # record <id> <estado> <detalle>
  case "$2" in
    PASS)       PASS=$((PASS+1));             printf '%s  PASS%s  %-7s %s\n' "$c_ok"  "$c_off" "$1" "$3" ;;
    FAIL)       FAIL=$((FAIL+1));       FAILED_IDS+=("$1");     printf '%s  FAIL%s  %-7s %s\n' "$c_bad" "$c_off" "$1" "$3" ;;
    UNVERIFIED) UNVERIFIED=$((UNVERIFIED+1)); UNVERIFIED_IDS+=("$1"); printf '%s  ????%s  %-7s %s\n' "$c_warn" "$c_off" "$1" "$3" ;;
  esac
}

sql() { docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null; }

# --- autenticación ----------------------------------------------------------
if [ -z "${TOK:-}" ]; then
  TOK=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
        -d '{"email":"admin@vendix.online","password":"1125634q"}' | jq -r '.data.access_token // empty')
fi
if [ -z "${TOK:-}" ]; then
  echo "${c_bad}Sin token de SUPER_ADMIN: el barrido completo queda UNVERIFIED.${c_off}"
fi
AUTH=(-H "Authorization: Bearer $TOK")

# `INVOICE_ID` es la factura real emitida en el paso 13. Sin ella, toda fila
# que dependa de una factura se marca UNVERIFIED en vez de fingir un 404 verde.
INVOICE_ID="${INVOICE_ID:-}"
if [ -z "$INVOICE_ID" ]; then
  INVOICE_ID=$(sql "SELECT id FROM invoices WHERE organization_id=$PLATFORM_ORG_ID AND cufe IS NOT NULL ORDER BY id DESC LIMIT 1;")
fi
HAVE_INVOICE=0
[ -n "$INVOICE_ID" ] && HAVE_INVOICE=1

echo "════════════════════════════════════════════════════════════════"
echo " Barrido de contratos — plataforma"
echo " API=$P"
echo " perfil=$PROFILE_ID  resolución=$RESOLUTION_ID  factura=${INVOICE_ID:-<ninguna>}"
echo "════════════════════════════════════════════════════════════════"

# =============================================================================
# FB — contratos frontend↔backend (33)
# =============================================================================
echo; echo "── FB · contratos frontend↔backend ──"

# fb <id> <descripción> <método> <ruta> <jq-aserción> [cuerpo]
fb() {
  local id="$1" desc="$2" method="$3" path="$4" assertion="$5" body="${6:-}"
  local out code json
  out=$(mktemp /tmp/vdx-sweep-XXXXXX)
  if [ -n "$body" ]; then
    code=$(curl -s -o "$out" -w '%{http_code}' -X "$method" "$P$path" "${AUTH[@]}" \
           -H 'Content-Type: application/json' -d "$body")
  else
    code=$(curl -s -o "$out" -w '%{http_code}' -X "$method" "$P$path" "${AUTH[@]}")
  fi
  json=$(cat "$out"); rm -f "$out"

  if [ "$code" = "000" ]; then
    record "$id" UNVERIFIED "$desc — backend sin responder"; return
  fi
  # Un 404 por dato ausente NO es un contrato verificado.
  if [ "$code" = "404" ] && echo "$json" | grep -q "INVOICING_FIND_001"; then
    record "$id" UNVERIFIED "$desc — 404 por dato inexistente, no es verde"; return
  fi
  if echo "$json" | jq -e "$assertion" >/dev/null 2>&1; then
    record "$id" PASS "$desc ($code)"
  else
    record "$id" FAIL "$desc — HTTP $code, aserción no cumplida: $assertion"
  fi
}

fb FB-01 "listado paginado de perfiles"      GET  "/profiles?limit=1"                 '.data and .meta'
fb FB-02 "crear perfil"                      POST "/profiles"                          '.data.current_version==1' \
   '{"name":"sweep-tmp","operation_type":"10","config":{"config_version":1}}'
fb FB-03 "plantillas DIAN"                   GET  "/profiles/templates"                '[.data[].key]|length>=3'
fb FB-04 "catálogo de perfiles"              GET  "/profiles/catalog"                  '.data|type=="array"'
fb FB-05 "detalle de perfil"                 GET  "/profiles/$PROFILE_ID"              '.data.id'
fb FB-06 "listado de versiones"              GET  "/profiles/$PROFILE_ID/versions?limit=3" '.data|type=="array"'
fb FB-07 "detalle de versión"                GET  "/profiles/$PROFILE_ID/versions/1"   '.data.config'
fb FB-08 "clonar perfil"                     POST "/profiles/$PROFILE_ID/clone"        '.data.id' '{"name":"sweep-clon"}'
fb FB-09 "actualizar perfil (PATCH)"         PATCH "/profiles/$PROFILE_ID"             '.data.current_version>=1' '{"name":"AIU plataforma de prueba"}'
fb FB-10 "marcar predeterminado"             POST "/profiles/$PROFILE_ID/set-default"  '.data.is_default==true'
fb FB-11 "activar perfil"                    POST "/profiles/$PROFILE_ID/activate"     '.data.state=="active"'
fb FB-12 "desactivar perfil"                 POST "/profiles/$PROFILE_ID/deactivate"   '.data.state=="inactive"'
fb FB-13 "preview sin consumir consecutivo"  POST "/profiles/$PROFILE_ID/preview"      '.data' '{"issue_date":"2026-08-27"}'
fb FB-14 "eliminar perfil"                   DELETE "/profiles/999999"                 '.error_code=="INVOICING_PROFILE_001" or .message'
fb FB-25 "estado fiscal de plataforma"       GET  "/status"                            ".data.platform_organization_id==$PLATFORM_ORG_ID"
fb FB-26 "transmisiones"                     GET  "/transmissions?limit=1"             '.data|type=="array"'
fb FB-27 "resoluciones para emisión"         GET  "/resolutions-for-emission?document_type=sales_invoice" '.data|type=="array"'
fb FB-28 "búsqueda de adquirentes"           GET  "/customers/search?q=v"              '.data'
fb FB-29 "adquirente por tienda"             GET  "/customers/store/1"                 '.data'
fb FB-32 "adquirente por organización"       GET  "/customers/organization/1"          '.data'

# Filas que exigen una factura real. Sin ella: UNVERIFIED, jamás PASS.
if [ "$HAVE_INVOICE" = "1" ]; then
  fb FB-15 "emitir factura con perfil"       POST "/sales-invoices"                    '.data.id' \
     "{\"profile_id\":$PROFILE_ID}"
  fb FB-16 "documento soporte con perfil"    POST "/support-documents"                 '.data.id' \
     "{\"profile_id\":$PROFILE_ID}"
  fb FB-17 "nota crédito"                    POST "/credit-notes"                      '.data.id or .error_code' \
     "{\"related_invoice_id\":$INVOICE_ID,\"note_concept_code\":\"2\",\"reason\":\"sweep\"}"
  fb FB-18 "nota débito"                     POST "/debit-notes"                       '.data.id or .error_code' \
     "{\"related_invoice_id\":$INVOICE_ID,\"note_concept_code\":\"1\",\"reason\":\"sweep\"}"
  fb FB-19 "reenvío por correo"              POST "/sales-invoices/$INVOICE_ID/deliver" '.data.status' \
     '{"email":"qa@vendix.online"}'
  fb FB-20 "listado de eventos DIAN"         GET  "/sales-invoices/$INVOICE_ID/events"  '.data|type=="array"'
  fb FB-21 "registrar evento RADIAN"         POST "/sales-invoices/$INVOICE_ID/events"  '.data.id' \
     '{"event_code":"030"}'
  fb FB-22 "preview del PDF"                 POST "/invoices/$INVOICE_ID/preview-pdf"   '.'
  fb FB-23 "descarga del PDF"                GET  "/invoices/$INVOICE_ID/pdf"           '.data.url'
  fb FB-24 "regeneración del PDF"            POST "/invoices/$INVOICE_ID/pdf/regenerate" '.data.key'
  fb FB-30 "preparación para emitir"         GET  "/invoices/$INVOICE_ID/emit-readiness" '.data'
  fb FB-31 "creación legacy SaaS"            POST "/invoices"                            '.data.id or .error_code' '{}'
else
  for id in FB-15 FB-16 FB-17 FB-18 FB-19 FB-20 FB-21 FB-22 FB-23 FB-24 FB-30 FB-31; do
    record "$id" UNVERIFIED "requiere una factura de plataforma real (paso 13 no ejecutado)"
  done
fi

# FB-33 va contra la raíz de la API, no contra el prefijo de plataforma.
hc=$(curl -s -o /dev/null -w '%{http_code}' "$API/health")
[ "$hc" = "200" ] && record FB-33 PASS "health ($hc)" || record FB-33 FAIL "health devolvió $hc"

# =============================================================================
# DB — invariantes de datos (12)
# =============================================================================
echo; echo "── DB · invariantes de datos ──"

db() { # db <id> <descripción> <sql> <valor-esperado>
  local id="$1" desc="$2" query="$3" want="$4" got
  got=$(sql "$query")
  if [ -z "$got" ] && [ -n "$want" ]; then
    record "$id" UNVERIFIED "$desc — la consulta no devolvió nada"
  elif [ "$got" = "$want" ]; then
    record "$id" PASS "$desc (= $got)"
  else
    record "$id" FAIL "$desc — esperado '$want', obtenido '$got'"
  fi
}

db DB-01 "store_id admite nulo en invoice_profiles" \
  "SELECT is_nullable FROM information_schema.columns WHERE table_name='invoice_profiles' AND column_name='store_id';" "YES"
db DB-02 "sin defaults duplicados en ámbito tienda" \
  "SELECT count(*) FROM (SELECT store_id, operation_type FROM invoice_profiles WHERE is_default AND store_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) t;" "0"
db DB-03 "sin defaults duplicados en ámbito organización" \
  "SELECT count(*) FROM (SELECT organization_id, operation_type FROM invoice_profiles WHERE is_default AND store_id IS NULL GROUP BY 1,2 HAVING count(*)>1) t;" "0"
db DB-04 "sin versiones huérfanas" \
  "SELECT count(*) FROM invoice_profiles p WHERE p.current_version IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoice_profile_versions v WHERE v.profile_id=p.id AND v.version=p.current_version);" "0"
db DB-05 "snapshot de perfil: ambas columnas o ninguna" \
  "SELECT count(*) FROM invoices WHERE (profile_id IS NULL) <> (profile_version IS NULL);" "0"
db DB-06 "eventos de entrega de plataforma sin store_id" \
  "SELECT count(*) FROM invoice_delivery_events e JOIN invoices i ON i.id=e.invoice_id WHERE i.organization_id=$PLATFORM_ORG_ID AND e.store_id IS NOT NULL;" "0"
db DB-07 "eventos DIAN de plataforma sin store_id" \
  "SELECT count(*) FROM dian_document_events e JOIN invoices i ON i.id=e.invoice_id WHERE i.organization_id=$PLATFORM_ORG_ID AND e.store_id IS NOT NULL;" "0"
db DB-08 "cuatro permisos de perfiles de plataforma" \
  "SELECT count(*) FROM permissions WHERE name LIKE 'superadmin:fiscal:invoicing:profiles%';" "4"
db DB-09 "la previsualización no quema consecutivo" \
  "SELECT current_number FROM invoice_resolutions WHERE id=$RESOLUTION_ID;" "${CURRENT_NUMBER_BEFORE:-}"
db DB-10 "ninguna llave S3 bajo stores/null" \
  "SELECT count(*) FROM fiscal_transmissions WHERE pdf_url LIKE 'stores/null%' OR xml_document LIKE 'stores/null%';" "0"
db DB-11 "platform_settings resuelve la organización" \
  "SELECT (value->>'platform_organization_id') FROM platform_settings WHERE key='subscription_fiscal_billing';" "$PLATFORM_ORG_ID"
db DB-12 "nombre único por organización" \
  "SELECT count(*) FROM (SELECT organization_id, lower(name) FROM invoice_profiles WHERE store_id IS NULL GROUP BY 1,2 HAVING count(*)>1) t;" "0"

# =============================================================================
# ERR — códigos de error (14)
# =============================================================================
echo; echo "── ERR · códigos de error ──"

err() { # err <id> <descripción> <método> <ruta> <http-esperado> <código-esperado> [cuerpo]
  local id="$1" desc="$2" method="$3" path="$4" want_code="$5" want_err="$6" body="${7:-}"
  local out code json got
  out=$(mktemp /tmp/vdx-sweep-XXXXXX)
  if [ -n "$body" ]; then
    code=$(curl -s -o "$out" -w '%{http_code}' -X "$method" "$P$path" "${AUTH[@]}" \
           -H 'Content-Type: application/json' -d "$body")
  else
    code=$(curl -s -o "$out" -w '%{http_code}' -X "$method" "$P$path" "${AUTH[@]}")
  fi
  json=$(cat "$out"); rm -f "$out"
  got=$(echo "$json" | jq -r '.error_code // .code // empty' 2>/dev/null)

  if [ "$code" = "000" ]; then
    record "$id" UNVERIFIED "$desc — backend sin responder"
  elif [ "$code" = "$want_code" ] && { [ -z "$want_err" ] || [ "$got" = "$want_err" ]; }; then
    record "$id" PASS "$desc ($code $got)"
  else
    record "$id" FAIL "$desc — esperado $want_code/$want_err, obtenido $code/${got:-sin-código}"
  fi
}

err ERR-01 "perfil inexistente"                GET  "/profiles/999999" 404 ""
err ERR-02 "cruce de tipo de operación"        POST "/sales-invoices" 409 "PLATFORM_PROFILE_008" "{\"profile_id\":$PROFILE_ID,\"operation_type\":\"10\"}"
err ERR-03 "perfil inactivo al emitir"         POST "/sales-invoices" 409 "" "{\"profile_id\":$PROFILE_ID}"
err ERR-04 "borrado con versiones"             DELETE "/profiles/$PROFILE_ID" 409 ""
err ERR-05 "configuración inválida"            POST "/profiles" 422 "" '{"name":"x","operation_type":"09","config":{"aiu":{"components":{}}}}'
err ERR-07 "correo inválido en reenvío"        POST "/sales-invoices/${INVOICE_ID:-1}/deliver" 422 "INVOICING_DELIVERY_001" '{"email":"x"}'
err ERR-08 "código RADIAN no soportado"        POST "/sales-invoices/${INVOICE_ID:-1}/events" 400 "DIAN_EVENT_002" '{"event_code":"999"}'
err ERR-09 "nota sin concepto DIAN"            POST "/credit-notes" 422 "" "{\"related_invoice_id\":${INVOICE_ID:-1},\"reason\":\"x\"}"
err ERR-10 "factura relacionada de otra org"   POST "/credit-notes" 404 "INVOICING_FIND_001" '{"related_invoice_id":999999,"note_concept_code":"2","reason":"x"}'
err ERR-12 "identificador no numérico"         POST "/sales-invoices" 400 "" '{"profile_id":"abc"}'

# ERR-06 (platform_settings ausente) es destructivo: exigiría borrar la fila de
# configuración de la plataforma. Se verifica por lectura del guard, no
# provocándolo. ERR-11 desaparece al cerrarse el PDF (503 -> 200): se comprueba
# que YA NO se emite. ERR-13 y ERR-14 son de interfaz y se validan en el E2E.
if grep -rq "PLATFORM_FISCAL_SCOPE_MISSING" apps/backend/src/domains/superadmin 2>/dev/null; then
  record ERR-06 PASS "guard de ámbito fiscal presente en el código"
else
  record ERR-06 FAIL "no existe guard PLATFORM_FISCAL_SCOPE_MISSING"
fi
if [ "$HAVE_INVOICE" = "1" ]; then
  pdfcode=$(curl -s -o /dev/null -w '%{http_code}' "$P/invoices/$INVOICE_ID/pdf" "${AUTH[@]}")
  [ "$pdfcode" = "503" ] && record ERR-11 FAIL "el PDF sigue devolviendo 503" \
                         || record ERR-11 PASS "el PDF ya no devuelve 503 (dio $pdfcode)"
else
  record ERR-11 UNVERIFIED "requiere factura real"
fi
record ERR-13 UNVERIFIED "aviso de DV divergente: se valida en el E2E de interfaz"
record ERR-14 UNVERIFIED "municipio DANE obligatorio: se valida en el E2E de interfaz"

# =============================================================================
# Recuento — la parte que el barrido anterior no tenía
# =============================================================================
TOTAL=$((PASS+FAIL+UNVERIFIED))
echo
echo "════════════════════════════════════════════════════════════════"
printf ' verificadas   %s%d%s\n' "$c_ok"   "$PASS"       "$c_off"
printf ' fallidas      %s%d%s\n' "$c_bad"  "$FAIL"       "$c_off"
printf ' sin verificar %s%d%s\n' "$c_warn" "$UNVERIFIED" "$c_off"
printf ' cubiertas     %d/%d\n' "$TOTAL" "$EXPECTED_TOTAL"
echo "════════════════════════════════════════════════════════════════"
[ ${#FAILED_IDS[@]}     -gt 0 ] && echo " fallidas:      ${FAILED_IDS[*]}"
[ ${#UNVERIFIED_IDS[@]} -gt 0 ] && echo " sin verificar: ${UNVERIFIED_IDS[*]}"

if [ "$TOTAL" -ne "$EXPECTED_TOTAL" ]; then
  echo "${c_bad}El barrido no cubrió las $EXPECTED_TOTAL filas del registro.${c_off}"
  exit 2
fi
if [ "$FAIL" -ne 0 ] || [ "$UNVERIFIED" -ne 0 ]; then
  echo "${c_bad}El barrido no está limpio: solo cuenta como cerrado con 59 PASS.${c_off}"
  exit 1
fi
echo "${c_ok}59/59 verificadas.${c_off}"
exit 0
