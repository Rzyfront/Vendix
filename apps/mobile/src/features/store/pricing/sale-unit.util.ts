/**
 * Presentaciones de venta ofrecibles por el POS móvil.
 *
 * Compone, en el cliente, la MISMA información que el backend resuelve al
 * persistir (`tier-snapshot.util.ts`) y que el web arma en
 * `pos-cart.service.ts` antes de llamar a `PriceResolverService.resolveWithTier`:
 *
 *   1. `product.enabled_price_tier_ids` — el allowlist duro del par
 *      (producto, presentación). El backend rechaza con `PRICE_TIER_NOT_ALLOWED`
 *      cualquier tarifa que no esté acá, así que el cliente NO puede ofrecer
 *      nada fuera de esta lista.
 *   2. El catálogo de la tienda `GET /store/price-tiers?kind=sale_unit`
 *      (id, nombre, `units_per_package`, `discount_percentage`).
 *   3. Los overrides del producto
 *      `GET /store/price-tiers/products/:id/overrides`
 *      (`override_price`, `override_units_per_package`).
 *
 * El precio que devuelve es SIEMPRE el del PAQUETE COMPLETO, porque así lo
 * interpreta el resto del stack: con presentación aplicada `quantity` cuenta
 * paquetes y `unit_price` es el precio del paquete.
 */

import { resolvePackSize } from './packaging.util';
import {
  resolvePriceUnitQuantity,
  resolveUnitPriceAtBase,
  roundMoney,
} from './price-unit.util';

/** Tarifa tal como llega de `GET /store/price-tiers`. */
export interface SaleUnitTierLike {
  id: number;
  name: string;
  kind?: 'customer_tier' | 'sale_unit' | string | null;
  is_active?: boolean;
  is_package_unit?: boolean | null;
  units_per_package?: number | null;
  discount_percentage?: number | string | null;
}

/** Fila de `product_price_tier_overrides` para un producto. */
export interface ProductTierOverrideLike {
  price_tier_id: number;
  variant_id?: number | null;
  override_price?: number | string | null;
  override_units_per_package?: number | null;
}

/** Producto mínimo que el resolutor necesita leer. */
export interface SaleUnitProductLike {
  base_price?: number | string | null;
  sale_price?: number | string | null;
  is_on_sale?: boolean | null;
  price_unit_quantity?: number | null;
  enabled_price_tier_ids?: number[] | null;
  has_multiple_price_tiers?: boolean | null;
}

/**
 * Una presentación lista para ofrecer en la UI y para agregar al carrito.
 *
 * `unitPrice` es el precio del paquete entero — el valor que viaja como
 * `unit_price` en la línea de venta. `packSize` son las unidades de stock que
 * consume UN paquete; el consumo real de la línea es `quantity × packSize` y lo
 * resuelve `resolveStockUnitsConsumed`.
 */
export interface SaleUnitPresentation {
  tierId: number;
  name: string;
  packSize: number;
  unitPrice: number;
  /** `true` cuando el precio vino de un `override_price` explícito. */
  hasExplicitPrice: boolean;
  isDefault: boolean;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Precio neto de UNA unidad de stock, según la cascada legacy del producto
 * (oferta → base) y descontando la escala `price_unit_quantity`.
 *
 * Espejo de `PriceResolverService.resolve` del web, reducido a la unidad
 * mínima: un producto que publica "$5.000 por metro" (`base_price = 5000`,
 * `price_unit_quantity = 1000`) vale $5 por milímetro. NO se redondea a
 * centavos a propósito — redondear acá es exactamente el bug que
 * `price_unit_quantity` vino a evitar.
 */
export function resolveNetUnitPriceAtStockUnit(
  product: SaleUnitProductLike,
): number {
  const base = toNumber(product.base_price);
  const sale = toNumber(product.sale_price);
  const net = product.is_on_sale && sale > 0 && sale < base ? sale : base;
  return resolveUnitPriceAtBase(net, product.price_unit_quantity);
}

/**
 * Precio del paquete completo de una presentación.
 *
 * - Con `override_price` explícito, ese ES el precio del paquete (gana sobre
 *   cualquier regla). Es el camino que escribe el flujo de compra
 *   (`resolveTierPricingCostAnchor`) y el editor de producto.
 * - Sin override, se aplica el `discount_percentage` de la tarifa sobre el
 *   precio del paquete derivado del precio base.
 *
 * ⚠️ Zona ambigua conocida: `PriceResolverService.resolveWithTier` del web
 * calcula `packageBase = base_price × packSize` SIN dividir por
 * `price_unit_quantity`. Con escala 1 —todo el catálogo histórico— esa fórmula
 * y la de acá dan el MISMO número. Con escala > 1 difieren por N, y no hay una
 * fuente de verdad que arbitre: el backend nunca recalcula el precio de una
 * presentación sin override. Por eso una presentación sin `override_price`
 * sobre un producto con escala se declara AMBIGUA y no se ofrece
 * (`resolveSaleUnitPresentations` la descarta) en vez de cobrar un número que
 * el web no cobraría.
 */
export function resolvePresentationPrice(
  product: SaleUnitProductLike,
  packSize: number,
  overridePrice?: number | string | null,
  discountPercentage?: number | string | null,
): { unitPrice: number; hasExplicitPrice: boolean; ambiguous: boolean } {
  const explicit = toNumber(overridePrice, 0);
  if (overridePrice != null && explicit > 0) {
    return {
      unitPrice: roundMoney(explicit),
      hasExplicitPrice: true,
      ambiguous: false,
    };
  }

  const perStockUnit = resolveNetUnitPriceAtStockUnit(product);
  const packageBase = perStockUnit * (packSize > 1 ? packSize : 1);
  const discount = Math.max(0, Math.min(100, toNumber(discountPercentage, 0)));
  return {
    unitPrice: roundMoney(packageBase * (1 - discount / 100)),
    hasExplicitPrice: false,
    ambiguous: resolvePriceUnitQuantity(product.price_unit_quantity) > 1,
  };
}

/**
 * Presentaciones que el POS puede ofrecer para un producto.
 *
 * Devuelve `[]` cuando el producto no tiene allowlist — un producto sin
 * presentaciones se vende exactamente como hoy y ninguna UI cambia.
 *
 * `defaultTierId` marca la presentación por defecto
 * (`product_price_tier_assignments.is_default`). El backend no la expone todavía
 * en el listado de productos; mientras tanto el caller puede pasarla cuando la
 * conozca (p. ej. la que devuelve un escaneo de código de barras).
 */
export function resolveSaleUnitPresentations(
  product: SaleUnitProductLike,
  tiers: SaleUnitTierLike[],
  overrides: ProductTierOverrideLike[] = [],
  defaultTierId?: number | null,
): SaleUnitPresentation[] {
  const allowed = new Set(
    (product.enabled_price_tier_ids ?? []).map((id) => Number(id)),
  );
  if (allowed.size === 0) return [];

  const out: SaleUnitPresentation[] = [];
  for (const tier of tiers) {
    const tierId = Number(tier.id);
    if (!allowed.has(tierId)) continue;
    if (tier.is_active === false) continue;
    // El eje "en qué presentación vendo" es `sale_unit`. Una `customer_tier`
    // ("a quién le vendo") no se ofrece como presentación: mezclarlas es
    // justamente lo que el discriminador `kind` vino a impedir. Un `kind`
    // ausente se trata como presentación solo si trae empaque propio, para no
    // perder tarifas de backends que todavía no exponen el campo.
    const override = overrides.find(
      (o) =>
        Number(o.price_tier_id) === tierId &&
        (o.variant_id === null || o.variant_id === undefined),
    );
    const packSize = resolvePackSize(
      tier.units_per_package,
      override?.override_units_per_package,
    );
    if (tier.kind != null && tier.kind !== 'sale_unit') continue;
    if (tier.kind == null && packSize <= 1) continue;

    const { unitPrice, hasExplicitPrice, ambiguous } = resolvePresentationPrice(
      product,
      packSize,
      override?.override_price,
      tier.discount_percentage,
    );
    // Una presentación cuyo precio los dos clientes resolverían distinto no se
    // ofrece: cobrar distinto que el web es un defecto de integridad, no una
    // funcionalidad de más. Se destraba poniéndole precio explícito a la
    // presentación (`override_price`), que es lo que hace el flujo de compra.
    if (ambiguous) continue;

    out.push({
      tierId,
      name: tier.name,
      packSize,
      unitPrice,
      hasExplicitPrice,
      isDefault: defaultTierId != null && Number(defaultTierId) === tierId,
    });
  }

  return out.sort((a, b) => a.packSize - b.packSize || a.tierId - b.tierId);
}
