## Context

Vendix necesita una bandeja persistente de facturas de proveedores recibidas manualmente o mediante integraciones automáticas, extracción asistida con IA y conciliación con sus compras, gastos, recepciones y cuentas por pagar. El usuario eligió **Fiscal → Facturación → Documentos recibidos** y autorizó crear y ejecutar el plan de forma autónoma, decidir lo recomendado, trabajar en la rama actual y hacer commits locales **sin push**. El baseline comprobado es `develop`, `724fa852c383e6361c390b551a976d46fa770a08`, limpio e igual a `origin/develop`; se importó Engram. La revisión encontró mezcla de impuestos/roles en la posición tributaria, reconocimiento interno de IVA de compras que debe conciliarse con el documento original, períodos y calendario incompletos y pagos tributarios sin detalle durable. Este plan preserva el objetivo completo, no es un MVP; decisiones y evidencia se registran por separado en `docs/received-documents-tax-decisions.md` y `docs/received-documents-tax-validation.md`.

## General Objective

Entregar un flujo auditable y verificado desde la recepción de documentos hasta su conciliación operativa, contabilización única, consolidación tributaria por contribuyente/impuesto/período, anticipos/créditos, obligaciones y pagos, declaración, cierre y reportes coherentes.

## Specific Objectives

1. Importar XML UBL/AttachedDocument, PDF multipágina e imágenes, o capturar manualmente documentos, preservando originales, emisor/receptor, referencias, líneas e impuestos; distinguir evidencia electrónica de transcripción/OCR.
2. Recibir automáticamente mediante webhook autenticado y sincronización programada de conectores autorizados, con cursor, ejecuciones, reintentos, exclusión mutua y deduplicación; habilitar correo mediante adaptador real/configurado, nunca prometer listado universal DIAN por NIT.
3. Usar IA para transcripción y sugerencias de matching/anomalías, con revisión editable, cola asíncrona y polling protegido; XML y cálculos prevalecen sobre inferencias.
4. Mantener identidad por entidad fiscal + emisor + clave electrónica o referencia documental; soportar emisores con igual número, reentregas multicanal y notas crédito/débito.
5. Conciliar factura↔N OC↔N recepciones/gastos por líneas y montos; no producir inventario, compra, CxP o asiento por el mero ingreso del documento.
6. Gestionar acuse 030, reclamo 031, recibo 032 y aceptación expresa 033 con identidad firmante correcta, evidencia y estado técnico independiente; observar aceptación tácita 034 del emisor sin simularla como acto del comprador.
7. Vincular y conciliar el puente de IVA existente y documentos históricos sin reescribir asientos ni contabilizar IVA/CxP dos veces; las diferencias requieren ajuste trazable y período abierto.
8. Hacer que vista fiscal, borrador, obligación, cierre y XLSX deriven de los mismos datos/cálculos, diferenciando generado, cobrado, descontable, capitalizado, retenido y pagado.
9. Aplicar retenciones sufridas/anticipos/arrastres sólo a su impuesto, entidad, jurisdicción y período procedentes; bloquear sobreaplicación concurrente y doble consumo.
10. Registrar abonos/pagos tributarios con evidencia, referencia e idempotencia, actualizar saldos y contabilizar sin confundirlos con pagos a proveedores.
11. Resolver periodicidad legal, vencimientos verificables y reglas versionadas; no presentar una fecha genérica ni una estimación como declaración definitiva.
12. Mantener STORE/ORGANIZATION, RBAC, planes por capacidades, archivos seguros, historial, cierres inmutables y conciliación contable completa.
13. Probar happy/sad/brute paths por API y UI real local, invariantes monetarias y ausencia de efectos duplicados; documentar decisiones y limitaciones externas verificables, y terminar con commits locales sin subir ni desplegar nada.

## Approach Chosen

Monolito modular: dominio compartido `received-documents` con bandeja independiente de los documentos emitidos, controllers de tienda/organización y adaptadores de ingreso/DIAN, integrado con servicios existentes. Nuevas tablas aditivas conservan documentos, archivos, líneas/impuestos, enlaces, eventos/intentos y sincronizaciones; no se sobrecarga la numeración única de facturas emitidas. Los cálculos de `TaxDeclarationDraftService` se exponen como preview sin escritura y se completan como motor común para el consolidado, preservando snapshots aprobados. Créditos/aplicaciones y pagos tributarios tienen registros durables y eventos contables idempotentes. Sopus: el orquestador diseña/audita; ejecutores pequeños implementan tareas acotadas con `parallel`, alcance explícito y sin git destructivo; sólo el orquestador hace commits revisados. Pruebas de DIAN/IA/conectores distinguen protocolo probado de credenciales/proveedores realmente configurados.

## Alternatives Considered

- Bandeja dentro de órdenes de compra: rechazada por preferencia explícita del usuario y porque documentos pueden preceder a la OC o ser gastos/servicios.
- Insertar ciegamente todo en `invoices`: rechazada por colisión de numeración entre proveedores, identidad de emitidos y riesgo de duplicar el puente IVA existente.
- Segundo motor tributario para dashboard: rechazado; volvería a divergir de declaraciones/contabilidad/reportes.
- Aceptación, fiscalidad o stock decididos por IA: rechazado; la IA transcribe/recomienda, reglas y autorizaciones controlan efectos.
- Neto universal IVA+INC+ICA−todas las retenciones: rechazado por compensaciones falsas y dimensiones fiscales incompatibles.

## Critical Files

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20260930070000_received_documents_and_tax_settlement/migration.sql`
- `apps/backend/src/prisma/services/global-prisma.service.ts`
- `apps/backend/src/prisma/services/organization-prisma.service.ts`
- `apps/backend/src/prisma/services/store-prisma.service.ts`
- `apps/backend/src/domains/received-documents/received-documents.module.ts`
- `apps/backend/src/domains/received-documents/received-documents.controller.ts`
- `apps/backend/src/domains/received-documents/organization-received-documents.controller.ts`
- `apps/backend/src/domains/received-documents/received-documents.service.ts`
- `apps/backend/src/domains/received-documents/received-documents.service.spec.ts`
- `apps/backend/src/domains/received-documents/dto/received-document.dto.ts`
- `apps/backend/src/domains/received-documents/interfaces/received-document.interface.ts`
- `apps/backend/src/domains/received-documents/services/received-document-parser.service.ts`
- `apps/backend/src/domains/received-documents/services/received-document-parser.service.spec.ts`
- `apps/backend/src/domains/received-documents/services/received-document-scan.service.ts`
- `apps/backend/src/domains/received-documents/services/received-document-scan.processor.ts`
- `apps/backend/src/domains/received-documents/services/received-document-matching.service.ts`
- `apps/backend/src/domains/received-documents/services/received-document-reconciliation.service.ts`
- `apps/backend/src/domains/received-documents/services/received-document-events.service.ts`
- `apps/backend/src/domains/received-documents/services/document-reception-sync.service.ts`
- `apps/backend/src/domains/received-documents/services/document-reception-sync.processor.ts`
- `apps/backend/src/domains/received-documents/services/document-reception-webhook.controller.ts`
- `apps/backend/src/domains/store/invoicing/invoicing.module.ts`
- `apps/backend/src/domains/organization/invoicing/invoicing.module.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/interfaces/dian-event.interface.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-direct.provider.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-soap.client.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/constants/dian-endpoints.ts`
- `apps/backend/src/domains/store/orders/purchase-orders/purchase-orders.service.ts`
- `apps/backend/src/domains/store/orders/purchase-orders/purchase-orders.module.ts`
- `apps/backend/src/domains/store/accounts-payable/accounts-payable.service.ts`
- `apps/backend/src/domains/store/expenses/expenses.service.ts`
- `apps/backend/src/domains/fiscal-operations/services/tax-declaration-draft.service.ts`
- `apps/backend/src/domains/fiscal-operations/services/tax-declaration-draft.service.spec.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-period.util.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-period.util.spec.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-obligation.service.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-tax-settlement.service.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-tax-settlement.service.spec.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-tax-calendar.service.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-tax-calendar.service.spec.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-close.service.ts`
- `apps/backend/src/domains/fiscal-operations/services/fiscal-close.service.spec.ts`
- `apps/backend/src/domains/fiscal-operations/dto/fiscal-operations.dto.ts`
- `apps/backend/src/domains/fiscal-operations/store-fiscal.controller.ts`
- `apps/backend/src/domains/fiscal-operations/organization-fiscal.controller.ts`
- `apps/backend/src/domains/fiscal-operations/fiscal-operations.module.ts`
- `apps/backend/src/domains/store/analytics/analytics-metrics.contract.ts`
- `apps/backend/src/domains/store/analytics/analytics-metrics.contract.spec.ts`
- `apps/backend/src/domains/store/analytics/services/financial-analytics.service.ts`
- `apps/backend/src/domains/store/analytics/services/financial-analytics.service.spec.ts`
- `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts`
- `apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts`
- `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts`
- `apps/backend/prisma/seeds/default-account-mappings.seed.ts`
- `apps/backend/prisma/seeds/permissions.seed.ts`
- `apps/backend/src/common/errors/error-codes.ts`
- `apps/backend/src/common/helpers/s3-path.helper.ts`
- `apps/backend/package.json`
- `apps/backend/package-lock.json`
- `package-lock.json`
- `apps/frontend/src/app/private/modules/store/invoicing/invoicing.routes.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/received-documents/received-documents-page.component.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/received-documents/received-document-detail.component.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/received-documents/received-document-import.component.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/received-documents/received-document-connections.component.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/received-documents/received-documents.service.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/received-documents/received-documents.interface.ts`
- `apps/frontend/src/app/private/modules/organization/invoicing/invoicing.routes.ts`
- `apps/frontend/src/app/private/modules/organization/invoicing/invoicing.component.ts`
- `apps/frontend/src/app/private/modules/fiscal-operations/fiscal-operations.component.ts`
- `apps/frontend/src/app/private/modules/fiscal-operations/services/fiscal-operations.service.ts`
- `apps/frontend/src/app/private/modules/fiscal-operations/interfaces/fiscal-operations.interface.ts`
- `apps/frontend/src/app/private/modules/fiscal-operations/components/fiscal-tax-position.component.ts`
- `apps/frontend/src/app/private/modules/fiscal-operations/components/fiscal-tax-settlement.component.ts`
- `apps/frontend/src/app/private/modules/store/accounting/components/account-mappings/account-mappings.component.ts`
- `apps/frontend/src/app/private/modules/store/orders/purchase-orders/pages/detail/purchase-order-detail.component.ts`
- `apps/frontend/src/app/private/modules/organization/purchase-orders/pages/detail/purchase-order-detail.component.ts`
- `apps/frontend/src/app/private/modules/store/analytics/interfaces/financial-analytics.interface.ts`
- `apps/frontend/src/app/private/modules/store/analytics/pages/financial/tax-summary.component.ts`
- `apps/frontend/src/app/core/utils/error-messages.ts`
- `docs/received-documents-tax-decisions.md`
- `docs/received-documents-tax-validation.md`

## Reusable Assets

- `apps/backend/src/domains/fiscal-operations/services/fiscal-context-resolver.service.ts` — contextos validados por entidad fiscal y STORE/ORGANIZATION.
- `apps/backend/src/domains/fiscal-operations/services/tax-declaration-draft.service.ts` — calculadores, líneas, snapshots de reglas/fuentes y aprobación inmutable.
- `apps/backend/src/domains/fiscal-operations/services/fiscal-period.util.ts` — rangos date-only; ya admite periodicidad de cierre multi-mes.
- `apps/backend/src/domains/store/orders/purchase-orders/purchase-orders.service.ts` — única recepción de stock/costos/CxP e IVA de compras.
- `apps/backend/src/domains/store/orders/purchase-orders/invoice-scanner.service.ts` — OCR y matching existentes; no usar confirmación que crea OC como intake.
- `apps/backend/src/domains/store/expenses/expense-scan.processor.ts` — patrón cola/poll tenant-safe.
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-direct.module.ts` — transporte, firma, SOAP, XML y auditoría DIAN; adaptar identidad de documento recibido.
- `apps/backend/src/common/services/s3.service.ts` — claves seguras y URLs firmadas sólo en lecturas.
- `apps/backend/src/common/services/encryption.service.ts` — secretos de conexiones cifrados, nunca devolverlos/loguearlos.
- `apps/backend/src/common/money-kernel/purchase-line-taxes.ts` — aritmética determinista de impuestos múltiples/descuentos.
- `apps/backend/src/common/context/request-context.service.ts` — contexto de workers y autorización.
- `apps/frontend/src/app/shared/components/module-tabs-shell/module-tabs-shell.component.ts` — tab en Facturación sin módulo sidebar nuevo.
- `apps/frontend/src/app/shared/components/file-upload-dropzone/file-upload-dropzone.component.ts` — entrada de archivos.
- `apps/frontend/src/app/shared/components/responsive-data-view/responsive-data-view.component.ts` — tabla/tarjetas responsive.
- `apps/frontend/src/app/private/modules/fiscal-operations/fiscal-core-shell.component.ts` — centro fiscal existente.
- `libs/shared-types/package.json` — referencia neutral entre apps, sin dependencia de framework para contratos compartidos.

## Steps

1. Registrar reglas de negocio, decisiones y matriz de evidencia.
   Skills: vendix-business-analysis, vendix-engram, sopus, parallel, git-workflow.
   Resources: `git status --short`; `git rev-parse HEAD`; `./scripts/engram-import.sh`; este plan; fuentes oficiales citadas en el informe de decisiones.
   Business decision: autorización de ejecución autónoma ya otorgada; no push/PR/deploy/prod ni acciones legales externas de prueba. Interpretar «salud por pagar» como «saldo por pagar» y conservar aparte obligaciones de salud existentes, sin inventar nuevas reglas de nómina.
   Why: fijar el alcance completo y decisiones antes de cualquier código evita un MVP implícito o aprobación simulada.
   Output: informe Business Analysis Brief, decisiones numeradas y checklist requisito→evidencia; checkpoint baseline.
   Verification: validar los once encabezados del plan y seis campos de cada paso mediante script; comprobar baseline y ausencia de source edits antes de delegación.

2. Corregir la fórmula analítica y los roles de retención.
   Skills: vendix-analytics-metrics, vendix-tax-typing, vendix-date-timezone, vendix-fiscal-scope, buildcheck-dev.
   Resources: `npm run buildcheck:test -- src/domains/store/analytics/analytics-metrics.contract.spec.ts`; `npm run buildcheck:test -- src/domains/store/analytics/services/financial-analytics.service.spec.ts`.
   Business decision: neto IVA usa sólo IVA generado−descontable−reteIVA sufrida aplicable; INC/ICA y retenciones practicadas se muestran separados, sin compensación universal.
   Why: eliminar primero la cifra falsa que actualmente puede contaminar UI/reportes antes de agregar nuevas fuentes.
   Output: helper y consumo correctos con regresiones de familias/roles y etiqueta de estimación operacional hasta conectar el motor fiscal común.
   Verification: specs anteriores con casos de mezcla, retenciones practicadas como pasivo y suma de detalles; revisión del diff por orquestador.

3. Añadir almacenamiento recibido y liquidación tributaria durable.
   Skills: vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-fiscal-scope, vendix-naming-conventions.
   Resources: `npm run prisma:generate -w apps/backend`; `docker exec vendix_backend npx prisma validate`; `docker exec vendix_backend npx prisma migrate status`.
   Business decision: tablas aditivas y FKs RESTRICT, dinero Decimal; originales inmutables, claves únicas por entidad/emisor, enlaces N:M y aplicaciones/pagos con idempotencia. No limpiar ni recontabilizar históricos automáticamente.
   Why: servicios siguientes dependen de contratos de datos comprobables y de protección DB contra duplicados/concurrencia.
   Output: modelos recibidos/archivos/items/impuestos/enlaces/eventos/intentos/conexiones/runs y créditos/aplicaciones/pagos fiscales; registro Prisma y migración SQL idempotente con DATA IMPACT.
   Verification: validación Prisma, catálogo SQL de tablas/FKs/índices y segunda ejecución SQL idempotente en transacción de prueba local; ningún DROP de tablas/columnas ni cascada de negocio.

4. Implementar parser determinista y validación monetaria de entrada.
   Skills: vendix-backend, vendix-validation, vendix-error-handling, vendix-tax-typing, vendix-calculated-pricing.
   Resources: `npm run buildcheck:test -- src/domains/received-documents/services/received-document-parser.service.spec.ts`; anexo DIAN 1.9 `https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documentacion-tecnica/`.
   Business decision: soportar UBL Invoice/CreditNote/DebitNote y AttachedDocument; rechazar DTD/XXE y límites excedidos; preservar tipo/impuestos/moneda, no convertir desconocidos en IVA. CUFE sintáctico no equivale a validación DIAN.
   Why: la normalización fiable es requisito previo a intake, IA, matching y elegibilidad fiscal.
   Output: contrato normalizado, parser namespace-safe, validaciones totales/impuestos/redondeo y fixtures representativos.
   Verification: parser specs con namespaces variados, contenedor, notas, IVA+INC+ICUI/IBUA, moneda, XML malformado y ataques/duplicados.

5. Implementar dominio/API manual, revisión y originales.
   Skills: vendix-backend-api, vendix-validation, vendix-backend-auth, vendix-permissions, vendix-multi-tenant-context, vendix-prisma-scopes, vendix-fiscal-scope, vendix-s3-storage, vendix-subscription-gate.
   Resources: `curl -sk https://vendix.com/api/store/invoicing/received-documents -H "Authorization: Bearer $TOK"`; `npm run buildcheck:test -- src/domains/received-documents/received-documents.service.spec.ts`.
   Business decision: cada escritura valida org/entidad y receptor; importación no mueve stock/AP/asientos; archivo se guarda por key tenant-safe y se firma al leer; permisos independientes read/import/review/link/event/accept/configure.
   Why: entregar núcleo persistente después del parser y antes de automatización/UI.
   Output: controllers tienda/org, DTOs, listado paginado/filtros, detalle/archivos, importación, captura y edición revisable, revisión versionada e historial; RBAC/capabilities y errores UX.
   Verification: API happy/sad/IDOR, DTO límites, mismo número distintos proveedores, replay idéntico y hash con CUFE conflictivo; S3 key/URL y no efectos de negocio.

6. Añadir OCR asíncrono para PDF multipágina e imágenes.
   Skills: vendix-ai-engine, vendix-ai-platform-core, vendix-ai-queue, vendix-s3-storage, vendix-monorepo-workspaces, vendix-multi-tenant-context, vendix-subscription-gate.
   Resources: `npm run buildcheck:test -- src/domains/received-documents/services/received-document-scan.service.spec.ts`; `curl -sk https://vendix.com/api/store/invoicing/received-documents/scan -H "Authorization: Bearer $TOK" -F file=@/tmp/received-invoice.pdf`; `docker logs --tail 100 vendix_backend`.
   Business decision: IA transcribe; kernel calcula y evidencia original prevalece; nunca autoaceptación legal por OCR. PDF se procesa por páginas con límites explícitos; errores/cupos son visibles y reintentables, no éxito falso.
   Why: sobre intake estable, separar extracción pesada del request y evitar asumir que sharp soporta PDF.
   Output: preparación multipágina real, job/poll 202 tenant-safe, extracción/revisión/anomalías, application config y dependency locks coherentes si necesarios.
   Verification: documento PDF textual y escaneado multipágina, imagen, proveedor IA configurado y fallo/cuota; 404 de job ajeno, reintento sin documento duplicado y cifras finales deterministas.

7. Implementar conectores y recepción automática.
   Skills: vendix-backend-api, vendix-ai-queue, vendix-backend-auth, vendix-validation, vendix-s3-storage, vendix-trust-proxy-chain, vendix-multi-tenant-context, vendix-prisma-scopes.
   Resources: `npm run buildcheck:test -- src/domains/received-documents/services/document-reception-sync.service.spec.ts`; `curl -sk https://vendix.com/api/store/invoicing/received-documents/connections -H "Authorization: Bearer $TOK"`; fixtures HTTP/SMTP/IMAP locales de integración.
   Business decision: webhook HMAC+timestamp/replay y polling de endpoint autorizado con cursor; adaptador correo configurado si se usa, secretos cifrados, prevención SSRF y límites por lote; deshabilitado sin credenciales reales, no buzón DIAN ficticio.
   Why: usar el mismo intake/idempotencia para manual y automático antes de matching y efectos.
   Output: conexiones configurables, scheduler/cola, ejecuciones/cursor/resumen/fallos, sync manual y automático, webhook y contrato de proveedor documentado.
   Verification: recibir automáticamente fixture real en API/job y UI, cursor repetido, caída proveedor, firma falsa, DNS/IP privada, conexiones de otro tenant y doble scheduler sin efectos duplicados.

8. Añadir matching y conciliación con OC, recepciones y gastos.
   Skills: vendix-operating-scope, vendix-fiscal-scope, vendix-inventory-stock, vendix-inventory-valuation, vendix-product-pricing, vendix-tax-typing, vendix-prisma-scopes.
   Resources: `npm run buildcheck:test -- src/domains/received-documents/services/received-document-matching.service.spec.ts`; `npm run buildcheck:test -- src/domains/received-documents/services/received-document-reconciliation.service.spec.ts`.
   Business decision: candidatos automáticos, links confirmados con montos/cantidades/UoM; tolerancias configurables, sin aceptar legalmente por match. Servicios/gastos pueden no tener OC; recepción parcial no declara entrega completa.
   Why: los efectos fiscales/contables necesitan conciliación demostrable, no parecido de nombres o total.
   Output: 3-way match N:M, vínculos históricos explícitos, diferencias, confirmación autorizada y puente hacia servicios existentes de recepción/gasto/AP.
   Verification: 2 facturas/1OC, 1factura/2OC, parcial, producto ajeno, UoM, gasto sin stock, proveedor distinto y import/link repetidos sin incremento de stock/asientos/AP.

9. Gestionar eventos electrónicos y evidencia legal.
   Skills: vendix-fiscal-scope, vendix-backend-auth, vendix-permissions, vendix-prisma-scopes, vendix-date-timezone, vendix-validation.
   Resources: `npm run buildcheck:test -- src/domains/received-documents/services/received-document-events.service.spec.ts`; anexo DIAN 1.9 y `https://www.cancilleria.gov.co/normograma/compilacion/docs/decreto_1154_2020.htm`.
   Business decision: 030≠032≠033; 031 reclamo es distinto de rechazo técnico; actor firmante es receptor/tenant real y referencia emisor proveedor. 034 sólo observado del emisor; timeouts desconocidos se concilian antes de reenviar.
   Why: el transporte existente conoce emitidos; adaptar roles sin mezclar la máquina de factura recibida con la respuesta DIAN.
   Output: eventos/intentos persistidos, adapter emisor/receptor correcto, consulta/conciliación DIAN, prerrequisitos recepción/evidencia/permiso, reloj hábil y alertas de plazos.
   Verification: XML SenderParty/ReceiverParty y firmante, prerrequisitos, timeout+GetStatusEvent, replay/cude estable, rechazo técnico y prohibición de emitir 034 como comprador; nada se transmite a producción durante QA.

10. Conciliar reconocimiento contable y puente IVA histórico.
   Skills: vendix-auto-entries, vendix-accounting-rules, vendix-prisma-scopes, vendix-tax-typing, vendix-fiscal-scope, vendix-date-timezone.
   Resources: `npm run buildcheck:test -- src/domains/received-documents/services/received-document-reconciliation.service.spec.ts`; `npm run buildcheck:test -- src/domains/store/accounting/auto-entries/auto-entry.service.spec.ts`.
   Business decision: identificar recepción/gasto/IVA/CxP ya registrados y conservar fuente; no nuevo asiento completo por factura coincidente; diferencia va como ajuste explícito, mismo impuesto/entidad y período abierto. Referencias inciertas históricas quedan pendientes, no inventadas.
   Why: completar reconciliación antes de declarar la fuente fiscal como elegible elimina doble contabilización.
   Output: vínculos/effect keys únicos, bridge documentado, contabilización/ajustes trazables, errores contables reintentables y cuenta por pagar única.
   Verification: saldo AP y DR/CR antes/después de import y reintento, cero nueva stock movement de intake; ajuste delta, compras antiguas sin documento y período cerrado.

11. Unificar períodos y calendario verificable.
   Skills: vendix-date-timezone, vendix-fiscal-scope, vendix-tax-typing, vendix-prisma-migrations.
   Resources: `npm run buildcheck:test -- src/domains/fiscal-operations/services/fiscal-period.util.spec.ts`; `npm run buildcheck:test -- src/domains/fiscal-operations/services/fiscal-tax-calendar.service.spec.ts`; `https://www.dian.gov.co/Calendarios/Calendario_Tributario_2026.pdf`.
   Business decision: periodos monthly/bimonthly/four_monthly/annual según responsabilidad; calendario nacional por NIT y fuente/año, municipal configurable y excepciones explícitas. Fecha no verificada bloquea automatismo, no usar día20 como certeza.
   Why: cálculo y declaración no pueden usar universos diferentes del cierre.
   Output: DTO/rangos y periodicidad persistida, resolver calendario versionado, provenance de vencimiento y warnings/overrides auditados.
   Verification: bimestre enero-febrero, cuatrimestre, frontera UTC, NIT DV, año/cambio anual, calendario sin configuración y excepción territorial.

12. Completar calculadores y preview fiscal común.
   Skills: vendix-tax-typing, vendix-fiscal-scope, vendix-analytics-metrics, vendix-date-timezone, vendix-prisma-scopes.
   Resources: `npm run buildcheck:test -- src/domains/fiscal-operations/services/tax-declaration-draft.service.spec.ts`; `curl -sk https://vendix.com/api/store/fiscal/tax-position -H "Authorization: Bearer $TOK"`.
   Business decision: ventas/gastos/compras soportados, recibidos elegibles y legacy conciliado cuentan exactamente una vez; notas invierten lado de compra/venta correctamente. IVA sólo créditos IVA; renta sólo retefuente sufrida; INC/ICUI/IBUA/ICA/retenciones con sus reglas y jurisdicciones. Renta precierre conserva etiqueta estimación y no supone 35% universal.
   Why: sobre datos y períodos correctos, establecer un único cálculo antes de conectar dashboard/export.
   Output: preview sin mutaciones con líneas/fuentes/exclusiones/warnings; borradores mismas cifras; elegibilidad documental/crédito y validación DIAN separadas.
   Verification: mixed-tax families, accepted/not_applicable/XML evidence/OCR pending, notas compra/venta, IVA capitalizado, fecha fiscal diferente OC y scope ORG/STORE; snapshots aprobados no cambian.

13. Implementar anticipos/créditos/aplicaciones y pagos tributarios.
   Skills: vendix-backend-api, vendix-validation, vendix-permissions, vendix-backend-auth, vendix-prisma-scopes, vendix-accounting-rules, vendix-fiscal-scope.
   Resources: `npm run buildcheck:test -- src/domains/fiscal-operations/services/fiscal-tax-settlement.service.spec.ts`; `curl -sk https://vendix.com/api/store/fiscal/tax-credits -H "Authorization: Bearer $TOK"`; endpoints de pagos de obligación con fixture.
   Business decision: créditos con procedencia/evidencia y familia fiscal, aplicaciones reservadas sólo al aprobar bajo lock transaccional; nunca dos NIT/impuestos compensados automáticamente. Pago/abono reduce saldo de obligación concreta, reverso trazable y no marca paid si falta saldo/evidencia.
   Why: monto por pagar real necesita créditos disponibles y pagos aplicados, no metadatos sueltos.
   Output: API créditos/anticipos/aplicación/pagos/reversos, disponible/consumido/saldo, comprobantes y vínculos declaración/obligación/contabilidad.
   Verification: 2 aplicaciones concurrentes contra mismo crédito, sobrepago, pago parcial+final, duplicado, reverso, tercero/familia/moneda ajenos y cierre inmutable.

14. Completar asientos de liquidación, créditos, anticipos y pagos.
   Skills: vendix-auto-entries, vendix-accounting-rules, vendix-prisma-seed, vendix-tax-typing, vendix-fiscal-scope.
   Resources: `npm run buildcheck:test -- src/domains/store/accounting/auto-entries/auto-entry.service.spec.ts`; SQL local sobre líneas/fuentes del test integral.
   Business decision: asientos balanceados, mappings const+seed+UI sincronizados; snapshot del monto aprobado; journal idempotente por efecto real con protección DB o lock, no findFirst concurrente como garantía. No rollback del negocio por falla de listener: fallo queda visible y retry reconciliable.
   Why: la gestión de créditos/pagos requiere bajar hasta el libro contable y cerrar saldo sin pasivos fantasma.
   Output: eventos/listeners/handlers para liquidación por familia, aplicaciones/crédito/anticipos/pagos/reversos, cuentas correctas y evidencia de contabilización.
   Verification: ΣDR=ΣCR, cuentas/entidad/período correcto, evento repetido/concurrente una sola vez, reverso espejo y libro auxiliar igual al saldo operativo.

15. Vincular obligaciones, declaraciones y cierre con conciliación.
   Skills: vendix-fiscal-scope, vendix-accounting-rules, vendix-permissions, vendix-prisma-scopes, vendix-date-timezone.
   Resources: `npm run buildcheck:test -- src/domains/fiscal-operations/services/fiscal-close.service.spec.ts`; `npm run buildcheck:test -- src/domains/fiscal-operations/services/fiscal-obligation.service.spec.ts`.
   Business decision: estimado/final alimentados por preview/snapshot y filtrados por período/entidad; aprobación/presentación/pago diferentes. Cierre verifica pendientes recibidos, conciliación libro/documentos, aplicaciones/pagos y fallos contables; no requiere pagar una obligación cuyo vencimiento es futuro para cerrar causación.
   Why: cerrar sólo cuando cifras/fuentes completas y preservar obligaciones legítimamente pendientes de pago.
   Output: overview correcto, lifecycle vinculado, checks materiales de cierre, snapshot y reapertura auditada sin reescribir historial declarado.
   Verification: recepción pendiente, asiento fallido/descuadre, declaración/cuentas diferentes, vencimiento futuro, aplicación abierta y ajustes posteriores bloquean o quedan auditados según regla.

16. Implementar bandeja y detalle de Documentos recibidos STORE/ORG.
   Skills: vendix-frontend, vendix-frontend-routing, vendix-zoneless-signals, vendix-angular-forms, vendix-ui-ux, vendix-frontend-standard-module, vendix-frontend-data-display, vendix-frontend-modal, vendix-frontend-icons, vendix-currency-formatting, vendix-date-timezone.
   Resources: `bash scripts/buildcheck.sh --watch`; `npm run zoneless:audit`; Playwright MCP `browser_navigate({url:'https://vendix.com/admin/invoicing/received-documents'})`.
   Business decision: tab nueva en Facturación, no sidebar módulo paralelo; visibilidad default privilegiados según permiso/capacidad existente y difusión en Settings, no badge sidebar; bandeja incluye sin OC. Reusar mismo componente con API scope correcto, detalle fuera shell si posee sticky-header.
   Why: presentar flujo operativo ya probado sin duplicar formularios/cabeceras ni mezclar soporte emitido con factura entrante.
   Output: listado/filtros/stats/paginación, import/manual/OCR review, originales, comparación, eventos, elegibilidad e impacto contable; estados empty/loading/error; navegación STORE/ORG y accesibilidad móvil.
   Verification: Playwright happy/sad/replay y job IDOR, teclado/Escape, mobile narrow, reload persistente, errores con feedback; watchers saludables, sin llamada al PO confirm durante import.

17. Implementar configuración/sync e integración contextual de compras/gastos.
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-frontend-modal, vendix-operating-scope, vendix-fiscal-scope, vendix-currency-formatting, vendix-ui-ux.
   Resources: Playwright MCP sobre tab recibidos y `/admin/orders/purchase-orders`; `bash scripts/buildcheck.sh --watch`.
   Business decision: conexiones/tolerancias/autoacciones/revisores se configuran dentro recibidos; secretos nunca se rellenan de vuelta al cliente; compras muestra enlaces al documento único; la tienda operativa no pierde inbox por ownership fiscal de organización.
   Why: habilitar automatización y completar continuidad UI entre documento y compra con permisos reales.
   Output: conexiones/sync logs/cursor, sugerencias/matching confirmado, accesos desde OC/gasto, comparación y configuración clara por entidad.
   Verification: webhook/API sync produce fila sin refresco manual falso, conexiones ajenas ocultas, cambio tienda sin caché cruzada y links bidireccionales.

18. Implementar consolidado, créditos/pagos, declaración y cierre en UI fiscal.
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-ui-ux, vendix-frontend-stats-cards, vendix-frontend-data-display, vendix-currency-formatting, vendix-date-timezone, vendix-fiscal-scope.
   Resources: Playwright MCP `/admin/fiscal/dashboard`, `/admin/fiscal/declarations`, `/admin/fiscal/obligations`, `/admin/fiscal/close`; `bash scripts/buildcheck.sh --watch`.
   Business decision: separar causado/recaudado/descontable/capitalizado/retenciones/anticipos; mostrar estimado/revisado/declarado/pagado y exclusiones. Abrir fuentes desde cada monto; total gerencial suma obligaciones positivas del horizonte, no netea créditos ajenos.
   Why: el objetivo final del cliente es comprender saldos confiables sin ocultar cobertura incompleta.
   Output: componentes/contratos para posiciones por NIT/impuesto/jurisdicción/período, créditos/aplicaciones, abonos/pagos/evidencia, revisión/snapshot y checks de cierre integrados.
   Verification: pantalla=preview=borrador=obligación=saldo contable según etapa; importe de abono/reverso refresca todas las vistas; errores y datos pendientes visibles.

19. Consolidar reportes XLSX y auxiliares.
   Skills: vendix-report-xlsx, vendix-analytics-metrics, vendix-tax-typing, vendix-date-timezone, vendix-fiscal-scope.
   Resources: `curl -sk https://vendix.com/api/store/fiscal/tax-position/export -H "Authorization: Bearer $TOK" -o /tmp/received-tax-position.xlsx`; tests de report builder.
   Business decision: dataset completo, mismo cálculo/dimensiones/fuentes y snapshots que UI; hojas posición/documentos/exclusiones/créditos/pagos/conciliación con timezone correcta. Reporte operativo no se etiqueta declaración definitiva.
   Why: cerrar la cadena de confianza hasta el entregable del contador y evitar export paralelo divergente.
   Output: export professional XLSX de recibidos/posición/liquidación y enlaces registro reportes existentes; auxiliares con documento proveedor original y fuente de asiento.
   Verification: totals pantalla=API=XLSX con paginación >100, notas/reversos, NITs separados y fechas frontera; apertura y estructura de archivo sin fórmulas inyectadas.

20. Verificar integralmente con datos locales y auditar 100% del objetivo.
   Skills: how-to-test, buildcheck-dev, vendix-known-errors, vendix-engram, sopus.
   Resources: `docker logs --tail 100 vendix_backend`; `docker logs --tail 40 vendix_postgres`; `bash scripts/buildcheck.sh --watch`; comandos curl y Playwright del bloque siguiente; specs focalizados seriales.
   Business decision: no declarar logrado por tests mock o watcher verde; ejecutar happy/sad/brute y contrastar datos/montos/asientos; registrar evidencia por requisito y distinguir proveedor no configurado de integración real verificada.
   Why: último paso funcional prueba la cadena completa y expone regresiones de datos, scope y estados.
   Output: registro de evidencia, correcciones de hallazgos, límites externos y veredicto por cada objetivo; cero requisito omitido.
   Verification: auditoría requisito→evidencia de estado actual en `docs/received-documents-tax-validation.md`; revisión grande del árbol final, logs de watcher y resultados con fecha/HEAD, no resultados de otra sesión.

21. Guardar memoria, reporte de decisiones y commits locales.
   Skills: git-workflow, vendix-engram, sopus, parallel.
   Resources: `git diff --check`; `git status --short`; `git diff --stat`; `git log --oneline`; `./scripts/engram-sync.sh vendix`.
   Business decision: sólo commits locales de archivos en alcance, alertas de migración y ninguna firma/atribución; nunca push/PR/deploy ni reset/restore/clean de árbol compartido. Goal sólo complete tras auditoría íntegra.
   Why: conservar trabajo/evidencia para mañana sin publicar ni perder cambios de otras sesiones.
   Output: commits incrementales revisados, informe de decisiones y verificación final, memorias persistentes; lista final de SHAs y pendientes reales si existen.
   Verification: historia y tree finales, ninguna operación push, diff sin secretos, SQL alertado, objetivos completos probados antes de `update_goal complete`.

## End-to-End Verification

1. Autenticar dev con cuenta seed autorizada usando `curl -sk -X POST https://vendix.com/api/auth/login` y guardar token sólo en `/tmp`; subir XML fixture con `curl -sk -H "Authorization: Bearer $TOK" -F file=@/tmp/supplier-invoice.xml https://vendix.com/api/store/invoicing/received-documents/import`. Repetir por manual/webhook/sync; comparar IDs, líneas, eventos y SQL local de stock/AP/asientos.
2. Conciliar una compra real de QA con recepción parcial/final, un gasto sin OC, dos proveedores con mismo número y nota crédito; comparar efecto de importación repetida y snapshot IVA/ledger/AP. Con token de otro tenant o sin permiso, cada lectura/escritura/link/job/evidencia retorna 403/404 sin datos cruzados.
3. Ejecutar `npm run buildcheck:test -- src/domains/received-documents/received-documents.service.spec.ts`, parser/matching/reconciliation/events/sync specs y specs de fiscal position/settlement/close focalizados, en serie, nunca suite global ni build/typecheck no solicitado.
4. En Playwright MCP con `--ignore-https-errors`, recorrer `https://vendix.com/admin/invoicing/received-documents`: import/manual/PDF+IA/revisión/match/eventos, conexión automática, persistencia y recuperación tras fallo. Verificar mobile/desktop, consola/network y cambio de scope.
5. En `/admin/fiscal`, verificar filtros entidad/período, fuentes/exclusiones, créditos/anticipos, aplicaciones/abonos/reversos, aprobación/declaración y cierre; contrastar con llamadas API y libro auxiliar y descargar XLSX completo. Cada cifra debe concordar en la etapa correspondiente.
6. Leer `docker logs --tail 100 vendix_backend`, `docker logs --tail 40 vendix_postgres`, `docker logs --tail 40 vendix_redis`, y `bash scripts/buildcheck.sh --watch`; ejecutar `npm run zoneless:audit` y `npm run tz:audit`, separando errores baseline de nuevos y corrigiendo todos los afectados.

## Knowledge Gaps

- No patrón existente de recepción UBL/AttachedDocument multipágina/connector intake; documentar contrato en el dominio y reportar configuración externa requerida. No simular una API universal DIAN por NIT ni credenciales no disponibles.
- Skill `vendix-tax-typing` está desactualizado en enum ICUI/IBUA y TODO role-aware; seguir schema/código actuales, registrar discrepancia y actualizar guidance sólo como tarea documentada sin ampliar código fiscal arbitrariamente.
- Calendario municipal/excepciones y reglas de renta/SIMPLE requieren fuentes/config fiscal específica. Bloquear determinación definitiva sin evidencia suficiente; preservar estimaciones explícitas y permitir configuración validada, no inferir obligaciones con IA.
- Playwright MCP no aparece como tool nativa en este harness; usar MCP stdio local si necesario y registrar el mecanismo real. Watcher frontend está caído al inicio; iniciar uno solo mediante `npm run dev:fe:lite` cuando sea necesario para E2E, sin builds paralelos.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
