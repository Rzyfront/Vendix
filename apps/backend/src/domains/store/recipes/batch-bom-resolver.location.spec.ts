import { probeConsumableStock, probeSellableStock } from './batch-bom-resolver';

/**
 * QUI-990 (gate #1128, H4) — the sale consumes a batch preparation from ONE
 * location, so the stock it takes is capped at that location's available, not
 * the store-wide total.
 */
describe('probeConsumableStock', () => {
  // 3 units in location 7 (the default one) and 1 in location 9: 4 in total.
  const byLocation: Record<number, number> = { 7: 3, 9: 1 };
  const validator = {
    findInsufficientLines: jest.fn(
      async (_lines: unknown, opts: { locationId?: number }) => [
        {
          available:
            opts.locationId != null
              ? (byLocation[opts.locationId] ?? 0)
              : Object.values(byLocation).reduce((a, b) => a + b, 0),
        },
      ],
    ),
  };

  beforeEach(() => validator.findInsufficientLines.mockClear());

  it('caps the store-wide total at the consumption location', async () => {
    const locator = { getDefaultLocationForProduct: jest.fn(async () => 7) };
    await expect(probeSellableStock(validator as any, 5)).resolves.toBe(4);
    await expect(probeConsumableStock(validator as any, locator as any, 5)).resolves.toBe(3);
    expect(locator.getDefaultLocationForProduct).toHaveBeenCalledWith(5, undefined, undefined);
    expect(validator.findInsufficientLines).toHaveBeenLastCalledWith(
      [{ product_id: 5, quantity: Number.MAX_SAFE_INTEGER }],
      expect.objectContaining({ kind: 'ingredient', locationId: 7 }),
    );
  });

  it('takes nothing when there is no location to consume from', async () => {
    const locator = {
      getDefaultLocationForProduct: jest.fn(async () => {
        throw new Error('INV_LOC_001');
      }),
    };
    await expect(probeConsumableStock(validator as any, locator as any, 5)).resolves.toBe(0);
  });

  it('an untracked product (no stock row) reports 0 without asking for a location', async () => {
    const untracked = { findInsufficientLines: jest.fn(async () => []) };
    const locator = { getDefaultLocationForProduct: jest.fn(async () => 7) };
    await expect(probeConsumableStock(untracked as any, locator as any, 5)).resolves.toBe(0);
    expect(locator.getDefaultLocationForProduct).not.toHaveBeenCalled();
  });
});
