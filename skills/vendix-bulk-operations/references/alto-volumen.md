# Bulk alto volumen (hasta 10.000)

Detalle de `vendix-bulk-operations`. Leer bajo demanda.

- **Regla:** el tope TOTAL es 10.000 (`MAX_BULK_RECORDS`); cada request lleva
  como máximo 100 (`DEFAULT_BULK_CHUNK_SIZE`, `@ArrayMaxSize(100)`) y el CLIENTE
  parte los lotes. Excepción: la recepción de OC se parte en el backend dentro
  de un job, porque cada lote es una transacción contable.
- **Archivos (productos, empleados, ajustes):** sesión S3 + commit paginado
  `{session_id, offset?, limit≤100}` es el patrón estándar; límite de archivo 20 MB.
  Clientes (JSON) va con `@ArrayMaxSize(100)` por request y chunking en cliente.
- **`runChunked`** (`apps/frontend/src/app/shared/utils/run-chunked.ts`, con
  `chunkArray`): emite progreso por lote. Si un lote falla, reporta `failedAt`;
  se reintenta con `items.slice(failedAt)`. Los lotes ya confirmados NO se
  revierten. La UI muestra barra de progreso y al cancelar hace DELETE de la sesión.
- **Órdenes de compra:** `POST purchase-orders/resolve-lines` (≤100 líneas,
  idempotente, con alcance a la tienda del contexto, no modifica productos
  existentes) en lotes; luego UN `create`/`update`/`cost-preview` atómico (hasta
  10k; `create` rechaza más de 100 líneas sin resolver). La recepción va por job
  BullMQ `purchase-order-receive` (`PATCH :id/receive/async` → 202 + `job_id`, poll
  `receive-jobs/:jobId`), lotes de 100, cada uno recepción parcial en su propia
  transacción. La remisión con más de 100 líneas devuelve `po_receive_job_id`.
  Al reintentar, el POP envía solo lo pendiente.
- **Antipatrones:** subir timeouts de nginx o de la transacción en vez de
  partir; meter N consultas por línea dentro de una transacción (precargar en
  bloque y escribir en lote); `sku: undefined` en un `where` de Prisma (filtra
  nada y puede casar cualquier fila).

