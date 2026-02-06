// ===== TYPES =====

export type ShippingRateType = 'flat' | 'weight_based' | 'price_based' | 'carrier_calculated' | 'free';

/**
 * Source type for zones/rates - tracks how they were created:
 * - 'system_copy': Auto-copied when enabling a shipping method (linked to system)
 * - 'custom': Created from scratch or duplicated for customization (independent)
 */
export type ZoneSourceType = 'system_copy' | 'custom';

// ===== ZONE INTERFACES =====

export interface ShippingZone {
  id: number;
  store_id?: number;
  name: string;
  display_name?: string;
  countries: string[];
  regions?: string[];
  cities?: string[];
  zip_codes?: string[];
  is_active: boolean;
  is_system: boolean;

  // Copy tracking fields (One-Click Magic)
  copied_from_system_zone_id?: number;
  source_type?: ZoneSourceType;

  _count?: {
    shipping_rates: number;
  };
  created_at?: string;
  updated_at?: string;
}

// ===== RATE INTERFACES =====

export interface ShippingRateMethod {
  id: number;
  name: string;
  type: string;
  logo_url?: string;
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
  shipping_method?: ShippingRateMethod;

  // Copy tracking fields
  copied_from_system_rate_id?: number;
  source_type?: ZoneSourceType;

  created_at?: string;
  updated_at?: string;
}

// ===== STATISTICS =====

export interface ZoneStats {
  system_zones: number;
  store_zones: number;
  store_rates: number;
  // Extended stats from unified getStats()
  total_zones?: number;
  system_copy_zones?: number;
  custom_zones?: number;
  total_rates?: number;
}

// ===== SYNC INTERFACES =====

export interface SystemZoneUpdate {
  id: number;
  system_zone_id: number;
  change_type: 'updated' | 'new_rate' | 'rate_updated' | 'deleted';
  description: string;
  created_at: string;
}

export interface SyncResult {
  zone: ShippingZone;
  _sync_stats: {
    rates_updated: number;
    rates_added: number;
  };
}

// ===== DTOs =====

export interface CreateZoneDto {
  name: string;
  display_name?: string;
  countries: string[];
  regions?: string[];
  cities?: string[];
  zip_codes?: string[];
  is_active?: boolean;
}

export interface UpdateZoneDto extends Partial<CreateZoneDto> {}

export interface CreateRateDto {
  shipping_zone_id: number;
  shipping_method_id: number;
  name?: string;
  type: ShippingRateType;
  base_cost: number;
  per_unit_cost?: number;
  min_val?: number;
  max_val?: number;
  free_shipping_threshold?: number;
  is_active?: boolean;
}

export interface UpdateRateDto extends Partial<Omit<CreateRateDto, 'shipping_zone_id'>> {}
