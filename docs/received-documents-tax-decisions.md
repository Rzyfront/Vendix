# Recepción de documentos y consolidación tributaria — decisiones

Estado: ejecución autorizada por el usuario el 30-09-2026. Trabajo local sobre `develop`; sin push, PR, deploy ni cambios de producción. Este informe registra decisiones tomadas bajo la autorización «cualquier cosa que necesites preguntar decide lo más recomendado»; no atribuye al usuario decisiones que no tomó.

## Business Analysis Brief

### Request
Recepción manual y automática asistida con IA, sincronización con datos del negocio y un consolidado tributario completo, enlazado a compras, gastos, contabilidad, anticipos, saldo por pagar, declaraciones, cierre y reportes.

### Change Type
Feature + Integration + Rule correction + Reporting + Accounting data integrity.

### Domain And Actors
- Dominio: documentos recibidos, compras/gastos, contabilidad y operación fiscal.
- Apps: STORE_ADMIN y ORG_ADMIN web; backend compartido. Mobile queda fuera de esta implementación web, no de los contratos.
- Tenant: organización, entidad fiscal/NIT y ubicación operativa de tienda; las dimensiones fiscal y operativa no se confunden.
- Actores: dueño/admin, receptor/compras, contador/revisor, integración autenticada y worker.
- Entidades: documento original, proveedor, líneas/impuestos, enlaces OC/recepción/gasto/CxP, eventos, declaraciones, créditos, pagos y asientos.

### Confirmed Decisions
- UI primaria: **Fiscal → Facturación → Documentos recibidos** como tab.
- El usuario pide implementación completa, no sólo plan/MVP.
- Mantener rama actual, commits locales, no push.
- Usar sopus y decidir autónomamente lo recomendado; entregar informe de todas las decisiones.

### Assumptions
- «anticipos salud por pagar» se interpreta como «anticipos, saldo por pagar», por el contexto repetido de impuestos; no se eliminan obligaciones existentes de salud/PILA ni se inventa una nueva liquidación de salud.
- Calcular/conciliar y automatizar recepción es deseado; presentación de declaraciones, aceptación comercial y pago externo requieren autorización/evidencia específica. Las pruebas no deben realizar actos legales productivos ni gastar dinero real.
- «Business» es capacidad de suscripción configurable, no nombre de plan hardcodeado ni fiscalidad determinada por el plan.

### Open Questions
El usuario delegó decisiones. Las conexiones/credenciales externas y datos fiscales de cada cliente se configuran en UI; su ausencia debe mostrarse como «no configurado», nunca «sincronizado» o «validado». Cualquier requisito que dependa de estado externo no comprobable quedará explícito en la matriz de evidencia y mantendrá el goal incompleto hasta verificarlo o resolverlo.

### Business Rules
- El original es evidencia inmutable; XML validado y aritmética determinista prevalecen sobre OCR/IA.
- Recibir/asociar un documento no recibe mercancía ni vuelve a crear stock/CxP/asientos.
- Matching compara proveedor/receptor, referencias, líneas/UoM, cantidades, precio/descuento/impuestos/flete y recepción real; sugerir ≠ confirmar ≠ aceptar comercialmente.
- No exigir OC para gasto/servicio; enlaces N:M y recepciones parciales explícitas.
- Cada fuente cuenta una vez, incluidas notas y puente IVA de compras histórico; la información incierta se señala, no se inventa.
- Impuestos se liquidan por contribuyente, familia, jurisdicción y período; sólo se aplican créditos elegibles de ese ámbito con evidencia.
- Un cierre conserva snapshots y no reescribe historia; correcciones/reversos son trazables.

### Use Cases And Variants
- Primario: original→validación→revisión→matching→recepción real/eventos autorizados→conciliación→elegibilidad fiscal→borrador/aprobación→obligación/pagos→cierre y export.
- Alterno: sin OC; PDF/imagen con extracción editable; factura antes/después de mercancía; varias OC o facturas; nota crédito; receptor fiscal consolidado.
- Bloqueado: tenant/NIT ajeno, evidencia insuficiente, XML malicioso, impuesto desconocido, sobreaplicación de créditos, período cerrado, identidad firmante incorrecta, proveedor no configurado.
- Históricos: enlazar fuentes probadas y no borrar/reemitir asientos; puente legacy incierto permanece visible y pendiente.

### Edge Cases
Reentrega manual/webhook/correo/poll; mismo número entre proveedores; CUFE repetido con contenido conflictivo; OCR parcial; cantidades fraccionarias/UoM; impuestos incluidos múltiples; timeout con resultado externo desconocido; competencia entre workers/aprobaciones; crédito compartido; abono/reverso y períodos fiscales distintos de creación OC.

### Acceptance Criteria
- Usuario ve originales/fuentes/exclusiones y puede recorrer documento↔compra↔recepción↔CxP↔asiento↔declaración.
- Intake/matching reintentados no duplican stock, IVA, asiento ni deuda.
- UI/API/borrador/obligación/auxiliar/XLSX coinciden según estado y período; cada diferencia tiene explicación trazable.
- Manual, automático y OCR producen el mismo contrato normalizado y revisión sin falsa aceptación.
- Pagos parciales, créditos y reversos cuadran centavo a centavo y sobreviven recarga/cambio de scope sin datos cruzados.

### Risks / Critical Decisions
Las decisiones D03–D12 siguientes afectan obligaciones legales/contables/datos. Se mantienen controles de autorización y fail-closed; la autonomía del desarrollo no equivale a autorización de operaciones reales externas.

### Candidate Skills For Planning
`how-to-plan`, `how-to-dev`, `sopus`, `parallel`, `vendix-fiscal-scope`, `vendix-operating-scope`, `vendix-prisma-scopes`, `vendix-tax-typing`, `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-ai-engine`, `vendix-ai-queue`, `vendix-report-xlsx`, `how-to-test`, skills frontend/validación/archivos/autorización.

### Handoff To how-to-plan
Plan completo en `docs/plans/received-documents-tax-consolidation-plan.md`. La instrucción del usuario ya autoriza plan+ejecución autónoma; el bloque estándar de Approval Request se conserva como formato, no como una nueva espera obligatoria que contradiga esa autorización.

## Decisiones tomadas

| ID | Decisión | Motivo / alternativa descartada | Qué puede revisar el usuario |
|---|---|---|---|
| D01 | Tab primaria recibidos dentro Facturación, compartida tienda/org | Preferencia explícita; no esconder originales bajo una OC | Etiqueta/orden de tabs |
| D02 | Dominio compartido separado de emitidos, con enlaces explícitos | Números iguales de varios proveedores y diferencias de lifecycle | Organización visual, no mezclar identidades |
| D03 | Intake no modifica stock/CxP/asientos; conciliación confirma efectos | Evitar recepción/deuda/impuesto duplicado | Política de conciliación automática inequívoca |
| D04 | IA transcribe/sugiere; determinismo calcula; OCR requiere revisión | Evidencia y aceptación legal no se delegan al modelo | Umbrales de confianza y tolerancias |
| D05 | Acuse, entrega y aceptación separados; aceptación expresa manual/autorizada por defecto | No convertir coincidencia administrativa en acto jurídico | Autoacuse/autorreglas de aprobación explícitas |
| D06 | 034 sólo observado del emisor en bandeja receptora | No atribuir evento del emisor al comprador | Alertas/plazos; no cambiar el responsable legal |
| D07 | Webhook autenticado/polling configurado y adaptador correo real; cursor y secretos cifrados | No prometer API DIAN universal por NIT ni fuente no probada | Canal/proveedor y frecuencia |
| D08 | Impuesto por NIT/familia/jurisdicción/período; ningún neto universal | Distinguir créditos y obligaciones incompatibles | Reglas legales específicas con evidencia |
| D09 | Reusar/completar calculador de declaraciones para preview y reportes | No crear una tercera cifra fiscal paralela | Presentación/indicadores, no fórmula duplicada |
| D10 | Anticipos, arrastres y retenciones sufridas con procedencia y aplicaciones transaccionales | Impedir doble uso o descuento contra impuesto ajeno | Política de aplicación/revisión |
| D11 | Pago tributario estructurado por obligación, con abonos/reverso/evidencia | Metadata status paid no prueba cancelación de deuda | Métodos/cuentas y autorizaciones de registro |
| D12 | Cierre por conciliación y snapshots; pago futuro no bloquea cierre de causación | No confundir cierre contable con vencimiento de obligación | Checks/overrides auditados |
| D13 | Calendario verificable/versionado y warning bloqueante de fechas no confirmadas | Día20 genérico no es vencimiento legal | Calendario municipal/excepciones concretas |
| D14 | Capacidades de plan y RBAC, sin hardcodear Business | Separar licencia de permisos y obligaciones fiscales | Comercialización/cupos |
| D15 | Migraciones aditivas/idempotentes y FKs RESTRICT | Conservar originales/históricos y seguridad de despliegue | Ninguna eliminación de datos aprobada |
| D16 | Sólo local y QA no productivo; commits incrementales auditados | Mandato del usuario y árbol compartido | Cuándo publicar/desplegar después |
| D17 | Resumen muestra estimado/revisado/declarado/pagado y cobertura | No ocultar fuente incompleta tras número aparentemente definitivo | Diseño de alertas y filtros |
| D18 | «salud por pagar» se interpreta como «saldo por pagar» | Contexto de impuestos; preservar salud/PILA ya existente | Confirmar si quiso una ampliación específica de salud |
| D19 | Validar montos con el perfil DIAN, no la ecuación UBL genérica | En anexo 1.9, TaxInclusive=LineExtension+impuestos directos y Payable=Inclusive−descuentos globales+cargos; anticipos/retenciones son informativos | Perfil por jurisdicción si se amplía fuera de Colombia |
| D20 | Originales locales sólo en desarrollo/pruebas; S3 en producción | QA no debe escribir al bucket productivo; driver local se rechaza en producción y cada descarga comprueba SHA-256 | Bucket y retención de originales por ambiente |
| D21 | Preservar tienda operacional aparte de entidad fiscal consolidada | Resolver fiscal puede devolver store_id=null; eso no autoriza al usuario de tienda a ver todas las sucursales | Vista consolidada sólo con contexto organización autorizado |
| D22 | Recibir documentos no requiere habilitación del flujo de emisión DIAN | Un comprador puede recibir sin emitir; JWT, RBAC, scope y compuerta de suscripción siguen vigentes | Visibilidad comercial por capacidades, no habilitación de ventas |
| D23 | OCR canonicaliza identidad y conserva alias histórico del duplicado | UUID repetido no crea segunda factura; originales se copian mediante storage autorizado al ID canónico, no moviendo FKs con keys ajenas | Presentación de duplicados y resolución humana de conflictos |
| D24 | Obligación única por entidad/tipo/rango/jurisdicción; deadline desconocido es NULL | Month/quarter nullable no protegen annual ni municipio y una fecha inventada no es vencimiento legal | Calendarios de nuevos años y jurisdicciones |
| D25 | Clasificar IBUA 34 e ICUI 35 con fuente DIAN primaria; redondear half-to-even | Resuelve la incertidumbre del helper legacy y preserva tributos distintos de IVA y base nominal | Ampliar catálogo sólo con evidencia oficial |

| D26 | PDF.js directo con canvas acotado y limpieza explícita; no wrapper que oculte recursos | PDF multipágina real requiere límites antes de asignar memoria y Node20 compatible; sharp sólo prepara imágenes | 10p/10MiB; viewport2048px/8MP, internals8192px/40MP y agregado64MP. Reset libera superficie antes de redimensionar |
| D27 | OCR requiere tienda operacional elegida aunque el NIT sea consolidado | Cuotas/suscripción pertenecen a tienda; no cobrar a la primera tienda arbitraria ni ejecutar sin cuota | Política de facturación de IA org futura |
| D28 | Preview y declaración comparten cálculo, y lectura no produce borrador | Un segundo motor divergiría; preview preliminar se etiqueta hasta completar elegibilidad/créditos/todas familias | No presentar estimación como saldo definitivo |
| D29 | Captura/revisión humana admite base nominal IBUA explícita y completa | No dejar impuestos nominales perpetuamente imposibles de corregir; p0–2 y fórmula del parser DIAN, sin convertir unidades a pesos | Ampliar familias nominales sólo con perfil técnico verificado |
| D30 | VAT autoritativo exige clasificación explícita y base de cada fila IVA | El fallback legacy `null→iva` no es evidencia de naturaleza fiscal; desconocidos se excluyen con error/IDs y bloquean nueva aprobación sin reescribir históricos | Clasificar históricos con evidencia, nunca heurística silenciosa |
| D31 | QA OCR usa organización aislada local con trial canónico y dueño autorizado | No modificar licencias/planes de clientes ni fabricar JWT para forzar un PASS; no correo, DIAN, pago o dominios externos | Fixture de prueba local, no configuración productiva |
| D32 | Conector HTTPS fija IP validada para la conexión TLS, no sólo valida DNS antes de fetch | Evita DNS rebinding; no redirects, compresión ni puertos alternos; límite5MiB/deadline10s y errores sin secretos | Límites/protocolo de proveedor se documentarán al integrar CRUD/sync; transporte solo no es sincronización |

## Fuentes oficiales consultadas

- [Resolución DIAN 227 de 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm): entrega de documentos y confirmaciones de recepción en ventas a crédito; revisar art. 1.5.4.9.1. No implica descubrimiento universal automático de facturas por NIT.
- [Decreto 1154 de 2020](https://www.cancilleria.gov.co/normograma/compilacion/docs/decreto_1154_2020.htm): separación de aceptación y constancia del emisor; plazo general ligado a recepción de bienes/servicios, no al OCR.
- [Documentación técnica DIAN](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documentacion-tecnica/): contratos UBL/eventos y anexo 1.9 vigente consultado.
- [Calendario tributario DIAN 2026](https://www.dian.gov.co/Calendarios/Calendario_Tributario_2026.pdf): fechas nacionales por dígitos del NIT y periodicidad; no sustituye calendario municipal/excepciones.
- [Concepto DIAN 7762 de 2025](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_7762_2025.htm): distinguir causación IVA de recaudo efectivo.
- [Concepto DIAN 9471 de 2026](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_9471_2026.htm): eventos/aceptación diferenciados; no presentar registro local como validación electrónica.
- [Concepto DIAN 19339 de 2023](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_19339_2023.htm): códigos XML IBUA 34 e ICUI 35. El anexo 1.9 consultado establece half-to-even y ajuste explícito de redondeo; no aplicar una ecuación UBL genérica incompatible.

- [PDF.js ejemplos oficiales](https://mozilla.github.io/pdf.js/examples/): carga/documentos/páginas/render; API5.4.624 y Node>=20.16 verificados contra package distribuido.
- [pdf-to-img](https://github.com/k-yle/pdf-to-img): wrapper evaluado; versión5 distribuida no expone destroy ni control previo de canvas, por eso se usa PDF.js directo.
- [Estatuto Tributario, compilación DIAN](https://normograma.dian.gov.co/dian/compilacion/docs/estatuto_tributario.htm): arts. 484–490 distinguen ajustes, IVA retenido, requisitos y proporcionalidad de descontables. La aceptación del documento por sí sola no demuestra elegibilidad; permanece pendiente completar esta capa antes de presentar cifras definitivas.

## Registro de cambios de decisión

- 30-09-2026: se conserva la corrección UI del usuario: recibidos en Facturación, no OC. La ejecución autónoma sustituye la fase previa de sólo propuesta; no implica presentación/pago legal automático productivo.
- Las decisiones adicionales se añadirán aquí con evidencia y motivo, sin borrar las anteriores.

### D33 — Navegación de lectura sin habilitar emisión

Se conserva una sola entrada Facturación. Si fiscal scope/activación impiden el módulo completo, sólo permiso exacto de lectura de recibidos y panel personal/techo de tienda/industria/modalidad habilitados permiten dirigirla a Documentos recibidos. El padre Fiscal no decide el scope de sus hijos; Contabilidad/Nómina/emisión mantienen sus gates. No se activa DIAN para navegar. E2E STORE verificada; la primera ORG detectó ausencia del catálogo, corregida por D37 y verificada con login/selector reales.

### D34 — Configuración versionada y leases de conectores

Nuevas conexiones requieren actor y tienda operativa explícita, también en organización consolidada. Endpoint HTTPS público y secretos cifrados; webhook requiere HMAC secret, nunca UUID como autorización. Configuración usa expected_version y rechaza lease activo; rotar endpoint/secreto reinicia cursor. Nueva migración aditiva probada dos veces en transacción con rollback y aplicada sólo DB local vendix_db; clientes host7.8.0/Docker7.4.1 regenerados. Worker/scheduler/cursor no están implementados todavía.

### D35 — Acceso a configuración de conexiones

Listar/detallar/crear/editar conexiones y ver ejecuciones mediante sus rutas de configuración requiere permiso propio `invoicing:received:connections:configure` o equivalente organization. Owners/admins reciben esta capacidad; manager/supervisor/cashier no la heredan por lectura de documentos. Endpoint/token público son metadatos de configuración y nunca se exponen por permiso genérico de lectura del inbox. Permisos de sincronización se añadirán al conectar el worker, no como función fingida.

### D36 — Auditoría de configuración atómica y sin credenciales

Create/update de conexiones debe guardar audit_logs en la misma transacción; el servicio de auditoría común es best-effort y el interceptor global no reconoce este recurso. Snapshots permitidos: versión/tipo/enable/interval/has_secret/store/entity y flags de rotación; no endpoint, public_token, cursor, settings, secretos/ciphertext ni body. Falla de audit revierte el cambio. RequestID sólo ALS válido, nunca fallback inventado.

### D37 — Curación de Facturación en ORG_ADMIN

La E2E federada ORG detectó que el módulo siempre-visible legado no tenía key `invoicing` en defaults/catálogo ORG. Se añade la misma key existente a ORG_ADMIN, no otro módulo/sidebar. `default_visible_for_privileged_users=true`: recepción del módulo existente debe ser descubrible. `show_new_badge=yes`: descubrimiento por banner/settings, nunca sidebar. Soft merge preserva false explícito y roles no privilegiados, sin backfill ni seed general. No debilitar rawtrue del fallback para tapar la ausencia.

### D38 — Protocolo de ingreso automático y ejecución durable

El adaptador API de Vendix define un envelope JSON version1 con documents[external_id,file_name,mime_type,content_base64] y next_cursor obligatorio string|null. No se asume una API universal DIAN. El transporte y webhook admiten hasta5MiB por batch/10documentos, base64 canónico y originales válidos; documentos individuales siguen el límite10MiB del intake. XML no consume IA; PDF/foto usa la cola OCR existente y su gate/cuota.

Webhook requiere HMAC-SHA256 de timestamp.event_id.raw_bytes, UUIDeventid y ±300s, no autorización por UUID público. Run guarda connection_version y payload firmado durable hasta procesarlo; la cola sólo recibe runID. Ack202 sólo después de persistencia; un fallo de Redis no pierde el ingreso y el scheduler recupera outbox. Replay mismoevent/hash devuelve mismo run; hash distinto bajo mismoevent se rechaza.

Lease120s/heartbeat30s excluye ejecución concurrente; versión/token se comprueban en cursor commit. Cursor sólo avanza después de TODOS los originales y trabajos OCR durables, no por respuesta del proveedor ni extracción parcial. Fallo conserva cursor; retry usa misma fuente/dedup. Contexto worker se resuelve por conexión/store/org y entidad fiscal vigente en lectura, sin crear entidades ni heredar JWT/superadmin. Ingest no mueve stock/AP/asientos/eventos legales. Pausa explícita y estado de suscripción bloquean nuevas ejecuciones; OCR conserva su capacidad independiente. IMAP y gating de capacidades del catálogo comercial se completan en su segmento, sin fingir soporte actual.

### D39 — Semántica del cursor nulo en sondeo API

En un sondeo API, `next_cursor: null` significa fin de páginas, **no** escribir `connection.cursor = null`: conservar el último checkpoint durable evita volver al inicio del historial. Si la página trae documentos pero cursor nulo, el proveedor no ofrece checkpoint de avance y la ejecución queda parcial/para revisión, con cursor sin cambios. Un webhook sí puede entregar documentos con `next_cursor: null`, porque no pagina. El ingester sólo propone el cursor; el worker lo confirma cuando todos los originales y trabajos OCR de la página son durables. Un límite por ejecución de 10 páginas/100 documentos debe conservar el último cursor válido y programar continuación inmediata si quedan páginas; no esperar el intervalo normal.

### D40 — Reintentos acotados y recuperación del outbox

La base de datos es la fuente durable de ejecuciones; Redis sólo transporta `run_id`. BullMQ hace máximo tres intentos con backoff exponencial sobre el **mismo run**. El scheduler recupera pendientes/en cola y procesos cuyo lease expiró, además de sondeos API vencidos. No vuelve a crear indefinidamente trabajos fallidos/parciales agotados: quedan visibles para reintento autorizado del mismo run o resolución administrativa. Esto evita tráfico sin límite y posibles cobros OCR reiterados; jamás se abre un nuevo sondeo API mientras uno anterior siga sin resolver.

### D41 — Acuse HTTP tras persistencia, independiente de Redis

El webhook público POST `/api/public/received-documents/webhook/:publicToken` recibe los bytes originales y cabeceras `x-vendix-timestamp`, `x-vendix-event-id` y `x-vendix-signature`; sólo HMAC y validaciones previas autorizan persistir. Tras el commit durable del run se responde 202 incluso si encolar en Redis falla, indicando `queued:false`; el scheduler recupera el outbox pendiente. Un disparo manual recién creado sigue la misma semántica. En cambio, el reintento explícito de un run agotado fallido/parcial devuelve error seguro si Redis falla, porque el scheduler D40 no lo reencola automáticamente. Ninguna respuesta devuelve secreto, token público, firma ni contenido.

### D42 — Configuración bloqueada ante ejecución sin resolver

Antes de editar una conexión, la transacción bloquea su fila y comprueba si conserva un run `pending`, `queued`, `running`, `failed` o `partial`. En ese caso devuelve conflicto incluso si el lease ya es nulo: rotar secretos, endpoint, cursor o versión dejaría el outbox anterior sin ruta de recuperación. La operación debe completarse/reintentarse sobre el mismo run o resolverse mediante una cancelación explícita y auditada futura. Nunca se cancela silenciosamente un documento recibido al deshabilitar el conector.

### D43 — Cancelación explícita de ejecución irresoluble

Para poder corregir un conector tras un fallo permanente, un usuario autorizado puede cancelar **ese run** con motivo obligatorio y auditoría atómica. La transacción bloquea primero conexión y después run, rechaza un proceso activo y sólo admite `pending`, `queued`, `failed`, `partial` o `running` con lease vencido. Conserva hash, conteos y documentos ya persistidos; limpia el payload de ingreso que no se procesará, deja cursor intacto y pausa el siguiente sondeo hasta corrección/solicitud manual. Un trabajo Bull que llegue tarde verá el estado terminal. La UI debe advertir que puede descartarse contenido no procesado; jamás se cancela silenciosamente ni como reacción automática al vencimiento.

### D44 — Matching tridireccional por asignaciones de línea

Los `received_document_links` existentes sirven como navegación/evidencia agregada, **no** como fuente de cantidades: no contienen línea ni recepción parcial. Una tabla nueva de asignaciones activa/revocada relacionará cada línea del documento con una rama comercial excluyente: ítem de OC (y opcionalmente ítem de recepción física), o gasto/ítem de gasto. Guardará cantidades fuente/destino, unidades explícitas, monto neto/moneda, idempotencia, actor, motivo de revocación y evidencia. Un detalle hijo relacionará impuestos de la línea con el monto asignado, sin marcar elegibilidad fiscal por el mero match. DB protege forma/FKs/duplicados; el servicio bloquea filas de origen y destino en orden estable, recalcula sumas **activas** y rechaza sobrerreparto concurrente. Para OC sin moneda explícita, sólo COP sin conversión implícita; UoM desconocida y almacén central sin tienda requieren revisión. Confirmar correspondencia **no** llama `receive()`, no incrementa inventario, no crea CxP/asiento/IVA, ni emite aceptación legal.

### D45 — Interacción y comandos del matching

La gestión principal estará en **Fiscal → Facturación → Documentos recibidos → detalle → Conciliación**, no en la acción de recibir mercancía de una OC. Un GET acotado propone candidatos con razones visibles y nunca confirma por similitud. Cada POST confirma **una** asignación de línea con clave idempotente y versión esperada del documento; la relación N:M se construye con varias asignaciones reversibles, evitando fingir atomicidad de una selección múltiple mientras el esquema garantiza clave única por asignación. Un segundo comando revoca con motivo y actor sin borrar la historia. El servicio recalcula el saldo por línea y objetivo bajo bloqueo, así como el estado comercial `unlinked`/`partially_linked`/`linked`; la UI muestra por separado si la recepción física sigue pendiente. El match no declara por sí mismo impuesto descontable ni aceptación DIAN. La edición posterior de hechos que reemplazaría líneas/impuestos se bloquea con conflicto explícito si existe cualquier asignación histórica, incluso revocada; las notas de revisión permanecen editables.

### D46 — Permisos iniciales de conciliación y alcance de lectura

Leer candidatos e historial usa el permiso existente de lectura de documentos recibidos; **confirmar** y **revocar** tienen permisos separados por ruta y por ámbito STORE/ORGANIZATION. Inicialmente sólo owner/admin reciben ambos permisos de escritura: manager conserva lectura/importación/revisión de tienda pero no vincula comercialmente con OC/gasto, y fiscal_supervisor conserva lectura sin mutación. La aprobación fiscal, el asiento, el acuse y la recepción física tendrán autorizaciones propias posteriores. No se otorga permiso de escritura por ocultar/mostrar botones: el backend protege cada comando con RBAC y contexto fiscal, y la UI sólo refleja esa autorización.

### D47 — Confirmación humana de línea, recepción y reintento en UI

La comparación sugiere, pero **el operador autorizado selecciona expresamente** la línea fuente, línea OC o gasto, y opcionalmente la línea de recepción física existente; una OC `approved` sin recepción se puede vincular comercialmente sin afirmar que llegó mercancía. El formulario muestra saldo fuente y destino, cantidades/unidades y neto como texto decimal exacto, requiere motivo cuando la unidad destino no está respaldada por el snapshot de OC o hay conversión manual, y presenta una confirmación explícita antes del POST. La clave UUID de comando permanece estable ante timeout/reintento del mismo payload y sólo cambia si se edita el payload o tras éxito; un conflicto 409 obliga a recargar/revisar, nunca a reintentar automáticamente con una versión nueva. Revocar exige motivo, confirmación y deja historia. La UI no calcula impuesto elegible, crea recibos físicos ni dispara eventos DIAN al confirmar.

### D48 — Búsqueda manual de gastos sin identidad de proveedor

Como `expenses` no persiste NIT ni número de factura del proveedor, Vendix **no** los presentará como coincidencia automática ni como validación fiscal. Un endpoint de búsqueda/manual del documento recibido mostrará únicamente gastos compatibles por organización, entidad fiscal/tienda y moneda, ordenados por fecha y limitados por página, con descripción/fecha/importe/ítems y saldo ya asignado; la fecha es contexto, no un corte silencioso. El usuario elige explícitamente y documenta motivo/unidad. Rechazados, cancelados y reintegrados no son destino elegible. El vínculo con un gasto es evidencia comercial provisional, no crea CxP duplicada, no vuelve a postear su asiento y no autoriza IVA descontable sin comprobación separada de fuente/documento.

### D49 — Adaptador de eventos DIAN como comprador y timeout desconocido

El servicio actual `DianEventsService` pertenece a **facturas emitidas** (`invoices.id`) y no se reutiliza directamente para `received_documents.id`: en una factura proveedor el emisor referenciado es el proveedor y quien genera/firma los eventos de comprador es la entidad fiscal del tenant. Un adaptador aparte podrá aprovechar UBL/CUDE/firma/SOAP tras verificar identidad NIT, certificado y configuración del comprador. `030` acuse, `032` recibo real del bien/servicio, `031` reclamo y `033` aceptación expresa requieren acciones/prerrequisitos jurídicos diferenciados; `034` aceptación tácita se **observa** como evento del emisor, jamás la emite Vendix en nombre del comprador. Ni llegada, match, OCR ni recepción de OC disparan aceptación expresa automáticamente. Cada intento persiste inputs/CUDE/identidad inmutables antes del envío; timeout o respuesta perdida queda **desconocido para conciliación**, no rechazado ni apto para generar otro CUDE. El [Anexo Técnico DIAN FEV v1.9 §7.17, pp. 363–366](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf) documenta `GetStatusEvent` con `TrackID` igual al **CUFE de la factura**, no al CUDE del evento; el cliente SOAP ahora implementa la llamada, pero la consulta sigue siendo a nivel de factura: no prueba por sí sola la existencia ni ausencia de un evento individual/CUDE. Su respuesta contiene estado y `XmlBase64Bytes` con ApplicationResponse, pero no expone código/número/CUDE del evento en campos superiores ni define una lista vacía concluyente; `StatusCode=90` significa CUFE no encontrado, **no** ausencia probada de un evento individual. La conciliación sólo podrá confirmar un evento tras decodificar/verificar identidad exacta del contenido y probar semántica/visibilidad en habilitación; de otro modo la consulta es inconclusa. Ausencia o respuesta inconclusa no autorizan reenvío automático: se bloquea y se ofrece conciliación manual. Un reintento definitivo reutiliza el mismo payload/CUDE inmutables. Sin proveedor/certificado habilitado, la UI muestra pendiente/no configurado y no simula transmisión.

### D50 — Dirección del IVA de documentos equivalentes, sin fallback deducible

El cálculo actual de IVA usa un `else deductible` para cualquier `invoice_type` que no esté en la lista de ventas. Eso clasifica el **POS electrónico** como IVA descontable, pese a ser un documento equivalente **de venta**; se corrige para tratar `pos_equivalent_document` como IVA generado únicamente cuando el documento y la validación electrónica consten `accepted`. Borradores/validados sin aceptación y `dian_status=not_applicable` no pasan por esta ruta POS. El único `equivalent_adjustment_note` de la tabla mezcla notas de ajuste DIAN **93 débito y 94 crédito** sin un subtipo de signo persistido y confiable; mientras no se modele, sus filas IVA quedan **excluidas con error bloqueante e ID**, no como deducibles ni con signo supuesto. Tipos desconocidos también quedan excluidos con error, jamás caen al lado de compras. Esta corrección puntual no agrega aún `received_document_taxes`, créditos ni anticipos y no declara resuelta la matriz de estados de todos los tipos legacy; esa revisión debe preceder el consolidado final. Referencias: [Resolución DIAN 165/2023](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm) y [documento equivalente electrónico DIAN](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Abece-POS-Electronico-documento-equivalente.pdf).

### D51 — Posición fiscal separada de pago y de completitud de fuentes

El panel Business mostrará **por contribuyente/entidad fiscal, impuesto, jurisdicción y período**, nunca un neto que compense indiscriminadamente IVA, renta, ICA, INC o retenciones. Para IVA, el cálculo operativo distingue `IVA generado − IVA descontable = saldo del período`; después muestra **por separado** saldo a favor anterior, retenciones de IVA sufridas y créditos/anticipos **calificados y aplicados** para llegar a la posición del impuesto. Sanciones/intereses, si existen, se muestran aparte. **Los pagos no reducen el impuesto causado**: reducen el saldo de la obligación ya determinada, con reversos y sobrepagos explícitos. La [versión oficial disponible del formulario DIAN 300 (2025)](https://www.dian.gov.co/atencionciudadano/formulariosinstructivos/Formularios/2025/Formulario_300_2025.pdf) separa generado, descontable, saldo del período, saldo anterior, retenciones de IVA y pago; Vendix versionará la regla por año antes de equipararla a una declaración formal. En renta, ICA y demás familias se usarán sus propias reglas, no la fórmula de IVA. Si la fuente recibida está pendiente, un tributo no tiene tipificación/soporte, o existe posible duplicado entre factura recibida y soporte materializado por OC, la UI mostrará **cifras parciales y bloqueo de «neto definitivo»**, con fuentes excluidas y motivo; no completará ausencias con cero ni acreditará IVA por el solo match. La licencia comercial habilita visibilidad/capacidad, no cambia estas reglas fiscales, y «Business» no se hardcodea como plan inexistente.

### D52 — Activación por cliente: bandeja, fuente y eventos comprador separados

La activación de Documentos recibidos ocurre por **entidad fiscal/NIT** y no hereda ciegamente la habilitación de emisión: (1) capacidad comercial, RBAC y contexto fiscal habilitan lectura/importación manual; (2) recepción automática requiere una fuente realmente configurada y comprobada por cada cliente — proveedor compatible por API/webhook, o correo de recepción cuando exista un adaptador operativo — con consentimiento, credenciales, prueba y sincronización verificable; (3) transmisión de eventos comprador exige confirmar la habilitación/capacidad DIAN del adquirente, medio de operación, identidad y firma antes de ofrecer acciones legales; (4) consolidación Business habilita vistas y cuotas, **no** modifica la validez fiscal del documento. Ningún paso se infiere por conocer el NIT, por un conector guardado pero no probado, ni por estar habilitado para emitir otro tipo documental. La UI de Facturación → Documentos recibidos mostrará estados independientes y CTA específicos: bandeja disponible, fuente no configurada/conectada/con error y eventos DIAN no habilitados/habilitados; nunca un único «activado» ambiguo.

La [DIAN documenta la entrega al correo de recepción registrado y la interoperabilidad acordada entre servidores](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/presentacion-recepcion-de-facturas-electronica/), por lo que se corrige la lectura excesiva de «no depender del correo»: no será la **única** fuente ni se presentará como inbox universal de DIAN, pero sí debe poder configurarse cuando el adaptador exista. La [Resolución 227 de 2025, art. 1.5.4.9.1](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm) exige habilitación para ciertos compradores no obligados a facturar que remiten confirmaciones de recibido en operaciones a crédito; para quienes ya facturan o participan en RADIAN se verificará si sus datos/habilitación son convalidables, sin crear una habilitación duplicada por defecto. El software actual sólo ofrece conexiones `api_poll`/`webhook` y los cuatro ejes DIAN emisores; mientras no existan el adaptador correo y el flujo de eventos comprador completos, la UI debe declarar esas capacidades pendientes, no simularlas.

### D53 — Preparación durable y veredicto DIAN por CUDE exacto

El adaptador de eventos comprador separa **preparar/firmar** de **transmitir**: genera CUDE, XML firmado, hash SHA-256, nombres de archivo e identidad de configuración/certificado sin tocar la red DIAN. El dominio recibido debe guardar ese artefacto y el intento **antes** de invocar `SendEventUpdateStatus`; los reintentos, si una conciliación los autoriza, usan exactamente el mismo XML/CUDE y jamás vuelven a calcularlos. Un cambio de entidad fiscal, configuración, ambiente, software o certificado entre preparación y envío bloquea la transmisión antes de SOAP. La ruta antigua de eventos sobre facturas **emitidas** conserva su contrato; no se mezcla con `received_documents.id`.

Una respuesta de `SendEventUpdateStatus` es **aceptada** sólo con `IsValid=true`, `StatusCode=00` y el `XmlDocumentKey` del resultado SOAP igual al CUDE preparado; es **rechazada** sólo con rechazo DIAN explícito (`IsValid=false`, código 99, regla de rechazo) y el mismo CUDE. Timeout, falla de parseo, respuesta sin clave o con otra clave, SOAP Fault y «procesado anteriormente» quedan **desconocidos** para conciliación; no autorizan reenvío automático. El [Anexo Técnico FEV DIAN v1.9 §7.13.3, pp. 350–352](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf) identifica `XmlDocumentKey` como TrackId/CUDE del instrumento procesado. El parser común puede extraer antes un UUID del ApplicationResponse devuelto; por eso el veredicto comprador lee la clave del **resultado SOAP** y comprueba su identidad exacta. Un fallo al escribir auditoría después de la respuesta no transforma una aceptación real en rechazo o desconocido: el dominio debe persistir la respuesta y señalar aparte el fallo de auditoría. El contrato de transporte y, desde `3fd64bf95`/`0dc9e50e6`/`348a6f30e`, la reserva durable, snapshot, dispatch de una sola ejecución, API protegida y UI del detalle están implementados. Sigue pendiente una prueba real con DIAN; envío `sending`/`unknown` no se reintenta automáticamente ni se infiere éxito por `GetStatusEvent`.

### D54 — Registro de habilitación comprador por NIT fiscal, sin quinto eje emisor

La habilitación para transmitir 030–033 se registra en `received_buyer_event_enablements` con **una fila por entidad contable fiscal/NIT**, no como un quinto `dian_configuration_type_enum`: esos cuatro ejes actuales siempre corresponden a un documento **emitido** y su matriz convertiría erróneamente el eje comprador en factura de venta. La fila mantiene estado `not_started/testing/verified/suspended`, códigos permitidos, configuración DIAN de software propio vinculada, evidencia fiscal del mismo NIT, fuente de verificación, revisor, fecha, versión y snapshots de `software_id`/huella del certificado. Una verificación requiere todos esos datos; el estado `verified` no implica por sí solo que se pueda enviar.

En **cada consulta y justo antes de transmitir**, el backend recalcula la disponibilidad: contexto autenticado, entidad activa, NIT/DV coincidente, código autorizado, evidencia de habilitación pertinente, configuración de la misma organización/entidad con `invoicing`/`own_software` habilitada en producción, software/huella sin rotación, certificado vigente y material P12/credencial WS disponible. La falta o discrepancia de cualquiera bloquea, y la respuesta de lectura devuelve sólo códigos de bloqueo, nunca secreto, key S3 ni XML. La [Resolución 227 de 2025, arts. 1.5.4.6.1 y 1.5.4.9.1](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm) contempla habilitación de eventos y la convalidación de datos donde aplique, sin convertir recepción de facturas en emisión automática. Registro y lector fail-closed están codificados. La solicitud/estado/readiness/options del tenant y la revisión/lista/detalle/suspensión de plataforma ya tienen servicios y rutas protegidas; el cliente también tiene panel para consultar opciones, estado y solicitar. La revisión es una atestación de operador, no verificación independiente del contenido probatorio dentro de Vendix. La verificación previa de disponibilidad se conecta al dispatch de una sola ejecución implementado después; no convierte `verified` en evidencia de autorización DIAN efectiva ni sustituye la respuesta DIAN.

### D55 — Solicitud del cliente y revisión independiente de eventos comprador

El titular autorizado solicita la activación **para su entidad fiscal** con configuración DIAN, evidencia y códigos 030–033 explícitos; el comando exige versión esperada, serializa por entidad, comprueba las dos referencias en la misma organización/NIT y guarda `testing` con auditoría transaccional. Toda nueva solicitud, incluso desde `verified`, borra la verificación y bloquea el envío hasta una revisión nueva. El cliente no puede auto-marcarse `verified` ni activar eventos por tener acceso a la bandeja o por conectar un origen de recepción.

La revisión corresponde a un operador de plataforma separado del cliente, con rol/permiso backend dedicado y nota de atestación de 20–500 caracteres tras inspeccionar evidencia DIAN real. El `fiscal_evidence` existente guarda metadatos de `storage_key`/`content_hash` aportados por el caller; **su mera existencia no acredita** habilitación. Antes de aprobar se comprueban entidad activa, NIT/DV, códigos, configuración `invoicing` de software propio habilitada en producción, firma/certificado vigente y evidencia pertinente del mismo alcance. Se congelan ID de software y huella del certificado para detectar rotación posterior; el gate de envío vuelve a evaluarlo en cada operación. Plataforma puede suspender `testing` o `verified` con motivo y auditoría, incluso si la entidad fiscal ya está inactiva; la fila conserva evidencia histórica pero readiness bloquea. Un conflicto de versión, auditoría fallida o configuración incongruente no produce aprobación parcial. Los servicios, rutas y permisos/seed de solicitud, estado, revisión, suspensión, cola y detalle ya están implementados; existen UI cliente para solicitar/consultar y UI de revisor de plataforma en Superadmin → Fiscal → Facturación → Habilitaciones. La posterior API/UI del comando comprador y el dispatch de una sola ejecución están implementados, pero no demuestran transmisión DIAN real ni verificación independiente del contenido probatorio dentro de Vendix. La migración del esquema no está desplegada a producción. El panel cliente no constituye una habilitación efectiva ni autoriza transmisión.


### D56 — Dispatch comprador explícito, con selector y persona respaldados por recepción

Los comandos comprador (`030`, `031`, `032`, `033`) son explícitos y de una sola ejecución: la reserva durable captura documento/versión/CUFE, código/número de evento, actor y versión/configuración de habilitación; el payload revalida scope organización/entidad/tienda, receptor=NIT de la entidad fiscal, emisor referenciado/proveedor, y versión/CUFE sin cambios. El selector DIAN usa la configuración autorizada de la misma entidad fiscal y la tienda concreta del documento (no “la primera tienda”); la disponibilidad y snapshot de software/huella de certificado se vuelven a comprobar antes de congelar el XML firmado. Para `030` la persona se toma del actor activo del tenant; para `032` sólo se construye si las recepciones físicas vinculadas activas resuelven exactamente a una persona receptora, de lo contrario falla cerrado. Para `031`/`033`, el actor queda registrado para auditoría, pero el payload no incluye `receipt_person`; `031` exige concepto de reclamo. El XML/CUDE, hash/identidad de configuración y primer intento se persisten antes del SOAP. Respuestas inciertas quedan `unknown` (o `sending` si no puede persistirse resultado); jamás se reenvían automáticamente ni se crea un CUDE sustituto. Estado y botones se exponen por API protegida y detalle, sin afirmar que una coincidencia comercial constituye recepción física o acto fiscal.

### D57 — Consulta `GetStatusEvent` no prueba el CUDE de un evento específico

El [Anexo Técnico FEV DIAN v1.9 §7.17](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf) describe `GetStatusEvent` consultado con `TrackId` igual al CUFE de la factura. La operación SOAP disponible en Vendix implementa esa consulta de factura; su respuesta no constituye por sí sola prueba identificable de un CUDE/evento comprador particular ni de que una respuesta sin coincidencias descarte tal evento. Por tanto los intentos compradores `sending` y `unknown` permanecen en cuarentena para conciliación; `GetStatusEvent` no autoriza reenvío ni transición automática a accepted/rejected. Sólo una respuesta de envío correlacionada con el CUDE congelado produce estado concluyente conforme al contrato D53; ausencia, timeout o consulta ambigua requiere conciliación humana. No se realizó evento DIAN real.

### D58 — Evidencia AP/GL es de vínculos, no aprobación fiscal o conciliación de montos

El endpoint de lectura agregado por `e75994c67` expone evidencia de asiento (GL), cuenta por pagar por recepción (AP), asignaciones pendientes y órdenes sin trazabilidad tributaria verificable. `financial_evidence_complete` describe cobertura de vínculos; no valida monto bruto contra factura, igualdad débito/crédito, balance, validez fiscal del documento, pago ni elegibilidad de IVA/otro impuesto. Los enlaces AP/GL son sólo evidencia de existencia/linaje: no transforman el documento en descontable ni habilitan declaración. Hasta implementar la conciliación fiscal-contable completa, las cifras fiscales permanecen pendientes/parciales.

### D59 — Autoridad fiscal recibida separada de procedencia operativa/GL

La autoridad fiscal de un documento recibido debe ser una **calificación fiscal inmutable** y sus **efectos fiscales firmados**, consumidos directamente por el lector compartido de fuentes fiscales. Esa capa canónica aún no está implementada: no existe todavía schema de calificación/efecto recibido ni el lector la consume. `purchase_vat_contributions` es una procedencia operacional/contable separada (por ejemplo, reserva derivada de recepción de OC y su enlace GL); no sustituye la calificación/efecto tributario ni prueba por sí misma IVA descontable. Una proyección `purchase_invoice` puede existir como compatibilidad, pero no es autoridad fiscal. Esta dirección corrige la recomendación anterior de D59.

La colisión legacy sigue confirmada: `materializeVatDocument` crea/reutiliza `invoices` `support_document` con clave `(accounting_entity_id, invoice_type, invoice_number)` y retorna si ya existe; proveedor no participa. Además, `invoices` requiere `store_id` y limita `invoice_number` a `VARCHAR(50)`, mientras documentos recibidos pueden ser organizacionales o tener números más largos. Esos requisitos y la unicidad no representan fielmente la identidad del documento recibido (proveedor + número + entidad/fuente), por lo que forzar esa tabla como autoridad o unión canónica no es seguro. No inferir elegibilidad ni reparar historia con heurísticas. `purchase_vat_contributions` ahora mitiga una parte de la ruta operacional, pero F2 todavía crea la fila legacy `support_document`; no existe supresión del solapamiento legacy ni prueba externa DIAN/proveedor. Cualquier consolidación histórica requiere diseño y evidencia propios.

### D60 — Reserva inmutable de contribución IVA de compras como procedencia operacional

Los commits locales `90a8cb06e`, `21cb9821f`, `d6dd59eb1`, `64c30dfd4` y `ed038cedb` añaden schema/migración local, snapshot determinista y reserva idempotente con validación de procedencia de `purchase_vat_contributions`. `27517e101` reserva en F2 antes de materializar el soporte legacy. La contribución identifica OC/recepción/proveedor/tienda/entidad y snapshots de fuente; este flujo no crea una calificación fiscal canónica del documento recibido. Sigue existiendo el soporte legacy; no hay supresión de solapamiento.

### D61 — Posteos GL contribución-keyed y compatibilidad temporal del evento

`57e31552a` agrega el método de asiento para contribución IVA de compra y `c48d6279d` vincula la contribución al asiento; `588692263` enruta el listener a la contribución nueva manteniendo compatibilidad con el evento legacy. Esto aporta una ruta operacional de provenance→GL, no vuelve a `purchase_vat_contributions` una fuente fiscal autoritativa ni prueba cobertura completa, conciliación total de montos o elegibilidad de IVA.

### D62 — Borrador fiscal reconoce cobertura recibida desconocida; estimación analítica permanece preliminar

`d9b1b785f` registra en el snapshot del borrador la cobertura de fuentes IVA recibidas como `unknown`, junto a fuentes recibidas del período y calificaciones positivas pendientes; `acd9d522f` rechaza aprobación de borradores obsoletos. La lectura API de posición puede tener éxito aun cuando esa cobertura sea desconocida; éxito HTTP no significa posición fiscal definitiva. `304f3ee3e` y `d6fb75f4e` aclaran que las dos vistas distintas —Analítica y Reportes— son estimaciones preliminares, y `50aa7a205` etiqueta el XLSX como evidencia operativa; se verificaron ambas rutas en navegador local y el export autenticado. Ningún cambio de copia corrige por sí mismo la fuente fiscal legacy.

### D63 — Corte de la proyección F2 sintética y propiedad explícita de fuentes históricas

La revisión de F2 confirmó un camino de deducción falsa: antes de `1f956bc23`, tras reservar una contribución con `fiscal_status=awaiting_document`, `materializeVatDocument` creaba o reutilizaba una fila `invoices.support_document` `validated/not_applicable`; `calculateVat` la contaba como IVA descontable sin documento recibido ni calificación fiscal inmutable. La clave de reutilización omitía proveedor, OC, monto e impuestos; dos emisores con el mismo número podían colisionar. Una falla de proyección también impedía el evento GL después de reservar. `1f956bc23` **detuvo nuevas proyecciones F2** y emite el complemento GL directamente desde la contribución, sin `invoice_id`; `9d26e4a99` actualizó el listener y `cdb2711e7` aclaró que la contribución no es autoridad fiscal. Las pruebas focales de OC/listener pasaron. La FK `purchase_vat_contributions.fiscal_projection_invoice_id` continúa sin escritor F2; las filas legacy previas permanecen, y `calculateVat` todavía puede contarlas.

Los `support_document` y `purchase_invoice` anteriores no se borran, reescriben ni se excluyen por una regla textual. El lector fiscal nuevo necesitará propiedad/supresión explícita por ID de fuente, entidad fiscal y evidencia, y bloqueará los casos ambiguos hasta conciliación humana. Una calificación de IVA recibido generará efectos fiscales firmados e inmutables consumidos directamente por el lector común; ni el matching comercial ni `ledger_status=posted` prueban elegibilidad. El `CHECK` ya aplicado de contribuciones exige `fiscal_projection_invoice_id` para marcar su `fiscal_status=qualified`: no se debe usar ese estado como autoridad fiscal ni editar la migración aplicada; si alguna vez se requiere cambiar ese contrato, será mediante una nueva migración. También debe existir una decisión explícita contra duplicar el mismo hecho entre efecto recibido y factura legacy, incluso si sus fechas difieren.

### D64 — Reconciliar asiento existente antes de reintentar un posteo de IVA

Antes de `6889007c1`/`e2c968fb4`, el retry genérico reproducía `postAutoEntry` y podía marcar resuelto un fallo tras un asiento sin enlazar `purchase_vat_contributions.accounting_entry_id`. `postAutoEntry` comprueba período cerrado/mapeos **antes** de buscar asiento existente: un posteo exitoso con enlace fallido podía quedar sin reparar tras el cierre. `6889007c1` agregó conciliación de asiento ya posteado por organización/entidad/tienda, `source_type=purchase_vat_contribution` y `source_id=contribution.id`, enlace compare-and-set y registro durable de falla de enlace posterior al posteo. `e2c968fb4` hace que la cola concilie **antes** de postear, y sólo resuelva después de verificar el enlace. Jest focalizado del servicio y procesador pasó; falta prueba de concurrencia/recuperación sobre PostgreSQL real y un outbox/reconciliador para la reserva que nunca llegó a emitir evento.

### D65 — Tres registros inmutables para autoridad fiscal recibida

La dirección de D59 se concreta en tres registros aditivos: **calificaciones tributarias** versionadas del documento recibido, **efectos IVA con signo** y **decisiones explícitas de propiedad de fuentes legacy** por `invoice_id`. Los tres se acotan por organización y entidad fiscal; la tienda puede ser nula. La calificación congela versión/hash del documento, grupos tributarios canónicos, evidencia y regla aplicada, decisión de elegibilidad parcial o rechazo, actor y período; un cambio crea una revisión sucesora, no edita la anterior. El efecto congela grupo, base/impuesto con signo, fecha fiscal, clave idempotente y referencia a la calificación; reversas y ajustes son nuevos efectos, no importes mutados. La propiedad legacy declara conservar, reemplazar, excluir con evidencia o dejar ambiguo **el IVA completo de una factura**, y puede revisarse sin borrar historia. La primera versión no hará asignación parcial de una factura legacy entre varios documentos: esos casos permanecen ambiguos hasta definir y probar su asignación.

`document_key` y `source_hash` de `received_documents` son índices, no unicidades físicas; la calificación positiva deberá exigir una identidad canónica verificada del emisor/documento y evitar dos raíces para el mismo documento importado por canales distintos. Si la identidad es incierta, se permite guardar revisión bloqueada, **no inventar una identidad elegible**. El `buildReceivedTaxBasis` existente aporta hechos cabecera/ítem sin duplicarlos, pero su hash con IDs de fila no identifica por sí solo un mismo documento entre canales. Ningún signo negativo procede automáticamente de una nota crédito; se decide por concepto/evidencia. Estas tablas y sus escritores aún no existen. Su diseño final debe validar FKs cruzadas, revisiones lineales, idempotencia, inserción inmutable y cierres de período en transacciones reales, no confiar sólo en `CHECK` por fila.

### D66 — Lector fiscal único, huella completa y aprobación/cierre atómicos

La posición IVA, borrador, aprobación, cierre y reportes deben consumir **el mismo lector** de efectos calificados y fuentes legacy con propiedad resuelta. El lector toma efectos por fecha fiscal y decide supresión/propiedad por `invoice_id` en toda la entidad, aunque factura legacy y efecto recibido caigan en períodos distintos; nunca suma IVA/INC/ICA/retenciones en un neto universal. La cobertura incluye documentos sin calificar, identidad o fecha incierta, decisiones legacy ambiguas/obsoletas, fuentes nuevas que aparecen tarde y efectos corregidos. Una cifra con cualquiera de esos bloqueos no se presenta como obligación definitiva ni se aprueba/cierra automáticamente.

El snapshot actual de aprobación sólo compara IDs/versiones/hashes de documentos recibidos **dentro del período** y cantidad sin fecha; no incluye facturas legacy, efectos, propiedad ni reglas. Además `approveDraft` comprueba y luego actualiza fuera de una transacción común: puede aprobar con datos que cambiaron entre ambas operaciones. La próxima versión congelará huella del lector, efectos/calificaciones/propiedad y reglas, verificará la misma huella bajo bloqueo y compare-and-set en aprobación y cierre, y preservará declaraciones aprobadas sin reescribir. Ese bloqueo debe abarcar **todos** los escritores de entradas fiscales legacy/nuevas y las transiciones de cierre; un lock sólo en el lector no probaría ausencia de carreras. Antes de implementar este contrato hay que inventariar los escritores reales de facturas, impuestos y reglas. Aún no existe huella v2 ni consistencia transaccional de extremo a extremo.

### D67 — Sesiones de cierre terminales no se reabren por revisión o aprobación ordinaria

`runChecks` sobrescribía siempre el estado de una sesión a `ready`/`blocked` y `approveClose` podía sobrescribirlo a `approved` sin comprobar si ya estaba `closed`/`cancelled`; la facturación consulta la sesión `closed` como parte de su barrera. Los commits `c13f96a54` y `10607623a` rechazan esos dos comandos sobre estados terminales, y `00034fc4a` prueba ambos estados/ambos comandos sin evaluación, transacción ni escritura (**8/8** focales). Es una protección puntual: `runChecks` y el cierre todavía necesitan compare-and-set/bloqueo de entidad para evitar carreras con fuentes y con la propia transición de cierre. `fiscal_periods` y `fiscal_close_sessions` siguen siendo dos autoridades que deben conciliarse.
