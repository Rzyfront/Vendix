---
name: vendix-bulk-operations
description: >
  Bulk (mass) operations pattern for Vendix modules: dedicated controller +
  service, DTO with @ArrayMaxSize(100), client-side chunking with concatMap,
  partial-failure tolerant results, permission per bulk surface. Trigger:
  When adding bulk operations to a module (orders, purchases, products),
  adding a dedicated bulk controller, bulk-printing respecting store
  receipt settings, reusing the QUI-567 / QUI-599 bulk pattern, or
  building XLSX/CSV file imports (header maps, code-as-text cells, paged
  session commit).
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Adding a column to an XLSX/CSV bulk import template or its header map"
    - "Paging a bulk upload session commit (offset/limit) with a progress bar"
    - "Adding bulk operations to a module (orders, purchases, products)"
    - "Creating a dedicated bulk controller separate from the CRUD controller"
    - "Bulk-printing documents respecting store_settings.receipts format"
    - "Reusing the QUI-567 bulk-edit or QUI-599 bulk-operations pattern"
    - "Adding @ArrayMaxSize bulk DTOs and client-side chunking"
    - "Bulk transitioning entity state by delegating to existing flow seams"
---

# Vendix Bulk Operations

## Purpose

Governs the **dedicated bulk surface** pattern for Vendix modules: a
controller + service pair separate from the CRUD controller that performs
the same action on N entities at once, tolerates partial failure, and
respects the module's existing seams (flow services, builders, dispatch).

Applies to:

- Orders / sales bulk operations (QUI-599): transition, assign-route, print.
- Products bulk edit (QUI-567): preview + apply + archive.
- Any future module that needs "select N → one action → per-row results".

Does NOT govern:

- Single-entity CRUD (the regular controller owns that).
- The flow services themselves (`OrderFlowService`, `DispatchNotesService`):
  the bulk service DELEGATES to them, never rewrites their effects.

## Core Rules

- **Dedicated controller, separate path.** Bulk lives at
  `store/{module}/bulk/*`, not `store/{module}/*`. The CRUD controller
  stays clean. Example: `OrdersBulkController` → `store/orders/bulk/*`.
- **Dedicated permission per surface.** Bulk write needs its own named
  permission (`store:orders:bulk_update`), distinct from the single-entity
  `store:orders:update`. Bulk-print needs `store:orders:bulk_print`,
  distinct from any single print. The backend `assertNamedPermission`
  calque (from `products-bulk-edit.controller.ts`) reinforces by name.
- **DTO carries `@ArrayMaxSize(100)`.** The `ValidationPipe` global
  enforces it; the backend never chunks. The CLIENT chunks. 100 is the
  established cap (QUI-567, QUI-599).
- **Partial-failure tolerant.** `failed > 0` is still HTTP 200. The result
  DTO (`BulkOrdersResultDto` / `BulkEditResultDto`) carries per-row
  `{status: 'ok'|'error', code, message}` so the operator always sees what
  succeeded and what failed.
- **Delegate to existing seams.** The bulk service does NOT rewrite
  per-entity effects. It calls the canonical methods one-by-one and
  aggregates:
  - `OrderFlowService.forceOrderState(id, target, {reason})` for state
    transitions (idempotent, audited, full effects).
  - `DispatchNotesService.createFromOrdersBatch(dto)` for remisiones.
  - `DispatchRoutesService.addStops(routeId, {stops})` for planilla stops.
- **Client chunking contract.** `concatMap` (NOT `mergeMap`), `catchError`
  INSIDE the `concatMap` so a failed batch degrades to "all failed" without
  aborting the chain. A 500 on batch 2 of 5 must not hide batches 3-5.
- **Progress as a signal.** The service exposes a `progress` signal
  (`BulkOrdersProgress` / `BulkEditProgress`) for the UI bar; no
  subscriptions required.
- **Printing respects store settings.** The backend resolves paper format
  from `store_settings.receipts` (`invoice_format` then `pos_ticket_format`,
  fallback `letter`), NEVER from the client. The bulk-print endpoint
  returns `application/pdf` (Blob). The client opens it in a new tab via
  `URL.createObjectURL` so the browser's native print dialog honors the
  operator's printer config (copies, paper).

## Decision Rules

| Situation | Use |
| --- | --- |
| New module needs bulk operations | Dedicated `{Module}BulkController` + `{Module}BulkService` at `store/{module}/bulk/*` |
| Bulk state transition | Delegate to the module's `forceState`/flow seam; do not write `state` directly |
| Bulk remisiones + ruta | `createFromOrdersBatch` then ONE `addStops` call; warn on ok rows if addStops fails |
| Bulk printing | Backend resolves format from `store_settings.receipts`; client opens Blob in new tab |
| Selection > 100 | Client chunks in batches of `MAX_*_IDS`; backend rejects >100 with 400 |
| One batch fails | `catchError` inside `concatMap` → that batch's ids report as failed, chain continues |
| Permission for bulk | Dedicated `store:{module}:bulk_update` / `store:{module}:bulk_print`, not the single-entity perm |

## Backend Anatomy

Reference: `apps/backend/src/domains/store/orders/`

```
dto/bulk-orders.dto.ts           # @ArrayMaxSize(100), targetState, route_id, copies
orders-bulk.service.ts            # delegates to OrderFlowService / DispatchNotes / builder
orders-bulk.controller.ts        # @Controller('store/orders/bulk'), assertNamedPermission
orders-pdf.builder.ts             # multi-page PDF, reuses GEOMETRY + PrintFormat
orders.module.ts                  # registers controller + service + imports
```

The controller uses the `assertNamedPermission` calque (bypasses super_admin,
checks `perm.name === required && perm.status === 'active'`), copied from
`products-bulk-edit.controller.ts`. Three endpoints:

- `POST /store/orders/bulk/transition` → `store:orders:bulk_update`
- `POST /store/orders/bulk/assign-route` → `store:orders:bulk_update`
- `POST /store/orders/bulk/print` → `store:orders:bulk_print` (returns Blob)

## Frontend Anatomy

Reference: `apps/frontend/src/app/private/modules/store/orders/bulk/`

```
orders-bulk.interface.ts         # mirror of backend DTOs, MAX_BULK_ORDERS_IDS = 100
orders-bulk.service.ts           # HTTP facade, chunk + concatMap + progress signal
orders-bulk-page.component.ts     # sticky-header, multi-select, action bar, route picker
```

The page owns the `selectedIds` Set (survives pagination/filter changes),
an `orderCache` Map (only grows), and an action bar. The print action opens
the Blob in a new tab so the browser's print dialog honors the operator's
printer config.

Route MUST be declared BEFORE `:id` in `store_admin.routes.ts`:

```typescript
{
  path: 'bulk',
  loadComponent: () =>
    import('.../orders-bulk-page.component').then((c) => c.OrdersBulkPageComponent),
},
{
  path: ':id',
  // ...
}
```

## Print Format Resolution (backend)

The bulk-print service resolves the format once (it's the store's, not the
order's):

```typescript
private resolvePrintFormat(store: any): PrintFormat {
  const receipts = store?.store_settings?.settings?.receipts;
  const format = receipts?.invoice_format ?? receipts?.pos_ticket_format;
  return PRINT_FORMATS.includes(format) ? format : 'letter';
}
```

The issuer resolves from `fiscal_data` of the fiscal scope that owns the
habilitation (`STORE` vs `ORGANIZATION`), same as
`InvoicePdfService.resolveIssuer`. The printed identity must match the
signed identity.

## File Imports (XLSX/CSV upload)

Reference: `products-bulk.service.ts` (analyze → S3 session → paged commit),
`bulk-upload-modal.component.ts`, `pop-bulk-data-modal.component.ts`.

- **Header matching:** `parseFile` normalizes headers (trim + lowercase + NFD,
  accents stripped) before looking them up in `HEADER_TRANSLATIONS`. Keys MUST
  be accent-free (`'codigo de barras'`, not `'código de barras'`). A header that
  is missing from the map is dropped silently, which is how a column "works in
  the template" yet never persists.
- **Codes are text, not numbers:** barcode, NIT, phone and similar cells come
  back from `.xlsx` as `number`. Convert with `String(v)` only when
  `Number.isSafeInteger(v)`. Reject scientific notation (`/e[+-]?\d+$/i`) with
  a row error asking the user to format the column as text. Format the
  template column as text (`z: '@'` in SheetJS; `numFmt = '@'` in ExcelJS) so
  leading zeros survive. A number Excel has already rounded cannot be
  recovered.
- **Never pad a template with empty cells:** writing `{t:'s', v:''}` to
  pre-format a column makes `sheet_to_json` read those rows as non-empty, and
  the re-uploaded file carries hundreds of phantom rows. Format only rows that
  hold data. In the reader, drop rows whose cells are all empty strings.
- **Paged session commit:** `POST .../upload-session {session_id, offset?, limit≤100}`
  re-parses the S3 file on each page (parsing is deterministic) and processes
  `slice(offset, offset+limit)`. `row_number = offset + rowIndex + 2`. Delete
  the S3 file only on `done`. Without offset/limit the request keeps the
  legacy full commit. The client walks the pages with `expand` so the
  server's `total` wins, with `catchError` per page. On close it cancels the
  session and unsubscribes in `destroyRef.onDestroy`, never through
  `complete`.
- **Batch only where there is real cost:** parsing ≤1000 rows in memory
  (POP) takes milliseconds, and a progress bar there is cosmetic. Page the
  server round-trips, not local maps.

## Related Skills

- `vendix-zoneless-signals` — the bulk page is Zoneless; signals, no `| async`.
- `vendix-permissions` — dedicated bulk permissions + `assertNamedPermission`.
- `vendix-report-xlsx` — the `GEOMETRY`/`PrintFormat` reuse pattern.
- `vendix-naming-conventions` — `{Module}BulkController` / `{Module}BulkService`.
- `how-to-plan` — bulk work is multi-file; plan it.