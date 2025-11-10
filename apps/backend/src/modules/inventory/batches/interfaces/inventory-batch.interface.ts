export interface InventoryBatch {
  id: string;
  batch_number: string;
  product_id: string;
  product_variant_id?: string;
  quantity: number;
  quantity_available: number;
  unit_cost: number;
  expiration_date?: Date;
  manufacture_date?: Date;
  location_id: string;
  organization_id: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}
