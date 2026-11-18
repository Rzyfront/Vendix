# Monitoreo de Vendix (QUI-1010)

Dos capas que se complementan:

| Capa | Qué ve | Dónde avisa | Dónde vive |
| --- | --- | --- | --- |
| **Bot de monitoreo de la API** | Peticiones 5xx, respuestas lentas, jobs de BullMQ fallidos o colgados, colas sin procesar, worker sin latido, incidentes de cargas masivas e IA | Telegram del equipo; graves además correo a soporte + ticket en Superadmin; vista en Superadmin → Monitoreo → Alertas | Backend (`apps/backend/src/common/platform-alerts/`) |
| **Alarmas de CloudWatch + SNS** (este directorio) | Host EC2 caído o saturado, base de datos RDS sin CPU, memoria, disco o conexiones | Correo vía SNS | AWS (se crean con `cloudwatch-alarms.sh`) |

El bot no puede avisar si se cae el host entero o el propio proceso de la API; por eso existen las alarmas de AWS.

## Variables de entorno del bot (backend)

Se configuran en el secreto del backend (Secrets Manager, `vendix/production/...`) o en el `.env` local. **Nunca** se versionan valores reales.

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `MONITOR_TELEGRAM_BOT_TOKEN` | — | Token del bot de Telegram (de @BotFather). Sin él, el bot registra y abre tickets pero no envía a Telegram. |
| `MONITOR_TELEGRAM_CHAT_ID` | — | Chat o grupo del equipo (p. ej. `-100…`). |
| `MONITOR_ENV_LABEL` | `NODE_ENV` | Etiqueta del entorno en cada mensaje (`producción`, `staging`). |
| `MONITOR_ENABLED` | `true` | `false` apaga el bot por completo. |
| `MONITOR_SLOW_REQUEST_MS` | `10000` | Umbral de respuesta lenta (alerta informativa). |
| `MONITOR_SLOW_REQUEST_IGNORE` | — | Fragmentos de ruta, separados por coma, que no cuentan como lentos (exportes, reportes pesados). |
| `MONITOR_RESOLVE_AFTER_MINUTES` | `30` | Minutos sin repetirse para cerrar sola una alerta (y avisar la resolución). |
| `MONITOR_ESCALATE_AFTER` | `20` | Repeticiones de una falla leve en el mismo episodio para subirla a grave. |
| `MONITOR_JOB_ACTIVE_STALL_MINUTES` | `15` | Minutos en proceso para considerar colgado un job. |
| `MONITOR_JOB_WAITING_STALL_MINUTES` | `5` | Minutos con trabajo esperando y nadie procesando para alertar la cola. |
| `MONITOR_WORKER_HEARTBEAT_MAX_MINUTES` | `3` | Minutos sin latido del worker antes de alertar (solo con API y worker separados). |
| `MONITOR_TELEGRAM_MAX_PER_MINUTE` | `20` | Tope de mensajes por minuto; el resto se cuenta y se informa en el siguiente. |
| `SUPPORT_INCIDENT_EMAILS` | superadmins activos | Correos de soporte para las graves (QUI-1009). |

### Crear el bot de Telegram

1. En Telegram, habla con **@BotFather** → `/newbot` → guarda el token en `MONITOR_TELEGRAM_BOT_TOKEN` (en el secreto, no en el repo).
2. Agrega el bot al grupo del equipo y envía un mensaje cualquiera en el grupo.
3. Obtén el id del chat: `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"` → `result[].message.chat.id` → `MONITOR_TELEGRAM_CHAT_ID`.
4. Reinicia el backend y prueba desde Superadmin → Monitoreo → Alertas → «Alerta de prueba».

La política de gravedad (qué es grave) está en un solo archivo: `apps/backend/src/common/platform-alerts/platform-alert-policy.ts`.

## Alarmas de CloudWatch + SNS (sin ejecutar)

`cloudwatch-alarms.sh` crea un tema SNS (`vendix-production-alerts`), suscribe el correo de soporte y define seis alarmas:

| Alarma | Métrica | Umbral por defecto |
| --- | --- | --- |
| `ec2-status-check` | `AWS/EC2 StatusCheckFailed` | ≥ 1 en 2 × 5 min (datos faltantes = alarma) |
| `ec2-cpu-high` | `AWS/EC2 CPUUtilization` | > 85 % en 3 × 5 min |
| `rds-cpu-high` | `AWS/RDS CPUUtilization` | > 85 % en 3 × 5 min |
| `rds-free-storage-low` | `AWS/RDS FreeStorageSpace` | < 5 GB |
| `rds-free-memory-low` | `AWS/RDS FreeableMemory` | < 256 MB en 3 × 5 min |
| `rds-connections-high` | `AWS/RDS DatabaseConnections` | > 80 en 2 × 5 min |

### Uso

```bash
# 1. Simulación (por defecto): solo imprime los comandos. Lee la instancia EC2 por la etiqueta Name
#    y la primera instancia RDS con la CLI (solo lectura) si no se pasan los ids.
./infra/monitoring/cloudwatch-alarms.sh

# 2. Revisa ids y umbrales; ajústalos por variable:
EC2_INSTANCE_ID=i-xxxx RDS_INSTANCE_ID=vendix-db ALERT_EMAIL=soporte@ejemplo.com \
  EC2_CPU_PCT=90 ./infra/monitoring/cloudwatch-alarms.sh

# 3. Aplicar (escritura en AWS de producción: requiere aprobación explícita antes):
APPLY=1 EC2_INSTANCE_ID=i-xxxx RDS_INSTANCE_ID=vendix-db ALERT_EMAIL=soporte@ejemplo.com \
  ./infra/monitoring/cloudwatch-alarms.sh
```

Después de aplicar, confirma la suscripción desde el correo que envía AWS. `put-metric-alarm` y `create-topic` son idempotentes: volver a ejecutarlo actualiza las alarmas.

Costo: 6 alarmas estándar de CloudWatch (≈ 0,10 USD/mes cada una) y correos SNS dentro de la capa gratuita.

### Rollback

```bash
aws cloudwatch delete-alarms --alarm-names \
  vendix-production-ec2-status-check vendix-production-ec2-cpu-high \
  vendix-production-rds-cpu-high vendix-production-rds-free-storage-low \
  vendix-production-rds-free-memory-low vendix-production-rds-connections-high
aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:<ACCOUNT_ID>:vendix-production-alerts
```
