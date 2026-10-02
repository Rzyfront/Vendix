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
