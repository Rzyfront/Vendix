export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted' | 'cancelled';

/** B.2 (FB-01 parcial-destination): destino fijo al crear, jamas editable. Default `sale`. */
export type QuotationDestination = 'sale' | 'contract' | 'other';

/**
 * B.2 (FB-03): entrada del catalogo de perfiles activos (`GET /store/quotation-profiles/catalog`).
 * Espejo liviano del patron de facturacion (`InvoiceProfileCatalogEntry`): elegir un perfil
 * no requiere sus reglas; la precarga la resuelve el backend con la version congelada (FB-05).
 * Campos de precarga opcionales: el catalogo puede no traerlos (solo id+nombre) y el
 * formulario debe operar igual; `profile_id` igual viaja y el backend precarga.
 */
export interface QuotationProfileCatalogEntry {
  id: number;
  name: string;
  is_default?: boolean;
  current_version?: number;
  state?: string;
  /** Objeto/alcance del contrato cuando el catalogo lo expone (precarga de condiciones). */
  contract_object?: string;
  terms_and_conditions?: string;
  notes?: string;
  /** A/I/U cuando el catalogo los expone; sin campos AIU en el modal, viajan via `profile_id`. */
  administration_percentage?: number;
  contingency_percentage?: number;
  profit_percentage?: number;
}

export interface QuotationItem {
  id: number;
  quotation_id: number;
  product_id?: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate?: number;
  tax_amount_item?: number;
  total_price: number;
  applied_price_tier_id?: number | null;
  applied_price_tier_name_snapshot?: string | null;
  stock_units_consumed?: number | null;
  notes?: string;
  product?: any;
  product_variant?: any;
}

export interface Quotation {
  id: number;
  store_id: number;
  customer_id?: number;
  quotation_number: string;
  status: QuotationStatus;
  /** B.2: destino fijo al crear (default `sale` en backend). Solo lectura en frontend. */
  destination?: QuotationDestination;
  /** B.2: perfil con el que se precargo (nullable = cotizada desde cero). */
  profile_id?: number | null;
  channel: string;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  shipping_cost: number;
  grand_total: number;
  valid_until?: string;
  notes?: string;
  internal_notes?: string;
  terms_and_conditions?: string;
  sent_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  converted_at?: string;
  converted_order_id?: number;
  created_by_user_id?: number;
  created_at: string;
  updated_at: string;
  quotation_items: QuotationItem[];
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
  created_by_user?: {
    id: number;
    first_name: string;
    last_name: string;
  };
  converted_order?: {
    id: number;
    order_number: string;
    state: string;
    grand_total: number;
  };
}

export interface QuotationQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: QuotationStatus;
  customer_id?: number;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedQuotationsResponse {
  data: Quotation[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface QuotationStats {
  total: number;
  pending: number;
  conversion_rate: number;
  average_value: number;
  draft: number;
  sent: number;
  accepted: number;
  converted: number;
}

export interface CreateQuotationItemDto {
  product_id?: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_rate?: number;
  tax_amount_item?: number;
  total_price: number;
  applied_price_tier_id?: number | null;
  notes?: string;
}

export interface CreateQuotationDto {
  customer_id?: number;
  /** B.2 (FB-01/FB-05): destino al crear; omitido = backend aplica `sale`. Nunca se edita. */
  destination?: QuotationDestination;
  /** B.2 (FB-05): perfil opcional; omitido = cotizar desde cero. Id ajeno/inactivo da 400/403. */
  profile_id?: number;
  channel?: string;
  valid_until?: string;
  notes?: string;
  internal_notes?: string;
  terms_and_conditions?: string;
  items: CreateQuotationItemDto[];
}
