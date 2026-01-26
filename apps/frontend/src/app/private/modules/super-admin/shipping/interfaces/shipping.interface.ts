export enum ShippingMethodType {
  PICKUP = 'pickup',
  OWN_FLEET = 'own_fleet',
  CARRIER = 'carrier',
  THIRD_PARTY_PROVIDER = 'third_party_provider',
  CUSTOM = 'custom',
}

export enum ShippingRateType {
  FLAT = 'flat',
  WEIGHT_BASED = 'weight_based',
  PRICE_BASED = 'price_based',
  CARRIER_CALCULATED = 'carrier_calculated',
  FREE = 'free',
}

export interface ShippingMethod {
  id: number;
  name: string;
  code?: string;
  description?: string;
  type: ShippingMethodType;
  provider_name?: string;
  min_days?: number;
  max_days?: number;
  is_active: boolean;
  is_system: boolean;
  display_order: number;
}

export interface ShippingZone {
  id: number;
  name: string;
  countries: string[];
  regions?: string[];
  cities?: string[];
  zip_codes?: string[];
  is_active: boolean;
  is_system: boolean;
  shipping_rates?: ShippingRate[];
  _count?: {
    shipping_rates: number;
  };
}

export interface ShippingRate {
  id: number;
  shipping_zone_id: number;
  shipping_method_id: number;
  name?: string;
  type: ShippingRateType;
  base_cost: number;
  per_unit_cost?: number;
  min_val?: number;
  max_val?: number;
  free_shipping_threshold?: number;
  is_active: boolean;
  shipping_method?: ShippingMethod;
}

export interface ShippingMethodStats {
  total_methods: number;
  active_methods: number;
  inactive_methods: number;
}

export interface ShippingZoneStats {
  total_zones: number;
  active_zones: number;
  inactive_zones: number;
}
