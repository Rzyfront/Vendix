import {
  AILoggingService,
  APP_HEALTH_MAX_DAYS,
  VALIDATION_ERROR_MAX_CHARS,
} from './ai-logging.service';

/**
 * ia-cargas F6: the new ai_engine_logs columns are written sanitized, and the
 * per-app health board is ONE aggregate SQL query (no rows in memory).
 */
describe('AILoggingService F6 (finish_reason/attempt/validation_error + app health)', () => {
  const build = (sqlRows: unknown[] = []) => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const queryRaw = jest.fn().mockResolvedValue(sqlRows);
    const findMany = jest.fn();
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      ai_engine_logs: { create, findMany },
      $queryRaw: queryRaw,
    };
    const service = new AILoggingService(prisma as any, cache as any);
    return { service, create, queryRaw, findMany, cache };
  };

  const baseEntry = {
    app_key: 'customer_import_ocr',
    prompt_tokens: 1,
    completion_tokens: 1,
    cost_usd: 0,
    latency_ms: 1,
    status: 'success' as const,
  };

  /** SQL text of a Prisma.sql tagged query, whitespace collapsed. */
  const sqlText = (query: any): string =>
    String(query.sql ?? query.strings?.join('?')).replace(/\s+/g, ' ');

  describe('logRequest', () => {
    it('persiste finish_reason, attempt y validation_error', async () => {
      const { service, create } = build();
      await service.logRequest({
        ...baseEntry,
        finish_reason: 'length',
        attempt: 2,
        validation_error: 'schema: /rows/0/id must be integer',
      });
      expect(create.mock.calls[0][0].data).toMatchObject({
        finish_reason: 'length',
        attempt: 2,
        validation_error: 'schema: /rows/0/id must be integer',
      });
    });

    it('acota validation_error a 500 caracteres y descarta valores fuera de forma', async () => {
      const { service, create } = build();
      await service.logRequest({
        ...baseEntry,
        finish_reason: 'STOP; DROP TABLE x',
        attempt: -1,
        validation_error: `schema: ${'x'.repeat(2000)}`,
      });
      const data = create.mock.calls[0][0].data;
      expect(data.validation_error).toHaveLength(VALIDATION_ERROR_MAX_CHARS);
      expect(data.finish_reason).toBeUndefined();
      expect(data.attempt).toBeUndefined();
    });

    it('sin los campos nuevos (resto de apps) quedan vacíos', async () => {
      const { service, create } = build();
      await service.logRequest(baseEntry);
      const data = create.mock.calls[0][0].data;
      expect(data.finish_reason).toBeUndefined();
      expect(data.attempt).toBeUndefined();
      expect(data.validation_error).toBeUndefined();
    });
  });

  describe('getAppHealth', () => {
    it('agrega por app_key en SQL y calcula tasas y tokens promedio', async () => {
      const { service, queryRaw, findMany } = build([
        {
          app_key: 'customer_import_ocr',
          total_calls: BigInt(200),
          error_calls: BigInt(10),
          truncated_calls: BigInt(30),
          validation_failed_calls: BigInt(5),
          avg_prompt_tokens: '1200.4',
          avg_completion_tokens: '800.6',
        },
        {
          app_key: 'rut_scanner',
          total_calls: BigInt(3),
          error_calls: BigInt(1),
          truncated_calls: BigInt(0),
          validation_failed_calls: BigInt(0),
          avg_prompt_tokens: 100,
          avg_completion_tokens: null,
        },
      ]);

      const report = await service.getAppHealth({
        date_from: new Date('2026-11-13T00:00:00Z'),
        date_to: new Date('2026-11-20T00:00:00Z'),
      });

      // One aggregate query; rows never reach memory.
      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(findMany).not.toHaveBeenCalled();
      const sql = sqlText(queryRaw.mock.calls[0][0]);
      expect(sql).toContain('FROM ai_engine_logs');
      expect(sql).toContain('GROUP BY app_key');
      expect(sql).toContain("FILTER (WHERE finish_reason = 'length')");
      expect(sql).toContain('FILTER (WHERE validation_error IS NOT NULL)');
      expect(sql).toContain("FILTER (WHERE status = 'error')");

      expect(report.date_from).toBe('2026-11-13T00:00:00.000Z');
      expect(report.date_to).toBe('2026-11-20T00:00:00.000Z');
      expect(report.apps[0]).toEqual({
        app_key: 'customer_import_ocr',
        total_calls: 200,
        error_calls: 10,
        truncated_calls: 30,
        validation_failed_calls: 5,
        error_rate: 5,
        truncated_rate: 15,
        validation_failed_rate: 2.5,
        avg_prompt_tokens: 1200,
        avg_completion_tokens: 801,
        avg_total_tokens: 2001,
      });
      expect(report.apps[1]).toMatchObject({
        app_key: 'rut_scanner',
        error_rate: 33.3,
        truncated_rate: 0,
        avg_completion_tokens: 0,
        avg_total_tokens: 100,
      });
    });

    it('por defecto mira los últimos 7 días', async () => {
      const { service, queryRaw } = build();
      const before = Date.now();
      const report = await service.getAppHealth({});
      const from = new Date(report.date_from).getTime();
      const to = new Date(report.date_to).getTime();
      expect(to).toBeGreaterThanOrEqual(before);
      expect(to - from).toBe(7 * 24 * 60 * 60 * 1000);
      const values = queryRaw.mock.calls[0][0].values;
      expect(values).toEqual([
        new Date(report.date_from),
        new Date(report.date_to),
      ]);
    });

    it(`acota el rango a ${APP_HEALTH_MAX_DAYS} días y filtra por app_key como parámetro`, async () => {
      const { service, queryRaw } = build();
      const report = await service.getAppHealth({
        date_from: new Date('2020-01-01T00:00:00Z'),
        date_to: new Date('2026-11-20T00:00:00Z'),
        app_key: "x' OR 1=1 --",
      });
      const span =
        new Date(report.date_to).getTime() -
        new Date(report.date_from).getTime();
      expect(span).toBe(APP_HEALTH_MAX_DAYS * 24 * 60 * 60 * 1000);
      const query = queryRaw.mock.calls[0][0];
      expect(sqlText(query)).not.toContain('OR 1=1');
      expect(query.values).toContain("x' OR 1=1 --");
    });

    it('un rango invertido o fechas inválidas vuelven a 7 días hasta date_to', async () => {
      const { service } = build();
      const report = await service.getAppHealth({
        date_from: new Date('2026-12-01T00:00:00Z'),
        date_to: new Date('2026-11-20T00:00:00Z'),
      });
      expect(report.date_from).toBe('2026-11-13T00:00:00.000Z');
      const invalid = await service.getAppHealth({
        date_from: new Date('nope'),
      });
      const span =
        new Date(invalid.date_to).getTime() -
        new Date(invalid.date_from).getTime();
      expect(span).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('sin llamadas devuelve una lista vacía (sin dividir por cero)', async () => {
      const { service } = build([]);
      const report = await service.getAppHealth({});
      expect(report.apps).toEqual([]);
    });
  });
});
