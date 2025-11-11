export interface Supplier {
  id: number;
  organization_id: number;
  name: string;
  code: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  tax_id?: string;
  payment_terms?: string;
  notes?: string;
  is_active: boolean;
  address_id?: number;
  created_at: Date;
  updated_at: Date;
}

export interface SupplierProduct {
  id: number;
  supplier_id: number;
  product_id: number;
  supplier_sku?: string;
  supplier_product_name?: string;
  cost_price?: number;
  min_order_quantity?: number;
  lead_time_days?: number;
  is_preferred: boolean;
  last_purchase_date?: Date;
  last_cost_price?: number;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSupplierDto {
  name: string;
  code: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  tax_id?: string;
  payment_terms?: string;
  notes?: string;
  address_id?: number;
}

export interface UpdateSupplierDto {
  name?: string;
  code?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  tax_id?: string;
  payment_terms?: string;
  notes?: string;
  is_active?: boolean;
  address_id?: number;
}

export interface SupplierQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
  contact_person?: string;
  email?: string;
  sort_by?: 'name' | 'code' | 'created_at';
  sort_order?: 'asc' | 'desc';
}
