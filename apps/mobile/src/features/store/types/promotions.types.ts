/**
 * Tipos del módulo Marketing - Promociones
 *
 * Alineados con los DTOs del backend:
 *   apps/backend/src/domains/store/promotions/dto/
 *
 * ⚠️ NO importar de backend directamente (mobile-dev RULE 4).
 *    Este archivo es la single source of truth para mobile.
 */

// ─── Enums ──────────────────────────────────────────────────────────────

export type PromotionState =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'expired'
  | 'cancelled';

export type PromotionType = 'percentage' | 'fixed_amount';

export type PromotionRuleType = 'flat' | 'quantity_tiered';

export type PromotionScope = 'order' | 'product' | 'category';

// ─── Entidad Promotion (response shape del backend) ──────────────────────

export interface Promotion {
  id: number;
  store_id: number;
  name: string;
  description?: string | null;
  code?: string | null;
  type: PromotionType;
  value: number;
  rule_type: PromotionRuleType;
  scope: PromotionScope;
  min_purchase_amount?: number | null;
  max_discount_amount?: number | null;
  usage_limit?: number | null;
  usage_count: number;
  per_customer_limit?: number | null;
  start_date: string;
  end_date?: string | null;
  state: PromotionState;
  is_auto_apply: boolean;
  priority: number;
  created_at?: string;
  updated_at?: string;
  promotion_products?: Array<{
    product_id: number;
    products?: { id: number; name: string; sku?: string; base_price?: number };
  }>;
  promotion_categories?: Array<{
    category_id: number;
    categories?: { id: number; name: string };
  }>;
  promotion_quantity_tiers?: QuantityTier[];
  _count?: {
    promotion_products?: number;
    promotion_categories?: number;
    order_promotions?: number;
  };
}

export interface QuantityTier {
  id?: number;
  min_quantity: number;
  max_quantity?: number | null;
  type: PromotionType;
  value: number;
  sort_order?: number;
}

export interface PromotionStats {
  total_active: number;
  total_scheduled: number;
  total_discount_given: number;
  total_usage: number;
}

export interface PromotionListMeta {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface PaginatedPromotionResponse {
  data: Promotion[];
  meta: PromotionListMeta;
}

export interface PromotionApiResponse<T> {
  data: T;
  message?: string;
}

// ─── DTOs ───────────────────────────────────────────────────────────────

export interface CreatePromotionDto {
  name: string;
  description?: string;
  code?: string;
  type: PromotionType;
  value: number;
  rule_type?: PromotionRuleType;
  scope?: PromotionScope;
  min_purchase_amount?: number;
  max_discount_amount?: number;
  usage_limit?: number;
  per_customer_limit?: number;
  start_date: string;
  end_date?: string;
  is_auto_apply?: boolean;
  priority?: number;
  product_ids?: number[];
  category_ids?: number[];
  quantity_tiers?: QuantityTier[];
}

export type UpdatePromotionDto = Partial<CreatePromotionDto>;

// ─── Query ──────────────────────────────────────────────────────────────

export interface PromotionQuery {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  state?: PromotionState;
  type?: PromotionType;
  scope?: PromotionScope;
  rule_type?: PromotionRuleType;
}

// ─── Labels hard-coded (mirror del i18n web) ───────────────────────────

export const PROMOTION_STATE_LABELS: Record<PromotionState, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  active: 'Activa',
  paused: 'Pausada',
  expired: 'Expirada',
  cancelled: 'Cancelada',
};

export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  percentage: 'Porcentaje',
  fixed_amount: 'Monto fijo',
};

export const PROMOTION_RULE_TYPE_LABELS: Record<PromotionRuleType, string> = {
  flat: 'Plana',
  quantity_tiered: 'Por cantidad',
};

export const PROMOTION_SCOPE_LABELS: Record<PromotionScope, string> = {
  order: 'Orden',
  product: 'Producto',
  category: 'Categoria',
};
