import { AILoggingService } from './ai-logging.service';

describe('AILoggingService cache tokens (vexR3-C)', () => {
  const build = () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { ai_engine_logs: { create } };
    const service = new AILoggingService(prisma as any, {} as any);
    return { service, create };
  };

  it('logRequest persists cache_read_tokens and cache_creation_tokens', async () => {
    const { service, create } = build();
    await service.logRequest({
      app_key: 'vex_assistant',
      prompt_tokens: 10,
      completion_tokens: 5,
      cache_read_tokens: 900,
      cache_creation_tokens: 120,
      cost_usd: 0,
      latency_ms: 1,
      status: 'success',
    } as any);
    expect(create).toHaveBeenCalledWith({
      select: { id: true },
      data: expect.objectContaining({
        cache_read_tokens: 900,
        cache_creation_tokens: 120,
      }),
    });
  });

  it('logRequest defaults cache columns to 0 when absent', async () => {
    const { service, create } = build();
    await service.logRequest({
      app_key: 'x',
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 0,
      latency_ms: 1,
      status: 'success',
    } as any);
    expect(create.mock.calls[0][0].data).toMatchObject({
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
  });

  it('calculateCost adds cache rates only when configured', () => {
    const { service } = build();
    const base = { pricing: { input_per_1k: 1, output_per_1k: 2 } };
    expect(service.calculateCost(base, 1000, 1000, 1000, 1000)).toBe(3);
    const withCache = {
      pricing: {
        ...base.pricing,
        cache_read_per_1k: 0.1,
        cache_creation_per_1k: 1.25,
      },
    };
    expect(service.calculateCost(withCache, 1000, 1000, 1000, 1000)).toBe(4.35);
  });
});

describe('AILoggingService phase A correlation/privacy', () => {
  const UUID = '123e4567-e89b-42d3-a456-426614174000';
  const entry = {
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_usd: 0,
    latency_ms: 1,
    status: 'error' as const,
    input_preview:
      'Bearer secret-token; cliente@example.test; audio;base64,AAAA',
    error_message:
      'failed body secret-token confirmation_token=secret-confirmation',
  };
  const build = (enabled: boolean) => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AILoggingService(
      { ai_engine_logs: { create } } as any,
      {} as any,
      undefined,
      { get: jest.fn().mockReturnValue(enabled) } as any,
    );
    return { service, create };
  };

  it('persists a valid supplied request UUID instead of the database default', async () => {
    const { service, create } = build(false);
    await service.logRequest({ ...entry, request_id: UUID });
    expect(create.mock.calls[0][0].data.request_id).toBe(UUID);
  });

  it('normalizes arbitrary IDs deterministically and stores only a bounded hash', async () => {
    const { service, create } = build(true);
    const external = 'external:request:Bearer secret-token';
    await service.logRequest({ ...entry, request_id: external });
    await service.logRequest({ ...entry, request_id: external });
    const [first, second] = create.mock.calls.map(([arg]) => arg.data);
    expect(first.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.request_id).toBe(first.request_id);
    expect(first.external_request_id_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('secret-token');
  });

  it('tracing removes previews/errors and rejects arbitrary metadata/correlations', async () => {
    const { service, create } = build(true);
    await service.logRequest({
      ...entry,
      trace_id: 'Bearer secret-token',
      provider_call_id: 'not-uuid',
      conversation_id: 'private customer@example.test',
      telemetry_metadata: {
        body: 'secret-token',
        prompt_hash: 'a'.repeat(64),
        round: 2,
      },
      usage_observed: {
        prompt_tokens: null,
        completion_tokens: 0,
        cache_read_tokens: -1,
        cache_creation_tokens: Number.NaN,
      },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.input_preview).toBeUndefined();
    expect(data.error_message).toBe('[redacted]');
    expect(data.trace_id).toBeUndefined();
    expect(data.provider_call_id).toBeUndefined();
    expect(data.conversation_id).toMatch(/^[a-f0-9]{64}$/);
    expect(data.telemetry_metadata).toEqual({
      prompt_hash: 'a'.repeat(64),
      round: 2,
    });
    expect(data.usage_observed).toEqual({
      prompt_tokens: null,
      completion_tokens: 0,
      cache_read_tokens: null,
      cache_creation_tokens: null,
    });
    expect(data.cost_source).toBe('logical_summary');
    expect(JSON.stringify(data)).not.toMatch(
      /secret-token|secret-confirmation|cliente@example|base64|private customer/,
    );
  });

  it('flag OFF preserves the legacy preview and numeric cache defaults', async () => {
    const { service, create } = build(false);
    await service.logRequest(entry);
    const data = create.mock.calls[0][0].data;
    expect(data.input_preview).toBe(entry.input_preview);
    expect(data.error_message).toBe(entry.error_message);
    expect(data.cache_read_tokens).toBe(0);
    expect(data.usage_observed).toBeUndefined();
    expect(data.cost_source).toBeUndefined();
  });

  it('swallows telemetry sink failure without returning or logging the payload', async () => {
    const { service, create } = build(true);
    create.mockRejectedValue(new Error('rejected body secret-token'));
    const error = jest.spyOn((service as any).logger, 'error');
    await expect(service.logRequest(entry)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Failed to log AI request');
  });
});
