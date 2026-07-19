/**
 * Canonical, cross-app payment-method model (Vendix Phase 2 normalization).
 *
 * This is a STRUCTURAL SUPERSET of the three `PaymentMethod` shapes that have
 * historically coexisted in the frontend so that every current consumer keeps
 * compiling unchanged while new code can target a single canonical contract:
 *
 *   - POS      → private/modules/store/pos/models/payment.model.ts
 *   - Settings → private/modules/store/settings/payments/interfaces/payment-methods.interface.ts (StorePaymentMethod)
 *   - Ecommerce→ private/modules/ecommerce/services/checkout.service.ts (PaymentMethod)
 *
 * Design notes:
 *  - This file lives under `shared/` and intentionally does NOT import from any
 *    feature module (`private/`), to respect the shared → feature layering.
 *    The adapter inputs are declared as local structural `*Like` interfaces;
 *    thanks to TypeScript structural typing the real feature interfaces
 *    (`StorePaymentMethod`, ecommerce `PaymentMethod`) are assignable to them.
 */

/**
 * Canonical backend enum `payment_methods_type_enum` (8 values).
 * Mirrors the Prisma enum exactly.
 */
export enum PaymentMethodType {
  CASH = 'cash',
  CARD = 'card',
  PAYPAL = 'paypal',
  BANK_TRANSFER = 'bank_transfer',
  VOUCHER = 'voucher',
  WOMPI = 'wompi',
  WALLET = 'wallet',
  CASH_ON_DELIVERY = 'cash_on_delivery',
}

/**
 * Canonical payment method used across POS, ecommerce checkout and settings.
 *
 * `type` keeps `| string` so legacy/loose values (e.g. an unrecognized backend
 * type) still compile; prefer {@link PaymentMethodType} in new code.
 */
export interface PaymentMethod {
  /** Normalized to a string even when the source id is numeric. */
  id: string;
  type: PaymentMethodType | string;
  name: string;
  /** Canonical alias of the settings/store `display_name`. */
  displayName?: string;
  icon: string;
  enabled: boolean;
  requiresReference?: boolean;
  referenceLabel?: string;
  /** Canonical camelCase alias for the DIAN payment code. */
  dianCode?: string;
  provider?: string;
  processingMode?: 'DIRECT' | 'ONLINE' | 'ON_DELIVERY';
  minAmount?: number | null;
  maxAmount?: number | null;
  paymentInstructions?: Record<string, string | undefined>;
  /**
   * The untouched source payload. Typed as `unknown` so callers make an
   * explicit, intentional narrowing when they need provider-specific fields
   * (e.g. the Wompi sub-method type nested under `system_payment_method`).
   */
  original?: unknown;
}

// ---------------------------------------------------------------------------
// Pure helpers (moved from PosPaymentService so any consumer can reuse them)
// ---------------------------------------------------------------------------

/** Resolve the icon name for a payment `type`. */
export function resolvePaymentIcon(type: string): string {
  const iconMap: Record<string, string> = {
    cash: 'cash',
    card: 'credit-card',
    paypal: 'paypal',
    bank_transfer: 'bank',
    digital_wallet: 'smartphone',
    wompi: 'smartphone',
    voucher: 'wallet',
    wallet: 'wallet',
    cash_on_delivery: 'cash',
  };
  return iconMap[type] || 'credit-card';
}

/** Resolve the reference-input label for a payment `type`. */
export function resolveReferenceLabel(type: string): string {
  const labelMap: Record<string, string> = {
    card: 'Últimos 4 dígitos',
    paypal: 'Email de PayPal',
    bank_transfer: 'Número de referencia',
    digital_wallet: 'Referencia de pago',
    wompi: 'Teléfono Nequi o referencia',
    wallet: 'Saldo disponible',
  };
  return labelMap[type] || 'Referencia';
}

/** Whether a payment `type` requires a manual reference from the operator. */
export function requiresReferenceFor(type: string): boolean {
  return type !== 'cash' && type !== 'voucher' && type !== 'wallet';
}

/**
 * Normalize legacy/loose type strings to their canonical enum value.
 * Fixes the historical inconsistency where the POS fallback used `transfer` /
 * `digital_wallet` while the backend emits `bank_transfer` / `wallet`.
 */
export function normalizePaymentType(type: string | undefined | null): PaymentMethodType | string {
  switch (type) {
    case 'transfer':
      return PaymentMethodType.BANK_TRANSFER;
    case 'digital_wallet':
      return PaymentMethodType.WALLET;
    default:
      return type || 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Adapters — map each legacy shape into the canonical PaymentMethod
// ---------------------------------------------------------------------------

/** Structural mirror of the settings `StorePaymentMethod` interface. */
export interface StorePaymentMethodLike {
  id: string | number;
  display_name?: string;
  state?: string;
  min_amount?: number | null;
  max_amount?: number | null;
  system_payment_method?: {
    type?: string;
    name?: string;
    provider?: string;
    dian_code?: string;
  };
}

/** Structural mirror of the ecommerce checkout `PaymentMethod` interface. */
export interface CheckoutPaymentMethodLike {
  id: string | number;
  name?: string;
  type?: string;
  provider?: string;
  processing_mode?: 'DIRECT' | 'ONLINE' | 'ON_DELIVERY';
  logo_url?: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
  payment_instructions?: {
    bank_name?: string;
    account_holder?: string;
    account_number?: string;
    account_type?: string;
    instructions?: string;
    voucher_instructions?: string;
    redemption_phone?: string;
    notes?: string;
  };
}

/**
 * Adapt a settings/store payment method (`store_payment_methods` row) into the
 * canonical shape.
 */
export function fromStorePaymentMethod(m: StorePaymentMethodLike): PaymentMethod {
  const type = normalizePaymentType(m?.system_payment_method?.type);
  return {
    id: String(m?.id ?? ''),
    type,
    name: m?.display_name || m?.system_payment_method?.name || '',
    displayName: m?.display_name ?? undefined,
    icon: resolvePaymentIcon(type),
    enabled: m?.state === 'enabled',
    requiresReference: requiresReferenceFor(type),
    referenceLabel: resolveReferenceLabel(type),
    dianCode: m?.system_payment_method?.dian_code ?? undefined,
    provider: m?.system_payment_method?.provider ?? undefined,
    minAmount: m?.min_amount ?? undefined,
    maxAmount: m?.max_amount ?? undefined,
    original: m,
  };
}

/**
 * Adapt an ecommerce checkout payment method into the canonical shape.
 * `logo_url` is preserved in `original`; `icon` resolves to the shared icon set.
 */
export function fromCheckoutPaymentMethod(m: CheckoutPaymentMethodLike): PaymentMethod {
  const type = normalizePaymentType(m?.type);
  return {
    id: String(m?.id ?? ''),
    type,
    name: m?.name || '',
    icon: resolvePaymentIcon(type),
    enabled: true,
    requiresReference: requiresReferenceFor(type),
    referenceLabel: resolveReferenceLabel(type),
    provider: m?.provider ?? undefined,
    processingMode: m?.processing_mode,
    minAmount: m?.min_amount ?? undefined,
    maxAmount: m?.max_amount ?? undefined,
    // Cast is safe: Record<string,string|undefined> is assignable to the
    // concrete instructions shape, so the reverse `as` overlap is allowed.
    paymentInstructions:
      (m?.payment_instructions as Record<string, string | undefined> | undefined) ??
      undefined,
    original: m,
  };
}

/**
 * Adapt a raw backend payment method returned by the context-aware POS endpoint
 * `GET /store/payments/payment-methods` into the canonical shape.
 *
 * Handles both the flattened and the nested (`system_payment_method`) response
 * structures and corrects legacy `transfer` → `bank_transfer` type strings.
 */
export function fromPosBackendMethod(raw: any): PaymentMethod {
  const rawType: string =
    raw?.system_payment_method?.type || raw?.type || 'unknown';
  const type = normalizePaymentType(rawType);
  const name =
    raw?.display_name || raw?.name || raw?.system_payment_method?.name || '';
  return {
    id: String(raw?.id ?? ''),
    type,
    name,
    displayName: raw?.display_name ?? undefined,
    icon: resolvePaymentIcon(type),
    enabled: raw?.state === 'enabled',
    requiresReference: requiresReferenceFor(type),
    referenceLabel: resolveReferenceLabel(type),
    dianCode: raw?.system_payment_method?.dian_code ?? undefined,
    minAmount: raw?.min_amount ?? undefined,
    maxAmount: raw?.max_amount ?? undefined,
    original: raw,
  };
}
