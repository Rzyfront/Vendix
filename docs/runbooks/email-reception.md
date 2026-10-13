# Recepción de facturas por correo — runbook P0

## Decisiones aprobadas y alcance

Rafael aprobó el plan V2 y ejecución local el **13 de octubre de 2026**:

- Producción: `recepcion.vendix.online`; staging: `recepcion-stg.vendix.online`.
- SES **clásico**, región `us-east-1`: **SES → S3 → SNS → SQS Standard + DLQ**. No Mail Manager, SMTP propio ni endpoint HTTP inbound.
- Dirección aleatoria por tienda, 128 bits; rotación **sin gracia** del alias anterior, conservando trabajos ya aceptados y originales.
- Hasta **200 correos y 1 GiB por tienda/día UTC**; el mismo registro/reintento no consume doble cuota.
- Dos tiendas con entidad/NIT compartido: `duplicate_other_store`, sin ID/enlace/archivos/nombre de la otra tienda. Compartición explícita queda P1.
- Retención aprobada: raw de factura **30 días**, no-factura/spam **7 días**, historial técnico **90 días**. Originales fiscales ZIP/XML/AR/PDF: intención de conservar **mínimo 5 años, pendiente confirmación con contador**; no se presenta como conclusión legal ni se impone lifecycle fiscal.
- No OAuth, scraping, auto-RADIAN, aceptación legal automática, compras, contabilidad u OCR automático.

**Estado operativo de esta entrega:** sólo artefactos locales. No se han creado/modificado recursos AWS ni DNS, no se hizo inventario cloud ni se activó ningún receipt rule set. Los identificadores AWS del corpus son **ficticios**, no destinos autorizados. No hay llamadas DIAN, certificados o claves. Discovery receptor GetStatus sigue **pendiente** por falta de autorización; todo documento local conserva **“Sin verificar ante la DIAN”**.

## P0.1 — Corpus y evidencia reproducible

Ruta: `apps/backend/src/domains/received-documents/__fixtures__/email/`.

La carpeta autorizada `~/Documents/Organizations/Quickss/Files/fixtures-recepcion-correo/` existía **vacía** al iniciar P0.1. El corpus entregado es **100% sintético**, no anonimización de un cliente. Nunca copiar/commitear originales que aparezcan allí posteriormente. Requiere revalidación con factura/NC/ND, reenvíos Outlook/Gmail y challenge Gmail autorizados antes del piloto externo.

`manifest.json` documenta procedencia, campos inventados, SHA256, bytes, identidad de prueba y **resultados esperados contractuales** por archivo. No confundir esas expectativas con resultados observados de la aplicación. Códigos 96hex derivan de etiquetas sintéticas, no CUFE/CUDE genuinos; AR `ResponseCode=00` es texto ficticio, no respuesta DIAN. No hay firmas ni criptografía válida inventada.

### Cobertura entregada

| Grupo | Fixtures principales | Contrato esperado |
| --- | --- | --- |
| Factura/NC/ND | `invoice.eml`, `invoice.attached.xml`, `invoice.zip`, `invoice.pdf`, `credit-note.eml`, `debit-note.eml`, XML y AR separados | Un documento por código/entidad; originales conservados; AR no verificado |
| Reenvíos | `outlook-forward-as-attachment.eml`, `gmail-multi-forward.eml` | Un nivel RFC822; cada mensaje interno conserva partes; autoridad SES externa |
| Contenido/MIME | `inline-zip.eml`, `generic-mime-xml.eml` | Detectar magic, no descartar inline/octet-stream/`.ZIP` |
| Codificación | `bom-utf8.xml`, `latin1.xml`, `conflicting-encoding.xml` | UTF8/BOM/Latin1 válidos sin alterar originales; contradicción rechazada |
| Fiscal | `profile-execution-2.xml`, `pos-20.xml`, `support-05.xml`, `final-consumer.xml`, `invoice-type-01..04.xml` | Habilitación/soporte/final rechazados; POS20 conserva CUDE y no habilita eventos FEV |
| Identidad | `receiver-nit-schemeid.xml`, `receiver-nit-appended-dv.xml`, `receiver-nit-hyphen-dv.xml`, `receiver-cc-13.xml`, `receiver-mismatch.xml` | NIT DV calculado; CC íntegra; mismatch rechazado |
| Evidencia/clasificación | `attached-without-application-response.xml`, `pdf-only.zip`, `principal-double.zip`, `invoice-with-complement.zip`, `partial-batch.eml` | Sin AR ingresa con aviso; PDF solo no factura; doble ZIP principal único; complemento opaco; parcial no pierde válido |
| Gmail | `gmail-forwarding-confirmation.eml` + `.ses.json`, `gmail-forwarding-spoof.eml` + `.ses.json`, link-only | Código sólo con identidad/autenticación SES simulada; spoof no código; sin seguir links, fallback honesto |
| SES/SNS | `ses-s3-notification.json`, `ses-s3-notification-duplicate.json`, `ses-cross-environment.json` | `receipt.recipients` autoritativo; SES ID+alias dedupe; entorno/pointer ajeno rechazado antes de GetObject |
| Seguridad pequeña | ZIP traversal/CRC/flag cifrado/symlink/colisión/ratio/presupuesto/count, XXE, EML2, verdicts virus/spam | Rechazos seguros, cero malware real y sin fixture bomba grande |

NIT esperado del corpus: `800765432`, DV derivado por módulo11; proveedor: `900123456`; CC esperada sólo en caso CC: `1118860776`. Estos valores **no son credenciales ni seed de una tienda**. Verificar/seleccionar autoridad fiscal real local en el simulador, sin crear bypass de gates productivos.

**Asimetría UBL importante:** `CreditNote` contiene `CreditNoteTypeCode=91`; `DebitNote-2` **no define `DebitNoteTypeCode`**. ND usa raíz `DebitNote`, CUDE y `CustomizationID=30` para referencia de factura (32 sin referencia). El fixture ND no inventa ese elemento; consultar el builder canónico `ubl-debit-note.builder.ts`.

### Generación y verificación offline (sin red)

Desde la raíz del repo, una invocación por vez y coordinada con otros agentes:

```bash
python3 apps/backend/src/domains/received-documents/__fixtures__/email/generate-fixtures.py
python3 apps/backend/src/domains/received-documents/__fixtures__/email/generate-fixtures.py --verify
```

El generador sólo escribe sus archivos enumerados dentro de su carpeta; no borra muestras ni usa dependencias externas. ZIPs deterministas y pequeños; `zip-encrypted-flag.zip` sólo marca el flag de cifrado, **no** representa una contraseña real. Vectores de presupuesto usan límites bajos documentados en manifest; no descomprimir paths del ZIP al filesystem.

`--verify` verifica SHA256/bytes, XML/CDATA bien formado, MIME, ZIP CRC/flags, DV, duplicación SES/RCPT y bytes BOM/Latin1. **No prueba XSD DIAN, autenticación real Gmail, ingestión Vendix, E2E ni permisos.** Evidencia de ejecución se registra al validar; no declarar verificado por un manifest.

## Discovery GetStatus — PENDIENTE, no ejecutar sin autorización

Responsable de obtener autorización: Rafael. No seleccionar certificado del emisor/Vendix como sustituto del receptor. No copiar certificados, claves, XML oficial ni respuestas con PII al repo/memorias/logs.

| Control requerido en habilitación | Resultado observado ahora |
| --- | --- |
| Receptor autorizado + código conocido | Pendiente; no llamada |
| Emisor como control sobre mismo código | Pendiente; no llamada |
| CUFE inexistente/NIT ajeno | Pendiente; no llamada |
| Certificado inválido/caducado | Pendiente; no llamada |

Antes de una prueba real, registrar autorización/NIT/entidad y referencia segura a certificado fuera del repo. Consultar sólo `GetStatus`, sin emisión o eventos legales. Registrar ambiente, fecha, método, autorización, código solicitado/devuelto (redactado si se comparte), éxito inequívoco, expiración y selección de configuración. Si no funciona, P0 sigue con badge `not_checked`; GetXmlByDocumentKey/verificación de firma/comparación XML oficial siguen P1.

Aun con GetStatus positivo, copy limita alcance: **“La consulta confirma el estado del código; no verifica la firma de este archivo. Revisa proveedor, valores y original antes de pagar”**. AR embebido nunca prueba autenticidad ni eleva estado legal/accepted_at.

## Infra y operación — preparación, NO aplicada

P0.4 añadirá artefactos con parámetros por entorno, IAM mínimo, receipt rules y simulador local. Hasta que Rafael ejecute y valide infraestructura, no afirmar que un dominio recibe correo ni que SES está conectado.

Contrato para esos artefactos:

1. Bucket inbound privado separado de originales fiscales; BlockPublicAccess, SSE-S3 en servidor y TLS obligatorio. **No** activar `KmsKeyArn` de la acción SES (cifrado cliente no soportado aquí).
2. Prefijo `raw/`; acción S3 notifica SNS con metadata, sin MIME en la notificación. Suscripción SQS con `RawMessageDelivery=false`.
3. Topic publica sólo principal SES autorizado por cuenta+rule ARN. Cola sólo topic esperado y retry interno del principal backend autorizado. Bucket sólo `ses:PutObject` en raw por rule ARN autorizado; backend no `s3:*`.
4. Long poll 20s, un mensaje/concurrencia1; visibilidad120s renovable durante IO; `DeleteMessage` sólo tras resultado DB durable para todos los aliases. No BullMQ email/outbox Redis.
5. Cola+DLQ Standard: retención14d, `maxReceiveCount=5`, RedriveAllowPolicy restringida. DLQ no reinicia reloj original: no prometer28d de retención.
6. Flag recepción apagado por defecto + allowlist piloto; ningún endpoint público/simulador productivo. Pausa conserva originales/histórico/pendientes según retención.

### Retención: separación obligatoria

- Factura/raw sin clasificación inicial: lifecycle30d **sólo bucket inbound/prefijo raw/**.
- No-factura/spam: plazo7d desde recepción aprobado; clasificar/taggear sólo tras resultado durable. No aplicar borrado7d al correo pendiente/fallido técnicamente o con factura parcial.
- Historial técnico90d: purga limitada por lotes de estados finales sin trabajo pendiente; dry-run antes de writes. Audit activación/rotación/descarte mantiene política propia existente.
- Códigos Gmail: cifrados, alias actual, caducidad local≤24h; limpiar/revocar al expirar/rotar; respuesta privada `no-store`; jamás localStorage ni logs.
- Originales fiscales: fuera del bucket/lifecycle inbound; descartar correo, cerrar piloto o purgar historia **no borra ZIP/XML/AR/PDF**. Confirmar5años con contador antes de definir política fiscal; ninguna purga fiscal automática P0.

### Manual previo a piloto externo

- Rafael selecciona cuenta/perfil AWS, identificadores reales, receipt rule set existente y responsable operativo; revisar antes de aplicar. No reemplazar rule set activo a ciegas.
- Aplicar IaC sólo tras revisión de policies y permisos, verificar identidad SES y publicar MX **sólo los subdominios aprobados**, sin alterar correo del dominio padre.
- Validar aislación staging/prod y autorización de datos; staging no recibe facturas reales de producción por defecto.
- Alarmas DLQ≥1, edad/backlog, errores S3/consumer, heartbeat, memoria y presupuesto; responsable/rollback definidos. Reproceso DLQ usa redrive nativo limitado, no script propio.
- Validar corpus real autorizado, plantilla challenge Gmail (código no garantizado por Google) y reenvío histórico. Si Google envía sólo link: no autoconfirmar; alternativa directa proveedores/soporte.
- Prueba guiada comerciante≤5min de interacción, separando esperas externas. Sin runner frontend identificado, usar Playwright real o documentar gap, no instalar harness inventado.

## Fuentes y límites

- [Contenido de notificaciones SES y RCPT autoritativo](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html).
- [Acción S3 SES y notificación opcional SNS](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html).
- [DLQ SQS y retención](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).
- [DIAN Anexo técnico FEV1.9](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf); su formato inspira el corpus, **no se afirma validación XSD/DIAN real**.
- Plan/review aprobados externos: `~/.openclaw/tmp/vendix-email-reception/plan.md` V2 y `review.md`; Decisiones Rafael finales prevalecen sobre secciones antiguas pendientes.

## P0.4 — Artefactos infraestructura preparados (no aplicados)

| Ruta | Uso |
| --- | --- |
| `infra/email-reception/receipt-rules.yaml` | CloudFormation: regla SES deshabilitada dentro del ruleset existente; bucket raw separado, SNS/SQS+DLQ, policies, alarmas y budget |
| `infra/email-reception/env.example` | Nombres env aprobados y parámetros sin credenciales ni valores AWS inventados |
| `infra/email-reception/prepare-change-set.sh` | Acción futura autorizada: crea change set **sin ejecutarlo**, con `--no-execute-changeset`, región fija us-east-1 |
| `infra/email-reception/validate-template.sh` | Revisión offline YAML/referencias/sin ciclos/contratos/workflow; no AWS, no build |
| `.github/workflows/deploy-backend-ec2.yml` | Wiring tolerante desde configuración existente a API y worker; flag=false por defecto, sin activar cron ni deploy |

La plantilla **no** crea ni activa `AWS::SES::ReceiptRuleSet`, identidad SES, records DNS, certificados, usuarios/roles backend ni recursos fiscales. Agrega una regla `ScanEnabled` con S3+Topic y StopRuleSet al ruleset que el humano seleccione. Se entregan managed policies **sin adjuntarlas**: revisar principal existente y permisos previos; backend y operador deben ser identidades separadas. `OriginalObjectArn` corresponde al namespace existente `arn:aws:s3:::<bucket-fiscal>/organizations/<org-o-*>/fiscal-entities/<entidad-o-*>/received-documents/*`; nunca usar `bucket/*` ni raw bucket como destino fiscal.

**Guardias:** dominios se obtienen por mapping production/staging de los dos subdominios aprobados; región sólo us-east-1 (regla assertion/mapping y script fijo). Recurso inbound usa Retain/UpdateReplacePolicy Retain: deshabilitar/rollback no elimina raw/colas. Regla SES queda `ReceiptRuleEnabled=false` inicialmente; backend mantiene `EMAIL_RECEPTION_ENABLED=false`, allowlist vacía y `EMAIL_RECEPTION_DIAN_STATUS_ENABLED=false`. Una futura ejecución del workflow no configura AWS/MX ni confirma Gmail automáticamente. Procesamiento corre sólo rol worker/all; recibir env en API no autoriza segundo consumidor.

### Aplicación futura por Rafael/operador — sin ejecutarla aquí

1. Inventario autorizado: revisar cuenta, regla activa, DNS base y existencia/orden de ruleset. Dos stacks staging/prod comparten **el ruleset existente** en una misma cuenta/región. `AfterReceiptRuleName` requiere revisar precedencia y Stop para no interceptar otras reglas. Guardar baseline MX padre/ruleset y elegir rollback de deshabilitar sólo esta regla.
2. Verificar subdominio SES y publicar TXT/CNAME emitidos por AWS; MX `10 inbound-smtp.us-east-1.amazonaws.com`, TTL300, sólo el subdominio aprobado. No alterar MX/identidad saliente del dominio padre.
3. Poblar variables de `env.example` con metadata real, nunca pegar secrets al repo; ejecutar `prepare-change-set.sh --approved-inventory` **sólo con autorización**. Revisar change set/IAM: no reemplaza rule set, no resources fuera correo, originals namespace correcto, roles separados/cuenta esperada. Ejecutarlo es una aprobación humana **separada**; el script no lo hace.
4. Revisar outputs, asociar managed policy BackendPolicy al principal backend existente y OperatorRedrivePolicy sólo al operador. El budget mide conservadoramente **SES/S3/SNS/SQS de toda la cuenta**, no costo exclusivo correo, porque SES inbound no ofrece una atribución fiable por tenant/tag en este corte. Ajustar monto con responsable, sin creer que25USD es cotización.
5. Confirmar suscripción SNS de `OperationsEmail`; verificar sensor custom antes de piloto. Activar la regla dentro del ruleset ya activo sin cambiar otras; wiring de config desde outputs; activar allowlist+flag sólo después de correo staging autorizado y controles negativos.
6. Validar backend detenido→entrada durable→consumo tras reinicio, otro topic/pointer rechazado antes de GetObject, raw cifrado/privado, ScanEnabled, lifecycle, no ejecución URL y códigos DIAN honestos. No declarar listo externo por un YAML válido.

Comandos **futuros**, requieren aprobación y variables verificadas:

```bash
aws ses describe-active-receipt-rule-set --profile "$AWS_PROFILE" --region us-east-1
aws ses get-identity-verification-attributes --identities "$RECEPTION_DOMAIN" --profile "$AWS_PROFILE" --region us-east-1
# Baseline: revisar también records del dominio padre antes/después, sin modificarlos.
aws route53 list-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --profile "$AWS_PROFILE"
# Comprobar transporte real sólo después de provisioning revisado.
dig +short MX "$RECEPTION_DOMAIN"
aws s3api get-public-access-block --bucket "$INBOUND_BUCKET" --profile "$AWS_PROFILE"
aws s3api get-bucket-encryption --bucket "$INBOUND_BUCKET" --profile "$AWS_PROFILE"
aws s3api get-bucket-lifecycle-configuration --bucket "$INBOUND_BUCKET" --profile "$AWS_PROFILE"
aws sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn Policy RedrivePolicy VisibilityTimeout ReceiveMessageWaitTimeSeconds MessageRetentionPeriod SqsManagedSseEnabled --profile "$AWS_PROFILE" --region us-east-1
aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names RedriveAllowPolicy MessageRetentionPeriod --profile "$AWS_PROFILE" --region us-east-1
aws sns get-subscription-attributes --subscription-arn "$SUBSCRIPTION_ARN" --profile "$AWS_PROFILE" --region us-east-1
# Operador separado, ventana aprobada, recepción segura y raw aún vigente:
aws sqs start-message-move-task --source-arn "$DLQ_ARN" --destination-arn "$QUEUE_ARN" --max-number-of-messages-per-second 1 --profile "$AWS_PROFILE" --region us-east-1
```

### Alarmas, métricas y cron: dependencias explícitas

Alarmas nativas SQS: DLQ visible≥1; edad por defecto300s; backlog100 (umbrales paramétricos). Alarmas custom preparadas, namespace `Vendix/EmailReception`, dimensión **Environment** con valor production/staging: `ConsumerErrors`, `StorageErrors` (Sum≥1), `ConsumerHeartbeat` (Sum<1 durante3min, missing=breaching), `ConsumerMemoryPercent` (Maximum≥80 durante3min). Responsable es `OperationsEmail`; verificar confirmación SNS y dueño de respuesta a incidentes. Un consumer pausado intencionalmente puede disparar heartbeat: reconocer alarma/ventana de pausa, no afirmar que Gmail desconectó.

**Gap operativo a resolver en P0.5/P0.11:** el YAML no instala/emite sensores custom. El consumidor deberá publicar esos cuatro métricos con la dimensión exacta (y medir memoria contra presupuesto real), o el operador aportar un sensor autorizado equivalente. BackendPolicy sólo permite `cloudwatch:PutMetricData` en ese namespace. Hasta observar datapoints/alarma real y presupuesto vigente no dar monitoreo por validado. Budget notifica80% actual/100% forecast directamente al responsable; no auto-apaga recursos ni evita costo previo al backend.

Lifecycle7d depende del tag `email-reception-classification=non-invoice|spam`, aplicado **después** del commit final seguro. No taggear failed/processing/partial con factura ni deducir clasificación desde headers. Para raw compartido por varios aliases esperar resultados durables de todos y no marcar no-factura si alguno conserva una factura. SSE-S3+TLS no son cifrado cliente SES; jamás añadir `KmsKeyArn` a la acción sin nueva integración de descifrado.

Cron de purga **no se instala desde workflow**. P0.11 debe entregar comando verificado, ejecutar dry-run supervisado, luego Rafael autoriza programación diaria por lotes; no inventar ruta ejecutable que aún no existe ni abrir servicio nuevo. Hora sugerida03:15UTC con exclusión mutua (flock), logs sólo counts/códigos técnicos y alertar errores; validar90d estados terminales/raw expirado y cero borrado fiscal antes de habilitar writes. No purgar cola ni raw para recuperar un fallo del parser.

Verificación offline preparada, coordinar procesos y ejecutar uno por vez:

```bash
bash infra/email-reception/validate-template.sh
```

No equivale a `cloudformation validate-template`, permiso IAM efectivo, identidad verificada, rule set activo, métricas observadas ni recepción externa. No hubo calls AWS/DNS/SSH/deploy en esta entrega.

Referencias P0.4: [Reglas SES CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ses-receiptrule-rule.html), [SQS CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sqs-queue.html), [IAM redrive nativo](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html), [AWS Budgets CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-budgets-budget.html), [Formato YAML CloudFormation — sin aliases](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-formats.html).

## P0.7 — Honestidad de originales y documentos derivados

**Bytes originales autoritativos:** ZIP, AttachedDocument completo, XML comercial/AR independientes y PDF recibidos se conservan sin transcodificarlos, con SHA256 de los bytes recibidos. BOM UTF8 y Latin1 no se pierden en esos originales. El XML comercial y AR **extraídos** desde `Description` del AttachedDocument son **evidencia derivada del DOM**, codificada según la declaración soportada y con SHA256 de esa representación. XML normaliza CRLF/CR a LF; no afirmar que el derivado reproduce los bytes del emisor ni valida su firma. AttachedDocument/ZIP originales permiten revisar la fuente exacta.

`ApplicationResponse` incluido sólo permite mostrar **“Constancia DIAN incluida (no verificada)”** y un código de respuesta saneado; se compara la referencia real del documento, no un UUID arbitrario de la raíz AR. Referencia incompatible produce advertencia, no autenticidad. Todos los documentos conservan **“Sin verificar ante la DIAN”**. Los badges de transporte “Funcionando” y `source_channel=email` no son aceptación DIAN, verificación criptográfica, procedencia legal ni permiso para emitir eventos. Una etiqueta histórica de origen por sí sola no prueba que pasó por el transporte nuevo.

## P0.11 — Purga técnica limitada y apagada por defecto

Artefacto: `apps/backend/scripts/email-reception-purge.ts`. No está instalado como cron ni se ejecutó borrado en esta entrega. **Dry-run es el modo predeterminado**; `--execute` debe ser explícito. `--help` no construye/importa Prisma ni conecta DB.

Desde `apps/backend`, con un turno de proceso y heap≤1536MiB:

```bash
TS_NODE_TRANSPILE_ONLY=1 NODE_OPTIONS=--max-old-space-size=1536 \
  node -r ts-node/register -r tsconfig-paths/register scripts/email-reception-purge.ts --help
# Futuro dry-run local supervisado; los IDs son autorizados, no valores inventados:
TS_NODE_TRANSPILE_ONLY=1 NODE_OPTIONS=--max-old-space-size=1536 \
  node -r ts-node/register -r tsconfig-paths/register scripts/email-reception-purge.ts \
  --dry-run --environment production --organization-id "$ORG_ID" --store-id "$STORE_ID" \
  --batch-size 50 --max-batches 1
# Sólo después del dry-run revisado y autorización humana de escritura:
TS_NODE_TRANSPILE_ONLY=1 NODE_OPTIONS=--max-old-space-size=1536 \
  node -r ts-node/register -r tsconfig-paths/register scripts/email-reception-purge.ts \
  --execute --environment production --organization-id "$ORG_ID" --store-id "$STORE_ID" \
  --actor-id "$ACTOR_ID" --batch-size 50 --max-batches 1
```

### Guardias de conservación y concurrencia

- Scope **obligatorio** ambiente+organización+tienda; no wildcard, scope global ni “todas las tiendas”. Validar tienda perteneciente a organización antes de leer candidatos. El actor debe pertenecer a esa organización para escrituras; no suplantación de usuario HTTP.
- Lote50 predeterminado, máximo100; máximo de lotes por fase1 predeterminado, permitido1..20. Dos fases: limpiar códigos Gmail expirados y purgar historial técnico. `has_more` avisa que queda trabajo; no ejecutar barridos ilimitados por comodidad.
- Candidatos de historial: `received_at < ahoraUTC−90d`, estado `processed|not_processed|ignored|failed|partial`, **retryable=false**, `processed_at` no nulo, `processing_token` y `processing_started_at` nulos. Falla cerrado: nunca `received`, `processing`, claim activo o pendiente reintentable. Los estados fallido/parcial con trabajo pendiente requieren revisión operativa, no rebajar banderas para purgarlos.
- Códigos: fecha expiración≤ahora UTC y el mismo scope/estado terminal seguro; borrar ciphertext, alias y expiry, incluso si la fila tiene menos90d. TTL de exposición≤24h sigue aplicando aunque una fila activa/reintentable se excluya temporalmente de limpieza; jamás se imprime código/ciphertext ni se ofrece un link de confirmación.
- Cada `updateMany`/`deleteMany` repite **ID+versión+scope+condiciones terminales** de los candidatos en el WHERE; versiones cambiadas/claims renovados se omiten. Mutation y audit se confirman en la misma transacción. Código expirado incrementa versión.
- Auditoría por lote: actor, scope, motivo `EXPIRED_GMAIL_CODE|RETENTION_90_DAYS`, fechas y counts seleccionados/cambiados/CAS-omitidos. No correo, asunto, alias, NIT, raw key, XML, URLs o código. Dry-run sólo lee; no genera auditoría de mutaciones ficticias.
- Sólo se actualizan/eliminan filas de `document_reception_email_messages`; audit existente se añade, **nunca** se borra. No cambia inboxes, documentos recibidos, entidades, estados legales, originales fiscales, S3 ni archivos locales. Un cliente GlobalPrisma explícito, pool1, desconexión pública y salida CLI tras flush.

### Targets y autorización de producción

Targets locales admitidos: localhost/127.0.0.1/::1 y hostnames Docker dev `db`/`vendix_postgres`, **únicamente database `/vendix_db` y puerto5432 o predeterminado**. Otra base/puerto local se rechaza para no purgar datos ajenos accidentalmente. El script no imprime DATABASE_URL ni errores ORM detallados. No-local **staging está bloqueado en este corte**, pendiente política operativa explícita.

Un código cifrado expirado nunca se devuelve por la API aunque todavía exista en una fila activa/reintentable. La limpieza espera que esa fila termine y pierda su claim; no interrumpir un job ni borrar su historial90d para cumplir el TTL de exposición.

Un target no-local production requiere **también en dry-run** `--approve-production-purge PURGE_TECHNICAL_EMAIL_METADATA_ONLY` y actor válido. Escrituras no-local production exigen además `NODE_ENV=production`, scope completo y `--execute`. Este token es confirmación operativa, **no una contraseña ni sustituto de aprobación humana/IAM**. No se ejecutó ninguna consulta/borrado de producción en esta sesión. Dry-run local verificado por raíz (2026-10-13T23:37Z): scope org1/store1, cero candidatos/cambios, exit0; prueba execute pendiente con filas sintéticas controladas y autorización separada.

Política aprobada se mantiene separada: **raw factura30d; no-factura/spam7d tras clasificación durable; historial técnico90d elegible; código Gmail exposición≤24h; originales fiscales intención mínimo5años pendiente contador**. La purga técnica no implementa retención fiscal, legal hold nuevo, purga raw ni borrado de archivo fiscal.

### Evidencia disponible y gates todavía manuales

Resultados de specs puntuales observados antes de esta sección (heap1536, aislados, una invocación por archivo):

| Superficie | Evidencia observada | No demuestra |
| --- | --- | --- |
| Corpus sintético |66fixtures/manifiesto: integridad offline PASS |Muestras reales, autenticación Google o DIAN |
| IaC/workflow |Validador offline YAML/IAM/lifecycle/referencias PASS |Policies AWS efectivas, recursos creados o MX |
| MIME |54/54 casos PASS |Correo Gmail/Outlook externo real |
| ZIP |31/31 casos PASS |Escaneo antivirus real |
| Adapter/preflight |70/70 casos PASS |GetStatus, firma o estado legal |
| Parser fiscal |51/51 casos PASS |XSD/criptografía DIAN real |
| Core recibido |105/105 casos PASS |Facturas productivas o piloto externo |
| Purga técnica |`--help` y dry-run DB local PASS exit0; cero candidatos/cambios, originales intactos |Borrado probado o cron instalado |

El corpus es sintético y el discovery DIAN sigue pendiente. **No afirmar simulador E2E, navegador, ejecución de purga con borrado, AWS redrive, alarmas/budget observados ni piloto externo verificados hasta anexar evidencia real de esas ejecuciones.** Runner `.ui.spec.ts` no se instala/inventa; UI se verifica con navegador/Playwright si el entorno permite, o gap explícito.

### Gmail: código-only y plantilla todavía no validada con muestra real

Mostrar/copy de código vigente pertenece al usuario que solicitó reenvío; usuario lo pega manualmente en Gmail. No abrir, seguir ni confirmar un enlace del correo. La plantilla puede ser link-only: fallback **“No pudimos leer un código de confirmación. Puedes usar esta dirección directamente con tus proveedores mientras soporte te ayuda”**. No inventar números a partir de URLs/asuntos.

Reenvío general debe quedar desactivado; filtro sugerido `has:attachment {filename:zip filename:xml}`, revisar resultados antes de guardar y conservar copia. Workspace/Microsoft365 pueden requerir autorización del administrador para reenvío externo. Histórico: Gmail “Reenviar como archivo adjunto”/Outlook “Reenviar como datos adjuntos”, grupos pequeños≤20 correos/20MiB, no enlace Drive. [Guía Google reenvío](https://support.google.com/mail/answer/10957?hl=es), [Gmail histórico como adjunto](https://support.google.com/mail/answer/9261412?hl=es), [Reglas Outlook](https://support.microsoft.com/en-us/outlook/mail/use-rules-to-automatically-forward-messages), [Políticas Microsoft365](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding).

### Checklist final de rollout y rollback (no ejecutado)

1. Responsable humano e inventario autorizados; SES clásico us-east-1, identidad subdominio verificada y MX exacto sólo `recepcion.vendix.online`/`recepcion-stg.vendix.online`. Conservar baseline y no tocar MX/apex/outbound.
2. Receipt rule inicialmente deshabilitada, añadida al **ruleset existente** revisando orden/Stop; no crear/reemplazar/activar otro set por defecto. SNS envelope no-raw, S3 server-side AES256/privado/TLS, destinos separan raw y originales fiscales.
3. Revisar/adjuntar IAM mínimo backend y **operador redrive separado**. Aprobar lecturas de DLQ y ventana de redrive antes de mover mensajes. Cola+DLQ Standard14d, maxReceiveCount5; no prometer28d. Redrive nativo preparado arriba a1mensaje/s, sin ejecutarlo aquí.
4. Confirmar destinatario de **todas** alarmas, heartbeat/errores/memoria observados y budget/responsable. Publisher custom debe emitir nombres/dimensiones exactos de IaC; un template no prueba un sensor funcional.
5. Aprobar muestras reales autorizadas, challenge Gmail, allowlist piloto, consentimiento/región de datos y confirmación fiscal5años con contador. Hacer prueba guiada comerciante≤5min separando espera externa.
6. Antes de cron, revisar dry-run por tienda y auditoría; ejecutar sólo lotes autorizados, observar counts/CAS y asegurar originales intactos. No activar escrituras globales.
7. Rollback seguro: `EMAIL_RECEPTION_ENABLED=false` pausa activación/procesamiento; deshabilitar **sólo** regla correo nueva si procede. Conservar cola según14d y raw según30/7d, originales fiscales e histórico legible. No schema rollback destructivo, purgeQueue, borrar bucket ni desmontar MX padre. Reanudar requiere gates/contexto y comprobación de seguridad otra vez.
