/**
 * Restaurant Suite — Phase B.
 * Source of truth for the Recipes / BOM domain in the frontend.
 *
 * Mirrors the Prisma models `recipes` and `recipe_items` plus the DTO
 * contracts exposed by `apps/backend/src/domains/store/recipes`.
 */

export interface Recipe {
  id: number;
  store_id: number;
  product_id: number;
  yield_quantity: number | string;
  yield_unit: string;
  waste_percent: number | string;
  preparation_notes?: string | null;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;

  // Populated by GET /store/recipes (list) and /store/recipes/:id (detail).
  product?: {
    id: number;
    name: string;
    sku?: string | null;
    base_price?: number | string | null;
    stock_unit?: string | null;
    is_ingredient?: boolean;
    is_sellable?: boolean;
    is_combo?: boolean;
    is_batch_produced?: boolean;
  };
  items?: RecipeItem[];
  _count?: { items: number };
}

export interface RecipeItem {
  id: number;
  recipe_id: number;
  component_product_id: number;
  quantity: number | string;
  waste_percent: number | string;
  is_optional: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  component_product?: {
    id: number;
    name: string;
    sku?: string | null;
    stock_unit?: string | null;
    is_ingredient?: boolean;
    is_sellable?: boolean;
    base_price?: number | string | null;
    cost_price?: number | string | null;
  };
}

export interface CreateRecipeDto {
  product_id: number;
  yield_quantity: number;
  yield_unit: string;
  waste_percent?: number;
  preparation_notes?: string;
  is_active?: boolean;
}

export type UpdateRecipeDto = Partial<CreateRecipeDto>;

export interface CreateRecipeItemDto {
  component_product_id: number;
  quantity: number;
  waste_percent?: number;
  is_optional?: boolean;
}

export type UpdateRecipeItemDto = Partial<CreateRecipeItemDto>;

export interface RecipeQuery {
  page?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
  product_id?: number;
}

/**
 * Compact shape of a product used by the recipe form to populate the
 * component selector. We deliberately only need a few fields; the list
 * endpoint is filtered server-side with `is_ingredient=true` to keep the
 * dropdown small.
 */
export interface RecipeIngredientOption {
  id: number;
  name: string;
  sku?: string | null;
  stock_unit?: string | null;
  base_price?: number | string | null;
  cost_price?: number | string | null;
  is_ingredient?: boolean;
}
