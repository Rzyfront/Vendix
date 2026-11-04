import { PlanAccessGuard } from './plan-access.guard';
import { VendixHttpException } from '../../../../common/errors';

describe('PlanAccessGuard', () => {
  const CURRENT = { code: 'vendix-impulsa', name: 'Vendix Impulsa', cycle: 'monthly' };
  const DENIAL = {
    module: 'invoicing',
    module_name: 'Facturación electrónica',
    current_plan: CURRENT,
    required_plans: [
      { code: 'empresarial-pro-monthly', name: 'Empresarial Pro', price: 89900, currency: 'COP', cycle: 'monthly' },
    ],
    upgrade_url: '/admin/subscription/plans?plan=empresarial-pro-monthly&cycle=monthly&from=invoicing',
  };

  const build = (opts: {
    storeBlocked?: string[];
    orgBlocked?: string[];
    mode?: 'audit' | 'enforce';
    isPublic?: boolean;
    planError?: boolean;
  } = {}) => {
    const reflector: any = { getAllAndOverride: jest.fn(() => opts.isPublic ?? false) };
    const planAccess: any = {
      blockedForStore: jest.fn(async () => {
        if (opts.planError) throw new Error('boom');
        return { current: CURRENT, blocked: opts.storeBlocked ?? [] };
      }),
      blockedForOrganization: jest.fn(async () => opts.orgBlocked ?? []),
      denial: jest.fn(async () => DENIAL),
    };
    const mode: any = {
      planModeForStore: jest.fn(async () => opts.mode ?? 'audit'),
      planModeForOrganization: jest.fn(async () => opts.mode ?? 'audit'),
    };
    const audit: any = { record: jest.fn() };
    const guard = new PlanAccessGuard(reflector, planAccess, mode, audit);
    return { guard, planAccess, mode, audit };
  };

  const ctx = (url: string, user: any = { id: 3, store_id: 7, organization_id: 9, roles: ['owner'] }) =>
    ({
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', originalUrl: url, url, user }),
      }),
    }) as any;

  it('audit (default): lets through and records would_block on layer plan', async () => {
    const { guard, audit } = build({ storeBlocked: ['invoicing'] });
    await expect(guard.canActivate(ctx('/api/store/invoicing/invoices'))).resolves.toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'backend',
        surface: 'api',
        layer: 'plan',
        decision: 'would_block',
        key: 'invoicing',
        store_id: 7,
        user_id: 3,
        role: 'owner',
        mode: 'audit',
        route: 'GET /api/store/invoicing/invoices',
      }),
    );
  });

  it('enforce: records blocked and throws 403 PLAN_MODULE_NOT_INCLUDED with the paywall payload', async () => {
    const { guard, audit } = build({ storeBlocked: ['invoicing'], mode: 'enforce' });
    let error: unknown;
    try {
      await guard.canActivate(ctx('/api/store/invoicing'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VendixHttpException);
    const http = error as VendixHttpException;
    expect(http.getStatus()).toBe(403);
    expect(http.getResponse()).toEqual({
      error_code: 'PLAN_MODULE_NOT_INCLUDED',
      message: 'Tu plan actual no incluye este módulo.',
      details: DENIAL,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'blocked', layer: 'plan', mode: 'enforce' }),
    );
  });

  it('module included in the plan: passes without logging', async () => {
    const { guard, audit, mode } = build({ storeBlocked: ['flows'], mode: 'enforce' });
    await expect(guard.canActivate(ctx('/api/store/payroll/runs'))).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
    expect(mode.planModeForStore).not.toHaveBeenCalled();
  });

  it.each([
    '/api/store/dashboard/summary',
    '/api/store/subscriptions/current',
    '/api/store/products',
    '/api/store/taxes',
    '/api/store/invoicing/scan-draft/upload',
    '/api/health',
  ])('unmapped or exempt path %s never consults the plan', async (url) => {
    const { guard, planAccess } = build({ storeBlocked: ['invoicing'], mode: 'enforce' });
    await expect(guard.canActivate(ctx(url))).resolves.toBe(true);
    expect(planAccess.blockedForStore).not.toHaveBeenCalled();
  });

  it('public routes and super admin pass', async () => {
    const pub = build({ isPublic: true, storeBlocked: ['invoicing'], mode: 'enforce' });
    await expect(pub.guard.canActivate(ctx('/api/store/invoicing'))).resolves.toBe(true);
    const sa = build({ storeBlocked: ['invoicing'], mode: 'enforce' });
    await expect(
      sa.guard.canActivate(ctx('/api/store/invoicing', { id: 1, store_id: 7, roles: ['super_admin'] })),
    ).resolves.toBe(true);
    expect(sa.planAccess.blockedForStore).not.toHaveBeenCalled();
  });

  it('organization path uses the organization union and its flag', async () => {
    const { guard, planAccess, mode } = build({ orgBlocked: ['payroll'], mode: 'enforce' });
    await expect(
      guard.canActivate(ctx('/api/organization/payroll/settings', { id: 2, organization_id: 9, roles: ['owner'] })),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(planAccess.blockedForOrganization).toHaveBeenCalledWith(9);
    expect(mode.planModeForOrganization).toHaveBeenCalled();
    expect(planAccess.blockedForStore).not.toHaveBeenCalled();
  });

  it('internal failure or missing user lets the request through', async () => {
    const failing = build({ planError: true, mode: 'enforce' });
    await expect(failing.guard.canActivate(ctx('/api/store/invoicing'))).resolves.toBe(true);
    const anon = build({ storeBlocked: ['invoicing'], mode: 'enforce' });
    await expect(anon.guard.canActivate(ctx('/api/store/invoicing', null))).resolves.toBe(true);
  });
});
