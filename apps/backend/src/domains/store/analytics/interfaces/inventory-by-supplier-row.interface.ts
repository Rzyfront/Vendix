/**
 * Row representation for the "Inventario por Proveedor" report (QUI-550).
 * All numbers are RAW (not pre-formatted strings, no hardcoded currency symbols).
 */
export interface InventoryBySupplierRow {
  supplier_id: number;
  supplier_name: string;
  supplier_document: string;
  product_count: number;
  total_units_on_hand: number;
  total_units_reserved: number;
  total_units_available: number;
  total_stock_value: number;
  avg_unit_cost: number;
  top_product_name: string;
}

export interface InventoryBySupplierTotals {
  product_count: number;
  total_units_on_hand: number;
  total_units_reserved: number;
  total_units_available: number;
  total_stock_value: number;
}
