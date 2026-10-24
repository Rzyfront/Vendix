/** Contrato HTTP de asignación masiva de productos a una categoría o marca. */

export type ProductAssignmentAction = 'add' | 'remove';

/** Máximo de ids por llamada que acepta el backend. */
export const MAX_ASSIGN_PRODUCT_IDS = 100;

export interface ProductAssignmentIds {
  product_ids: number[];
  total: number;
}

export interface AssignProductsResult {
  added: number;
  removed: number;
  unchanged: number;
}

export interface BrandMoveGroup {
  brand_id: number;
  brand_name: string;
  count: number;
}

export interface BrandAssignProductsResult extends AssignProductsResult {
  moved_from_brands?: BrandMoveGroup[];
}

export interface BrandAssignPreviewGroup extends BrandMoveGroup {
  product_ids: number[];
}

export interface BrandAssignPreview {
  already_in_brand: number;
  without_brand: number;
  to_move: BrandAssignPreviewGroup[];
}
