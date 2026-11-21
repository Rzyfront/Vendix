import { InternalServerErrorException } from '@nestjs/common';
import {
  AIEntitlement,
  legacyFlagsToAIEntitlements,
} from '../types/ai-capabilities';
import {
  AgentQuotaService,
  VOICE_QUOTA_EXHAUSTED_MESSAGE,
  voiceNotInPlanMessage,
} from './agent-quota.service';

/**
 * T14 — cupos por agente. La voz de lectura es una fila por agente: apagar la
 * de Vexi no apaga la de Vex, el cupo se mide en milisegundos de audio
 * generado y el uso por agente alimenta las barras de la tienda (N7).
 */
describe('AgentQuotaService (T14)', () => {
  const STORE = 42;
  const month = () => {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const day = () => {
    const now = new Date();
    return `${month()}${String(now.getUTCDate()).padStart(2, '0')}`;
  };

  /** Legacy JSON of a plan with voice and both agents switched on. */
  const legacyFeatures = (voiceEnabled = true) => ({
    vex_agent: {
      enabled: true,
      daily_messages_cap: 200,
      monthly_tokens_cap: 5_000_000,
    },
    streaming_chat: { enabled: true, daily_messages_cap: 300 },
    realtime_voice: {
      enabled: voiceEnabled,
      monthly_voice_seconds_cap: 3600,
      degradation: 'block',
    },
  });

  const rowsWith = (
    patch: Record<string, Partial<AIEntitlement>>,
    base = legacyFeatures(),
  ): AIEntitlement[] =>
    legacyFlagsToAIEntitlements(base).map((row) => ({
      ...row,
      ...(patch[`${row.agent_key}.${row.capability_key}`] ?? {}),
    }));

  let redisStore: Record<string, string>;
  let redis: { get: jest.Mock; eval: jest.Mock };
  let resolver: { resolveSubscription: jest.Mock };
  let entitlements: { resolveForStore: jest.Mock };
  let service: AgentQuotaService;
  let previousMode: string | undefined;

  beforeEach(() => {
    previousMode = process.env.AI_ENTITLEMENTS_MODE;
    delete process.env.AI_ENTITLEMENTS_MODE;
    redisStore = {};
    redis = {
      get: jest.fn(async (key: string) => redisStore[key] ?? null),
      eval: jest.fn().mockResolvedValue(1),
    };
    resolver = {
      resolveSubscription: jest.fn().mockResolvedValue({
        found: true,
        features: legacyFeatures(),
      }),
    };
    entitlements = {
      resolveForStore: jest.fn().mockResolvedValue({
        found: true,
        rows: rowsWith({}),
      }),
    };
    service = new AgentQuotaService(
      resolver as never,
      redis as never,
      entitlements as never,
    );
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.AI_ENTITLEMENTS_MODE;
    else process.env.AI_ENTITLEMENTS_MODE = previousMode;
  });

  describe('checkAgentVoice', () => {
    it('apagar la voz de Vexi en el plan no apaga la de Vex', async () => {
      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        rows: rowsWith({ 'vexi.voice_readout': { enabled: false } }),
      });

      await expect(service.checkAgentVoice(STORE, 'vexi')).resolves.toEqual(
        expect.objectContaining({ status: 'disabled' }),
      );
      await expect(service.checkAgentVoice(STORE, 'vex')).resolves.toEqual(
        expect.objectContaining({ status: 'ok', cap: 3600, used: 0 }),
      );
    });

    it('en modo sombra la clave legada solo puede restringir: sin realtime_voice no hay voz', async () => {
      resolver.resolveSubscription.mockResolvedValue({
        found: true,
        features: legacyFeatures(false),
      });
      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        rows: rowsWith({ 'vex.voice_readout': { enabled: true } }),
      });

      await expect(service.checkAgentVoice(STORE, 'vex')).resolves.toEqual(
        expect.objectContaining({ status: 'disabled' }),
      );
    });

    it('en modo enforce decide solo el modelo nuevo', async () => {
      process.env.AI_ENTITLEMENTS_MODE = 'enforce';
      resolver.resolveSubscription.mockResolvedValue({
        found: true,
        features: legacyFeatures(false),
      });
      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        rows: rowsWith({
          'vex.voice_readout': { enabled: true, cap_value: 120 },
        }),
      });

      await expect(service.checkAgentVoice(STORE, 'vex')).resolves.toEqual(
        expect.objectContaining({ status: 'ok', cap: 120 }),
      );
    });

    it('el cupo por agente se agota con los segundos generados de ESE agente', async () => {
      redisStore[`ai:quota:${STORE}:agent:vexi:voice_ms:${month()}`] =
        '3600000';
      redisStore[`ai:quota:${STORE}:agent:vex:voice_ms:${month()}`] = '3599999';

      await expect(service.checkAgentVoice(STORE, 'vexi')).resolves.toEqual({
        status: 'exhausted',
        cap: 3600,
        used: 3600,
      });
      await expect(service.checkAgentVoice(STORE, 'vex')).resolves.toEqual({
        status: 'ok',
        cap: 3600,
        used: 3599,
      });
    });

    it('cap NULL es sin límite', async () => {
      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        rows: rowsWith({ 'vex.voice_readout': { cap_value: null } }),
      });
      redisStore[`ai:quota:${STORE}:agent:vex:voice_ms:${month()}`] =
        '999999999';

      await expect(service.checkAgentVoice(STORE, 'vex')).resolves.toEqual(
        expect.objectContaining({ status: 'ok', cap: null }),
      );
    });

    it('sin suscripción no hay voz', async () => {
      resolver.resolveSubscription.mockResolvedValue({
        found: false,
        features: {},
      });

      await expect(service.checkAgentVoice(STORE, 'vex')).resolves.toEqual(
        expect.objectContaining({ status: 'disabled' }),
      );
    });

    it('un fallo interno no inventa un aviso de plan: devuelve unavailable', async () => {
      resolver.resolveSubscription.mockRejectedValue(new Error('db down'));

      await expect(service.checkAgentVoice(STORE, 'vex')).resolves.toEqual(
        expect.objectContaining({ status: 'unavailable' }),
      );
    });
  });

  describe('consumeAgentVoice', () => {
    it('suma milisegundos al contador del agente con dedup por requestId', async () => {
      await service.consumeAgentVoice(STORE, 'vex', 2612, 'req-1:tts:3');

      expect(redis.eval).toHaveBeenCalledTimes(1);
      const [, numKeys, key, dedup, requestId, units, ttl] =
        redis.eval.mock.calls[0];
      expect(numKeys).toBe(2);
      expect(key).toBe(`ai:quota:${STORE}:agent:vex:voice_ms:${month()}`);
      expect(dedup).toBe(
        `ai:quota:dedup:${STORE}:agent:vex:voice_ms:${month()}`,
      );
      expect(requestId).toBe('req-1:tts:3');
      expect(units).toBe(2612);
      expect(ttl).toBeGreaterThan(30 * 24 * 3600);
    });

    it('no escribe nada con 0 ms', async () => {
      await service.consumeAgentVoice(STORE, 'vexi', 0, 'req-1:tts:0');
      expect(redis.eval).not.toHaveBeenCalled();
    });

    it('exige requestId para el dedup', async () => {
      await expect(
        service.consumeAgentVoice(STORE, 'vex', 10, ''),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('un fallo de Redis no rompe el turno', async () => {
      redis.eval.mockRejectedValue(new Error('redis down'));
      await expect(
        service.consumeAgentVoice(STORE, 'vex', 10, 'r'),
      ).resolves.toBeUndefined();
    });
  });

  describe('consumeAgentTokens', () => {
    it('cuenta los tokens de Vexi en su propio contador mensual', async () => {
      await service.consumeAgentTokens(STORE, 'vexi', 1234, 'req-9:vexi-tokens');

      const [, , key, , requestId, units] = redis.eval.mock.calls[0];
      expect(key).toBe(`ai:quota:${STORE}:agent:vexi:tokens:${month()}`);
      expect(requestId).toBe('req-9:vexi-tokens');
      expect(units).toBe(1234);
    });
  });

  describe('resolveEffectiveEntitlements (T19)', () => {
    const agentRow = (rows: AIEntitlement[], agent: string) =>
      rows.find((r) => r.agent_key === agent && r.capability_key === 'agent');

    it('sombra: decide el JSON legado aunque la tabla diga otra cosa', async () => {
      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        planId: 1,
        rows: rowsWith({ 'vex.agent': { enabled: false } }),
      });

      const effective = await service.resolveEffectiveEntitlements(STORE);

      expect(effective.found).toBe(true);
      expect(effective.hasPlan).toBe(true);
      expect(agentRow(effective.rows, 'vex')?.enabled).toBe(true);
    });

    it('sombra: sin fila en la tabla sigue habiendo plan (manda el legado)', async () => {
      entitlements.resolveForStore.mockResolvedValue({
        found: false,
        planId: null,
        rows: [],
      });

      const effective = await service.resolveEffectiveEntitlements(STORE);

      expect(effective.hasPlan).toBe(true);
      expect(agentRow(effective.rows, 'vex')?.enabled).toBe(true);
    });

    it('enforce: decide la tabla y sin plan efectivo no hay plan', async () => {
      process.env.AI_ENTITLEMENTS_MODE = 'enforce';
      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        planId: 1,
        rows: rowsWith({ 'vex.agent': { enabled: false } }),
      });
      const withPlan = await service.resolveEffectiveEntitlements(STORE);
      expect(withPlan.hasPlan).toBe(true);
      expect(agentRow(withPlan.rows, 'vex')?.enabled).toBe(false);

      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        planId: null,
        rows: [],
      });
      expect((await service.resolveEffectiveEntitlements(STORE)).hasPlan).toBe(
        false,
      );
    });

    it('enforce: si la tabla no se puede leer, falla cerrado', async () => {
      process.env.AI_ENTITLEMENTS_MODE = 'enforce';
      entitlements.resolveForStore.mockRejectedValue(new Error('db down'));

      const effective = await service.resolveEffectiveEntitlements(STORE);

      expect(effective).toEqual({ found: true, hasPlan: false, rows: [] });
    });

    it('sin suscripción: found false y sin filas', async () => {
      resolver.resolveSubscription.mockResolvedValue({ found: false });

      await expect(service.resolveEffectiveEntitlements(STORE)).resolves.toEqual(
        { found: false, hasPlan: false, rows: [] },
      );
      expect(entitlements.resolveForStore).not.toHaveBeenCalled();
    });
  });

  describe('getAgentUsage', () => {
    it('devuelve mensajes, tokens y voz por agente con el contador de cada uno', async () => {
      // En modo sombra los cupos salen del JSON legado (lo que decide el gate);
      // los tokens de Vexi vienen de `text_generation.monthly_tokens_cap`.
      resolver.resolveSubscription.mockResolvedValue({
        found: true,
        features: {
          ...legacyFeatures(),
          text_generation: { enabled: true, monthly_tokens_cap: 1_000_000 },
        },
      });
      entitlements.resolveForStore.mockResolvedValue({
        found: true,
        rows: rowsWith({ 'vexi.voice_readout': { enabled: false } }),
      });
      redisStore[`ai:quota:${STORE}:vex_agent:daily_messages:${day()}`] = '12';
      redisStore[`ai:quota:${STORE}:vex_agent:monthly_tokens:${month()}`] =
        '40000';
      redisStore[`ai:quota:${STORE}:agent:vex:voice_ms:${month()}`] = '61500';
      redisStore[`ai:quota:${STORE}:streaming_chat:${day()}`] = '7';
      redisStore[`ai:quota:${STORE}:agent:vexi:tokens:${month()}`] = '900';

      const usage = await service.getAgentUsage(STORE);

      expect(usage?.vex.enabled).toBe(true);
      expect(usage?.vex.meters).toEqual([
        {
          capability_key: 'vex.agent',
          kind: 'messages',
          label: 'Mensajes',
          unit: 'messages',
          period: 'daily',
          used: 12,
          cap: 200,
          enabled: true,
        },
        {
          capability_key: 'vex.model_tokens',
          kind: 'tokens',
          label: 'Tokens del modelo',
          unit: 'tokens',
          period: 'monthly',
          used: 40000,
          cap: 5_000_000,
          enabled: true,
        },
        {
          capability_key: 'vex.voice_readout',
          kind: 'voice_seconds',
          label: 'Lectura en voz',
          unit: 'seconds',
          period: 'monthly',
          used: 61,
          cap: 3600,
          enabled: true,
        },
      ]);
      expect(usage?.vexi.meters.map((m) => [m.kind, m.used, m.cap, m.enabled]))
        .toEqual([
          ['messages', 7, 300, true],
          ['tokens', 900, 1_000_000, true],
          ['voice_seconds', 0, 3600, false],
        ]);
    });

    it('sin suscripción no hay uso que mostrar', async () => {
      resolver.resolveSubscription.mockResolvedValue({
        found: false,
        features: {},
      });
      await expect(service.getAgentUsage(STORE)).resolves.toBeNull();
    });
  });

  it('expone los textos exactos del aviso de voz', () => {
    expect(VOICE_QUOTA_EXHAUSTED_MESSAGE).toBe(
      'Se acabó la lectura en voz de este mes',
    );
    expect(voiceNotInPlanMessage('vexi')).toBe(
      'Tu plan no incluye la lectura en voz de Vexi.',
    );
  });
});
