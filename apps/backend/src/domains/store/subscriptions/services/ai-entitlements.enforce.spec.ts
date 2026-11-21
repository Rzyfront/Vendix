import {
  AIEntitlement,
  legacyFlagsToAIEntitlements,
} from '../types/ai-capabilities';
import { enforcedFeatureDecision } from './ai-entitlements-enforce';
import { SubscriptionAccessService } from './subscription-access.service';

/** Every catalog row off, then the given patches (agent.capability → fields). */
function rowsWith(
  patches: Record<string, Partial<AIEntitlement>>,
): AIEntitlement[] {
  return legacyFlagsToAIEntitlements({}).map((row) => {
    const patch = patches[`${row.agent_key}.${row.capability_key}`];
    return patch ? { ...row, ...patch } : { ...row, enabled: false };
  });
}

describe('T20 — enforcedFeatureDecision (rows only, never the legacy JSON)', () => {
  it('a granted agent projects its caps; NULL leaves the field out (unlimited)', () => {
    const rows = rowsWith({
      'vex.agent': { enabled: true, cap_value: 200, on_limit: 'block' },
      'vex.model_tokens': { enabled: true, cap_value: null },
    });
    expect(enforcedFeatureDecision('vex_agent', rows)).toEqual({
      kind: 'on',
      config: { enabled: true, degradation: 'block', daily_messages_cap: 200 },
    });
  });

  it('an agent switched off in the plan is off', () => {
    const rows = rowsWith({ 'vex.model_tokens': { enabled: true, cap_value: 5 } });
    expect(enforcedFeatureDecision('vex_agent', rows)).toEqual({ kind: 'off' });
  });

  it('a cap of 0 is "nothing": exhausted, never unlimited', () => {
    const rows = rowsWith({
      'vex.agent': { enabled: true, cap_value: 50 },
      'vex.model_tokens': { enabled: true, cap_value: 0, on_limit: 'warn' },
    });
    expect(enforcedFeatureDecision('vex_agent', rows)).toEqual({ kind: 'exhausted' });
  });

  it('conversations and tool_agents follow the Vexi agent row', () => {
    const on = rowsWith({ 'vexi.agent': { enabled: true, cap_value: null } });
    const off = rowsWith({});
    expect(enforcedFeatureDecision('conversations', on)).toEqual({
      kind: 'on',
      config: { enabled: true, degradation: 'warn' },
    });
    expect(enforcedFeatureDecision('tool_agents', off)).toEqual({ kind: 'off' });
  });

  it('async_queue is engine configuration: on even without any row', () => {
    expect(enforcedFeatureDecision('async_queue', rowsWith({}))).toEqual({
      kind: 'on',
      config: { enabled: true, degradation: 'warn' },
    });
  });

  it('the shared voice key is on when either agent keeps its voice', () => {
    const rows = rowsWith({
      'vex.agent': { enabled: true },
      'vex.voice_readout': { enabled: true, cap_value: 600 },
    });
    expect(enforcedFeatureDecision('realtime_voice', rows)).toMatchObject({
      kind: 'on',
      config: { enabled: true, monthly_voice_seconds_cap: 600 },
    });
    expect(enforcedFeatureDecision('realtime_voice', rowsWith({}))).toEqual({
      kind: 'off',
    });
  });
});

describe('T20 — the gate under AI_ENTITLEMENTS_MODE', () => {
  const previousMode = process.env.AI_ENTITLEMENTS_MODE;
  afterEach(() => {
    if (previousMode === undefined) delete process.env.AI_ENTITLEMENTS_MODE;
    else process.env.AI_ENTITLEMENTS_MODE = previousMode;
  });

  function build(opts: {
    legacy: Record<string, unknown>;
    rows?: AIEntitlement[];
    resolveError?: Error;
  }) {
    const resolver = {
      resolveSubscription: jest.fn().mockResolvedValue({
        found: true,
        state: 'active',
        planId: 10,
        planCode: 'pro',
        paidPlanId: 10,
        pendingPlanId: null,
        partnerOrgId: null,
        overlayActive: false,
        overlayExpiresAt: null,
        features: opts.legacy,
        gracePeriodSoftDays: 0,
        gracePeriodHardDays: 0,
        currentPeriodEnd: null,
      }),
      invalidate: jest.fn(),
    };
    const redis = { get: jest.fn().mockResolvedValue(null) };
    const entitlementsResolver = {
      resolveForStore: opts.resolveError
        ? jest.fn().mockRejectedValue(opts.resolveError)
        : jest.fn().mockResolvedValue({
            found: true,
            storeId: 7,
            planId: 10,
            rows: opts.rows ?? [],
            baseSource: 'table',
            partnerRestricted: false,
            overlayActive: false,
          }),
      invalidate: jest.fn(),
    };
    const service = new SubscriptionAccessService(
      resolver as any,
      redis as any,
      {} as any,
      undefined,
      entitlementsResolver as any,
    );
    return { service, redis, entitlementsResolver };
  }

  it('enforce: rows off block the agent even when the legacy JSON grants it', async () => {
    process.env.AI_ENTITLEMENTS_MODE = 'enforce';
    const { service } = build({
      legacy: { vex_agent: { enabled: true } },
      rows: rowsWith({}),
    });
    await expect(service.canUseAIFeature(7, 'vex_agent')).resolves.toMatchObject({
      allowed: false,
      mode: 'block',
      reason: 'SUBSCRIPTION_005',
    });
  });

  it('enforce: rows on grant the agent even when the legacy JSON denies it', async () => {
    process.env.AI_ENTITLEMENTS_MODE = 'enforce';
    const { service } = build({
      legacy: { vex_agent: { enabled: false } },
      rows: rowsWith({ 'vex.agent': { enabled: true, cap_value: 200 } }),
    });
    await expect(service.canUseAIFeature(7, 'vex_agent')).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('enforce: a cap of 0 answers SUBSCRIPTION_006 without reading the counters', async () => {
    process.env.AI_ENTITLEMENTS_MODE = 'enforce';
    const { service, redis } = build({
      legacy: { vex_agent: { enabled: true } },
      rows: rowsWith({
        'vex.agent': { enabled: true, cap_value: 0, on_limit: 'warn' },
      }),
    });
    await expect(service.canUseAIFeature(7, 'vex_agent')).resolves.toMatchObject({
      allowed: false,
      mode: 'block',
      severity: 'critical',
      reason: 'SUBSCRIPTION_006',
    });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('enforce: an unreadable entitlements table fails closed', async () => {
    process.env.AI_ENTITLEMENTS_MODE = 'enforce';
    const { service } = build({
      legacy: { vex_agent: { enabled: true } },
      resolveError: new Error('db down'),
    });
    await expect(service.canUseAIFeature(7, 'vex_agent')).resolves.toMatchObject({
      allowed: false,
      reason: 'SUBSCRIPTION_005',
    });
  });

  it('shadow (default): the legacy JSON still decides and the rows are not read', async () => {
    delete process.env.AI_ENTITLEMENTS_MODE;
    const { service, entitlementsResolver } = build({
      legacy: { vex_agent: { enabled: true } },
      rows: rowsWith({}),
    });
    await expect(service.canUseAIFeature(7, 'vex_agent')).resolves.toMatchObject({
      allowed: true,
    });
    expect(entitlementsResolver.resolveForStore).not.toHaveBeenCalled();
  });
});
