export interface PosShippingMethod {
  id: number;
  name: string;
  type: string; // 'pickup' | 'own_fleet' | 'carrier' | 'custom' | 'third_party_provider'
  description?: string;
  is_active: boolean;
  display_order?: number;
  min_days?: number;
  max_days?: number;
}

export interface PosShippingAddress {
  address_line1: string;
  address_line2?: string;
  city: string;
  state_province?: string;
  postal_code?: string;
  country_code: string;
  latitude?: number;
  longitude?: number;
  municipality_code?: string;
  recipient_name?: string;
  recipient_phone?: string;
}

/**
 * Contexto de envío que el wizard del POS produce una sola vez y consumen las
 * DOS salidas del flujo: la venta (`processShippingSale`) y el borrador
 * (`saveDraft`). Vive aquí, y no inline en el servicio, porque un borrador que
 * pierde estas claves es una orden de domicilio sin domicilio.
 */
export interface PosShippingSaleData {
  /** POS alias identity, mutually exclusive with customer_id. */
  customerAlias?: string;
  shippingMethodId: number;
  shippingCost: number;
  deliveryType: string;
  shippingAddress: PosShippingAddress;
  deliveryNotes?: string;
  shippingAddressId?: number | null;
  /** Tarifa seleccionada; también define el tratamiento fiscal del precio manual. */
  shippingRateId?: number | null;
  /** Entrada digitada: bruto para tarifa inclusiva, base para tarifa aditiva. */
  manualShippingPrice?: number;
  manualCostOverride?: boolean;
}

/**
 * La tarifa seleccionada viaja incluso en el override manual: el servidor
 * aplica su configuración fiscal al importe digitado.
 */
export function posShippingRateIdForPayload(
  data: Pick<PosShippingSaleData, 'shippingRateId' | 'manualCostOverride'> | null | undefined,
): number | undefined {
  if (!data) return undefined;
  return data.shippingRateId != null ? data.shippingRateId : undefined;
}

export interface PosManualShippingQuote {
  shipping_rate_id: number;
  manual_shipping_price: number;
  shipping_cost: number;
  base: number;
  shipping_tax_amount: number;
  tax_is_inclusive: boolean | null;
}

export interface PosShippingOption {
  id: number;
  /** Rate identifier — semantic alias of `id`, returned by backend calculator. */
  rate_id?: number;
  method_id: number;
  method_name: string;
  method_type: string;
  /** Optional human-readable rate name (often same as method_name). */
  rate_name?: string;
  /** Optional zone label resolved by the calculator. */
  zone_name?: string;
  /**
   * Lo que paga el cliente por el envío: siempre el BRUTO (lote C). En modo
   * agregado ya trae el impuesto sumado.
   */
  cost: number;
  /**
   * Bloque fiscal para superficies del COMERCIANTE (wizard, POS). El
   * storefront muestra solo `cost`. Ausentes = backend sin contexto fiscal
   * para la tarifa ⇒ sin desglose (fail-closed, nunca derivado en floats).
   */
  /** Base neta del envío (bruto − impuesto). */
  base?: number;
  /** Impuesto del envío incluido en `cost`. */
  shipping_tax_amount?: number;
  /** Modo de la tarifa: true = incluido, false = agregado. */
  tax_is_inclusive?: boolean;
  currency: string;
  estimated_days?: { min: number; max: number };
}

/**
 * Modo de pago asociado a un envío. Usado por el wizard de envío del POS
 * para decidir si el cobro se hace en línea, contra entrega, o se
 * transfiere al checkout del e-commerce.
 */
export type PosShippingPaymentMode =
  | 'on_delivery'
  | 'online'
  | 'pay_now'
  | 'ecommerce';
