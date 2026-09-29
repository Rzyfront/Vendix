import {
  AccountMappingService,
  buildMappingKeyCatalog,
} from './account-mapping.service';

describe('D.2 prepared disposition mappings without seed rows', () => {
  const expected = {
    'order_item.prepared_waste.shrinkage': '5295',
    'order_item.prepared_reuse.inventory': '1435',
    'order_item.prepared_disposition.cogs': '6135',
  };

  it('advertises the keys and defaults in the backend catalog', () => {
    const catalog = buildMappingKeyCatalog();
    for (const [key, code] of Object.entries(expected)) {
      expect(catalog).toContainEqual(expect.objectContaining({
        key, default_code: code,
        label: expect.stringContaining('plato preparado'),
      }));
    }
  });

  it('resolves each key at runtime when this store has no seeded mapping row', async () => {
    const base = {
      stores: { findFirst: jest.fn().mockResolvedValue({ id: 4 }) },
      accounting_account_mappings: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new AccountMappingService(
      { withoutScope: jest.fn().mockReturnValue(base) } as any,
      { get: jest.fn().mockResolvedValue(null), set: jest.fn() } as any,
      {} as any,
      { requireFiscalScope: jest.fn().mockResolvedValue('STORE') } as any,
    );
    for (const [key, code] of Object.entries(expected)) {
      await expect(service.getMapping(2, key, 4)).resolves.toEqual({
        account_code: code, source: 'default',
      });
    }
    expect(base.accounting_account_mappings.findFirst).toHaveBeenCalledTimes(3);
  });
});
