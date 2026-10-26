---
name: vendix-bulk-operations
description: >
  Bulk operations pattern: dedicated controller+service, @ArrayMaxSize(100) DTO, concatMap chunking,
  partial-failure results, XLSX/CSV imports. Trigger: bulk actions on orders/purchases/products, bulk
  printing, file imports, QUI-567/QUI-599.
license: MIT
metadata:
  author: rzyfront
  version: "1.4"
  scope: [root]
  auto_invoke:
    - "Raising bulk caps or chunking high-volume uploads (10k)"
    - "Adding a column to an XLSX/CSV bulk import template or its header map"
    - "Paging a bulk upload session commit (offset/limit) with a progress bar"
    - "Importing parent/child rows (product variants via SKU Padre) from an XLSX bulk file"
    - "Adding bulk operations to a module (orders, purchases, products)"
    - "Creating a dedicated bulk controller separate from the CRUD controller"
    - "Bulk-printing documents respecting store_settings.receipts format"
    - "Reusing the QUI-567 bulk-edit or QUI-599 bulk-operations pattern"
    - "Adding @ArrayMaxSize bulk DTOs and client-side chunking"
    - "Bulk transitioning entity state by delegating to existing flow seams"
---
# Vendix Bulk Operations

## Scope

Dedicated bulk surface for a module: a controller + service pair, separate from CRUD, that applies one action to N entities, tolerates partial failure and delegates to the module's existing seams. References: orders/sales (QUI-599: transition, assign-route, print, cash-session), products bulk edit (QUI-567: preview + apply + archive) and file imports. Does not govern single-entity CRUD or the flow services themselves.

## Core Rules

- **Dedicated controller, separate path:** `store/{module}/bulk/*` (e.g. `OrdersBulkController` → `store/orders/bulk/*`). Frontend route `bulk` declared **before** `:id` in `store_admin.routes.ts`.
- **Dedicated permission per surface:** `store:{module}:bulk_update`, `store:{module}:bulk_print`, distinct from single-entity perms. Controllers reinforce by name with the `assertNamedPermission` calque (super_admin bypass, `perm.name === required && status === 'active'`) from `products-bulk-edit.controller.ts`.
- **`@ArrayMaxSize(100)` per request**; the backend never chunks, the client does. Total cap 10.000 (`MAX_BULK_RECORDS`, `DEFAULT_BULK_CHUNK_SIZE = 100` in `apps/frontend/src/app/shared/utils/run-chunked.ts`). Only exception: PO receive is chunked server-side in a BullMQ job.
- **Partial-failure tolerant:** `failed > 0` is still HTTP 200; result DTO carries per-row `{status: 'ok'|'error', code, message}`. Whole-request errors are thrown (`VendixHttpException`), never returned via `responseService.error` (see `vendix-error-handling`).
- **Delegate, never rewrite effects:** `OrderFlowService.forceOrderState(id, target, {reason})` for transitions, `DispatchNotesService.createFromOrdersBatch(dto)` then ONE `DispatchRoutesService.addStops(...)` for remisiones + route (warn on ok rows if addStops fails). Never write `state` directly.
- **Preview endpoints** (`transition/preview`, `assign-route/preview`) replicate the real gates without writing, so the modal anticipates outcomes; same permission as the write.
- **Client chunking:** `concatMap` (not `mergeMap`) with `catchError` **inside** so a failed batch reports its ids as failed and the chain continues; or `runChunked` (reports `failedAt`, retry with `items.slice(failedAt)`; confirmed batches are not reverted). Progress exposed as a signal (`BulkOrdersProgress` / `BulkEditProgress`).
- **Selection state:** page owns a `selectedIds` Set (survives pagination/filters) and a growing cache Map; Zoneless signals, no `| async`.

## Bulk Printing (orders)

`POST store/orders/bulk/print` (`store:orders:bulk_print`) returns **JSON**, not a PDF: `BulkPrintResultDto { total, printable, orders[], skipped[], pos_ticket_format }` with `printable + skipped.length === total`. The backend never fails for one order: it skips `not_found` (out of store scope) and `non_printable_state` (`cancelled`/`refunded`); only "nothing printable" is an HTTP error. Paper comes from `store_settings.receipts.pos_ticket_format` only (fallback `thermal_80`), never from the client.

The frontend renders: `OrdersBulkPrintService` → `OrdersBulkService.fetchPrintableOrdersInBatches()` → `OrderTicketService.toTicketData()` → `PosTicketService.printTicketsBatch()` (same renderer as the POS post-sale ticket and Settings → Receipts preview). Render failures come back as `failedOrderIds` (`render_error`) and are reported, never dropped. Mixed formats (e-invoice vs POS ticket) print in separate batches, one dialog each. The printed issuer must match the signed fiscal identity (fiscal scope `STORE` vs `ORGANIZATION`).

## File Imports and High Volume

- Header maps keyed accent-free; code cells (barcode, NIT, phone) are text; never pad templates with empty cells; paged session commit `{session_id, offset?, limit≤100}`; commit re-validates the whole file; parent/child rows (variants via `SKU Padre`) persisted atomically through the owner service, never `variants` in `ProductsService.update`. Detail: `references/file-imports.md` (read on demand).
- Files (products, employees, adjustments): S3 session + paged commit, 20 MB limit. Purchase orders: `resolve-lines` in batches, one atomic `create`, receive via job `PATCH :id/receive/async` → poll `receive-jobs/:jobId`. Anti-patterns: raising nginx/transaction timeouts instead of chunking, N queries per line inside a transaction, `sku: undefined` in a Prisma `where`. Detail: `references/alto-volumen.md` (read on demand).

## Reference Files

- Backend: `apps/backend/src/domains/store/orders/{orders-bulk.controller.ts,orders-bulk.service.ts,dto/bulk-orders.dto.ts}`, `apps/backend/src/domains/store/products/{products-bulk.controller.ts,products-bulk.service.ts,products-bulk-edit.controller.ts}`.
- Frontend: `apps/frontend/src/app/private/modules/store/orders/bulk/` (`orders-bulk.interface.ts` with `MAX_BULK_ORDERS_IDS = 100`, `orders-bulk.service.ts`, `orders-bulk-print.service.ts`, `orders-bulk-page.component.ts`, `orders-bulk-confirm-modal.component.ts`).

## Related Skills

- `vendix-zoneless-signals` — the bulk page is Zoneless; signals, no `| async`.
- `vendix-permissions` — dedicated bulk permissions + `assertNamedPermission`.
- `vendix-error-handling` — rethrow, never return errors.
- `vendix-print-geometry` — POS ticket rendering and paper formats.
- `vendix-product-variants` — variant semantics (stock, price override, availability).
- `vendix-report-xlsx` — XLSX exports.
