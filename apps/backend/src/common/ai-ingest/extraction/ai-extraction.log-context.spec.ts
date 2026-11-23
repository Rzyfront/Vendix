// Only the class token is used; loading the real engine type-checks its whole graph.
jest.mock('../../../ai-engine/ai-engine.service', () => ({
  AIEngineService: class {},
}));

import {
  AiExtractionError,
  AiExtractionService,
  ExtractionSchema,
  NOT_JSON_LOG_ERROR,
} from './ai-extraction.service';
import {
  AIMessage,
  AIRequestOptions,
  AIResponse,
} from '../../../ai-engine/interfaces/ai-provider.interface';

/**
 * ia-cargas F6: every ai-ingest call tells the log its `attempt` (1 first,
 * +1 per repair and per split level) and why its answer was rejected
 * (`validation_error`), without changing what is called or returned.
 */
const ROWS_SCHEMA: ExtractionSchema = {
  name: 'rows',
  schema: {
    type: 'object',
    required: ['rows'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' } },
        },
      },
    },
  },
};

interface LoggedCall {
  attempt?: number;
  validation_error?: string | null;
}

/**
 * Fake engine that behaves like `AIEngineService.run()` for the log: it calls
 * `logContext.validate` on a successful, non-truncated answer and records
 * what would go to ai_engine_logs.
 */
const fakeEngine = (answers: AIResponse[]) => {
  const logged: LoggedCall[] = [];
  const run = jest.fn(
    async (
      _app: string,
      _vars: Record<string, string>,
      _messages: AIMessage[],
      options: AIRequestOptions,
    ): Promise<AIResponse> => {
      const answer = answers.shift() ?? { success: false, error: 'no more' };
      const ctx = options.logContext;
      logged.push({
        attempt: ctx?.attempt,
        validation_error:
          answer.success && answer.finish_reason !== 'length'
            ? ctx?.validate?.(answer.content ?? '')
            : undefined,
      });
      return answer;
    },
  );
  return { run, logged };
};

const ok = (content: string): AIResponse => ({
  success: true,
  content,
  finish_reason: 'stop',
});

describe('AiExtractionService log context (ia-cargas F6)', () => {
  it('primera llamada válida: attempt 1 y sin validation_error', async () => {
    const { run, logged } = fakeEngine([ok('{"rows":[{"id":1}]}')]);
    const service = new AiExtractionService({ run } as any);

    const data = await service.extract({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(data).toEqual({ rows: [{ id: 1 }] });
    expect(logged).toEqual([{ attempt: 1, validation_error: null }]);
  });

  it('reparación: la primera queda con el error de ajv y la reparación es attempt 2', async () => {
    const { run, logged } = fakeEngine([
      ok('{"rows":[{"id":"uno"}]}'),
      ok('{"rows":[{"id":1}]}'),
    ]);
    const service = new AiExtractionService({ run } as any);

    const data = await service.extract({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(data).toEqual({ rows: [{ id: 1 }] });
    expect(logged[0].attempt).toBe(1);
    expect(logged[0].validation_error).toMatch(
      /^schema: \/rows\/0\/id must be integer/,
    );
    // Never the model's value ("uno"), only paths and ajv messages.
    expect(logged[0].validation_error).not.toContain('uno');
    expect(logged[1]).toEqual({ attempt: 2, validation_error: null });
    // The repair still carries the same ajv errors to the model (unchanged).
    const repairMessages = run.mock.calls[1][2] as AIMessage[];
    expect(String(repairMessages[repairMessages.length - 1].content)).toContain(
      '/rows/0/id must be integer',
    );
  });

  it('texto que no es JSON se registra con un texto fijo, sin eco de la respuesta', async () => {
    const { run, logged } = fakeEngine([
      ok('Mi cliente Juan Pérez CC 123'),
      ok('sigue sin ser JSON'),
    ]);
    const service = new AiExtractionService({ run } as any);

    await expect(
      service.extract({
        appKey: 'app',
        schema: ROWS_SCHEMA,
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({ failure: 'invalid' });

    expect(logged).toEqual([
      { attempt: 1, validation_error: NOT_JSON_LOG_ERROR },
      { attempt: 2, validation_error: NOT_JSON_LOG_ERROR },
    ]);
  });

  it('el error de la reparación fallida conserva la respuesta del proveedor', async () => {
    const second = ok('{"rows":"x"}');
    const { run } = fakeEngine([ok('{"rows":"x"}'), second]);
    const service = new AiExtractionService({ run } as any);

    const error = (await service
      .extract({ appKey: 'app', schema: ROWS_SCHEMA, messages: [] })
      .catch((e: unknown) => e)) as AiExtractionError;

    expect(error).toBeInstanceOf(AiExtractionError);
    expect(error.response).toBe(second);
  });

  it('split por length: las mitades registran attempt 1 + profundidad', async () => {
    const answers: AIResponse[] = [
      { success: true, content: '{"rows":[', finish_reason: 'length' },
      ok('{"rows":[{"id":1}]}'),
      ok('{"rows":[{"id":2}]}'),
    ];
    const { run, logged } = fakeEngine(answers);
    const service = new AiExtractionService({ run } as any);

    const result = await service.extractBatches<
      number,
      { rows: { id: number }[] }
    >({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      items: [1, 2],
      batchSize: 2,
      concurrency: 1,
      buildMessages: (batch) => [
        { role: 'user', content: `ids: ${batch.join(',')}` },
      ],
    });

    expect(result.results).toHaveLength(2);
    expect(logged.map((l) => l.attempt)).toEqual([1, 2, 2]);
    // The truncated answer is not validated (finish_reason says why).
    expect(logged[0].validation_error).toBeUndefined();
  });

  it('si el motor no llama al validador (mock), el resultado es el mismo', async () => {
    const run = jest.fn().mockResolvedValue(ok('{"rows":[{"id":"7"}]}'));
    const service = new AiExtractionService({ run } as any);

    const data = await service.extract({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      messages: [],
    });

    // coerceTypes as before: "7" → 7.
    expect(data).toEqual({ rows: [{ id: 7 }] });
    expect(run.mock.calls[0][3].logContext).toEqual(
      expect.objectContaining({ attempt: 1, validate: expect.any(Function) }),
    );
  });
});
