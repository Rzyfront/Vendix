import {
  PLAN_RULES_CACHE_TTL_MS,
  PlanModuleRulesService,
} from './plan-module-rules.service';

type Mode = 'exclusive' | 'blocked';

const plan = (
  code: string,
  price: number,
  extra: Partial<{
    state: string;
    archived_at: Date | null;
    is_promotional: boolean;
    billing_cycle: string;
    sort_order: number;
  }> = {},
) => ({
  code,
  name: code.toUpperCase(),
  base_price: { toString: () => String(price), valueOf: () => price },
  currency: 'COP',
  billing_cycle: extra.billing_cycle ?? 'monthly',
  state: extra.state ?? 'active',
  archived_at: extra.archived_at ?? null,
  is_promotional: extra.is_promotional ?? false,
  sort_order: extra.sort_order ?? 0,
});

const row = (p: ReturnType<typeof plan>, module_key: string, mode: Mode) => ({
  module_key,
  mode,
  plan: p,
});

describe('PlanModuleRulesService', () => {
  const impulsa = plan('vendix-impulsa', 49900);
  const empresarial = plan('empresarial-pro-monthly', 89900);
  const empresarialAnnual = plan('empresarial-pro-annual', 899000, {
    billing_cycle: 'annual',
  });
  const iaBusiness = plan('ia-business', 190000);
  const archivedIa = plan('ia-business-old', 10, {
    archived_at: new Date('2026-01-01'),
  });

  const ROWS = [
    row(impulsa, 'invoicing', 'blocked'),
    row(empresarial, 'invoicing', 'exclusive'),
    row(empresarialAnnual, 'invoicing', 'exclusive'),
    row(iaBusiness, 'invoicing', 'exclusive'),
    row(iaBusiness, 'flows', 'exclusive'),
    row(archivedIa, 'flows', 'exclusive'),
  ];

  const build = (findMany: jest.Mock) => {
    const prisma: any = { plan_module_rules: { findMany } };
    const svc = new PlanModuleRulesService(prisma);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return svc;
  };

  it('blocked modules follow the matrix semantics', async () => {
    const svc = build(jest.fn().mockResolvedValue(ROWS));
    await expect(svc.blockedModules('vendix-impulsa')).resolves.toEqual([
      'flows',
      'invoicing',
    ]);
    await expect(svc.blockedModules('empresarial-pro-monthly')).resolves.toEqual([
      'flows',
    ]);
    await expect(svc.blockedModules('ia-business')).resolves.toEqual([]);
    await expect(svc.blockedModules('starter')).resolves.toEqual([]);
  });

  it('offers: only sellable plans, cheapest first, with public data', async () => {
    const svc = build(jest.fn().mockResolvedValue(ROWS));
    await expect(svc.offersFor('invoicing')).resolves.toEqual([
      {
        code: 'empresarial-pro-monthly',
        name: 'EMPRESARIAL-PRO-MONTHLY',
        price: 89900,
        currency: 'COP',
        cycle: 'monthly',
      },
      {
        code: 'ia-business',
        name: 'IA-BUSINESS',
        price: 190000,
        currency: 'COP',
        cycle: 'monthly',
      },
      {
        code: 'empresarial-pro-annual',
        name: 'EMPRESARIAL-PRO-ANNUAL',
        price: 899000,
        currency: 'COP',
        cycle: 'annual',
      },
    ]);
    // The archived IA plan carries an exclusive row but is not offered.
    const flows = await svc.offersFor('flows');
    expect(flows.map((o) => o.code)).toEqual(['ia-business']);
  });

  it('caches the table for the TTL and reloads after invalidate()', async () => {
    const findMany = jest.fn().mockResolvedValue(ROWS);
    const svc = build(findMany);
    await svc.blockedModules('vendix-impulsa');
    await svc.offersFor('invoicing');
    expect(findMany).toHaveBeenCalledTimes(1);
    svc.invalidate();
    await svc.blockedModules('vendix-impulsa');
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(PLAN_RULES_CACHE_TTL_MS).toBe(60_000);
  });

  it('DB failure with no snapshot → empty matrix (nothing blocked)', async () => {
    const svc = build(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(svc.blockedModules('vendix-impulsa')).resolves.toEqual([]);
    await expect(svc.offersFor('invoicing')).resolves.toEqual([]);
  });

  it('DB failure on a TTL refresh keeps the last good snapshot', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(ROWS)
      .mockRejectedValue(new Error('db down'));
    const svc = build(findMany);
    await svc.blockedModules('vendix-impulsa');
    const later = Date.now() + PLAN_RULES_CACHE_TTL_MS + 1;
    const snapshot = await (svc as any).load(later);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(snapshot.rules).toHaveLength(ROWS.length);
  });

  it('planByCode returns public data for plans that carry rules', async () => {
    const svc = build(jest.fn().mockResolvedValue(ROWS));
    await expect(svc.planByCode('empresarial-pro-annual')).resolves.toEqual({
      code: 'empresarial-pro-annual',
      name: 'EMPRESARIAL-PRO-ANNUAL',
      price: 899000,
      currency: 'COP',
      cycle: 'annual',
    });
    await expect(svc.planByCode('starter')).resolves.toBeNull();
    await expect(svc.planByCode(null)).resolves.toBeNull();
  });
});
