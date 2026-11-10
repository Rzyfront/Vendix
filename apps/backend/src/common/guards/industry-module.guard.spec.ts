import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IndustryModuleGuard } from './industry-module.guard';
import { INDUSTRY_MODULE_KEY } from '../decorators/industry-module.decorator';
import { VendixHttpException } from '../errors';

const makeCtx = (user: any, route: any = { path: '/api/store/recipes/:id' }) =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        method: 'GET',
        route,
        originalUrl: '/api/store/recipes/5?x=1',
      }),
    }),
  }) as unknown as ExecutionContext;

describe('IndustryModuleGuard', () => {
  let prisma: any;
  let mode: any;
  let audit: any;
  let reflector: Reflector;
  let guard: IndustryModuleGuard;

  const build = (key: string | null = 'restaurant_ops_recipes') => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(key) } as any;
    guard = new IndustryModuleGuard(reflector, prisma, mode, audit);
  };

  beforeEach(() => {
    prisma = { stores: { findUnique: jest.fn() } };
    mode = { modeForStore: jest.fn().mockResolvedValue('audit') };
    audit = { record: jest.fn() };
    build();
  });

  const user = { id: 9, store_id: 3, organization_id: 2, roles: ['admin'] };

  it('reads the key from the decorator metadata', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['restaurant'] });
    await guard.canActivate(makeCtx(user));
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      INDUSTRY_MODULE_KEY,
      expect.any(Array),
    );
  });

  it('passes without logging when the industry allows the key', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['restaurant'] });
    await expect(guard.canActivate(makeCtx(user))).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('audit mode: passes and records would_block once', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    await expect(guard.canActivate(makeCtx(user))).resolves.toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'backend',
        surface: 'api',
        decision: 'would_block',
        layer: 'industry',
        key: 'restaurant_ops_recipes',
        store_id: 3,
        organization_id: 2,
        user_id: 9,
        role: 'admin',
        industry: ['retail'],
        mode: 'audit',
        route: 'GET /api/store/recipes/:id',
      }),
    );
  });

  it('enforce mode: records blocked and throws 403 MODULE_INDUSTRY_001', async () => {
    mode.modeForStore.mockResolvedValue('enforce');
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    let error: any;
    try {
      await guard.canActivate(makeCtx(user));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('MODULE_INDUSTRY_001');
    expect(error.getStatus()).toBe(403);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'blocked', mode: 'enforce' }),
    );
  });

  it.each(['orders_scheduled', 'products_option_groups'])(
    'QUI-1001 %s: denied for retail (enforce), allowed for restaurant',
    async (key) => {
      build(key);
      mode.modeForStore.mockResolvedValue('enforce');
      prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
      await expect(guard.canActivate(makeCtx(user))).rejects.toMatchObject({
        errorCode: 'MODULE_INDUSTRY_001',
      });
      prisma.stores.findUnique.mockResolvedValue({ industries: ['restaurant'] });
      await expect(guard.canActivate(makeCtx(user))).resolves.toBe(true);
    },
  );

  it('flows: blocks a non-administration store even in audit mode', async () => {
    build('flows');
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    let error: any;
    try {
      await guard.canActivate(makeCtx(user));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('MODULE_INDUSTRY_001');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'blocked', mode: 'audit', key: 'flows' }),
    );
  });

  it('documents: passes for an administration store', async () => {
    build('documents');
    prisma.stores.findUnique.mockResolvedValue({
      industries: ['retail', 'administration'],
    });
    await expect(guard.canActivate(makeCtx(user))).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('passes when there is no store in context or the store is unknown', async () => {
    await expect(
      guard.canActivate(makeCtx({ id: 1, store_id: null })),
    ).resolves.toBe(true);
    prisma.stores.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(makeCtx(user))).resolves.toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats empty industries as retail', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: [] });
    await guard.canActivate(makeCtx(user));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ industry: ['retail'], decision: 'would_block' }),
    );
  });

  it('passes without a decorator key', async () => {
    build(null);
    await expect(guard.canActivate(makeCtx(user))).resolves.toBe(true);
    expect(prisma.stores.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the path without query when there is no route pattern', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    await guard.canActivate(makeCtx(user, null));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'GET /api/store/recipes/5' }),
    );
  });
});
