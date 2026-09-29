# I.5 — alcance sin DDL y deuda de reintento

## Entregado en este paso

La vista **Auditoría → Ventas sin documento** usa exclusivamente `GET /store/fiscal/history?event_type=pos_sale_without_fiscal_document` y su paginación. El total viene de `meta.total`; cada constancia muestra tienda, entidad fiscal, motivo, fecha y una acción a `/admin/orders/:id`. Es un historial de fallos, **no** una afirmación de que la orden siga sin factura hoy: el detalle de la orden es la fuente del estado actual. El servicio de auditoría combina el contexto de entidad fiscal y tienda con cualquier filtro solicitado, sin permitir que `store_id` o `accounting_entity_id` de la query reemplacen el contexto autorizado.

No se crea endpoint, tabla, columna, fila de cola ni reintento automático. El listener eleva el fallo de emisión a `error` con la ruta de la orden; la lista contabiliza las constancias mediante `meta.total`.

## Deuda que exige ADR y migración separados

`invoice_retry_queue.invoice_id` es `Int` NOT NULL con FK a `invoices`. Una venta cobrada cuya factura falló **antes** de `createFromOrder` no tiene `invoice_id`, por lo que no cabe en la cola. El cambio de esquema a evaluar es `invoice_id` nullable + `order_id` FK a `orders` (con índices y una restricción que exija exactamente una referencia válida por fila). El ADR debe decidir la unicidad/idempotencia por pedido, la compatibilidad y backfill de filas existentes, y cómo representar una creación bloqueada por datos faltantes frente a un fallo transitorio reintentable.

Consumidores que el ADR debe cubrir conjuntamente:

1. `apps/backend/src/jobs/invoice-retry.job.ts`: selecciona filas pendientes y desreferencia `item.invoice.invoice_number`, `store_id` y `organization_id` sin guarda; un `invoice_id` nullable lo rompería.
2. `apps/backend/src/domains/store/invoicing/services/invoice-retry.listener.ts`: el evento y la retransmisión presuponen una factura existente; crear una factura desde la orden es otro circuito con validación y deduplicación propias.
3. `apps/backend/src/domains/store/invoicing/services/invoice-retry-queue.service.ts`: `enqueue`, `recordBlocked`, `markFailed`, `declareContingency`, `getRetryStatusByInvoiceIds` y `getQueueStats` están orientados a factura.
4. `apps/backend/src/domains/store/invoicing/pos/pos-fiscal-emission.service.ts`, `apps/backend/src/domains/store/invoicing/invoicing.service.ts` y `apps/backend/src/domains/fiscal-operations/services/fiscal-flow-state.service.ts`: productores y lecturas del estado/contadores deben distinguir pedido sin factura de factura en transmisión.

El ADR debe especificar además ownership del worker y recuperación tras crash, aislamiento de organización/tienda/entidad fiscal, límites de intentos, tratamiento de resolución/período/identidad incompletos, concurrencia con emisión manual, cierre de la constancia al emitir, métricas/alertas, rollback y pruebas de migración. **Responsable propuesto:** equipo backend de Fiscal/Facturación; el orquestador debe asignar una persona titular antes de abrir el trabajo DDL. Hasta entonces, reintento automático fuera de alcance.

## Brecha de aceptación no resuelta dentro del scope permitido

`PosFiscalEmissionService.recordUncoveredSale` llama `fiscal_operation_events.create` en cada fallo sin comprobación previa ni constraint única. Un segundo fallo de la misma orden puede duplicar la constancia y el contador. La corrección pertenece a `apps/backend/src/domains/store/invoicing/pos/pos-fiscal-emission.service.ts` y su spec, archivos **fuera del alcance de código asignado a I.5**; no se modificaron. El paso no debe declararse totalmente cerrado hasta que el orquestador asigne ese cambio o acepte expresamente esta deuda. El listado muestra constancias, no un conteo `DISTINCT order_id`.
