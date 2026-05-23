# Plan maestro de cumplimiento DIAN para Vendix

Fecha: 2026-05-17  
Estado: aprobado para predisposicion de ejecucion  
Alcance: facturacion electronica de venta, notas credito, notas debito, documento soporte, notas de ajuste de documento soporte, nomina electronica, scoping por organizacion/tienda/entidad fiscal, auditoria, contabilidad, errores, pruebas y salida a produccion.

Fuentes oficiales DIAN consultadas:

- Resolucion DIAN 000227 de 2025: https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm
- Micrositio DIAN del sistema de facturacion electronica: https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/
- Anexo tecnico factura electronica de venta v1.9: https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf
- Resolucion DIAN 000165 de 2023: https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm
- Documento soporte en adquisiciones a sujetos no obligados a facturar: https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-adquisiciones-no-obligados.aspx
- Documento soporte de pago de nomina electronica: https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-de-Pago-de-Nomina-Electronica.aspx
- Catalogo DIAN de proveedores tecnologicos: https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proveedores-tecnologicos/
- Ser facturador electronico DIAN: https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx
- DIAN, 3 pasos para facturar electronicamente: https://www.dian.gov.co/Prensa/Paginas/NG-3-pasos-para-facturar-electronicamente.aspx

Nota de riesgo: este plan es tecnico-operativo y no reemplaza la revision de un contador, revisor fiscal, abogado tributario, entidad certificadora autorizada, soporte DIAN ni la validacion formal en ambiente DIAN. La salida a produccion debe quedar bloqueada hasta completar las pruebas, evidencias y aprobaciones descritas.

## Context

Vendix ya tiene una base importante para fiscalidad colombiana: entidades fiscales, configuracion DIAN, resoluciones, factura electronica, nomina, auditoria, wizard fiscal, scoping Prisma y asientos automaticos. Sin embargo, el estado actual no debe considerarse listo para produccion DIAN porque hay brechas criticas de cumplimiento, seguridad operativa y trazabilidad.

Hallazgos tecnicos base que guian este plan:

- `invoices` no tiene `accounting_entity_id`, aunque `invoice_resolutions`, `dian_configurations` y `payroll_runs` ya tienden hacia entidad fiscal.
- `invoice_type_enum` no modela documento soporte ni notas de ajuste de documento soporte.
- El flujo de envio de factura puede marcar `sent_ok` aunque el proveedor responda error.
- El resolver de proveedor puede caer silenciosamente a mock si falta configuracion DIAN.
- La firma XML puede continuar sin certificado en rutas criticas.
- El proveedor DIAN directo tiene piezas utiles, pero comentarios y TODOs indican que CUFE, firma, datos del emisor y notas no estan cerrados como implementacion certificable.
- Notas credito/debito no tienen todos los codigos, referencias y validaciones de negocio necesarias.
- Documento soporte y CUDS no existen como dominio funcional propio.
- Nomina electronica existe parcialmente, pero usa mock por defecto en el modulo, no persiste estado DIAN completo por empleado y mezcla almacenamiento agregado por corrida.
- La numeracion por resolucion tiene riesgo de carrera y diferencias entre flujo store/org.
- La contabilidad se dispara al validar localmente, no necesariamente cuando DIAN acepta el documento.
- La auditoria existe, pero debe convertirse en bitacora inmutable de cada intento, request, hash, respuesta, usuario, entidad fiscal y estado.

El plan prioriza cumplimiento legal, exactitud fiscal, trazabilidad y bloqueo seguro antes que velocidad de lanzamiento.

Regla fiscal troncal que este plan debe respetar:

- Si `organizations.fiscal_scope=ORGANIZATION`, la organizacion opera como un unico sujeto fiscal consolidado. Todas las tiendas pueden originar ventas, compras o nomina operacionalmente, pero los documentos DIAN se emiten con la informacion fiscal de la organizacion: misma entidad fiscal consolidada, mismo NIT emisor, misma configuracion DIAN, mismas resoluciones por tipo documental, misma numeracion fiscal controlada y mismos reportes fiscales consolidados. El `store_id` queda como origen operacional/canal/sucursal, no como emisor tributario.
- Si `organizations.fiscal_scope=STORE`, cada tienda activa opera como sujeto fiscal separado. Cada tienda debe tener su propia entidad fiscal, NIT/DV o datos legales segun corresponda, configuracion DIAN, software/certificado/proveedor, resoluciones, rangos, numeracion, documentos, auditoria y reportes fiscales. La organizacion puede ver agregados si tiene permiso, pero no puede mezclar emisor, resolucion, CUFE/CUDE/CUDS/CUNE ni consecutivos entre tiendas.
- `operating_scope=STORE + fiscal_scope=ORGANIZATION` es una combinacion invalida segun las reglas del repositorio. `operating_scope=ORGANIZATION + fiscal_scope=STORE` si es valida: operacion compartida, pero responsabilidad fiscal separada por tienda.
- Ningun servicio de facturacion, documento soporte, nomina, impuestos, reportes fiscales o asientos automaticos debe inferir la entidad fiscal desde `store_id` o `organization_id` manualmente. Siempre debe resolverla con `FiscalScopeService.resolveAccountingEntityForFiscal()` o una abstraccion fiscal equivalente.
- Los endpoints de tienda pueden crear documentos en ambos modos, pero el emisor fiscal cambia: en ORGANIZATION usan la entidad/configuracion/resolucion de la organizacion; en STORE usan la entidad/configuracion/resolucion de la tienda actual.

Baseline estimado de implementacion actual, no certificacion legal:

- Modelo fiscal y scoping: 55%. Hay `accounting_entities`, fiscal scope y scoping Prisma, pero `invoices` no esta completamente anclado a entidad fiscal.
- Configuracion DIAN y wizard: 60%. Hay formularios, servicios y auditoria base, pero faltan bloqueos productivos estrictos y validacion completa de certificado/resolucion/test set.
- Factura electronica de venta: 45%. Hay flujo, XML, CUFE, SOAP y auditoria base, pero existen riesgos de exito falso, firma opcional y datos fiscales incompletos.
- Notas credito/debito: 25%. Hay servicio y builders base, pero faltan codigos DIAN completos, CUDE/referencias robustas, numeracion propia y envio separado de debito.
- Documento soporte y notas de ajuste: 5%. Hay referencias Bruno externas, pero no dominio funcional propio en Vendix.
- Nomina electronica: 35%. Hay proveedor DIAN parcial y flujo de nomina, pero persiste mock por defecto, falta estado por empleado y evidencia granular.
- Contabilidad automatica fiscal: 50%. Hay AutoEntryService y reglas base, pero el disparador debe alinearse con aceptacion DIAN y reversas.
- Manejo de errores, auditoria e idempotencia: 30%. Hay error handling y logs, pero faltan estados canonicos, outbox/retry real, evidencia inmutable e idempotency keys.
- Pruebas DIAN/Bruno/E2E: 15%. Existen colecciones fiscales base, pero faltan pruebas por tipo documental y evidencia sandbox.
- Preparacion productiva total: 30%. El sistema tiene cimientos valiosos, pero no debe habilitarse como flujo DIAN productivo hasta cerrar los bloqueantes.

Meta de salida a produccion: 100% en requisitos bloqueantes y minimo 95% en buenas practicas operativas. Cualquier brecha en firma, numeracion, scoping, aceptacion DIAN, documento soporte, nomina, auditoria o mocks productivos bloquea el lanzamiento.

Decisiones cerradas para ejecucion inicial:

- Produccion usara el modo DIAN de software propio/desarrollo propio por entidad fiscal. Vendix provee la herramienta SaaS; cada SAS/entidad fiscal es el facturador electronico, dueña de su habilitacion, software ID/PIN, resoluciones, certificado y responsabilidad fiscal.
- Vendix no opera como proveedor tecnologico DIAN en esta arquitectura. Las referencias a proveedor tecnologico solo aplican si en el futuro se adopta un adaptador alterno formal.
- El convenio externo de certificados solo provee certificados digitales emitidos por entidad certificadora autorizada; no convierte a Vendix ni al certificador en proveedor tecnologico DIAN.
- DIAN directo queda permitido en produccion solo cuando la entidad fiscal tenga configuracion `production/enabled`, certificado vigente, software propio habilitado, resoluciones vigentes y evidencia de pruebas/habilitacion.
- Los asientos contables definitivos de facturacion se generan despues de aceptacion DIAN/proveedor, no al validar localmente.
- La migracion fiscal respeta `organizations.fiscal_scope`; registros ambiguos se bloquean hasta corregirse.

## General Objective

Construir y verificar un sistema DIAN de grado productivo para todas las SAS operadas en Vendix, capaz de emitir, validar, transmitir, auditar y contabilizar correctamente facturas electronicas de venta, notas credito, notas debito, documentos soporte, notas de ajuste y nomina electronica, respetando el scoping por organizacion, tienda y entidad fiscal, con manejo de errores robusto, evidencias auditables y validacion en ambiente DIAN antes de habilitar produccion.

## Specific Objectives

- Consolidar una matriz legal-tecnica DIAN trazable a fuentes oficiales para cada tipo documental.
- Anclar toda operacion fiscal a `accounting_entity_id` y resolver correctamente ORGANIZATION vs STORE.
- Garantizar que `fiscal_scope=ORGANIZATION` use configuracion fiscal organizacional para todas las tiendas, y que `fiscal_scope=STORE` aisle completamente la configuracion fiscal por tienda.
- Eliminar cualquier exito falso: ningun documento debe quedar `accepted`, `sent_ok` o contabilizado si DIAN o el proveedor rechazan la operacion.
- Separar estados internos, estados de transmision, estados DIAN y estados contables.
- Implementar numeracion atomica por entidad fiscal, tipo documental, prefijo y resolucion.
- Completar UBL/XML, CUFE/CUDE/CUDS/CUNE, QR, firma, ZIP/SOAP/API y validaciones previas segun el tipo documental.
- Implementar documento soporte y sus notas de ajuste como dominio de primera clase.
- Corregir notas credito/debito con referencia obligatoria, codigos DIAN, totales y trazabilidad al documento original.
- Completar nomina electronica por empleado, incluyendo ajustes/reemplazos/eliminaciones segun aplique, estado por item y evidencia DIAN.
- Rehacer la integracion fiscal para soportar DIAN directo como software propio por entidad fiscal, sin mocks en produccion y con posibilidad futura de adaptador de proveedor tecnologico si el negocio cambia.
- Fortalecer DTOs, validaciones de negocio, permisos, errores normalizados, auditoria y reintentos idempotentes.
- Alinear contabilidad automatica con aceptacion DIAN y eventos fiscales reales.
- Entregar pruebas unitarias, integracion, Bruno, sandbox DIAN, evidencia documental y runbook operativo.
- Definir una puerta de salida a produccion con porcentaje minimo 100% en requisitos bloqueantes.

## Approach Chosen

Enfoque elegido: reconstruccion incremental compliance-first sobre la base existente, con una maquina de estados fiscal, modelo canonico por entidad fiscal, proveedor DIAN explicito, validaciones estrictas antes del envio y contabilizacion posterior a aceptacion DIAN.

Este enfoque conserva activos existentes de Vendix, pero cambia los puntos inseguros: mocks silenciosos, estados optimistas, numeracion no bloqueada, firma opcional, documento soporte inexistente y scoping incompleto.

Principios obligatorios:

- `accounting_entity_id` es el eje fiscal. `organization_id` y `store_id` siguen existiendo para navegacion, permisos y operacion, pero la responsabilidad tributaria se decide por entidad fiscal.
- En `fiscal_scope=ORGANIZATION`, `accounting_entity_id` debe apuntar a la entidad consolidada de la organizacion y `store_id` solo identifica la tienda que origino la operacion.
- En `fiscal_scope=STORE`, `accounting_entity_id` debe apuntar a la entidad fiscal de la tienda y ningun documento puede usar configuracion, resolucion o consecutivo de otra tienda.
- Todo documento fiscal tiene lifecycle explicito: draft, locally_validated, queued, submitted, rejected_by_provider, received_by_dian, accepted_by_dian, rejected_by_dian, contingency, corrected, voided/internal_cancelled cuando aplique.
- Los estados contables no se derivan de "enviado"; se derivan de aceptacion DIAN o de una decision contable documentada.
- Toda transmision es idempotente, auditable y recuperable.
- Produccion no permite proveedor mock, firma ausente, certificado vencido, test_set pendiente, resolucion vencida, numeracion agotada ni datos fiscales incompletos.

## Alternatives Considered

- Parchear solo `InvoiceFlowService` y el proveedor DIAN directo. Rechazada porque dejaria documento soporte, nomina, scoping fiscal, numeracion y contabilidad sin garantia integral.
- Usar exclusivamente un proveedor tecnologico externo y borrar DIAN directo. Rechazada porque contradice el modelo de Vendix como herramienta SaaS usada por cada cliente como software propio; puede ser una opcion futura, pero no el camino productivo principal.
- Mantener mocks en produccion con advertencias visuales. Rechazada por riesgo legal: un mock nunca debe generar estados fiscales productivos.
- Reescritura total sin reutilizar wizard, scoping, Prisma y contabilidad. Rechazada porque aumenta riesgo y retrasa la validacion; la base existente ya contiene patrones aprovechables.
- Contabilizar al validar localmente y corregir despues. Rechazada para el flujo fiscal final porque puede crear libros inconsistentes frente a documentos rechazados por DIAN.

## Critical Files

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20260310055218_add_invoicing_accounting_payroll_modules/migration.sql`
- `apps/backend/prisma/migrations/20260311050000_add_dian_configurations/migration.sql`
- `apps/backend/prisma/migrations/20260511190000_close_fiscal_scope_gaps_phase2/migration.sql`
- `apps/backend/src/common/services/fiscal-scope.service.ts`
- `apps/backend/src/common/services/fiscal-scope-migration.service.ts`
- `apps/backend/src/common/services/fiscal-status.service.ts`
- `apps/backend/src/common/services/fiscal-status-resolver.service.ts`
- `apps/backend/src/prisma/services/store-prisma.service.ts`
- `apps/backend/src/prisma/services/organization-prisma.service.ts`
- `apps/backend/src/domains/store/invoicing/invoicing.module.ts`
- `apps/backend/src/domains/store/invoicing/invoicing.controller.ts`
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts`
- `apps/backend/src/domains/store/invoicing/invoice-flow/invoice-flow.service.ts`
- `apps/backend/src/domains/store/invoicing/utils/invoice-number-generator.ts`
- `apps/backend/src/domains/store/invoicing/resolutions/resolutions.service.ts`
- `apps/backend/src/domains/organization/invoicing/invoice-resolutions/invoice-resolutions.service.ts`
- `apps/backend/src/domains/store/invoicing/dian-config/dian-config.service.ts`
- `apps/backend/src/domains/organization/invoicing/dian-config/dian-config.service.ts`
- `apps/backend/src/domains/organization/settings/settings.service.ts`
- `apps/backend/src/domains/store/invoicing/dian-config/dian-test.service.ts`
- `apps/backend/src/domains/store/invoicing/providers/invoice-provider.interface.ts`
- `apps/backend/src/domains/store/invoicing/providers/invoice-provider-resolver.service.ts`
- `apps/backend/src/domains/store/invoicing/providers/mock-invoice-provider.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-direct.provider.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-soap.client.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-xml-signer.service.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-response-parser.service.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/utils/cufe-calculator.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml-builders/invoice-xml.builder.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml-builders/credit-note-xml.builder.ts`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml-builders/debit-note-xml.builder.ts`
- `apps/backend/src/domains/store/invoicing/credit-notes/credit-notes.service.ts`
- `apps/backend/src/domains/store/invoicing/credit-notes/dto/create-credit-note.dto.ts`
- `apps/backend/src/domains/store/payroll/payroll-runs/payroll-flow.service.ts`
- `apps/backend/src/domains/store/payroll/payroll-runs/payroll-runs.controller.ts`
- `apps/backend/src/domains/store/payroll/payroll-runs/payroll-runs.service.ts`
- `apps/backend/src/domains/store/payroll/providers/payroll-provider.module.ts`
- `apps/backend/src/domains/store/payroll/providers/payroll-provider.interface.ts`
- `apps/backend/src/domains/store/payroll/providers/mock-payroll.provider.ts`
- `apps/backend/src/domains/store/payroll/providers/dian-payroll/dian-payroll.provider.ts`
- `apps/backend/src/domains/store/payroll/providers/dian-payroll/xml-builders/payroll-xml.builder.ts`
- `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts`
- `apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts`
- `apps/backend/src/common/exceptions/error-codes.ts`
- `apps/backend/src/common/services/response.service.ts`
- `apps/backend/src/common/filters/all-exceptions.filter.ts`
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`
- `apps/frontend/src/app/shared/components/fiscal-activation-wizard/`
- `apps/frontend/src/app/shared/components/forms/dian-config-form/dian-config-form.component.ts`
- `apps/frontend/src/app/shared/components/fiscal-management-panel/fiscal-management-panel.component.ts`
- `apps/frontend/src/app/shared/components/fiscal-obligation-banner/fiscal-obligation-banner.component.ts`
- `apps/frontend/src/app/shared/components/forms/payroll-settings-form/payroll-settings-form.component.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/components/dian-config/dian-config.component.ts`
- `apps/frontend/src/app/private/modules/store/invoicing/components/dian-config/dian-config-wizard.component.ts`
- `apps/frontend/src/app/private/modules/organization/invoicing/pages/dian-config/org-dian-config.component.ts`
- `apps/frontend/src/app/shared/utils/date.util.ts`

## Reusable Assets

- `FiscalScopeService.resolveAccountingEntityForFiscal()` para resolver entidad fiscal segun ORGANIZATION vs STORE.
- `StorePrismaService` y `OrganizationPrismaService` como base de scoping, con ajustes para nuevos modelos fiscales.
- Wizard fiscal existente en backend y frontend para activar fiscalidad, facturacion, contabilidad y nomina.
- `dian_configurations` y `dian_audit_logs` como base de configuracion y trazabilidad.
- `invoice_resolutions` como base de resoluciones, con endurecimiento por entidad fiscal y tipo documental.
- Builders XML existentes para factura, nota credito, nota debito y nomina como punto de partida, no como implementacion certificada final.
- Servicios de contabilidad automatica y `AccountingEventsListener`, con cambio de evento fuente.
- Colecciones Bruno de `bruno/Vendix/Fiscal Status Wizard/` y `bruno/Vendix/Fiscal Scope/`.
- Referencias Bruno de `bruno/API Factus/Facturas/`, `bruno/API Factus/Notas Crédito/` y `bruno/API Factus/Documentos soporte/` como insumo de payloads, no como fuente legal.
- Utilidades frontend existentes de fecha, formularios, wizard, paneles y componentes compartidos.

## Steps

### 1. Crear matriz legal-tecnica DIAN por tipo documental

- Skills: `vendix-business-analysis`, `how-to-plan`, `vendix-fiscal-scope`, `vendix-validation`.
- Resources: Resolucion DIAN 000227 de 2025, Resolucion DIAN 000165 de 2023, micrositio DIAN, anexo tecnico factura electronica v1.9, paginas DIAN de documento soporte y nomina electronica, pagina DIAN "Ser facturador electronico", noticia DIAN "3 pasos para facturar electronicamente".
- Business decision: Vendix emitira en produccion bajo modo software propio/desarrollo propio por entidad fiscal; cada SAS opera fiscalmente segun `organizations.fiscal_scope` y firma con su certificado.
- Why: sin matriz no hay forma de afirmar cumplimiento ni saber que campos, eventos, codigos, plazos, resoluciones y evidencias son obligatorios.
- Output: `planning/dian-compliance-matrix.md` con requisitos por factura, nota credito, nota debito, documento soporte, nota de ajuste, nomina individual y ajustes de nomina.
- Verification: cada requisito debe tener fuente oficial, tipo documental, campo/estado afectado, validacion tecnica, prueba automatizada asociada y evidencia esperada.

### 2. Bloquear riesgos productivos actuales antes de ampliar funcionalidad

- Skills: `vendix-error-handling`, `vendix-validation`, `vendix-backend-api`, `vendix-permissions`.
- Resources: `invoice-provider-resolver.service.ts`, `mock-invoice-provider.ts`, `payroll-provider.module.ts`, `mock-payroll.provider.ts`, `invoice-flow.service.ts`, `dian-direct.provider.ts`, `dian-payroll.provider.ts`.
- Business decision: ninguna SAS puede activar produccion DIAN si usa mock, certificado ausente, resolucion vencida, ambiente test pendiente o configuracion incompleta.
- Why: el riesgo mas grave no es fallar, sino registrar exito fiscal falso.
- Output: feature gates y validaciones que impidan estados productivos cuando el proveedor no es real o la firma/configuracion no es valida.
- Verification: pruebas unitarias que demuestren que mock solo funciona en `development/test`; pruebas API que devuelvan error normalizado si se intenta enviar en produccion sin configuracion completa.

### 3. Redisenar el modelo fiscal canonico alrededor de `accounting_entity_id`

- Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-prisma-scopes`, `vendix-fiscal-scope`.
- Resources: `schema.prisma`, migraciones fiscales existentes, `FiscalScopeService`, `StorePrismaService`, `OrganizationPrismaService`.
- Business decision: `accounting_entity_id` sera obligatorio para documentos fiscales definitivos. En `fiscal_scope=ORGANIZATION`, todas las tiendas usan la entidad fiscal consolidada de la organizacion y `store_id` solo queda como origen operacional. En `fiscal_scope=STORE`, cada documento usa la entidad fiscal propia de la tienda y queda prohibido mezclar configuracion fiscal entre tiendas.
- Why: DIAN valida por sujeto obligado/NIT/software/resolucion; Vendix debe reflejar esa frontera.
- Output: migracion con `accounting_entity_id` en `invoices`, indices por entidad fiscal/tipo/numero, constraints que impidan entidad fiscal ajena al scope, y nuevos modelos para documento soporte, eventos DIAN, archivos XML/ZIP, transmisiones y estados por item de nomina.
- Verification: `npm run db:migrate:dev -w apps/backend`, `npm run prisma:generate -w apps/backend`, pruebas de scoping por ORGANIZATION y STORE, pruebas anti-fuga entre dos tiendas, y backfill idempotente para datos existentes.

### 4. Definir maquina de estados fiscal y contable

- Skills: `vendix-business-analysis`, `vendix-error-handling`, `vendix-auto-entries`, `vendix-accounting-rules`.
- Resources: `invoice-flow.service.ts`, `payroll-flow.service.ts`, `auto-entry.service.ts`, `accounting-events.listener.ts`, `dian_audit_logs`.
- Business decision: los asientos contables definitivos se generan al aceptar DIAN/proveedor; la validacion local no causa asiento fiscal definitivo.
- Why: mezclar estados locales, estados DIAN y estados contables crea libros inconsistentes.
- Output: enums y transiciones permitidas para documento, transmision, DIAN y contabilidad, con tabla de eventos de dominio.
- Verification: pruebas de transicion que impidan saltos ilegales, doble contabilizacion, anulaciones no soportadas y reintentos sobre documentos ya aceptados.

### 5. Endurecer configuracion DIAN y datos maestros fiscales

- Skills: `vendix-settings-system`, `vendix-validation`, `vendix-fiscal-scope`, `vendix-error-handling`.
- Resources: `dian-config.service.ts` store/org, `dian-config-form.component.ts`, `fiscal-activation-wizard`, `accounting_entities`.
- Business decision: en `fiscal_scope=ORGANIZATION`, la configuracion DIAN editable vive en la organizacion/entidad consolidada y aplica a todas las tiendas; las tiendas no pueden activar una configuracion DIAN divergente. En `fiscal_scope=STORE`, cada tienda debe completar su propia configuracion DIAN antes de emitir.
- Why: UBL valido depende de NIT, DV, regimen/responsabilidades, municipio, direccion, tributos, software, certificado y resolucion correctos.
- Output: checklist bloqueante de configuracion con validacion de NIT/DV, certificado, vigencia, ambiente, software, rangos y datos de emisor, diferenciado por scope ORGANIZATION vs STORE.
- Verification: Bruno `Fiscal Status Wizard` extendido para probar configuracion incompleta, vencida, test, produccion, activacion bloqueada, tienda heredando configuracion organizacional y tienda exigiendo configuracion propia.

### 6. Implementar numeracion atomica por entidad fiscal, tipo y resolucion

- Skills: `vendix-prisma-migrations`, `vendix-backend`, `vendix-validation`, `vendix-fiscal-scope`.
- Resources: `invoice-number-generator.ts`, `resolutions.service.ts`, `invoice-resolutions.service.ts`, `invoice_resolutions`.
- Business decision: definir series separadas para factura, nota credito, nota debito, documento soporte y nomina si aplica segun resolucion/proveedor.
- Why: saltos, duplicados o rangos agotados pueden producir rechazos DIAN y contingencias fiscales.
- Output: asignador transaccional con bloqueo/advisory lock o update condicional atomico, validacion de vigencia/rango y reserva por tipo documental.
- Verification: prueba concurrente con multiples solicitudes simultaneas; ninguna duplica numero, ninguna supera `range_to`, y todos los errores quedan auditados.

### 7. Ampliar la interfaz de proveedor fiscal

- Skills: `vendix-backend-domain`, `vendix-backend-api`, `vendix-error-handling`, `vendix-validation`.
- Resources: `invoice-provider.interface.ts`, `fiscal-provider.interface.ts`, `invoice-provider-resolver.service.ts`, `DianDirectProvider`, configuracion DIAN por entidad fiscal.
- Business decision: produccion usa DIAN directo como software propio de cada entidad fiscal, con certificado propio del cliente y sin mocks; Vendix conserva contrato canonico propio, auditoria e idempotencia.
- Why: factura, notas, documento soporte y nomina tienen metodos, payloads y respuestas diferentes; la interfaz actual no los cubre.
- Output: `FiscalProviderAdapter` con metodos separados para factura, nota credito, nota debito, documento soporte, nota de ajuste, nomina, ajuste de nomina, consulta de estado y descarga/evidencia.
- Verification: tests contractuales con proveedor mock estricto en test, DIAN sandbox y validacion de que produccion rechaza adaptadores no certificados.

### 8. Completar factura electronica de venta

- Skills: `vendix-backend`, `vendix-validation`, `vendix-error-handling`, `vendix-date-timezone`, `vendix-accounting-rules`.
- Resources: Anexo tecnico factura electronica v1.9, `invoice-xml.builder.ts`, `cufe-calculator.ts`, `dian-xml-signer.service.ts`, `dian-soap.client.ts`, `invoicing.service.ts`.
- Business decision: confirmar reglas de impuestos, retenciones, descuentos, cargos, redondeos y moneda soportada para cada SAS.
- Why: factura electronica es el flujo principal y base para notas, contabilidad e inventario.
- Output: UBL/XML completo, CUFE correcto, QR, firma valida, ZIP/transmision, validacion previa, almacenamiento XML/respuesta y estado DIAN.
- Verification: XML validado contra XSD/reglas DIAN, prueba con factura gravada/exenta/excluida, descuentos, multiples impuestos, adquirente con NIT/CC/consumidor final, y aceptacion en ambiente DIAN.

### 9. Corregir notas credito y notas debito

- Skills: `vendix-backend`, `vendix-validation`, `vendix-error-handling`, `vendix-accounting-rules`.
- Resources: `credit-notes.service.ts`, `create-credit-note.dto.ts`, `credit-note-xml.builder.ts`, `debit-note-xml.builder.ts`, `InvoiceFlowService`.
- Business decision: definir politicas de reversa total/parcial, devoluciones, descuentos posteriores, correcciones y causales permitidas por negocio.
- Why: una nota sin referencia, codigo de causa, CUDE o totales correctos puede invalidar el ajuste fiscal.
- Output: servicios y DTOs para nota credito/debito con documento original obligatorio, CUFE original, codigos DIAN configurables, numeracion propia, XML y transmision separada.
- Verification: pruebas de nota parcial, total, sobre factura rechazada, sobre factura aceptada, doble nota, totales superiores al original y rechazo DIAN propagado correctamente.

### 10. Implementar documento soporte y notas de ajuste

- Skills: `vendix-business-analysis`, `vendix-backend-domain`, `vendix-prisma-schema`, `vendix-validation`, `vendix-accounting-rules`.
- Resources: pagina DIAN de documento soporte, schema Prisma, modulos de expenses/purchases si aplican, referencias Bruno `bruno/API Factus/Documentos soporte/`.
- Business decision: definir desde que flujo nacen los documentos soporte: compras, gastos, egresos, proveedores no obligados o carga manual.
- Why: hoy es la mayor ausencia funcional del sistema DIAN; sin esto Vendix no cubre adquisiciones a no obligados a facturar.
- Output: dominio `support-documents` con CUDS, proveedor/vendedor, items, impuestos/retenciones, resolucion, XML, QR, transmision DIAN y notas de ajuste.
- Verification: Bruno completo para crear, validar, enviar, consultar, ajustar y rechazar documento soporte; pruebas contables de gasto/costo/impuesto/retencion.

### 11. Completar nomina electronica y ajustes por empleado

- Skills: `vendix-backend`, `vendix-validation`, `vendix-date-timezone`, `vendix-accounting-rules`, `vendix-fiscal-scope`.
- Resources: pagina DIAN de nomina electronica, `payroll-flow.service.ts`, `payroll-runs.service.ts`, `DianPayrollProvider`, `payroll-xml.builder.ts`, `payroll_items`.
- Business decision: definir periodicidad, fecha de pago, devengos, deducciones, provisiones, parafiscales y manejo de ajustes/eliminaciones.
- Why: DIAN valida nomina por empleado/documento, no solo por corrida agregada; la evidencia debe quedar granular.
- Output: estado DIAN por `payroll_item`, CUNE/XML/respuesta por empleado, ajustes de nomina, reintentos por item y consolidacion de corrida.
- Verification: pruebas con empleados multiples, novedades, incapacidades/licencias si aplican, deducciones, ajuste posterior y aceptacion/rechazo individual en sandbox.

### 12. Implementar validacion previa fuerte antes de enviar

- Skills: `vendix-validation`, `vendix-error-handling`, `vendix-backend-api`, `vendix-date-timezone`.
- Resources: DTOs de factura/notas/documento soporte/nomina, builders XML, configuracion DIAN, resoluciones.
- Business decision: decidir que errores bloquean venta/nomina y cuales permiten guardar borrador.
- Why: DIAN no debe ser el primer validador; Vendix debe detectar errores antes de consumir numeracion o enviar documentos.
- Output: validadores por tipo documental con codigos de error Vendix, mensajes accionables y severidades.
- Verification: matriz de pruebas negativas para NIT invalido, DV invalido, fecha fuera de periodo, resolucion vencida, impuestos inconsistentes, totales descuadrados, certificado vencido y datos de adquirente/proveedor incompletos.

### 13. Redisenar auditoria, evidencia e idempotencia

- Skills: `vendix-error-handling`, `vendix-backend`, `vendix-prisma-schema`, `vendix-s3-storage` si se decide guardar archivos fuera de BD.
- Resources: `dian_audit_logs`, `DianDirectProvider.logDianOperation`, `DianPayrollProvider.logDianOperation`, response parser, SOAP/API client.
- Business decision: definir retencion de XML, ZIP, PDFs, hashes y respuestas DIAN por obligaciones legales y politica de privacidad.
- Why: ante auditoria, soporte o disputa, Vendix debe reconstruir que se envio, cuando, por quien, con que certificado y que respondio DIAN.
- Output: bitacora inmutable con correlation id, idempotency key, hash de payload, request/response sanitizados, estado anterior/nuevo, usuario, entidad fiscal y proveedor.
- Verification: pruebas que impiden sobrescribir evidencia, aseguran idempotencia en reintentos y permiten exportar paquete de auditoria por documento.

### 14. Implementar cola/reintentos seguros y consulta de estado DIAN

- Skills: `vendix-error-handling`, `vendix-backend`, `vendix-validation`.
- Resources: `InvoiceRetryJob`, eventos existentes, provider `checkStatus`, posibles BullMQ/jobs del backend.
- Business decision: definir politicas de reintento por error temporal, rechazo definitivo, timeout, contingencia y recuperacion manual.
- Why: los servicios DIAN/proveedor pueden fallar; el sistema debe recuperarse sin duplicar documentos ni cambiar estados incorrectamente.
- Output: outbox o job queue con reintentos exponenciales, idempotency keys, consulta de estado, reconciliacion y bloqueo de duplicados.
- Verification: simulaciones de timeout, HTTP 500, rechazo DIAN, respuesta tardia, reintento doble y reconciliacion posterior.

### 15. Alinear contabilidad automatica con documentos DIAN aceptados

- Skills: `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-fiscal-scope`, `vendix-business-analysis`.
- Resources: `auto-entry.service.ts`, `accounting-events.listener.ts`, mapping keys, PUC, impuestos, payroll provisions.
- Business decision: el evento contable definitivo es aceptacion DIAN/proveedor; los documentos rechazados no causan asiento fiscal definitivo.
- Why: la contabilidad debe cuadrar con la realidad fiscal y evitar asientos por documentos no validos.
- Output: eventos `fiscal_document.accepted`, `fiscal_note.accepted`, `support_document.accepted`, `payroll_item.accepted` y reversas controladas.
- Verification: pruebas de debito/credito por factura, nota, soporte y nomina; validacion PUC; no doble asiento; reversa con trazabilidad al documento original.

### 16. Garantizar scoping organizacion/tienda/entidad fiscal en toda consulta y mutacion

- Skills: `vendix-prisma-scopes`, `vendix-fiscal-scope`, `vendix-operating-scope`, `vendix-backend-auth`, `vendix-permissions`.
- Resources: `StorePrismaService`, `OrganizationPrismaService`, controladores store/org de facturacion, nomina y configuracion DIAN.
- Business decision: una tienda en `fiscal_scope=STORE` solo ve, emite, corrige y consulta documentos de su entidad fiscal. Una tienda en `fiscal_scope=ORGANIZATION` puede originar documentos, pero estos se emiten con la entidad/configuracion fiscal organizacional. La organizacion ve consolidado por entidad fiscal y puede filtrar por tienda solo como desglose operacional.
- Why: mezclar documentos entre SAS, tiendas o NITs seria un riesgo fiscal y de privacidad.
- Output: filtros obligatorios por entidad fiscal, permisos por modulo, endpoints store/org separados, resolucion fiscal centralizada y tests anti-fuga.
- Verification: pruebas con dos organizaciones, multiples tiendas, una organizacion `fiscal_scope=ORGANIZATION` y otra `fiscal_scope=STORE`; ningun endpoint devuelve o modifica documentos fuera de scope, y las facturas creadas desde tiendas bajo ORGANIZATION usan la misma entidad fiscal organizacional.

### 17. Completar frontend operativo y controles de activacion

- Skills: `vendix-frontend`, `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-frontend-component`, `vendix-ui-ux`, `vendix-error-handling`.
- Resources: wizard fiscal, `dian-config-form.component.ts`, `fiscal-management-panel`, `org-dian-config.component.ts`, modulos de invoicing y payroll.
- Business decision: definir quien puede activar produccion y que confirmaciones legales debe aceptar.
- Why: la UI debe evitar configuraciones incompletas y hacer visible el estado fiscal real sin textos ambiguos.
- Output: pantallas de configuracion, pruebas DIAN, resoluciones, estados por documento, errores accionables, evidencias y bloqueo visual de produccion.
- Verification: `npm run build -w apps/frontend`, `npm run zoneless:audit`, pruebas manuales en browser para desktop/mobile y escenarios de error.

### 18. Crear suite Bruno y pruebas automatizadas end-to-end

- Skills: `vendix-bruno-test`, `buildcheck-dev`, `vendix-validation`, `vendix-error-handling`.
- Resources: `bruno/Vendix/Fiscal Status Wizard/`, `bruno/Vendix/Fiscal Scope/`, nuevas colecciones DIAN, `test:e2e`.
- Business decision: definir datos semilla de una SAS de prueba, una tienda STORE, una organizacion ORGANIZATION, resoluciones y certificados sandbox.
- Why: un sistema legal de alto riesgo necesita pruebas repetibles y evidencia versionada.
- Output: colecciones Bruno para happy paths y rechazos de factura, nota credito, nota debito, documento soporte, ajuste, nomina y scoping.
- Verification: `npm run test -w apps/backend`, `npm run test:e2e -w apps/backend`, `npm run build`, `npm run lint`, Bruno local contra backend y revision de logs Docker.

### 19. Validar en ambiente DIAN/sandbox y conservar evidencias

- Skills: `vendix-business-analysis`, `vendix-error-handling`, `buildcheck-dev`.
- Resources: test set DIAN, configuracion DIAN, logs de auditoria, XML/ZIP, respuestas DIAN, certificados de prueba.
- Business decision: ninguna SAS pasa a produccion hasta tener habilitacion/evidencia de pruebas para sus obligaciones reales, certificado digital vigente, resoluciones asociadas y configuracion DIAN `production/enabled`.
- Why: pasar pruebas locales no equivale a estar habilitado ante DIAN.
- Output: carpeta o registro de evidencias por entidad fiscal con documentos enviados, respuestas aceptadas, rechazos corregidos y fecha de aprobacion.
- Verification: checklist firmado por responsable tecnico y responsable contable; estado `production_enabled` solo cuando las evidencias esten completas.

### 20. Preparar migracion, rollout y plan de contingencia

- Skills: `vendix-prisma-migrations`, `git-workflow`, `buildcheck-dev`, `vendix-error-handling`.
- Resources: migraciones Prisma, scripts de backfill, feature flags, runbook operativo, Docker logs.
- Business decision: definir ventana de migracion, congelamiento de emision, contingencia manual y responsable de aprobacion.
- Why: cambiar fiscalidad en vivo puede afectar ventas, compras, nomina y contabilidad.
- Output: plan de despliegue con backups, validaciones pre/post, rollback logico, comunicacion interna y monitoreo.
- Verification: ensayo en staging con copia anonimizada, `npm run db:migrate:prod -w apps/backend` en entorno controlado, health checks, conciliacion de conteos y logs sin errores criticos.

## End-to-End Verification

La verificacion final debe ejecutarse por entidad fiscal y por modo de scope: una organizacion con `fiscal_scope=ORGANIZATION`, una organizacion con `fiscal_scope=STORE` y minimo dos tiendas para probar aislamiento.

Comandos base:

- `npm run prisma:generate -w apps/backend`
- `npm run db:migrate:dev -w apps/backend`
- `npm run test -w apps/backend`
- `npm run test:e2e -w apps/backend`
- `npm run build -w apps/backend`
- `npm run build -w apps/frontend`
- `npm run build`
- `npm run lint`
- `npm run zoneless:audit`
- `docker logs --tail 80 vendix_backend`
- `docker logs --tail 80 vendix_frontend`

Pruebas funcionales obligatorias:

- Activar wizard fiscal con datos incompletos debe fallar con error normalizado.
- Activar wizard fiscal con configuracion completa en test debe quedar en modo pruebas, no produccion.
- Enviar factura electronica aceptada debe guardar XML, CUFE, QR, respuesta DIAN, auditoria y asiento contable segun decision aprobada.
- Enviar factura rechazada debe quedar rechazada, sin asiento definitivo y con mensaje accionable.
- Crear nota credito/debito sobre factura no aceptada debe bloquearse.
- Crear nota credito/debito valida debe referenciar CUFE original, causal, totales y respuesta DIAN.
- Crear documento soporte debe generar CUDS, XML, evidencia y asiento contable.
- Crear nota de ajuste de documento soporte debe referenciar documento soporte original.
- Enviar nomina electronica debe guardar CUNE/XML/respuesta por empleado, no solo por corrida.
- Reintentar un envio con timeout no debe duplicar numeracion ni documentos DIAN.
- Consultar estado DIAN debe reconciliar documentos pendientes sin pisar evidencias.
- Un usuario de tienda no puede ver ni modificar documentos de otra tienda en fiscal_scope STORE.
- En `fiscal_scope=ORGANIZATION`, una factura creada desde tienda A y otra desde tienda B deben usar el mismo `accounting_entity_id`, misma configuracion DIAN organizacional y resoluciones organizacionales, conservando `store_id` solo como origen operacional.
- En `fiscal_scope=STORE`, una factura creada desde tienda A y otra desde tienda B deben usar `accounting_entity_id`, configuracion DIAN, resolucion y consecutivo propios de cada tienda.
- En `fiscal_scope=ORGANIZATION`, la UI de tienda no debe permitir crear/editar una configuracion DIAN fiscal divergente.
- En `fiscal_scope=STORE`, la UI de cada tienda debe bloquear emision hasta completar su configuracion DIAN propia.
- Un usuario organizacional solo ve consolidado cuando su rol/permiso y fiscal_scope lo permiten.
- Un certificado vencido, resolucion vencida o rango agotado bloquea envio.
- Produccion con proveedor mock debe ser imposible.

Evidencia minima para salida a produccion:

- Matriz DIAN completa y aprobada.
- Pruebas unitarias/e2e/Bruno en verde.
- Evidencia de sandbox/test set por tipo documental.
- Checklist de configuracion por entidad fiscal.
- Checklist de permisos y scoping.
- Paquete de auditoria exportable por documento.
- Runbook de errores, reintentos, contingencia y soporte.
- Aprobacion escrita de responsable tecnico y responsable contable/legal.

## Knowledge Gaps

- Confirmar con contador/revisor fiscal el alcance exacto de obligaciones por cada SAS: factura, documento soporte, nomina, periodicidades, responsabilidades tributarias, retenciones y regimen.
- Confirmar con soporte DIAN/asesor tributario el registro correcto del modo de operacion como software propio/desarrollo propio para una herramienta SaaS multi-tenant usada por cada entidad fiscal.
- Confirmar entidad certificadora, vigencia, custodia, renovacion y autorizacion contractual para adquirir e instalar certificados digitales por cuenta de cada cliente.
- Confirmar requisitos de conservacion documental, retencion de XML/ZIP/PDF/respuestas y tratamiento de datos personales.
- Confirmar codigos DIAN finales para tipos de operacion, medios de pago, tributos, unidades, responsabilidades fiscales y causales de notas segun matriz oficial actualizada.
- Confirmar manejo de contingencia, indisponibilidad DIAN/proveedor y facturacion POS si aplica.
- Confirmar si el flujo comercial debe bloquear venta hasta aceptacion DIAN o permitir entrega con estado fiscal pendiente bajo politica definida.

No se propone crear una nueva skill todavia; el patron de "cumplimiento DIAN end-to-end" usa varias skills existentes. Si durante implementacion aparecen reglas repetibles no cubiertas, se debe proponer una skill especifica `vendix-dian-compliance`.

## Approval Request

Este plan esta listo para ejecucion, pero no debe implementarse sin aprobacion explicita por el riesgo legal y contable.

Para proceder, responde con una instruccion clara como:

- `apruebo el plan completo`
- `procede con la fase 1`
- `ejecuta solo la matriz legal-tecnica`
- `ajusta el plan antes de implementar`
