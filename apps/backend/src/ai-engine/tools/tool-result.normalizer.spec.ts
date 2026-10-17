import {
  countsAsToolSuccess,
  normalizeToolException,
  normalizeToolResult,
} from './tool-result.normalizer';
import { ToolRecovery } from './tool-recovery';
import { ErrorCodes, VendixHttpException } from '../../common/errors';

describe('D0 tool execution normalization', () => {
  const context = { evidenceRef: 'tool_call:qa-1' };
  it('unwraps the versioned success envelope without claiming objective verification', () => {
    const result = normalizeToolResult(
      JSON.stringify({
        tool: 'get_order',
        version: '1',
        data: { id: 'O-QA1' },
      }),
      context,
    );
    expect(result).toMatchObject({
      status: 'ok',
      data: { id: 'O-QA1' },
      resource_ids: { id: 'O-QA1' },
      effect_status: 'not_applicable',
    });
    expect(countsAsToolSuccess(result)).toBe(true);
    expect(result).not.toHaveProperty('verified');
  });
  it.each([
    { error: 'No encontrado', next_step: 'Indica otro documento.' },
    {
      tool: 'get_supplier',
      version: '1',
      error: 'No encontrado',
      next_step: 'Indica otro documento.',
    },
    { statusCode: 200, success: false, message: 'Rechazado' },
    {
      tool: 'bridge',
      version: '1',
      data: { success: false, message: 'Rechazado' },
    },
    { ok: false },
  ])('a resolved failure never consumes successful tool quota: %j', (raw) => {
    const result = normalizeToolResult(raw, context);
    expect(result.status).toBe('recoverable_error');
    expect(countsAsToolSuccess(result)).toBe(false);
    expect(result.next_action).toBeTruthy();
  });
  it('does not treat an arbitrary business error field as a technical exception', () => {
    expect(
      normalizeToolResult(
        { id: 9, error: 'Error de impresión registrado', total: 3 },
        context,
      ).status,
    ).toBe('ok');
  });
  it.each(['pending_confirmation', 'needs_user_input'])(
    '%s is not failure or success quota',
    (status) => {
      const result = normalizeToolResult({ status }, context);
      expect(result.status).toBe(status);
      expect(result.retryable).toBe(false);
      expect(countsAsToolSuccess(result)).toBe(false);
    },
  );
  it('a proposal is pending even though applied is false', () => {
    expect(
      normalizeToolResult(
        { applied: false, requires_confirmation: true },
        { write: true },
      ).status,
    ).toBe('pending_confirmation');
  });
  it('unknown UI result and redirected UI never become success', () => {
    expect(
      normalizeToolResult({ result_unknown: true }, { clientSide: true })
        .status,
    ).toBe('unknown_effect');
    expect(
      normalizeToolResult({ status: 'redirected' }, { clientSide: true })
        .status,
    ).toBe('recoverable_error');
  });
  it.each(['Ya quedó', '{"status":"ok","data":', ''])(
    'preserves ambiguous/truncated legacy text, without evidence: %s',
    (text) => {
      const result = normalizeToolResult(text, context);
      expect(result.data).toBe(text);
      expect(result.freshness).toBe('unknown');
      expect(result.evidence_refs).toEqual([]);
      expect(result.effect_status).toBe('unverified');
      expect(countsAsToolSuccess(result)).toBe(false);
    },
  );
  it('truncation and incomplete cursors cannot certify a complete dataset', () => {
    const result = normalizeToolResult(
      {
        data: [1],
        truncated: true,
        pagination: { complete: true, has_more: true, next_cursor: 'p2' },
      },
      context,
    );
    expect(result.pagination).toMatchObject({
      complete: false,
      next_cursor: 'p2',
    });
    expect(result.evidence_refs).toEqual([]);
    expect(countsAsToolSuccess(result)).toBe(false);
  });
  it('requires explicit application evidence for writes, not HTTP200/success', () => {
    expect(
      normalizeToolResult({ success: true, id: 8 }, { ...context, write: true })
        .status,
    ).toBe('unknown_effect');
    expect(
      normalizeToolResult(
        { applied: true, id: 8 },
        { ...context, write: true },
      ),
    ).toMatchObject({ status: 'ok', effect_status: 'applied' });
  });
  it('bridge network failures and contradictory HTTP200 application claims are uncertain', () => {
    expect(
      normalizeToolResult(
        { applied: false, error: 'network failure' },
        { write: true },
      ).status,
    ).toBe('unknown_effect');
    expect(
      normalizeToolResult(
        { applied: true, data: '{"success":false,"statusCode":200}' },
        { write: true },
      ).status,
    ).toBe('unknown_effect');
    expect(
      normalizeToolResult({ applied: false, status: 403 }, { write: true })
        .status,
    ).toBe('blocked');
  });
  it('normalization is stable across the registry/loop JSON boundary', () => {
    for (const raw of [
      'Ya quedó',
      { truncated: true },
      { applied: true, id: 1 },
      { result_unknown: true },
    ]) {
      const write = typeof raw === 'object' && 'applied' in raw;
      const first = normalizeToolResult(raw, { ...context, write });
      const second = normalizeToolResult(JSON.stringify(first), {
        ...context,
        write,
      });
      expect(second).toEqual(first);
    }
  });
  it.each([401, 403])('permissions %d never retry', (status) => {
    const result = normalizeToolException({ status });
    expect(result.status).toBe('blocked');
    expect(result.retryable).toBe(false);
  });
  it('subscription denial never retries, even inside a write', () => {
    const result = normalizeToolException(
      new VendixHttpException(ErrorCodes.SUBSCRIPTION_006),
      { write: true, handlerStarted: true },
    );
    expect(result.status).toBe('blocked');
  });
  it.each([408, 500, 504, undefined])(
    'write failure after handler start is uncertain: %s',
    (status) => {
      const result = normalizeToolException(
        { status, code: 'ETIMEDOUT' },
        { write: true, handlerStarted: true },
      );
      expect(result).toMatchObject({
        status: 'unknown_effect',
        retryable: false,
        effect_status: 'unknown',
      });
    },
  );
  it('not_found/invalid_args/read infrastructure are recoverable but distinct', () => {
    expect(normalizeToolException({ status: 404 }).error_code).toBe(
      'NOT_FOUND',
    );
    expect(normalizeToolException({ status: 400 }).error_code).toBe(
      'INVALID_ARGS',
    );
    expect(normalizeToolException({ status: 503 }).error_code).toBe(
      'AI_TOOL_INFRASTRUCTURE_ERROR',
    );
  });
});

describe('D0 bounded recovery', () => {
  it('successful correction releases unrelated next pages but remembers failed identical args', () => {
    const recovery = new ToolRecovery();
    recovery.record(
      'list_orders',
      { page: 0 },
      normalizeToolResult({ error: 'invalid', next_step: 'Usa página 1.' }),
    );
    expect(recovery.beforeCall('list_orders', { page: 1 })).toBeNull();
    recovery.record(
      'list_orders',
      { page: 1 },
      normalizeToolResult({ items: [] }),
    );
    expect(recovery.beforeCall('list_orders', { page: 2 })).toBeNull();
    expect(recovery.beforeCall('list_orders', { page: 0 })).not.toBeNull();
  });
  it('suppresses equivalent args despite key order and allows only one changed correction', () => {
    const recovery = new ToolRecovery();
    const failure = normalizeToolResult({
      error: 'Campos',
      error_code: 'INVALID_ARGS',
      next_step: 'Corrige el id.',
    });
    recovery.record('get_order', { a: 1, b: 2 }, failure);
    expect(recovery.beforeCall('get_order', { b: 2, a: 1 })).not.toBeNull();
    expect(recovery.beforeCall('get_order', { a: 2 })).toBeNull();
    recovery.record('get_order', { a: 2 }, failure);
    expect(recovery.beforeCall('get_order', { a: 3 })).not.toBeNull();
  });
  it.each(['unknown_effect', 'blocked'] as const)(
    'never retries %s, not even with new args',
    (status) => {
      const recovery = new ToolRecovery();
      recovery.record(
        'write_order',
        { id: 1 },
        { ...normalizeToolResult('legacy'), status },
      );
      expect(recovery.beforeCall('write_order', { id: 2 })?.status).toBe(
        status,
      );
    },
  );
});
