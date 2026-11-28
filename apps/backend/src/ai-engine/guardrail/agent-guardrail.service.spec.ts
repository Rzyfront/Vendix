import {
  AGENT_GUARDRAIL_APP_KEY,
  AGENT_GUARDRAIL_DEFAULTS,
  AGENT_GUARDRAIL_RESPONDER_APP_KEY,
  AGENT_GUARDRAIL_SCOPES,
  AGENT_GUARDRAIL_TEMPLATES,
  AgentGuardrailService,
  GuardrailInput,
} from './agent-guardrail.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { redactTraceAttributes } from '../observability/agent-trace.service';
import {
  AGENT_GUARDRAIL_APPLICATION,
  AGENT_GUARDRAIL_DEFAULT_SCOPES,
  AGENT_GUARDRAIL_DEFAULT_TEMPLATES,
  AGENT_GUARDRAIL_RESPONDER_APPLICATION,
  AGENT_SETTINGS_ONLY_APP_KEYS,
  VEX_CLASSIFIER_APPLICATION,
} from '../../../prisma/seeds/agent-guardrail.application';

const SECRET_TEXT = 'escríbeme un poema sobre el mar';

function config() {
  return { id: 7, is_active: true, model_id: 'google/gemini-2.5-flash-lite' };
}

function classifierRow(overrides: Record<string, unknown> = {}) {
  return {
    key: AGENT_GUARDRAIL_APP_KEY,
    is_active: true,
    system_prompt: null,
    retry_config: { maxRetries: 0, timeout_ms: 200 },
    metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata },
    config: config(),
    ...overrides,
  };
}

function responderRow(overrides: Record<string, unknown> = {}) {
  return {
    key: AGENT_GUARDRAIL_RESPONDER_APP_KEY,
    is_active: true,
    system_prompt: null,
    retry_config: { timeout_ms: 200 },
    metadata: { ...AGENT_GUARDRAIL_RESPONDER_APPLICATION.metadata },
    config: config(),
    ...overrides,
  };
}

/** In-memory subset of ioredis used by the service. */
function fakeRedis() {
  const store = new Map<string, string>();
  const ops: string[] = [];
  const redis: any = {
    store,
    ops,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => {
      ops.push(`del ${k}`);
      return store.delete(k) ? 1 : 0;
    }),
    multi: jest.fn(() => {
      const queued: Array<() => unknown> = [];
      const chain: any = {
        incr: (k: string) => {
          queued.push(() => {
            const next = Number(store.get(k) ?? 0) + 1;
            store.set(k, String(next));
            return next;
          });
          return chain;
        },
        expire: (k: string, ttl: number) => {
          queued.push(() => ops.push(`expire ${k} ${ttl}`));
          return chain;
        },
        set: (k: string, v: string, _ex: string, ttl: number) => {
          queued.push(() => {
            store.set(k, v);
            ops.push(`set ${k} ${ttl}`);
            return 'OK';
          });
          return chain;
        },
        del: (k: string) => {
          queued.push(() => store.delete(k));
          return chain;
        },
        exec: async () => queued.map((fn) => [null, fn()]),
      };
      return chain;
    }),
  };
  return redis;
}

function answer(content: string, tokens = 30, cost = 0.00001) {
  return {
    success: true,
    content,
    model: 'google/gemini-2.5-flash-lite',
    cost_usd: cost,
    usage: { promptTokens: tokens - 5, completionTokens: 5, totalTokens: tokens },
  };
}

function build(rows: unknown[], run: jest.Mock, redis = fakeRedis()) {
  const prisma = {
    ai_engine_applications: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const trace = {
    startTrace: jest.fn(() => ({ trace_id: 't', span_id: 'r', kind: 'root' })),
    startSpan: jest.fn(() => ({ trace_id: 't', span_id: 's', kind: 'guardrail' })),
    run: jest.fn((_h: unknown, fn: () => unknown) => fn()),
    endSpan: jest.fn(),
    finishTrace: jest.fn(),
  };
  const quota = { consumeAgentTokens: jest.fn().mockResolvedValue(undefined) };
  const service = new AgentGuardrailService(
    prisma as any,
    { run } as any,
    redis,
    trace as any,
    quota as any,
  );
  return { service, prisma, trace, quota, redis, run };
}

function input(overrides: Partial<GuardrailInput> = {}): GuardrailInput {
  return {
    agent: 'vex',
    subject: 's5:u9',
    message: SECRET_TEXT,
    history: [],
    surface: 'text',
    quotaAgent: 'vex',
    conversationId: 11,
    tokensSavedEstimate: 4000,
    ...overrides,
  };
}

function inStore<T>(fn: () => Promise<T>): Promise<T> {
  return RequestContextService.asyncLocalStorage.run(
    {
      store_id: 5,
      organization_id: 2,
      user_id: 9,
      request_id: 'req-1',
      is_super_admin: false,
      is_owner: true,
      roles: [],
      permissions: [],
    } as any,
    fn,
  );
}

describe('AgentGuardrailService', () => {
  describe('fail-open (S6, S7)', () => {
    it('passes without calling any model when the row does not exist', async () => {
      const { service, run } = build([], jest.fn());
      await expect(service.check(input())).resolves.toEqual({
        action: 'pass',
        verdict: 'unavailable',
        reason: 'not_configured',
      });
      expect(run).not.toHaveBeenCalled();
    });

    it('passes when the row is inactive (seeded state)', async () => {
      const { service, run } = build(
        [classifierRow({ is_active: false })],
        jest.fn(),
      );
      await expect(service.check(input())).resolves.toMatchObject({
        action: 'pass',
        reason: 'inactive',
      });
      expect(run).not.toHaveBeenCalled();
    });

    it('never falls back to the default config: no config_id is off', async () => {
      const { service, run } = build([classifierRow({ config: null })], jest.fn());
      await expect(service.check(input())).resolves.toMatchObject({
        action: 'pass',
        reason: 'not_configured',
      });
      expect(run).not.toHaveBeenCalled();
    });

    it('passes when the agent is switched off in metadata', async () => {
      const meta = {
        ...AGENT_GUARDRAIL_APPLICATION.metadata,
        agents: { vex: { enabled: false }, vexi: { enabled: true } },
      };
      const { service, run } = build([classifierRow({ metadata: meta })], jest.fn());
      await expect(service.check(input())).resolves.toMatchObject({
        reason: 'agent_disabled',
      });
      expect(run).not.toHaveBeenCalled();
    });

    it('passes on timeout and never waits past timeout_ms', async () => {
      const run = jest.fn(() => new Promise(() => undefined));
      const { service } = build([classifierRow()], run);
      const started = Date.now();
      await expect(inStore(() => service.check(input()))).resolves.toMatchObject({
        action: 'pass',
        reason: 'timeout',
      });
      expect(Date.now() - started).toBeLessThan(1000);
      const options = (run.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
      expect(options.signal).toBeDefined();
      expect(typeof options.deadlineMs).toBe('number');
    });

    it('passes when the engine throws or fails', async () => {
      const throwing = build([classifierRow()], jest.fn().mockRejectedValue(new Error('429')));
      await expect(throwing.service.check(input())).resolves.toMatchObject({
        action: 'pass',
        reason: 'provider_error',
      });
      const failing = build(
        [classifierRow()],
        jest.fn().mockResolvedValue({ success: false, error: 'x' }),
      );
      await expect(failing.service.check(input())).resolves.toMatchObject({
        action: 'pass',
        reason: 'provider_error',
      });
    });

    it('passes on an invalid answer', async () => {
      const { service } = build(
        [classifierRow()],
        jest.fn().mockResolvedValue(answer('Esto está fuera de tema')),
      );
      await expect(service.check(input())).resolves.toMatchObject({
        action: 'pass',
        reason: 'invalid_response',
      });
    });

    it('passes unclear and low-confidence verdicts', async () => {
      const unclear = build(
        [classifierRow()],
        jest.fn().mockResolvedValue(answer('{"verdict":"unclear","confidence":0.9}')),
      );
      await expect(unclear.service.check(input())).resolves.toEqual({
        action: 'pass',
        verdict: 'unclear',
      });
      const low = build(
        [classifierRow()],
        jest.fn().mockResolvedValue(answer('{"verdict":"off_topic","confidence":0.4}')),
      );
      await expect(low.service.check(input())).resolves.toMatchObject({
        action: 'pass',
        verdict: 'off_topic',
        reason: 'low_confidence',
      });
    });

    it('passes when Redis fails while recording the streak', async () => {
      const redis = fakeRedis();
      redis.multi = jest.fn(() => {
        throw new Error('redis down');
      });
      redis.get = jest.fn().mockRejectedValue(new Error('redis down'));
      const { service } = build(
        [classifierRow()],
        jest
          .fn()
          .mockResolvedValue(answer('{"verdict":"off_topic","confidence":0.95}')),
        redis,
      );
      // The verdict itself succeeded: the redirect still answers.
      await expect(service.check(input())).resolves.toMatchObject({
        action: 'redirect',
        strikes: 0,
      });
    });
  });

  describe('classification (S3)', () => {
    it('in_scope passes and resets the streak', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('```json\n{"verdict":"in_scope","confidence":0.99}\n```'));
      const { service, redis } = build([classifierRow()], run);
      redis.store.set(AgentGuardrailService.strikesKey('vex', 's5:u9'), '2');
      await expect(service.check(input({ message: 'dale' }))).resolves.toEqual({
        action: 'pass',
        verdict: 'in_scope',
      });
      expect(redis.store.has(AgentGuardrailService.strikesKey('vex', 's5:u9'))).toBe(false);
    });

    it('sends only the last context_messages turns plus the scope of the agent', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"in_scope","confidence":0.9}'));
      const { service } = build([classifierRow()], run);
      const history = Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `turno-${i}`,
      }));
      await service.check(input({ agent: 'vexi', message: 'el rojo', history }));
      const [appKey, variables, messages] = run.mock.calls[0] as [
        string,
        Record<string, string>,
        Array<{ role: string; content: string }>,
      ];
      expect(appKey).toBe(AGENT_GUARDRAIL_APP_KEY);
      expect(variables.agent_scope).toBe(AGENT_GUARDRAIL_SCOPES.vexi);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain(AGENT_GUARDRAIL_SCOPES.vexi);
      const user = messages[1].content;
      expect(user).toContain('el rojo');
      expect(user).not.toContain('turno-3');
      for (const i of [4, 5, 6, 7]) expect(user).toContain(`turno-${i}`);
    });

    it('a custom system_prompt on the row replaces the built-in one', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"in_scope","confidence":0.9}'));
      const { service } = build(
        [classifierRow({ system_prompt: 'Prompt propio {{agent_scope}}' })],
        run,
      );
      await service.check(input());
      const messages = (run.mock.calls[0] as unknown[])[2] as Array<{ role: string }>;
      expect(messages.map((m) => m.role)).toEqual(['user']);
    });
  });

  describe('reply to the offender (S4)', () => {
    it('off_topic answers with the responder model, which never sees the text', async () => {
      const run = jest
        .fn()
        .mockResolvedValueOnce(answer('{"verdict":"off_topic","confidence":0.92}', 40, 0.00002))
        .mockResolvedValueOnce(
          answer('Eso no es lo mío, pero te ayudo con tus ventas. ¿Qué miramos?', 60, 0.00003),
        );
      const { service, quota } = build([classifierRow(), responderRow()], run);
      const decision = await inStore(() => service.check(input()));
      expect(decision).toMatchObject({
        action: 'redirect',
        verdict: 'off_topic',
        reply: 'Eso no es lo mío, pero te ayudo con tus ventas. ¿Qué miramos?',
        reply_source: 'model',
        strikes: 1,
        rate_penalty: 1,
        tokens: 100,
      });
      expect((decision as { cost_usd: number }).cost_usd).toBeCloseTo(0.00005);
      const [appKey, , messages] = run.mock.calls[1] as [
        string,
        unknown,
        Array<{ content: string }>,
      ];
      expect(appKey).toBe(AGENT_GUARDRAIL_RESPONDER_APP_KEY);
      expect(JSON.stringify(messages)).not.toContain(SECRET_TEXT);
      // Charged to the agent's monthly counter, like the rest of the turn.
      expect(quota.consumeAgentTokens).toHaveBeenCalledWith(
        5,
        'vex',
        100,
        expect.any(String),
      );
    });

    it('abuse without responder uses the agent template', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"abuse","confidence":0.97}'));
      const { service } = build(
        [classifierRow(), responderRow({ is_active: false })],
        run,
      );
      await expect(service.check(input({ agent: 'vexi' }))).resolves.toMatchObject({
        action: 'redirect',
        verdict: 'abuse',
        reply: AGENT_GUARDRAIL_TEMPLATES.vexi.abuse,
        reply_source: 'template',
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('a responder answer longer than max_chars falls back to the template', async () => {
      const run = jest
        .fn()
        .mockResolvedValueOnce(answer('{"verdict":"off_topic","confidence":0.9}'))
        .mockResolvedValueOnce(answer('x'.repeat(500)));
      const { service } = build([classifierRow(), responderRow()], run);
      await expect(service.check(input())).resolves.toMatchObject({
        reply: AGENT_GUARDRAIL_TEMPLATES.vex.off_topic,
        reply_source: 'template',
      });
    });
  });

  describe('escalation (S5)', () => {
    it('the Nth consecutive infraction starts the cooldown; during it no model is called', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"off_topic","confidence":0.9}'));
      const { service, redis } = build([classifierRow()], run);
      const first = await service.check(input());
      const second = await service.check(input());
      const third = await service.check(input());
      expect(first).toMatchObject({ action: 'redirect', strikes: 1 });
      expect(second).toMatchObject({ action: 'redirect', strikes: 2 });
      // The notice says how long the pause lasts (2 min by default).
      expect(third).toMatchObject({
        action: 'cooldown',
        strikes: 3,
        reply: AGENT_GUARDRAIL_TEMPLATES.vex.cooldown.replace(
          '{{minutes}}',
          '2 minutos',
        ),
      });
      expect(third.action !== 'pass' && third.reply).toContain(
        'vuelvo a estar disponible en 2 minutos',
      );
      // The key holds `<start>:<length>` and lives exactly that length.
      const key = AgentGuardrailService.cooldownKey('vex', 's5:u9');
      expect(redis.ops).toContain(`set ${key} 120`);
      expect(redis.store.get(key)).toMatch(/^\d+:120$/);
      run.mockClear();
      await expect(
        service.check(input({ message: '¿cuánto vendí hoy?' })),
      ).resolves.toMatchObject({
        action: 'cooldown',
        verdict: 'cooldown',
        rate_penalty: 0,
        tokens: 0,
      });
      expect(run).not.toHaveBeenCalled();
    });

    it('the notice shows the time actually left of the pause', async () => {
      const run = jest.fn();
      const { service, redis } = build([classifierRow()], run);
      // Paused 61 s ago with a 2-minute pause: 59 s left → «1 minuto».
      redis.store.set(
        AgentGuardrailService.cooldownKey('vex', 's5:u9'),
        `${Date.now() - 61_000}:120`,
      );
      const decision = await service.check(input());
      expect(decision).toMatchObject({ action: 'cooldown' });
      expect(decision.action !== 'pass' && decision.reply).toContain(
        'disponible en 1 minuto.',
      );
      expect(run).not.toHaveBeenCalled();
    });

    it('super admin lifts or shortens running pauses from the panel (current cooldown_seconds)', async () => {
      const key = AgentGuardrailService.cooldownKey('vex', 's5:u9');
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"in_scope","confidence":0.9}'));
      // 0 = no pause: a running one is lifted at once.
      const lifted = build(
        [classifierRow({ metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata, cooldown_seconds: 0 } })],
        run,
      );
      lifted.redis.store.set(key, `${Date.now()}:120`);
      await expect(lifted.service.check(input())).resolves.toMatchObject({
        action: 'pass',
        verdict: 'in_scope',
      });
      // Shortened to 1 min: a pause started 90 s ago is already over.
      const shorter = build(
        [classifierRow({ metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata, cooldown_seconds: 60 } })],
        run,
      );
      shorter.redis.store.set(key, `${Date.now() - 90_000}:120`);
      await expect(shorter.service.check(input())).resolves.toMatchObject({
        action: 'pass',
      });
      // Shortened to 1 min: a pause started 30 s ago keeps its 30 s left.
      const running = build(
        [classifierRow({ metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata, cooldown_seconds: 60 } })],
        run,
      );
      running.redis.store.set(key, `${Date.now() - 30_000}:120`);
      const still = await running.service.check(input());
      expect(still).toMatchObject({ action: 'cooldown' });
      expect(still.action !== 'pass' && still.reply).toContain('1 minuto.');
    });

    it('raising cooldown_seconds neither revives finished pauses nor lengthens running ones (N1)', async () => {
      const key = AgentGuardrailService.cooldownKey('vex', 's5:u9');
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"in_scope","confidence":0.9}'));
      const raised = () =>
        build(
          [classifierRow({ metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata, cooldown_seconds: 600 } })],
          run,
        );
      // A 2-min pause that ended 3 min ago stays over after raising to 10 min.
      const finished = raised();
      finished.redis.store.set(key, `${Date.now() - 300_000}:120`);
      await expect(finished.service.check(input())).resolves.toMatchObject({
        action: 'pass',
        verdict: 'in_scope',
      });
      // A 2-min pause started 61 s ago still ends at its original time
      // (59 s left → «1 minuto»), not 9 min later.
      const running = raised();
      running.redis.store.set(key, `${Date.now() - 61_000}:120`);
      const decision = await running.service.check(input());
      expect(decision).toMatchObject({ action: 'cooldown' });
      expect(decision.action !== 'pass' && decision.reply).toContain(
        'disponible en 1 minuto.',
      );
    });

    it('legacy keys (start time only) use the current length capped at the default pause', async () => {
      const key = AgentGuardrailService.cooldownKey('vex', 's5:u9');
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"in_scope","confidence":0.9}'));
      const at = (seconds: number) =>
        build(
          [classifierRow({ metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata, cooldown_seconds: seconds } })],
          run,
        );
      // Raised to 10 min: a legacy pause from 5 min ago is not revived.
      const old = at(600);
      old.redis.store.set(key, String(Date.now() - 300_000));
      await expect(old.service.check(input())).resolves.toMatchObject({
        action: 'pass',
      });
      // Within the default 2 min it is still honoured.
      const recent = at(600);
      recent.redis.store.set(key, String(Date.now() - 30_000));
      await expect(recent.service.check(input())).resolves.toMatchObject({
        action: 'cooldown',
      });
      // Lowered to 1 min: the shorter current value wins.
      const lowered = at(60);
      lowered.redis.store.set(key, String(Date.now() - 90_000));
      await expect(lowered.service.check(input())).resolves.toMatchObject({
        action: 'pass',
      });
      // Garbage never pauses.
      const broken = at(600);
      broken.redis.store.set(key, 'nope:abc');
      await expect(broken.service.check(input())).resolves.toMatchObject({
        action: 'pass',
      });
    });

    it('streaks are per subject and expire with strike_ttl_seconds', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"off_topic","confidence":0.9}'));
      const { service, redis } = build([classifierRow()], run);
      await service.check(input({ subject: 'a' }));
      await expect(service.check(input({ subject: 'b' }))).resolves.toMatchObject({
        strikes: 1,
      });
      expect(redis.ops).toContain(
        `expire ${AgentGuardrailService.strikesKey('vex', 'a')} 3600`,
      );
    });
  });

  describe('settings out of range (M2)', () => {
    it('are clamped to the nearest bound, not replaced by the default', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"off_topic","confidence":0.95}'));
      // min_confidence 1.5 → 1 (default 0.6 would cut at 0.95);
      // strikes_before_cooldown 0 → 1 (default 3 would only redirect).
      const highBar = build(
        [classifierRow({ metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata, min_confidence: 1.5 } })],
        run,
      );
      await expect(highBar.service.check(input())).resolves.toMatchObject({
        action: 'pass',
        reason: 'low_confidence',
      });
      const firstStrike = build(
        [classifierRow({ metadata: { ...AGENT_GUARDRAIL_APPLICATION.metadata, strikes_before_cooldown: 0 } })],
        run,
      );
      await expect(firstStrike.service.check(input())).resolves.toMatchObject({
        action: 'cooldown',
        strikes: 1,
      });
    });
  });

  describe('trace (S8)', () => {
    it('records verdict, action, model, cost and tokens saved; never the text', async () => {
      const run = jest
        .fn()
        .mockResolvedValue(answer('{"verdict":"off_topic","confidence":0.9}'));
      const { service, trace } = build([classifierRow()], run);
      await inStore(() => service.check(input()));
      expect(trace.startTrace).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'tenant', store_id: 5, agent: 'vex' }),
      );
      expect(trace.startSpan).toHaveBeenCalledWith(
        'guardrail',
        expect.any(Object),
        expect.any(Object),
      );
      const end = trace.endSpan.mock.calls[0][1];
      expect(JSON.stringify(end)).not.toContain(SECRET_TEXT);
      expect(end.cost_usd).toBeCloseTo(0.00001);
      const kept = redactTraceAttributes(end.attributes);
      expect(kept).toMatchObject({
        guardrail_agent: 'vex',
        guardrail_verdict: 'off_topic',
        guardrail_action: 'redirect',
        guardrail_reply_source: 'template',
        guardrail_strikes: 1,
        classifier_model: 'google/gemini-2.5-flash-lite',
        main_skipped: true,
        tokens_saved_estimate: 4000,
        guardrail_tokens: 30,
      });
    });
  });

  describe('seed (S1)', () => {
    it('the seeded defaults are the ones the service applies', () => {
      const meta = AGENT_GUARDRAIL_APPLICATION.metadata;
      const d = AGENT_GUARDRAIL_DEFAULTS;
      expect(AGENT_GUARDRAIL_APPLICATION.retry_config.timeout_ms).toBe(d.timeout_ms);
      expect(meta.min_confidence).toBe(d.min_confidence);
      expect(meta.strikes_before_cooldown).toBe(d.strikes_before_cooldown);
      expect(meta.cooldown_seconds).toBe(d.cooldown_seconds);
      expect(meta.strike_ttl_seconds).toBe(d.strike_ttl_seconds);
      expect(meta.context_messages).toBe(d.context_messages);
      expect(meta.public_rate_penalty).toBe(d.public_rate_penalty);
      expect(AGENT_GUARDRAIL_RESPONDER_APPLICATION.metadata.max_chars).toBe(d.max_chars);
      expect(AGENT_GUARDRAIL_DEFAULT_SCOPES).toEqual(AGENT_GUARDRAIL_SCOPES);
      expect(AGENT_GUARDRAIL_DEFAULT_TEMPLATES).toEqual(AGENT_GUARDRAIL_TEMPLATES);
    });

    it('seeds the three rows inactive, without config and never auto-linked', () => {
      for (const app of [
        VEX_CLASSIFIER_APPLICATION,
        AGENT_GUARDRAIL_APPLICATION,
        AGENT_GUARDRAIL_RESPONDER_APPLICATION,
      ]) {
        expect(app.is_active).toBe(false);
        expect('config_id' in app).toBe(false);
        expect(AGENT_SETTINGS_ONLY_APP_KEYS.has(app.key)).toBe(true);
      }
      expect(VEX_CLASSIFIER_APPLICATION.description).toMatch(
        /^Clasificador de Vex: desempata respuestas ambiguas/,
      );
    });
  });
});
