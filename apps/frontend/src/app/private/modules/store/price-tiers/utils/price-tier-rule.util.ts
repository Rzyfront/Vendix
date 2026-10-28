import {
  applyTierAdjustment,
  resolveTierAdjustment,
  TierAdjustmentRule,
  validateTierAdjustment,
} from '../../../../../shared/services/pricing/tier-adjustment.util';
import {
  PriceTier,
  PriceTierAdjustmentType,
  PriceTierAmountScope,
} from '../interfaces/price-tier.interface';

const formatAmount = (value: number): string =>
  value.toLocaleString('es-CO', { maximumFractionDigits: 2 });

/**
 * Texto corto de la regla de una tarifa para listas, selectores y la página
 * de producto. `null` cuando la regla no cambia el precio (0 % de descuento).
 */
export function describePriceTierRule(rule: TierAdjustmentRule): string | null {
  const { type, value, scope } = resolveTierAdjustment(rule);
  const per = scope === 'per_package' ? 'por paquete' : 'por unidad';
  switch (type) {
    case 'percent_discount':
      return value > 0 ? `${formatAmount(value)} % de descuento` : null;
    case 'percent_surcharge':
      return `+${formatAmount(value)} %`;
    case 'fixed_amount_discount':
      return `−$${formatAmount(value)} ${per}`;
    case 'fixed_amount_surcharge':
      return `+$${formatAmount(value)} ${per}`;
    case 'fixed_price':
      return `Precio fijo $${formatAmount(value)} ${per}`;
  }
}

/**
 * Precio sugerido del paquete cuando el producto no tiene precio propio en la
 * tarifa. Mismo kernel que el backend. Sin precio base solo el precio fijo
 * sugiere algo: las demás reglas son relativas al precio.
 */
export function tierFallbackPackagePrice(
  basePrice: number,
  packSize: number,
  rule: TierAdjustmentRule,
): number | null {
  const { type } = resolveTierAdjustment(rule);
  if (basePrice <= 0 && type !== 'fixed_price') return null;
  return Number(applyTierAdjustment(basePrice, packSize, rule).toFixed(2));
}

export interface PriceTierRuleFormValue {
  adjustment_type: PriceTierAdjustmentType;
  discount_percentage: number | null;
  adjustment_value: number | null;
  amount_scope: PriceTierAmountScope;
}

export interface PriceTierRulePayload {
  adjustment_type: PriceTierAdjustmentType;
  discount_percentage: number;
  adjustment_value: number | null;
  amount_scope: PriceTierAmountScope;
}

const FIXED_TYPES: PriceTierAdjustmentType[] = [
  'fixed_amount_discount',
  'fixed_amount_surcharge',
  'fixed_price',
];

/** Solo los montos fijos distinguen unidad de paquete. */
export const isFixedAmountTierType = (type: PriceTierAdjustmentType): boolean =>
  FIXED_TYPES.includes(type);

/**
 * Normaliza la regla del formulario al payload del backend: el descuento
 * porcentual viaja en `discount_percentage` (sin valor de ajuste); los demás
 * tipos viajan en `adjustment_value` con el descuento en 0, y solo los montos
 * fijos guardan alcance. `error` es el texto a mostrar si la regla no es válida.
 */
export function buildPriceTierRulePayload(form: PriceTierRuleFormValue): {
  payload: PriceTierRulePayload;
  error: string | null;
} {
  const type = form.adjustment_type;
  const isPercentDiscount = type === 'percent_discount';
  const payload: PriceTierRulePayload = {
    adjustment_type: type,
    discount_percentage: isPercentDiscount
      ? Number(form.discount_percentage ?? 0)
      : 0,
    adjustment_value: isPercentDiscount
      ? null
      : form.adjustment_value == null
        ? null
        : Number(form.adjustment_value),
    amount_scope: isFixedAmountTierType(type) ? form.amount_scope : 'per_unit',
  };
  const code = validateTierAdjustment(payload);
  const error =
    code === 'value_required'
      ? 'Indica un valor mayor que 0.'
      : code === 'value_out_of_range'
        ? 'El recargo no puede pasar de 1000 %.'
        : code === 'unknown_type'
          ? 'Tipo de regla no válido.'
          : null;
  return { payload, error };
}

export interface CustomerPriceTierOption {
  value: number | '';
  label: string;
  description?: string;
}

/**
 * Opciones del selector "Tarifa preferencial" del cliente: solo tarifas de
 * cliente (una unidad de venta no se asigna a personas). Si el cliente tiene
 * una tarifa que ya no está activa, se mantiene visible para poder quitarla.
 */
export function customerPriceTierOptions(
  tiers: PriceTier[],
  currentId: number | null | undefined,
): CustomerPriceTierOption[] {
  const options: CustomerPriceTierOption[] = [{ value: '', label: 'Sin tarifa' }];
  for (const tier of tiers) {
    if (tier.kind && tier.kind !== 'customer_tier') continue;
    const rule = describePriceTierRule(tier);
    options.push({
      value: tier.id,
      label: tier.name,
      ...(rule ? { description: rule } : {}),
    });
  }
  if (currentId != null && !options.some((o) => o.value === currentId)) {
    options.push({ value: currentId, label: 'Tarifa inactiva o eliminada' });
  }
  return options;
}

/** Valor del selector → `price_tier_id` del payload (`''` = sin tarifa). */
export function toCustomerPriceTierId(
  value: number | string | null | undefined,
): number | null {
  if (value === '' || value == null) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
