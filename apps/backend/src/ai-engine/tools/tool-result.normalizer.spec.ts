import {
  countsAsToolSuccess,
  markInProcessWriteApplied,
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
  it('P0-4: a transport-compacted result is observed, not truncated', () => {
    const envelope = {
      compaction_version: '1',
      bounded: true,
      tool: 'get_cash_session_close_report',
      block_id: 'b-1',
      has_more: true,
      complete: false,
      truncated: true,
      next_step: 'Read block_id with vex_block_read.',
    };
    for (const raw of [
      envelope,
      { schema_version: '1', status: 'ok', compacted: true, data: envelope },
    ]) {
      const result = normalizeToolResult(JSON.stringify(raw), context);
      expect(result.status).toBe('ok');
      expect(result.freshness).toBe('observed');
      expect(result.compacted).toBe(true);
      expect(result.pagination).toBeNull();
      expect(result.effect_status).toBe('not_applicable');
    }
  });
  it('P0-5: an OK browser answer to a UI command is observed, not unverified', () => {
    const result = normalizeToolResult(
      JSON.stringify({ status: 'navigated', landed_on: '/admin/caja' }),
      { ...context, clientSide: true },
    );
    expect(result.status).toBe('ok');
    expect(result.freshness).toBe('observed');
    expect(result.effect_status).toBe('not_applicable');
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
  describe('markInProcessWriteApplied (confirmed in-process write)', () => {
    const write = { ...context, write: true };
    it('a structured result without failure becomes applied evidence', () => {
      const raw = JSON.stringify({
        summary: 'Cliente creado.',
        data: { customer_id: 9 },
      });
      expect(
        normalizeToolResult(markInProcessWriteApplied(raw), write),
      ).toMatchObject({ status: 'ok', effect_status: 'applied' });
    });
    it.each([
      ['protocol error', { error: 'No existe', next_step: 'busca' }],
      ['explicit not applied', { applied: false, error: 'network failure' }],
      ['pending proposal', { requires_confirmation: true }],
      ['missing datum', { status: 'needs_user_input' }],
      ['typed envelope', { schema_version: '1', status: 'unknown_effect' }],
    ])('never stamps a %s', (_label, value) => {
      const raw = JSON.stringify(value);
      expect(markInProcessWriteApplied(raw)).toBe(raw);
    });
    it.each([
      ['toolError {error, code}', { error: 'Stock insuficiente', code: 'X_1' }],
      ['object error', { error: { reason: 'boom' }, id: 4 }],
      ['error next to data', { error: 'falló', id: 4, name: 'Pan' }],
      ['errors list', { errors: ['campo inválido'], id: 4 }],
      ['numeric error status', { status: 500, id: 4 }],
      ['string error statusCode', { statusCode: '409', id: 4 }],
      ['failure status', { status: 'FAILURE', id: 4 }],
      ['nested protocol failure', { data: { success: false, id: 4 } }],
    ])('fail-closed: never stamps a %s', (_label, value) => {
      const raw = JSON.stringify(value);
      expect(markInProcessWriteApplied(raw)).toBe(raw);
      expect(
        normalizeToolResult(markInProcessWriteApplied(raw), write)
          .effect_status,
      ).not.toBe('applied');
    });
    it('an unrecognised error shape stays unknown_effect, never applied', () => {
      const raw = JSON.stringify({ error: { reason: 'boom' }, id: 4 });
      expect(
        normalizeToolResult(markInProcessWriteApplied(raw), write),
      ).toMatchObject({
        status: 'unknown_effect',
        effect_status: 'unknown',
        retryable: false,
      });
    });
    it('{error, code} is a classified failure carrying its code', () => {
      const raw = JSON.stringify({
        error: 'Stock insuficiente',
        code: 'INV_STOCK_002',
      });
      expect(
        normalizeToolResult(markInProcessWriteApplied(raw), write),
      ).toMatchObject({
        status: 'recoverable_error',
        error_code: 'INV_STOCK_002',
        effect_status: 'not_applied',
      });
      expect(
        normalizeToolResult(
          { error: 'Sin permiso', code: 'PERMISSION_DENIED' },
          write,
        ).status,
      ).toBe('blocked');
    });
    it('a known error_code keeps its classification', () => {
      const raw = JSON.stringify({
        error: 'No existe',
        error_code: 'NOT_FOUND',
      });
      expect(markInProcessWriteApplied(raw)).toBe(raw);
      expect(normalizeToolResult(raw, write)).toMatchObject({
        status: 'recoverable_error',
        error_code: 'NOT_FOUND',
      });
    });
    it.each([
      ['null error column', { id: 5, error: null }],
      ['domain status', { id: 5, status: 'rejected' }],
      ['success flag', { success: true, id: 5 }],
    ])('a real success is still applied: %s', (_label, value) => {
      expect(
        normalizeToolResult(
          markInProcessWriteApplied(JSON.stringify(value)),
          write,
        ),
      ).toMatchObject({ status: 'ok', effect_status: 'applied' });
    });
    it('never infers application from prose', () => {
      expect(markInProcessWriteApplied('Producto creado')).toBe(
        'Producto creado',
      );
    });
    it('keeps the object shape when the handler returned an object', () => {
      expect(markInProcessWriteApplied({ id: 3 })).toEqual({
        id: 3,
        applied: true,
      });
    });
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
