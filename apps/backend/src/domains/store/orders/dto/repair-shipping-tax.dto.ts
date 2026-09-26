import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * B5 — Reparación de la copia del impuesto del envío (`orders.shipping_tax_*`).
 *
 * - `complete_rate`: rellena name/type/rate desde `shipping_tax_rate_id`
 *   conservando el `amount`. Repara copias incompletas (sin tarifa o con tipo
 *   fuera de iva/inc) para que la factura se pueda emitir.
 * - `clear`: deja la copia vacía. Solo se permite si NO existe asiento de
 *   venta contabilizado con ese impuesto (si existe ⇒ 409).
 *
 * La reparación nunca toca `shipping_cost` ni `grand_total`.
 */
export const REPAIR_SHIPPING_TAX_ACTIONS = [
  'complete_rate',
  'clear',
] as const;

export type RepairShippingTaxAction =
  (typeof REPAIR_SHIPPING_TAX_ACTIONS)[number];

export class RepairShippingTaxDto {
  @IsIn([...REPAIR_SHIPPING_TAX_ACTIONS])
  action: RepairShippingTaxAction;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
