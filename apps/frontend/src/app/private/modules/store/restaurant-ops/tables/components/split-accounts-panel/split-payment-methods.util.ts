import type { PaymentMethod } from '../../../../../../../shared/models/payment-method.model';

/**
 * Métodos con los que se puede cobrar una cuenta dividida.
 *
 * Espeja la regla del backend (`payment-legs.util.ts` → `assertDirectMethod`):
 * el cobro multimétodo de contado solo rechaza pasarelas (`wompi`), crédito,
 * wallet y los métodos `ON_DELIVERY`. `bank_transfer` es válido aunque su
 * `processing_mode` sea `ONLINE` — el seed de `system_payment_methods` lo crea
 * justamente así, y filtrarlo por `DIRECT` lo hacía desaparecer del cobro
 * (el cajero no podía registrar una transferencia en una cuenta dividida).
 */
const SPLIT_ALLOWED_TYPES = new Set(['cash', 'card', 'bank_transfer', 'wompi']);

export function selectChargeableSplitMethods(
  methods: PaymentMethod[] | null | undefined,
): PaymentMethod[] {
  return (methods ?? []).filter(
    (method) =>
      method?.enabled === true &&
      Number(method.id) > 0 &&
      SPLIT_ALLOWED_TYPES.has(String(method.type)) &&
      method.processingMode !== 'ON_DELIVERY',
  );
}
