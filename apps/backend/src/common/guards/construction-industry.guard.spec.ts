import { ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConstructionIndustryGuard } from './construction-industry.guard';
import { PermissionsGuard } from '../../domains/auth/guards/permissions.guard';

describe('ConstructionIndustryGuard contract access', () => {
  const stores = { findUnique: jest.fn() };
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user: { store_id: 12 } }) }),
  } as unknown as ExecutionContext;
  const guard = new ConstructionIndustryGuard({ stores } as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [['construction']],
    [['construction', 'retail']],
  ])('allows construction-capable industry combination %j', async (industries) => {
    stores.findUnique.mockResolvedValue({ industries });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([[[]], [['retail']]])(
    'rejects stores without construction industry %j with 403 CONTRACT_INDUSTRY_001',
    async (industries) => {
      stores.findUnique.mockResolvedValue({ industries });

      const error = await guard.canActivate(context).catch((value) => value);

      expect(error.getStatus()).toBe(403);
      expect(error.errorCode).toBe('CONTRACT_INDUSTRY_001');
    },
  );
});

describe('Contracts GET permission boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects GET /api/store/contracts when read permission is absent', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const handler = jest.fn();
    const controller = jest.fn();
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['store:contracts:read']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          route: { path: '/api/store/contracts' },
          user: { store_id: 12, roles: [], permissions: [] },
        }),
      }),
    } as unknown as ExecutionContext;

    const error = (() => {
      try {
        guard.canActivate(context);
        return null;
      } catch (value) {
        return value;
      }
    })();
    expect(error).toMatchObject({ errorCode: 'AUTH_PERM_001' });
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('permissions', [
      handler,
      controller,
    ]);
  });
});
