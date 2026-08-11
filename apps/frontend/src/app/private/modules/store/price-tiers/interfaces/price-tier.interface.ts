/**
 * Price tier (multi-tarifa) domain interfaces shared across:
 *  - Phase 3 admin module (Precios y Tarifas list/form)
 *  - Phase 4 product form (per-product overrides)
 *  - Phase 5 POS/orders/quotations (line-level tier selection)
 *
 * IMPORTANT: This file is the SOURCE OF TRUTH for tier-related types.
 * Phase 3 must reuse these — do not duplicate.
 */

/**
 * A store-scoped price tier (e.g. "Retail", "Wholesale", "Distributor").
 * `discount_percentage` applies over `base_price` when no per-product override
 * exists. `is_package_unit` flags package/bulk tiers; `units_per_package`
 * carries how many stock units a package consumes (packaging cascade), with an
 * optional per-product/per-variant `override_units_per_package`.
 */
/**
 * Los dos ejes que conviven sobre `price_tiers`:
 *  - `customer_tier`: a QUIÉN le vendo (mayorista, minorista, distribuidor).
 *  - `sale_unit`: EN QUÉ PRESENTACIÓN vendo (rollo, metro, bulto, kilo).
 *
 * Los selectores filtran por este campo para no mezclarlos: el selector de
 * tarifa del POS pide `customer_tier`, el editor de presentaciones `sale_unit`.
 */
export type PriceTierKind = 'customer_tier' | 'sale_unit';

export interface PriceTier {
  id: number;
  store_id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  discount_percentage?: number | null;
  kind: PriceTierKind;
  is_active: boolean;
  /** Tarifa por defecto de la TIENDA. No confundir con la presentación por
   * defecto del PRODUCTO, que vive en el override
   * (`ProductPriceTierOverride.is_default`). */
  is_default: boolean;
  is_package_unit: boolean;
  /**
   * Units per package for this tier (packaging cascade source). Packaging now
   * lives on the tier (with an optional per-product/per-variant override),
   * not on the product. See packaging.util.ts.
   */
  units_per_package?: number | null;
  sort_order: number;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at?: string | Date | null;
}

/**
 * Per-product (or per-variant) price override for a given tier.
 * If `variant_id` is null/undefined, the override applies to the base product.
 */
export interface ProductPriceTierOverride {
  id: number;
  product_id: number;
  variant_id?: number | null;
  price_tier_id: number;
  /**
   * Whole-package override price. `null` => use the tier discount rule.
   * When set (`> 0`) it is the price of the ENTIRE package.
   */
  override_price: number | null;
  /** Per-product/per-variant override of units-per-package (packaging cascade). */
  override_units_per_package?: number | null;
  /**
   * Margen de la presentación (markup sobre el costo del PAQUETE). Lo deriva el
   * backend a partir del precio con criterio cost-anchor; el editor lo muestra
   * pero no es la fuente de verdad.
   */
  override_profit_margin?: number | null;
  /**
   * Presentación por defecto del PRODUCTO: la que rige en toda superficie de
   * venta. Se persiste en `product_price_tier_assignments` y el backend la
   * proyecta en esta lectura para que el editor lea una sola forma por fila.
   */
  is_default?: boolean;
  /**
   * Código de barras de la PRESENTACIÓN (QUI-648 fase 2). Identifica el par
   * (producto, presentación), no el producto: la "Caja x12" de dos productos
   * distintos no comparte código. Se persiste en
   * `product_price_tier_assignments.barcode` con unicidad por tienda.
   *
   * OJO — hoy `GET /store/price-tiers/products/:id/overrides` NO lo proyecta
   * (el backend solo selecciona `price_tier_id` e `is_default` del assignment),
   * así que en la práctica llega `undefined` y el editor arranca vacío. El
   * campo queda declarado para cuando la lectura lo exponga.
   */
  barcode?: string | null;
  created_at: string | Date;
  updated_at: string | Date;

  // Optional relation (populated by GET /products/:id/overrides)
  price_tier?: PriceTier;
}

export interface CreatePriceTierDto {
  name: string;
  code?: string;
  description?: string;
  discount_percentage?: number;
  /** Omitirlo equivale a `customer_tier` (default del backend). */
  kind?: PriceTierKind;
  is_active?: boolean;
  is_default?: boolean;
  is_package_unit?: boolean;
  /**
   * Units per package carried by this tier (packaging cascade). `null` is
   * accepted on update to explicitly clear packaging (back to single-unit).
   */
  units_per_package?: number | null;
  sort_order?: number;
}

export type UpdatePriceTierDto = Partial<CreatePriceTierDto>;

export interface PriceTierQuery {
  page?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
  /** Filtra por eje. Sin él vienen los dos, que es lo que quiere la lista de
   * administración; los selectores siempre lo pasan. */
  kind?: PriceTierKind;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface UpsertProductPriceTierOverrideDto {
  /** Omit/undefined => override applies to base product. */
  variant_id?: number;
  /**
   * Whole-package override price. Optional — omit to use the tier discount
   * rule while still overriding units-per-package.
   */
  override_price?: number;
  /** Per-product/per-variant override of units-per-package (packaging cascade). */
  override_units_per_package?: number;
  /**
   * Margen explícito. Normalmente se omite: el editor deriva el precio del
   * margen y el backend recalcula el margen desde ese precio (cost-anchor), así
   * que enviar ambos es redundante y el precio siempre gana.
   */
  override_profit_margin?: number;
  /** Marca esta presentación como la que rige por defecto en el producto. */
  is_default?: boolean;
  /**
   * Código de barras de la presentación (máx. 64). Omitirlo deja el código como
   * está; la cadena vacía `''` lo BORRA (el backend la normaliza a `NULL`).
   * Un choque devuelve 409 con `error_code: 'PROD_BARCODE_DUP_001'`.
   */
  barcode?: string;
}
