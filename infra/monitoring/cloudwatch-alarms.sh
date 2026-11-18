#!/usr/bin/env bash
# QUI-1010 — Alarmas de CloudWatch + tema SNS para la infraestructura de Vendix.
#
# Complementa al bot de monitoreo de la API (Telegram, correo y ticket): el bot
# vive DENTRO del backend y no puede avisar si se cae el host entero, la base
# de datos o el propio proceso. Estas alarmas miran desde AWS.
#
# Por defecto SOLO IMPRIME los comandos (simulación). Para ejecutarlos:
#   APPLY=1 ./infra/monitoring/cloudwatch-alarms.sh
# Ver infra/monitoring/README.md antes de aplicar. Nunca guarda secretos.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${ALARM_PREFIX:-vendix-production}"
TOPIC_NAME="${SNS_TOPIC_NAME:-${PREFIX}-alerts}"
# Correo de soporte que recibe las alarmas (confirmar la suscripción desde el correo).
ALERT_EMAIL="${ALERT_EMAIL:-}"
# Recursos: se descubren con la CLI si no se pasan (no se fijan ids en el repo).
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-}"
EC2_NAME_TAG="${EC2_NAME_TAG:-vendix-production}"
RDS_INSTANCE_ID="${RDS_INSTANCE_ID:-}"
# Umbrales
EC2_CPU_PCT="${EC2_CPU_PCT:-85}"
RDS_CPU_PCT="${RDS_CPU_PCT:-85}"
RDS_FREE_STORAGE_GB="${RDS_FREE_STORAGE_GB:-5}"
RDS_FREE_MEMORY_MB="${RDS_FREE_MEMORY_MB:-256}"
RDS_MAX_CONNECTIONS="${RDS_MAX_CONNECTIONS:-80}"

APPLY="${APPLY:-0}"

run() {
  if [[ "$APPLY" == "1" ]]; then
    "$@"
  else
    printf '[simulación] '
    printf '%q ' "$@"
    printf '\n'
  fi
}

say() { printf '\n== %s\n' "$*"; }

if [[ "$APPLY" == "1" ]]; then
  say "Modo APLICAR en ${REGION}: se crearán/actualizarán recursos en AWS"
else
  say "Modo SIMULACIÓN: no se toca AWS (exporta APPLY=1 para aplicar)"
fi

# --- Descubrimiento (solo lectura) -------------------------------------------
if [[ -z "$EC2_INSTANCE_ID" ]] && command -v aws >/dev/null 2>&1; then
  EC2_INSTANCE_ID="$(aws ec2 describe-instances --region "$REGION" \
    --filters "Name=tag:Name,Values=${EC2_NAME_TAG}" "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)"
  [[ "$EC2_INSTANCE_ID" == "None" ]] && EC2_INSTANCE_ID=""
fi
if [[ -z "$RDS_INSTANCE_ID" ]] && command -v aws >/dev/null 2>&1; then
  RDS_INSTANCE_ID="$(aws rds describe-db-instances --region "$REGION" \
    --query 'DBInstances[0].DBInstanceIdentifier' --output text 2>/dev/null || true)"
  [[ "$RDS_INSTANCE_ID" == "None" ]] && RDS_INSTANCE_ID=""
fi
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-<EC2_INSTANCE_ID>}"
RDS_INSTANCE_ID="${RDS_INSTANCE_ID:-<RDS_INSTANCE_ID>}"
echo "EC2: ${EC2_INSTANCE_ID} · RDS: ${RDS_INSTANCE_ID}"

if [[ "$APPLY" == "1" && ( "$EC2_INSTANCE_ID" == "<"* || "$RDS_INSTANCE_ID" == "<"* ) ]]; then
  echo "Faltan EC2_INSTANCE_ID o RDS_INSTANCE_ID; abortando sin cambios." >&2
  exit 1
fi

# --- Tema SNS --------------------------------------------------------------------
say "Tema SNS ${TOPIC_NAME}"
if [[ "$APPLY" == "1" ]]; then
  TOPIC_ARN="$(aws sns create-topic --region "$REGION" --name "$TOPIC_NAME" --query TopicArn --output text)"
else
  run aws sns create-topic --region "$REGION" --name "$TOPIC_NAME"
  TOPIC_ARN="arn:aws:sns:${REGION}:<ACCOUNT_ID>:${TOPIC_NAME}"
fi
if [[ -n "$ALERT_EMAIL" ]]; then
  run aws sns subscribe --region "$REGION" --topic-arn "$TOPIC_ARN" \
    --protocol email --notification-endpoint "$ALERT_EMAIL"
else
  echo "Sin ALERT_EMAIL: no se crea suscripción por correo."
fi

alarm() {
  # alarm <nombre> <descripción> <namespace> <métrica> <dimensión=valor> <estadística> <comparador> <umbral> <periodos> [datos faltantes]
  local name="$1" description="$2" namespace="$3" metric="$4" dimension="$5" stat="$6" op="$7" threshold="$8" periods="$9"
  local missing="${10:-notBreaching}"
  run aws cloudwatch put-metric-alarm --region "$REGION" \
    --alarm-name "${PREFIX}-${name}" \
    --alarm-description "QUI-1010: ${description}" \
    --namespace "$namespace" --metric-name "$metric" \
    --dimensions "Name=${dimension%%=*},Value=${dimension#*=}" \
    --statistic "$stat" --period 300 --evaluation-periods "$periods" \
    --threshold "$threshold" --comparison-operator "$op" \
    --treat-missing-data "$missing" \
    --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN"
}

say "Alarmas EC2 (${EC2_INSTANCE_ID})"
alarm ec2-status-check "El host del backend falla su chequeo de estado" \
  AWS/EC2 StatusCheckFailed "InstanceId=${EC2_INSTANCE_ID}" Maximum GreaterThanOrEqualToThreshold 1 2 breaching
alarm ec2-cpu-high "CPU del host del backend > ${EC2_CPU_PCT}% por 15 min" \
  AWS/EC2 CPUUtilization "InstanceId=${EC2_INSTANCE_ID}" Average GreaterThanThreshold "$EC2_CPU_PCT" 3

say "Alarmas RDS (${RDS_INSTANCE_ID})"
alarm rds-cpu-high "CPU de la base > ${RDS_CPU_PCT}% por 15 min" \
  AWS/RDS CPUUtilization "DBInstanceIdentifier=${RDS_INSTANCE_ID}" Average GreaterThanThreshold "$RDS_CPU_PCT" 3
alarm rds-free-storage-low "Quedan menos de ${RDS_FREE_STORAGE_GB} GB libres en la base" \
  AWS/RDS FreeStorageSpace "DBInstanceIdentifier=${RDS_INSTANCE_ID}" Minimum LessThanThreshold \
  "$((RDS_FREE_STORAGE_GB * 1024 * 1024 * 1024))" 1
alarm rds-free-memory-low "Memoria libre de la base < ${RDS_FREE_MEMORY_MB} MB" \
  AWS/RDS FreeableMemory "DBInstanceIdentifier=${RDS_INSTANCE_ID}" Average LessThanThreshold \
  "$((RDS_FREE_MEMORY_MB * 1024 * 1024))" 3
alarm rds-connections-high "Más de ${RDS_MAX_CONNECTIONS} conexiones abiertas a la base" \
  AWS/RDS DatabaseConnections "DBInstanceIdentifier=${RDS_INSTANCE_ID}" Average GreaterThanThreshold "$RDS_MAX_CONNECTIONS" 2

say "Listo"
[[ "$APPLY" == "1" ]] || echo "Nada se aplicó. Revisa la salida y ejecuta con APPLY=1 cuando esté aprobado."
