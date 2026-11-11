#!/usr/bin/env bash
# Uso:
#   ./apply-spa-rewrite.sh test       crea/actualiza la función y la prueba (no toca la distribución)
#   ./apply-spa-rewrite.sh baseline   guarda los códigos HTTP actuales en .work/baseline-<DIST_ID>.txt (antes de aplicar)
#
# Variables: DIST_ID (por defecto E1I27OYFJX7VYJ) y HOSTS (dominios a revisar, por defecto vendix.online).
#   ./apply-spa-rewrite.sh apply      valida la distribución, publica la función y la asocia al comportamiento (*)
#   ./apply-spa-rewrite.sh verify     compara los códigos HTTP actuales contra la línea base
#   ./apply-spa-rewrite.sh rollback   quita la asociación (deja la distribución como estaba)
#     Ojo: si la función ya estaba asociada y solo se publicó código nuevo, 'rollback' quita TODA la
#     reescritura SPA. Para deshacer solo el código, publica la versión anterior de spa-rewrite.js
#     (git) con 'test' + 'apply'.
set -euo pipefail

DIST_ID="${DIST_ID:-E1I27OYFJX7VYJ}"
FN_NAME="vendix-spa-rewrite"
DIR="$(cd "$(dirname "$0")" && pwd)"
CODE="$DIR/spa-rewrite.js"
WORK="$DIR/.work"
mkdir -p "$WORK"
export AWS_PAGER=""

fn_etag() { aws cloudfront describe-function --name "$FN_NAME" --stage DEVELOPMENT --query ETag --output text; }

create_or_update() {
  if aws cloudfront describe-function --name "$FN_NAME" >/dev/null 2>&1; then
    echo "→ Actualizando función $FN_NAME"
    aws cloudfront update-function --name "$FN_NAME" --if-match "$(fn_etag)" \
      --function-config "Comment=SPA rewrite a /index.html para rutas sin extension,Runtime=cloudfront-js-2.0" \
      --function-code "fileb://$CODE" >/dev/null
  else
    echo "→ Creando función $FN_NAME"
    aws cloudfront create-function --name "$FN_NAME" \
      --function-config "Comment=SPA rewrite a /index.html para rutas sin extension,Runtime=cloudfront-js-2.0" \
      --function-code "fileb://$CODE" >/dev/null
  fi
}

# HOSTS: dominios a revisar en baseline/verify (separados por espacio).
# Por defecto, vendix.online. Para la distribución multi-tenant, pasar los dominios de sus tenants.
HOSTS="${HOSTS:-vendix.online}"
PATHS=(/legal/privacidad /legal/terminos / /ayuda /favicon.ico /no-existe.js /robots.txt /sitemap.xml /manifest.webmanifest /pwa/no-existe /precios /ruta-que-no-existe-seo-smoke /auth/login)
URLS=()
for h in $HOSTS; do for p in "${PATHS[@]}"; do URLS+=("https://$h$p"); done; done
BASELINE="$WORK/baseline-$DIST_ID.txt"

snapshot() {
  for u in "${URLS[@]}"; do
    printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"
  done
}

run_tests() {
  local fail=0
  # Cada caso: uri, resultado esperado y host opcional (por defecto vendix.online).
  # Un resultado "301:<url>" espera una redirección; si no, la uri reescrita.
  while read -r uri expected host; do
    [ -z "$uri" ] && continue
    host="${host:-vendix.online}"
    printf '{"version":"1.0","context":{"eventType":"viewer-request"},"viewer":{"ip":"1.2.3.4"},"request":{"method":"GET","uri":"%s","querystring":{},"headers":{"host":{"value":"%s"}},"cookies":{}}}' "$uri" "$host" > "$WORK/event.json"
    out=$(aws cloudfront test-function --name "$FN_NAME" --if-match "$(fn_etag)" --stage DEVELOPMENT \
      --event-object "fileb://$WORK/event.json" --query 'TestResult.FunctionOutput' --output text)
    got=$(printf '%s' "$out" | python3 -c 'import json,sys
o=json.load(sys.stdin)
r=o.get("response")
print("%s:%s" % (r["statusCode"], r["headers"]["location"]["value"]) if r else o["request"]["uri"])')
    if [ "$got" = "$expected" ]; then echo "  OK   $host$uri -> $got"; else echo "  FAIL $host$uri -> $got (esperado $expected)"; fail=1; fi
  done <<'CASES'
/legal/privacidad /index.html
/legal/terminos /index.html
/admin/ventas /noindex/index.html
/productos/aceite-1.5l /index.html
/catalog/aceite-1.5l /index.html
/products/aceite-1.5l /index.html
/order/0b6f5c1e-2d3a-4e5f-8a9b-1c2d3e4f5a6b /index.html
/pedido/0b6f5c1e-2d3a-4e5f-8a9b-1c2d3e4f5a6b /index.html
/seguimiento-servicio/AbC_d-123 /index.html
/ /marketing/index.html
/main-ABC123.js /main-ABC123.js
/assets/logo.png /assets/logo.png
/favicon.ico /favicon.ico
/google002d194fa98388f5.html /google002d194fa98388f5.html
/.well-known/apple-app-site-association /.well-known/apple-app-site-association
/precios 301:https://vendix.online/pricing
/pricing 301:https://vendix.online/pricing www.vendix.online
/precios /index.html tienda-demo.vendix.online
/precios /index.html midominio.com
/ 301:https://mesura.beauty/ www.mesura.beauty
/productos/labial-rojo 301:https://mesura.beauty/productos/labial-rojo www.mesura.beauty
/ /index.html mesura.beauty
/ /index.html www.tienda.vendix.online
/.well-known/acme-challenge/x /.well-known/acme-challenge/x www.mesura.beauty
/ruta-que-no-existe-seo-smoke /ruta-que-no-existe-seo-smoke
/auth/login /noindex/index.html
/pqr/consultar/T-123 /noindex/index.html
/super-admin/dashboard /noindex/index.html
/ruta-que-no-existe-seo-smoke /index.html tienda-demo.vendix.online
/cart /noindex/index.html tienda-demo.vendix.online
/checkout /noindex/index.html mesura.beauty
/pedido/0b6f5c1e-2d3a-4e5f-8a9b-1c2d3e4f5a6b /noindex/index.html tienda-demo.vendix.online
/catalog /index.html tienda-demo.vendix.online
/ayuda /noindex/index.html
CASES
  return $fail
}

case "${1:-test}" in
  test)
    create_or_update
    echo "→ Probando la función (etapa DEVELOPMENT, no afecta tráfico):"
    run_tests && echo "✔ Todas las pruebas pasaron. Siguiente paso: ./apply-spa-rewrite.sh apply"
    ;;

  baseline)
    snapshot | tee "$BASELINE"
    echo "✔ Línea base guardada en $BASELINE"
    ;;

  apply)
    [ -f "$BASELINE" ] || { echo "✘ Falta la línea base. Corre primero: $0 baseline"; exit 1; }
    run_tests >/dev/null || { echo "✘ Las pruebas no pasan; corre 'test' primero."; exit 1; }
    # SEO-TECH-02/04: la función apunta a objetos que sube el deploy del frontend. Si no existen,
    # / o las rutas noindex responderían error: primero el deploy, después la función.
    for obj in /marketing/index.html /noindex/index.html; do
      code=$(curl -s -o /dev/null -w '%{http_code}' "https://vendix.online$obj")
      [ "$code" = "200" ] || { echo "✘ https://vendix.online$obj responde $code. Despliega el frontend antes de aplicar la función."; exit 1; }
    done

    # El ARN es el mismo en DEVELOPMENT y LIVE, así que se puede validar antes de publicar.
    FN_ARN=$(aws cloudfront describe-function --name "$FN_NAME" --stage DEVELOPMENT --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)

    echo "→ Leyendo configuración de la distribución $DIST_ID"
    aws cloudfront get-distribution-config --id "$DIST_ID" > "$WORK/dist.json"
    ts=$(date +%Y%m%d-%H%M%S)
    cp "$WORK/dist.json" "$WORK/dist-backup-$ts.json"
    echo "  Respaldo: $WORK/dist-backup-$ts.json"

    echo "→ Validando el comportamiento (*) antes de publicar"
    rc=0
    python3 - "$WORK/dist.json" "$WORK/dist-new.json" "$FN_ARN" <<'PY' || rc=$?
import json, sys
src, dst, arn = sys.argv[1:4]
cfg = json.load(open(src))["DistributionConfig"]
fa = cfg["DefaultCacheBehavior"].setdefault("FunctionAssociations", {"Quantity": 0})
items = fa.get("Items", [])
for it in items:
    if it["EventType"] == "viewer-request":
        if it["FunctionARN"] == arn:
            print("  Ya estaba asociada; nada que cambiar."); sys.exit(3)
        print("✘ El comportamiento (*) ya tiene otra función viewer-request:", it["FunctionARN"]); sys.exit(2)
lam = cfg["DefaultCacheBehavior"].get("LambdaFunctionAssociations", {}).get("Items", [])
if any(l["EventType"] == "viewer-request" for l in lam):
    print("✘ El comportamiento (*) ya tiene una Lambda@Edge viewer-request."); sys.exit(2)
items.append({"FunctionARN": arn, "EventType": "viewer-request"})
fa["Items"] = items
fa["Quantity"] = len(items)
json.dump(cfg, open(dst, "w"))
PY
    if [ $rc -eq 3 ]; then
      # Ya asociada: la distribución usa la etapa LIVE de la función, así que
      # basta con publicar para que un cambio en spa-rewrite.js llegue al tráfico.
      echo "→ La función ya está asociada. Publicando el código actual (DEVELOPMENT → LIVE)"
      aws cloudfront publish-function --name "$FN_NAME" --if-match "$(fn_etag)" >/dev/null
      echo "✔ Código LIVE actualizado. Se propaga en unos minutos; corre: $0 verify"
      exit 0
    fi
    [ $rc -ne 0 ] && { echo "  No se publicó nada."; exit $rc; }

    echo "→ Publicando función"
    aws cloudfront publish-function --name "$FN_NAME" --if-match "$(fn_etag)" >/dev/null

    ETAG=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$WORK/dist.json")
    echo "→ Asociando la función al comportamiento (*)"
    if ! aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
      --distribution-config "file://$WORK/dist-new.json" --query 'Distribution.Status' --output text; then
      echo "✘ Falló la asociación. La función quedó publicada (LIVE) pero sin asociar: no afecta el tráfico."
      exit 1
    fi
    echo "→ Esperando a que se propague (puede tardar 3-10 min)…"
    aws cloudfront wait distribution-deployed --id "$DIST_ID"
    echo "✔ Desplegado. Corre: $0 verify"
    ;;

  verify)
    [ -f "$BASELINE" ] || { echo "✘ No hay línea base para comparar."; exit 1; }
    snapshot > "$WORK/after-$DIST_ID.txt"
    echo "  ANTES  DESPUÉS  URL"
    paste -d' ' "$BASELINE" "$WORK/after-$DIST_ID.txt" | awk '{printf "  %s    %s     %s\n", $1, $3, $2}'
    echo "  Esperado: privacidad, términos y / pasan a 200; favicon igual; robots.txt, sitemap.xml y manifest igual que antes."
    echo "  /ruta-que-no-existe-seo-smoke: pasa de 200 a 404 (SEO-TECH-03); /auth/login sigue en 200."
    echo "  /no-existe.js: debe quedar IGUAL que antes (404 si el bucket permite ListBucket; si antes ya era 200, lo causa la regla 403 → /index.html existente, no la función)."
    ;;

  rollback)
    echo "→ Quitando la función del comportamiento (*) de $DIST_ID"
    aws cloudfront get-distribution-config --id "$DIST_ID" > "$WORK/dist.json"
    ts=$(date +%Y%m%d-%H%M%S)
    cp "$WORK/dist.json" "$WORK/dist-backup-rollback-$ts.json"
    echo "  Respaldo: $WORK/dist-backup-rollback-$ts.json"
    python3 - "$WORK/dist.json" "$WORK/dist-new.json" "$FN_NAME" <<'PY'
import json, sys
src, dst, name = sys.argv[1:4]
cfg = json.load(open(src))["DistributionConfig"]
fa = cfg["DefaultCacheBehavior"].get("FunctionAssociations", {"Quantity": 0})
items = [i for i in fa.get("Items", []) if not i["FunctionARN"].endswith("/" + name)]
cfg["DefaultCacheBehavior"]["FunctionAssociations"] = {"Quantity": len(items), **({"Items": items} if items else {})}
json.dump(cfg, open(dst, "w"))
PY
    ETAG=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$WORK/dist.json")
    aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
      --distribution-config "file://$WORK/dist-new.json" --query 'Distribution.Status' --output text
    aws cloudfront wait distribution-deployed --id "$DIST_ID"
    echo "✔ Asociación quitada."
    ;;

  *) echo "Uso: $0 {test|baseline|apply|verify|rollback}"; exit 1 ;;
esac
