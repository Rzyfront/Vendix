#!/usr/bin/env bash
#
# Provisions the AWS KMS asymmetric key that holds a DIAN certificate's PRIVATE
# half, so the key material never leaves the HSM.
#
# WHY THIS IS A SCRIPT AND NOT A CONSOLE CLICK-THROUGH
#
#   A KMS key cannot be deleted — only *scheduled* for deletion with a 7–30 day
#   waiting period, and it bills for every day it exists. So the operation has to
#   be idempotent: running it twice must NOT create a second key. This script
#   looks the alias up first and exits cleanly when the key is already there.
#
# WHAT IT DOES NOT DO
#
#   It does not touch the database. The ARN is registered through the API
#   (PATCH the DIAN configuration with `certificate_kms_key_id`), because every
#   Vendix schema/row change goes through the app or a versioned migration —
#   never manual SQL.
#
#   It does not import your existing certificate's private key. See the note at
#   the bottom: that is a deliberate decision, not an omission.
#
# USAGE
#
#   ./scripts/provision-dian-kms-key.sh --dry-run
#   ./scripts/provision-dian-kms-key.sh --alias vendix-dian-signing
#   ./scripts/provision-dian-kms-key.sh --alias vendix-dian-signing --role-arn arn:aws:iam::...:role/vendix-backend
#
set -euo pipefail

ALIAS_NAME="vendix-dian-signing"
REGION="${AWS_REGION:-us-east-1}"
KEY_SPEC="RSA_2048"
ROLE_ARN=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --alias)     ALIAS_NAME="$2"; shift 2 ;;
    --region)    REGION="$2"; shift 2 ;;
    --key-spec)  KEY_SPEC="$2"; shift 2 ;;
    --role-arn)  ROLE_ARN="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    -h|--help)   sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

case "$KEY_SPEC" in
  RSA_2048|RSA_3072|RSA_4096) ;;
  *) echo "ERROR: key-spec debe ser RSA_2048, RSA_3072 o RSA_4096 (la DIAN firma con RSA)." >&2; exit 2 ;;
esac

echo "══ Aprovisionamiento de clave KMS para firma DIAN ══"
echo "  Región    : $REGION"
echo "  Alias     : alias/$ALIAS_NAME"
echo "  KeySpec   : $KEY_SPEC"
echo "  Uso       : SIGN_VERIFY  ·  Origin: AWS_KMS (no exportable)"
echo

IDENTITY="$(aws sts get-caller-identity --output json)"
ACCOUNT_ID="$(echo "$IDENTITY" | grep -o '"Account": *"[0-9]*"' | grep -o '[0-9]\{12\}')"
CALLER_ARN="$(echo "$IDENTITY" | sed -n 's/.*"Arn": *"\([^"]*\)".*/\1/p')"
echo "  Cuenta    : $ACCOUNT_ID"
echo "  Invocante : $CALLER_ARN"
echo

# ── Idempotencia: si el alias ya existe, no se crea nada. ────────────────────
EXISTING_KEY_ID="$(aws kms describe-key \
    --key-id "alias/$ALIAS_NAME" \
    --region "$REGION" \
    --query 'KeyMetadata.KeyId' \
    --output text 2>/dev/null || true)"

if [[ -n "$EXISTING_KEY_ID" && "$EXISTING_KEY_ID" != "None" ]]; then
  EXISTING_ARN="$(aws kms describe-key --key-id "alias/$ALIAS_NAME" --region "$REGION" \
      --query 'KeyMetadata.Arn' --output text)"
  EXISTING_SPEC="$(aws kms describe-key --key-id "alias/$ALIAS_NAME" --region "$REGION" \
      --query 'KeyMetadata.KeySpec' --output text)"
  EXISTING_USAGE="$(aws kms describe-key --key-id "alias/$ALIAS_NAME" --region "$REGION" \
      --query 'KeyMetadata.KeyUsage' --output text)"

  echo "✔ La clave YA EXISTE — no se crea nada (este script es idempotente)."
  echo "  ARN   : $EXISTING_ARN"
  echo "  Spec  : $EXISTING_SPEC  ·  Uso: $EXISTING_USAGE"
  echo

  if [[ "$EXISTING_USAGE" != "SIGN_VERIFY" ]]; then
    echo "⚠ ADVERTENCIA: el uso de esta clave es '$EXISTING_USAGE', no SIGN_VERIFY."
    echo "  No sirve para firmar. Usa otro --alias." >&2
    exit 1
  fi

  echo "Registra el ARN en la configuración DIAN (NO con SQL manual):"
  echo "  PATCH /store/invoicing/dian-config/<id>  { \"certificate_kms_key_id\": \"$EXISTING_ARN\" }"
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "── DRY RUN — no se ejecuta ninguna acción ──"
  echo "Se crearía:"
  echo "  1. aws kms create-key --key-spec $KEY_SPEC --key-usage SIGN_VERIFY --origin AWS_KMS"
  echo "  2. aws kms create-alias --alias-name alias/$ALIAS_NAME"
  echo
  echo "COSTO: una clave asimétrica de KMS cuesta ~1 USD/mes más las peticiones"
  echo "       de firma. NO se puede borrar: solo programar su eliminación con"
  echo "       7 a 30 días de espera. Por eso este paso requiere decisión humana."
  exit 0
fi

echo "── Creando la clave ──"
KEY_ARN="$(aws kms create-key \
  --description "Vendix — firma de documentos electrónicos DIAN (XAdES + WS-Security). Clave privada no exportable." \
  --key-spec "$KEY_SPEC" \
  --key-usage SIGN_VERIFY \
  --origin AWS_KMS \
  --tags TagKey=Project,TagValue=Vendix TagKey=Purpose,TagValue=dian-signing \
  --region "$REGION" \
  --query 'KeyMetadata.Arn' \
  --output text)"

echo "✔ Clave creada: $KEY_ARN"

aws kms create-alias \
  --alias-name "alias/$ALIAS_NAME" \
  --target-key-id "$KEY_ARN" \
  --region "$REGION"
echo "✔ Alias creado: alias/$ALIAS_NAME"
echo

# ── Política IAM que necesita la tarea del backend ──────────────────────────
echo "── Permisos que necesita el backend ──"
echo "Adjunta esta política al rol de la tarea/instancia que corre vendix_backend:"
echo
cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VendixDianSigning",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": "$KEY_ARN"
    }
  ]
}
JSON
echo
echo "  kms:Sign        — la operación de firma en sí."
echo "  kms:GetPublicKey— permite verificar que la clave corresponde al certificado."
echo "  kms:DescribeKey — diagnóstico; sin él un error de configuración es opaco."
echo "  NO se concede kms:Decrypt ni kms:CreateGrant: esta clave solo firma."
echo

if [[ -n "$ROLE_ARN" ]]; then
  echo "── Concediendo acceso a $ROLE_ARN vía política de clave ──"
  echo "  (revisa la política resultante antes de confiar en ella)"
  aws kms get-key-policy --key-id "$KEY_ARN" --policy-name default \
    --region "$REGION" --query Policy --output text > /tmp/vendix-kms-policy.json
  echo "  Política actual guardada en /tmp/vendix-kms-policy.json"
  echo "  Edítala para añadir a $ROLE_ARN y aplícala con:"
  echo "    aws kms put-key-policy --key-id $KEY_ARN --policy-name default \\"
  echo "      --policy file:///tmp/vendix-kms-policy.json --region $REGION"
fi

echo
echo "── Último paso (por API, nunca con SQL manual) ──"
echo "  PATCH /store/invoicing/dian-config/<id>"
echo "    { \"certificate_kms_key_id\": \"$KEY_ARN\" }"
echo
echo "  Para VOLVER a la custodia en proceso, envía la cadena vacía:"
echo "    { \"certificate_kms_key_id\": \"\" }"
echo
echo "── Sobre el certificado que ya tienes ──"
echo "  Esta clave es NUEVA: su mitad privada nace dentro del HSM y por eso no es"
echo "  exportable. La clave privada de un .p12 existente NO se puede meter en KMS"
echo "  conservando esa propiedad de forma útil — habría que importarla, y una"
echo "  clave que ya salió de su origen deja de ser 'no exportable' en el sentido"
echo "  que importa. Lo correcto es emitir un certificado NUEVO ante la entidad"
echo "  certificadora (Certicámara, Thomas Signe, ...) generando el CSR contra"
echo "  esta clave de KMS: la mitad privada nunca existe fuera del HSM, ni durante"
echo "  la emisión."
echo
echo "  Obtén la clave pública para armar el CSR con:"
echo "    aws kms get-public-key --key-id $KEY_ARN --region $REGION \\"
echo "      --query PublicKey --output text | base64 -d > vendix-dian.der"
