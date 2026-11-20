// Only the class token is used; loading the real engine type-checks its whole graph.
jest.mock('../../../ai-engine/ai-engine.service', () => ({ AIEngineService: class {} }));

import { UnrecoverableError } from 'bullmq';
import {
  classifyAiJobFailure,
  toAiJobFailure,
} from '@common/ai-scan-jobs/ai-job-failure.util';
import {
  AiExtractionError,
  AiExtractionService,
  ExtractionSchema,
  toStrictJsonSchema,
} from './ai-extraction.service';
import { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';

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
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    },
  },
};

/** The ids a batch message carries ("ids: 1,2,3"). */
const idsOf = (messages: AIMessage[]): number[] =>
  String(messages[0].content)
    .replace('ids: ', '')
    .split(',')
    .map(Number);

describe('AiExtractionService', () => {
  let run: jest.Mock;
  let service: AiExtractionService;

  beforeEach(() => {
    run = jest.fn();
    service = new AiExtractionService({ run } as any);
  });

  it('pide salida estructurada con el esquema estricto y devuelve el JSON válido', async () => {
    run.mockResolvedValue({ success: true, content: '{"rows":[{"id":1}]}', finish_reason: 'stop' });

    const data = await service.extract({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(data).toEqual({ rows: [{ id: 1 }] });
    const options = run.mock.calls[0][3];
    expect(options.responseSchema.name).toBe('rows');
    const item = options.responseSchema.schema.properties.rows.items;
    expect(item.required).toEqual(['id', 'name']);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.name.type).toEqual(['string', 'null']);
  });

  it('repara una vez con los errores de ajv', async () => {
    run
      .mockResolvedValueOnce({ success: true, content: '{"rows":[{"id":"uno"}]}' })
      .mockResolvedValueOnce({ success: true, content: '```json\n{"rows":[{"id":1}]}\n```' });

    const data = await service.extract({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(data).toEqual({ rows: [{ id: 1 }] });
    expect(run).toHaveBeenCalledTimes(2);
    const repair: AIMessage[] = run.mock.calls[1][2];
    expect(repair).toHaveLength(3);
    expect(repair[1]).toEqual({ role: 'assistant', content: '{"rows":[{"id":"uno"}]}' });
    expect(repair[2].content).toContain('/rows/0/id must be integer');
  });

  it('si la reparación también falla es un error del documento, no reintentable', async () => {
    run.mockResolvedValue({ success: true, content: 'no tengo JSON' });

    const error = (await service
      .extract({ appKey: 'app', schema: ROWS_SCHEMA, messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as AiExtractionError;

    expect(run).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(AiExtractionError);
    expect(error.failure).toBe('invalid');
    const http = error.toHttpException();
    expect(http.errorCode).toBe('AI_INGEST_PARSE_FAIL');
    expect(toAiJobFailure(http)).toBeInstanceOf(UnrecoverableError);
  });

  it('un fallo del proveedor no es culpa del documento: sin créditos avisa, una caída se reintenta', async () => {
    run.mockResolvedValue({ success: false, error: '402', failure_reason: 'credits' });
    const credits = (await service
      .extract({ appKey: 'app', schema: ROWS_SCHEMA, messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as AiExtractionError;

    expect(run).toHaveBeenCalledTimes(1);
    expect(credits.failure).toBe('ai_failed');
    expect(credits.toHttpException().errorCode).toBe('AI_PROVIDER_003');
    expect(classifyAiJobFailure('AI_PROVIDER_003').category).toBe('ai_unavailable');

    run.mockResolvedValue({ success: false, error: 'timeout' });
    const outage = (await service
      .extract({ appKey: 'app', schema: ROWS_SCHEMA, messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as AiExtractionError;
    expect(toAiJobFailure(outage.toHttpException())).not.toBeInstanceOf(UnrecoverableError);
  });

  it('finish_reason=length parte el lote a la mitad hasta que cabe', async () => {
    // Solo caben 2 filas por respuesta: 8 → 4 → 2.
    run.mockImplementation(async (_app, _vars, messages: AIMessage[]) => {
      const ids = idsOf(messages);
      if (ids.length > 2) return { success: true, content: '{"rows":[', finish_reason: 'length' };
      return {
        success: true,
        finish_reason: 'stop',
        content: JSON.stringify({ rows: ids.map((id) => ({ id })) }),
      };
    });
    const progress: number[] = [];

    const out = await service.extractBatches<number, { rows: { id: number }[] }>({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      items: [1, 2, 3, 4, 5, 6, 7, 8],
      batchSize: 8,
      buildMessages: (batch) => [{ role: 'user', content: `ids: ${batch.join(',')}` }],
      onProgress: (done) => {
        progress.push(done);
      },
    });

    expect(out.failed).toEqual([]);
    const ids = out.results.flatMap((r) => r.data.rows.map((x) => x.id)).sort();
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(progress[progress.length - 1]).toBe(8);
  });

  it('a la profundidad máxima el lote cortado se informa como fallido, sin perder filas', async () => {
    run.mockResolvedValue({ success: true, content: '{"rows":[', finish_reason: 'length' });

    const out = await service.extractBatches({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      items: [1, 2, 3, 4],
      batchSize: 4,
      maxSplitDepth: 1,
      buildMessages: (batch) => [{ role: 'user', content: `ids: ${batch.join(',')}` }],
    });

    expect(out.results).toEqual([]);
    expect(out.failed.map((f) => [f.items, f.failure])).toEqual([
      [[1, 2], 'truncated'],
      [[3, 4], 'truncated'],
    ]);
  });

  it('respeta la concurrencia máxima', async () => {
    let inFlight = 0;
    let peak = 0;
    run.mockImplementation(async (_a, _v, messages: AIMessage[]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { success: true, content: JSON.stringify({ rows: idsOf(messages).map((id) => ({ id })) }) };
    });

    await service.extractBatches({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      items: Array.from({ length: 10 }, (_, i) => i + 1),
      batchSize: 1,
      concurrency: 3,
      buildMessages: (batch) => [{ role: 'user', content: `ids: ${batch.join(',')}` }],
    });

    expect(run).toHaveBeenCalledTimes(10);
    expect(peak).toBe(3);
  });

  it('acepta null en opcionales (salida estricta) y números donde va texto, sin reparar', async () => {
    run.mockResolvedValue({
      success: true,
      finish_reason: 'stop',
      content: '{"rows":[{"id":"7","name":1020304050},{"id":8,"name":null}]}',
    });
    const out = await service.extract<{ rows: { id: number; name?: string }[] }>({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.rows).toEqual([{ id: 7, name: '1020304050' }, { id: 8 }]);
  });

  it('cuota: todas las llamadas de una carga comparten quotaKey (1 unidad por carga)', async () => {
    // Lote 1 se corta y se parte; el primer medio llega inválido y se repara.
    let calls = 0;
    run.mockImplementation(async (_app, _vars, messages: AIMessage[]) => {
      calls++;
      const ids = idsOf(messages);
      if (ids.length > 2) return { success: true, content: '{"rows":[', finish_reason: 'length' };
      if (calls === 2) return { success: true, content: '{"rows":[{"id":"uno"}]}' };
      return { success: true, content: JSON.stringify({ rows: ids.map((id) => ({ id })) }) };
    });
    await service.extractBatches({
      appKey: 'app',
      schema: ROWS_SCHEMA,
      items: [1, 2, 3, 4, 5, 6],
      batchSize: 4,
      concurrency: 1,
      buildMessages: (batch) => [{ role: 'user', content: `ids: ${batch.join(',')}` }],
      quotaKey: 'ai-ingest:job-1',
    });
    const keys = run.mock.calls.map((c) => c[3]?.quotaKey);
    expect(run.mock.calls.length).toBeGreaterThan(3);
    expect(new Set(keys)).toEqual(new Set(['ai-ingest:job-1']));

    // Sin clave explícita: una por ejecución, distinta entre cargas.
    run.mockReset();
    run.mockResolvedValue({ success: true, content: '{"rows":[]}' });
    const one = { appKey: 'app', schema: ROWS_SCHEMA, messages: [{ role: 'user' as const, content: 'x' }] };
    await service.extract(one);
    await service.extract(one);
    const [a, b] = run.mock.calls.map((c) => c[3]?.quotaKey);
    expect(a).toMatch(/^ai-ingest:/);
    expect(a).not.toBe(b);
  });

  it('toStrictJsonSchema vuelve nullable lo opcional, también en enums', () => {
    const strict = toStrictJsonSchema({
      type: 'object',
      properties: { kind: { type: 'string', enum: ['A', 'B'] } },
    });
    expect(strict).toEqual({
      type: 'object',
      properties: { kind: { type: ['string', 'null'], enum: ['A', 'B', null] } },
      required: ['kind'],
      additionalProperties: false,
    });
  });
});
