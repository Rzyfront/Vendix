import { SellableStockAllocator } from './sellable-stock-allocator.service';
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
