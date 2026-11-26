import {
  ClassifierHttpClient,
  DECISIONS_ENDPOINT,
  VexClassifierService,
} from './vex-classifier.service';
import { RequestContextService } from '../common/context/request-context.service';

const KEY_ENV = 'VEX_CLASSIFIER_SPEC_KEY';

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    key: 'vex_classifier',
    is_active: true,
    rate_limit: { max_calls_per_turn: 3 },
    retry_config: { timeout_ms: 50, max_retries: 1 },
    metadata: { criteria_version: 'v1' },
    config: {
      provider: 'openrouter',
      model_id: 'typesafe/jev-1.14',
      base_url: null,
      api_key_ref: KEY_ENV,
      is_active: true,
    },
    ...overrides,
  };
}

function ok(body: unknown) {
  return { status: 200, json: async () => body };
}

function choice(value: string, confidence = 0.9) {
  return ok({
    id: 'd1',
    answers: {
      verdict: { type: 'choice', choice: value, probabilities: {}, confidence },
    },
  });
}

function build(row: unknown, http: jest.Mock) {
  const prisma = {
    ai_engine_applications: { findUnique: jest.fn().mockResolvedValue(row) },
  };
  const trace = { startSpan: jest.fn(() => undefined), endSpan: jest.fn() };
  const service = new VexClassifierService(
    prisma as any,
    trace as any,
    http as unknown as ClassifierHttpClient,
  );
  return { service, prisma, trace };
}

/** Runs inside one request so the per-turn counter has a stable key. */
function inTurn<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContextService.asyncLocalStorage.run(
    { request_id: requestId } as any,
    fn,
  );
}

describe('VexClassifierService', () => {
  beforeEach(() => {
    process.env[KEY_ENV] = 'sk-spec';
  });
  afterEach(() => {
    delete process.env[KEY_ENV];
    jest.useRealTimers();
  });

  it('fila ausente → deshabilitado, sin llamada HTTP', async () => {
    const http = jest.fn();
    const { service } = build(null, http);
    await expect(service.readConfirmation('sí', '¿Aplico el lote?')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'not_configured',
    });
    expect(http).not.toHaveBeenCalled();
  });

  it('is_active=false → deshabilitado, sin llamada HTTP', async () => {
    const http = jest.fn();
    const { service } = build(appRow({ is_active: false }), http);
    await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'inactive',
    });
    expect(http).not.toHaveBeenCalled();
  });

  it('sin clave en el entorno → deshabilitado; nunca usa el ref como clave literal', async () => {
    delete process.env[KEY_ENV];
    const http = jest.fn();
    const { service } = build(appRow(), http);
    await expect(service.needsMissingTool('x', 'y')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'no_api_key',
    });
    expect(http).not.toHaveBeenCalled();
  });

  it('error leyendo la configuración → unavailable, no lanza', async () => {
    const http = jest.fn();
    const { service, prisma } = build(appRow(), http);
    prisma.ai_engine_applications.findUnique.mockRejectedValue(new Error('db down'));
    await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'config_error',
    });
  });

  it('respuesta válida → valor tipado, con el contrato de la Decisions API', async () => {
    const http = jest.fn().mockResolvedValue(choice('accept'));
    const { service, trace } = build(appRow(), http);
    const verdict = await service.readConfirmation('dale, hágale', '¿Aplico el lote de 12 precios?');
    expect(verdict).toMatchObject({ value: 'accept', confidence: 0.9, criteria_version: 'v1' });
    const [url, init] = http.mock.calls[0];
    expect(url).toBe(DECISIONS_ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer sk-spec');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('typesafe/jev-1.14');
    expect(body.state).toContain('dale, hágale');
    expect(body.questions.verdict.type).toBe('choice');
    expect(Object.keys(body.questions.verdict.criteria)).toEqual(['accept', 'reject', 'ambiguous']);
    // Span: question/verdict only, never the text.
    const end = trace.endSpan.mock.calls[0][1];
    expect(end.attributes).toEqual({ classifier_question: 'confirmation', classifier_verdict: 'accept' });
    expect(JSON.stringify(end)).not.toContain('dale');
  });

  it('timeout → unavailable (1 reintento máximo) y no lanza', async () => {
    const http = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const { service } = build(appRow(), http);
    await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'timeout',
    });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each([429, 500])('HTTP %i → unavailable tras un solo reintento', async (status) => {
    const http = jest.fn().mockResolvedValue({ status, json: async () => ({ error: { code: status } }) });
    const { service } = build(appRow(), http);
    await expect(service.needsMissingTool('pedir x', 'catálogo')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'http_error',
    });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('HTTP 401 → unavailable sin reintento', async () => {
    const http = jest.fn().mockResolvedValue({ status: 401, json: async () => ({}) });
    const { service } = build(appRow(), http);
    await expect(service.isWritePromise('Voy a subir los precios')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'http_error',
    });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sin answers', { id: 'x' }],
    ['choice fuera del criterio', { answers: { verdict: { type: 'choice', choice: 'maybe' } } }],
    ['tipo inesperado', { answers: { verdict: { type: 'noul', noul: 0.9 } } }],
    ['JSON no objeto', 'nope'],
  ])('esquema inválido (%s) → unavailable', async (_label, body) => {
    const http = jest.fn().mockResolvedValue(ok(body));
    const { service } = build(appRow(), http);
    await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('refusal del proveedor → unavailable (no es un veredicto negativo)', async () => {
    const http = jest.fn().mockResolvedValue(ok({ answers: { verdict: { type: 'refusal' } } }));
    const { service } = build(appRow(), http);
    await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'refusal',
    });
  });

  it('json() que lanza → unavailable', async () => {
    const http = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    const { service } = build(appRow(), http);
    await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
      value: 'unavailable',
    });
  });

  it('tope por turno agotado → unavailable sin llamar; otro turno vuelve a tener cupo', async () => {
    const http = jest.fn().mockResolvedValue(choice('reject'));
    const { service } = build(appRow({ rate_limit: { max_calls_per_turn: 2 } }), http);
    const results = await inTurn('11111111-1111-4111-8111-111111111111', async () => [
      await service.readConfirmation('no', '¿Aplico?'),
      await service.readConfirmation('no', '¿Aplico?'),
      await service.readConfirmation('no', '¿Aplico?'),
    ]);
    expect(results.map((r) => r.value)).toEqual(['reject', 'reject', 'unavailable']);
    expect(results[2]).toMatchObject({ reason: 'turn_cap' });
    expect(http).toHaveBeenCalledTimes(2);
    await expect(
      inTurn('22222222-2222-4222-8222-222222222222', () => service.readConfirmation('no', '¿Aplico?')),
    ).resolves.toMatchObject({ value: 'reject' });
  });

  it('confianza bajo el mínimo de metadata → unavailable', async () => {
    const http = jest.fn().mockResolvedValue(choice('accept', 0.4));
    const { service } = build(appRow({ metadata: { criteria_version: 'v2', min_confidence: 0.7 } }), http);
    await expect(service.readConfirmation('mm', '¿Aplico?')).resolves.toMatchObject({
      value: 'unavailable',
      reason: 'low_confidence',
      criteria_version: 'v2',
    });
  });

  it('cache corta: lee la fila una vez y invalidate() la relee', async () => {
    const http = jest.fn().mockResolvedValue(choice('exists'));
    const { service, prisma } = build(appRow(), http);
    await service.needsMissingTool('a', 'b');
    await service.needsMissingTool('a', 'b');
    expect(prisma.ai_engine_applications.findUnique).toHaveBeenCalledTimes(1);
    service.invalidate();
    await service.needsMissingTool('a', 'b');
    expect(prisma.ai_engine_applications.findUnique).toHaveBeenCalledTimes(2);
  });

  it('isWritePromise (preparado): devuelve promise | description | question', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(choice('promise'))
      .mockResolvedValueOnce(choice('description'))
      .mockResolvedValueOnce(choice('question'));
    const { service } = build(appRow({ rate_limit: { max_calls_per_turn: 5 } }), http);
    const values = await inTurn('33333333-3333-4333-8333-333333333333', async () => [
      (await service.isWritePromise('Ya le subo el precio a los 12 productos')).value,
      (await service.isWritePromise('El producto cuesta $12.000')).value,
      (await service.isWritePromise('¿A cuáles productos?')).value,
    ]);
    expect(values).toEqual(['promise', 'description', 'question']);
    const body = JSON.parse(http.mock.calls[0][1].body);
    expect(Object.keys(body.questions.verdict.criteria)).toEqual(['promise', 'description', 'question']);
  });

  it('un error de telemetría no afecta el resultado', async () => {
    const http = jest.fn().mockResolvedValue(choice('missing'));
    const { service, trace } = build(appRow(), http);
    trace.endSpan.mockImplementation(() => {
      throw new Error('trace broken');
    });
    await expect(service.needsMissingTool('a', 'b')).resolves.toMatchObject({ value: 'missing' });
  });
});
