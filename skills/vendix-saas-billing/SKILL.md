---
name: vendix-saas-billing
description: >
  SaaS platform billing patterns for Vendix -> store invoicing with partner rev-share split.
  Covers Decimal money math, invoice emission with advisory locks, free-plan guards, split
  breakdown JSON, partner commission accrual, and the monthly payout batch pipeline.
  Trigger: When creating SaaS invoices, working with partner rev-share, margin/surcharge
  pricing, invoice sequence allocation, or partner payout batches.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating SaaS subscription invoices or rev-share splits"
    - "Working with SubscriptionBillingService or SubscriptionPaymentService"
    - "Computing partner margin, fixed surcharge, or effective price"
    - "Allocating invoice numbers with advisory locks"
    - "Accruing partner commissions or running partner payout batches"
    - "Debugging free-plan invoices, pending credits, or proration flows"
---

# Vendix SaaS Billing - Platform -> Store Invoicing with Partner Split

> SaaS billing patterns for the **store_subscriptions** domain: Vendix charges the store, a
> configurable partner margin + fixed surcharge is folded into the effective price, and the
> partner share is accrued monthly into a payout batch.

## When to Use

- Creating or modifying SaaS invoice emission (`SubscriptionBillingService.issueInvoice`)
- Adding or changing partner commission flows (`PartnerCommissionsService`, payout batches)
- Touching money math for plan pricing (base price, margin, surcharge, effective price)
- Running or debugging the monthly partner payout batch (`PartnerPayoutBatchJob`)
- Handling free-plan skips, pending credits, or prorated upgrade invoices
- Working with `subscription_invoices.split_breakdown` JSON column

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/domains/store/subscriptions/services/subscription-billing.service.ts` | Core: `issueInvoice`, `computePricing`, `allocateInvoiceNumber` |
| `apps/backend/src/domains/store/subscriptions/services/subscription-payment.service.ts` | Gateway charge/refund, payment state transitions, commission promotion |
| `apps/backend/src/domains/store/subscriptions/services/partner-commissions.service.ts` | Commission accrual + ledger queries |
| `apps/backend/src/jobs/partner-payout-batch.job.ts` | Monthly cron (day 5) that groups accrued commissions into payout batches |
| `apps/backend/src/domains/store/subscriptions/types/billing.types.ts` | `ComputedPricing`, `InvoiceLineItem`, `InvoiceSplitBreakdown` |

---

## Architecture: Money Flow

```
Base Plan (Vendix)                Partner Override (optional)
  base_price                        margin_pct (clamped <= max_partner_margin_pct)
                                    fixed_surcharge
        \                          /
         v                        v
          computePricing()
                |
                v
     effective_price = base_price + (base_price * margin_pct / 100) + fixed_surcharge
                |
                v
     Store pays effective_price  ->  subscription_invoices.total
                                     split_breakdown = {
                                       vendix_share,    // base_price
                                       partner_share,   // margin_amount
                                       margin_pct_used,
                                       partner_org_id
                                     }
                |
        payment succeeds
                |
                v
     partner_commissions (state=accrued OR pending_payout)
                |
        day 5 of next month
                |
                v
     partner_payout_batches (draft) <- grouped by partner_organization_id
```

---

## Rules

### Rule 1: ALL money math uses `Prisma.Decimal` (HALF_EVEN rounding at 2dp)

Never use JS `Number` for money. Numbers lose precision (0.1 + 0.2 = 0.30000000000000004).
`Prisma.Decimal` wraps decimal.js and supports banker's rounding (HALF_EVEN = 6 in decimal.js).

```typescript
const DECIMAL_ZERO = new Prisma.Decimal(0);
const DECIMAL_100 = new Prisma.Decimal(100);

// Margin amount = base * margin_pct / 100
const marginAmount = basePrice.times(clampedMargin).dividedBy(DECIMAL_100);
const effective = basePrice.plus(marginAmount).plus(fixedSurcharge);

// Rounding ONLY at storage boundary (serializing to DB).
private round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, 6); // 6 = ROUND_HALF_EVEN (banker's)
}
```

### Rule 2: Re-clamp partner margin at emission time (never trust the snapshot)

`store_subscriptions.partner_margin_amount` is a resolver snapshot. The plan's
`max_partner_margin_pct` cap may have been lowered since. Always re-read and clamp.

```typescript
const requestedMargin = new Prisma.Decimal(sub.partner_override.margin_pct);
const capRaw = sub.plan.max_partner_margin_pct
  ?? sub.partner_override.base_plan.max_partner_margin_pct;
const cap = capRaw ? new Prisma.Decimal(capRaw) : null;
const clampedMargin = cap && requestedMargin.greaterThan(cap) ? cap : requestedMargin;

if (cap && requestedMargin.greaterThan(cap)) {
  this.logger.warn(
    `Partner margin ${requestedMargin} > cap ${cap}; clamped at emission`,
  );
}
```

### Rule 3: `effective_price = base + base * margin_pct/100 + fixed_surcharge`

The store sees ONE price. Vendix share and partner share are computed FROM that row so
`vendix_share + partner_share === invoice.total` by construction (fixed_surcharge flows
to partner share or is treated as an extra partner revenue line — confirm which per plan).

### Rule 4: `split_breakdown` JSON contract (stringified decimals)

Always write splits as strings (decimal.js `.toFixed(2)`) to avoid JSON losing precision:

```typescript
const splitBreakdown: InvoiceSplitBreakdown = {
  vendix_share: this.round2(pricing.base_price.times(quantity)).toFixed(2),
  partner_share: this.round2(pricing.margin_amount.times(quantity)).toFixed(2),
  margin_pct_used: pricing.margin_pct.toFixed(2),
  partner_org_id: pricing.partner_org_id,
};
```

When reading back: `new Prisma.Decimal(splitBreakdown.partner_share as string)`.

### Rule 5: Invoice number sequence uses a Postgres advisory xact lock

Concurrent invoice emission would race on the `LIKE prefix + '-%'` lookup. Serialize with a
fixed-namespace advisory lock released on commit.

```typescript
const ADVISORY_LOCK_KEY_INVOICE_NUMBER = 0x5341_4153; // "SAAS" ASCII nibbles

private async allocateInvoiceNumber(tx: any): Promise<string> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY_INVOICE_NUMBER}::int)`,
  );
  // ...find last invoice_number LIKE prefix+'-%', increment, return
}
```

Pair with `SELECT ... FOR UPDATE` on the `store_subscriptions` row at tx start to block
concurrent emissions for the same subscription.

### Rule 6: Free-plan guard — skip invoice, advance period, write `renewed` event

When `effective_price <= 0` AND `margin_amount <= 0`, DO NOT emit an invoice. Advance the
billing window and write a `subscription_events` row with `skipped_reason: 'zero_price'`:

```typescript
if (
  !opts.prorated
  && unitPrice.lessThanOrEqualTo(DECIMAL_ZERO)
  && pricing.margin_amount.lessThanOrEqualTo(DECIMAL_ZERO)
) {
  await tx.store_subscriptions.update({
    where: { id: sub.id },
    data: {
      current_period_start: basePeriodStart,
      current_period_end: basePeriodEnd,
      next_billing_at: basePeriodEnd,
    },
  });
  await tx.subscription_events.create({
    data: {
      store_subscription_id: sub.id,
      type: 'renewed',
      payload: {
        skipped_reason: 'zero_price',
        period_start: basePeriodStart.toISOString(),
        period_end: basePeriodEnd.toISOString(),
      } as Prisma.InputJsonValue,
      triggered_by_job: 'subscription-renewal-billing',
    },
  });
  return null;
}
```

### Rule 7: Commission lifecycle — accrued -> pending_payout -> paid

Three-state machine:

| State | When | Written by |
|-------|------|------------|
| `accrued` | Invoice issued with partner_org + partner_share > 0 | `SubscriptionBillingService.issueInvoice` |
| `pending_payout` | Invoice state flips to `paid`, or monthly batch groups accrued rows | `SubscriptionPaymentService.handleChargeSuccess` / `PartnerPayoutBatchJob` |
| `paid` | Partner payout batch is marked completed and transferred | Payout processor (out of scope here) |

Idempotency: `partner_commissions.invoice_id` is unique — always use `findUnique` before
creating, or handle `P2002` gracefully.

### Rule 8: Monthly payout batch runs day 5, period = previous calendar month UTC

```typescript
@Cron('0 4 5 * *') // 04:00 UTC, day 5
async handlePartnerPayoutBatch() {
  const now = new Date();
  const periodStart = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const periodEnd = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

  const partners = await this.prisma.partner_commissions.findMany({
    where: { state: 'accrued', accrued_at: { gte: periodStart, lt: periodEnd } },
    select: { partner_organization_id: true },
    distinct: ['partner_organization_id'],
  });
  // ...one batch per partner, transitions rows to pending_payout
}
```

Always guard with an `isRunning` flag — cron can fire twice if the previous run is still
processing.

### Rule 9: Emit gateway charges OUTSIDE the Prisma transaction, update state INSIDE

`SubscriptionPaymentService.charge()` follows:

1. Create `subscription_payments` row with `state='pending'`
2. Call `gateway.processPayment()` — network I/O, no tx
3. On success: `$transaction` flips payment->succeeded, invoice->paid, commission accrued->pending_payout
4. On failure: update payment->failed and emit `subscription.payment.failed` event

Never call the gateway inside a Prisma `$transaction` — long-running external I/O locks DB rows.

### Rule 10: Pending credit consumption is one-shot and capped at subtotal

Downgrade credits are stored in `store_subscriptions.metadata.pending_credit`. On the next
non-prorated invoice:

```typescript
const pendingCredit = this.extractPendingCredit(sub.metadata);
let subtotal = unitPrice.times(quantity);
let creditApplied = DECIMAL_ZERO;
if (pendingCredit.greaterThan(DECIMAL_ZERO) && !opts.prorated) {
  creditApplied = Prisma.Decimal.min(pendingCredit, subtotal); // cap >= 0
  subtotal = subtotal.minus(creditApplied);
}
// ...after creating invoice, delete pending_credit from metadata
```

---

## Code Example: End-to-End Invoice Emission

```typescript
// From SubscriptionBillingService.issueInvoice (abbreviated)
return this.prisma.$transaction(async (tx) => {
  // 1. Lock the subscription row
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM store_subscriptions WHERE id = ${id} FOR UPDATE`,
  );

  const sub = await tx.store_subscriptions.findUniqueOrThrow({
    where: { id },
    include: { plan: true, partner_override: { include: { base_plan: true } } },
  });

  // 2. Compute live pricing (clamp partner margin vs plan cap)
  const pricing = this.computePricing(sub);

  // 3. Free-plan guard
  if (pricing.effective_price.lessThanOrEqualTo(DECIMAL_ZERO)
      && pricing.margin_amount.lessThanOrEqualTo(DECIMAL_ZERO)) {
    // ...advance period, emit 'renewed' event with skipped_reason, return null
  }

  // 4. Allocate number under advisory lock
  const invoiceNumber = await this.allocateInvoiceNumber(tx);

  // 5. Build split_breakdown (string decimals)
  const splitBreakdown: InvoiceSplitBreakdown = {
    vendix_share: this.round2(pricing.base_price).toFixed(2),
    partner_share: this.round2(pricing.margin_amount).toFixed(2),
    margin_pct_used: pricing.margin_pct.toFixed(2),
    partner_org_id: pricing.partner_org_id,
  };

  // 6. Create invoice + accrue commission (if partner)
  const invoice = await tx.subscription_invoices.create({
    data: { /* ...totals, line_items, split_breakdown as InputJsonValue */ },
  });

  if (pricing.partner_org_id && pricing.margin_amount.greaterThan(DECIMAL_ZERO)) {
    await tx.partner_commissions.create({
      data: {
        partner_organization_id: pricing.partner_org_id,
        invoice_id: invoice.id,
        amount: this.round2(pricing.margin_amount),
        currency: sub.currency,
        state: 'accrued',
        accrued_at: new Date(),
      },
    });
  }

  return invoice;
}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
```

---

## Anti-Patterns

### DON'T: Use `Number` for money math

```typescript
// WRONG — precision loss
const marginAmount = Number(sub.plan.base_price) * sub.margin_pct / 100;

// CORRECT — Prisma.Decimal
const marginAmount = basePrice.times(clampedMargin).dividedBy(DECIMAL_100);
```

### DON'T: Trust the snapshot in `partner_margin_amount`

```typescript
// WRONG — uses stale snapshot
const partnerShare = sub.partner_margin_amount;

// CORRECT — recompute from override + clamp vs plan cap on every emission
const pricing = this.computePricing(sub);
const partnerShare = pricing.margin_amount;
```

### DON'T: Round mid-calculation

```typescript
// WRONG — loses cents
const margin = this.round2(basePrice.times(pct).dividedBy(100));
const total = this.round2(basePrice.plus(margin));

// CORRECT — keep full precision, round at storage boundary only
const margin = basePrice.times(pct).dividedBy(DECIMAL_100);
const total = basePrice.plus(margin);
await tx.subscription_invoices.create({ data: { total: this.round2(total) } });
```

### DON'T: Call the payment gateway inside a `$transaction`

```typescript
// WRONG — locks DB rows during network I/O
await prisma.$transaction(async (tx) => {
  const result = await gateway.processPayment(data); // 5s+ network call
  await tx.subscription_invoices.update({ ... });
});

// CORRECT — gateway call outside, state update in a short follow-up tx
const result = await gateway.processPayment(data);
if (result.success) {
  await prisma.$transaction(async (tx) => { /* update states */ });
}
```

### DON'T: Omit the advisory lock on invoice number allocation

Concurrent emissions will generate duplicate invoice numbers. Always:

```sql
SELECT pg_advisory_xact_lock(0x5341_4153::int)
```

### DON'T: Emit invoices for free plans

`base_price = 0` plans MUST skip invoice emission — advance the period silently and write
a `renewed` event with `skipped_reason: 'zero_price'`. Downstream reporting relies on the
invariant "an invoice means money changed hands".

### DON'T: Use JSON numbers for money in `split_breakdown`

```typescript
// WRONG — JSON.parse may return scientific notation or rounded doubles
split_breakdown: { vendix_share: 1234.56 }

// CORRECT — strings preserve decimal representation
split_breakdown: { vendix_share: "1234.56" }
```

---

## Verification Checklist

Before shipping billing changes:

- [ ] All money arithmetic uses `Prisma.Decimal` (grep for `Number(` near `_price`, `amount`, `margin`, `total`)
- [ ] Partner margin is re-read from plan and clamped at emission (not trusted from snapshot)
- [ ] Rounding is HALF_EVEN (`toDecimalPlaces(2, 6)`) and applied ONLY at DB write
- [ ] `split_breakdown` values are strings (`.toFixed(2)`), not numbers
- [ ] `allocateInvoiceNumber` is called under `pg_advisory_xact_lock(0x5341_4153)`
- [ ] `store_subscriptions` row is `SELECT ... FOR UPDATE` locked at tx start
- [ ] Free-plan guard present: `effective_price <= 0` AND `margin_amount <= 0` -> skip + event
- [ ] Commission idempotency: `partner_commissions.invoice_id` unique check before create
- [ ] Gateway I/O happens OUTSIDE `$transaction`; state updates happen INSIDE a short tx
- [ ] Payout batch has `isRunning` re-entry guard and queries previous calendar month UTC
- [ ] Emitted events (`subscription.payment.failed`, `partner.commission.available`) fire
      AFTER the tx commits

---

## Related Skills

- `vendix-subscription-gate` — feature-by-store gate consuming the same `store_subscriptions`
- `vendix-redis-quota` — Redis INCR+EXPIRE counters for feature quotas
- `vendix-prisma-migrations` — enum additions for `partner_commission_state_enum`, etc.
- `vendix-error-handling` — `SUBSCRIPTION_*` error codes used across billing flows
- `vendix-payment-processors` — gateway `processPayment`/`refundPayment` contract
