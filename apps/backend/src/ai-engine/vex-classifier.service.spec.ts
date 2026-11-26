import {
  CHAT_COMPLETIONS_ENDPOINT,
  ClassifierHttpClient,
  DECISIONS_ENDPOINT,
  DECISIONS_MODEL_PREFIXES,
  VexClassifierService,
} from './vex-classifier.service';
import { RequestContextService } from '../common/context/request-context.service';

/** Literal key, as the engine stores it (`api_key_ref`). */
const KEY = 'sk-spec';
const PROVIDER_ENV = 'AI_OPENROUTER_API_KEY';

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
      api_key_ref: KEY,
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
  const savedProviderKey = process.env[PROVIDER_ENV];
  beforeEach(() => {
    delete process.env[PROVIDER_ENV];
  });
  afterEach(() => {
    if (savedProviderKey === undefined) delete process.env[PROVIDER_ENV];
    else process.env[PROVIDER_ENV] = savedProviderKey;
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

  describe('B1: api_key_ref con la semántica del motor (clave literal)', () => {
    function withKey(api_key_ref: string | null, provider = 'openrouter') {
      const row = appRow();
      return { ...row, config: { ...row.config, api_key_ref, provider } };
    }

    it('una config creada desde el panel (clave literal) funciona tal cual', async () => {
      const http = jest.fn().mockResolvedValue(choice('accept'));
      const { service } = build(withKey('sk-or-v1-abcdef'), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({ value: 'accept' });
      expect(http.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-or-v1-abcdef');
    });

    it('sin api_key_ref usa el respaldo del motor AI_<PROVIDER>_API_KEY', async () => {
      process.env[PROVIDER_ENV] = 'sk-from-deploy';
      const http = jest.fn().mockResolvedValue(choice('accept'));
      const { service } = build(withKey(null), http);
      await service.readConfirmation('sí', '¿Aplico?');
      expect(http.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-from-deploy');
    });

    it('sin clave ni respaldo → deshabilitado, sin llamada HTTP', async () => {
      const http = jest.fn();
      const { service } = build(withKey(null), http);
      await expect(service.needsMissingTool('x', 'y')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'no_api_key',
      });
      expect(http).not.toHaveBeenCalled();
    });
  });

  describe('B2: nada de secretos del entorno ni hosts fuera de la lista', () => {
    const SECRET = 'super-secret-jwt';
    const savedJwt = process.env.JWT_SECRET;
    beforeEach(() => {
      process.env.JWT_SECRET = SECRET;
    });
    afterEach(() => {
      if (savedJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = savedJwt;
    });

    function withConfig(config: Record<string, unknown>) {
      const row = appRow();
      return { ...row, config: { ...row.config, ...config } };
    }

    it('api_key_ref = "JWT_SECRET" no resuelve la variable: es texto literal', async () => {
      const http = jest.fn().mockResolvedValue(choice('accept'));
      const { service } = build(withConfig({ api_key_ref: 'JWT_SECRET' }), http);
      await service.readConfirmation('sí', '¿Aplico?');
      const sent = JSON.stringify(http.mock.calls);
      expect(sent).not.toContain(SECRET);
      expect(http.mock.calls[0][1].headers.Authorization).toBe('Bearer JWT_SECRET');
    });

    it('provider = "JWT_SECRET" sin clave tampoco llega a JWT_SECRET (solo AI_*_API_KEY)', async () => {
      const http = jest.fn().mockResolvedValue(choice('accept'));
      const { service } = build(withConfig({ api_key_ref: null, provider: 'JWT_SECRET' }), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'no_api_key',
      });
      expect(http).not.toHaveBeenCalled();
    });

    it.each([
      ['metadata de AWS por http', 'http://169.254.169.254/latest'],
      ['metadata de AWS por https', 'https://169.254.169.254/latest'],
      ['IP en forma decimal', 'https://2852039166/'],
      ['localhost', 'https://localhost/api/v1'],
      ['nombre .internal', 'https://metadata.google.internal/'],
      ['red privada', 'https://10.0.0.5/api/v1'],
      ['IPv6 loopback', 'https://[::1]/api/v1'],
      ['host externo desconocido', 'https://attacker.example.com/api/v1'],
      ['proveedor del motor que no es OpenRouter', 'https://api.openai.com/v1'],
      ['OpenRouter por http', 'http://openrouter.ai/api/v1'],
      ['OpenRouter con otro puerto', 'https://openrouter.ai:8443/api/v1'],
    ])('base_url %s (%s) → host_not_allowed, cero POST', async (_label, base_url) => {
      const http = jest.fn().mockResolvedValue(choice('accept'));
      const { service } = build(withConfig({ base_url, api_key_ref: 'JWT_SECRET' }), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'host_not_allowed',
      });
      expect(http).not.toHaveBeenCalled();
    });

    it('base_url de OpenRouter se acepta y el fetch no sigue redirecciones', async () => {
      const http = jest.fn().mockResolvedValue(choice('accept'));
      const { service } = build(withConfig({ base_url: 'https://openrouter.ai/api/v1' }), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({ value: 'accept' });
      expect(http.mock.calls[0][0]).toBe(DECISIONS_ENDPOINT);
      expect(http.mock.calls[0][1].redirect).toBe('error');
    });
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
    expect(end.attributes).toEqual({
      classifier_question: 'confirmation',
      classifier_verdict: 'accept',
      classifier_adapter: 'decisions',
      classifier_model: 'typesafe/jev-1.14',
    });
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

  describe('adaptadores (decisions | chat)', () => {
    const GENERIC = 'openai/gpt-5-mini';

    function withModel(model: string, metadata: Record<string, unknown> = {}) {
      const base = appRow();
      return {
        ...base,
        metadata: { criteria_version: 'v1', ...metadata },
        config: { ...base.config, model_id: model },
      };
    }

    function chatReply(content: string) {
      return ok({ id: 'c1', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] });
    }

    it('la lista de modelos con Decisions es una constante (typesafe/*)', () => {
      expect(DECISIONS_MODEL_PREFIXES).toContain('typesafe/');
    });

    it('auto + typesafe/jev-1.14 → /api/alpha/decisions', async () => {
      const http = jest.fn().mockResolvedValue(choice('missing'));
      const { service } = build(withModel('typesafe/jev-1.14', { adapter: 'auto' }), http);
      await expect(service.needsMissingTool('pedir x', 'catálogo')).resolves.toMatchObject({ value: 'missing' });
      expect(http.mock.calls[0][0]).toBe(DECISIONS_ENDPOINT);
    });

    it('auto + modelo cualquiera → /api/v1/chat/completions con response_format JSON', async () => {
      const http = jest.fn().mockResolvedValue(chatReply('{"verdict":"accept"}'));
      const { service, trace } = build(withModel(GENERIC), http);
      const verdict = await service.readConfirmation('dale', '¿Aplico el lote?');
      expect(verdict).toMatchObject({ value: 'accept', confidence: null, criteria_version: 'v1' });
      const [url, init] = http.mock.calls[0];
      expect(url).toBe(CHAT_COMPLETIONS_ENDPOINT);
      expect(init.headers.Authorization).toBe('Bearer sk-spec');
      const body = JSON.parse(init.body);
      expect(body.model).toBe(GENERIC);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages[0].content).toContain('"accept"');
      expect(body.messages[0].content).toContain('{"verdict": "<accept | reject | ambiguous>"}');
      expect(body.messages[1].content).toContain('dale');
      // Never invented: absent in metadata → absent in the request.
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('reasoning');
      const end = trace.endSpan.mock.calls[0][1];
      expect(end.attributes).toMatchObject({ classifier_adapter: 'chat', classifier_model: GENERIC });
      expect(JSON.stringify(end)).not.toContain('dale');
    });

    it('chat envía temperature, max_tokens y reasoning_effort de metadata; decisions los ignora', async () => {
      const params = { temperature: 0, max_tokens: 20, reasoning_effort: 'low' };
      const chatHttp = jest.fn().mockResolvedValue(chatReply('{"verdict":"exists"}'));
      await build(withModel(GENERIC, params), chatHttp).service.needsMissingTool('a', 'b');
      const chatBody = JSON.parse(chatHttp.mock.calls[0][1].body);
      expect(chatBody).toMatchObject({ temperature: 0, max_tokens: 20, reasoning: { effort: 'low' } });

      const decHttp = jest.fn().mockResolvedValue(choice('exists'));
      await build(withModel('typesafe/jev-1.14', params), decHttp).service.needsMissingTool('a', 'b');
      const decBody = JSON.parse(decHttp.mock.calls[0][1].body);
      expect(Object.keys(decBody).sort()).toEqual(['model', 'questions', 'state']);
    });

    it("adapter 'chat' forzado con typesafe/* → chat igualmente", async () => {
      const http = jest.fn().mockResolvedValue(chatReply('{"verdict":"reject"}'));
      const { service } = build(withModel('typesafe/jev-1.14', { adapter: 'chat' }), http);
      await expect(service.readConfirmation('no', '¿Aplico?')).resolves.toMatchObject({ value: 'reject' });
      expect(http.mock.calls[0][0]).toBe(CHAT_COMPLETIONS_ENDPOINT);
    });

    it("adapter 'decisions' forzado con un modelo que no la soporta → unavailable adapter_unsupported, sin llamada", async () => {
      const http = jest.fn();
      const { service, trace } = build(withModel(GENERIC, { adapter: 'decisions' }), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'adapter_unsupported',
      });
      expect(http).not.toHaveBeenCalled();
      expect(trace.endSpan.mock.calls[0][1].attributes).toMatchObject({
        classifier_adapter: 'decisions',
        classifier_model: GENERIC,
        classifier_degradation: 'adapter_unsupported',
      });
    });

    it('adapter desconocido en metadata → unavailable config_error (no adivina)', async () => {
      const http = jest.fn();
      const { service } = build(withModel(GENERIC, { adapter: 'magic' }), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'config_error',
      });
      expect(http).not.toHaveBeenCalled();
    });

    it('JSON inválido → un reintento de reparación que valida', async () => {
      const http = jest
        .fn()
        .mockResolvedValueOnce(chatReply('Claro: la persona acepta'))
        .mockResolvedValueOnce(chatReply('```json\n{"verdict":"accept"}\n```'));
      const { service } = build(withModel(GENERIC), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({ value: 'accept' });
      expect(http).toHaveBeenCalledTimes(2);
      const repair = JSON.parse(http.mock.calls[1][1].body).messages;
      expect(repair).toHaveLength(4);
      expect(repair[3].content).toContain('no es válida');
    });

    it.each([
      ['texto libre', 'acepta'],
      ['valor fuera del criterio', '{"verdict":"maybe"}'],
      ['claves extra', '{"verdict":"accept","why":"x"}'],
    ])('JSON inválido dos veces (%s) → unavailable invalid_response', async (_label, content) => {
      const http = jest.fn().mockResolvedValue(chatReply(content));
      const { service } = build(withModel(GENERIC), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'invalid_response',
      });
      expect(http).toHaveBeenCalledTimes(2);
    });

    it('refusal en chat → unavailable refusal, sin reparación', async () => {
      const http = jest.fn().mockResolvedValue(
        ok({ choices: [{ message: { content: null, refusal: 'no puedo' }, finish_reason: 'stop' }] }),
      );
      const { service } = build(withModel(GENERIC), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'refusal',
      });
      expect(http).toHaveBeenCalledTimes(1);
    });

    it('400 con response_format → reintenta una vez sin response_format', async () => {
      const http = jest
        .fn()
        .mockResolvedValueOnce({ status: 400, json: async () => ({ error: { code: 400 } }) })
        .mockResolvedValueOnce(chatReply('{"verdict":"exists"}'));
      const { service } = build(withModel(GENERIC), http);
      await expect(service.needsMissingTool('a', 'b')).resolves.toMatchObject({ value: 'exists' });
      expect(JSON.parse(http.mock.calls[1][1].body)).not.toHaveProperty('response_format');
    });

    it('json_mode=false → sin response_format, solo instrucción en el mensaje', async () => {
      const http = jest.fn().mockResolvedValue(chatReply('{"verdict":"exists"}'));
      const { service } = build(withModel(GENERIC, { json_mode: false }), http);
      await service.needsMissingTool('a', 'b');
      const body = JSON.parse(http.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('response_format');
      expect(body.messages[0].content).toContain('Responde SOLO con un objeto JSON');
    });

    it.each(['', '   ', null])('model_id vacío (%p) → deshabilitado, sin llamada', async (model) => {
      const http = jest.fn();
      const { service } = build(withModel(model as string), http);
      await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'no_model',
      });
      expect(http).not.toHaveBeenCalled();
    });

    it('base_url de OpenRouter: solo se usa su origen; las rutas son del adaptador', async () => {
      const http = jest.fn().mockResolvedValue(chatReply('{"verdict":"exists"}'));
      const row = withModel(GENERIC);
      const withBase = { ...row, config: { ...row.config, base_url: 'https://openrouter.ai/otra/ruta' } };
      await build(withBase, http).service.needsMissingTool('a', 'b');
      expect(http.mock.calls[0][0]).toBe(CHAT_COMPLETIONS_ENDPOINT);
    });

    it('400 a response_format se recuerda: la siguiente llamada no paga el reenvío', async () => {
      const http = jest
        .fn()
        .mockResolvedValueOnce({ status: 400, json: async () => ({}) })
        .mockResolvedValue(chatReply('{"verdict":"exists"}'));
      const { service } = build(withModel(GENERIC), http);
      await service.needsMissingTool('a', 'b');
      expect(http).toHaveBeenCalledTimes(2);
      await service.needsMissingTool('a', 'b');
      expect(http).toHaveBeenCalledTimes(3);
      expect(JSON.parse(http.mock.calls[2][1].body)).not.toHaveProperty('response_format');
    });

    it('200 con cuerpo no JSON → invalid_response, sin reintento de transporte', async () => {
      const http = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      });
      const { service } = build(withModel(GENERIC), http);
      await expect(service.needsMissingTool('a', 'b')).resolves.toMatchObject({
        value: 'unavailable',
        reason: 'invalid_response',
      });
      expect(http).toHaveBeenCalledTimes(1);
    });

    describe('B3: cada POST cuenta contra el tope y hay un plazo total por llamada', () => {
      it('modelo que devuelve 500 siempre: 2 POST por llamada (intento + reintento) y nunca más que el tope del turno', async () => {
        const http = jest.fn().mockResolvedValue({ status: 500, json: async () => ({}) });
        const { service } = build(withModel(GENERIC), http);
        const results = await inTurn('33333333-3333-4333-8333-333333333333', async () => [
          await service.needsMissingTool('a', 'b'),
          await service.needsMissingTool('a', 'b'),
          await service.needsMissingTool('a', 'b'),
        ]);
        // Tope del spec: 3 POST por turno. 1.ª llamada: 500 + reintento 500;
        // 2.ª: un 500 y su reintento ya no cabe; 3.ª: ningún POST.
        expect(http).toHaveBeenCalledTimes(3);
        expect(results.map((r) => ('reason' in r ? r.reason : r.value))).toEqual([
          'http_error',
          'turn_cap',
          'turn_cap',
        ]);
      });

      it('la secuencia de la revisión (429/400/…/200 inválido) ya no llega a 8 POST', async () => {
        const seq = [429, 400, 429, 200, 429, 400, 429, 200];
        const http = jest.fn();
        for (const status of seq)
          http.mockResolvedValueOnce(
            status === 200 ? chatReply('no es json') : { status, json: async () => ({}) },
          );
        const { service } = build(withModel(GENERIC, {}), http);
        await expect(
          inTurn('44444444-4444-4444-8444-444444444444', () => service.readConfirmation('sí', '¿Aplico?')),
        ).resolves.toMatchObject({ value: 'unavailable' });
        expect(http.mock.calls.length).toBeLessThanOrEqual(3);
      });

      it('sin request id el tope sigue acotando cada llamada', async () => {
        const http = jest.fn().mockResolvedValue({ status: 500, json: async () => ({}) });
        const { service } = build(
          { ...withModel(GENERIC), rate_limit: { max_calls_per_turn: 1 } },
          http,
        );
        for (let i = 0; i < 5; i++) await service.needsMissingTool('a', 'b');
        expect(http).toHaveBeenCalledTimes(5);
      });

      it('500 lento siempre: no supera el plazo total ni los POST que caben en él', async () => {
        const http = jest.fn(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ status: 500, json: async () => ({}) }), 80),
            ),
        );
        const row = withModel(GENERIC);
        const { service } = build(
          {
            ...row,
            rate_limit: { max_calls_per_turn: 20 },
            retry_config: { timeout_ms: 5_000, total_timeout_ms: 150, max_retries: 1 },
          },
          http,
        );
        const started = Date.now();
        const verdict = await service.needsMissingTool('a', 'b');
        const elapsed = Date.now() - started;
        expect(verdict).toMatchObject({ value: 'unavailable' });
        expect(http.mock.calls.length).toBeLessThanOrEqual(2);
        expect(elapsed).toBeLessThan(150 + 60);
      });

      it('modelo colgado con timeout_ms alto: el plazo total corta la llamada', async () => {
        const http = jest.fn(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) =>
              init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
            ),
        );
        const row = withModel(GENERIC);
        const { service } = build(
          { ...row, retry_config: { timeout_ms: 5_000, total_timeout_ms: 120, max_retries: 1 } },
          http,
        );
        const started = Date.now();
        await expect(service.needsMissingTool('a', 'b')).resolves.toMatchObject({
          value: 'unavailable',
          reason: 'timeout',
        });
        expect(Date.now() - started).toBeLessThan(120 + 60);
        expect(http).toHaveBeenCalledTimes(1);
      });

      it('null en la configuración JSON cae al valor por defecto (no apaga el clasificador)', async () => {
        const http = jest.fn().mockResolvedValue(chatReply('{"verdict":"exists"}'));
        const row = withModel(GENERIC);
        const { service } = build(
          {
            ...row,
            rate_limit: { max_calls_per_turn: null },
            retry_config: { timeout_ms: null, total_timeout_ms: null, max_retries: null },
          },
          http,
        );
        await expect(service.needsMissingTool('a', 'b')).resolves.toMatchObject({ value: 'exists' });
      });
    });

    describe.each([
      ['decisions', 'typesafe/jev-1.14'],
      ['chat', GENERIC],
    ])('fallas de transporte (%s): el turno sigue', (_adapter, model) => {
      it('timeout → unavailable', async () => {
        const http = jest.fn(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) =>
              init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
            ),
        );
        const { service } = build(withModel(model), http);
        await expect(service.readConfirmation('sí', '¿Aplico?')).resolves.toMatchObject({
          value: 'unavailable',
          reason: 'timeout',
        });
        expect(http).toHaveBeenCalledTimes(2);
      });

      it.each([429, 500])('HTTP %i → unavailable', async (status) => {
        const http = jest.fn().mockResolvedValue({ status, json: async () => ({ error: { code: status } }) });
        const { service } = build(withModel(model), http);
        await expect(service.needsMissingTool('pedir x', 'catálogo')).resolves.toMatchObject({
          value: 'unavailable',
          reason: 'http_error',
        });
        expect(http).toHaveBeenCalledTimes(2);
      });
    });
  });
});
