import { StoreSettings } from '../interfaces/store-settings.interface';

export function getDefaultStoreSettings(): StoreSettings {
  return {
    general: {
      timezone: 'America/Bogota',
      currency: 'USD',
      language: 'es',
      tax_included: false,
    },
    inventory: {
      low_stock_threshold: 10,
      out_of_stock_action: 'hide',
      track_inventory: true,
      allow_negative_stock: false,
    },
    checkout: {
      require_customer_data: true,
      allow_guest_checkout: false,
      allow_partial_payments: false,
      require_payment_confirmation: true,
    },
    shipping: getDefaultShippingSettings(),
    notifications: {
      email_enabled: true,
      sms_enabled: false,
      low_stock_alerts: true,
      new_order_alerts: true,
      low_stock_alerts_email: null,
      new_order_alerts_email: null,
      low_stock_alerts_phone: null,
      new_order_alerts_phone: null,
    },
    pos: {
      business_hours: getDefaultBusinessHours(),
      offline_mode_enabled: false,
      require_cash_drawer_open: false,
      auto_print_receipt: true,
      allow_price_edit: true,
      allow_discount: true,
      max_discount_percentage: 15,
      allow_refund_without_approval: false,
    },
    receipts: {
      print_receipt: true,
      email_receipt: false,
      receipt_header: '',
      receipt_footer: '¡Gracias por su compra!',
    },
  };
}

const correosCarrier = {
  id: 'correos' as const,
  name: 'Correos de Chile',
  type: 'correos' as const,
  enabled: true,
  config: {
    tracking_enabled: true,
    estimated_days_min: 2,
    estimated_days_max: 5,
    requires_signature: false,
    requires_insurance: false,
    max_weight: null,
    max_dimensions: null,
  },
} as const;

const estafetaCarrier = {
  id: 'estafeta' as const,
  name: 'Estafeta',
  type: 'estafeta' as const,
  enabled: true,
  config: {
    tracking_enabled: true,
    estimated_days_min: 1,
    estimated_days_max: 3,
    requires_signature: true,
    requires_insurance: false,
    max_weight: null,
    max_dimensions: null,
  },
} as const;

function getDefaultShippingSettings() {
  return {
    enabled: true,
    free_shipping_threshold: 0,
    allow_pickup: true,
    default_shipping_method: 'standard',
    shipping_zones: [],
    shipping_types: {
      standard: {
        enabled: true,
        carriers: [correosCarrier, estafetaCarrier],
      },
      express: {
        enabled: false,
        carriers: [],
      },
      local: {
        enabled: false,
        allow_manual: false,
        delivery_providers: [],
      },
    },
  };
}

function getDefaultBusinessHours(): Record<
  string,
  { open: string; close: string }
> {
  return {
    monday: { open: '09:00', close: '19:00' },
    tuesday: { open: '09:00', close: '19:00' },
    wednesday: { open: '09:00', close: '19:00' },
    thursday: { open: '09:00', close: '19:00' },
    friday: { open: '09:00', close: '20:00' },
    saturday: { open: '10:00', close: '18:00' },
    sunday: { open: '11:00', close: '16:00' },
  };
}
