/**
 * Public contract for the reusable `app-payment-collector` (Vendix Phase 3).
 *
 * The collector is a HEADLESS, capability-driven charge widget. It renders a
 * method grid + the details each method needs (cash/keypad, reference, tip,
 * wallet, Wompi sub-methods, credit terms) and emits ONE normalized
 * {@link PaymentSubmit} superset that the parent (Phase 4) translates into the
 * domain DTO of each consumer (POS `PayOrderDto`, table `TablePaymentSubmit`,
 * membership `RenewMembershipDto`, AR/AP, …).
 *
 * It intentionally does NOT talk to any charging backend: wallet balance and
 * Wompi processing are the PARENT's responsibility (see `walletLookup` output
 * and the `wompi` slice of the DTO). The only network the collector may do on
 * its own is loading the store's method catalog (`autoLoad`) and, inside the
 * Wompi sub-component, the PSE bank list — both read-only catalog reads.
 */
import type { PaymentMethod, PaymentMethodType } from '../../models/payment-method.model';
import type { WompiSubMethod } from '../../services/wompi.service';

/**
 * Where the collector is used. Drives the sane per-flag defaults in
 * {@link DEFAULT_CONFIG_BY_CONTEXT}. `ar`/`ap` are reserved for the future
 * accounts-receivable / accounts-payable manual-method flows.
 */
export type PaymentContext =
  | 'generic'
  | 'pos'
  | 'ecommerce'
  | 'membership'
  | 'table'
  | 'order'
  | 'ar'
  | 'ap';

/** Contado (single charge) vs credito (installment plan creation). */
export type PaymentMode = 'contado' | 'credito';

/** Installment-plan terms produced by `app-payment-credit-fields`. */
export interface CreditTerms {
  numInstallments: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  firstInstallmentDate: string;
  interestRate: number;
  interestType: 'simple' | 'compound';
  initialPayment: number;
  initialPaymentMethodId?: number;
}

/** Wompi slice produced by `app-payment-wompi-fields`. `payload` is the raw
 *  provider-specific body (NEQUI phone, PSE fields, …) the backend expects. */
export interface WompiSlice {
  subMethod: WompiSubMethod;
  payload: unknown;
}

/**
 * Capability flags. Every flag is an independent boolean so a consumer can
 * turn a single behaviour on/off without touching the others. Each flag maps
 * to a signal input on the component that, when left `undefined`, falls back to
 * the {@link PaymentContext} default.
 */
export interface PaymentCollectorConfig {
  /** Show the cash method + received/change/keypad affordances. */
  allowCash: boolean;
  /** Show the manual reference input for methods that require it. */
  allowReference: boolean;
  /** Show the optional tip input (added on top of the base). */
  allowTip: boolean;
  /** Expose the "credito" mode (installment-plan creation). */
  allowCredit: boolean;
  /** Expose Wompi methods + the Wompi sub-method fields. */
  allowWompi: boolean;
  /** Expose wallet methods + balance display. */
  allowWallet: boolean;
  /** Whether a selected customer is mandatory before submit. */
  requireCustomer: boolean;
  /** Allow the operator to override the amount to charge. */
  allowAmountOverride: boolean;
  /** Show the on-screen numeric keypad for cash. */
  showKeypad: boolean;
}

/**
 * NORMALIZED submit payload — a SUPERSET that covers every consumer. Not every
 * field is populated on every charge; the parent reads the ones its domain DTO
 * needs and ignores the rest.
 *
 * Translation cheat-sheet (Phase 4):
 *  - POS `PayOrderDto`      → { store_payment_method_id: storePaymentMethodId,
 *                              payment_type: methodType==='wompi'?'online':'direct',
 *                              amount_received: amountReceived, amount, installment_id: installmentId,
 *                              payment_reference: reference }
 *  - table `TablePaymentSubmit` → { store_payment_method_id, amount_received: amountReceived,
 *                              payment_reference: reference, tip_amount: tip }
 *  - membership `RenewMembershipDto` → { store_payment_method_id: storePaymentMethodId, amount }
 */
export interface PaymentSubmit {
  /** Store payment method row id, or `null` when a manual method was chosen. */
  storePaymentMethodId: number | null;
  /** Canonical method type (or the manual method's `value`). */
  methodType: PaymentMethodType | string;
  /** Base amount to charge (`effectiveBase`: override ?? remaining ?? amount). */
  amount: number;
  /** Cash tendered (cash method only). */
  amountReceived?: number;
  /** Change owed back (cash method only). */
  change?: number;
  /** Manual reference (card last-4, transfer ref, …). */
  reference?: string;
  /** Optional tip on top of the base. */
  tip?: number;
  /** contado | credito. */
  mode: PaymentMode;
  /** Id of the pre-existing installment being paid against (if any). */
  installmentId?: number;
  /** New installment-plan terms (credito mode only). */
  credit?: CreditTerms;
  /** Wompi sub-method + raw payload (wompi method only). */
  wompi?: WompiSlice;
  /** Resolved wallet id (parent fills this after `walletLookup`). */
  walletId?: number;
  /** Customer id when known. */
  customerId?: number | string | null;
  /** Free-form note (parent may set). */
  notes?: string;
  /** The full method object that was selected (echoed back for convenience). */
  method: PaymentMethod;
}

/** Lightweight, catalog-free method option (AR/AP and other manual flows). */
export interface ManualPaymentMethod {
  value: string;
  label: string;
  icon?: string;
}

/**
 * Sane per-context defaults. A flag left `undefined` on the component resolves
 * to the value here for the active `context`.
 */
export const DEFAULT_CONFIG_BY_CONTEXT: Record<PaymentContext, PaymentCollectorConfig> = {
  generic: {
    allowCash: true,
    allowReference: true,
    allowTip: false,
    allowCredit: false,
    allowWompi: false,
    allowWallet: false,
    requireCustomer: false,
    allowAmountOverride: true,
    showKeypad: false,
  },
  pos: {
    allowCash: true,
    allowReference: true,
    allowTip: false,
    allowCredit: true,
    allowWompi: true,
    allowWallet: true,
    requireCustomer: false,
    allowAmountOverride: false,
    showKeypad: true,
  },
  ecommerce: {
    allowCash: false,
    allowReference: true,
    allowTip: false,
    allowCredit: false,
    allowWompi: true,
    allowWallet: false,
    requireCustomer: true,
    allowAmountOverride: false,
    showKeypad: false,
  },
  membership: {
    allowCash: true,
    allowReference: true,
    allowTip: false,
    allowCredit: false,
    allowWompi: true,
    allowWallet: false,
    requireCustomer: false,
    allowAmountOverride: true,
    showKeypad: false,
  },
  table: {
    allowCash: true,
    allowReference: true,
    allowTip: true,
    allowCredit: false,
    allowWompi: true,
    allowWallet: true,
    requireCustomer: false,
    allowAmountOverride: false,
    showKeypad: true,
  },
  order: {
    allowCash: true,
    allowReference: true,
    allowTip: false,
    allowCredit: false,
    allowWompi: true,
    allowWallet: true,
    requireCustomer: false,
    allowAmountOverride: false,
    showKeypad: false,
  },
  ar: {
    allowCash: true,
    allowReference: true,
    allowTip: false,
    allowCredit: false,
    allowWompi: false,
    allowWallet: false,
    requireCustomer: false,
    allowAmountOverride: true,
    showKeypad: false,
  },
  ap: {
    allowCash: true,
    allowReference: true,
    allowTip: false,
    allowCredit: false,
    allowWompi: false,
    allowWallet: false,
    requireCustomer: false,
    allowAmountOverride: true,
    showKeypad: false,
  },
};
