# Payment Collector (`app-payment-collector`)

Reusable, capability-driven charge widget (Vendix Phase 3). It renders a payment
method grid plus every detail a method needs (cash + keypad, reference, tip,
wallet balance, Wompi sub-methods, credit installment plan) and emits ONE
normalized `PaymentSubmit`. The parent translates that superset into its domain
DTO (POS, table, membership, AR/AP, …).

- **Headless**: `app-payment-collector` carries no modal chrome.
- **Wrapper**: `app-payment-modal` = `app-modal` + collector body + footer submit.
- **Zoneless + signals**: every concern is an independent signal; Wompi and
  credit slices are delegated to child components via `model()` two-way bindings.
- **No charging backend**: wallet balance and Wompi processing are the parent's
  job (`walletLookup` output, `wompi` slice). The only network the widget does on
  its own is the read-only method catalog (`autoLoad`) and the PSE bank list.

## Usage

### Headless

```html
<app-payment-collector
  [amount]="order.total"
  [context]="'pos'"
  [customer]="customer"
  (submit)="onPay($event)"
  (walletLookup)="loadWallet($event.id)"
  (requestCustomer)="openCustomerPicker()"
/>
```

Drive submit from the parent using the exposed `canSubmit()` and
`triggerSubmit()` (see wrapper for the footer pattern).

### Modal wrapper

```html
<app-payment-modal
  [(open)]="payOpen"
  [amount]="order.total"
  [context]="'order'"
  [isProcessing]="processing()"
  [walletInfo]="wallet()"
  (submit)="onPay($event)"
/>
```

## Configuration (capability flags)

Each flag is an independent `input<boolean>` that, when left unset, falls back to
the `context` default (`DEFAULT_CONFIG_BY_CONTEXT`).

`allowCash` · `allowReference` · `allowTip` · `allowCredit` · `allowWompi` ·
`allowWallet` · `requireCustomer` · `allowAmountOverride` · `showKeypad`

Contexts: `generic` · `pos` · `ecommerce` · `membership` · `table` · `order` ·
`ar` · `ap`.

## Data inputs

`amount` (required) · `remainingBalance` · `paymentMethods` · `autoLoad` ·
`isProcessing` · `installments` · `preSelectedInstallment` · `customer` ·
`manualMethods` · `context` · `currencyDecimals` · `walletInfo`.

## Outputs

`submit(PaymentSubmit)` · `closed` · `methodSelected(PaymentMethod)` ·
`requestCustomer` · `walletLookup({id})`.

## `PaymentSubmit`

Superset DTO. Not every field is set on every charge — the parent reads what its
domain needs:

```ts
interface PaymentSubmit {
  storePaymentMethodId: number | null;   // null for manual methods
  methodType: PaymentMethodType | string;
  amount: number;                        // effectiveBase (override ?? remaining ?? amount)
  amountReceived?: number; change?: number;
  reference?: string; tip?: number;
  mode: 'contado' | 'credito'; installmentId?: number;
  credit?: CreditTerms;                  // credito mode
  wompi?: { subMethod; payload };        // wompi method
  walletId?: number;                     // parent fills after walletLookup
  customerId?: number | string | null;
  notes?: string;
  method: PaymentMethod;
}
```

### Phase-4 DTO mapping

| Consumer | Domain DTO |
| --- | --- |
| POS | `PayOrderDto { store_payment_method_id, payment_type, amount_received?, amount?, installment_id?, payment_reference? }` |
| Table | `TablePaymentSubmit { store_payment_method_id, amount_received?, payment_reference?, tip_amount? }` |
| Membership | `RenewMembershipDto { store_payment_method_id, amount? }` |

## Files

- `payment-collector.model.ts` — `PaymentCollectorConfig`, `PaymentSubmit`, `PaymentContext`, defaults.
- `payment-collector.component.*` — headless collector.
- `payment-modal.component.ts` — modal wrapper.
- `payment-wompi-fields.component.*` — Wompi sub-method slice (`model()`).
- `payment-credit-fields.component.*` — credit installment slice (`model()`).

## Related skills

`vendix-payment-processors` · `vendix-zoneless-signals` · `vendix-frontend-modal`
· `vendix-currency-formatting` · `vendix-angular-forms` · `vendix-frontend-icons`.
