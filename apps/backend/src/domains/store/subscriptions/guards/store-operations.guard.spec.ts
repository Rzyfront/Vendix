import { Reflector } from '@nestjs/core';
import { StoreOperationsGuard } from './store-operations.guard';
import { SubscriptionAccessService } from '../services/subscription-access.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from '../../../../common/errors';

type AccessMock = jest.Mocked<Pick<SubscriptionAccessService, 'canUseModule'>>;

describe('StoreOperationsGuard', () => {
  let guard: StoreOperationsGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let access: AccessMock;
  let setHeader: jest.Mock;
  let logger: { warn: jest.SpyInstance };

  const originalStoreEnforce = process.env.STORE_GATE_ENFORCE;
  const originalAiEnforce = process.env.AI_GATE_ENFORCE;
  const originalGetStoreId = RequestContextService.getStoreId;

  function buildCtx(opts: {
    method?: string;
    path?: string;
    handler?: any;
    class?: any;
  }) {
    const handler = opts.handler ?? function handler() {};
    const cls = opts.class ?? class CtrlStub {};
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({
          method: opts.method ?? 'POST',
          path: opts.path ?? '/api/store/orders',
        }),
        getResponse: () => ({ setHeader }),
      }),
    } as any;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    access = { canUseModule: jest.fn() };
    setHeader = jest.fn();
    guard = new StoreOperationsGuard(reflector as any, access as any);
    logger = {
      warn: jest
        .spyOn((guard as any).logger, 'warn')
        .mockImplementation(() => undefined),
    };

    // Default: store context present.
    (RequestContextService as any).getStoreId = jest.fn().mockReturnValue(123);

    delete process.env.STORE_GATE_ENFORCE;
    delete process.env.AI_GATE_ENFORCE;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (RequestContextService as any).getStoreId = originalGetStoreId;
    if (originalStoreEnforce === undefined)
      delete process.env.STORE_GATE_ENFORCE;
    else process.env.STORE_GATE_ENFORCE = originalStoreEnforce;
    if (originalAiEnforce === undefined) delete process.env.AI_GATE_ENFORCE;
    else process.env.AI_GATE_ENFORCE = originalAiEnforce;
  });

  it('bypasses when @SkipSubscriptionGate() is set', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ok = await guard.canActivate(buildCtx({}));
    expect(ok).toBe(true);
    expect(access.canUseModule).not.toHaveBeenCalled();
  });

  it('bypasses GET (non-write) requests', async () => {
    const ok = await guard.canActivate(buildCtx({ method: 'GET' }));
    expect(ok).toBe(true);
    expect(access.canUseModule).not.toHaveBeenCalled();
  });

  it('bypasses paths outside /api/store/', async () => {
    const ok = await guard.canActivate(
      buildCtx({ path: '/api/superadmin/foo' }),
    );
    expect(ok).toBe(true);
    expect(access.canUseModule).not.toHaveBeenCalled();
  });

  it('bypasses /api/store/subscriptions/** allowlist', async () => {
    const ok = await guard.canActivate(
      buildCtx({ path: '/api/store/subscriptions/subscribe' }),
    );
    expect(ok).toBe(true);
    expect(access.canUseModule).not.toHaveBeenCalled();
  });

  it('blocks when state=suspended and enforce=true', async () => {
    process.env.STORE_GATE_ENFORCE = 'true';
    access.canUseModule.mockResolvedValue({
      allowed: false,
      mode: 'block',
      severity: 'critical',
      reason: 'SUBSCRIPTION_008',
      subscription_state: 'suspended',
    } as any);

    let caught: unknown;
    try {
      await guard.canActivate(buildCtx({}));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VendixHttpException);
  });

  it('passes (log-only) when state=suspended and enforce=false', async () => {
    access.canUseModule.mockResolvedValue({
      allowed: false,
      mode: 'block',
      severity: 'critical',
      reason: 'SUBSCRIPTION_008',
      subscription_state: 'suspended',
    } as any);

    const ok = await guard.canActivate(buildCtx({}));
    expect(ok).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('passes + sets X-Subscription-Warning when state=grace_soft', async () => {
    access.canUseModule.mockResolvedValue({
      allowed: true,
      mode: 'warn',
      severity: 'warning',
      reason: 'SUBSCRIPTION_007',
      subscription_state: 'grace_soft',
    } as any);

    const ok = await guard.canActivate(buildCtx({}));
    expect(ok).toBe(true);
    expect(setHeader).toHaveBeenCalledWith(
      'X-Subscription-Warning',
      'grace_soft',
    );
  });

  it('passes silently when state=active', async () => {
    access.canUseModule.mockResolvedValue({
      allowed: true,
      mode: 'allow',
      severity: 'info',
      subscription_state: 'active',
    } as any);

    const ok = await guard.canActivate(buildCtx({}));
    expect(ok).toBe(true);
    expect(setHeader).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes when state=trial', async () => {
    access.canUseModule.mockResolvedValue({
      allowed: true,
      mode: 'allow',
      severity: 'info',
      subscription_state: 'trial',
    } as any);

    const ok = await guard.canActivate(buildCtx({}));
    expect(ok).toBe(true);
  });

  it('bypasses when storeId is undefined in context', async () => {
    (RequestContextService as any).getStoreId = jest
      .fn()
      .mockReturnValue(undefined);

    const ok = await guard.canActivate(buildCtx({}));
    expect(ok).toBe(true);
    expect(access.canUseModule).not.toHaveBeenCalled();
  });
});
