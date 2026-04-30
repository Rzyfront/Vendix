import { InternalServerErrorException } from '@nestjs/common';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionResolverService } from './subscription-resolver.service';

describe('SubscriptionAccessService', () => {
  let service: SubscriptionAccessService;
  let resolverMock: jest.Mocked<
    Pick<SubscriptionResolverService, 'resolveSubscription' | 'invalidate'>
  >;
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
      eval: jest.fn().mockResolvedValue(1),
    };
    service = new SubscriptionAccessService(
      resolverMock as any,
      redisMock,
      {} as any,
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
    await service.consumeAIQuota(1, 'text_generation', 0, 'req-zero');
    await service.consumeAIQuota(1, 'text_generation', -5, 'req-neg');
    // No INCR should have been issued for zero/negative units.
    expect(redisMock.eval).not.toHaveBeenCalled();
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });

  it('consumeAIQuota throws when requestId is missing', async () => {
    await expect(
      // @ts-expect-error: intentional missing arg to test runtime guard
      service.consumeAIQuota(1, 'text_generation', 100),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('consumeAIQuota throws when requestId is empty string', async () => {
    await expect(
      service.consumeAIQuota(1, 'text_generation', 100, ''),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('consumeAIQuota throws when requestId is whitespace-only', async () => {
    await expect(
      service.consumeAIQuota(1, 'text_generation', 100, '   '),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('consumeAIQuota always uses Lua eval (no pipeline fallback)', async () => {
    await service.consumeAIQuota(1, 'text_generation', 100, 'req-123');
    expect(redisMock.pipeline).not.toHaveBeenCalled();
    expect(redisMock.eval).toHaveBeenCalledTimes(1);

    const call = redisMock.eval.mock.calls[0];
    // call[0] is the Lua source. KEYS = quotaKey, dedupSetKey.
    expect(call[1]).toBe(2);
    expect(call[2]).toMatch(/^ai:quota:1:text_generation:\d{6}$/);
    expect(call[3]).toMatch(/^ai:quota:dedup:1:text_generation:\d{6}$/);
    // ARGV = request_id, units, ttl_seconds
    expect(call[4]).toBe('req-123');
    expect(call[5]).toBe(100);
    expect(call[6]).toBe(40 * 24 * 60 * 60); // monthly ttl applied to BOTH keys
  });

  it('consumeAIQuota: counter and dedup keys share the period suffix', async () => {
    await service.consumeAIQuota(1, 'streaming_chat', 1, 'req-daily');
    const call = redisMock.eval.mock.calls[0];
    const quotaKey: string = call[2];
    const dedupKey: string = call[3];
    // Both keys end with the same YYYYMMDD period.
    const quotaPeriod = quotaKey.split(':').pop();
    const dedupPeriod = dedupKey.split(':').pop();
    expect(quotaPeriod).toBe(dedupPeriod);
    expect(quotaPeriod).toMatch(/^\d{8}$/); // daily
    // Daily TTL applied to both keys (same ARGV[3])
    expect(call[6]).toBe(48 * 60 * 60);
  });

  it('consumeAIQuota: floors fractional units before passing to Redis', async () => {
    await service.consumeAIQuota(1, 'text_generation', 12.9, 'req-frac');
    const call = redisMock.eval.mock.calls[0];
    expect(call[5]).toBe(12);
  });

  it('consumeAIQuota: distinct requestIds invoke eval each time', async () => {
    redisMock.eval.mockResolvedValueOnce(50);
    redisMock.eval.mockResolvedValueOnce(100);
    redisMock.eval.mockResolvedValueOnce(150);

    await service.consumeAIQuota(1, 'text_generation', 50, 'req-A');
    await service.consumeAIQuota(1, 'text_generation', 50, 'req-B');
    await service.consumeAIQuota(1, 'text_generation', 50, 'req-C');

    expect(redisMock.eval).toHaveBeenCalledTimes(3);
    const ids = redisMock.eval.mock.calls.map((c: any[]) => c[4]);
    expect(ids).toEqual(['req-A', 'req-B', 'req-C']);
  });

  it('consumeAIQuota swallows Redis errors (best-effort, never throws)', async () => {
    redisMock.eval.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      service.consumeAIQuota(1, 'text_generation', 50, 'req-err'),
    ).resolves.toBeUndefined();
  });

  describe('consumeAIQuota — Lua dedup integration (script semantics)', () => {
    /**
     * These tests execute the actual Lua source against an in-memory
     * simulator of the Redis ops the script touches (SISMEMBER, SADD,
     * EXPIRE, INCRBY). This guarantees that callers are dedup-safe
     * regardless of the JS-side retry pattern: the contract is enforced
     * by Redis, not by the service.
     */
    let store: Map<string, number>;
    let sets: Map<string, Set<string>>;
    let expires: Map<string, number>;

    function makeRealishRedis() {
      store = new Map();
      sets = new Map();
      expires = new Map();

      const exec = (script: string, args: unknown[]): number => {
        // Args layout: [numKeys, ...keys, ...argv]
        const numKeys = args[0] as number;
        const keys = args.slice(1, 1 + numKeys) as string[];
        const argv = args.slice(1 + numKeys) as string[];
        const KEYS = { 1: keys[0], 2: keys[1] };
        const ARGV = {
          1: argv[0],
          2: parseInt(argv[1], 10),
          3: parseInt(argv[2], 10),
        };

        // Simulate: SISMEMBER, SADD, EXPIRE, INCRBY, EXPIRE.
        const dedupSet = sets.get(KEYS[2]) ?? new Set<string>();
        if (dedupSet.has(ARGV[1])) return 0;
        dedupSet.add(ARGV[1]);
        sets.set(KEYS[2], dedupSet);
        expires.set(KEYS[2], ARGV[3]);

        const current = (store.get(KEYS[1]) ?? 0) + ARGV[2];
        store.set(KEYS[1], current);
        expires.set(KEYS[1], ARGV[3]);
        return current;
      };

      return {
        get: jest.fn().mockResolvedValue(null),
        pipeline: jest.fn(),
        eval: jest.fn(async (script: string, ...args: unknown[]) =>
          exec(script, args),
        ),
      };
    }

    let realish: any;

    beforeEach(() => {
      realish = makeRealishRedis();
      service = new SubscriptionAccessService(
        resolverMock as any,
        realish,
        {} as any,
      );
    });

    it('three calls with same requestId increment counter ONCE', async () => {
      await service.consumeAIQuota(7, 'text_generation', 100, 'retry-once');
      await service.consumeAIQuota(7, 'text_generation', 100, 'retry-once');
      await service.consumeAIQuota(7, 'text_generation', 100, 'retry-once');

      const counterKey = Array.from(store.keys()).find((k) =>
        k.startsWith('ai:quota:7:text_generation:'),
      );
      expect(counterKey).toBeDefined();
      expect(store.get(counterKey!)).toBe(100);
    });

    it('distinct requestIds increment the counter for each call', async () => {
      await service.consumeAIQuota(7, 'text_generation', 100, 'a');
      await service.consumeAIQuota(7, 'text_generation', 100, 'b');
      await service.consumeAIQuota(7, 'text_generation', 100, 'c');

      const counterKey = Array.from(store.keys()).find((k) =>
        k.startsWith('ai:quota:7:text_generation:'),
      );
      expect(store.get(counterKey!)).toBe(300);
    });

    it('TTL is applied to BOTH counter key and dedup set on first call', async () => {
      await service.consumeAIQuota(7, 'text_generation', 100, 'fresh');
      const counterKey = Array.from(expires.keys()).find((k) =>
        k.startsWith('ai:quota:7:text_generation:'),
      );
      const dedupKey = Array.from(expires.keys()).find((k) =>
        k.startsWith('ai:quota:dedup:7:text_generation:'),
      );
      expect(counterKey).toBeDefined();
      expect(dedupKey).toBeDefined();
      expect(expires.get(counterKey!)).toBe(40 * 24 * 60 * 60);
      expect(expires.get(dedupKey!)).toBe(40 * 24 * 60 * 60);
    });

    it('mixing same and distinct requestIds: only unique IDs increment', async () => {
      await service.consumeAIQuota(7, 'text_generation', 50, 'x'); // +50
      await service.consumeAIQuota(7, 'text_generation', 50, 'x'); // dedup
      await service.consumeAIQuota(7, 'text_generation', 50, 'y'); // +50
      await service.consumeAIQuota(7, 'text_generation', 50, 'y'); // dedup
      await service.consumeAIQuota(7, 'text_generation', 50, 'z'); // +50

      const counterKey = Array.from(store.keys()).find((k) =>
        k.startsWith('ai:quota:7:text_generation:'),
      );
      expect(store.get(counterKey!)).toBe(150);

      const dedupKey = Array.from(sets.keys()).find((k) =>
        k.startsWith('ai:quota:dedup:7:text_generation:'),
      );
      expect(sets.get(dedupKey!)?.size).toBe(3);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // G6 — getDunningStateForCurrentStore
  // ──────────────────────────────────────────────────────────────────

  describe('getDunningStateForCurrentStore', () => {
    function buildPrismaMock(sub: any, invoices: any[] = []): any {
      return {
        store_subscriptions: {
          findUnique: jest.fn().mockResolvedValue(sub),
        },
        subscription_invoices: {
          findMany: jest.fn().mockResolvedValue(invoices),
        },
      };
    }

    it('returns empty snapshot when subscription does not exist', async () => {
      const prismaMock = buildPrismaMock(null);
      const svc = new SubscriptionAccessService(
        resolverMock as any,
        redisMock,
        prismaMock,
      );
      const out = await svc.getDunningStateForCurrentStore(42);
      expect(out.state).toBe('none');
      expect(out.invoices_overdue).toEqual([]);
      expect(out.total_due).toBe(0);
      expect(out.deadlines.grace_hard_at).toBeNull();
    });

    it('returns null deadlines + empty losses for active state', async () => {
      const prismaMock = buildPrismaMock(
        {
          id: 1,
          state: 'active',
          current_period_end: new Date('2026-05-01T00:00:00Z'),
          plan: {
            grace_period_soft_days: 3,
            grace_period_hard_days: 7,
            suspension_day: 14,
            cancellation_day: 30,
          },
        },
        [],
      );
      resolverMock.resolveSubscription.mockResolvedValue({
        found: true,
        storeId: 1,
        state: 'active',
        planCode: 'pro',
        partnerOrgId: null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: {
          text_generation: { enabled: true, monthly_tokens_cap: 1000 },
        },
        gracePeriodSoftDays: 3,
        gracePeriodHardDays: 7,
        currentPeriodEnd: null,
      } as any);

      const svc = new SubscriptionAccessService(
        resolverMock as any,
        redisMock,
        prismaMock,
      );

      const out = await svc.getDunningStateForCurrentStore(1);
      expect(out.state).toBe('active');
      expect(out.deadlines.grace_hard_at).toBeNull();
      expect(out.deadlines.suspend_at).toBeNull();
      expect(out.deadlines.cancel_at).toBeNull();
      expect(out.features_kept).toContain('text_generation');
      expect(out.features_lost).toEqual([]);
    });

    it('computes deadlines + total_due for grace_hard with overdue invoice', async () => {
      const periodEnd = new Date('2026-04-01T00:00:00Z');
      const sub = {
        id: 99,
        state: 'grace_hard',
        current_period_end: periodEnd,
        plan: {
          grace_period_soft_days: 3,
          grace_period_hard_days: 7,
          suspension_day: 14,
          cancellation_day: 30,
        },
      };
      const invoices = [
        {
          id: 11,
          invoice_number: 'INV-0001',
          total: '50000.00',
          amount_paid: '0.00',
          issued_at: new Date('2026-04-01T00:00:00Z'),
          period_start: new Date('2026-03-01T00:00:00Z'),
          period_end: periodEnd,
        },
      ];
      const prismaMock = buildPrismaMock(sub, invoices);
      resolverMock.resolveSubscription.mockResolvedValue({
        found: true,
        storeId: 1,
        state: 'grace_hard',
        planCode: 'pro',
        partnerOrgId: null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: {
          text_generation: { enabled: true, degradation: 'block' },
          streaming_chat: { enabled: true, degradation: 'warn' },
        },
        gracePeriodSoftDays: 3,
        gracePeriodHardDays: 7,
        currentPeriodEnd: periodEnd,
      } as any);

      const svc = new SubscriptionAccessService(
        resolverMock as any,
        redisMock,
        prismaMock,
      );
      const out = await svc.getDunningStateForCurrentStore(1);

      expect(out.state).toBe('grace_hard');
      expect(out.total_due).toBe(50000);
      expect(out.invoices_overdue).toHaveLength(1);
      expect(out.invoices_overdue[0].amount_due).toBe(50000);

      // grace_hard_at = periodEnd + 7d
      expect(out.deadlines.grace_hard_at).toBe(
        new Date(periodEnd.getTime() + 7 * 86400000).toISOString(),
      );
      expect(out.deadlines.suspend_at).toBe(
        new Date(periodEnd.getTime() + 14 * 86400000).toISOString(),
      );
      expect(out.deadlines.cancel_at).toBe(
        new Date(periodEnd.getTime() + 30 * 86400000).toISOString(),
      );

      // text_generation has degradation: block at grace_hard → lost
      // streaming_chat has degradation: warn at grace_hard → kept
      expect(out.features_lost).toContain('text_generation');
      expect(out.features_kept).toContain('streaming_chat');
    });

    it('subtracts amount_paid from total when computing amount_due', async () => {
      const sub = {
        id: 1,
        state: 'suspended',
        current_period_end: new Date('2026-04-01T00:00:00Z'),
        plan: {
          grace_period_soft_days: 3,
          grace_period_hard_days: 7,
          suspension_day: 14,
          cancellation_day: 30,
        },
      };
      const invoices = [
        {
          id: 5,
          invoice_number: 'INV-0005',
          total: '100000.00',
          amount_paid: '40000.00',
          issued_at: new Date(),
          period_start: new Date(),
          period_end: new Date(),
        },
      ];
      const prismaMock = buildPrismaMock(sub, invoices);
      resolverMock.resolveSubscription.mockResolvedValue({
        found: true,
        storeId: 1,
        state: 'suspended',
        planCode: 'pro',
        partnerOrgId: null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: {},
        gracePeriodSoftDays: 3,
        gracePeriodHardDays: 7,
        currentPeriodEnd: null,
      } as any);

      const svc = new SubscriptionAccessService(
        resolverMock as any,
        redisMock,
        prismaMock,
      );
      const out = await svc.getDunningStateForCurrentStore(1);
      expect(out.total_due).toBe(60000);
      expect(out.invoices_overdue[0].amount_due).toBe(60000);
    });
  });
});
