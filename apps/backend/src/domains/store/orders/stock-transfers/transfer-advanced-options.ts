import {
  expandTransferablePickerRows,
  type TransferablePickerRow,
} from './transfer-item-rules';

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
    client.users.findMany({
      where: { organization_id: ctx.organization_id, state: 'active' },
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
 */
export async function listTransferBatches(
  client: any,
  params: { location_id: number; product_ids: number[] },
): Promise<TransferBatchOption[]> {
  const productIds = [...new Set(params.product_ids)]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 200);
  if (productIds.length === 0) return [];

  const rows = await client.inventory_batches.findMany({
    where: {
      product_id: { in: productIds },
      OR: [{ location_id: params.location_id }, { location_id: null }],
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

/**
 * "Agregar todo el stock de la bodega": filas del picker (una por producto o
 * variante) con disponible en el origen, opcionalmente filtradas por
 * categoría. Mismo shape que `search-products` para que la vista reutilice la
 * lógica de líneas.
 */
export async function listTransferLocationStock(
  client: any,
  params: {
    from_location_id: number;
    to_location_id?: number | null;
    category_id?: number | null;
    limit?: number;
  },
): Promise<TransferablePickerRow[]> {
  const take = Math.min(Math.max(Number(params.limit) || 300, 1), 500);

  const originRows = await client.stock_levels.findMany({
    where: {
      location_id: params.from_location_id,
      quantity_available: { gt: 0 },
      products: {
        state: { not: 'archived' },
        ...(params.category_id
          ? {
              product_categories: { some: { category_id: params.category_id } },
            }
          : {}),
      },
    },
    select: {
      product_id: true,
      product_variant_id: true,
      location_id: true,
      quantity_on_hand: true,
      quantity_reserved: true,
      quantity_available: true,
      products: { select: { id: true, name: true, sku: true } },
      product_variants: { select: { id: true, name: true, sku: true } },
    },
    orderBy: [{ product_id: 'asc' }, { id: 'asc' }],
    take,
  });

  if (originRows.length === 0) return [];

  const toLocationId = params.to_location_id ?? null;
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
      params.from_location_id,
      // Sin destino (salida externa) no hay disponible en destino que mostrar.
      toLocationId ?? -1,
    ),
  );
}
