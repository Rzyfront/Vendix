/**
 * Contrato de la ficha de producto/receta.
 *
 * Se define por ESTRUCTURA, no por origen: cada módulo (recetas, fórmulas,
 * producción, KDS) mapea su respuesta a estas interfaces y reutiliza el mismo
 * componente. Así la ficha se ve idéntica en los cuatro sin acoplarla a ningún
 * endpoint concreto.
 */

export interface ProductProfileImage {
  id?: number;
  image_url: string;
  is_main?: boolean | null;
  alt_text?: string | null;
  sort_order?: number | null;
}

/** Producto tal como llega desde `products` (campos todos opcionales salvo id/name). */
export interface ProductProfileProduct {
  id: number;
  name: string;
  sku?: string | null;
  description?: string | null;
  base_price?: number | string | null;
  cost_price?: number | string | null;
  stock_unit?: string | null;
  preparation_time_minutes?: number | null;
  is_ingredient?: boolean | null;
  is_sellable?: boolean | null;
  product_images?: ProductProfileImage[] | null;
  /** Fallback cuando el backend ya entrega una sola URL resuelta. */
  image_url?: string | null;
}

/** Variante del producto de rendimiento (recetas por variante). */
export interface ProductProfileVariant {
  id?: number;
  name?: string | null;
  sku?: string | null;
  product_images?: { image_url: string } | null;
}

export interface ProductProfileIngredient {
  id?: number;
  name: string;
  sku?: string | null;
  quantity: number | string;
  stock_unit?: string | null;
  waste_percent?: number | string | null;
  /** Anotación por insumo ("picar fino", "sin cáscara"). */
  notes?: string | null;
  /** Producto componente completo, cuando el caller lo tiene. */
  product?: ProductProfileProduct | null;
  image_url?: string | null;
  product_images?: ProductProfileImage[] | null;
}

export interface ProductProfileRecipe {
  id?: number;
  yield_quantity: number | string;
  yield_unit: string;
  waste_percent?: number | string | null;
  preparation_notes?: string | null;
  is_active?: boolean;
  items: ProductProfileIngredient[];
}
