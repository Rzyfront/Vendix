import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionResolverService } from './subscription-resolver.service';

describe('SubscriptionAccessService', () => {
  let service: SubscriptionAccessService;
  let resolverMock: jest.Mocked<Pick<SubscriptionResolverService, 'resolveSubscription' | 'invalidate'>>;
  let redisMock: any;

  const originalEnforce = process.env.AI_GATE_ENFORCE;

  beforeEach(() => {
    resolverMock = {
      resolveSubscription: jest.fn(),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };
    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      pipeline: jest.fn(() => ({
        incrby: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      })),
    };
    service = new SubscriptionAccessService(
      resolverMock as any,
      redisMock,
    );
  });

  afterEach(() => {
    if (originalEnforce === undefined) {
      delete process.env.AI_GATE_ENFORCE;
    } else {
      process.env.AI_GATE_ENFORCE = originalEnforce;
    }
  });

  function resolved(overrides: Partial<any> = {}) {
    return {
      found: true,
      storeId: 1,
      state: 'active',
      planCode: 'pro',
      partnerOrgId: null,
      overlayActive: false,
      overlayExpiresAt: null,
      features: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 200000,
          degradation: 'warn',
        },
        streaming_chat: {
          enabled: true,
          daily_messages_cap: 200,
          degradation: 'warn',
        },
      },
      gracePeriodSoftDays: 5,
      gracePeriodHardDays: 10,
      currentPeriodEnd: null,
      ...overrides,
    };
  }

  it('state=active + feature enabled → allow', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(resolved() as any);
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.allowed).toBe(true);
    expect(r.mode).toBe('allow');
  });

  it('state=grace_soft → warn (allowed)', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(
      resolved({ state: 'grace_soft' }) as any,
    );
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('warn');
    expect(r.allowed).toBe(true);
  });

  it('state=grace_hard + degradation=warn → warn (allowed)', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(
      resolved({
        state: 'grace_hard',
        features: {
          text_generation: {
            enabled: true,
            monthly_tokens_cap: 200000,
            degradation: 'warn',
          },
        },
      }) as any,
    );
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('warn');
    expect(r.allowed).toBe(true);
  });

  it('state=grace_hard + degradation=block → block SUBSCRIPTION_009', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(
      resolved({
        state: 'grace_hard',
        features: {
          text_generation: {
            enabled: true,
            monthly_tokens_cap: 200000,
            degradation: 'block',
          },
        },
      }) as any,
    );
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_009');
  });

  it('state=blocked → block SUBSCRIPTION_009', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(
      resolved({ state: 'blocked' }) as any,
    );
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_009');
  });

  it('state=suspended → block SUBSCRIPTION_008', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(
      resolved({ state: 'suspended' }) as any,
    );
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_008');
  });

  it('feature disabled in plan → block SUBSCRIPTION_005', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(
      resolved({
        features: {
          text_generation: { enabled: false, monthly_tokens_cap: 0 },
        },
      }) as any,
    );
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_005');
  });

  it('quota exceeded → block SUBSCRIPTION_006', async () => {
    resolverMock.resolveSubscription.mockResolvedValue(resolved() as any);
    redisMock.get.mockResolvedValue('250000'); // > 200000 cap
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_006');
  });

  it('no subscription row (enforce) → block SUBSCRIPTION_001', async () => {
    process.env.AI_GATE_ENFORCE = 'true';
    resolverMock.resolveSubscription.mockResolvedValue({
      found: false,
      storeId: 1,
      state: 'draft',
      planCode: '',
      partnerOrgId: null,
      overlayActive: false,
      overlayExpiresAt: null,
      features: {},
      gracePeriodSoftDays: 0,
      gracePeriodHardDays: 0,
      currentPeriodEnd: null,
    } as any);
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_001');
  });

  it('Redis outage in enforce → fail-closed', async () => {
    process.env.AI_GATE_ENFORCE = 'true';
    resolverMock.resolveSubscription.mockResolvedValue(resolved() as any);
    redisMock.get.mockRejectedValue(new Error('redis down'));
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_INTERNAL_ERROR');
  });

  it('Redis outage in log-only → fail-open', async () => {
    delete process.env.AI_GATE_ENFORCE;
    resolverMock.resolveSubscription.mockResolvedValue(resolved() as any);
    redisMock.get.mockRejectedValue(new Error('redis down'));
    const r = await service.canUseAIFeature(1, 'text_generation');
    expect(r.mode).toBe('allow');
    expect(r.allowed).toBe(true);
  });

  it('invalid feature key → blocks at input validation', async () => {
    // @ts-expect-error: intentional bad input
    const r = await service.canUseAIFeature(1, 'hacked_key');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_005');
  });

  it('invalid storeId → internal error result', async () => {
    const r = await service.canUseAIFeature(0, 'text_generation');
    expect(r.mode).toBe('block');
    expect(r.reason).toBe('SUBSCRIPTION_INTERNAL_ERROR');
  });

  it('consumeAIQuota ignores non-positive units silently', async () => {
    await service.consumeAIQuota(1, 'text_generation', 0);
    await service.consumeAIQuota(1, 'text_generation', -5);
    // No pipeline writes should have been issued for zero/negative units.
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });
});
