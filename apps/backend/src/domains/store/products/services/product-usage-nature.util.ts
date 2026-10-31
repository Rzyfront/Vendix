import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/**
 * Naturaleza de uso del producto (`products.usage_nature`).
 *
 * - `sale`: existe para venderse.
 * - `supply` (insumo): solo entra en recetas, producción o fórmulas.
 * - `internal_use`: lo consume la operación (ropería, amenidades, aseo).
 *
 * Regla dura: `supply` e `internal_use` NUNCA se venden, en ningún canal. Un
 * producto de venta que además es ingrediente (la salsa) sigue siendo de venta.
 */
export type UsageNature = 'sale' | 'supply' | 'internal_use';

export const USAGE_NATURE_LABELS: Record<UsageNature, string> = {
  sale: 'Venta',
  supply: 'Insumo',
  internal_use: 'Uso interno',
};

/** `null`/`undefined` cuenta como venta: es el default de la columna. */
export function isSaleNature(nature: string | null | undefined): boolean {
  return !nature || nature === 'sale';
}

type NatureWritable = {
  usage_nature?: UsageNature | string | null;
  is_sellable?: boolean | null;
  is_ingredient?: boolean | null;
  is_on_sale?: boolean | null;
  allow_pos_price_override?: boolean | null;
  has_multiple_price_tiers?: boolean | null;
  enabled_price_tier_ids?: number[] | null;
  available_for_ecommerce?: boolean | null;
  is_featured?: boolean | null;
  online_purchase_url?: string | null;
};

/**
 * Aplica las reglas de la naturaleza a un payload de alta/edición.
 *
 * - Insumo y Uso interno: no vendible, no publicado, sin oferta ni enlace de
 *   compra. Insumo siempre es ingrediente; Uso interno nunca lo es.
 * - Volver a Venta desde otra naturaleza sin mandar `is_sellable` lo deja
 *   vendible (si no, quedaría apagado sin que nadie lo decida).
 * - Update parcial sin `usage_nature`: hereda la del producto existente.
 *
 * Devuelve una copia; nunca cambia la naturaleza en silencio.
 */
export function applyUsageNatureRules<T extends NatureWritable>(
  dto: T,
  existingNature?: string | null,
): T {
  const nature = (dto.usage_nature ?? existingNature ?? 'sale') as UsageNature;

  if (isSaleNature(nature)) {
    const comesFromNonSale =
      dto.usage_nature === 'sale' && !isSaleNature(existingNature);
    if (comesFromNonSale && (dto.is_sellable === undefined || dto.is_sellable === null)) {
      return { ...dto, is_sellable: true };
    }
    return dto;
  }

  return {
    ...dto,
    is_sellable: false,
    is_ingredient: nature === 'supply',
    is_on_sale: false,
    allow_pos_price_override: false,
    has_multiple_price_tiers: false,
    enabled_price_tier_ids: [],
    available_for_ecommerce: false,
    is_featured: false,
    online_purchase_url: null,
  };
}

type SellableLine = {
  id: number;
  name: string;
  usage_nature?: string | null;
  is_ingredient?: boolean | null;
  is_sellable?: boolean | null;
};

/**
 * Insumo puro heredado: anterior a `usage_nature` (sin backfill, quedó en
 * `sale`) pero marcado `is_ingredient && !is_sellable`. Se trata como Insumo
 * en toda superficie de venta.
 */
export function isLegacyPureIngredient(p: {
  is_ingredient?: boolean | null;
  is_sellable?: boolean | null;
}): boolean {
  return p.is_ingredient === true && p.is_sellable === false;
}

/** Nunca vendible: naturaleza distinta de Venta, o insumo puro heredado. */
export function isNeverSellable(p: SellableLine): boolean {
  return !isSaleNature(p.usage_nature) || isLegacyPureIngredient(p);
}

/** Prisma `where` de lo que nunca se vende (espejo de `isNeverSellable`). */
export const NEVER_SELLABLE_WHERE = {
  OR: [
    { usage_nature: { not: 'sale' as const } },
    { is_ingredient: true, is_sellable: false },
  ],
};

/**
 * Filtro de las pestañas del listado por naturaleza EFECTIVA: el insumo puro
 * heredado cuenta como Insumo (no como Venta). La salsa (Venta + ingrediente
 * vendible) sigue en Venta.
 */
export function usageNatureListWhere(nature: UsageNature | string): object {
  const legacyPure = { usage_nature: 'sale', is_ingredient: true, is_sellable: false };
  if (nature === 'sale') {
    return { usage_nature: 'sale', NOT: { is_ingredient: true, is_sellable: false } };
  }
  if (nature === 'supply') {
    return { OR: [{ usage_nature: 'supply' }, legacyPure] };
  }
  return { usage_nature: nature };
}

/** Naturaleza efectiva de una fila (espejo de `usageNatureListWhere`). */
export function effectiveUsageNature(p: {
  usage_nature?: string | null;
  is_ingredient?: boolean | null;
  is_sellable?: boolean | null;
}): UsageNature {
  if (isSaleNature(p.usage_nature)) {
    return isLegacyPureIngredient(p) ? 'supply' : 'sale';
  }
  return p.usage_nature as UsageNature;
}

/**
 * Guard de servidor para cualquier venta (orden, cobro POS, mesa, folio,
 * cotización, separado). Rechaza con 422 legible si alguna línea es Insumo o
 * Uso interno. Un producto de Venta que además es ingrediente pasa.
 */
export function assertSaleNatureProducts(products: SellableLine[]): void {
  const offender = products.find(isNeverSellable);
  if (!offender) return;
  const nature = isSaleNature(offender.usage_nature)
    ? 'supply'
    : (offender.usage_nature as UsageNature);
  throw new VendixHttpException(
    ErrorCodes.PROD_NATURE_NOT_SELLABLE,
    `"${offender.name}" es un producto de ${USAGE_NATURE_LABELS[nature]} y no se puede vender.`,
    { product_id: offender.id, usage_nature: nature },
  );
}

type NatureLookupPrisma = {
  // Cualquier cliente Prisma (scoped o global, tx incluida).
  products: { findMany: (args: any) => PromiseLike<unknown> };
};

/**
 * Variante async del guard para líneas de venta (`{ product_id }`). Una sola
 * consulta; solo trae las líneas ofensoras, así que el camino feliz no
 * hidrata nada.
 */
export async function assertSaleNatureLines(
  prisma: NatureLookupPrisma,
  items: ReadonlyArray<{ product_id?: number | null }> | null | undefined,
): Promise<void> {
  const ids = Array.from(
    new Set(
      (items ?? [])
        .map((i) => i?.product_id)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    ),
  );
  if (ids.length === 0) return;
  const offenders = (await prisma.products.findMany({
    where: { id: { in: ids }, ...NEVER_SELLABLE_WHERE },
    select: {
      id: true,
      name: true,
      usage_nature: true,
      is_ingredient: true,
      is_sellable: true,
    },
    take: 1,
  })) as SellableLine[];
  assertSaleNatureProducts(offenders);
}
