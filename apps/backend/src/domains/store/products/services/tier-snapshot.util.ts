/**
 * Multi-tarifa: resolución del snapshot de tarifa por línea de venta.
 *
 * Única fuente de verdad para orders, quotations y payments (POS). Antes vivía
 * como tres métodos privados `resolveTierSnapshotsForItems` copiados entre esos
 * servicios, y las copias ya habían divergido en qué columnas leían: payments
 * traía `override_price` y los otros dos no. Cada columna nueva sobre
 * `product_price_tier_overrides` multiplicaba por tres el punto de olvido.
 *
 * Contrato:
 *
 * - Si NINGUNA línea trae `applied_price_tier_id`, devuelve un array de `null`
 *   alineado por índice, sin tocar la base.
 * - Si AL MENOS UNA lo trae, valida server-side el permiso
 *   `store:products:apply_pricing_tier` (bypass para super_admin / owner) y
 *   lanza `PRICING_TIER_PERMISSION_DENIED` si falta. La UI no puede saltearlo.
 * - `product_price_tier_assignments` es un allowlist duro: si el par
 *   (producto, tarifa) no está asignado, lanza `PRICE_TIER_NOT_ALLOWED`. Lo
 *   mismo si la tarifa no existe o está inactiva en esta tienda.
 * - El packSize sigue la cascada `override ?? tier ?? 1` que resuelve
 *   `resolveStockUnitsConsumed` (helper puro en `packaging.util`). Con packSize
 *   <= 1 no hay empaque y `stock_units_consumed` queda en `null` — el caller
 *   persiste el snapshot solo cuando el empaque realmente expandió el consumo.
 *
 * El array devuelto está alineado por índice con `items` para que el caller
 * mapee línea ↔ snapshot sin re-buscar.
 *
 * El `client` se recibe por parámetro (no por DI) porque los callers alternan
 * entre el cliente scoped del servicio y el `tx` de una transacción; tomar
 * `this.prisma` dentro de una transacción abriría una segunda conexión del pool.
 */
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { resolveStockUnitsConsumed } from './packaging.util';

/**
 * Snapshot completo de la tarifa aplicada a una línea.
 *
 * Es el superconjunto de lo que necesitan los tres consumidores: orders y
 * quotations usan `tier_id` / `tier_name` / `stock_units_consumed`; el POS
 * necesita además la regla de precio (`discount_percentage`, `override_price`)
 * para validar el override manual contra el precio esperado de la tarifa.
 */
export type TierSnapshot = {
  tier_id: number;
  tier_name: string;
  stock_units_consumed: number | null;
  discount_percentage: number;
  units_per_package: number | null;
  is_package_unit: boolean;
  override_price: number | null;
  override_units_per_package: number | null;
};

export type TierSnapshotItem = {
  product_id?: number | null;
  product_variant_id?: number | null;
  quantity: number;
  applied_price_tier_id?: number | null;
};

/**
 * Cliente Prisma mínimo que el helper necesita. Acepta tanto el cliente scoped
 * de un servicio (`this.prisma`) como el `tx` de `$transaction`.
 */
type TierSnapshotClient = {
  price_tiers: { findMany: (args: any) => Promise<any[]> };
  product_price_tier_assignments: { findMany: (args: any) => Promise<any[]> };
  product_price_tier_overrides: { findMany: (args: any) => Promise<any[]> };
};

type OverrideInfo = {
  override_price: number | null;
  override_units_per_package: number | null;
};

const overrideKey = (
  productId: number,
  variantId: number | null,
  tierId: number,
): string => `${productId}:${variantId ?? 'null'}:${tierId}`;

export async function resolveTierSnapshotsForItems(
  client: TierSnapshotClient,
  items: TierSnapshotItem[],
  context: ReturnType<typeof RequestContextService.getContext>,
): Promise<Array<TierSnapshot | null>> {
  const tierIdsInUse = new Set<number>();
  for (const item of items) {
    if (
      item.applied_price_tier_id !== undefined &&
      item.applied_price_tier_id !== null
    ) {
      tierIdsInUse.add(Number(item.applied_price_tier_id));
    }
  }

  if (tierIdsInUse.size === 0) {
    return items.map(() => null);
  }

  // Permission gate (server-side; UI cannot bypass).
  const permissions = context?.permissions ?? [];
  const isSuperAdmin = !!context?.is_super_admin;
  const isOwner = !!context?.is_owner;
  if (
    !isSuperAdmin &&
    !isOwner &&
    !permissions.includes('store:products:apply_pricing_tier')
  ) {
    throw new VendixHttpException(ErrorCodes.PRICING_TIER_PERMISSION_DENIED);
  }

  const tierIds = Array.from(tierIdsInUse);

  const tiers = await client.price_tiers.findMany({
    where: { id: { in: tierIds }, is_active: true },
    select: {
      id: true,
      name: true,
      is_package_unit: true,
      units_per_package: true,
      discount_percentage: true,
    },
  });
  const tierById = new Map<number, (typeof tiers)[number]>(
    tiers.map((t): [number, (typeof tiers)[number]] => [t.id, t]),
  );

  const productIds = Array.from(
    new Set(
      items
        .map((i) => i.product_id)
        .filter((id): id is number => typeof id === 'number' && !!id),
    ),
  );

  const assignments = productIds.length
    ? await client.product_price_tier_assignments.findMany({
        where: {
          product_id: { in: productIds },
          price_tier_id: { in: tierIds },
        },
        select: { product_id: true, price_tier_id: true },
      })
    : [];
  const allowedTierKeys = new Set(
    assignments.map(
      (assignment: { product_id: number; price_tier_id: number }) =>
        `${assignment.product_id}:${assignment.price_tier_id}`,
    ),
  );

  // Overrides por producto (+ variante opcional). `override_units_per_package`
  // gana sobre `tier.units_per_package` en la cascada de packSize; auto-scoped
  // relacionalmente por `product.store_id`.
  const overrides = productIds.length
    ? await client.product_price_tier_overrides.findMany({
        where: {
          product_id: { in: productIds },
          price_tier_id: { in: tierIds },
        },
        select: {
          product_id: true,
          variant_id: true,
          price_tier_id: true,
          override_price: true,
          override_units_per_package: true,
        },
      })
    : [];
  const overrideByKey = new Map<string, OverrideInfo>(
    overrides.map(
      (o: {
        product_id: number;
        variant_id: number | null;
        price_tier_id: number;
        override_price: unknown;
        override_units_per_package: number | null;
      }): [string, OverrideInfo] => [
        overrideKey(o.product_id, o.variant_id ?? null, o.price_tier_id),
        {
          override_price:
            o.override_price != null ? Number(o.override_price) : null,
          override_units_per_package: o.override_units_per_package ?? null,
        },
      ],
    ),
  );

  return items.map((item) => {
    const tierId = item.applied_price_tier_id;
    if (tierId === undefined || tierId === null) return null;
    const tier = tierById.get(Number(tierId));
    if (!tier) {
      throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
    }
    const productId = item.product_id;
    if (!productId || !allowedTierKeys.has(`${productId}:${Number(tierId)}`)) {
      throw new VendixHttpException(ErrorCodes.PRICE_TIER_NOT_ALLOWED);
    }
    const variantId = item.product_variant_id ?? null;
    const override = overrideByKey.get(
      overrideKey(productId, variantId, Number(tierId)),
    );
    const override_units_per_package =
      override?.override_units_per_package ?? null;
    // packSize = override ?? tier ?? 1 (collapses to 1 when <= 1).
    const stock_units_consumed = resolveStockUnitsConsumed(
      Number(item.quantity),
      tier.units_per_package,
      override_units_per_package,
    );
    return {
      tier_id: tier.id,
      tier_name: tier.name,
      stock_units_consumed,
      discount_percentage: Number(tier.discount_percentage ?? 0),
      units_per_package: tier.units_per_package ?? null,
      is_package_unit: !!tier.is_package_unit,
      override_price: override?.override_price ?? null,
      override_units_per_package,
    };
  });
}
