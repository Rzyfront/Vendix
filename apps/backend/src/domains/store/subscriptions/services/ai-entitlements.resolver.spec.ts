import {
  AI_CAPS_BY_LINE,
  aiFeatureFlagsFor,
} from '../../../../../prisma/seeds/plan-commercial-lines.seed';
import {
  AI_CAPABILITIES,
  AIEntitlement,
  aiCapabilityId,
  legacyFlagsToAIEntitlements,
} from '../types/ai-capabilities';
import {
  applyPartnerRestriction,
  applyPromoOverlay,
  compareAIEntitlements,
  completeAIEntitlements,
  partnerOverrideToPatch,
  projectAIEntitlementsToLegacy,
} from './ai-entitlements.logic';
import { AIEntitlementsResolverService } from './ai-entitlements-resolver.service';
import { AIEntitlementsShadowService } from './ai-entitlements-shadow.service';
import { SubscriptionAccessService } from './subscription-access.service';

type Rows = AIEntitlement[];

const byId = (rows: Rows) =>
  Object.fromEntries(
    rows.map((r) => [aiCapabilityId(r.agent_key, r.capability_key), r]),
  );

const setRow = (rows: Rows, id: string, patch: Partial<AIEntitlement>): Rows =>
  rows.map((r) =>
    aiCapabilityId(r.agent_key, r.capability_key) === id ? { ...r, ...patch } : r,
  );

/** Every legacy key on, with caps, as the commercial seeds write them. */
const FULL_FLAGS = {
  text_generation: { enabled: true, monthly_tokens_cap: 5_000_000, degradation: 'warn' },
  streaming_chat: { enabled: true, daily_messages_cap: 100, degradation: 'warn' },
  conversations: { enabled: true, retention_days: 365 },
  tool_agents: { enabled: true, monthly_tool_calls_cap: 500 },
  rag_embeddings: { enabled: true, indexed_docs_cap: 1000, degradation: 'block' },
  async_queue: { enabled: true, monthly_jobs_cap: 500 },
  realtime_voice: { enabled: true, monthly_voice_seconds_cap: 3600, degradation: 'warn' },
  vex_agent: {
    enabled: true,
    daily_messages_cap: 200,
    monthly_tokens_cap: 20_000_000_000,
    degradation: 'block',
  },
};

describe('AI entitlements model — pure rules (T10)', () => {
  it('completes rows in catalog order, filling gaps from the fallback and dropping unknown rows', () => {
    const legacy = legacyFlagsToAIEntitlements(FULL_FLAGS);
    const rows = completeAIEntitlements(
      [
        { agent_key: 'vexi', capability_key: 'agent', enabled: false, cap_value: 0, on_limit: 'warn' },
        { agent_key: 'vex', capability_key: 'teleport', enabled: true, cap_value: null, on_limit: 'block' },
      ],
      legacy,
    );
    expect(rows.map((r) => aiCapabilityId(r.agent_key, r.capability_key))).toEqual(
      AI_CAPABILITIES.map((c) => aiCapabilityId(c.agent_key, c.capability_key)),
    );
    expect(byId(rows)['vexi.agent']).toMatchObject({ enabled: false, cap_value: 0 });
    expect(byId(rows)['vex.agent']).toEqual(byId(legacy)['vex.agent']);
  });

  describe('partner restriction (only switches off and lowers)', () => {
    const base = legacyFlagsToAIEntitlements(FULL_FLAGS);

    it('lowers a cap, keeps the base on_limit and treats NULL as unlimited', () => {
      const rows = byId(
        applyPartnerRestriction(
          base,
          partnerOverrideToPatch({
            vex_agent: { daily_messages_cap: 50, degradation: 'warn' },
            streaming_chat: { daily_messages_cap: 500 },
          }),
        ),
      );
      // `enabled` absent in the override keeps the base on (legacy `?? true`).
      expect(rows['vex.agent']).toMatchObject({ enabled: true, cap_value: 50, on_limit: 'block' });
      // A partner never raises a cap.
      expect(rows['vexi.agent'].cap_value).toBe(100);
    });

    it('switches a capability off and never switches one on', () => {
      const off = byId(
        applyPartnerRestriction(base, partnerOverrideToPatch({ realtime_voice: { enabled: false } })),
      );
      expect(off['vex.voice_readout'].enabled).toBe(false);
      expect(off['vexi.voice_readout'].enabled).toBe(false);

      const disabledBase = setRow(base, 'vex.agent', { enabled: false });
      const stillOff = byId(
        applyPartnerRestriction(disabledBase, partnerOverrideToPatch({ vex_agent: { enabled: true } })),
      );
      expect(stillOff['vex.agent'].enabled).toBe(false);
    });

    it('a partner cap on an unlimited base lowers it (NULL = unlimited)', () => {
      const unlimited = setRow(base, 'vex.agent', { cap_value: null });
      const rows = byId(
        applyPartnerRestriction(unlimited, partnerOverrideToPatch({ vex_agent: { daily_messages_cap: 30 } })),
      );
      expect(rows['vex.agent'].cap_value).toBe(30);
    });
  });

  describe('promo overlay (union of the higher)', () => {
    const base = legacyFlagsToAIEntitlements(FULL_FLAGS);

    it('keeps the higher cap, unlimited wins, and the base on_limit stays', () => {
      const promo = setRow(
        setRow(base, 'vex.agent', { cap_value: 1000, on_limit: 'warn' }),
        'vexi.agent',
        { cap_value: null },
      );
      const rows = byId(applyPromoOverlay(base, promo));
      expect(rows['vex.agent']).toMatchObject({ cap_value: 1000, on_limit: 'block' });
      expect(rows['vexi.agent'].cap_value).toBeNull();
    });

    it('a switched-off promo row grants nothing; an on promo row grants a base row that was off', () => {
      const promoOff = setRow(base, 'vex.agent', { enabled: false, cap_value: 9999 });
      expect(byId(applyPromoOverlay(base, promoOff))['vex.agent'].cap_value).toBe(200);

      const baseOff = setRow(base, 'vex.code_analysis', { enabled: false });
      const promoOn = setRow(base, 'vex.code_analysis', { enabled: true });
      expect(byId(applyPromoOverlay(baseOff, promoOn))['vex.code_analysis'].enabled).toBe(true);
    });

    it('a promo plan without the agent leaves that agent alone (its cap-only rows do not count)', () => {
      const rows = byId(applyPromoOverlay(base, legacyFlagsToAIEntitlements({})));
      expect(rows['vex.model_tokens'].cap_value).toBe(20_000_000_000);
      expect(rows['vexi.model_tokens'].cap_value).toBe(5_000_000);
    });
  });

  describe('legacy projection (T12 dual-write)', () => {
    it('one legacy voice switch is the OR of both agents and its cap the higher of the rows on', () => {
      const rows = setRow(
        setRow(legacyFlagsToAIEntitlements(FULL_FLAGS), 'vexi.voice_readout', { enabled: false, cap_value: 99_999 }),
        'vex.voice_readout',
        { cap_value: 1800 },
      );
      const projection = projectAIEntitlementsToLegacy(rows);
      expect(projection.realtime_voice).toEqual({
        enabled: true,
        caps: { monthly_voice_seconds_cap: 1800 },
        degradation: 'warn',
      });
    });

    it('switch-only rows never write a legacy field and unlimited wins a shared cap', () => {
      const rows = setRow(
        setRow(legacyFlagsToAIEntitlements(FULL_FLAGS), 'vex.files', { enabled: false }),
        'platform.module_ai',
        { cap_value: null },
      );
      const projection = projectAIEntitlementsToLegacy(rows);
      expect(projection.vex_agent.enabled).toBe(true);
      expect(projection.text_generation.caps.monthly_tokens_cap).toBeNull();
    });
  });

  describe('compareAIEntitlements', () => {
    it.each(Object.keys(AI_CAPS_BY_LINE))(
      'backfilled rows of the commercial line %s give zero differences',
      (line) => {
        const flags = aiFeatureFlagsFor(line as keyof typeof AI_CAPS_BY_LINE);
        expect(compareAIEntitlements(flags, legacyFlagsToAIEntitlements(flags))).toEqual([]);
      },
    );

    it('a legacy edit the rows did not follow is a divergence', () => {
      const rows = legacyFlagsToAIEntitlements(FULL_FLAGS);
      const edited = { ...FULL_FLAGS, vex_agent: { ...FULL_FLAGS.vex_agent, daily_messages_cap: 300 } };
      expect(compareAIEntitlements(edited, rows)).toEqual([
        {
          capability: 'vex.agent',
          kind: 'divergence',
          legacy: '300 mensajes al día, bloquea al llegar al tope',
          current: '200 mensajes al día, bloquea al llegar al tope',
        },
      ]);
    });

    it('a feature without a boolean enabled has access at the gate: rows copied off are a divergence', () => {
      const gateFlags = { vex_agent: { daily_messages_cap: 10 } };
      // What M3 wrote before the corrective migration: every vex_agent row off.
      const m3Rows = legacyFlagsToAIEntitlements({
        vex_agent: { enabled: false, daily_messages_cap: 10 },
      });
      const diffs = compareAIEntitlements(gateFlags, m3Rows);
      expect(diffs.find((d) => d.capability === 'vex.agent')).toEqual({
        capability: 'vex.agent',
        kind: 'divergence',
        legacy: '10 mensajes al día, avisa al llegar al tope',
        current: 'no incluido',
      });
    });

    it('enabled as text "true" and an explicit false are decided like the gate', () => {
      const textTrue = { streaming_chat: { enabled: 'true', daily_messages_cap: 5 } };
      expect(compareAIEntitlements(textTrue, legacyFlagsToAIEntitlements(textTrue))).toEqual([]);
      const off = { vex_agent: { enabled: false, daily_messages_cap: 5 } };
      expect(compareAIEntitlements(off, legacyFlagsToAIEntitlements(off))).toEqual([]);
    });

    it('per-agent splits the legacy JSON cannot express are new_model_only, not divergences', () => {
      let rows = legacyFlagsToAIEntitlements(FULL_FLAGS);
      rows = setRow(rows, 'vexi.voice_readout', { enabled: false });
      rows = setRow(rows, 'vex.files', { enabled: false });
      rows = setRow(rows, 'vex.code_analysis', { enabled: true });
      const diffs = compareAIEntitlements(FULL_FLAGS, rows);
      expect(diffs.map((d) => [d.capability, d.kind])).toEqual([
        ['vex.files', 'new_model_only'],
        ['vex.code_analysis', 'new_model_only'],
        ['vexi.voice_readout', 'new_model_only'],
      ]);
    });

    it('ignores caps of capabilities that are off on both sides, and rows of a switched-off agent', () => {
      const flags = { ...FULL_FLAGS, vex_agent: { ...FULL_FLAGS.vex_agent, enabled: false } };
      const rows = setRow(
        setRow(legacyFlagsToAIEntitlements(flags), 'vex.agent', { cap_value: 1 }),
        'vex.model_tokens',
        { cap_value: 7 },
      );
      expect(compareAIEntitlements(flags, rows)).toEqual([]);
    });
  });
});

describe('AIEntitlementsResolverService (T10)', () => {
  const planRow = (overrides: Record<string, unknown> = {}) => ({
    id: 10,
    ai_feature_flags: FULL_FLAGS,
    ai_entitlements: legacyFlagsToAIEntitlements(FULL_FLAGS).map((r) => ({
      ...r,
      cap_value: r.cap_value === null ? null : BigInt(r.cap_value),
    })),
    ...overrides,
  });

  function build(sub: unknown) {
    const prisma = {
      store_subscriptions: { findUnique: jest.fn().mockResolvedValue(sub) },
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    const service = new AIEntitlementsResolverService(prisma as any, redis as any);
    return { service, prisma, redis };
  }

  it('reads the paid plan rows from the table (BIGINT → number) and caches them 60 s', async () => {
    const { service, redis } = build({
      state: 'active',
      plan_id: 10,
      paid_plan_id: 10,
      promotional_applied_at: null,
      plan: planRow(),
      paid_plan: planRow(),
      promotional_plan: null,
      partner_override: null,
    });
    const resolved = await service.resolveForStore(7);
    expect(resolved).toMatchObject({ found: true, planId: 10, baseSource: 'table' });
    expect(byId(resolved.rows)['vex.model_tokens'].cap_value).toBe(20_000_000_000);
    expect(redis.set).toHaveBeenCalledWith('sub:entitlements:7', expect.any(String), 'EX', 60);
  });

  it('falls back to the legacy JSON when the plan has no rows yet', async () => {
    const { service } = build({
      state: 'trial',
      plan_id: 10,
      paid_plan_id: null,
      promotional_applied_at: null,
      plan: planRow({ ai_entitlements: [] }),
      paid_plan: null,
      promotional_plan: null,
      partner_override: null,
    });
    const resolved = await service.resolveForStore(7);
    expect(resolved.baseSource).toBe('legacy_fallback');
    expect(resolved.rows).toEqual(legacyFlagsToAIEntitlements(FULL_FLAGS));
  });

  it('applies the partner restriction and an active promo overlay in the legacy order', async () => {
    const promo = planRow({
      id: 99,
      promo_rules: { duration_days: 30 },
      ai_feature_flags: {},
      ai_entitlements: [
        { agent_key: 'vex', capability_key: 'agent', enabled: true, cap_value: BigInt(10), on_limit: 'warn' },
        { agent_key: 'vex', capability_key: 'code_analysis', enabled: true, cap_value: null, on_limit: 'block' },
      ],
    });
    const { service } = build({
      state: 'active',
      plan_id: 10,
      paid_plan_id: 10,
      promotional_applied_at: new Date(),
      plan: planRow(),
      paid_plan: planRow(),
      promotional_plan: promo,
      partner_override: { feature_overrides: { vex_agent: { daily_messages_cap: 20 } } },
    });
    const resolved = await service.resolveForStore(7);
    expect(resolved).toMatchObject({ partnerRestricted: true, overlayActive: true });
    // Partner lowered the base to 20; the promo's 10 does not win the union.
    expect(byId(resolved.rows)['vex.agent']).toMatchObject({ cap_value: 20, on_limit: 'block' });
    expect(byId(resolved.rows)['vex.code_analysis'].enabled).toBe(true);
  });

  it('a paid state without paid plan resolves every capability off', async () => {
    const { service } = build({
      state: 'pending_payment',
      plan_id: 10,
      paid_plan_id: null,
      promotional_applied_at: null,
      plan: planRow(),
      paid_plan: null,
      promotional_plan: null,
      partner_override: null,
    });
    const resolved = await service.resolveForStore(7);
    expect(resolved).toMatchObject({ found: true, planId: null, baseSource: 'none' });
    expect(resolved.rows).toEqual(legacyFlagsToAIEntitlements({}));
  });

  it('serves the cache without touching the database and invalidates by key', async () => {
    const { service, prisma, redis } = build(null);
    redis.get.mockResolvedValueOnce(
      JSON.stringify({ found: true, storeId: 7, planId: 10, rows: [], baseSource: 'table', partnerRestricted: false, overlayActive: false }),
    );
    const resolved = await service.resolveForStore(7);
    expect(prisma.store_subscriptions.findUnique).not.toHaveBeenCalled();
    expect(resolved.rows).toHaveLength(AI_CAPABILITIES.length);
    await service.invalidate(7);
    expect(redis.del).toHaveBeenCalledWith('sub:entitlements:7');
  });
});

describe('AIEntitlementsShadowService (T10)', () => {
  const originalEnv = process.env.AI_ENTITLEMENTS_SHADOW;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.AI_ENTITLEMENTS_SHADOW;
    else process.env.AI_ENTITLEMENTS_SHADOW = originalEnv;
  });

  function build(rows: Rows) {
    const tx = {
      hincrby: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const redis = {
      multi: jest.fn(() => tx),
      set: jest.fn().mockResolvedValue('OK'),
      hgetall: jest.fn().mockResolvedValue({}),
    };
    const resolver = {
      resolveForStore: jest.fn().mockResolvedValue({
        found: true,
        storeId: 7,
        planId: 10,
        rows,
        baseSource: 'table',
        partnerRestricted: false,
        overlayActive: false,
      }),
      planEntitlements: AIEntitlementsResolverService.prototype.planEntitlements,
    };
    const prisma = { subscription_plans: { findMany: jest.fn() } };
    const service = new AIEntitlementsShadowService(resolver as any, prisma as any, redis as any);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return { service, tx, redis, resolver, prisma, warn };
  }

  it('counts a check with no differences and logs nothing', async () => {
    const { service, tx, warn } = build(legacyFlagsToAIEntitlements(FULL_FLAGS));
    const diffs = await service.compareAndRecord(7, 'vex_agent', FULL_FLAGS as any);
    expect(diffs).toEqual([]);
    expect(tx.hincrby).toHaveBeenCalledWith(expect.stringMatching(/^ai:entitlements:shadow:\d{8}$/), 'checks', 1);
    expect(tx.hincrby).not.toHaveBeenCalledWith(expect.any(String), 'divergent', 1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports a diff for a plan the gate lets through whose row was copied off (F1)', async () => {
    const gateFlags = { vex_agent: { daily_messages_cap: 10 } };
    const { service, tx, warn } = build(
      legacyFlagsToAIEntitlements({ vex_agent: { enabled: false, daily_messages_cap: 10 } }),
    );
    const diffs = await service.compareAndRecord(7, 'vex_agent', gateFlags as any);
    expect(diffs.find((d) => d.capability === 'vex.agent')).toMatchObject({
      kind: 'divergence',
      current: 'no incluido',
    });
    expect(tx.hincrby).toHaveBeenCalledWith(expect.any(String), 'divergent', 1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('AI_ENTITLEMENT_SHADOW_DIFF'));
  });

  it('counts a divergence per store and logs AI_ENTITLEMENT_SHADOW_DIFF once per store/difference/day', async () => {
    const rows = setRow(legacyFlagsToAIEntitlements(FULL_FLAGS), 'vex.agent', { cap_value: 10 });
    const { service, tx, redis, warn } = build(rows);
    await service.compareAndRecord(7, 'vex_agent', FULL_FLAGS as any);
    expect(tx.hincrby).toHaveBeenCalledWith(expect.any(String), 'divergent', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(expect.any(String), 'store:7', 1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:entitlements:shadow:seen:\d{8}:7:[0-9a-f]{16}$/),
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('AI_ENTITLEMENT_SHADOW_DIFF'));

    redis.set.mockResolvedValueOnce(null); // already seen today
    warn.mockClear();
    await service.compareAndRecord(7, 'vex_agent', FULL_FLAGS as any);
    expect(warn).not.toHaveBeenCalled();
  });

  it('observe never throws, skips legacy features without a capability and honors the off switch', async () => {
    const { service, resolver, warn } = build([]);
    resolver.resolveForStore.mockRejectedValueOnce(new Error('redis down'));
    expect(() => service.observe(7, 'vex_agent', FULL_FLAGS as any)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('redis down'));

    resolver.resolveForStore.mockClear();
    service.observe(7, 'tool_agents', FULL_FLAGS as any);
    process.env.AI_ENTITLEMENTS_SHADOW = 'false';
    service.observe(7, 'vex_agent', FULL_FLAGS as any);
    expect(resolver.resolveForStore).not.toHaveBeenCalled();
  });

  it('report lists only plans with differences, flags missing rows and sums runtime counters', async () => {
    const { service, prisma, redis } = build([]);
    const backfilled = legacyFlagsToAIEntitlements(FULL_FLAGS);
    prisma.subscription_plans.findMany.mockResolvedValue([
      { id: 1, code: 'ok', name: 'OK', state: 'active', ai_feature_flags: FULL_FLAGS, ai_entitlements: backfilled },
      { id: 2, code: 'new', name: 'Sin filas', state: 'active', ai_feature_flags: FULL_FLAGS, ai_entitlements: [] },
      {
        id: 3,
        code: 'edited',
        name: 'Editado',
        state: 'draft',
        ai_feature_flags: { ...FULL_FLAGS, streaming_chat: { enabled: false } },
        ai_entitlements: backfilled,
      },
    ]);
    const now = new Date('2026-11-20T12:00:00Z');
    redis.hgetall.mockImplementation(async (key: string) =>
      key.endsWith('20261120')
        ? { checks: '12', divergent: '3', new_model_only: '1', 'store:7': '2', 'store:9': '1' }
        : {},
    );
    const report = await service.buildReport(now);
    expect(report.plans_checked).toBe(3);
    expect(report.plans.map((p) => p.code)).toEqual(['new', 'edited']);
    expect(report.plans[0].differences).toHaveLength(AI_CAPABILITIES.length);
    // Vexi switched off in the legacy JSON: the agent and every Vexi row it gates.
    expect(report.plans[1].differences.map((d) => [d.capability, d.kind])).toEqual([
      ['vexi.agent', 'divergence'],
      ['vexi.model_tokens', 'divergence'],
      ['vexi.voice_readout', 'divergence'],
    ]);
    expect(report.total_divergences).toBe(AI_CAPABILITIES.length + 3);
    expect(report.runtime).toEqual({
      days: [{ day: '2026-11-20', count: 3, checks: 12, new_model_only: 1 }],
      total: 3,
      divergent_stores: [7, 9],
    });
  });
});

describe('SubscriptionAccessService — shadow hook keeps the legacy decision (T10)', () => {
  function build(shadow?: unknown) {
    const resolver = {
      resolveSubscription: jest.fn().mockResolvedValue({
        found: true,
        storeId: 7,
        state: 'active',
        planId: 10,
        planCode: 'pro',
        paidPlanId: 10,
        pendingPlanId: null,
        partnerOrgId: null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: { vex_agent: { enabled: true, daily_messages_cap: 0 } },
        gracePeriodSoftDays: 0,
        gracePeriodHardDays: 0,
        currentPeriodEnd: null,
      }),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };
    const redis = { get: jest.fn().mockResolvedValue(null) };
    const entitlementsResolver = { invalidate: jest.fn().mockResolvedValue(undefined) };
    const service = new SubscriptionAccessService(
      resolver as any,
      redis as any,
      {} as any,
      shadow as any,
      entitlementsResolver as any,
    );
    return { service, resolver, entitlementsResolver };
  }

  it('the gate answers the same with, without and with a throwing shadow', async () => {
    const observe = jest.fn();
    const withShadow = await build({ observe }).service.canUseAIFeature(7, 'vex_agent');
    const without = await build(undefined).service.canUseAIFeature(7, 'vex_agent');
    const throwing = await build({
      observe: () => {
        throw new Error('boom');
      },
    }).service.canUseAIFeature(7, 'vex_agent');
    expect(withShadow).toEqual(without);
    expect(throwing).toEqual(without);
    expect(without).toMatchObject({ allowed: true });
    expect(observe).toHaveBeenCalledWith(7, 'vex_agent', {
      vex_agent: { enabled: true, daily_messages_cap: 0 },
    });
  });

  it('invalidating the subscription cache also drops the entitlements cache', async () => {
    const { service, resolver, entitlementsResolver } = build(undefined);
    await service.invalidateCache(7);
    expect(resolver.invalidate).toHaveBeenCalledWith(7);
    expect(entitlementsResolver.invalidate).toHaveBeenCalledWith(7);
  });
});
