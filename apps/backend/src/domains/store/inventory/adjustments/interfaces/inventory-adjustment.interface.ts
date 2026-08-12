export type AdjustmentType =
  | 'damage'
  | 'loss'
  | 'theft'
  | 'expiration'
  | 'count_variance'
  | 'manual_correction';

// La creación dejó de ser una `interface`: como DTO el ValidationPipe la
// ignoraba entera. Vive en `../dto/create-adjustment.dto.ts`.
export { CreateAdjustmentDto } from '../dto/create-adjustment.dto';

// La consulta de la lista dejó de ser una `interface`: como DTO el
// ValidationPipe la ignoraba entera. Vive en `../dto/adjustment-query.dto.ts`.
export { AdjustmentQueryDto } from '../dto/adjustment-query.dto';

export interface InventoryAdjustment {
  id: number;
  organization_id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  batch_id: number | null;
  adjustment_type: AdjustmentType;
  quantity_before: number;
  quantity_after: number;
  quantity_change: number;
  reason_code: string | null;
  description: string | null;
  approved_by_user_id: number | null;
  created_by_user_id: number | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // Relations
  products?: {
    id: number;
    name: string;
    sku: string | null;
  };
  product_variants?: {
    id: number;
    sku: string;
    name: string | null;
  } | null;
  inventory_locations?: {
    id: number;
    name: string;
    code: string;
    type: string;
    store_id?: number | null;
  };
  inventory_batches?: {
    id: number;
    batch_number: string;
    expiration_date: Date | null;
    quantity: number;
    quantity_used: number;
  } | null;
  organizations?: {
    id: number;
    name: string;
  };
  created_by_user?: {
    id: number;
    user_name: string;
    email: string;
  } | null;
  approved_by_user?: {
    id: number;
    user_name: string;
    email: string;
  } | null;
}

export interface AdjustmentResponse {
  adjustments: InventoryAdjustment[];
  total: number;
  hasMore: boolean;
  /** Conteos sobre el filtro completo, para las tarjetas de la cabecera. */
  stats: {
    total: number;
    losses: number;
    damages: number;
    corrections: number;
  };
}

export interface AdjustmentSummary {
  type: string;
  totalQuantity: number;
  adjustmentCount: number;
}
