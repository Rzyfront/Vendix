import {
  expandTransferablePickerRows,
  type TransferablePickerRow,
} from './transfer-item-rules';
import {
  batchOrganizationFilter,
  transferStaffUserWhere,
} from './transfer-transport';

/**
 * Lecturas de apoyo de la orden avanzada (P3), compartidas por las dos
 * superficies de transferencias (tienda y organización).
 *
 * Cada función recibe el MISMO cliente con el que la superficie crea y despacha
 * (`tx` de tienda u `orgPrisma`), así la lista de opciones coincide con lo que
 * después acepta `resolveTransferTransport` / `resolveLineBatch`: en tienda los
 * modelos con scope de tienda (métodos de envío, categorías) quedan limitados a
 * la tienda del contexto igual que al validar.
 */

export interface TransferAdvancedOptionsContext {
  organization_id: number;
  /** Tienda de la bodega de origen; null si es bodega central. */
  from_store_id: number | null;
}

export interface TransferAdvancedOptions {
  vehicles: Array<{
    id: number;
    plate: string;
    type: string | null;
    brand: string | null;
    model_name: string | null;
    primary_driver_id: number | null;
  }>;
  drivers: Array<{ id: number; name: string }>;
  shipping_methods: Array<{
    id: number;
    name: string;
    type: string;
    provider_name: string | null;
    /** `internal` (flota propia, recogida, propio) o `external` (transportadora). */
    scope: 'internal' | 'external';
  }>;
  categories: Array<{ id: number; name: string }>;
}

const EXTERNAL_SHIPPING_TYPES = new Set(['carrier', 'third_party_provider']);

export function shippingMethodScope(type: string | null | undefined) {
  return EXTERNAL_SHIPPING_TYPES.has(String(type ?? ''))
    ? ('external' as const)
    : ('internal' as const);
}

/**
 * Opciones de transporte y categorías para la orden avanzada (D6):
 * vehículos activos de la tienda de origen (los que acepta el despacho),
 * usuarios activos de la organización como conductores, métodos de envío
 * activos (propios de la organización o de sistema) y categorías para el
 * "agregar todo el stock de la bodega".
 */
export async function listTransferAdvancedOptions(
  client: any,
  ctx: TransferAdvancedOptionsContext,
): Promise<TransferAdvancedOptions> {
  const storeFilter =
    ctx.from_store_id != null
      ? { store_id: ctx.from_store_id }
      : { store: { organization_id: ctx.organization_id } };

  const [vehicles, drivers, shippingMethods, categories] = await Promise.all([
    client.vehicles.findMany({
      where: { is_active: true, ...storeFilter },
      select: {
        id: true,
        plate: true,
        type: true,
        brand: true,
        model_name: true,
        primary_driver_id: true,
      },
      orderBy: { plate: 'asc' },
      take: 200,
    }),
    // Solo personal (sin clientes del ecommerce), el mismo predicado con el
    // que `resolveTransferDriver` valida al transportador.
    client.users.findMany({
      where: transferStaffUserWhere(ctx.organization_id, ctx.from_store_id),
      select: { id: true, first_name: true, last_name: true },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      take: 300,
    }),
    client.shipping_methods.findMany({
      where: {
        is_active: true,
        OR: [
          { store_id: null },
          ctx.from_store_id != null
            ? { store_id: ctx.from_store_id }
            : { store: { organization_id: ctx.organization_id } },
        ],
      },
      select: { id: true, name: true, type: true, provider_name: true },
      orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
      take: 100,
    }),
    client.categories.findMany({
      where: {
        state: 'active',
        ...(ctx.from_store_id != null
          ? { store_id: ctx.from_store_id }
          : { stores: { organization_id: ctx.organization_id } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 300,
    }),
  ]);

  return {
    vehicles: vehicles.map((v: any) => ({
      id: v.id,
      plate: v.plate,
      type: v.type ?? null,
      brand: v.brand ?? null,
      model_name: v.model_name ?? null,
      primary_driver_id: v.primary_driver_id ?? null,
    })),
    drivers: drivers.map((u: any) => ({
      id: u.id,
      name:
        `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() ||
        `Usuario #${u.id}`,
    })),
    shipping_methods: shippingMethods.map((m: any) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      provider_name: m.provider_name ?? null,
      scope: shippingMethodScope(m.type),
    })),
    categories: categories.map((c: any) => ({ id: c.id, name: c.name })),
  };
}

export interface TransferBatchOption {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  batch_number: string;
  expiration_date: Date | null;
  available: number;
}

/**
 * Lotes de los productos en la bodega de origen (D5), en el MISMO orden que usa
 * `resolveLineBatch` para el lote por defecto (FEFO: vence antes primero; sin
 * vencimiento, el creado antes). El primero con saldo es el que el despacho
 * toma si la fila no elige otro.
 *
 * `organization_id` es obligatorio: en organización `inventory_batches` no
 * tiene scope y los ids de producto llegan por la URL, así que sin este filtro
 * ids de productos ajenos devolverían lotes sin bodega de otra organización.
 */
export async function listTransferBatches(
  client: any,
  params: {
    organization_id: number;
    location_id: number;
    product_ids: number[];
  },
): Promise<TransferBatchOption[]> {
  const productIds = [...new Set(params.product_ids)]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 200);
  if (productIds.length === 0) return [];

  const rows = await client.inventory_batches.findMany({
    where: {
      product_id: { in: productIds },
      OR: [{ location_id: params.location_id }, { location_id: null }],
      ...batchOrganizationFilter(params.organization_id),
    },
    select: {
      id: true,
      product_id: true,
      product_variant_id: true,
      batch_number: true,
      expiration_date: true,
      quantity: true,
      quantity_used: true,
    },
    orderBy: [{ expiration_date: 'asc' }, { created_at: 'asc' }],
    take: 1000,
  });

  return rows.map((b: any) => ({
    id: b.id,
    product_id: b.product_id,
    product_variant_id: b.product_variant_id ?? null,
    batch_number: b.batch_number,
    expiration_date: b.expiration_date ?? null,
    available: Math.max(
      0,
      Number(b.quantity ?? 0) - Number(b.quantity_used ?? 0),
    ),
  }));
}

const PICKER_STOCK_SELECT = {
  product_id: true,
  product_variant_id: true,
  location_id: true,
  quantity_on_hand: true,
  quantity_reserved: true,
  quantity_available: true,
  products: { select: { id: true, name: true, sku: true } },
  product_variants: { select: { id: true, name: true, sku: true } },
} as const;

/**
 * "Agregar todo el stock de la bodega": filas del picker (una por producto o
 * variante) con disponible en el origen, opcionalmente filtradas por
 * categoría. Mismo shape que `search-products` para que la vista reutilice la
 * lógica de líneas.
 */
export async function listTransferLocationStock(
  client: any,
  params: TransferLocationStockParams,
): Promise<TransferablePickerRow[]> {
  return (await listTransferLocationStockPage(client, params)).rows;
}

export interface TransferLocationStockParams {
  from_location_id: number;
  to_location_id?: number | null;
  category_id?: number | null;
  /**
   * Solo estos productos (refrescar el disponible de las líneas que ya están
   * en la orden, p. ej. al cambiar el destino). Con lista se devuelven también
   * las filas sin disponible en origen, para que la vista vea el cero.
   */
  product_ids?: number[];
  limit?: number;
}

/**
 * Igual que `listTransferLocationStock`, y además avisa si la bodega tiene
 * más filas que el tope (`has_more`), para que la vista diga que solo se
 * cargaron las primeras.
 */
export async function listTransferLocationStockPage(
  client: any,
  params: TransferLocationStockParams,
): Promise<{
  rows: TransferablePickerRow[];
  has_more: boolean;
  limit: number;
}> {
  const take = Math.min(Math.max(Number(params.limit) || 300, 1), 500);

  const productIds = [...new Set(params.product_ids ?? [])]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 500);
  const originRows = await client.stock_levels.findMany({
    where: {
      location_id: params.from_location_id,
      ...(productIds.length > 0
        ? { product_id: { in: productIds } }
        : { quantity_available: { gt: 0 } }),
      products: {
        state: { not: 'archived' },
        ...(params.category_id
          ? {
              product_categories: { some: { category_id: params.category_id } },
            }
          : {}),
      },
    },
    select: PICKER_STOCK_SELECT,
    orderBy: [{ product_id: 'asc' }, { id: 'asc' }],
    // Una fila de más solo para saber si hay más que el tope.
    take: take + 1,
  });
  const has_more = originRows.length > take;

  const rows = await withDestinationStock(
    client,
    has_more ? originRows.slice(0, take) : originRows,
    params.from_location_id,
    params.to_location_id ?? null,
  );
  return { rows, has_more, limit: take };
}
/**
 * Filas del origen → filas del picker, con el disponible del destino (si hay
 * destino). Compartido por "todo el stock" y la lectura por código.
 */
async function withDestinationStock(
  client: any,
  originRows: any[],
  fromLocationId: number,
  toLocationId: number | null,
): Promise<TransferablePickerRow[]> {
  if (originRows.length === 0) return [];

  const productIds = [...new Set(originRows.map((r: any) => r.product_id))];
  const destinationRows =
    toLocationId != null
      ? await client.stock_levels.findMany({
          where: { location_id: toLocationId, product_id: { in: productIds } },
          select: {
            product_id: true,
            product_variant_id: true,
            location_id: true,
            quantity_on_hand: true,
            quantity_reserved: true,
            quantity_available: true,
          },
        })
      : [];

  return originRows.flatMap((row: any) =>
    expandTransferablePickerRows(
      row.products ?? {
        id: row.product_id,
        name: `Producto #${row.product_id}`,
        sku: null,
      },
      [
        row,
        ...destinationRows.filter((d: any) => d.product_id === row.product_id),
      ],
      fromLocationId,
      // Sin destino (salida externa) no hay disponible en destino que mostrar.
      toLocationId ?? -1,
    ),
  );
}

/**
 * Escáner y "pegar lista" (M2): filas con stock en el origen cuyo código es
 * EXACTAMENTE el leído (sin distinguir mayúsculas) en el SKU o el código de
 * barras del producto, o en el SKU o el código de barras de la variante.
 *
 * Si el código es de una variante devuelve solo esa variante; si es del
 * producto padre devuelve todas sus variantes con stock (la vista decide si
 * es ambiguo). `organization_id` acota los productos a la organización: en
 * organización `stock_levels` no trae scope automático.
 */
export async function lookupTransferCode(
  client: any,
  params: {
    organization_id: number;
    code: string;
    from_location_id: number;
    to_location_id?: number | null;
  },
): Promise<TransferablePickerRow[]> {
  const code = String(params.code ?? '').trim();
  if (!code || code.length > 100) return [];
  const equals = { equals: code, mode: 'insensitive' as const };

  const originRows = await client.stock_levels.findMany({
    where: {
      location_id: params.from_location_id,
      products: {
        state: { not: 'archived' },
        stores: { organization_id: params.organization_id },
      },
      OR: [
        { products: { sku: equals } },
        { products: { barcode: equals } },
        { product_variants: { sku: equals } },
        { product_variants: { barcode: equals } },
      ],
    },
    select: PICKER_STOCK_SELECT,
    orderBy: [{ product_id: 'asc' }, { id: 'asc' }],
    take: 20,
  });

  return withDestinationStock(
    client,
    originRows,
    params.from_location_id,
    params.to_location_id ?? null,
  );
}
