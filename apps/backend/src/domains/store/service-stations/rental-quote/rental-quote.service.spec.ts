import { RequestContext, RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RentalQuoteService } from './rental-quote.service';
import type { ShippingTaxService } from '../../shipping/services/shipping-tax.service';

describe('RentalQuoteService', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: RentalQuoteService;
  let prisma: Record<string, any>;
  let shippingTax: { taxRowsForCategory: jest.Mock };
  // Saturday 20:00 Bogota.
  const startAt = new Date('2026-11-07T20:00:00-05:00');

  const product = (over: Record<string, unknown> = {}) => ({
    id: 1,
    base_price: 50000,
    is_on_sale: false,
    sale_price: null,
    service_duration_minutes: 120,
    rental_pricing_mode: 'station_rate',
    ...over,
  });

  beforeEach(() => {
    prisma = {
      products: { findFirst: jest.fn().mockResolvedValue(product()) },
      product_variants: { findFirst: jest.fn() },
      service_stations: {
        findFirst: jest.fn().mockResolvedValue({ id: 5, rental_block_minutes: 60, rental_block_price: 80000 }),
      },
      service_station_rate_windows: {
        findMany: jest.fn().mockResolvedValue([
          { id: 4, weekday: 6, start_time: '20:00', end_time: '23:00', block_price: 100000, is_active: true },
        ]),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }),
      },
    };
    shippingTax = { taxRowsForCategory: jest.fn().mockResolvedValue([]) };
    service = new RentalQuoteService(prisma as unknown as StorePrismaService, shippingTax as unknown as ShippingTaxService);
  });

  const run = <T>(fn: () => Promise<T>) => RequestContextService.runIsolated(context, fn);

  it('fixed_price returns the catalog price and ignores windows (A15)', async () => {
    prisma.products.findFirst.mockResolvedValue(product({ rental_pricing_mode: 'fixed_price', base_price: 70000 }));
    const q = await run(() => service.quote({ productId: 1, stationId: 5, startAt }));
    expect(q).toMatchObject({ amount: 70000, cents: 7000000, pricing_mode: 'fixed_price', per_block: [] });
    expect(prisma.service_station_rate_windows.findMany).not.toHaveBeenCalled();
  });

  it('fixed_price prefers the variant override', async () => {
    prisma.products.findFirst.mockResolvedValue(product({ rental_pricing_mode: 'fixed_price', base_price: 70000 }));
    prisma.product_variants.findFirst.mockResolvedValue({ id: 2, price_override: 90000, is_on_sale: false });
    const q = await run(() => service.quote({ productId: 1, variantId: 2, stationId: 5, startAt }));
    expect(q.amount).toBe(90000);
  });

  it('station_rate sums every block priced by its own start', async () => {
    // 120 min / 60 = 2 blocks: 20:00 and 21:00, both in the window.
    const q = await run(() => service.quote({ productId: 1, stationId: 5, startAt }));
    expect(q).toMatchObject({ amount: 200000, cents: 20000000, blocks: 2, block_minutes: 60, pricing_mode: 'station_rate' });
    expect(q.per_block.map((b) => b.window_id)).toEqual([4, 4]);
  });

  it('variant minutes win over product minutes', async () => {
    prisma.product_variants.findFirst.mockResolvedValue({ id: 2, service_duration_minutes: 180 });
    const q = await run(() => service.quote({ productId: 1, variantId: 2, stationId: 5, startAt }));
    expect(q.blocks).toBe(3);
    // 20:00, 21:00 in window; 22:00 in window too (until 23:00).
    expect(q.cents).toBe(30000000);
  });

  it('booked minutes win over the catalog duration (a free-duration station books any multiple of the block)', async () => {
    prisma.product_variants.findFirst.mockResolvedValue({ id: 2, service_duration_minutes: 60 });
    const q = await run(() => service.quote({ productId: 1, variantId: 2, stationId: 5, startAt, minutes: 180 }));
    expect(q).toMatchObject({ blocks: 3, cents: 30000000, amount: 300000 });
  });

  it('prices the blocks outside windows at the station base price', async () => {
    const q = await run(() => service.quote({ productId: 1, stationId: 5, startAt: new Date('2026-11-07T10:00:00-05:00') }));
    expect(q.cents).toBe(16000000);
  });

  it('rejects minutes that are not a multiple of the block with STATION_009', async () => {
    prisma.products.findFirst.mockResolvedValue(product({ service_duration_minutes: 90 }));
    await expect(run(() => service.quote({ productId: 1, stationId: 5, startAt }))).rejects.toMatchObject({
      errorCode: 'STATION_009',
    });
  });

  it('rejects a station without a time rate with STATION_009', async () => {
    prisma.service_stations.findFirst.mockResolvedValue({ id: 5, rental_block_minutes: null, rental_block_price: null });
    await expect(run(() => service.quote({ productId: 1, stationId: 5, startAt }))).rejects.toMatchObject({
      errorCode: 'STATION_009',
    });
  });

  it('scopes the station by store', async () => {
    await run(() => service.quote({ productId: 1, stationId: 5, startAt }));
    expect(prisma.service_stations.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, store_id: 10 } }),
    );
  });

  it('quoteStationBlocks prices extension blocks without a product', async () => {
    const q = await run(() => service.quoteStationBlocks({ stationId: 5, startAt, blocks: 3 }));
    expect(q).toMatchObject({ cents: 30000000, blocks: 3, block_minutes: 60 });
    expect(prisma.products.findFirst).not.toHaveBeenCalled();
  });

  describe('station rental tax (H-2: the quote is the gross of the POS line)', () => {
    const vat = (is_inclusive: boolean) => [
      { tax_rate_id: 3, name: 'IVA 19%', rate: 0.19, tax_type: 'iva', is_inclusive },
    ];
    const stationWithTax = (over: Record<string, unknown>) => ({
      id: 5,
      rental_block_minutes: 60,
      rental_block_price: 80000,
      rental_tax_category_id: 9,
      ...over,
    });

    it('an exclusive station tax is added on top: amount = gross, published stays the net price', async () => {
      prisma.service_stations.findFirst.mockResolvedValue(stationWithTax({ rental_tax_is_inclusive: false }));
      shippingTax.taxRowsForCategory.mockResolvedValue(vat(false));
      const q = await run(() => service.quote({ productId: 1, stationId: 5, startAt }));
      expect(shippingTax.taxRowsForCategory).toHaveBeenCalledWith(
        null,
        { tax_category_id: 9, tax_is_inclusive: false, store_id: 10 },
      );
      expect(q).toMatchObject({ amount: 238000, cents: 23800000, published_amount: 200000, pricing_mode: 'station_rate' });
      expect(q.tax_rows).toHaveLength(1);
    });

    it('an inclusive station tax keeps the published price as the gross amount', async () => {
      prisma.service_stations.findFirst.mockResolvedValue(stationWithTax({ rental_tax_is_inclusive: true }));
      shippingTax.taxRowsForCategory.mockResolvedValue(vat(true));
      const q = await run(() => service.quote({ productId: 1, stationId: 5, startAt }));
      expect(q).toMatchObject({ amount: 200000, cents: 20000000, published_amount: 200000 });
    });

    it('without a rental tax category the amounts are exactly the published price', async () => {
      const q = await run(() => service.quote({ productId: 1, stationId: 5, startAt }));
      expect(q).toMatchObject({ amount: 200000, cents: 20000000, published_amount: 200000, tax_rows: [] });
    });

    it('fixed_price never applies the station tax (the product price is the rental)', async () => {
      prisma.products.findFirst.mockResolvedValue(product({ rental_pricing_mode: 'fixed_price', base_price: 70000 }));
      const q = await run(() => service.quote({ productId: 1, stationId: 5, startAt }));
      expect(q.amount).toBe(70000);
      expect(shippingTax.taxRowsForCategory).not.toHaveBeenCalled();
    });
  });
});
