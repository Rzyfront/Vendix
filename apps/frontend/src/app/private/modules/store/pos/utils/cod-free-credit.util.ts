/**
 * cod-auto-invoicing S3 — notice shown when a contado sale paid «contra
 * entrega» is switched to free credit. Exact text requested by the owner.
 */
export const COD_FREE_CREDIT_NOTICE =
  'El pago contra entrega requiere crédito libre: el modo de pago se cambiará a crédito libre';

export interface CodFreeCreditInput {
  methodType: string | null | undefined;
  mode: 'contado' | 'credito';
  /** POS `invoicing.pos.auto_emit`. */
  autoEmit: boolean;
  /** A saved customer is on the sale (not anonymous, not alias). */
  hasRealCustomer: boolean;
}

/**
 * With automatic e-invoicing on, a contado + contra entrega sale must be
 * invoiced as credit until the money is collected, so the POS switches it to
 * free credit. Never blocks: without the flag or a real customer (credit needs
 * one) the sale keeps going as contado, exactly as today.
 */
export function shouldSwitchCodToFreeCredit(input: CodFreeCreditInput): boolean {
  return (
    input.autoEmit &&
    input.hasRealCustomer &&
    input.mode === 'contado' &&
    input.methodType === 'cash_on_delivery'
  );
}
