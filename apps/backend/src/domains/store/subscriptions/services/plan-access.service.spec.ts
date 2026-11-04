import { PlanAccessService, upgradeUrl } from './plan-access.service';

describe('PlanAccessService', () => {
  const OFFERS = {
    invoicing: [
      { code: 'empresarial-pro-monthly', name: 'Empresarial Pro', price: 89900, currency: 'COP', cycle: 'monthly' },
      { code: 'empresarial-pro-annual', name: 'Empresarial Pro', price: 899000, currency: 'COP', cycle: 'annual' },
    ],
    flows: [
      { code: 'ia-business', name: 'IA Business', price: 190000, currency: 'COP', cycle: 'monthly' },
    ],
  } as Record<string, any[]>;

  const BLOCKED: Record<string, string[]> = {
    'vendix-impulsa': ['flows', 'invoicing'],
    'empresarial-pro-monthly': ['flows'],
    'ia-business': [],
  };

  const build = (opts: {
    planByStore?: Record<number, string | null>;
    found?: boolean;
    orgStores?: number[];
    planMode?: 'audit' | 'enforce';
    resolverError?: boolean;
  }) => {
    const resolver: any = {
      resolveSubscription: jest.fn(async (storeId: number) => {
        if (opts.resolverError) throw new Error('redis down');
        const code = opts.planByStore?.[storeId] ?? null;
        return { found: opts.found ?? true, planCode: code ?? '' };
      }),
    };
    const rules: any = {
      blockedModules: jest.fn(async (code: string) => BLOCKED[code] ?? []),
      offersFor: jest.fn(async (key: string) => OFFERS[key] ?? []),
      planByCode: jest.fn(async (code: string) =>
        code === 'vendix-impulsa'
          ? { code, name: 'Vendix Impulsa', price: 49900, currency: 'COP', cycle: 'monthly' }
          : code === 'empresarial-pro-monthly'
            ? { code, name: 'Empresarial Pro', price: 89900, currency: 'COP', cycle: 'monthly' }
            : null,
      ),
    };
    const mode: any = {
      planModeForStore: jest.fn(async () => opts.planMode ?? 'audit'),
      planModeForOrganization: jest.fn(async () => opts.planMode ?? 'audit'),
    };
    const prisma: any = {
      stores: {
        findMany: jest.fn(async () => (opts.orgStores ?? []).map((id) => ({ id }))),
      },
      subscription_plans: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.code === 'starter'
            ? { code: 'starter', name: 'Starter', billing_cycle: 'monthly' }
            : null,
        ),
      },
    };
    const svc = new PlanAccessService(resolver, rules, mode, prisma);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return { svc, resolver, rules, prisma };
  };

  it('store state: current plan, blocked keys and the plans that include each one', async () => {
    const { svc } = build({ planByStore: { 7: 'vendix-impulsa' } });
    const state = await svc.storeState(7);
    expect(state).toEqual({
      mode: 'audit',
      current_plan: { code: 'vendix-impulsa', name: 'Vendix Impulsa', cycle: 'monthly' },
      blocked: ['flows', 'invoicing'],
      required_plans: { flows: OFFERS.flows, invoicing: OFFERS.invoicing },
    });
  });

  it('store state carries the plan layer mode (enforce flag)', async () => {
    const { svc } = build({ planByStore: { 7: 'empresarial-pro-monthly' }, planMode: 'enforce' });
    const state = await svc.storeState(7);
    expect(state.mode).toBe('enforce');
    expect(state.blocked).toEqual(['flows']);
  });

  it('a plan outside the matrix keeps its name and blocks nothing', async () => {
    const { svc } = build({ planByStore: { 7: 'starter' } });
    const state = await svc.storeState(7);
    expect(state.current_plan).toEqual({ code: 'starter', name: 'Starter', cycle: 'monthly' });
    expect(state.blocked).toEqual([]);
  });

  it('no subscription, no store or resolver failure → nothing blocked', async () => {
    await expect(build({ found: false }).svc.storeState(7)).resolves.toMatchObject({
      current_plan: null,
      blocked: [],
    });
    await expect(build({}).svc.storeState(null)).resolves.toMatchObject({ blocked: [] });
    await expect(
      build({ resolverError: true }).svc.storeState(7),
    ).resolves.toMatchObject({ current_plan: null, blocked: [] });
  });

  it('organization: a key is blocked only when every active store lacks it', async () => {
    const { svc } = build({
      planByStore: { 1: 'vendix-impulsa', 2: 'empresarial-pro-monthly' },
      orgStores: [1, 2],
    });
    await expect(svc.blockedForOrganization(9)).resolves.toEqual(['flows']);
    const state = await svc.organizationState(9);
    expect(state.blocked).toEqual(['flows']);
    expect(state.current_plan).toBeNull();
  });

  it('organization with an IA Business store or without stores blocks nothing', async () => {
    const withIa = build({
      planByStore: { 1: 'vendix-impulsa', 2: 'ia-business' },
      orgStores: [1, 2],
    });
    await expect(withIa.svc.blockedForOrganization(9)).resolves.toEqual([]);
    await expect(build({ orgStores: [] }).svc.blockedForOrganization(9)).resolves.toEqual([]);
  });

  it('denial payload: module, its name, current plan, offers and upgrade URL on the same cycle', async () => {
    const { svc } = build({});
    const current = { code: 'vendix-impulsa', name: 'Vendix Impulsa', cycle: 'annual' };
    await expect(svc.denial('invoicing', current)).resolves.toEqual({
      module: 'invoicing',
      module_name: 'Facturación electrónica',
      current_plan: current,
      required_plans: OFFERS.invoicing,
      upgrade_url:
        '/admin/subscription/plans?plan=empresarial-pro-annual&cycle=annual&from=invoicing',
    });
  });

  it('denial falls back to the cheapest offer, and to a bare from= when none exists', async () => {
    const { svc } = build({});
    const flows = await svc.denial('flows', null);
    expect(flows.upgrade_url).toBe(
      '/admin/subscription/plans?plan=ia-business&cycle=monthly&from=flows',
    );
    const unknown = await svc.denial('unknown_key', null);
    expect(unknown).toMatchObject({ module_name: null, required_plans: [] });
    expect(unknown.upgrade_url).toBe('/admin/subscription/plans?from=unknown_key');
    expect(upgradeUrl('x', null)).toBe('/admin/subscription/plans?from=x');
  });
});
