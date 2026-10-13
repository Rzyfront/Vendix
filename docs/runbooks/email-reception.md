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
