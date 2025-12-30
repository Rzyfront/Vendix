/**
 * POP Constants
 * Label constants for dropdowns and displays
 */

export const SHIPPING_METHOD_LABELS = {
  supplier_transport: 'Transporte Proveedor',
  freight: 'Flete',
  pickup: 'Recolección',
  other: 'Otro',
} as const;

export const PAYMENT_TERM_LABELS = {
  immediate: 'Pago Inmediato',
  net_15: '15 Días',
  net_30: '30 Días',
  net_60: '60 Días',
  net_90: '90 Días',
  custom: 'Personalizado',
} as const;
