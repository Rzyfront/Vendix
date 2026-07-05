import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { VendixHttpException } from '../../../../common/errors';

describe('InventoryReconciliationService', () => {
  const fiscal_period = {
    id: 10,
    name: 'Enero 2026',
    start_date: new Date('2026-01-01'),
    end_date: new Date('2026-01-31'),
    accounting_entity_id: 77,
  };

  const createService = (overrides: any = {}) => {
    const base_prisma_client = {
      inventory_valuation_snapshots: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides.base_prisma_client,
    };

    const prisma = {
      fiscal_periods: {
        findFirst: jest.fn().mockResolvedValue(fiscal_period),
      },
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue({ id: 77 }),
      },
      chart_of_accounts: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      accounting_entries: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      accounting_entry_lines: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      withoutScope: jest.fn().mockReturnValue(base_prisma_client),
      ...overrides.prisma,
    };

    const service = new InventoryReconciliationService(prisma as any);
    return { service, prisma, base_prisma_client };
  };

  it('BUGFIX: consolidates inventory_valuation_snapshots across multiple stores under the same fiscal entity via withoutScope()', async () => {
    // Regression for the scope leak: inventory_valuation_snapshots is not in
    // fiscal_entity_scoped_models, so the scoped getter would silently filter
    // by the request's store_id. This test asserts the query goes through
    // withoutScope() and returns snapshots from TWO different stores/locations
    // (location_id 1 and location_id 2) consolidated under one
    // accounting_entity_id, as a fiscal_scope=ORGANIZATION setup requires.
    const store_a_snapshot = {
      location_id: 1,
      product_id: 100,
      product_variant_id: null,
      snapshot_at: new Date('2026-01-15'),
      quantity_on_hand: 10,
      unit_cost: 5,
      total_value: 50,
      costing_method: 'CPP',
      inventory_location: { id: 1, name: 'Bodega Tienda A' },
      product: { id: 100, name: 'Producto X', sku: 'SKU-X' },
      product_variant: null,
    };
    const store_b_snapshot = {
      location_id: 2,
      product_id: 200,
      product_variant_id: null,
      snapshot_at: new Date('2026-01-16'),
      quantity_on_hand: 20,
      unit_cost: 3,
      total_value: 60,
      costing_method: 'CPP',
      inventory_location: { id: 2, name: 'Bodega Tienda B' },
      product: { id: 200, name: 'Producto Y', sku: 'SKU-Y' },
      product_variant: null,
    };

    const { service, prisma, base_prisma_client } = createService({
      base_prisma_client: {
        inventory_valuation_snapshots: {
          findMany: jest
            .fn()
            .mockResolvedValue([store_b_snapshot, store_a_snapshot]),
        },
      },
    });

    const result = await service.getInventoryReconciliation({
      fiscal_period_id: 10,
    } as any);

    // withoutScope() was used for the inventory side (not the scoped getter).
    expect(prisma.withoutScope).toHaveBeenCalled();
    expect(
      base_prisma_client.inventory_valuation_snapshots.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accounting_entity_id: 77 }),
      }),
    );

    // Both stores' snapshots are consolidated — not just one.
    expect(result.inventory_side.snapshot_count).toBe(2);
    expect(result.inventory_side.total_value).toBe(110); // 50 + 60
  });

  it('SECURITY: rejects an accounting_entity_id that does not belong to the current organization before querying without scope', async () => {
    const { service, prisma, base_prisma_client } = createService({
      prisma: {
        accounting_entities: {
          // Scoped lookup finds nothing => entity does not belong to this org.
          findFirst: jest.fn().mockResolvedValue(null),
        },
      },
    });

    await expect(
      service.getInventoryReconciliation({
        fiscal_period_id: 10,
        accounting_entity_id: 999, // foreign/attacker-supplied id
      } as any),
    ).rejects.toThrow(VendixHttpException);

    // Must fail BEFORE ever reaching the unscoped inventory query.
    expect(prisma.withoutScope).not.toHaveBeenCalled();
    expect(
      base_prisma_client.inventory_valuation_snapshots.findMany,
    ).not.toHaveBeenCalled();
  });
});
