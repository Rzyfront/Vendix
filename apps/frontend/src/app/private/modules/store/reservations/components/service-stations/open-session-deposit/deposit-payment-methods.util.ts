import { SelectorOption } from '../../../../../../../shared/components';
import { StorePaymentMethod } from '../../../../settings/payments/interfaces/payment-methods.interface';

/** An enabled store payment method reduced to what the deposit requests need. */
export interface DepositMethodChoice {
  /** `store_payment_method_id` of the request. */
  id: number;
  /** Canonical method type sent as `method` (cash, card, bank_transfer...). */
  type: string;
  label: string;
}

export function toDepositMethodChoices(rows: StorePaymentMethod[] | null | undefined): DepositMethodChoice[] {
  const choices: DepositMethodChoice[] = [];
  for (const row of rows ?? []) {
    const id = Number(row.id);
    const type = row.system_payment_method?.type;
    if (!Number.isInteger(id) || id <= 0 || !type) continue;
    choices.push({ id, type, label: row.display_name || row.system_payment_method?.display_name || type });
  }
  return choices;
}

export function toDepositMethodOptions(choices: DepositMethodChoice[]): SelectorOption[] {
  return choices.map((c) => ({ value: c.id, label: c.label }));
}

/** Cash first: it is the usual way a deposit is received at the counter. */
export function defaultDepositMethod(choices: DepositMethodChoice[]): DepositMethodChoice | null {
  return choices.find((c) => c.type === 'cash') ?? choices[0] ?? null;
}

/** One idempotency key per deposit attempt (the backend dedupes on it). */
export function newDepositRequestId(): string {
  return crypto.randomUUID();
}
