import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';

/**
 * ia-cargas F6: `run()` writes `finish_reason`, the caller `attempt` and the
 * caller's `validation_error` to its ai_engine_logs row, without changing the
 * call: `logContext` never reaches the provider, a throwing validator only
 * leaves the column empty and a failing log write never breaks the load.
 */
describe('AIEngineService.run() log annotations (ia-cargas F6)', () => {
  const APP = {
    key: 'customer_import_ocr',
    is_active: true,
    config_id: 5,
    model_type: 'text',
    system_prompt: 'sys',
    prompt_template: null,
    ai_feature_category: null,
    temperature: null,
    max_tokens: 4000,
  };

  const buildService = (aiLogging: any) => {
    const prisma = {
      ai_engine_applications: { findUnique: jest.fn().mockResolvedValue(APP) },
    };
    const service = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
      aiLogging,
      { emit: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      } as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'consumeSubscriptionQuota')
      .mockResolvedValue(undefined);
    return service;
  };

  const withProvider = (service: AIEngineService, response: any) => {
    const chat = jest.fn().mockResolvedValue(response);
    (service as any).providers.set(5, { chat });
    return chat;
  };

  const mockLogging = () => ({
    calculateCost: jest.fn().mockReturnValue(0),
    logRequest: jest.fn().mockResolvedValue(undefined),
  });

  it('guarda finish_reason, attempt y el motivo de validación del llamador', async () => {
    const logging = mockLogging();
    const service = buildService(logging);
    const chat = withProvider(service, {
      success: true,
      content: '{"rows":"x"}',
      finish_reason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const validate = jest.fn().mockReturnValue('schema: /rows must be array');

    const res = await service.run('customer_import_ocr', {}, [], {
      quotaKey: 'ai-ingest:1',
      logContext: { attempt: 2, validate },
    });

    expect(res.success).toBe(true);
    expect(res.content).toBe('{"rows":"x"}');
    expect(validate).toHaveBeenCalledWith('{"rows":"x"}');
    expect(logging.logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        finish_reason: 'stop',
        attempt: 2,
        validation_error: 'schema: /rows must be array',
      }),
    );
    // Log-only: the provider never sees logContext (quotaKey stays as before).
    const providerOptions = chat.mock.calls[0][1];
    expect(providerOptions).not.toHaveProperty('logContext');
    expect(providerOptions.maxTokens).toBe(4000);
  });

  it('una respuesta cortada guarda length y no se valida', async () => {
    const logging = mockLogging();
    const service = buildService(logging);
    withProvider(service, {
      success: true,
      content: '{"rows":[',
      finish_reason: 'length',
    });
    const validate = jest.fn();

    await service.run('customer_import_ocr', {}, [], {
      logContext: { attempt: 1, validate },
    });

    expect(validate).not.toHaveBeenCalled();
    const entry = logging.logRequest.mock.calls[0][0];
    expect(entry.finish_reason).toBe('length');
    expect(entry.validation_error).toBeUndefined();
  });

  it('un validador que lanza deja la columna vacía y la llamada sigue igual', async () => {
    const logging = mockLogging();
    const service = buildService(logging);
    withProvider(service, {
      success: true,
      content: 'ok',
      finish_reason: 'stop',
    });

    const res = await service.run('customer_import_ocr', {}, [], {
      logContext: {
        attempt: 1,
        validate: () => {
          throw new Error('boom');
        },
      },
    });

    expect(res).toEqual(
      expect.objectContaining({ success: true, content: 'ok' }),
    );
    const entry = logging.logRequest.mock.calls[0][0];
    expect(entry.finish_reason).toBe('stop');
    expect(entry.attempt).toBe(1);
    expect(entry.validation_error).toBeUndefined();
  });

  it('sin logContext (resto de apps) no escribe attempt ni validation_error', async () => {
    const logging = mockLogging();
    const service = buildService(logging);
    withProvider(service, {
      success: true,
      content: 'hola',
      finish_reason: 'stop',
    });

    await service.run('customer_import_ocr');

    const entry = logging.logRequest.mock.calls[0][0];
    expect(entry.finish_reason).toBe('stop');
    expect(entry).not.toHaveProperty('attempt');
    expect(entry).not.toHaveProperty('validation_error');
  });

  it('si escribir el log falla, la carga no falla', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('column does not exist'));
    const realLogging = new AILoggingService(
      { ai_engine_logs: { create } } as any,
      {} as any,
    );
    const errorSpy = jest
      .spyOn((realLogging as any).logger, 'error')
      .mockImplementation(() => undefined);
    const service = buildService(realLogging);
    withProvider(service, {
      success: true,
      content: '{"rows":[]}',
      finish_reason: 'stop',
    });

    const res = await service.run('customer_import_ocr', {}, [], {
      logContext: { attempt: 1, validate: () => null },
    });
    // Let the fire-and-forget log write settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.success).toBe(true);
    expect(res.content).toBe('{"rows":[]}');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      finish_reason: 'stop',
      attempt: 1,
    });
    expect(errorSpy).toHaveBeenCalledWith('Failed to log AI request');
  });
});
