/**
 * Manufactura MVP — contrato compartido con `/store/manufacturing/*`.
 *
 * Fórmula = receta (`recipes`) + `code`, `version`, `status`.
 * Orden = `production_orders` + `lines[]`.
 */
import type { Recipe, RecipeItem } from '../../restaurant-ops/recipes/interfaces';

// ─── Fórmulas ──────────────────────────────────────────────────────────────

export type FormulaStatus = 'draft' | 'active' | 'archived';

export interface Formula extends Omit<Recipe, 'items'> {
  code?: string | null;
  version?: number | string | null;
  status: FormulaStatus;
  items?: RecipeItem[];
  /** Costo teórico por unidad (si el listado lo expone). */
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
}

export interface FormulaQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: FormulaStatus;
}

export interface CreateFormulaDto {
  product_id: number;
  yield_quantity: number;
  yield_unit: string;
  waste_percent?: number;
  preparation_notes?: string;
  code?: string;
  version?: number;
  status?: FormulaStatus;
}

export type UpdateFormulaDto = Partial<Omit<CreateFormulaDto, 'product_id'>>;

export interface FormulaCostLine {
  component_product_id: number;
  name: string;
  quantity: number;
  waste_percent: number;
  effective_quantity: number;
  unit_cost: number;
  line_cost: number;
  cost_source: 'stock_level' | 'product';
}

export interface FormulaCost {
  recipe_id: number;
  yield_quantity: number;
  total_cost: number;
  unit_cost: number;
  lines: FormulaCostLine[];
}

// ─── Órdenes de producción ─────────────────────────────────────────────────

export type ManufacturingOrderStatus =
  | 'draft'
  | 'released'
  | 'in_progress'
  | 'partially_completed'
  | 'completed'
  | 'cancelled';

export type ManufacturingPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface ManufacturingOrderLine {
  id: number;
  component_product_id: number;
  component_variant_id?: number | null;
  uom_id?: number | null;
  planned_qty: number | string;
  consumed_qty?: number | string | null;
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
  component_product?: { id: number; name: string; sku?: string | null } | null;
  /** Algunos backends aplanan el nombre del insumo. */
  product_name?: string | null;
}

export interface ManufacturingOrder {
  id: number;
  store_id: number;
  order_number: string | null;
  product_id: number;
  recipe_id: number;
  status: ManufacturingOrderStatus;
  priority?: ManufacturingPriority | null;
  planned_qty: number | string;
  produced_qty?: number | string | null;
  due_date?: string | Date | null;
  started_at?: string | Date | null;
  produced_at?: string | Date | null;
  location_id?: number | null;
  batch_id?: number | null;
  notes?: string | null;
  planned_cost?: number | string | null;
  actual_cost?: number | string | null;
  unit_cost?: number | string | null;
  created_at: string | Date;
  updated_at: string | Date;
  product?: { id: number; name: string; sku?: string | null } | null;
  recipe?: {
    id: number;
    code?: string | null;
    version?: number | string | null;
    yield_unit?: string | null;
    yield_quantity?: number | string | null;
  } | null;
  lines?: ManufacturingOrderLine[];
}

export interface ManufacturingOrderQuery {
  page?: number;
  limit?: number;
  status?: ManufacturingOrderStatus;
  product_id?: number;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface CreateManufacturingOrderDto {
  recipe_id: number;
  planned_qty: number;
  due_date?: string;
  location_id?: number;
  priority?: ManufacturingPriority;
  notes?: string;
}

export interface UpdateManufacturingOrderDto {
  planned_qty?: number;
  due_date?: string;
  location_id?: number;
  priority?: ManufacturingPriority;
  notes?: string;
}

export interface CompleteManufacturingOrderDto {
  produced_qty?: number;
  location_id?: number;
  batch?: {
    batch_number?: string;
    manufacturing_date?: string;
    expiration_date?: string;
  };
}

export interface ManufacturingShortage {
  product_id: number;
  name: string;
  required: number;
  available: number;
  missing: number;
}

// ─── Planta (settings) ─────────────────────────────────────────────────────

export type ManufacturingCostMethod = 'fifo' | 'cpp';

export interface ManufacturingSettings {
  default_input_location_id: number | null;
  default_output_location_id: number | null;
  cost_method: ManufacturingCostMethod;
  lot_required: boolean;
  wip_account_id?: number | null;
}

// ─── Productos (selectores) ────────────────────────────────────────────────

export interface ManufacturingProductOption {
  id: number;
  name: string;
  sku?: string | null;
  description?: string | null;
  stock_unit?: string | null;
  product_type?: string | null;
  is_batch_produced?: boolean;
  cost_price?: number | string | null;
  /** Foto principal resuelta por el endpoint de productos. */
  image_url?: string | null;
  product_images?: Array<{
    id?: number;
    image_url: string;
    is_main?: boolean | null;
    alt_text?: string | null;
    sort_order?: number | null;
  }>;
}

// ─── Utilidades de presentación ────────────────────────────────────────────

export const FORMULA_STATUS_LABELS: Record<FormulaStatus, string> = {
  draft: 'Borrador',
  active: 'Activa',
  archived: 'Archivada',
};

export const ORDER_STATUS_LABELS: Record<ManufacturingOrderStatus, string> = {
  draft: 'Borrador',
  released: 'Lanzada',
  in_progress: 'En proceso',
  partially_completed: 'Parcialmente completada',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export const ORDER_PRIORITY_LABELS: Record<ManufacturingPriority, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

/** Colores de badge por estado (valor CSS) para `TableColumn.badgeConfig.colorFn`. */
export const ORDER_STATUS_COLORS: Record<ManufacturingOrderStatus, string> = {
  draft: '#64748b',
  released: '#0284c7',
  in_progress: '#d97706',
  partially_completed: '#7c3aed',
  completed: '#16a34a',
  cancelled: '#dc2626',
};

export const FORMULA_STATUS_COLORS: Record<FormulaStatus, string> = {
  draft: '#64748b',
  active: '#16a34a',
  archived: '#dc2626',
};
