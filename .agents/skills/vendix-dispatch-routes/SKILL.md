---
name: vendix-dispatch-routes
description: >
  Planillas de despacho (rutas DSD con recaudo) para distribuidoras colombianas:
  agrupar múltiples remisiones en una ruta con vehículo/conductor/auxiliares y
  orden de paradas, ejecutar captura progresiva desde la app móvil, y cuadrar
  el recaudo al regreso reutilizando caja/cartera/refunds/retenciones existentes.
  Trigger: When working with dispatch_routes, dispatch_route_stops, vehicles,
  DSD route settlement, withholding breakdown per stop, declared_cash variance,
  route PDF print, or any "agregador de ruta que orquesta primitivas".
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Editing dispatch_routes or dispatch_route_stops schema or service"
    - "Editing the route flow (dispatch, settle, release-stop, close, void)"
    - "Modifying cash_variance or declared_cash logic"
    - "Editing the route PDF builder (pdf-export.service.ts)"
    - "Adding new transitions to dispatch_route_status_enum"
    - "Working with withholding_breakdown per stop (retefuente/reteiva/reteica)"
    - "Modifying the planillas-rutas frontend module"
    - "Adding new fields to dispatch_route_stop_history audit log"
---

## When to Use

- Touching `dispatch_routes`, `dispatch_route_stops`, `dispatch_route_stop_history`,
  or `vehicles` tables (any field, transition, or relation).
- Working with the DSD route flow: armar planilla → despachar → liquidar paradas
  en ruta → liberar paradas no entregadas → cerrar/cuadrar.
- Computing `cash_variance = declared_cash - cash_collected_in_route`.
- Generating or modifying the route PDF (encabezado ruta/vehículo/personal,
  tabla de paradas, totales, bloque de firmas).
- Working with retenciones fiscales (`withholding_breakdown`) por parada cuando
  el cliente es agente retenedor (`customers.is_withholding_agent = true`).
- Touching `apps/frontend/src/app/private/modules/store/planillas-rutas/`
  (lista, detalle, wizard, modales de settle/release/close, visor PDF).
- Modifying the `route-flow.controller.ts` endpoints
  (`/store/dispatch-routes/:id/{dispatch,close,void,pdf}` y
  `/store/dispatch-routes/:id/stops/:stopId/{start,settle,release}`).

## Core Rule: Orquestar, no duplicar

**The dispatch route is an aggregator, NOT a parallel system.** When a stop is
settled, the route emits domain events that existing listeners already handle:

| Event              | Listener                                              | Effect                                    |
|--------------------|-------------------------------------------------------|-------------------------------------------|
| `payment.received` | `accounting-events.listener` (auto-entries)            | Creates journal entry for cash sale        |
| `payment.received` | `ar-events.listener`                                   | Updates accounts_receivable if applicable  |
| `payment.received` | `commissions-events.listener`                          | Calculates commission                      |
| `payment.received` | `notifications-events.listener`                        | Pushes notification                       |
| `credit_sale.created` | `ar-events.listener`, `accounting-events.listener`   | Creates AR row, accounting entry           |
| `refund.completed` | `accounting-events.listener`                           | Creates refund accounting entry            |
| `cash_register.movement` | `accounting-events.listener`                       | Cash movement + auto-entry                |
| `dispatch_route.closed` | (none — informational, used by listeners elsewhere) | Signals route settlement complete         |
| `dispatch_route.voided` | (none — informational)                              | Signals route voided                      |

**Do NOT** create a parallel accounting/cash/AR/notification pipeline for
dispatch routes. The rule is: the route orchestrates, the existing primitives
do their job.

## Data Model (canonical)

### `dispatch_routes` (the planilla)

| Column | Type | Notes |
|---|---|---|
| `route_number` | `VARCHAR(50)` UNIQUE per store | Format `PLN{YYMMDD}{####}`, generated atomically |
| `route_code` | `VARCHAR(20)` | External identifier (e.g. "RI02") |
| `status` | enum | `draft` → `dispatched` → `in_transit` → `settling` → `closed` (or `voided` at any non-terminal point) |
| `vehicle_id` | FK → `vehicles` nullable | Set null on vehicle delete |
| `driver_user_id` | FK → `users` nullable | OR `external_driver_*` (mutually exclusive or both allowed) |
| `external_driver_name`, `external_driver_id_number` | VARCHAR nullable | External driver fallback |
| `is_primary_driver_external` | BOOLEAN | When both `driver_user_id` and `external_driver_*` are set, flags who actually drives |
| `assistants` | JSONB | Array of `{user_id?, external_name?, external_id_number?, role?}` |
| `origin_location_id` | FK → `inventory_locations` nullable | Where the route physically starts |
| `planned_date` | TIMESTAMP NOT NULL | When the route is planned to dispatch |
| `dispatch_started_at` / `closed_at` / `voided_at` | TIMESTAMP nullable | State-change timestamps |
| `total_to_collect`, `total_collected`, `total_prepaid`, `total_changes`, `total_withholdings`, `total_credit` | DECIMAL(14,2) | Aggregated route totals, all default 0 |
| `declared_cash` | DECIMAL(14,2) nullable | Cash the conductor physically brings back (set at `close`) |
| `cash_variance` | DECIMAL(14,2) nullable | `declared_cash - cash_collected` (positive = sobra, negative = falta) |
| `currency` | VARCHAR(10) | Always 'COP' for Colombian DSD |

### `dispatch_route_stops` (each remisión in the planilla)

| Column | Type | Notes |
|---|---|---|
| `route_id` | FK → `dispatch_routes` | CASCADE on parent delete |
| `dispatch_note_id` | FK → `dispatch_notes` UNIQUE **partial** | `UNIQUE WHERE status != 'released'` — allows reassignment after release |
| `stop_sequence` | INT | 1..N order of stops |
| `status` | enum | `pending` → `in_progress` → (`delivered` \| `partial` \| `rejected`) or `released` |
| `result` | enum | Final state, set when settled: `delivered`, `partial`, `rejected`, `released` |
| `is_extra_route` | BOOLEAN | Stop added outside the planned route (e.g. cliente adicional en ruta) |
| `is_prepaid` | BOOLEAN | **Derived** from `dispatch_note.invoice.payment_date IS NOT NULL`. Excluded from `total_to_collect` and cash variance |
| `collected_amount` | DECIMAL(14,2) | Cash collected in this stop (default 0) |
| `anticipo_amount` | DECIMAL(14,2) | Reserved for advance payments — currently 0 (no partial payments) |
| `change_amount` | DECIMAL(14,2) | Cash given back to customer (recorded as `refund` with `source_type='dispatch_route_change'`) |
| `withholding_amount` | DECIMAL(14,2) | Total fiscal withholding suffered (retefuente + reteiva + reteica) |
| `withholding_breakdown` | JSONB nullable | `{retefuente?: number, reteiva?: number, reteica?: number}` — sum must equal `withholding_amount` |
| `credit_amount` | DECIMAL(14,2) | Server-computed: `grand_total - collected - withholding` for `result='partial'` |
| `payment_method` | VARCHAR(40) | `cash` (default), `transfer`, `card` |
| `settled_at` / `released_at` | TIMESTAMP nullable | State-change timestamps |

### `dispatch_route_stop_history` (audit log)

Append-only audit of every stop transition. `action` can be:
`start` (pending → in_progress), `settle` (any → result), `release` (any → released).
Stores `from_status`, `to_status`, `reason` (for release), `released_by`, and a
`metadata` JSONB with the amounts at the time of transition.

### `vehicles`

Store-scoped, reusable. UNIQUE `(store_id, plate)`. Cannot be hard-deleted if
referenced by a non-voided route — must be `is_active=false` instead.

## State Machine

### Route state (`dispatch_routes.status`)

```
            ┌──────────┐
            │  draft   │
            └────┬─────┘
       dispatch  │      void (only in draft/dispatched/in_transit/settling)
                 ▼
       ┌────────────────┐         ┌──────────┐
       │  dispatched    │ ──────► │  in_transit │  (auto on first stop start)
       └────────┬───────┘         └──────┬───┘
                │ start settling (manual) │
                ▼                         ▼
            ┌──────────┐
            │ settling │
            └────┬─────┘
                 │ close (with declared_cash)
                 ▼
            ┌──────────┐
            │  closed  │  (immutable, only via manual adjustment)
            └──────────┘
```

### Stop state (`dispatch_route_stops.status`)

```
pending → in_progress → delivered   (full payment, no withholding or credit)
                       → partial    (credit and/or withholding applied)
                       → rejected   (customer refused delivery)
            any → released          (remisión freed for reassignment)
```

Transitions are **forward-only** except `released` which can be reached from any
non-terminal state and is the only "release valve" to free a dispatch_note.

## Cash Settlement (`cash-settlement.service.ts`)

When `settleStop` is called, it dispatches (in this exact order):

1. **`emitPaymentReceived`** — only if `collected_amount + anticipo_amount > 0`
   and not `is_prepaid`:
   - If `payment_method='cash'`, looks up the open `cash_register_sessions`
     for the current user/store (uses `opened_by`, not `user_id`!) and inserts
     a `cash_register_movements` row with `type='sale'`.
   - Emits `payment.received` event with `source_type='dispatch_route'`,
     `source_id=route_id`, `stop_id`, `order_id=sales_order_id` (may be null),
     `withholding_breakdown` array for accounting listener.
2. **`emitCreditSale`** — only if `result='partial'` and `credit_amount > 0`:
   - Inserts `accounts_receivable` row with `source_type='dispatch_route'`,
     `source_id=sales_order_id || dispatch_note_id`, `original_amount`,
     `paid_amount=0`, `balance=original_amount`, `issue_date=now`,
     `due_date=now+30 days`, `status='open'`.
   - Emits `credit_sale.created` event.
3. **`emitRefundCompleted`** — only if `change_amount > 0`:
   - If `sales_order_id` exists, inserts a `refunds` row with
     `state='completed'`, `refund_method='cash_on_route'`.
   - Always emits `refund.completed` event with
     `source_type='dispatch_route_change'`, `source_id=stop_id`.

When the route is **closed** (`:id/close`), it computes totals and updates
`total_collected`, `total_credit`, `total_withholdings`, `cash_variance` (=
`declared_cash - cash_collected`), and emits `dispatch_route.closed` for
downstream listeners.

## Capture Progressive Mobile

The mobile-first UI allows the conductor/admin to mark stops in real time:

1. **Pre-dispatch** (`draft`): edit stops, add/remove, change driver/vehicle.
2. **Pre-dispatch transition** (`dispatch`): locks stop list, sets
   `dispatch_started_at` and `dispatched_by_user_id`.
3. **In route** (`in_transit`/`settling`): per stop, the conductor can:
   - **Start** (`POST /stops/:stopId/start`): pending → in_progress.
   - **Settle** (`POST /stops/:stopId/settle`): capture amounts + result.
   - **Release** (`POST /stops/:stopId/release`): pending/in_progress → released
     (with `reason`); the remisión is freed for reassignment to another route.
4. **Close** (`POST /:id/close`): aggregate totals, set `declared_cash`,
   compute `cash_variance`, mark `closed` (immutable).

The frontend's `planilla-detail-page.component.ts` exposes per-stop cards with
big tap targets (`Liquidar` and `Liberar` buttons), and a `PlanillaCloseModal`
that shows live variance computation as the conductor types `declared_cash`.

## Permissions

The permission key is `store:dispatch_routes` with actions:

| Action | Used by |
|---|---|
| `create` | `POST /store/dispatch-routes` |
| `read` | `GET /store/dispatch-routes` (list + stats) |
| `read:one` | `GET /store/dispatch-routes/:id` |
| `update` | `PATCH /store/dispatch-routes/:id` |
| `delete` | `DELETE /store/dispatch-routes/:id` |
| `dispatch` | `POST /:id/dispatch` |
| `settle` | `POST /:id/stops/:stopId/{start,settle}` |
| `release_stop` | `POST /:id/stops/:stopId/release` |
| `close` | `POST /:id/close` |
| `void` | `POST /:id/void` |
| `print` | `POST /:id/pdf` |

The `admin` and `owner` roles get all `store:*` permissions via the
permissions-roles seed filter, so no explicit assignment is required. Add
explicit assignments only if a more restricted role (e.g. `dispatcher`) needs
access.

## Mobile-First UI

`apps/frontend/src/app/private/modules/store/planillas-rutas/`:

- **List view** (`planillas-list.component.ts`): cards on `<md` breakpoints,
  table on `>=md`. Each card shows route number, status, driver, vehicle,
  stop count, and total to collect.
- **Detail view** (`planilla-detail-page.component.ts`): stop cards with
  left-border color (green if delivered/partial, red if released/rejected).
  Action buttons (`Liquidar`, `Liberar`) are large tap targets.
- **Wizard** (`planilla-wizard.component.ts`): bottom-sheet style modal on
  mobile (`rounded-t-2xl md:rounded-2xl`), centered modal on desktop.
- **Modals** (settle, release, close): all use the same bottom-sheet pattern
  for mobile consistency. Close modal shows live variance calc.
- **PDF viewer** (`planilla-pdf-viewer.component.ts`): iframe with
  `URL.createObjectURL` from a Blob. Includes a download link.

The sidebar item "Planillas de Ruta" maps to `orders_dispatch_routes` in
`menu-filter.service.ts` so `panel_ui` can hide/show it per store.

## Common Pitfalls

1. **`cash_register_sessions` has `opened_by`, not `user_id`.** The field
   that identifies the user on the open session is `opened_by`. Using
   `user_id` in a Prisma `where` will throw `Unknown argument`.
2. **`sales_orders` does NOT have `payment_status`.** Use the join through
   `dispatch_notes.invoice.payment_date IS NOT NULL` to determine
   `is_prepaid` for a stop.
3. **`refunds` requires `order_id` NOT NULL and `state` enum value.** If
   `sales_order_id` is null, skip the `refunds` insert and just emit the
   `refund.completed` event. Don't crash the whole settle.
4. **UNIQUE on `dispatch_note_id` must be PARTIAL** (`WHERE status != 'released'`)
   to allow reassignment after `release-stop`. A plain `UNIQUE` would block
   the entire reassignment flow.
5. **Don't add parallel accounting logic.** Emit events; let existing
   listeners create entries. The `payment.received` listener creates the
   accounting_entries row (note: requires `payment_id` to be set; for
   dispatch routes this is `null` by design — see "Known Gap" below).
6. **Auto-entries require a real `payments` row.** The `payment.received`
   listener in `accounting-events.listener.ts` filters by `payment_id` for
   journal entry creation. When dispatch routes emit with `payment_id: null`,
   the cash side creates the `cash_register_movements` row directly (good),
   but the journal entry is skipped. If full accounting is required, insert
   a `payments` row in `emitPaymentReceived` before emitting the event.

## Why Accounting Entries Are Not Generated Automatically

The `accounting-events.listener` is gated by the organization's **fiscal
status** (subflow: `payments`, `credit_sales`). The listener calls
`isFlowEnabled(store_id, 'payments')` which checks
`fiscal_gate.isSubflowEnabled(org_id, store_id, 'payments')`. If the
organization's `organization_settings.fiscal_status.accounting.state` is
`INACTIVE` (or its subflow `payments` is disabled), the event is **silently
dropped** — by design, for opt-in fiscal activation.

This is **correct behavior**, not a bug. When the organization activates its
fiscal status (sets `accounting.state = ACTIVE` and enables the `payments`
subflow), the existing `payment.received` listener will pick up the events
emitted by dispatch routes and create auto-entries.

For convenience, `dispatch_routes` event payloads include enough context for
the listener to work:

- `payment_id`: `null` (use `source_id=route_id` as a back-reference)
- `order_id`: `sales_order_id` if the dispatch_note has one, else `null`
- `withholding_breakdown`: array of `{code, amount}` for fiscal line items
- `amount`, `subtotal_amount`, `tax_amount`, `discount_amount`: full context
- `source_type: 'dispatch_route'`: distinguishable from POS payments

If an organization requires strict double-entry on every planilla stop and
the fiscal flow is active, the existing auto-entry machinery handles it
without any code change.

## Verifying Changes

After any schema or service edit, run:

```bash
# Backend type check
cd apps/backend && npx tsc -p tsconfig.build.json --noEmit

# Apply migration
cd apps/backend && npx prisma db execute --file prisma/migrations/<ts>_*/migration.sql

# Seed (idempotent)
cd apps/backend && npm run db:seed

# Frontend build
cd apps/frontend && npx ng build --configuration=production

# Restart backend
docker restart vendix_backend

# E2E smoke
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@techsolutions.co","password":"1125634q","organization_slug":"tech-solutions"}' \
  | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);console.log(j.data.access_token)")

# Stats
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/store/dispatch-routes/stats
```

## Related Files

### Backend
- `apps/backend/prisma/schema.prisma` — new models (vehicles, dispatch_routes,
  dispatch_route_stops, dispatch_route_stop_history) and enums
- `apps/backend/prisma/migrations/<ts>_dispatch_routes/migration.sql` — idempotent migration
- `apps/backend/src/domains/store/dispatch-routes/` — module, controllers, services
- `apps/backend/src/domains/store/dispatch-routes/route-flow/route-flow.service.ts` — state machine + close logic
- `apps/backend/src/domains/store/dispatch-routes/route-flow/cash-settlement.service.ts` — event emission
- `apps/backend/src/domains/store/dispatch-routes/route-flow/pdf-export.service.ts` — PDFKit builder
- `apps/backend/src/domains/store/store.module.ts` — registers `DispatchRoutesModule`
- `apps/backend/src/prisma/services/store-prisma.service.ts` — store-scoped getters for new models
- `apps/backend/prisma/seeds/permissions-roles.seed.ts` — `store:dispatch_routes:*` permissions

### Frontend
- `apps/frontend/src/app/private/modules/store/planillas-rutas/` — full module
- `apps/frontend/src/app/routes/private/store_admin.routes.ts` — `/admin/orders/planillas` routes
- `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts` — sidebar entry
- `apps/frontend/src/app/core/services/menu-filter.service.ts` — `moduleKeyMap` entry
