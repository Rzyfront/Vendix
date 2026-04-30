---
name: vendix-auto-entries
description: >
  Automatic journal entry system (asientos automaticos) — event-driven accounting with PUC colombiano defaults.
  Trigger: When adding new automatic accounting flows, modifying auto-entry logic, adding mapping keys, or debugging why a transaction does not generate a journal entry.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding new automatic journal entries"
    - "Debugging missing accounting entries"
    - "Adding new mapping keys to accounting"
    - "Modifying auto-entry event handlers"
    - "Working with AccountingEventsListener or AutoEntryService"
---

## When to Use

- Adding a new financial flow that should generate automatic journal entries
- Debugging why a transaction is not creating an accounting entry
- Adding new `mapping_key` entries to `DEFAULT_ACCOUNT_MAPPINGS`
- Modifying how events are emitted from domain services (payments, orders, returns, etc.)
- Understanding the cascade resolution of account codes (store → org → default)
- Configuring account mappings in the frontend

---

## Architecture Overview

The system follows an **event-driven pattern** with 3 layers:

```
┌─────────────────────┐     EventEmitter2      ┌──────────────────────────────┐
│  Domain Services    │ ──── emit(event) ────→  │  AccountingEventsListener    │
│  (payments, orders, │                         │  @OnEvent('event.name')      │
│   returns, payroll) │                         └──────────┬───────────────────┘
└─────────────────────┘                                    │
                                                           │ calls
                                                           ▼
                                              ┌──────────────────────────┐
                                              │  AutoEntryService        │
                                              │  onXxxHandler()          │
                                              │  ┌────────────────────┐  │
                                              │  │ resolveAccountLine │  │
                                              │  └────────┬───────────┘  │
                                              │           │              │
                                              │           ▼              │
                                              │  ┌────────────────────┐  │
                                              │  │ AccountMappingServ │  │
                                              │  │ store→org→default  │  │
                                              │  └────────────────────┘  │
                                              │           │              │
                                              │           ▼              │
                                              │  ┌────────────────────┐  │
                                              │  │ createAutoEntry()  │  │
                                              │  │ validate + persist │  │
                                              │  └────────────────────┘  │
                                              └──────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts` | Core service: handler methods + `createAutoEntry()` |
| `apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts` | Event listeners: `@OnEvent()` decorators that delegate to AutoEntryService |
| `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts` | Mapping resolution: `DEFAULT_ACCOUNT_MAPPINGS` + cascade logic |
| `apps/backend/prisma/seeds/default-account-mappings.seed.ts` | Seed: syncs `DEFAULT_ACCOUNT_MAPPINGS` to DB for all organizations |
| `apps/frontend/.../accounting/components/account-mappings/account-mappings.component.ts` | Frontend: `MAPPING_LABELS` + `GROUP_DEFINITIONS` for UI |

---

## Account Mapping System

### Cascade Resolution (Priority Order)

```
1. Store override    → accounting_account_mappings WHERE store_id = X
2. Org base          → accounting_account_mappings WHERE store_id = NULL
3. Default (PUC)     → DEFAULT_ACCOUNT_MAPPINGS in code (hardcoded PUC codes)
```

The `AccountMappingService.getMapping(org_id, mapping_key, store_id?)` method resolves in this order. This allows:
- **Default**: Every org gets PUC-standard accounts out of the box
- **Org override**: An organization can change e.g. "revenue" from 4135 to 4140
- **Store override**: A specific store can use a different account than the org default

### Mapping Key Convention

```
{event_name}.{account_role}
```

Examples:
- `payment.received.cash` → The cash/bank account for payment received events
- `invoice.validated.vat_payable` → The VAT payable account for invoice validation
- `credit_sale.created.accounts_receivable` → AR account for credit sales

---

## Current Flows (32 mapping keys)

### 1. Facturacion (invoice.validated)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `invoice.validated.accounts_receivable` | 1305 | DR total | Cuentas por Cobrar |
| `invoice.validated.revenue` | 4135 | CR subtotal | Ingresos |
| `invoice.validated.vat_payable` | 2408 | CR tax (if > 0) | IVA por Pagar |

**Emitted by**: `invoicing.service.ts` when invoice status changes to validated.

### 2. Pagos Recibidos (payment.received)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `payment.received.cash` | 1105 | DR | Caja (efectivo) |
| `payment.received.bank` | 1110 | DR | Banco (transferencia/tarjeta) |
| `payment.received.accounts_receivable` | 1305 | CR | CxC (cuando hay factura) |
| `payment.received.revenue` | 4135 | CR subtotal | Ingresos (venta directa sin factura) |
| `payment.received.vat_payable` | 2408 | CR tax | IVA (venta directa sin factura) |

**Behavior**:
- **Con factura**: DR Caja/Banco, CR CxC (la factura ya reconocio el ingreso)
- **Sin factura (POS)**: DR Caja/Banco, CR Ingresos + IVA
- **Metodo de pago**: `resolveCashBankKey()` usa `payment_method` para elegir 1105 o 1110

**Emitted by**: `payments.service.ts` → `processPosPayment()` step 5.

### 3. Ventas a Credito (credit_sale.created)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `credit_sale.created.accounts_receivable` | 1305 | DR total | CxC |
| `credit_sale.created.revenue` | 4135 | CR subtotal | Ingresos |
| `credit_sale.created.vat_payable` | 2408 | CR tax (if > 0) | IVA |

**Emitted by**: `payments.service.ts` → `processPosPayment()` step 5c, when `requires_payment = false`.

### 4. Gastos (expense.approved + expense.paid)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `expense.approved.expense` | 5195 | DR | Gastos Diversos |
| `expense.approved.accounts_payable` | 2205 | CR | CxP |
| `expense.paid.accounts_payable` | 2205 | DR | CxP |
| `expense.paid.cash` | 1105 | CR | Caja/Banco |

### 5. Nomina (payroll.approved + payroll.paid)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `payroll.approved.payroll_expense` | 5105 | DR earnings | Gastos de Personal |
| `payroll.approved.social_security` | 5110 | DR employer costs | Seguridad Social |
| `payroll.approved.salaries_payable` | 2505 | CR net pay | Salarios por Pagar |
| `payroll.approved.health_payable` | 2370 | CR health | EPS |
| `payroll.approved.pension_payable` | 2380 | CR pension | Pension |
| `payroll.approved.withholdings` | 2365 | CR remaining | Retenciones |
| `payroll.paid.salaries_payable` | 2505 | DR | Salarios por Pagar |
| `payroll.paid.bank` | 1110 | CR | Banco |

**Note**: `payroll.approved` auto-balances: if `earnings + employer_costs > net_pay + health + pension`, the difference goes to `withholdings`.

### 6. Costo de Ventas / COGS (order.completed)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `order.completed.cogs` | 6135 | DR | Costo de Ventas |
| `order.completed.inventory` | 1435 | CR | Inventario |

**Emitted by**: `payments.service.ts` → `processPosPayment()` step 5b, for `direct_delivery` POS sales. Calculates `total_cost` as `sum(cost_price * quantity)` from order items.

### 7. Devoluciones (refund.completed)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `refund.completed.revenue` | 4135 | DR | Ingresos (reversa) |
| `refund.completed.vat_payable` | 2408 | DR (if tax > 0) | IVA (reversa) |
| `refund.completed.cash` | 1105 | CR | Reembolso |

**Behavior by return_type**:
- `refund` → Full accounting reversal (revenue + IVA + cash)
- `replacement` → **No accounting entry** (only inventory movement)
- `credit` → Same as refund (future Phase 2: use credit account instead of cash)

**Tax calculation**: Proportional from original order: `(refund_amount / grand_total) * tax_amount`.

**Emitted by**: `return-orders.service.ts` → `process()` method after transaction.

### 10. SaaS Subscriptions (saas_subscription_expense / saas_revenue)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `saas_revenue.vendix_share` | 4135 | CR | Ingreso plataforma Vendix |
| `saas_revenue.partner_share` | 2335 | CR | CxP Partner (comision) |
| `saas_revenue.bank` | 1110 | DR | Caja/Banco Wompi |
| `saas_revenue.accounts_receivable` | 1305 | DR | CxC Clientes SaaS |
| `saas_subscription_expense.expense` | 5135 | DR | Gasto administrativo SaaS |
| `saas_subscription_expense.bank` | 1110 | CR | Caja/Banco |
| `saas_subscription_expense.accounts_payable` | 2335 | CR | CxP Plataforma |

**Doble asiento** (RNC-31):
- **Vendix-platform** (libros internos): Al emitir factura → DR `1305` CxC / CR `4135` revenue / CR `2335` partner. Al confirmar pago → DR `1110` banco / CR `1305` CxC.
- **Store-cliente** (libros del cliente): DR `5135` gasto SaaS / CR `1110` caja o `2335` CxP.

**Trigger**: `subscription.payment.succeeded` event (post-payment success only, no IVA).

**Emitted by**: `SubscriptionAccountingListener` in subscriptions module.

### 8. Compras Recibidas (purchase_order.received)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `purchase_order.received.inventory` | 1435 | DR | Inventario |
| `purchase_order.received.accounts_payable` | 2205 | CR | Proveedores |

### 9. Ajustes de Inventario (inventory.adjusted)
| Mapping Key | Default PUC | DR/CR | Description |
|-------------|-------------|-------|-------------|
| `inventory.adjusted.inventory` | 1435 | DR or CR | Inventario |
| `inventory.adjusted.shrinkage` | 5295 | CR or DR | Faltantes |

**Direction**: `quantity_change < 0` → DR Shrinkage / CR Inventory. `quantity_change > 0` → DR Inventory / CR Shrinkage.

---

## How to Add a New Automatic Flow

Follow these 5 steps in order:

### Step 1: Add Mapping Keys to `DEFAULT_ACCOUNT_MAPPINGS`

In `account-mapping.service.ts`, add entries following the convention `{event_name}.{account_role}`:

```typescript
// In DEFAULT_ACCOUNT_MAPPINGS
'my_event.account_role_1': { code: 'XXXX', description: 'Description' },
'my_event.account_role_2': { code: 'YYYY', description: 'Description' },
```

**ALSO** add the same keys to `default-account-mappings.seed.ts` → `MAPPING_DEFAULTS`:

```typescript
'my_event.account_role_1': 'XXXX',
'my_event.account_role_2': 'YYYY',
```

### Step 2: Add Handler Method to `AutoEntryService`

Create a new `onMyEvent()` method in `auto-entry.service.ts`:

```typescript
async onMyEvent(data: {
  source_id: number;
  organization_id: number;
  store_id?: number;
  amount: number;
  // ... other fields needed for the entry
  user_id?: number;
}) {
  const lines: AutoEntryLine[] = [
    await this.resolveAccountLine(
      data.organization_id, 'my_event.account_role_1',
      'Description', data.amount, 0, data.store_id,  // DR
    ),
    await this.resolveAccountLine(
      data.organization_id, 'my_event.account_role_2',
      'Description', 0, data.amount, data.store_id,  // CR
    ),
  ];

  return this.createAutoEntry({
    source_type: 'my_event',
    source_id: data.source_id,
    organization_id: data.organization_id,
    store_id: data.store_id,
    entry_date: new Date(),
    description: `My event #${data.source_id}`,
    lines,
    user_id: data.user_id,
  });
}
```

**Critical**: Lines MUST balance — `sum(debit) === sum(credit)`. The system validates this and throws if unbalanced.

### Step 3: Add Entry Type Mapping

In `auto-entry.service.ts` → `createAutoEntry()`, add your event to `entry_type_map`:

```typescript
const entry_type_map: Record<string, string> = {
  // ... existing entries
  'my_event': 'auto_xxx',  // Must be a valid accounting_entry_type_enum value
};
```

**Valid enum values**: `manual`, `auto_invoice`, `auto_payment`, `auto_expense`, `auto_payroll`, `auto_inventory`, `auto_purchase`, `auto_return`, `adjustment`.

If you need a new enum value, create a Prisma migration with `ALTER TYPE accounting_entry_type_enum ADD VALUE 'auto_xxx'`. See `vendix-prisma-migrations` skill.

### Step 4: Add Event Listener

In `accounting-events.listener.ts`, add a new `@OnEvent()` handler:

```typescript
@OnEvent('my_event')
async handleMyEvent(event: {
  source_id: number;
  organization_id: number;
  store_id?: number;
  amount: number;
  user_id?: number;
}) {
  try {
    await this.auto_entry_service.onMyEvent({
      source_id: event.source_id,
      organization_id: event.organization_id,
      store_id: event.store_id,
      amount: Number(event.amount),
      user_id: event.user_id,
    });
    this.logger.log(`Auto-entry created for my_event #${event.source_id}`);
  } catch (error) {
    this.logger.error(
      `Failed to create auto-entry for my_event #${event.source_id}: ${error.message}`,
      error.stack,
    );
  }
}
```

**Important**: Always wrap in try/catch. Accounting failures must NOT break the business transaction. Always cast `Number()` on amount fields (they may arrive as Prisma Decimal strings).

### Step 5: Emit the Event from the Domain Service

In the relevant domain service, emit the event **after** the main transaction succeeds:

```typescript
// AFTER the transaction completes successfully
this.eventEmitter.emit('my_event', {
  source_id: result.id,
  organization_id: result.organization_id,
  store_id: result.store_id,
  amount: Number(result.amount),
  user_id: RequestContextService.getUserId(),
});
```

**Rules for emission**:
- Emit **after** the transaction commits, not inside `$transaction()`
- Include `organization_id` (required for mapping resolution and fiscal period lookup)
- Include `store_id` when available (for store-level mapping overrides)
- Always convert Decimal fields to `Number()` before emitting

### Step 6: Update Frontend Labels

In `account-mappings.component.ts`:

1. Add labels to `MAPPING_LABELS`:
```typescript
'my_event.account_role_1': 'Descripcion en Espanol',
'my_event.account_role_2': 'Descripcion en Espanol',
```

2. Add group to `GROUP_DEFINITIONS` (or add prefix to existing group):
```typescript
{ key: 'my_group', label: 'Mi Grupo', icon: 'icon-name', prefixes: ['my_event.'] },
```

### Step 7: Run Seed

After adding new mapping keys, run the seed to sync defaults to all organizations:

```bash
docker exec vendix_backend npx prisma db seed
```

---

## Prerequisites for Auto-Entries to Work

1. **Open Fiscal Period**: There must be an open `fiscal_periods` record covering the entry date. If not found, the auto-entry will throw (caught by listener's try/catch).

2. **Chart of Accounts**: The PUC account codes referenced by mapping keys must exist in `chart_of_accounts` for the organization. Seeded by `default-puc.seed.ts`.

3. **Account Mappings**: Seeded by `default-account-mappings.seed.ts`. Resolves mapping keys to account codes.

4. **EventEmitter2**: The `AccountingEventsListener` must be registered in `AccountingModule`. It is imported via `AutoEntryService` and `AccountingEventsListener` providers.

---

## Common Debugging

### "No open fiscal period found"
The organization has no `fiscal_periods` record with `status = 'open'` covering the current date. Create one via the accounting UI or seed.

### "Account code 'XXXX' not found in chart of accounts"
The PUC code doesn't exist for this organization. Run `npx prisma db seed` to ensure default PUC is seeded, or check if the org uses a custom chart of accounts.

### Event emitted but no entry created
1. Check `docker logs vendix_backend` for `Failed to create auto-entry` errors
2. Verify the event name matches exactly between `emit()` and `@OnEvent()`
3. Verify `organization_id` is being passed (it's required)
4. Verify `AccountingEventsListener` is registered in the module

### Entry created with wrong account
Check mapping cascade: the organization or store may have a custom override in `accounting_account_mappings` table. Use the frontend Account Mappings UI to verify.

---

## Entry Number Format

All auto-entries use the format: `AE-{YEAR}-{SEQUENCE}` (e.g., `AE-2026-000001`).

Sequence is per-organization, auto-incrementing within the year.

---

## Validation Rules

1. **Balance**: `sum(debit_amount) === sum(credit_amount)` — tolerance of 0.001
2. **Account existence**: All account codes must exist in `chart_of_accounts` for the organization
3. **Fiscal period**: Must have an open fiscal period covering the entry date
4. **Auto-post**: All auto-entries are created with `status: 'posted'` immediately
