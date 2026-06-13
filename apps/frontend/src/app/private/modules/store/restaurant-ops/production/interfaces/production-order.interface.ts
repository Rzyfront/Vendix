/**
 * Restaurant Suite — Phase C.
 * Source of truth for the Production Orders / Sub-recipe batch stock domain
 * in the frontend.
 *
 * Mirrors the Prisma model `production_orders` and the controller exposed by
 * `apps/backend/src/domains/store/production/`.
 */

export type ProductionOrderStatus =
  | 'draft'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface ProductionOrderProduct {
  id: number;
  name: string;
  sku?: string | null;
  stock_unit?: string | null;
  is_batch_produced?: boolean;
}

export interface ProductionOrderRecipe {
  id: number;
  yield_quantity: number | string;
  yield_unit: string;
  waste_percent: number | string;
  preparation_notes?: string | null;
}

export interface ProductionOrder {
  id: number;
  store_id: number;
  product_id: number;
  recipe_id: number;
  planned_qty: number | string;
  produced_qty?: number | string | null;
  status: ProductionOrderStatus;
  produced_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;

  // Populated by GET list/detail.
  product?: ProductionOrderProduct;
  recipe?: ProductionOrderRecipe;
}

export interface CreateProductionOrderDto {
  product_id: number;
  recipe_id: number;
  planned_qty: number;
  notes?: string;
}

export interface UpdateProductionOrderDto {
  notes?: string;
}

export interface CompleteProductionOrderDto {
  produced_qty: number;
  waste_percent_override?: number;
  notes?: string;
}

export interface ProductionOrderQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProductionOrderStatus;
  product_id?: number;
  recipe_id?: number;
  sort_by?: 'created_at' | 'produced_at' | 'planned_qty' | 'produced_qty' | 'status';
  sort_order?: 'asc' | 'desc';
}

export interface ProductionOrderStats {
  draft: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  total: number;
  produced_today: number;
  produced_week: number;
  produced_month: number;
}

/**
 * Compact shape used to populate the product selector on the production
 * form. Source = GET /store/products filtered to `is_batch_produced=true`.
 */
export interface ProductionProductOption {
  id: number;
  name: string;
  sku?: string | null;
  stock_unit?: string | null;
  is_batch_produced?: boolean;
  product_type?: 'physical' | 'service' | 'prepared';
}
