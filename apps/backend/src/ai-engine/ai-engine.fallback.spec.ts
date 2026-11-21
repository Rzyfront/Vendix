import { AIEngineService } from './ai-engine.service';
import type { AIStreamChunk } from './interfaces/ai-provider.interface';

/**
 * Vex Plus F3 T24: `ai_engine_applications.fallback_config_id`. One retry on
 * the backup config when the primary fails before anything was emitted, and
 * the real cost of the config that served on the `done` frame.
 */
describe('AIEngineService fallback model + real cost (T24)', () => {
  const PRICING = { pricing: { input_per_1k: 1, output_per_1k: 2 } };
  const USAGE = {
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
  };
  const appRow = (fallback: number | null) => ({
    key: 'vex_chat',
    is_active: true,
    config_id: 5,
    fallback_config_id: fallback,
    model_type: 'text',
    system_prompt: 'sys',
    prompt_template: null,
    ai_feature_category: null,
    temperature: null,
    max_tokens: 1000,
    retry_config: null,
  });

  const build = (fallback: number | null) => {
    const logging = {
      calculateCost: jest.fn().mockReturnValue(0.123),
      logRequest: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      ai_engine_applications: {
        findUnique: jest.fn().mockResolvedValue(appRow(fallback)),
      },
    };
    const service = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
      logging as any,
      { emit: jest.fn() } as any,
      { canUseAIFeature: jest.fn() } as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'consumeSubscriptionQuota')
      .mockResolvedValue(undefined);
    (service as any).configSettings.set(5, PRICING);
    (service as any).configSettings.set(9, PRICING);
    return { service, logging };
  };

  const collect = async (service: AIEngineService) => {
    const chunks: AIStreamChunk[] = [];
    for await (const c of service.runStream('vex_chat')) chunks.push(c);
    return chunks;
  };

  it('(a) primary throws -> fallback used once and succeeds', async () => {
    const { service } = build(9);
    const primary = jest.fn().mockRejectedValue(new Error('upstream down'));
    const backup = jest
      .fn()
      .mockResolvedValue({ success: true, content: 'ok', usage: USAGE });
    (service as any).providers.set(5, { chat: primary });
    (service as any).providers.set(9, { chat: backup });

    const res = await service.run('vex_chat');

    expect(res.success).toBe(true);
    expect(res.content).toBe('ok');
    expect(primary).toHaveBeenCalledTimes(1);
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it('(a2) stream: primary fails before output -> fallback serves', async () => {
    const { service, logging } = build(9);
    const primary = jest.fn(async function* () {
      yield { type: 'error', error: 'boom' } as AIStreamChunk;
    });
    const backup = jest.fn(async function* () {
      yield { type: 'text', content: 'hi' } as AIStreamChunk;
      yield { type: 'done', usage: USAGE } as AIStreamChunk;
    });
    (service as any).providers.set(5, { chat: jest.fn(), chatStream: primary });
    (service as any).providers.set(9, { chat: jest.fn(), chatStream: backup });

    const chunks = await collect(service);

    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(backup).toHaveBeenCalledTimes(1);
    const serving = logging.logRequest.mock.calls.map((c) => c[0]);
    expect(serving.some((l) => l.config_id === 5 && l.status === 'error')).toBe(
      true,
    );
    expect(
      serving.some((l) => l.config_id === 9 && l.status === 'success'),
    ).toBe(true);
  });

  it('(b) primary throws without fallback -> same error as today', async () => {
    const { service } = build(null);
    (service as any).providers.set(5, {
      chat: jest.fn().mockRejectedValue(new Error('upstream down')),
    });

    await expect(service.run('vex_chat')).rejects.toThrow('upstream down');
  });

  it('(b2) stream without fallback yields the provider error frame untouched', async () => {
    const { service } = build(null);
    (service as any).providers.set(5, {
      chat: jest.fn(),
      chatStream: async function* () {
        yield { type: 'error', error: 'boom' } as AIStreamChunk;
      },
    });

    expect(await collect(service)).toEqual([{ type: 'error', error: 'boom' }]);
  });

  it('(c) partial text then failure -> no retry', async () => {
    const { service } = build(9);
    const backup = jest.fn(async function* () {
      yield { type: 'done', usage: USAGE } as AIStreamChunk;
    });
    (service as any).providers.set(5, {
      chat: jest.fn(),
      chatStream: async function* () {
        yield { type: 'text', content: 'par' } as AIStreamChunk;
        yield { type: 'error', error: 'cut' } as AIStreamChunk;
      },
    });
    (service as any).providers.set(9, { chat: jest.fn(), chatStream: backup });

    const chunks = await collect(service);

    expect(chunks.map((c) => c.type)).toEqual(['text', 'error']);
    expect(backup).not.toHaveBeenCalled();
  });

  it('(d) cost_usd on done is the serving config cost; absent when unknown', async () => {
    const { service, logging } = build(9);
    (service as any).providers.set(5, {
      chat: jest.fn(),
      chatStream: async function* () {
        yield { type: 'text', content: 'x' } as AIStreamChunk;
        yield { type: 'done', usage: USAGE } as AIStreamChunk;
      },
    });

    const done = (await collect(service)).find((c) => c.type === 'done');

    expect(done?.cost_usd).toBe(0.123);
    expect(logging.calculateCost).toHaveBeenCalledWith(
      PRICING,
      1000,
      500,
      0,
      0,
    );

    (service as any).configSettings.delete(5);
    const unknown = (await collect(service)).find((c) => c.type === 'done');
    expect(unknown).not.toHaveProperty('cost_usd');
  });

  it('(e) agentic fallback re-fits the budget and maxTokens to ITS window', async () => {
    const { service } = build(9);
    (service as any).configSettings.set(5, {
      ...PRICING,
      context_window_tokens: 128000,
      maxTokens: 4096,
    });
    (service as any).configSettings.set(9, {
      ...PRICING,
      context_window_tokens: 16000,
      maxTokens: 1500,
    });
    (service as any).prisma.ai_engine_applications.findUnique.mockResolvedValue(
      { ...appRow(9), max_tokens: null },
    );
    const sentMaxTokens: Array<number | undefined> = [];
    const primary = jest.fn(async function* (_m: unknown, options: any) {
      sentMaxTokens.push(options.maxTokens);
      yield { type: 'error', error: 'upstream 503' } as AIStreamChunk;
    });
    const backup = jest.fn(async function* (_m: unknown, options: any) {
      sentMaxTokens.push(options.maxTokens);
      yield { type: 'text', content: 'ok' } as AIStreamChunk;
      yield {
        type: 'done',
        usage: USAGE,
        finish_reason: 'stop',
      } as AIStreamChunk;
    });
    const metered = () => true;
    (service as any).providers.set(5, {
      chat: jest.fn(),
      chatStream: primary,
      supportsMeteredAgentStream: metered,
    });
    (service as any).providers.set(9, {
      chat: jest.fn(),
      chatStream: backup,
      supportsMeteredAgentStream: metered,
    });

    const chunks: AIStreamChunk[] = [];
    for await (const c of service.runAgentStream('vex_chat', undefined, [
      { role: 'user', content: 'hola' },
    ]))
      chunks.push(c);

    expect(backup).toHaveBeenCalledTimes(1);
    expect(sentMaxTokens).toEqual([4096, 1500]);
    const done = chunks.find((c) => c.type === 'done');
    expect(done?.context_budget?.context_window_tokens).toBe(16000);
    expect(done?.context_budget?.provenance).toBe('configured');
  });
});
