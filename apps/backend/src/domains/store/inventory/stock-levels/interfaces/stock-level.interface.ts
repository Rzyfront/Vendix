export interface StockLevel {
  id: number;
  product_id: number;
  product_variant_id?: number;
  location_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  reorder_point?: number;
  max_stock?: number;
  cost_per_unit?: number;
  last_updated: Date;

  /**
   * UoM derived display (Fase UoM). Populated only for ingredients
   * configured with a purchase→stock factor > 0.
   *   - sealed_units:     floor(quantity_on_hand / factor)
   *   - open_remaining:   quantity_on_hand % factor  (the open bottle/bag)
   * Null for retail/legacy products or when factor is missing.
   */
  sealed_units?: number | null;
  open_remaining?: number | null;
}

export interface StockAlert {
  product_id: number;
  product_name: string;
  location_id: number;
  location_name: string;
  current_stock: number;
  reorder_point: number;
  status: 'low_stock' | 'out_of_stock' | 'optimal';
}

export interface StockLevelQuery {
  product_id?: number;
  location_id?: number;
  low_stock_only?: boolean;
  search?: string;
}
