import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PlansService } from './plans.service';
import { PromotionalService } from './promotional.service';
import { PlanModuleRulesService } from '../../../../common/access/plan-module-rules.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreatePlanDto } from '../dto';
import {
  AI_CAPABILITIES,
  AIEntitlement,
  aiCapAcceptsZero,
  aiCapabilityId,
  legacyFlagsToAIEntitlements,
} from '../../../store/subscriptions/types/ai-capabilities';
import {
  compareAIEntitlements,
  writeAIEntitlementsToLegacyFlags,
} from '../../../store/subscriptions/services/ai-entitlements.logic';

/**
 * T12 — the superadmin saves a plan's AI capabilities per agent; while the
 * gate still decides with `ai_feature_flags` (shadow mode), every save writes
 * both models in the same transaction and keeps them in agreement.
 */

const LEGACY_FLAGS = {
  vex_agent: { enabled: true, daily_messages_cap: 100, degradation: 'warn' },
  streaming_chat: { enabled: true, daily_messages_cap: 40 },
  text_generation: { enabled: true, monthly_tokens_cap: 2_000_000 },
  realtime_voice: { enabled: false },
  rag_embeddings: { enabled: false },
};
/** Stored flags of an existing plan (update tolerates persisted tools). */
const STORED_FLAGS = { ...LEGACY_FLAGS, tools_allowed: ['products.search'] };

function row(
  id: string,
  patch: Partial<AIEntitlement> = {},
): AIEntitlement {
  const [agent_key, capability_key] = id.split('.') as [
    AIEntitlement['agent_key'],
    string,
  ];
  return {
    agent_key,
    capability_key,
    enabled: true,
    cap_value: null,
    on_limit: 'block',
    ...patch,
  };
}

function byId(rows: Array<{ agent_key: string; capability_key: string }>) {
  return Object.fromEntries(
    rows.map((r) => [aiCapabilityId(r.agent_key, r.capability_key), r]),
  ) as Record<string, any>;
}

function errorCodeOf(promise: Promise<unknown>) {
  return promise.then(
    () => 'resolved',
    (e) => {
      expect(e).toBeInstanceOf(VendixHttpException);
      return (e as VendixHttpException).getResponse() as any;
    },
  );
}

describe('PlansService — ai_entitlements (T12)', () => {
  let service: PlansService;
  let prisma: any;
  let tx: any;

  beforeEach(() => {
    tx = {
      subscription_plans: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        create: jest.fn(({ data }: any) =>
          Promise.resolve({ id: 900 + tx.subscription_plans.create.mock.calls.length, ...data }),
        ),
        delete: jest.fn(),
      },
      store_subscriptions: { count: jest.fn().mockResolvedValue(0) },
      plan_module_rules: { deleteMany: jest.fn() },
      plan_ai_entitlements: {
        deleteMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      subscription_plans: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    service = new PlansService(prisma, {
      invalidate: jest.fn(),
    } as unknown as PlanModuleRulesService);
  });

  function plan(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      code: 'pro',
      name: 'Pro',
      plan_type: 'base',
      state: 'active',
      billing_cycle: 'monthly',
      base_price: new Prisma.Decimal(99000),
      currency: 'COP',
      plan_group_code: 'pro',
      is_promotional: false,
      ai_feature_flags: STORED_FLAGS,
      ...overrides,
    };
  }

  /** Group rows for the T12 propagation query (`select: { id }`). */
  function groupOf(ids: number[]) {
    tx.subscription_plans.findMany.mockImplementation((args: any) =>
      Promise.resolve(
        args?.select?.id ? ids.map((id) => ({ id })) : [],
      ),
    );
  }

  function nestedCreateRows(data: any) {
    return data.ai_entitlements.create as Array<Record<string, unknown>>;
  }

  describe('DTO', () => {
    async function errorsFor(entry: Record<string, unknown>) {
      const dto = plainToInstance(CreatePlanDto, {
        code: 'x',
        name: 'X',
        ai_entitlements: [entry],
      });
      const errors = await validate(dto);
      return JSON.stringify(errors.filter((e) => e.property === 'ai_entitlements'));
    }
    const ok = {
      agent_key: 'vex',
      capability_key: 'agent',
      enabled: true,
      cap_value: 10,
      on_limit: 'warn',
    };

    it('accepts a row with a cap, and a NULL or omitted cap (unlimited)', async () => {
      expect(await errorsFor(ok)).toBe('[]');
      expect(await errorsFor({ ...ok, cap_value: null })).toBe('[]');
      const { cap_value: _omit, ...withoutCap } = ok;
      expect(await errorsFor(withoutCap)).toBe('[]');
    });

    it('rejects a negative or fractional cap, an unknown agent and an unknown on_limit', async () => {
      expect(await errorsFor({ ...ok, cap_value: -1 })).toMatch(/cap_value/);
      expect(await errorsFor({ ...ok, cap_value: 1.5 })).toMatch(/cap_value/);
      expect(await errorsFor({ ...ok, agent_key: 'robot' })).toMatch(/agent_key/);
      expect(await errorsFor({ ...ok, on_limit: 'ignore' })).toMatch(/on_limit/);
      expect(await errorsFor({ ...ok, enabled: 'yes' })).toMatch(/enabled/);
    });
  });

  describe('create', () => {
    it('stores the 11 rows (sent ones applied, the rest from the legacy flags) and the legacy fields they own', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);

      await service.create({
        code: 'pro',
        name: 'Pro',
        base_price: 99000,
        ai_feature_flags: LEGACY_FLAGS,
        ai_entitlements: [
          row('vex.agent', { cap_value: 50, on_limit: 'block' }),
          row('vexi.agent', { enabled: false, cap_value: 40, on_limit: 'warn' }),
        ],
      } as any);

      const data = prisma.subscription_plans.create.mock.calls[0][0].data;
      const rows = nestedCreateRows(data);
      expect(rows.map((r) => aiCapabilityId(r.agent_key as string, r.capability_key as string))).toEqual(
        AI_CAPABILITIES.map((c) => aiCapabilityId(c.agent_key, c.capability_key)),
      );
      const created = byId(rows);
      expect(created['vex.agent']).toEqual({
        agent_key: 'vex',
        capability_key: 'agent',
        enabled: true,
        cap_value: BigInt(50),
        on_limit: 'block',
      });
      expect(created['vexi.agent'].enabled).toBe(false);
      // Not sent: legacy translation of the flags sent.
      expect(created['vexi.model_tokens'].cap_value).toBe(BigInt(2_000_000));

      expect(data.ai_feature_flags.vex_agent).toEqual({
        enabled: true,
        daily_messages_cap: 50,
        degradation: 'block',
      });
      expect(data.ai_feature_flags.streaming_chat).toEqual({
        enabled: false,
        daily_messages_cap: 40,
        degradation: 'warn',
      });
      // Features the rows do not touch keep their fields.
      expect(data.ai_feature_flags.realtime_voice).toEqual({
        enabled: false,
        degradation: 'warn',
      });
    });

    it('without ai_entitlements, the rows are the legacy translation and the flags stay as sent', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);

      await service.create({
        code: 'pro',
        name: 'Pro',
        base_price: 99000,
        ai_feature_flags: LEGACY_FLAGS,
      } as any);

      const data = prisma.subscription_plans.create.mock.calls[0][0].data;
      expect(data.ai_feature_flags).toEqual(LEGACY_FLAGS);
      expect(nestedCreateRows(data)).toEqual(
        legacyFlagsToAIEntitlements(LEGACY_FLAGS).map((r) => ({
          ...r,
          cap_value: r.cap_value === null ? null : BigInt(r.cap_value),
        })),
      );
    });

    it('gives every cycle of a multi-cycle plan the same rows', async () => {
      await service.create({
        code: 'pro',
        name: 'Pro',
        ai_feature_flags: LEGACY_FLAGS,
        ai_entitlements: [row('vex.agent', { cap_value: 7 })],
        pricings: [
          { billing_cycle: 'monthly', price: 1, is_default: true },
          { billing_cycle: 'annual', price: 10, is_default: false },
        ],
      } as any);

      const [monthly, annual] = tx.subscription_plans.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(byId(nestedCreateRows(monthly))['vex.agent'].cap_value).toBe(BigInt(7));
      expect(nestedCreateRows(annual)).toEqual(nestedCreateRows(monthly));
      expect(annual.ai_feature_flags).toEqual(monthly.ai_feature_flags);
    });

    it.each([
      ['an unknown capability', [row('vex.teleport')], 'vex.teleport is not an AI capability'],
      ['a repeated capability', [row('vex.agent'), row('vex.agent')], 'vex.agent is repeated'],
      ['a cap on a capability without one', [row('vex.files', { cap_value: 3 })], 'vex.files does not take a cap'],
      [
        'a cap of 0 on a cap-only capability (the legacy gate would read it as unlimited)',
        [row('vex.model_tokens', { cap_value: 0 })],
        'vex.model_tokens cannot take a cap of 0',
      ],
      [
        'a cap of 0 that warns at the limit',
        [row('vex.voice_readout', { cap_value: 0, on_limit: 'warn' })],
        'vex.voice_readout cannot take a cap of 0',
      ],
    ])('rejects %s with SUBSCRIPTION_VALIDATION and writes nothing', async (_label, rows, message) => {
      prisma.subscription_plans.findUnique.mockResolvedValue(null);

      const response = await errorCodeOf(
        service.create({ code: 'pro', name: 'Pro', ai_entitlements: rows } as any),
      );

      expect(response.error_code).toBe(ErrorCodes.SUBSCRIPTION_VALIDATION.code);
      expect(response.message).toContain(message);
      expect(prisma.subscription_plans.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const stored = legacyFlagsToAIEntitlements(STORED_FLAGS).map((r) => ({
      ...r,
      // Per-agent setting the legacy JSON cannot express.
      ...(r.agent_key === 'vexi' && r.capability_key === 'voice_readout'
        ? { enabled: false }
        : {}),
      ...(r.agent_key === 'vex' && r.capability_key === 'voice_readout'
        ? { enabled: true }
        : {}),
      cap_value: r.cap_value === null ? null : BigInt(r.cap_value),
    }));

    beforeEach(() => {
      prisma.subscription_plans.findUnique.mockResolvedValue(plan());
      tx.plan_ai_entitlements.findMany.mockResolvedValue(stored);
    });

    function upsertsFor(planId: number) {
      return tx.plan_ai_entitlements.upsert.mock.calls
        .map((c: any[]) => c[0])
        .filter((a: any) => a.where.plan_id_agent_key_capability_key.plan_id === planId);
    }

    it('completes a partial save against the stored rows and rewrites every surviving row of the group', async () => {
      groupOf([1, 2]);

      await service.update(1, {
        ai_entitlements: [row('vex.agent', { cap_value: 0, on_limit: 'block' })],
      } as any);

      expect(tx.plan_ai_entitlements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { plan_id: 1 } }),
      );
      for (const planId of [1, 2]) {
        const upserts = upsertsFor(planId);
        expect(upserts).toHaveLength(AI_CAPABILITIES.length);
        const vexAgent = upserts.find(
          (u: any) => u.where.plan_id_agent_key_capability_key.capability_key === 'agent' &&
            u.where.plan_id_agent_key_capability_key.agent_key === 'vex',
        );
        expect(vexAgent.update).toMatchObject({ enabled: true, cap_value: BigInt(0), on_limit: 'block' });
        const vexiVoice = upserts.find(
          (u: any) => u.where.plan_id_agent_key_capability_key.agent_key === 'vexi' &&
            u.where.plan_id_agent_key_capability_key.capability_key === 'voice_readout',
        );
        // Not sent: the stored per-agent value is kept.
        expect(vexiVoice.update).toMatchObject({ enabled: false });
      }

      const flags = tx.subscription_plans.updateMany.mock.calls[0][0].data.ai_feature_flags;
      // A cap of 0 that blocks gives nothing: the legacy JSON (which cannot hold
      // 0) switches the feature off, so the gate denies as the rows do.
      expect(flags.vex_agent).toEqual({ enabled: false, degradation: 'warn' });
      expect(flags.tools_allowed).toEqual(['products.search']);
    });

    it('gives a new billing cycle the saved rows once, inside the same transaction', async () => {
      tx.subscription_plans.findMany.mockImplementation((args: any) =>
        Promise.resolve(
          args?.select?.id
            ? [{ id: 1 }, { id: 901 }]
            : [plan({ id: 1, billing_cycle: 'monthly' })],
        ),
      );

      await service.update(1, {
        ai_entitlements: [row('vex.agent', { cap_value: 9 })],
        pricings: [
          { billing_cycle: 'monthly', price: 1, is_default: true },
          { billing_cycle: 'annual', price: 10, is_default: false },
        ],
      } as any);

      const newCycle = tx.subscription_plans.create.mock.calls[0][0].data;
      expect(byId(nestedCreateRows(newCycle))['vex.agent'].cap_value).toBe(BigInt(9));
      expect(newCycle.ai_feature_flags.vex_agent.daily_messages_cap).toBe(9);
      expect(upsertsFor(901)).toHaveLength(0);
      expect(upsertsFor(1)).toHaveLength(AI_CAPABILITIES.length);
    });

    it('a new cycle without AI changes copies the stored rows of the plan', async () => {
      tx.subscription_plans.findMany.mockResolvedValue([plan({ id: 1, billing_cycle: 'monthly' })]);

      await service.update(1, {
        pricings: [
          { billing_cycle: 'monthly', price: 1, is_default: true },
          { billing_cycle: 'annual', price: 10, is_default: false },
        ],
      } as any);

      const newCycle = tx.subscription_plans.create.mock.calls[0][0].data;
      expect(byId(nestedCreateRows(newCycle))['vexi.voice_readout'].enabled).toBe(false);
      expect(byId(nestedCreateRows(newCycle))['vex.voice_readout'].enabled).toBe(true);
      expect(tx.plan_ai_entitlements.upsert).not.toHaveBeenCalled();
    });

    it('a legacy-only save that resends the same flags rewrites no row (per-agent settings survive)', async () => {
      groupOf([1]);

      await service.update(1, { ai_feature_flags: { ...STORED_FLAGS } } as any);

      const upserts = upsertsFor(1);
      expect(upserts).toHaveLength(AI_CAPABILITIES.length);
      expect(upserts.every((u: any) => Object.keys(u.update).length === 0)).toBe(true);
      expect(tx.subscription_plans.updateMany.mock.calls[0][0].data.ai_feature_flags).toEqual(STORED_FLAGS);
    });

    it('a legacy-only save rewrites only the rows of the features whose JSON changed', async () => {
      groupOf([1]);

      await service.update(1, {
        ai_feature_flags: {
          ...STORED_FLAGS,
          realtime_voice: { enabled: true, monthly_voice_seconds_cap: 600 },
        },
      } as any);

      const rewritten = upsertsFor(1)
        .filter((u: any) => Object.keys(u.update).length > 0)
        .map((u: any) => aiCapabilityId(
          u.where.plan_id_agent_key_capability_key.agent_key,
          u.where.plan_id_agent_key_capability_key.capability_key,
        ));
      expect(rewritten.sort()).toEqual(['vex.voice_readout', 'vexi.voice_readout']);
      expect(
        upsertsFor(1).find((u: any) => u.create.agent_key === 'vexi' && u.create.capability_key === 'voice_readout').update,
      ).toMatchObject({ enabled: true, cap_value: BigInt(600) });
    });

    it('a save without AI fields touches neither the rows nor ai_feature_flags', async () => {
      groupOf([1]);

      await service.update(1, { name: 'Pro 2' } as any);

      expect(tx.plan_ai_entitlements.findMany).not.toHaveBeenCalled();
      expect(tx.plan_ai_entitlements.upsert).not.toHaveBeenCalled();
      expect(tx.subscription_plans.updateMany.mock.calls[0][0].data).not.toHaveProperty('ai_feature_flags');
    });

    it('rejects an unknown capability before opening the transaction', async () => {
      const response = await errorCodeOf(
        service.update(1, { ai_entitlements: [row('vexi.files')] } as any),
      );

      expect(response.error_code).toBe(ErrorCodes.SUBSCRIPTION_VALIDATION.code);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the 11 rows from the table with numeric caps', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(
        plan({
          ai_entitlements: [
            { agent_key: 'vex', capability_key: 'agent', enabled: true, cap_value: BigInt(25), on_limit: 'warn' },
          ],
        }),
      );

      const result: any = await service.findOne(1);

      expect(prisma.subscription_plans.findUnique.mock.calls[0][0].include.ai_entitlements).toBeDefined();
      expect(result.ai_entitlements_source).toBe('table');
      expect(result.ai_entitlements).toHaveLength(AI_CAPABILITIES.length);
      expect(byId(result.ai_entitlements)['vex.agent']).toEqual(
        row('vex.agent', { cap_value: 25, on_limit: 'warn' }),
      );
      // Missing in the table: legacy translation.
      expect(byId(result.ai_entitlements)['vexi.agent'].cap_value).toBe(40);
      expect(() => JSON.stringify(result.ai_entitlements)).not.toThrow();
    });

    it('a plan without rows yet answers with the legacy translation', async () => {
      prisma.subscription_plans.findUnique.mockResolvedValue(plan({ ai_entitlements: [] }));

      const result: any = await service.findOne(1);

      expect(result.ai_entitlements_source).toBe('legacy_fallback');
      expect(result.ai_entitlements).toEqual(legacyFlagsToAIEntitlements(LEGACY_FLAGS));
    });
  });
});

describe('dual write keeps the shadow comparison at zero divergences (T12)', () => {
  const ids = AI_CAPABILITIES.map((c) => aiCapabilityId(c.agent_key, c.capability_key));

  /** Deterministic pseudo-random rows covering on/off, caps and on_limit. */
  function sample(seed: number): AIEntitlement[] {
    let state = seed;
    const next = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    return AI_CAPABILITIES.map((def) => {
      const r = next();
      return {
        agent_key: def.agent_key,
        capability_key: def.capability_key,
        enabled: next() > 0.3,
        cap_value: def.kind === 'toggle' ? null : r < 0.2 ? null : r < 0.3 ? 0 : Math.floor(r * 10_000),
        on_limit: next() > 0.5 ? 'block' : 'warn',
      } as AIEntitlement;
    }).map((row) => {
      // Only what the save accepts: a 0 the legacy gate cannot enforce is a 400.
      const def = AI_CAPABILITIES.find(
        (c) => c.agent_key === row.agent_key && c.capability_key === row.capability_key,
      )!;
      return row.cap_value === 0 && !aiCapAcceptsZero(def, row.on_limit)
        ? { ...row, cap_value: 1 }
        : row;
    });
  }

  it('no saved combination leaves a legacy field that disagrees with the rows', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rows = sample(seed);
      const flags = writeAIEntitlementsToLegacyFlags(LEGACY_FLAGS, rows);
      const divergences = compareAIEntitlements(flags, rows).filter(
        (d) => d.kind === 'divergence',
      );
      expect({ seed, divergences }).toEqual({ seed, divergences: [] });
    }
    expect(ids).toHaveLength(11);
  });

  it.each([
    ['vex.model_tokens', 'vex_agent'],
    ['vexi.model_tokens', 'text_generation'],
  ])(
    'a 0 on %s that the legacy JSON cannot hold (it reads as unlimited) is a divergence, never new_model_only',
    (id, feature) => {
      const legacy = {
        ...LEGACY_FLAGS,
        vex_agent: { enabled: true, daily_messages_cap: 200, monthly_tokens_cap: 200_000_000, degradation: 'block' },
        text_generation: { enabled: true, monthly_tokens_cap: 5_000_000, degradation: 'block' },
      };
      const rows = legacyFlagsToAIEntitlements(legacy).map((r) =>
        aiCapabilityId(r.agent_key, r.capability_key) === id
          ? { ...r, cap_value: 0, on_limit: 'block' as const }
          : r,
      );
      const flags = writeAIEntitlementsToLegacyFlags(legacy, rows);
      const diff = compareAIEntitlements(flags, rows).find((d) => d.capability === id);
      expect(diff?.kind).toBe('divergence');
      expect((flags[feature] as Record<string, unknown>).enabled).toBe(true);
    },
  );

  it('a NULL cap removes the legacy field (absent = unlimited) and keeps unrelated keys', () => {
    const flags = writeAIEntitlementsToLegacyFlags(
      { vex_agent: { enabled: true, daily_messages_cap: 9, custom: 'x' }, agents_allowed: ['a'] },
      [row('vex.agent', { cap_value: null }), row('vex.model_tokens', { cap_value: null })],
    );
    expect(flags.vex_agent).toEqual({ enabled: true, custom: 'x', degradation: 'block' });
    expect(flags.agents_allowed).toEqual(['a']);
  });
});

describe('legacy features folded into the Vexi agent (T12)', () => {
  const base = {
    conversations: { enabled: false, retention_days: 90 },
    tool_agents: { enabled: false, tools_allowed: ['*'], monthly_tool_calls_cap: 50 },
  };

  it('conversations and tool_agents follow vexi.agent and keep their other fields', () => {
    const on = writeAIEntitlementsToLegacyFlags(base, [row('vexi.agent', { cap_value: 10 })]);
    expect(on.conversations).toEqual({ enabled: true, retention_days: 90 });
    expect(on.tool_agents).toEqual({
      enabled: true,
      tools_allowed: ['*'],
      monthly_tool_calls_cap: 50,
    });
  });

  it('a Vexi agent off, or with a cap of 0 that blocks, switches them off', () => {
    for (const vexi of [
      row('vexi.agent', { enabled: false }),
      row('vexi.agent', { cap_value: 0, on_limit: 'block' }),
    ]) {
      const flags = writeAIEntitlementsToLegacyFlags(
        { conversations: { enabled: true }, tool_agents: { enabled: true } },
        [vexi],
      );
      expect(flags.conversations).toEqual({ enabled: false });
      expect(flags.tool_agents).toEqual({ enabled: false });
    }
  });

  it('a plan created from the new screen with Vexi on can open conversations', async () => {
    const prisma: any = {
      subscription_plans: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      },
    };
    const service = new PlansService(prisma);

    await service.create({
      code: 'nuevo',
      name: 'Nuevo',
      base_price: 1,
      ai_entitlements: [row('vexi.agent', { cap_value: 30 })],
    } as any);

    const flags = prisma.subscription_plans.create.mock.calls[0][0].data.ai_feature_flags;
    expect(flags.streaming_chat).toMatchObject({ enabled: true, daily_messages_cap: 30 });
    expect(flags.conversations).toEqual({ enabled: true });
    expect(flags.tool_agents).toEqual({ enabled: true });
  });
});

describe('PromotionalService — AI rows (T12)', () => {
  let prisma: any;
  let service: PromotionalService;

  beforeEach(() => {
    prisma = {
      subscription_plans: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 5 }),
        update: jest.fn().mockResolvedValue({ id: 5 }),
        delete: jest.fn().mockResolvedValue({ id: 5 }),
      },
      plan_ai_entitlements: { deleteMany: jest.fn().mockResolvedValue({ count: 11 }) },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    service = new PromotionalService(prisma);
  });

  it('a new promo starts with its 11 rows (legacy translation)', async () => {
    await service.create({ code: 'bf', name: 'BF', base_price: 0, ai_feature_flags: LEGACY_FLAGS } as any);

    const data = prisma.subscription_plans.create.mock.calls[0][0].data;
    expect(data.ai_entitlements.create).toHaveLength(AI_CAPABILITIES.length);
    expect(byId(data.ai_entitlements.create)['vex.agent'].cap_value).toBe(BigInt(100));
  });

  it('editing the flags rewrites only the rows of changed features, in the same statement', async () => {
    prisma.subscription_plans.findFirst.mockResolvedValue({ id: 5, code: 'bf', ai_feature_flags: LEGACY_FLAGS });

    await service.update(5, {
      ai_feature_flags: { ...LEGACY_FLAGS, vex_agent: { enabled: false } },
    } as any);

    const upserts = prisma.subscription_plans.update.mock.calls[0][0].data.ai_entitlements.upsert;
    expect(upserts).toHaveLength(AI_CAPABILITIES.length);
    const rewritten = upserts
      .filter((u: any) => Object.keys(u.update).length > 0)
      .map((u: any) => aiCapabilityId(u.create.agent_key, u.create.capability_key));
    expect(rewritten.sort()).toEqual(['vex.agent', 'vex.files', 'vex.model_tokens']);
  });

  it('deleting a promo removes its AI rows first (FK RESTRICT), in one transaction', async () => {
    prisma.subscription_plans.findFirst.mockResolvedValue({ id: 5 });

    await service.remove(5);

    expect(prisma.plan_ai_entitlements.deleteMany).toHaveBeenCalledWith({ where: { plan_id: 5 } });
    expect(prisma.plan_ai_entitlements.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.subscription_plans.delete.mock.invocationCallOrder[0],
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
