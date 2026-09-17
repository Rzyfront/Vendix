/**
 * CP-pos-smart-search · D.2 — Specs del picker tokenizado de traslados.
 *
 * Flag on: where AND×OR sobre raíz `products` (mismo helper A.1) + rank en
 * memoria (mismo A.2); `stock_levels.some` @origen intacto; shape
 * `{id,name,sku,stock_at_origin,stock_at_destination}` idéntico al legacy.
 * Flag off / sin tienda / throw / sobre scan-cap ⇒ legacy (fail-open).
 */
import { StockTransfersService } from './stock-transfers.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('StockTransfersService — searchTransferableProducts (D.2)', () => {
  const mockPrisma = {
    products: { findMany: jest.fn() },
  };
  const mockSearchFlags = { resolveSearchFlags: jest.fn() };
  let service: StockTransfersService;

  const sl = (location_id: number, on_hand: number) => ({
    location_id,
    quantity_on_hand: on_hand,
    quantity_reserved: 0,
    quantity_available: on_hand,
  });
  const row = (over: Record<string, any>) => ({
    id: over.id ?? 1,
    name: 'Cafe Tubo 1/2',
    sku: 'TUBO-001',
    stock_levels: [sl(7, 10), sl(9, 4)],
    ...(over ?? {}),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StockTransfersService(
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
      mockSearchFlags as any,
    );
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(3);
    mockSearchFlags.resolveSearchFlags.mockResolvedValue({
      l1: true,
      l2: true,
      trigram: false,
    });
  });

  it('flag on: where tokenizado AND×OR + some@origen intacto', async () => {
    mockPrisma.products.findMany.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, name: 'Tubo Cafe 3/4', sku: 'X' }),
    ]);

    const result = await service.searchTransferableProducts(
      'cafe tubo',
      7,
      9,
      10,
    );

    const where = mockPrisma.products.findMany.mock.calls[0][0].where;
    // 2 tokens ⇒ 2 ramas AND, cada una OR sobre name/sku (sin nest).
    expect(where.AND).toHaveLength(2);
    for (const branch of where.AND) {
      expect(branch.OR).toHaveLength(2);
    }
    expect(where.OR).toBeUndefined();
    expect(where.stock_levels).toEqual({ some: { location_id: 7 } });
    // Empate total ⇒ tiebreak id DESC (contrato compareSearchRank).
    expect(result.map((r: any) => r.id)).toEqual([2, 1]);
  });

  it('shape legacy intacto incl. stock@origen/destino', async () => {
    mockPrisma.products.findMany.mockResolvedValue([row({ id: 5 })]);

    const result = await service.searchTransferableProducts('tubo', 7, 9, 10);

    expect(result).toEqual([
      {
        id: 5,
        name: 'Cafe Tubo 1/2',
        sku: 'TUBO-001',
        stock_at_origin: {
          quantity_on_hand: 10,
          quantity_reserved: 0,
          quantity_available: 10,
        },
        stock_at_destination: {
          quantity_on_hand: 4,
          quantity_reserved: 0,
          quantity_available: 4,
        },
      },
    ]);
  });

  it('flag off: contains legacy byte-idéntico (OR frase + some@origen)', async () => {
    mockSearchFlags.resolveSearchFlags.mockResolvedValue({
      l1: false,
      l2: false,
      trigram: false,
    });
    mockPrisma.products.findMany.mockResolvedValue([]);

    await service.searchTransferableProducts('cafe tubo', 7, 9, 10);

    const args = mockPrisma.products.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { name: { contains: 'cafe tubo', mode: 'insensitive' } },
      { sku: { contains: 'cafe tubo', mode: 'insensitive' } },
    ]);
    expect(args.where.stock_levels).toEqual({ some: { location_id: 7 } });
    expect(args.take).toBe(10);
  });

  it('query acentuada + flag on ⇒ legacy (paridad, finding #2)', async () => {
    mockPrisma.products.findMany.mockResolvedValue([]);

    await service.searchTransferableProducts('café tubo', 7, 9, 10);

    // `café`→`cafe` plegado no matchea en `contains`: frase verbatim.
    const args = mockPrisma.products.findMany.mock.calls[0][0];
    expect(args.where.AND).toBeUndefined();
    expect(args.where.OR).toEqual([
      { name: { contains: 'café tubo', mode: 'insensitive' } },
      { sku: { contains: 'café tubo', mode: 'insensitive' } },
    ]);
  });

  it('sin tienda / flags down ⇒ legacy (fail-open)', async () => {
    mockPrisma.products.findMany.mockResolvedValue([row({ id: 1 })]);

    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(undefined);
    await service.searchTransferableProducts('tubo', 7, 9, 10);
    expect(
      mockPrisma.products.findMany.mock.calls[0][0].where.OR,
    ).toHaveLength(2);

    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(3);
    mockSearchFlags.resolveSearchFlags.mockRejectedValue(new Error('down'));
    await service.searchTransferableProducts('tubo', 7, 9, 10);
    expect(
      mockPrisma.products.findMany.mock.calls[1][0].where.OR,
    ).toHaveLength(2);
  });

  it('sobre scan-cap: fail-open a legacy', async () => {
    mockPrisma.products.findMany.mockImplementation((args: any) => {
      if (args.take === 201) {
        return Promise.resolve(
          Array.from({ length: 201 }, (_, i) => row({ id: 1000 + i })),
        );
      }
      return Promise.resolve([row({ id: 1 })]);
    });

    const result = await service.searchTransferableProducts('tubo', 7, 9, 10);

    expect(
      mockPrisma.products.findMany.mock.calls[1][0].where.OR,
    ).toHaveLength(2);
    expect(result).toHaveLength(1);
  });
});
