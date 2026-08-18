/**
 * Presentaciones de venta EN LA VITRINA PÚBLICA.
 *
 * Hermano deliberado de `tier-snapshot.util.ts`: quien audite *"¿quién puede
 * fijar el precio de una línea?"* encuentra las dos puertas en el mismo
 * directorio, una al lado de la otra.
 *
 * ## Por qué no se reutiliza `resolveTierSnapshotsForItems`
 *
 * Esa función es la puerta del OPERADOR (orders, quotations, POS) y valida lo
 * contrario que esta:
 *
 * | | operador (`tier-snapshot`) | comprador (este archivo) |
 * |---|---|---|
 * | Permiso | exige `store:products:apply_pricing_tier` | el comprador entra por `@OptionalAuth` con `permissions` vacío: nunca lo tendrá |
 * | `kind` | acepta cualquiera, **incluido `customer_tier`** | **rechaza** todo lo que no sea `sale_unit` |
 * | Consentimiento del comercio | no aplica | exige el flag `catalog.enable_sale_unit_selector` |
 *
 * Meterlas en una sola función con un parámetro `mode` dejaría una firma con
 * dos posturas de seguridad opuestas, donde cada columna nueva cae en la rama
 * equivocada por defecto — exactamente el fallo que el docblock de
 * `tier-snapshot.util.ts` documenta ("tres copias que ya habían divergido").
 * Relajar el gate de allá tampoco sirve: ese gate lo comparte el camino del
 * operador, y `orders.create` acepta `applied_price_tier_id`.
 *
 * ## Aislamiento de tenant
 *
 * `product_price_tier_assignments` **no tiene FK que ate `price_tier.store_id`
 * a `product.store_id`**. Una fila que apunte a una tarifa de otra tienda es
 * representable en la base. Por eso el filtro `price_tier.store_id` de estas
 * consultas es la única defensa dura, y no se puede omitir "porque el producto
 * ya viene scopeado".
 *
 * Se resuelve por la relación anidada a propósito: `EcommercePrismaService` no
 * expone `price_tiers`, y registrar el modelo en ese scope solo para leer aquí
 * sería justo la clase de cambio que rompe el aislamiento por descuido.
 *
 * ## Forma del resultado
 *
 * Devuelve el mismo `DefaultSaleUnit` que exporta `default-sale-unit.util.ts`,
 * para que `StorefrontPriceService.resolveLine` reciba una sola forma venga la
 * presentación de la elección del comprador o del default de la tienda.
 *
 * El array está **alineado por índice** con `items`. Nunca un `Map` por
 * `product_id`: con selector, "2 bultos + 3 kilos del mismo producto" son dos
 * líneas legítimas, y un mapa por producto las colapsaría en una — el fallo no
 * se manifiesta como error sino como reserva de inventario silenciosamente
 * incorrecta.
 */
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import type { DefaultSaleUnit } from './default-sale-unit.util';

type PublicSaleUnitClient = {
  product_price_tier_assignments: { findMany: (args: any) => Promise<any[]> };
  product_price_tier_overrides: { findMany: (args: any) => Promise<any[]> };
};

/** Cliente del fallback de unidad suelta: además necesita leer el producto. */
type LooseUnitFallbackClient = PublicSaleUnitClient & {
  products: { findMany: (args: any) => Promise<any[]> };
};

export type PublicSaleUnitItem = {
  product_id?: number | null;
  price_tier_id?: number | null;
};

export type PublicSaleUnitContext = {
  storeId: number;
  /** Valor del flag `ecommerce.catalog.enable_sale_unit_selector`. */
  selectionEnabled: boolean;
};

const TIER_SELECT = {
  id: true,
  name: true,
  discount_percentage: true,
  is_package_unit: true,
  units_per_package: true,
} as const;

const OVERRIDE_SELECT = {
  product_id: true,
  price_tier_id: true,
  variant_id: true,
  override_price: true,
  override_units_per_package: true,
} as const;

type OverrideRow = {
  product_id: number;
  price_tier_id: number;
  variant_id: number | null;
  override_price: unknown;
  override_units_per_package: number | null;
};

const mapOverrides = (
  overrides: OverrideRow[],
  productId: number,
  tierId: number,
): DefaultSaleUnit['overrides'] =>
  overrides
    .filter((o) => o.product_id === productId && o.price_tier_id === tierId)
    .map((o) => ({
      variant_id: o.variant_id ?? null,
      override_price: o.override_price != null ? Number(o.override_price) : null,
      override_units_per_package: o.override_units_per_package ?? null,
    }));

const toSaleUnit = (
  tier: {
    id: number;
    name: string;
    discount_percentage: unknown;
    is_package_unit: boolean | null;
    units_per_package: number | null;
  },
  overrides: DefaultSaleUnit['overrides'],
): DefaultSaleUnit => ({
  tier: {
    id: tier.id,
    name: tier.name,
    discount_percentage: Number(tier.discount_percentage ?? 0),
    is_package_unit: !!tier.is_package_unit,
    units_per_package: tier.units_per_package ?? null,
  },
  overrides,
});

/**
 * Autoriza y resuelve la presentación que el comprador eligió, línea por línea.
 *
 * - Ninguna línea trae `price_tier_id` ⇒ array de `null` sin tocar la base. El
 *   caller conserva la cascada de siempre: default de la tienda o precio base.
 *   Esto hace la feature no-regresiva por construcción.
 * - Alguna la trae y el flag está apagado ⇒ `ECOM_SALE_UNIT_001` (422). El flag
 *   gatea lectura **y** escritura: si solo gateara el display, un `curl` con
 *   `price_tier_id` vendería en una presentación que la tienda nunca publicó.
 * - Tarifa inexistente, inactiva, de otra tienda, con `kind != 'sale_unit'`, o
 *   no asignada a ese producto ⇒ `PRICE_TIER_NOT_ALLOWED` (422). Un solo código
 *   para los cinco casos: distinguirlos le diría a un atacante qué tarifas
 *   existen en otras tiendas.
 *
 * Dos consultas, no tres: el allowlist y los datos de la tarifa salen juntos de
 * `product_price_tier_assignments` con la relación anidada.
 */
export async function resolvePublicSaleUnitSelections(
  client: PublicSaleUnitClient,
  items: PublicSaleUnitItem[],
  ctx: PublicSaleUnitContext,
): Promise<Array<DefaultSaleUnit | null>> {
  const requested = items.filter(
    (i) => i.price_tier_id !== undefined && i.price_tier_id !== null,
  );
  if (requested.length === 0) return items.map(() => null);

  if (!ctx.selectionEnabled) {
    throw new VendixHttpException(ErrorCodes.ECOM_SALE_UNIT_001);
  }

  const tierIds = Array.from(
    new Set(requested.map((i) => Number(i.price_tier_id))),
  );
  const productIds = Array.from(
    new Set(
      requested
        .map((i) => i.product_id)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    ),
  );
  if (productIds.length === 0) {
    throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
  }

  const assignments = await client.product_price_tier_assignments.findMany({
    where: {
      product_id: { in: productIds },
      price_tier_id: { in: tierIds },
      // Las tres condiciones del `price_tier` son la puerta: `store_id` aísla
      // el tenant (no hay FK que lo garantice), `kind` deja fuera las tarifas
      // de cliente, `is_active` respeta la baja comercial.
      price_tier: {
        store_id: ctx.storeId,
        kind: 'sale_unit',
        is_active: true,
      },
    },
    select: {
      product_id: true,
      price_tier_id: true,
      price_tier: { select: TIER_SELECT },
    },
  });

  const allowed = new Map<string, (typeof assignments)[number]>();
  for (const a of assignments) {
    allowed.set(`${a.product_id}:${a.price_tier_id}`, a);
  }

  const overrides = (await client.product_price_tier_overrides.findMany({
    where: { product_id: { in: productIds }, price_tier_id: { in: tierIds } },
    select: OVERRIDE_SELECT,
  })) as OverrideRow[];

  return items.map((item) => {
    const tierId = item.price_tier_id;
    if (tierId === undefined || tierId === null) return null;
    const productId = item.product_id;
    const assignment = productId
      ? allowed.get(`${productId}:${Number(tierId)}`)
      : undefined;
    if (!assignment?.price_tier) {
      throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
    }
    return toSaleUnit(
      assignment.price_tier,
      mapOverrides(overrides, productId as number, Number(tierId)),
    );
  });
}

/**
 * Todas las presentaciones publicables de un lote de productos, para alimentar
 * el selector del catálogo.
 *
 * Mismo filtro de tenant/kind/actividad que la puerta de escritura: la vitrina
 * no puede ofrecer una opción que el carrito luego rechazaría. Devuelve un
 * `Map<product_id, DefaultSaleUnit[]>` — aquí el mapa por producto sí es
 * correcto, porque es una LECTURA de catálogo (un producto, N opciones), no una
 * resolución de líneas de venta.
 *
 * `is_default` viaja aparte, en el `Set` que devuelve el segundo campo, porque
 * `DefaultSaleUnit` no tiene dónde alojarlo y añadírselo obligaría a tocar el
 * tipo que comparten todos los callers.
 */
export async function listPublicSaleUnitsForProducts(
  client: PublicSaleUnitClient,
  productIds: number[],
  storeId: number,
): Promise<{
  byProduct: Map<number, DefaultSaleUnit[]>;
  defaultTierByProduct: Map<number, number>;
}> {
  const byProduct = new Map<number, DefaultSaleUnit[]>();
  const defaultTierByProduct = new Map<number, number>();
  const ids = Array.from(
    new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (ids.length === 0) return { byProduct, defaultTierByProduct };

  const assignments = await client.product_price_tier_assignments.findMany({
    where: {
      product_id: { in: ids },
      price_tier: { store_id: storeId, kind: 'sale_unit', is_active: true },
    },
    select: {
      product_id: true,
      price_tier_id: true,
      is_default: true,
      price_tier: { select: TIER_SELECT },
    },
    orderBy: [{ price_tier: { sort_order: 'asc' } }, { price_tier_id: 'asc' }],
  });
  if (assignments.length === 0) return { byProduct, defaultTierByProduct };

  const tierIds = Array.from(
    new Set(assignments.map((a) => a.price_tier_id as number)),
  );
  const overrides = (await client.product_price_tier_overrides.findMany({
    where: { product_id: { in: ids }, price_tier_id: { in: tierIds } },
    select: OVERRIDE_SELECT,
  })) as OverrideRow[];

  for (const a of assignments) {
    if (!a.price_tier) continue;
    const list = byProduct.get(a.product_id) ?? [];
    list.push(
      toSaleUnit(
        a.price_tier,
        mapOverrides(overrides, a.product_id, a.price_tier_id),
      ),
    );
    byProduct.set(a.product_id, list);
    if (a.is_default) defaultTierByProduct.set(a.product_id, a.price_tier_id);
  }

  return { byProduct, defaultTierByProduct };
}

/**
 * Presentación que rige cuando el producto NO ofrece su unidad suelta.
 *
 * `products.offer_loose_unit = false` es el comercio diciendo "esto no se vende
 * por unidad". La vitrina deja de ofrecer el chip, pero eso solo cierra la
 * puerta que se ve: una línea sin `price_tier_id` —un cliente viejo, un `curl`,
 * un carrito guardado antes del cambio— seguía cayendo a la cascada de precio
 * base y vendiendo justo lo que el comercio retiró.
 *
 * Esta función es la que cierra la otra puerta. Devuelve, para cada producto
 * con la unidad suelta apagada, la presentación que debe aplicarse: la marcada
 * `is_default`, o la primera publicable en el orden que definió el comercio.
 * Un producto que sí ofrece la unidad suelta no aparece en el mapa, de modo que
 * el caller conserva su cascada intacta y el cambio es no-regresivo.
 *
 * No lanza: el peor caso es el comportamiento de antes de la feature.
 */
export async function resolveLooseUnitFallbacks(
  client: LooseUnitFallbackClient,
  productIds: number[],
  storeId: number,
): Promise<Map<number, DefaultSaleUnit>> {
  const result = new Map<number, DefaultSaleUnit>();
  const ids = Array.from(
    new Set(
      (productIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  if (ids.length === 0) return result;

  try {
    const closed = await client.products.findMany({
      where: { id: { in: ids }, offer_loose_unit: false },
      select: { id: true },
    });
    if (closed.length === 0) return result;

    const closedIds = closed.map((p: { id: number }) => Number(p.id));
    const { byProduct, defaultTierByProduct } =
      await listPublicSaleUnitsForProducts(client, closedIds, storeId);

    for (const id of closedIds) {
      const options = byProduct.get(id) ?? [];
      if (options.length === 0) continue;
      const markedId = defaultTierByProduct.get(id);
      const chosen =
        (markedId != null
          ? options.find((option) => option.tier.id === markedId)
          : null) ?? options[0];
      if (chosen) result.set(id, chosen);
    }
  } catch {
    // Sin fallback legible se conserva la cascada histórica: es el mismo
    // resultado que antes de esta feature, nunca un cobro inventado.
  }

  return result;
}
