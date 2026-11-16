import { CostingMethodResolverService } from './costing-method-resolver.service';

/**
 * The resolver reads the ORG → STORE costing setting. A stock movement runs
 * inside an open transaction, so it can hand its own client to the resolver:
 * the read then stays on the transaction's connection instead of asking the
 * pool for another one. The precedence and the mappings must not change.
 */
describe('CostingMethodResolverService', () => {
  const settingsClient = (org: unknown, store: unknown) => ({
    organization_settings: {
      findUnique: jest
        .fn()
        .mockResolvedValue(org === undefined ? null : { settings: { inventory: { costing_method: org } } }),
    },
    store_settings: {
      findUnique: jest
        .fn()
        .mockResolvedValue(store === undefined ? null : { settings: { inventory: { costing_method: store } } }),
    },
  });

  it('with a transaction client, reads the settings on that client and never on the global one', async () => {
    const globalPrisma = settingsClient('weighted_average', undefined);
    const tx = settingsClient('fifo', undefined);
    const resolver = new CostingMethodResolverService(globalPrisma as any);

    await expect(resolver.resolveCostingMethod(1, 10, tx as any)).resolves.toBe('fifo');

    expect(tx.organization_settings.findUnique).toHaveBeenCalledWith({
      where: { organization_id: 1 },
      select: { settings: true },
    });
    expect(globalPrisma.organization_settings.findUnique).not.toHaveBeenCalled();
    expect(globalPrisma.store_settings.findUnique).not.toHaveBeenCalled();
  });

  it('with a transaction client, the store fallback also stays on that client (cpp → weighted_average)', async () => {
    const globalPrisma = settingsClient(undefined, 'fifo');
    const tx = settingsClient(undefined, 'cpp');
    const resolver = new CostingMethodResolverService(globalPrisma as any);

    await expect(resolver.resolveCostingMethod(1, 10, tx as any)).resolves.toBe('weighted_average');

    expect(tx.store_settings.findUnique).toHaveBeenCalledWith({
      where: { store_id: 10 },
      select: { settings: true },
    });
    expect(globalPrisma.store_settings.findUnique).not.toHaveBeenCalled();
  });

  it('without a client it keeps reading the global client with the same precedence', async () => {
    const globalPrisma = settingsClient(undefined, 'fifo');
    const resolver = new CostingMethodResolverService(globalPrisma as any);

    await expect(resolver.resolveCostingMethod(1, 10)).resolves.toBe('fifo');
    expect(globalPrisma.organization_settings.findUnique).toHaveBeenCalledTimes(1);
    expect(globalPrisma.store_settings.findUnique).toHaveBeenCalledTimes(1);
  });

  it('ORG wins over STORE and lifo degrades to weighted_average (unchanged)', async () => {
    const resolver = new CostingMethodResolverService(settingsClient('lifo', 'fifo') as any);

    await expect(resolver.resolveCostingMethod(1, 10)).resolves.toBe('weighted_average');
  });

  it('no setting anywhere falls back to weighted_average (unchanged)', async () => {
    const resolver = new CostingMethodResolverService(settingsClient(undefined, undefined) as any);

    await expect(resolver.resolveCostingMethod(1, 10)).resolves.toBe('weighted_average');
  });
});
