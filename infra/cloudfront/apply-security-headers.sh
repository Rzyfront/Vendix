#!/usr/bin/env bash
# SEO-TECH-22: cabeceras de seguridad (HSTS, nosniff, Referrer-Policy) vía Response Headers Policy de CloudFront.
# Uso:
#   ./apply-security-headers.sh test       valida el JSON y muestra lo que haría (no usa AWS, no toca nada)
#   ./apply-security-headers.sh baseline   guarda las cabeceras actuales en .work/headers-baseline-<DIST_ID>.txt
#   ./apply-security-headers.sh apply      crea/actualiza la policy, respalda la distribución y la asocia a los comportamientos
#   ./apply-security-headers.sh verify     compara las cabeceras actuales contra la línea base
#   ./apply-security-headers.sh rollback   restaura el último respaldo de la distribución
#
# Variables: DIST_ID (por defecto E1I27OYFJX7VYJ) y HOSTS (dominios a revisar, por defecto vendix.online).
# Ver README-security-headers.md.
set -euo pipefail

DIST_ID="${DIST_ID:-E1I27OYFJX7VYJ}"
HOSTS="${HOSTS:-vendix.online}"
DIR="$(cd "$(dirname "$0")" && pwd)"
POLICY_JSON="$DIR/security-headers-policy.json"
WORK="$DIR/.work"
mkdir -p "$WORK"
export AWS_PAGER=""

PATHS=(/ /robots.txt /sitemap.xml /favicon.ico)
URLS=()
for h in $HOSTS; do for p in "${PATHS[@]}"; do URLS+=("https://$h$p"); done; done
BASELINE="$WORK/headers-baseline-$DIST_ID.txt"
HDRS="strict-transport-security x-content-type-options referrer-policy"

policy_name() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["Name"])' "$POLICY_JSON"; }

validate_json() {
  python3 -I - "$POLICY_JSON" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
s = c["SecurityHeadersConfig"]
errs = []
if not c.get("Name"): errs.append("falta Name")
h = s.get("StrictTransportSecurity", {})
if h.get("AccessControlMaxAgeSec", 0) < 300: errs.append("HSTS max-age demasiado bajo")
if h.get("IncludeSubdomains") is not False: errs.append("IncludeSubdomains debe ser false en esta fase")
if h.get("Preload") is not False: errs.append("Preload debe ser false en esta fase")
if not h.get("Override"): errs.append("HSTS Override debe ser true")
if not s.get("ContentTypeOptions", {}).get("Override"): errs.append("ContentTypeOptions.Override debe ser true")
if not s.get("ReferrerPolicy", {}).get("ReferrerPolicy"): errs.append("falta ReferrerPolicy")
for prohibido in ("FrameOptions", "ContentSecurityPolicy", "XSSProtection"):
    if prohibido in s: errs.append(prohibido + " no debe ir en esta policy (ver README)")
if errs:
    print("✘ JSON inválido:"); [print("  -", e) for e in errs]; sys.exit(1)
print("✔ JSON válido. Cabeceras que añadirá:")
print("  Strict-Transport-Security: max-age=%d (sin includeSubDomains, sin preload)" % h["AccessControlMaxAgeSec"])
print("  X-Content-Type-Options: nosniff")
print("  Referrer-Policy: " + s["ReferrerPolicy"]["ReferrerPolicy"])
PY
}

snapshot() {
  for u in "${URLS[@]}"; do
    hdrs=$(curl -sI --max-time 20 "$u" || true)
    for h in $HDRS; do
      v=$(printf '%s' "$hdrs" | tr -d '\r' | awk -v h="$h" 'tolower($1)==h":"{sub(/^[^:]*: */,""); print; exit}')
      printf '%s | %s | %s\n' "$u" "$h" "${v:-(ausente)}"
    done
  done
}

# Devuelve el Id de la policy personalizada con ese nombre (vacío si no existe).
find_policy_id() {
  aws cloudfront list-response-headers-policies --type custom \
    --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$(policy_name)'].ResponseHeadersPolicy.Id | [0]" \
    --output text | sed 's/^None$//'
}

case "${1:-test}" in
  test)
    validate_json
    echo "→ En 'apply' haría, sobre la distribución $DIST_ID:"
    echo "  1. Crear (o actualizar) la Response Headers Policy '$(policy_name)' desde $(basename "$POLICY_JSON")"
    echo "  2. Respaldar la configuración en $WORK/dist-backup-sechdr-<fecha>.json"
    echo "  3. Asociar ResponseHeadersPolicyId al DefaultCacheBehavior y a cada CacheBehavior"
    echo "     (aborta sin cambios si alguno ya tiene otra policy)"
    echo "  4. Esperar a que la distribución quede Deployed"
    echo "  URLs de baseline/verify: ${URLS[*]}"
    ;;

  baseline)
    snapshot | tee "$BASELINE"
    echo "✔ Línea base guardada en $BASELINE"
    ;;

  apply)
    validate_json >/dev/null || { validate_json; exit 1; }
    [ -f "$BASELINE" ] || { echo "✘ Falta la línea base. Corre primero: $0 baseline"; exit 1; }

    POLICY_ID=$(find_policy_id)
    if [ -n "$POLICY_ID" ]; then
      echo "→ Actualizando policy $(policy_name) ($POLICY_ID)"
      PETAG=$(aws cloudfront get-response-headers-policy --id "$POLICY_ID" --query ETag --output text)
      aws cloudfront update-response-headers-policy --id "$POLICY_ID" --if-match "$PETAG" \
        --response-headers-policy-config "file://$POLICY_JSON" >/dev/null
    else
      echo "→ Creando policy $(policy_name)"
      POLICY_ID=$(aws cloudfront create-response-headers-policy \
        --response-headers-policy-config "file://$POLICY_JSON" --query 'ResponseHeadersPolicy.Id' --output text)
    fi
    echo "  Policy Id: $POLICY_ID (aún sin asociar: no afecta el tráfico)"

    echo "→ Leyendo configuración de la distribución $DIST_ID"
    aws cloudfront get-distribution-config --id "$DIST_ID" > "$WORK/dist.json"
    ts=$(date +%Y%m%d-%H%M%S)
    cp "$WORK/dist.json" "$WORK/dist-backup-sechdr-$ts.json"
    echo "  Respaldo: $WORK/dist-backup-sechdr-$ts.json"

    echo "→ Validando los comportamientos antes de publicar"
    rc=0
    python3 -I - "$WORK/dist.json" "$WORK/dist-new.json" "$POLICY_ID" <<'PY' || rc=$?
import json, sys
src, dst, pid = sys.argv[1:4]
cfg = json.load(open(src))["DistributionConfig"]
behaviors = [("DefaultCacheBehavior (*)", cfg["DefaultCacheBehavior"])]
behaviors += [(b.get("PathPattern", "?"), b) for b in cfg.get("CacheBehaviors", {}).get("Items", [])]
otros = [(n, b["ResponseHeadersPolicyId"]) for n, b in behaviors
         if b.get("ResponseHeadersPolicyId") and b["ResponseHeadersPolicyId"] != pid]
if otros:
    print("✘ Estos comportamientos ya tienen OTRA Response Headers Policy; no se toca nada:")
    for n, p in otros: print("   -", n, "->", p)
    print("  Decide con Rafa si se reemplaza o se agregan las cabeceras a esa policy.")
    sys.exit(2)
pendientes = [b for _, b in behaviors if b.get("ResponseHeadersPolicyId") != pid]
if not pendientes:
    print("  Ya estaba asociada en todos los comportamientos; nada que cambiar."); sys.exit(3)
for b in pendientes: b["ResponseHeadersPolicyId"] = pid
print("  Se asociará a %d de %d comportamientos." % (len(pendientes), len(behaviors)))
json.dump(cfg, open(dst, "w"))
PY
    if [ $rc -eq 3 ]; then echo "✔ Policy actualizada; se propaga en unos minutos. Corre: $0 verify"; exit 0; fi
    [ $rc -ne 0 ] && { echo "  No se modificó la distribución."; exit $rc; }

    ETAG=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$WORK/dist.json")
    echo "→ Actualizando la distribución"
    aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
      --distribution-config "file://$WORK/dist-new.json" --query 'Distribution.Status' --output text
    echo "→ Esperando a que se propague (puede tardar 3-15 min)…"
    aws cloudfront wait distribution-deployed --id "$DIST_ID"
    echo "✔ Desplegado. Corre: $0 verify"
    ;;

  verify)
    [ -f "$BASELINE" ] || { echo "✘ No hay línea base para comparar."; exit 1; }
    snapshot > "$WORK/headers-after-$DIST_ID.txt"
    echo "--- ANTES ---";   cat "$BASELINE"
    echo "--- DESPUÉS ---"; cat "$WORK/headers-after-$DIST_ID.txt"
    if grep -q '(ausente)' "$WORK/headers-after-$DIST_ID.txt"; then
      echo "✘ Siguen ausentes las cabeceras marcadas arriba (¿propagación pendiente o ruta que no pasa por la policy?)."
      exit 1
    fi
    grep -qi 'strict-transport-security | max-age=31536000$' "$WORK/headers-after-$DIST_ID.txt" \
      || { echo "✘ HSTS no tiene el valor esperado (max-age=31536000 sin includeSubDomains)."; exit 1; }
    echo "✔ Todas las URLs devuelven HSTS, nosniff y Referrer-Policy."
    ;;

  rollback)
    B=$(ls -1t "$WORK"/dist-backup-sechdr-*.json 2>/dev/null | head -1 || true)
    [ -n "$B" ] || { echo "✘ No hay respaldo dist-backup-sechdr-*.json en $WORK."; exit 1; }
    echo "→ Restaurando $B en $DIST_ID"
    aws cloudfront get-distribution-config --id "$DIST_ID" > "$WORK/dist.json"
    cp "$WORK/dist.json" "$WORK/dist-backup-rollback-$(date +%Y%m%d-%H%M%S).json"
    python3 -I - "$B" "$WORK/dist-new.json" <<'PY'
import json, sys
json.dump(json.load(open(sys.argv[1]))["DistributionConfig"], open(sys.argv[2], "w"))
PY
    ETAG=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$WORK/dist.json")
    aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
      --distribution-config "file://$WORK/dist-new.json" --query 'Distribution.Status' --output text
    aws cloudfront wait distribution-deployed --id "$DIST_ID"
    echo "✔ Distribución restaurada. La policy queda creada pero sin asociar (inofensiva)."
    echo "  Nota: los navegadores que ya vieron HSTS lo recuerdan hasta max-age; ver README."
    ;;

  *) echo "Uso: $0 {test|baseline|apply|verify|rollback}"; exit 1 ;;
esac
