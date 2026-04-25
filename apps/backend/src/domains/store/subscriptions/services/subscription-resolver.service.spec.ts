import { SubscriptionResolverService } from './subscription-resolver.service';

/**
 * Unit tests for SubscriptionResolverService feature resolution.
 * Focus: partner restriction semantics, promo union semantics, overlay expiry.
 */
describe('SubscriptionResolverService', () => {
  let service: SubscriptionResolverService;
  let prismaMock: any;
  let redisMock: any;

  const baseAIFlags = {
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
    tool_agents: { enabled: false, tools_allowed: [], degradation: 'block' },
    async_queue: {
      enabled: true,
      monthly_jobs_cap: 500,
      degradation: 'warn',
    },
  };

  beforeEach(() => {
    prismaMock = {
      store_subscriptions: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    service = new SubscriptionResolverService(prismaMock, redisMock);
  });

  function makeSubscription(overrides: any = {}) {
    return {
      id: 1,
      store_id: 10,
      state: 'active',
      resolved_at: new Date('2026-04-23T10:00:00Z'),
      current_period_end: new Date('2026-05-23T10:00:00Z'),
      promotional_applied_at: null,
      plan: {
        id: 1,
        code: 'core-free',
        ai_feature_flags: baseAIFlags,
        grace_period_soft_days: 5,
        grace_period_hard_days: 10,
        updated_at: new Date('2026-04-01T00:00:00Z'),
      },
      partner_override: null,
      promotional_plan: null,
      ...overrides,
    };
  }

  it('base plan only → returns plan.ai_feature_flags verbatim', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription(),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.found).toBe(true);
    expect(resolved.features.text_generation?.enabled).toBe(true);
    expect(resolved.features.text_generation?.monthly_tokens_cap).toBe(200000);
    expect(resolved.features.tool_agents?.enabled).toBe(false);
  });

  it('partner override disabling a feature → feature.enabled=false', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription({
        partner_override: {
          organization_id: 42,
          updated_at: new Date('2026-04-15T00:00:00Z'),
          feature_overrides: {
            text_generation: { enabled: false },
          },
          base_plan: {},
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.text_generation?.enabled).toBe(false);
    expect(resolved.partnerOrgId).toBe(42);
  });

  it('partner override trying to enable a feature beyond base → ignored (still false)', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription({
        partner_override: {
          organization_id: 42,
          updated_at: new Date(),
          feature_overrides: {
            tool_agents: { enabled: true, tools_allowed: ['foo'] },
          },
          base_plan: {},
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.tool_agents?.enabled).toBe(false);
  });

  it('partner override lowering a numeric cap → cap lowered', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription({
        partner_override: {
          organization_id: 42,
          updated_at: new Date(),
          feature_overrides: {
            text_generation: { enabled: true, monthly_tokens_cap: 50000 },
          },
          base_plan: {},
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.text_generation?.monthly_tokens_cap).toBe(50000);
  });

  it('partner cannot raise cap above base (takes min)', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription({
        partner_override: {
          organization_id: 42,
          updated_at: new Date(),
          feature_overrides: {
            text_generation: { enabled: true, monthly_tokens_cap: 9999999 },
          },
          base_plan: {},
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.text_generation?.monthly_tokens_cap).toBe(200000);
  });

  it('active promo overlay → union-of-max', async () => {
    const now = new Date();
    const appliedAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription({
        promotional_applied_at: appliedAt,
        promotional_plan: {
          ai_feature_flags: {
            text_generation: {
              enabled: true,
              monthly_tokens_cap: 500000, // higher than base (200k)
              degradation: 'warn',
            },
            tool_agents: {
              enabled: true,
              tools_allowed: ['x', 'y'],
              degradation: 'warn',
            },
          },
          promo_rules: { duration_days: 30 },
          updated_at: new Date('2026-04-20T00:00:00Z'),
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.overlayActive).toBe(true);
    expect(resolved.features.text_generation?.monthly_tokens_cap).toBe(500000);
    expect(resolved.features.tool_agents?.enabled).toBe(true);
    const tools = resolved.features.tool_agents?.tools_allowed ?? [];
    expect(tools).toContain('x');
    expect(tools).toContain('y');
  });

  it('expired promo (applied_at + duration_days < now) → overlay ignored', async () => {
    const appliedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription({
        promotional_applied_at: appliedAt,
        promotional_plan: {
          ai_feature_flags: {
            tool_agents: { enabled: true, tools_allowed: ['z'] },
          },
          promo_rules: { duration_days: 30 },
          updated_at: new Date('2026-04-20T00:00:00Z'),
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.overlayActive).toBe(false);
    expect(resolved.features.tool_agents?.enabled).toBe(false);
  });

  it('promo cannot subtract a base feature (union-of-max is monotonic)', async () => {
    const appliedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscription({
        promotional_applied_at: appliedAt,
        promotional_plan: {
          ai_feature_flags: {
            text_generation: { enabled: false, monthly_tokens_cap: 0 },
          },
          promo_rules: { duration_days: 30 },
          updated_at: new Date('2026-04-20T00:00:00Z'),
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    // OR semantics → base true wins.
    expect(resolved.features.text_generation?.enabled).toBe(true);
    // max semantics → base 200000 wins.
    expect(resolved.features.text_generation?.monthly_tokens_cap).toBe(200000);
  });

  it('missing subscription row → found:false', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(null);
    const resolved = await service.resolveSubscription(10);
    expect(resolved.found).toBe(false);
  });

  it('rejects non-positive storeId', async () => {
    const expectThrow = async (fn: () => Promise<unknown>) => {
      let threw = false;
      try {
        await fn();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    };
    await expectThrow(() => service.resolveSubscription(0));
    await expectThrow(() => service.resolveSubscription(-1));
    // @ts-expect-error: intentional bad input
    await expectThrow(() => service.resolveSubscription('abc'));
  });

  it('reads from cache on subsequent calls', async () => {
    const payload = {
      found: true,
      storeId: 10,
      state: 'active',
      planCode: 'core-free',
      partnerOrgId: null,
      overlayActive: false,
      overlayExpiresAt: null,
      features: baseAIFlags,
      gracePeriodSoftDays: 5,
      gracePeriodHardDays: 10,
      currentPeriodEnd: new Date().toISOString(),
    };
    redisMock.get.mockResolvedValue(JSON.stringify(payload));
    const resolved = await service.resolveSubscription(10);
    expect(resolved.planCode).toBe('core-free');
    expect(prismaMock.store_subscriptions.findUnique).not.toHaveBeenCalled();
  });
});
