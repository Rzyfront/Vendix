import {
  baseUnitCodeFor,
  integerRatio,
  isMeasurableDimension,
  pricingTypeFor,
  UomViolation,
  validateProductUoms,
} from '@money-kernel/uom-conversion';
import {
  UnitOfMeasure,
  UOM_DIMENSION_LABELS,
  UomDimension,
} from '../../inventory/services/uom.service';

/**
 * Sección única "Unidad de venta" del editor de producto
 * (feature `product-sale-unit-consolidation`, S2-S7, S10, D1-D3).
 *
 * Puro: sin Angular. Traduce entre lo que el dueño elige (una unidad
 * principal + unidades adicionales) y los campos que la API recibe
 * (`pricing_type`, `stock_uom_id`, `purchase_uom_id`, `sale_uoms`,
 * `price_unit_quantity`). Toda la aritmética de unidades sale del núcleo
 * `@money-kernel/uom-conversion`, el mismo que usa el backend.
 */

/** Pieza / unidad: producto simple, sin unidades de medida. */
export const PIECE = 'piece' as const;
export type SaleUnitPrincipal = number | typeof PIECE;

export interface SaleUnitFormState {
  /** Unidad principal (el precio se expresa en ella) o `'piece'`. */
  principalUomId: SaleUnitPrincipal;
  /** Otras unidades de venta, sin la principal. */
  additionalUomIds: number[];
  /** Unidad de inventario DERIVADA (D1); `null` en producto por pieza. */
  stockUomId: number | null;
  /** Cambio manual de la unidad de inventario (Avanzado); `null` = derivada. */
  stockOverrideUomId: number | null;
  purchaseUomId: number | null;
  /** Producto sin `sale_uoms` (flujo legado, S6). */
  legacy: boolean;
}

/** Lo mínimo del producto que la sección lee. */
export interface SaleUnitProductLike {
  pricing_type?: string | null;
  stock_uom_id?: number | null;
  purchase_uom_id?: number | null;
  price_unit_quantity?: number | string | null;
  sale_uoms?: ReadonlyArray<{
    uom_id: number | string;
    is_principal?: boolean;
  }> | null;
}

export interface SaleUnitPayload {
  pricing_type: 'unit' | 'weight';
  stock_uom_id: number | null;
  purchase_uom_id: number | null;
  sale_uoms: Array<{ uom_id: number; is_principal?: boolean }>;
  price_unit_quantity: number;
}

function activeUnits(catalog: readonly UnitOfMeasure[]): UnitOfMeasure[] {
  return catalog.filter((u) => u.is_active !== false);
}

function byId(
  catalog: readonly UnitOfMeasure[],
  id: number | null | undefined,
): UnitOfMeasure | null {
  if (id == null) return null;
  return catalog.find((u) => Number(u.id) === Number(id)) ?? null;
}

function factor(u: UnitOfMeasure): number {
  return Number(u.factor_to_base);
}

/** Unidad base de una dimensión (g, ml, mm, unit). */
export function baseUnitFor(
  dimension: string,
  catalog: readonly UnitOfMeasure[],
): UnitOfMeasure | null {
  const code = baseUnitCodeFor(dimension);
  return (
    catalog.find((u) => u.dimension === dimension && u.code === code) ??
    catalog.find((u) => u.dimension === dimension && u.is_base) ??
    null
  );
}

/** `true` si la unidad es el conteo base (`unit`): equivale a "Pieza". */
function isCountBase(u: UnitOfMeasure): boolean {
  return u.dimension === 'count' && factor(u) === 1;
}

/** Normaliza: el conteo base se muestra y guarda como "Pieza". */
function normalizePrincipal(
  u: UnitOfMeasure | null,
): SaleUnitPrincipal {
  return u == null || isCountBase(u) ? PIECE : Number(u.id);
}

function principalUnit(
  state: SaleUnitFormState,
  catalog: readonly UnitOfMeasure[],
): UnitOfMeasure | null {
  return state.principalUomId === PIECE
    ? null
    : byId(catalog, state.principalUomId);
}

/**
 * Unidad de inventario derivada (D1): la base de la dimensión de la principal
 * (g, ml, mm, unit). `null` para "Pieza".
 */
export function deriveStockUom(
  principalUomId: SaleUnitPrincipal,
  catalog: readonly UnitOfMeasure[],
): UnitOfMeasure | null {
  if (principalUomId === PIECE) return null;
  const principal = byId(catalog, principalUomId);
  return principal ? baseUnitFor(principal.dimension, catalog) : null;
}

/** Unidad de inventario efectiva del estado (la manual si es válida, si no la derivada). */
export function stockUomOf(
  state: SaleUnitFormState,
  catalog: readonly UnitOfMeasure[],
): UnitOfMeasure | null {
  if (state.principalUomId === PIECE) return null;
  return (
    byId(catalog, state.stockOverrideUomId) ??
    deriveStockUom(state.principalUomId, catalog)
  );
}

function withDerivedStock(
  state: Omit<SaleUnitFormState, 'stockUomId'>,
  catalog: readonly UnitOfMeasure[],
): SaleUnitFormState {
  const full = { ...state, stockUomId: null } as SaleUnitFormState;
  return { ...full, stockUomId: stockUomOf(full, catalog)?.id ?? null };
}

/** Estado inicial de un producto nuevo: por pieza. */
export function emptySaleUnitState(): SaleUnitFormState {
  return {
    principalUomId: PIECE,
    additionalUomIds: [],
    stockUomId: null,
    stockOverrideUomId: null,
    purchaseUomId: null,
    legacy: false,
  };
}

/**
 * Unidad de inventario guardada cuando difiere de la derivada: se conserva
 * para mostrar la verdad (y sus violaciones) en vez de esconderla.
 */
function persistedStockOverride(
  principalUomId: SaleUnitPrincipal,
  stockUomId: number | string | null | undefined,
  catalog: readonly UnitOfMeasure[],
): number | null {
  if (principalUomId === PIECE) return null;
  const persisted = byId(catalog, stockUomId != null ? Number(stockUomId) : null);
  const derived = deriveStockUom(principalUomId, catalog);
  return persisted && derived && Number(persisted.id) !== Number(derived.id)
    ? Number(persisted.id)
    : null;
}

/**
 * Lee la sección desde el producto guardado. Los productos legados (sin
 * `sale_uoms`) se MUESTRAN con su unidad equivalente sin reescribirse (S6).
 */
export function fromProduct(
  product: SaleUnitProductLike | null | undefined,
  catalog: readonly UnitOfMeasure[],
): SaleUnitFormState {
  if (!product) return emptySaleUnitState();
  const purchaseUomId =
    product.purchase_uom_id != null ? Number(product.purchase_uom_id) : null;
  const saleUoms = (product.sale_uoms ?? []).map((row) => ({
    uom_id: Number(row.uom_id),
    is_principal: row.is_principal === true,
  }));

  if (saleUoms.length > 0) {
    const principalRow =
      saleUoms.find((row) => row.is_principal) ?? saleUoms[0];
    const principal = byId(catalog, principalRow.uom_id);
    const principalId = normalizePrincipal(principal);
    return withDerivedStock(
      {
        principalUomId: principalId,
        additionalUomIds: saleUoms
          .map((row) => row.uom_id)
          .filter((id) => id !== principalRow.uom_id),
        stockOverrideUomId: persistedStockOverride(
          principalId,
          product.stock_uom_id,
          catalog,
        ),
        purchaseUomId,
        legacy: false,
      },
      catalog,
    );
  }

  // Legado: sin `sale_uoms`.
  const stock = byId(catalog, product.stock_uom_id);
  let principal: UnitOfMeasure | null = null;
  if (product.pricing_type === 'weight') {
    principal =
      catalog.find((u) => u.code === 'kg') ??
      catalog.find((u) => u.dimension === 'mass' && factor(u) === 1000) ??
      stock;
  } else if (stock) {
    const scale = Number(product.price_unit_quantity ?? 1) || 1;
    principal =
      scale > 1
        ? (catalog.find(
            (u) =>
              u.dimension === stock.dimension && integerRatio(u, stock) === scale,
          ) ?? stock)
        : stock;
  }
  const legacyPrincipal = normalizePrincipal(principal);
  return withDerivedStock(
    {
      principalUomId: legacyPrincipal,
      additionalUomIds: [],
      stockOverrideUomId: persistedStockOverride(
        legacyPrincipal,
        product.stock_uom_id,
        catalog,
      ),
      purchaseUomId,
      legacy: true,
    },
    catalog,
  );
}

/**
 * Valores que se envían a la API. Sin tocar la sección, el producto vuelve
 * tal cual estaba (D3/S6: no se reescribe, ni los legados ni los ya
 * configurados).
 */
export function toPayload(
  state: SaleUnitFormState,
  catalog: readonly UnitOfMeasure[],
  touched: boolean,
  original?: SaleUnitProductLike | null,
): SaleUnitPayload {
  if (!touched && original) {
    return {
      pricing_type: original.pricing_type === 'weight' ? 'weight' : 'unit',
      stock_uom_id:
        original.stock_uom_id != null ? Number(original.stock_uom_id) : null,
      purchase_uom_id:
        original.purchase_uom_id != null
          ? Number(original.purchase_uom_id)
          : null,
      sale_uoms: (original.sale_uoms ?? []).map((row) => ({
        uom_id: Number(row.uom_id),
        ...(row.is_principal === true ? { is_principal: true } : {}),
      })),
      price_unit_quantity: Number(original.price_unit_quantity ?? 1) || 1,
    };
  }

  const principal = principalUnit(state, catalog);
  const stock = stockUomOf(state, catalog);
  if (!principal || !stock) {
    // Pieza (o unidad principal desconocida): producto simple.
    return {
      pricing_type: 'unit',
      stock_uom_id: null,
      purchase_uom_id: null,
      sale_uoms: [],
      price_unit_quantity: 1,
    };
  }

  const additional = state.additionalUomIds.filter(
    (id) => id !== Number(principal.id),
  );
  return {
    pricing_type: pricingTypeFor(principal),
    stock_uom_id: Number(stock.id),
    purchase_uom_id: state.purchaseUomId,
    sale_uoms: [
      { uom_id: Number(principal.id), is_principal: true },
      ...additional.map((uom_id) => ({ uom_id })),
    ],
    price_unit_quantity: integerRatio(principal, stock) ?? 1,
  };
}

/**
 * Unidades que se pueden ofrecer como adicionales (S3, S10): misma dimensión
 * que la principal, activas, múltiplo entero de la unidad de inventario, sin
 * la principal. Mayores y menores que la principal; de menor a mayor.
 */
export function compatibleAdditionalUnits(
  principalUomId: SaleUnitPrincipal,
  catalog: readonly UnitOfMeasure[],
  stockOverrideUomId: number | null = null,
): UnitOfMeasure[] {
  const principal =
    principalUomId === PIECE ? null : byId(catalog, principalUomId);
  if (!principal) return [];
  const stock =
    byId(catalog, stockOverrideUomId) ?? deriveStockUom(principalUomId, catalog);
  if (!stock) return [];
  return activeUnits(catalog)
    .filter(
      (u) =>
        Number(u.id) !== Number(principal.id) &&
        u.dimension === principal.dimension &&
        integerRatio(u, stock) != null,
    )
    .sort((a, b) => factor(a) - factor(b));
}

/** Unidades de compra ofrecidas: misma dimensión que el inventario y no menores. */
export function compatiblePurchaseUnits(
  stock: UnitOfMeasure | null,
  catalog: readonly UnitOfMeasure[],
): UnitOfMeasure[] {
  if (!stock) return [];
  return activeUnits(catalog)
    .filter((u) => u.dimension === stock.dimension && factor(u) >= factor(stock))
    .sort((a, b) => factor(a) - factor(b));
}

export interface PrincipalOptionGroup {
  label: string;
  options: Array<{
    value: number;
    label: string;
    /** `false` si la unidad no puede ser principal (equivalencia no entera). */
    eligible: boolean;
  }>;
}

/**
 * Opciones del selector "Unidad de venta": todas las unidades activas
 * agrupadas por dimensión (el conteo base es "Pieza", que va aparte).
 */
export function principalOptionGroups(
  catalog: readonly UnitOfMeasure[],
): PrincipalOptionGroup[] {
  const order: UomDimension[] = ['mass', 'volume', 'length', 'count'];
  const groups: PrincipalOptionGroup[] = [];
  for (const dimension of order) {
    const units = activeUnits(catalog)
      .filter((u) => u.dimension === dimension && !isCountBase(u))
      .sort((a, b) => factor(a) - factor(b));
    if (units.length === 0) continue;
    const base = baseUnitFor(dimension, catalog);
    groups.push({
      label: UOM_DIMENSION_LABELS[dimension],
      options: units.map((u) => ({
        value: Number(u.id),
        label: `${u.name} (${u.code})`,
        eligible:
          u.is_stock_eligible !== false &&
          (base == null || integerRatio(u, base) != null),
      })),
    });
  }
  return groups;
}

/** Combinaciones imposibles del estado, con el mensaje del núcleo. */
export function violations(
  state: SaleUnitFormState,
  catalog: readonly UnitOfMeasure[],
): UomViolation[] {
  const principal = principalUnit(state, catalog);
  const stock = stockUomOf(state, catalog);
  return validateProductUoms({
    stock,
    principal,
    additional: state.additionalUomIds
      .map((id) => byId(catalog, id))
      .filter((u): u is UnitOfMeasure => u != null),
    purchase: stock ? byId(catalog, state.purchaseUomId) : null,
    pricing_type: principal ? pricingTypeFor(principal) : null,
  });
}

/** Unidades de inventario que dejan `violations` vacía (Avanzado). */
export function inventoryCandidates(
  state: SaleUnitFormState,
  catalog: readonly UnitOfMeasure[],
): UnitOfMeasure[] {
  if (state.principalUomId === PIECE) return [];
  return activeUnits(catalog).filter(
    (u) =>
      u.is_stock_eligible !== false &&
      violations({ ...state, stockOverrideUomId: Number(u.id) }, catalog)
        .length === 0,
  );
}

function defaultMoney(value: number): string {
  return `$${value.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/**
 * Resumen de una línea (S4, S7):
 * "Se vende por kg a $24.000 · también en g y lb · el inventario se cuenta en g".
 */
export function summaryText(
  state: SaleUnitFormState,
  price: number | null | undefined,
  catalog: readonly UnitOfMeasure[],
  formatMoney: (value: number) => string = defaultMoney,
): string {
  const principal = principalUnit(state, catalog);
  const priceText =
    price != null && Number.isFinite(Number(price)) && Number(price) > 0
      ? ` a ${formatMoney(Number(price))}`
      : '';
  if (!principal) return `Se vende por pieza${priceText}`;

  const parts = [`Se vende por ${principal.code}${priceText}`];
  const extra = state.additionalUomIds
    .map((id) => byId(catalog, id))
    .filter((u): u is UnitOfMeasure => u != null)
    .sort((a, b) => factor(a) - factor(b))
    .map((u) => u.code);
  if (extra.length > 0) parts.push(`también en ${joinList(extra)}`);
  const stock = stockUomOf(state, catalog);
  if (stock) parts.push(`el inventario se cuenta en ${stock.code}`);
  return parts.join(' · ');
}

/** `true` si la principal es de masa (kg, g, lb...): aplica el código de balanza (S12). */
export function isMassPrincipal(
  state: SaleUnitFormState,
  catalog: readonly UnitOfMeasure[],
): boolean {
  const principal = principalUnit(state, catalog);
  return principal != null && pricingTypeFor(principal) === 'weight';
}

/** `true` si la principal admite fracciones (masa, volumen, longitud). */
export function isFractionalPrincipal(
  state: SaleUnitFormState,
  catalog: readonly UnitOfMeasure[],
): boolean {
  const principal = principalUnit(state, catalog);
  return principal != null && isMeasurableDimension(principal.dimension);
}
