import { PromotionalApplyService } from './promotional-apply.service';

/**
 * Unit tests for PromotionalApplyService.
 * Focus: union-of-max semantics (never subtracts), promo_priority conflict
 * resolution, and resolved_features/promotional_plan_id persistence.
 */
describe('PromotionalApplyService', () => {
  let service: PromotionalApplyService;
  let prismaMock: any;
  let resolverMock: any;
  let eventEmitterMock: any;
  let redisMock: any;

  const baseFlags = {
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
  };

  beforeEach(() => {
    prismaMock = {
      subscription_plans: { findUnique: jest.fn() },
      store_subscriptions: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    resolverMock = { invalidate: jest.fn().mockResolvedValue(undefined) };
    eventEmitterMock = { emit: jest.fn() };
    redisMock = { del: jest.fn().mockResolvedValue(1) };

    service = new PromotionalApplyService(
      prismaMock,
      resolverMock,
      eventEmitterMock,
      redisMock,
    );
  });

  function promoPlan(overrides: any = {}) {
    return {
      id: 99,
      code: 'black-friday',
      is_promotional: true,
      promo_priority: 10,
      ai_feature_flags: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 500000,
          degradation: 'warn',
        },
        tool_agents: {
          enabled: true,
          tools_allowed: ['a', 'b'],
          degradation: 'warn',
        },
      },
      ...overrides,
    };
  }

  function subFixture(overrides: any = {}) {
    return {
      id: 1,
      store_id: 10,
      promotional_plan_id: null,
      promotional_plan: null,
      plan: { ai_feature_flags: baseFlags },
      partner_override: null,
      ...overrides,
    };
  }

  it('apply → union-of-max: caps raised, never subtracted', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(promoPlan());
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    const resolved = updateCall.data.resolved_features as any;

    // Max between base 200000 and promo 500000 → 500000.
    expect(resolved.text_generation.monthly_tokens_cap).toBe(500000);
    // OR: base false, promo true → true.
    expect(resolved.tool_agents.enabled).toBe(true);
    // Base streaming_chat preserved.
    expect(resolved.streaming_chat.enabled).toBe(true);
    expect(resolved.streaming_chat.daily_messages_cap).toBe(200);
  });

  it('promo trying to reduce base cap → base wins (union never subtracts)', async () => {
    const lowPromo = promoPlan({
      ai_feature_flags: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 50000, // below base 200000
          degradation: 'warn',
        },
      },
    });
    prismaMock.subscription_plans.findUnique.mockResolvedValue(lowPromo);
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    const resolved = updateCall.data.resolved_features as any;
    expect(resolved.text_generation.monthly_tokens_cap).toBe(200000);
    expect(resolved.text_generation.enabled).toBe(true);
  });

  it('higher-priority existing promo wins over new lower-priority promo', async () => {
    const existingPromo = {
      id: 50,
      promo_priority: 100, // higher than incoming 10
      ai_feature_flags: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 999999,
          degradation: 'warn',
        },
      },
      is_promotional: true,
    };
    prismaMock.subscription_plans.findUnique.mockResolvedValue(promoPlan());
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      subFixture({ promotional_plan: existingPromo, promotional_plan_id: 50 }),
    );

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    expect(updateCall.data.promotional_plan_id).toBe(50);
    expect(updateCall.data.resolved_features.text_generation.monthly_tokens_cap).toBe(
      999999,
    );
  });

  it('apply sets promotional_applied_at and promotional_plan_id', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(promoPlan());
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    expect(updateCall.data.promotional_plan_id).toBe(99);
    expect(updateCall.data.promotional_applied_at).toBeInstanceOf(Date);
    expect(resolverMock.invalidate).toHaveBeenCalledWith(10);
    expect(redisMock.del).toHaveBeenCalledWith('sub:features:10');

    const [evtName, payload] = eventEmitterMock.emit.mock.calls[0];
    expect(evtName).toBe('subscription.promotional.applied');
    expect(payload.storeId).toBe(10);
    expect(payload.promoPlanId).toBe(99);
  });

  it('apply on non-promotional plan → throws', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 99,
      is_promotional: false,
    });

    let threw = false;
    try {
      await service.apply(10, 99);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
  });
});
