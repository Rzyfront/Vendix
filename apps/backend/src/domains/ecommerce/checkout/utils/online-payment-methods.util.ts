import { payment_processing_mode_enum } from '@prisma/client';

/**
 * Processing modes a payment page (payment request) may offer: no
 * cash-on-delivery, because nobody is there to collect it.
 */
export const ONLINE_PAGE_PROCESSING_MODES: payment_processing_mode_enum[] = [
  payment_processing_mode_enum.DIRECT,
  payment_processing_mode_enum.ONLINE,
];

export interface PaymentMethodsFilterOptions {
  allowedModes: payment_processing_mode_enum[];
  /** `cash` is only exposed for pickup (QUI-850). */
  isPickup: boolean;
  /** `wallet` needs a logged-in customer (QUI-467). */
  isAuthenticated: boolean;
}

/**
 * `where` of the store payment methods a buyer may see. Shared by checkout and
 * by the public payment page so both apply the same exposure rules.
 * The `store_id` filter is added by the scoped prisma service.
 */
export function buildPaymentMethodsWhere(options: PaymentMethodsFilterOptions) {
  return {
    state: 'enabled' as const,
    AND: [
      { system_payment_method: { processing_mode: { in: options.allowedModes } } },
      ...(options.isPickup
        ? []
        : [{ system_payment_method: { type: { not: 'cash' } } }]),
      ...(options.isAuthenticated
        ? []
        : [{ system_payment_method: { NOT: { type: 'wallet' } } }]),
    ],
  };
}

/**
 * Returns a whitelisted subset of `custom_config` to expose publicly for
 * `bank_transfer` and `voucher` methods, or `null` when there is nothing to
 * expose (never an empty object).
 *
 *  - bank_transfer: bank_name, account_holder, account_number, account_type, instructions
 *  - voucher:       voucher_instructions, redemption_phone, notes
 */
export function buildPaymentInstructions(
  type: string,
  customConfig: unknown,
): Record<string, unknown> | null {
  if (type !== 'bank_transfer' && type !== 'voucher') return null;
  if (!customConfig || typeof customConfig !== 'object') return null;

  const config = customConfig as Record<string, unknown>;
  const whitelist: string[] =
    type === 'bank_transfer'
      ? [
          'bank_name',
          'account_holder',
          'account_number',
          'account_type',
          'instructions',
        ]
      : ['voucher_instructions', 'redemption_phone', 'notes'];

  const exposed: Record<string, unknown> = {};
  for (const key of whitelist) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      const value = config[key];
      if (value !== null && value !== undefined && value !== '') {
        exposed[key] = value;
      }
    }
  }

  return Object.keys(exposed).length > 0 ? exposed : null;
}

interface StorePaymentMethodRow {
  id: number;
  display_name: string | null;
  min_amount: unknown;
  max_amount: unknown;
  custom_config: unknown;
  system_payment_method: {
    display_name: string;
    type: string;
    provider: string | null;
    processing_mode: string;
    logo_url: string | null;
  };
}

/** Public shape of a store payment method (with bank/voucher instructions). */
export function toPublicPaymentMethod(m: StorePaymentMethodRow) {
  const base: Record<string, unknown> = {
    id: m.id,
    name: m.display_name || m.system_payment_method.display_name,
    type: m.system_payment_method.type,
    provider: m.system_payment_method.provider,
    processing_mode: m.system_payment_method.processing_mode,
    logo_url: m.system_payment_method.logo_url,
    min_amount: m.min_amount,
    max_amount: m.max_amount,
  };
  const instructions = buildPaymentInstructions(
    m.system_payment_method.type,
    m.custom_config,
  );
  if (instructions) base.payment_instructions = instructions;
  return base;
}
