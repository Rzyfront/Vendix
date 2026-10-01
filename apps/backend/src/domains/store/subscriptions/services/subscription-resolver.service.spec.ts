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
    // RNC-39 split the feature source by state: a PAID state reads `paid_plan`,
    // `trial` reads `plan`. The fixture carries the same plan in both slots so
    // these cases assert the merge rules (partner override, promo overlay)
    // rather than accidentally testing which slot the resolver picked.
    const plan = {
      id: 1,
      code: 'core-free',
      ai_feature_flags: baseAIFlags,
      grace_period_soft_days: 5,
      grace_period_hard_days: 10,
      updated_at: new Date('2026-04-01T00:00:00Z'),
    };

    return {
      id: 1,
      store_id: 10,
      state: 'active',
      resolved_at: new Date('2026-04-23T10:00:00Z'),
      current_period_end: new Date('2026-05-23T10:00:00Z'),
      promotional_applied_at: null,
      plan,
      paid_plan: plan,
      partner_override: null,
      promotional_plan: null,
      ...overrides,
    };
  }

  function makeSubscriptionWithTools(
    toolsAllowed: string[] | undefined,
    overrides: any = {},
  ) {
    const subscription = makeSubscription(overrides);
    return {
      ...subscription,
      paid_plan: {
        ...subscription.paid_plan,
        ai_feature_flags: {
          ...baseAIFlags,
          tool_agents: {
            enabled: true,
            degradation: 'warn',
            ...(toolsAllowed !== undefined && { tools_allowed: toolsAllowed }),
          },
        },
      },
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

  it('partner restricts wildcard tool scope to the requested domains', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscriptionWithTools(['*'], {
        partner_override: {
          organization_id: 42,
          updated_at: new Date(),
          feature_overrides: {
            tool_agents: { enabled: true, tools_allowed: ['orders'] },
          },
          base_plan: {},
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.tool_agents?.tools_allowed).toEqual(['orders']);
  });

  it('partner wildcard does not widen a domain or empty base scope', async () => {
    for (const baseScope of [['orders'], []]) {
      prismaMock.store_subscriptions.findUnique.mockResolvedValueOnce(
        makeSubscriptionWithTools(baseScope, {
          partner_override: {
            organization_id: 42,
            updated_at: new Date(),
            feature_overrides: {
              tool_agents: { enabled: true, tools_allowed: ['*'] },
            },
            base_plan: {},
          },
        }),
      );
      const resolved = await service.resolveSubscription(10);
      expect(resolved.features.tool_agents?.tools_allowed).toEqual(baseScope);
    }
  });

  it('partner can restrict a base plan with no declared tool list', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscriptionWithTools(undefined, {
        partner_override: {
          organization_id: 42,
          updated_at: new Date(),
          feature_overrides: {
            tool_agents: { enabled: true, tools_allowed: ['orders'] },
          },
          base_plan: {},
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.tool_agents?.tools_allowed).toEqual(['orders']);
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

  it('promo wildcard expands a restricted scope without losing the wildcard', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscriptionWithTools(['orders'], {
        promotional_applied_at: new Date(),
        promotional_plan: {
          ai_feature_flags: {
            tool_agents: { enabled: true, tools_allowed: ['*'] },
          },
          promo_rules: { duration_days: 30 },
          updated_at: new Date(),
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.tool_agents?.tools_allowed).toEqual(['*']);
  });

  it('promo preserves an explicit empty tool scope', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      makeSubscriptionWithTools([], {
        promotional_applied_at: new Date(),
        promotional_plan: {
          ai_feature_flags: {
            tool_agents: { enabled: true, tools_allowed: [] },
          },
          promo_rules: { duration_days: 30 },
          updated_at: new Date(),
        },
      }),
    );
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.tool_agents?.tools_allowed).toEqual([]);
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

  it('vex_agent resolves with its caps verbatim from the base plan', async () => {
    const subscription = makeSubscription();
    subscription.paid_plan = {
      ...subscription.paid_plan,
      ai_feature_flags: {
        ...baseAIFlags,
        vex_agent: {
          enabled: true,
          monthly_tokens_cap: 1000000,
          daily_messages_cap: 100,
          monthly_tool_calls_cap: 5000,
        },
      },
    };
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subscription);
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.vex_agent).toEqual({
      enabled: true,
      monthly_tokens_cap: 1000000,
      daily_messages_cap: 100,
      monthly_tool_calls_cap: 5000,
    });
  });

  it('partner override keeps vex_agent caps at min instead of dropping them', async () => {
    const subscription = makeSubscription({
      partner_override: {
        organization_id: 42,
        updated_at: new Date('2026-04-15T00:00:00Z'),
        feature_overrides: {
          vex_agent: { enabled: true, monthly_tool_calls_cap: 1000 },
        },
        base_plan: {},
      },
    });
    subscription.paid_plan = {
      ...subscription.paid_plan,
      ai_feature_flags: {
        ...baseAIFlags,
        vex_agent: {
          enabled: true,
          daily_messages_cap: 100,
          monthly_tool_calls_cap: 5000,
        },
      },
    };
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subscription);
    const resolved = await service.resolveSubscription(10);
    // Sin `monthly_tool_calls_cap` en la lista de caps, el merge lo borraba
    // y el gate quedaba con `enabled` pero sin presupuesto.
    expect(resolved.features.vex_agent?.enabled).toBe(true);
    expect(resolved.features.vex_agent?.monthly_tool_calls_cap).toBe(1000);
    expect(resolved.features.vex_agent?.daily_messages_cap).toBe(100);
  });

  it('promo overlay keeps the higher vex_agent tool budget', async () => {
    const now = new Date();
    const subscription = makeSubscription({
      promotional_applied_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      promotional_plan: {
        ai_feature_flags: {
          vex_agent: { enabled: true, monthly_tool_calls_cap: 9000 },
        },
        promo_rules: { duration_days: 30 },
        updated_at: new Date('2026-04-20T00:00:00Z'),
      },
    });
    subscription.paid_plan = {
      ...subscription.paid_plan,
      ai_feature_flags: {
        ...baseAIFlags,
        vex_agent: { enabled: true, monthly_tool_calls_cap: 5000 },
      },
    };
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subscription);
    const resolved = await service.resolveSubscription(10);
    expect(resolved.features.vex_agent?.enabled).toBe(true);
    expect(resolved.features.vex_agent?.monthly_tool_calls_cap).toBe(9000);
  });
});
