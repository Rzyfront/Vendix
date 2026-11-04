import { SellableStockAllocator } from './sellable-stock-allocator.service';
import { RequestContextService } from '../../../../../common/context/request-context.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';

/**
 * QUI-559 — reparto de una línea entre ubicaciones vendibles.
 *
 * El caso que rompía el POS: 8 unidades en la ubicación A + 4 en la B y una
 * venta de 10. La disponibilidad total alcanzaba, pero reserva y commit
 * trabajaban sobre UNA sola ubicación, así que la venta moría con
 * `INV_STOCK_002 "disponible 8, requerido 10"`. `allocate` es puro, así que
 * el reparto se fija sin BD.
 */
describe('SellableStockAllocator.allocate', () => {
  let allocator: SellableStockAllocator;

  beforeEach(() => {
    allocator = new SellableStockAllocator({} as unknown as StorePrismaService);
  });

  const LEVELS = [
    { location_id: 1, quantity_available: 8 },
    { location_id: 2, quantity_available: 4 },
  ];

  it('reparte 10 unidades entre 8+4 en dos tramos y sin faltante', () => {
    const result = allocator.allocate(10, LEVELS);

    expect(result.slices).toEqual([
      { location_id: 1, quantity: 8 },
      { location_id: 2, quantity: 2 },
    ]);
    expect(result.allocated).toBe(10);
    expect(result.available).toBe(12);
    expect(result.shortfall).toBe(0);
  });

  it('reporta faltante cuando el TOTAL vendible no alcanza (13 sobre 8+4)', () => {
    const result = allocator.allocate(13, LEVELS);

    expect(result.allocated).toBe(12);
    expect(result.available).toBe(12);
    expect(result.shortfall).toBe(1);
  });

  it('no fragmenta una línea que cabe en una sola ubicación (no regresión)', () => {
    const result = allocator.allocate(5, LEVELS);

    expect(result.slices).toEqual([{ location_id: 1, quantity: 5 }]);
    expect(result.shortfall).toBe(0);
  });

  it('consume primero las ubicaciones preferidas aunque tengan menos disponible', () => {
    // La ubicación 2 ya tiene la reserva: honrarla mantiene la intención
    // física del movimiento en lugar de descontar de donde más haya.
    const result = allocator.allocate(6, LEVELS, [2]);

    expect(result.slices).toEqual([
      { location_id: 2, quantity: 4 },
      { location_id: 1, quantity: 2 },
    ]);
    expect(result.shortfall).toBe(0);
  });

  it('ignora filas con disponible negativo en lugar de restarlas del total', () => {
    const result = allocator.allocate(3, [
      { location_id: 1, quantity_available: -5 },
      { location_id: 2, quantity_available: 3 },
    ]);

    expect(result.slices).toEqual([{ location_id: 2, quantity: 3 }]);
    expect(result.available).toBe(3);
    expect(result.shortfall).toBe(0);
  });

  it('sin ubicaciones vendibles, todo es faltante y no hay tramos', () => {
    const result = allocator.allocate(2, []);

    expect(result.slices).toEqual([]);
    expect(result.available).toBe(0);
    expect(result.shortfall).toBe(2);
  });
});

describe('SellableStockAllocator.absorbShortfall', () => {
  let allocator: SellableStockAllocator;

  beforeEach(() => {
    allocator = new SellableStockAllocator({} as unknown as StorePrismaService);
  });

  it('suma el faltante al tramo de la ubicación indicada si ya existe', () => {
    const allocation = allocator.allocate(13, [
      { location_id: 1, quantity_available: 8 },
      { location_id: 2, quantity_available: 4 },
    ]);

    expect(allocator.absorbShortfall(allocation, 2)).toEqual([
      { location_id: 1, quantity: 8 },
      { location_id: 2, quantity: 5 },
    ]);
  });

  it('crea el tramo cuando la ubicación de destino no aparecía', () => {
    const allocation = allocator.allocate(5, []);

    expect(allocator.absorbShortfall(allocation, 9)).toEqual([
      { location_id: 9, quantity: 5 },
    ]);
  });

  it('devuelve los tramos intactos cuando no hay faltante', () => {
    const allocation = allocator.allocate(3, [
      { location_id: 1, quantity_available: 8 },
    ]);

    expect(allocator.absorbShortfall(allocation, 1)).toEqual(allocation.slices);
  });
});

describe('SellableStockAllocator.getSellableLevels', () => {
  it('fija la variante y ordena por disponible descendente', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const allocator = new SellableStockAllocator({
      stock_levels: { findMany },
    } as unknown as StorePrismaService);

    await allocator.getSellableLevels(7, 100, undefined);

    const args = findMany.mock.calls[0][0];
    // `product_variant_id: null` es obligatorio: la identidad de la fila es la
    // terna (product, variant, location) y una línea base no puede absorber el
    // stock de sus variantes.
    expect(args.where).toMatchObject({
      product_id: 100,
      product_variant_id: null,
      inventory_locations: { store_id: 7, is_active: true },
    });
    expect(args.orderBy).toEqual([
      { quantity_available: 'desc' },
      { location_id: 'asc' },
    ]);
  });

  it('amplía el conjunto con las ubicaciones ya reservadas aunque hoy no sean vendibles', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const allocator = new SellableStockAllocator({
      stock_levels: { findMany },
    } as unknown as StorePrismaService);

    await allocator.getSellableLevels(7, 100, 5, undefined, [42]);

    const where = findMany.mock.calls[0][0].where;
    // Una reserva es un compromiso explícito con una ubicación: honrarla evita
    // bloquear retroactivamente órdenes reservadas antes de que la regla
    // existiera.
    expect(where.product_variant_id).toBe(5);
    expect(where.OR).toEqual([
      { inventory_locations: expect.objectContaining({ store_id: 7 }) },
      { location_id: { in: [42] } },
    ]);
  });
});

/**
 * "Bodega de la caja" (`pos_stock_scope = register_location`): la línea de una
 * orden nacida en una caja con bodega se reparte SOLO en esa bodega.
 */
describe('SellableStockAllocator — restricción por bodega de la caja', () => {
  const ORDER = { store_id: 7, origin_cash_session_id: 55 };
  const settingsWith = (scope?: string) => ({
    settings: scope ? { inventory: { pos_stock_scope: scope } } : {},
  });

  function build(opts: {
    order?: any;
    settings?: any;
    session?: any;
    levels?: Array<{ location_id: number; quantity_available: number }>;
  }) {
    const findMany = jest.fn().mockResolvedValue(opts.levels ?? []);
    const prisma = {
      orders: { findFirst: jest.fn().mockResolvedValue(opts.order ?? ORDER) },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue(opts.settings ?? settingsWith('register_location')),
      },
      cash_register_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.session ?? { register: { location_id: 2 } }),
      },
      stock_levels: { findMany },
    };
    const allocator = new SellableStockAllocator(prisma as unknown as StorePrismaService);
    return { allocator, findMany, prisma };
  }

  it('resuelve la bodega de la caja de la orden bajo register_location', async () => {
    const { allocator } = build({});
    await expect(allocator.resolveOrderSaleLocationIds(900)).resolves.toEqual([2]);
  });

  it('sin restricción con otro alcance, sin sesión de origen o caja sin bodega', async () => {
    await expect(
      build({ settings: settingsWith('main_location') }).allocator.resolveOrderSaleLocationIds(900),
    ).resolves.toBeNull();
    await expect(
      build({ settings: settingsWith(undefined) }).allocator.resolveOrderSaleLocationIds(900),
    ).resolves.toBeNull();
    await expect(
      build({ order: { store_id: 7, origin_cash_session_id: null, channel: 'ecommerce' } }).allocator.resolveOrderSaleLocationIds(900),
    ).resolves.toBeNull();
    await expect(
      build({ session: { register: { location_id: null } } }).allocator.resolveOrderSaleLocationIds(900),
    ).resolves.toBeNull();
  });

  it('orden POS sin caja de origen (borrador cobrado después) toma la caja abierta de quien cobra', async () => {
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(31);
    const { allocator, prisma } = build({
      order: { store_id: 7, origin_cash_session_id: null, channel: 'pos' },
    });

    await expect(allocator.resolveOrderSaleLocationIds(900)).resolves.toEqual([2]);
    expect(prisma.cash_register_sessions.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: 7, opened_by: 31, status: 'open' },
      }),
    );
  });

  it('memoiza por transacción: una sola resolución por orden dentro del mismo tx', async () => {
    const { prisma } = build({});
    const allocator = new SellableStockAllocator({} as unknown as StorePrismaService);
    const tx = prisma as any;

    await allocator.resolveOrderSaleLocationIds(900, tx);
    await allocator.resolveOrderSaleLocationIds(900, tx);

    expect(prisma.orders.findFirst).toHaveBeenCalledTimes(1);
  });

  it('allocateForLine con orderId filtra stock_levels a la bodega de la caja', async () => {
    const { allocator, findMany } = build({
      levels: [{ location_id: 2, quantity_available: 3 }],
    });

    const result = await allocator.allocateForLine(7, 100, undefined, 5, [], undefined, {
      orderId: 900,
    });

    const where = findMany.mock.calls[0][0].where;
    expect(where.location_id).toEqual({ in: [2] });
    expect(where.inventory_locations).toMatchObject({ store_id: 7, is_active: true });
    // Nunca derrama a otra bodega: 3 en la caja, faltan 2.
    expect(result.slices).toEqual([{ location_id: 2, quantity: 3 }]);
    expect(result.shortfall).toBe(2);
    expect(result.restricted_location_ids).toEqual([2]);
  });

  it('una reserva FUERA de la bodega de la caja no amplía el conjunto', async () => {
    const { allocator, findMany } = build({});

    await allocator.allocateForLine(7, 100, undefined, 5, [9], undefined, { orderId: 900 });

    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.location_id).toEqual({ in: [2] });
  });

  it('sin orderId ni restricción, el comportamiento es el de siempre (no regresión)', async () => {
    const { allocator, findMany, prisma } = build({});

    const result = await allocator.allocateForLine(7, 100, undefined, 5);

    expect(prisma.orders.findFirst).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where.location_id).toBeUndefined();
    expect(result.restricted_location_ids).toBeNull();
  });
});
