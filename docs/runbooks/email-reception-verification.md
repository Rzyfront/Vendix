# Recepción de facturas por correo — verificación P0 local

## Alcance y estado del corte

**Fecha:** 13 de octubre de 2026. **Rama:** `develop`. **Baseline:** `fceb517620927c2f52f83e01cff8c3e6d8408215`. **HEAD de evidencia:** `c4cedfcfd`.

Reporte de ejecución P0 autorizada, con commits serializados y auditados por raíz. Resume evidencia observada y distingue implementación local, pruebas focalizadas y gates externos pendientes. Los checkpoints anteriores del [runbook operativo](email-reception.md) conservan su trazabilidad; los conteos finales de este informe son los actualizados del corte.

- Se implementó y ejercitó el pipeline real local: DB/Redis, fiscal identity canónica, parser, MIME/ZIP, storage, originales, consumer y APIs autenticadas. El simulador sustituye únicamente IO de transporte local y prohíbe la rama OCR.
- **No se ejecutaron AWS, DNS, deploy, DIAN, emisión/eventos legales, P1 ni P2.** La preparación de infraestructura no acredita recepción externa. El piloto externo no está autorizado.
- Flags de despliegue permanecen apagados por defecto; allowlist vacía por defecto. Los overrides explícitos del simulador son locales, no cambios globales de configuración. El override externo usado para QA visual fue retirado y el estado API final confirmó `pilot_available=false`. No hubo endpoint inbound público ni boot completo Nest dentro del simulador.
- Discovery GetStatus receptor sigue pendiente de autorización/certificado/muestras. No fue viable ejecutar ese condicional en este corte; **no equivale a concluir que DIAN no soporte la consulta**. No se implementó ni activó un servicio nuevo que consulte DIAN remotamente. Los documentos permanecen **“Sin verificar ante la DIAN”**; AR incluido no demuestra autenticidad ni aceptación legal.
- No se ejecutó build ni typecheck. No se presenta este reporte como prueba de transporte SES/Google/Outlook real, firma XML, XSD DIAN o piloto de comerciante.

## Ledger real de commits

Obtenido con lectura de Git, sin reconstruir hashes ni inferir commits:

```bash
git log --reverse --format='%h %s' fceb517620927c2f52f83e01cff8c3e6d8408215..HEAD
```

**31 commits existentes al preparar este informe:**

```text
c204b85ac test(email-reception): add synthetic DIAN and forwarding fixtures
ff18b16aa feat(email-reception): add scoped durable inbox tables
7a3bac515 fix(received-documents): deduplicate fiscal keys without cross-store leaks
25791653d feat(email-reception): add gated store inbox activation and rotation
06b5a2e1d feat(received-documents): expose fiscal XML evidence for email preflight
8684874bb infra(email-reception): prepare isolated SES SQS resources and runbook
4accc71fc chore(email-reception): pin backend streaming and SQS dependencies
0c4ce9c20 feat(email-reception): persist SQS claims and acknowledge durable outcomes
6a6057158 feat(email-reception): bound MIME forwarding and stream ZIP validation
9d35a8a96 feat(email-reception): persist prepared fiscal originals before ready
f57e37930 fix(email-reception): retain partial success and retry resolver outages
e6d7d86ab fix(received-documents): prevent FEV buyer events for electronic POS
7bd97c69f fix(email-reception): return conflict for stale retry requests
48eaf7174 feat(email-reception): add private Gmail codes and scoped intake history
a9e0713f9 feat(email-reception): preflight fiscal attachments before prepared ingest
dcdac4cc3 feat(email-reception): wire real processor and store history endpoints
4aa540b19 feat(email-reception): add three-step store onboarding wizard
7023b4a87 chore(email-reception): add scoped dry-run retention and rollout checks
8286bedfc fix(email-reception): execute advisory locks without decoding PostgreSQL void
f3ce4c1fa feat(email-reception): simulate real local intake without AWS or DIAN
69bb7b044 fix(email-reception): derive organization pilot availability from owned stores
9a1edb18b feat(email-reception): integrate store onboarding and authenticated organization navigation
546761695 feat(email-reception): add scoped intake history with safe CAS actions
c993207da feat(received-documents): expose honest DIAN and email evidence projections
42928e7ae fix(email-reception): classify valid foreign taxpayer IDs as receiver mismatch
67a1e5455 feat(received-documents): show unverified evidence and hide POS FEV commands
5816547f3 feat(email-reception): integrate pending mail history without changing fiscal KPIs
131ad799f fix(received-documents): reject stale cross-tenant XML picker callbacks
51b5a9812 feat(email-reception): expose guarded pause and confirmed address rotation
940e8bc7e docs(email-reception): record real local pipeline and retention evidence
c4cedfcfd fix(email-reception): defer hidden duplicate credit until canonical readiness
```

**Commit de cierre documental:** este informe se entrega en el commit documental posterior al ledger anterior. Su hash y mensaje se indican en la respuesta final; también se obtienen con `git log -1 --format="%h %s" -- docs/runbooks/email-reception-verification.md`. El ledger anterior contiene los 31 commits previos, sin inventar el hash de su propio commit.

## Matriz de ejecución por paso

| Paso | Implementación entregada | Evidencia local observada | Gate/límite pendiente |
| --- | --- | --- | --- |
| P0.1 — Corpus, decisiones y discovery | 66 fixtures sintéticos, manifest/bytes/SHA, runbook y decisiones aprobadas | Verificación offline del corpus PASS; procedencia sintética documentada | Carpeta inicial de muestras autorizadas vacía. Muestras reales/challenge y discovery receptor DIAN pendientes; expectativas del manifest no son resultados productivos |
| P0.2a — Modelo y scopes | Sólo inboxes/messages email; unique/snapshots/CAS, UTC Timestamp(6), FKs RESTRICT; acceso scoped store/org/system | SQL aditivo/idempotente DATA IMPACT0 revisado por raíz, aplicación y catálogo DB local aprobados; Prisma generate y auditoría singleton | No migración productiva ni cambios a connections/tablas fiscales para modelar el canal |
| P0.2b — Dedupe fiscal cross-store | Unicidad org/entidad/clave; outcome oculto antes de almacenamiento/lecturas; fencing y readiness canónica | Core111 PASS; duplicate_other_store sin IDs; GET documento10 y mensaje1 desde tienda ajena →404 por HTTP real | Compartición entre tiendas no implícita; queda P1. Duplicado oculto sólo acredita válido tras canonical readiness, sin reparar originales ajenos |
| P0.3 — Alias/gates/status | Activación auditable, consentimiento, alias128bit, pause/CAS/rotate; pure reads; piloto defaultfalse+allowlist, fiscal/DIAN-config/subscription gates | Inbox29/status6 PASS; API real status/configuration/validación/autorización; agregado org sólo boolean/counts sin direcciones/IDs | Los reads no crean entidad ni suplantan al creador. Habilitación operativa externa requiere aprobación; consulta de configuración DIAN local no es llamada DIAN |
| P0.4 — Infra offline | SES clásico→S3→SNS→SQS+DLQ en us-east-1; IAM separado, rule deshabilitada, wiring workflow y runbook | Validador offline IaC/workflow PASS; artefactos revisados sin aplicar | AWS/DNS/inventario efectivo, change set futuro, receipt ruleset existente, alarmas/budget/redrive reales no probados |
| P0.5 — Consumer durable | RCPT SES autoritativo, validación bindings, registro antes de gates, cuotas200/1GiB UTC, raw20MiB, claim/CAS/lease, ACK final, retry durable y tag-only retry | Consumer41 PASS; simulator real ACK/dedupe; corrección Prisma7 locks `$executeRaw` validada en DB real | SQS/S3/SNS/DLQ cloud reales pendientes. Fallos técnicos/shutdown/lostclaim no ACK; Gmail auth no se deriva de raw headers |
| P0.6 — MIME/ZIP | Parse streaming bounded, un nivel RFC822, magic/inline, expansión ZIP segura y presupuestos | MIME54/ZIP31 PASS; Outlook/Gmail histórico, BOM/Latin1 y negativos sintéticos | Antivirus y proveedores externos reales no probados; sin fetch de links ni simpleParser/OCR |
| P0.7 — Preflight/ingreso preparado | Decoder fiscal estricto, receptor DV/CC, ambiente/tipos/códigos, prepared seam, evidencia/originales y SHA antes de ready; POS20 sin eventos FEV | Parser51/attachment77/core111/policy28 PASS; factura ready+5descargas/SHA; notas/codificaciones/POS y TEST_DOCUMENT/mismatch observados | DIAN/signature/XSD no verificados. XML/AR extraído de DOM es evidencia derivada, no sustituto de bytes originales; foreign DV validado contra su propia base |
| P0.7b — GetStatus condicional | Badge honesto y estado no consultado; no nuevo servicio remoto activado | Ausencia de llamada remota durante este corte, discovery documentado pendiente | Receptor/control/negativos y certificado autorizado sin ejecutar; GetXml/firma/comparación oficial fuera P0 |
| P0.8 — Gmail/history/actions | Código cifrado ≤24h anclado received_at/currentalias; GET configure private/no-store; history scoped/paging/redacción; retry y discard CAS/audit | Gmail18/history22 PASS; autenticación SES explícitamente simulada →challenge; spoof →unavailable; HTTP cross-store y whitelist metadata | Gmail real puede ser link-only. No autoconfirmación/fetch, plaintext en DB/logs/browserstorage ni cancelación de retries nativos al archivar |
| P0.9 — Asistente | Tres pasos desde Buzón, gates/read-vs-configure, orientación reenvío/código/histórico, store context y navegación org autenticada | Integración entregada en commits; 3 `.ui.spec.ts` y casos puros escritos; wizard store real de tres pasos, Gmail, pausa/reanudar, rotación y teclado observados | Runner UI desconocido: tests UI NO ejecutados. Activación inicial por checkbox y perfil sólo lectura no recorridos en navegador; no prometer tiempo de piloto humano |
| P0.10 — Buzón/detalle/history | Badges DIAN/AR honestos, No procesados separado de KPI fiscal, historial seguro y acciones según permiso; pause/rotación confirmada; stale callback tenant guard | Proyecciones/API reales y backend focalizado PASS; navegador verificó desktop/mobile360, 4 KPI, metadata, 409 real, descarte/archivados y detalles | Org→store y rol sólo lectura no completados en navegador; retry técnico visual/transporte SQS real no ejercitado. No inferir PASS de guards no corridos |
| P0.11 — Retención y salida | Purga técnica scoped/lotes/CAS/audit, help/dry-run; checklist rollback/rollout, retención raw separada de originales | Dry-run org1/store1 exit0, cero candidatos/cambios/mutaciones fiscales; 468 PASS backend focalizado y matriz CLI/HTTP local | Execute/delete/cron no ejecutados; ningún cleanup fiscal. Piloto externo, redrive1/s y alarmas/budget observados requieren aprobación/prueba real |

## Tests backend: 468 PASS / 11 specs exactas

Runner existente `test:path`, **una invocación y un archivo por turno**, `--runTestsByPath`, `--runInBand` del wrapper y heap1536. Se utilizó `ts-jest isolatedModules` para verificación runtime focalizada:

```bash
# Patrón registrado; no ejecutar sin coordinar el lease.
NODE_OPTIONS=--max-old-space-size=1536 npm run test:path -w apps/backend -- --runTestsByPath <ruta-exacta.spec.ts> --globals='{"ts-jest":{"isolatedModules":true}}'
```

| Superficie / archivo | Resultado final | Referencia de evidencia |
| --- | ---: | --- |
| `document-email-inbox.service.spec.ts` |29 PASS| `/tmp/vendix-email-inbox-test.log` |
| `received-document-inbox-status.service.spec.ts` |6 PASS| `/tmp/vendix-email-status-test.log` |
| `received-document-parser.service.spec.ts` |51 PASS| `/tmp/vendix-email-root-parser-test.log` |
| `document-email-sqs-consumer.service.spec.ts` |41 PASS| `/tmp/vendix-email-consumer-test.log` |
| `document-email-mime.service.spec.ts` |54 PASS| Resultado focalizado comunicado y aceptado por raíz |
| `document-email-zip.service.spec.ts` |31 PASS| Resultado focalizado comunicado y aceptado por raíz |
| `received-documents.service.spec.ts` |111 PASS| `/tmp/vendix-email-hidden-ready-core-test-retry.log` |
| `received-document-buyer-event-policy.spec.ts` |28 PASS| `/tmp/vendix-email-pos-policy-test.log` |
| `document-email-gmail-code.service.spec.ts` |18 PASS| `/tmp/vendix-email-gmail-test.log` |
| `document-email-history.service.spec.ts` |22 PASS| `/tmp/vendix-email-history-test.log` |
| `document-email-attachment.service.spec.ts` |77 PASS| `/tmp/vendix-email-attachment-test.log` |
| **Total** |**468 PASS**| **11 archivos; no suite completa ni typecheck** |

Trazabilidad de correcciones, sin ocultar fallos previos:

- Primer intento ts-jest con typechecking alcanzó OOM; se evitó para estos runs mediante `isolatedModules`, sin cambiar configuración global ni afirmar verificación de tipos.
- Primera corrida de la ampliación final core: **109 PASS / 2 FAIL**; fixtures/harness se corrigieron y la reproducción exacta final terminó **111 PASS**. Referencias: `/tmp/vendix-email-hidden-ready-core-test.log` y `...-retry.log`.
- Los tres archivos UI de configuration/inbox/detail y sus casos puros fueron escritos, **no ejecutados** por ausencia de runner identificado. No sumar sus expectativas a los468 PASS.
- Integridad offline de66fixtures y validador IaC PASS son controles independientes; no se cuentan como specs Jest ni como autenticación externa.

## Evidencia de pipeline local y HTTP autenticado

Fixtures100%sintéticos, ajustados por raíz a la identidad fiscal canónica **sólo fuera del repo**, sin registrar aquí identidad fiscal, dirección de recepción, challenge, credenciales o raw. Logs y artefactos temporales se citan como referencias locales, no se copian íntegros al documento. Los IDs siguientes son únicamente registros locales propios autorizados.

| Caso | Resultado real | Referencia segura |
| --- | --- | --- |
| Factura + repetición SES | Documento10 `ready`; 5archivos/5SHA distintos descargados y comprobados por HTTP autorizado; 2entregas ACK, un ingreso fiscal | `/tmp/vendix-email-sim-invoice-v2.log`, `/tmp/vendix-email-api-integrity-qa.json` |
| ZIP inline/octet-stream | Mensaje13 procesado, duplicado visible doc10, ACK1 sin factura nueva | `/tmp/vendix-email-sim-inlinezip.log` |
| Lote parcial | Mensaje14 `partial/RECEIVER_MISMATCH`, doc10 conservado, ACK1, no retry técnico | `/tmp/vendix-email-sim-partial.log` |
| Alias después de rotación UI | Mensaje15 procesado con alias actual, duplicado doc10, ACK1 | `/tmp/vendix-email-sim-after-rotate.log` |
| Outlook RFC822 | Duplicado visible documento10, sin crear factura adicional | `/tmp/vendix-email-sim-outlook.log` |
| Gmail histórico | Factura10, NC11, ND12 por mensajes internos; originales y clasificación conservados | `/tmp/vendix-email-sim-gmail-history.log` |
| Latin1 | Documento13; originales preservados | `/tmp/vendix-email-sim-latin1.log` |
| BOM UTF8 | Documento14; 1archivo/1SHA, ACK1 | `/tmp/vendix-email-sim-bom.log` |
| POS20 | Documento15; 1archivo/1SHA, ACK1; no permiso para eventos FEV | `/tmp/vendix-email-sim-pos.log` |
| Ambiente de pruebas | Mensaje9 `not_processed/TEST_DOCUMENT`, retryablefalse, ACK1, 0documentos | `/tmp/vendix-email-sim-test.log` |
| Receptor ajeno válido | Mensaje3 `not_processed/RECEIVER_MISMATCH`, retryablefalse, ACK1, 0documentos; health válido previo conservado | `/tmp/vendix-email-sim-receiver-mismatch.log` |
| Challenge Gmail | Mensaje10 `ignored/GMAIL_VERIFICATION_CODE`, ACK1, 0documentos, sin exposición de código en stdout | `/tmp/vendix-email-sim-gmail-code.log` |
| Spoof Gmail | Mensaje11 `ignored/GMAIL_CODE_UNAVAILABLE`, ACK1, 0documentos | `/tmp/vendix-email-sim-gmail-spoof.log` |
| Cross-store misma entidad | Mensaje12 tienda2: ACK1, duplicate oculto sin IDs/archivos; GET documento10 y mensaje1 de tienda1 desde tienda2 →404 | `/tmp/vendix-email-sim-cross-store.log`, `/tmp/vendix-email-api-crossstore-qa.json` |
| Contratos API iniciales | 7casos reales de200/400/401, status/configuration y rechazo DTO/auth; posteriormente integridad/cross-store | `/tmp/vendix-email-api-qa.json` |

**Seguridad Gmail:** `security_facts_source=explicit_ses_fixture` significa verdicts/auth de SES **simulados explícitamente**, nunca autenticación Google real. Sin metadata fixture, scanPASS es `synthetic_default` local y Gmail no se autentica por From del EML. El adapter exige coincidencia del remitente externo y facts; jamás confía en headers internos. No se siguieron links ni se confirmó Gmail automáticamente.

**Cross-store/readiness:** `processed`/reasonnull agregado no basta para acreditar canonical readiness. El core final impide crédito válido del duplicate oculto mientras originales del ganador no estén ready, sin publicar ni completar originales ajenos. La evidencia HTTP verifica aislamiento y ausencia de IDs; las regresiones finales del core prueban el fencing/readiness. No se transforma acceso denegado en acceso compartido.

**Originales después de recreación local:** descarga HTTP de los 14 archivos de docs10–15 volvió a confirmar SHA exacto, `ready`, `not_checked` y `accepted_at=null` (`/tmp/vendix-email-api-final-originals-qa.json`). El storage local predeterminado `/tmp/vendix-received-documents` es efímero; para recrear el contenedor se reconstruyeron únicamente estos fixtures propios por hash desde el corpus privado y se guardó snapshot host. No hubo DB writes ni reparación de archivos ajenos; no extrapolar persistencia de `/tmp` a S3 productivo.

**Originales:** los hashes de archivos recibidos preservan los bytes recibidos. Comercial/AR derivados de AttachedDocument son evidencia DOM derivada; no se los presenta como representación firmada byte-a-byte del emisor ni como constancia DIAN verificada.

## Retención: prueba local no destructiva

`apps/backend/scripts/email-reception-purge.ts`: help y dry-run local scoped **organización1/tienda1**, exit0, cero candidatos en ambas fases, cero cambios/CAS omitidos y `fiscal_files_mutated=false`.

Referencias: `/tmp/vendix-email-purge-help.log` y `/tmp/vendix-email-purge-dry-run.log`. **No se ejecutó `--execute`, delete, scheduling/cron ni borrado raw/fiscal.** El dry-run no prueba el modo de escritura y no genera auditoría ficticia de mutaciones.

Políticas aprobadas, todavía con gates operativos: raw factura30d; no-factura/spam7d tras clasificación durable; historial técnico90d elegible; exposición Gmail≤24h. Originales fiscales fuera del lifecycle inbound: intención mínimo5años **pendiente confirmación del contador**, sin conclusión legal ni purga fiscal implementada.

## Infra entregada y pendientes de aprobación manual

Artefactos reales preparados:

1. `infra/email-reception/receipt-rules.yaml`.
2. `infra/email-reception/env.example`.
3. `infra/email-reception/prepare-change-set.sh`.
4. `infra/email-reception/validate-template.sh`.
5. `.github/workflows/deploy-backend-ec2.yml` — wiring defaultdisabled para API/worker, no provisioning/cron ejecutado.
6. `docs/runbooks/email-reception.md` — operación, rollout/rollback y dependencias explícitas.

Validador offline PASS **no** acredita permisos efectivos, recursos existentes, recepción, DNS, métrica publicada ni alarma recibida. Antes de un piloto externo se requiere aprobación humana separada y evidencia real de:

- Inventario AWS autorizado, cuenta/perfil/principales, identidad SES y configuración del **receipt ruleset existente**; añadir regla inicialmente deshabilitada sin reemplazar/activar otro set a ciegas.
- SES clásico **us-east-1**, MX **sólo subdominios aprobados**; no alterar apex/correo padre/outbound. DNS/AWS no se tocaron en este corte.
- Change set futuro preparado **sin ejecución automática**: revisión previa (`--no-execute-changeset`), no operación readonly ejecutada aquí ni despliegue autorizado por este informe.
- IAM/policies separadas inbound, backend y operador redrive; S3raw privado/servidor SSE-S3/TLS separado de originales, SNS envelope no-raw y queue/topic/bucket bindings exactos.
- Cola+DLQ Standard14d/maxReceiveCount5, redrive nativo limitado a **1mensaje/s** en ventana aprobada, sin asumir28d ni transporte externo validado.
- Alarmas DLQ/edad/backlog/ConsumerErrors/StorageErrors/ConsumerHeartbeat/ConsumerMemoryPercent y budget/responsable realmente observados; el publisher local no contacta AWS y el YAML no demuestra sensor funcional.
- Muestras reales autorizadas, reenvío Google/Outlook/challenge y piloto allowlist/consentimiento; validación de rollback por pause sin borrado de originales/histórico.
- Escritura controlada de purga y cron por lotes, sólo tras aprobación separada. No purgar cola/buckets/schema para recuperar errores.

## QA navegador real — controles observados y gaps explícitos

Se usó el Playwright/Chrome **ya instalado**, en contexto propio `ignoreHTTPSErrors` contra `https://vendix.com`, sin instalar runner, leer cookies/localStorage/perfiles, ni falsificar tokens o permisos. El bootstrap del navegador conectado falló por importación no permitida; se utilizó el fallback existente. Fixture de usuario **sintético local264**, rol admin global existente, organización1/tienda1; no se cambió auth/onboarding ni configuración fiscal de usuarios existentes. El usuario queda en STORE_ADMIN. No copiar credenciales al repo.

Para ver el piloto se usó override **externo** `/tmp/vendix-email-ui-qa-compose.yml`: development, rol API, allowlist1/2, storage local, DIAN=false y bindings ficticios. No hubo polling/metrics AWS ni se clicó un retry elegible que pudiera enviar SDK. Después se retiró el override usando compose base + override preexistente, se repusieron los originales sintéticos por SHA y el API final confirmó flags apagados. El navegador propio se cerró.

| Control real | Resultado observado |
| --- | --- |
| Buzón desktop | Exactamente4 KPI; filas con Sin verificar ante la DIAN; factura/NC/ND/POS y origen Correo |
| Web360px | `clientWidth=scrollWidth=360`, sin overflow horizontal de página; badge compuesto atención+DIAN; screenshot privado inspeccionado |
| Wizard configurado | Tres pasos Tu dirección/Tu correo/Prueba; aviso de factura recibida + no verificada, sin aceptar legalmente |
| Gmail | CTA Copiar código sólo dentro de wizard autorizado; código redactado en toda evidencia; rotación lo revocó por API |
| Pausa/reanudar | Mutaciones reales HTTP; botones alternan correctamente y originales/historial siguen legibles |
| Rotación | Cancelar conserva dirección; confirmar cambia alias, cierra confirmación y vuelve al paso1. Recepción posterior con alias actual ACK1 |
| Sad path CAS | Escritura concurrente real por API produjo409 al pausar desde snapshot viejo; alerta específica visible y persistente tras refresh de lectura |
| No procesados/metadata | Mismatch y habilitación legibles; metadata no ofrece cuerpo/raw/código/download; selector manual presenta XML, escanear PDF/foto y captura manual sin transferir adjuntos rechazados |
| Descarte | Msg1 archivado vía UI/CAS real; contador4→3, status not_processed conservado; historial archivados muestra únicamente1 correo |
| Detalle POS15 | Banner persistente; etiqueta POS;0 hosts del comando FEV; actividad legal/evidencia/conciliación preservadas |
| Detalle factura10 | Banner persistente, aviso XML derivado,5 originales; FEV existente conserva1 host, no se emitió ningún evento |
| Teclado | Enter abre el wizard desde su botón; Escape lo cierra |

Referencia segura: `/tmp/vendix-email-browser-qa.json`, **15 controles observados**,0 pageerrors. Se observaron409 esperado del CAS y403 de `store/subscriptions/payment-methods` ajenos a esta feature. Se cerró el overlay de stories semanal existente mediante su botón; un overlay Vite antiguo desapareció al navegar de nuevo después del ciclo watch exitoso, sin editar shared/globales.

**No probado en navegador:** recorrido completo org→store, rol con sólo lectura/sin configure, activación desde inbox inexistente por checkbox, paginación real >25, retry técnico real/SDK, callback tardío OS tras cambio de tenant, suspensión visibility/offline/TTL en todos los navegadores y prueba humana cronometrada≤5min. Los guards fuente/backend cubren contratos pertinentes, pero no sustituyen esos recorridos. Nuevos contextos/login para org no completaron el recorrido; no se etiqueta como PASS ni como bug de feature confirmado. No prometer una matriz visual exhaustiva Happy/Sad/Brute sólo por los controles anteriores.

## Cierre y límites restantes

Entrega P0 **local** con evidencia backend/runtime/offline registrada. No equivale a P0 externo completamente lanzado: discovery DIAN, recorridos UI no completados, infraestructura aplicada, sensores/redrive efectivos, execute de purga, corpus real y piloto externo conservan gates. P1/P2 no ejecutados. Cierre documental serializado por raíz, sin push/PR/deploy. Native ng serve activo y último ciclo sin errores; API health200 y Prisma singleton audit PASS. No frontend shared/ThemeService/globales ni apps/mobile modificados. Los resultados finales de flags/originales se registran en `/tmp/vendix-email-final-state-qa.json`.
