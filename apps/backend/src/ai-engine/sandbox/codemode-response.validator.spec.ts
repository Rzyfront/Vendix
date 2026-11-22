import {
  CODEMODE_LIMITS,
  CODEMODE_PROTOCOL,
  CodeModeError,
  CodeModeRoundRequest,
} from './interfaces/codemode-protocol.interface';
import { validateCodeModeResponse } from './codemode-response.validator';

const DIGEST = `sha256:${'b'.repeat(64)}`;
const NONCE = 'c'.repeat(64);

const request = (over: Partial<CodeModeRoundRequest> = {}): CodeModeRoundRequest => ({
  protocol: CODEMODE_PROTOCOL,
  execution_id: 'e-1',
  nonce: NONCE,
  round: 2,
  language: 'javascript',
  source: 'return 1;',
  manifest: ['list_products', 'list_orders'],
  journal: [
    {
      seq: 1,
      tool: 'list_products',
      args_hash: 'a'.repeat(64),
      outcome: { ok: true, value: null },
    },
  ],
  clock_ms: 1,
  seed: 'd'.repeat(64),
  limits: { ...CODEMODE_LIMITS },
  ...over,
});
const base = (over: Record<string, unknown> = {}) => ({
  protocol: CODEMODE_PROTOCOL,
  execution_id: 'e-1',
  nonce: NONCE,
  round: 2,
  runtime_digest: DIGEST,
  ...over,
});
const pending = (over: Record<string, unknown> = {}) =>
  base({
    status: 'pending',
    pending: [{ seq: 2, tool: 'list_orders', args: { page: 1 } }],
    ...over,
  });
const completed = (over: Record<string, unknown> = {}) =>
  base({ status: 'completed', result: { total: 3 }, ...over });
const check = (raw: unknown, req = request()) =>
  validateCodeModeResponse(raw, req, DIGEST);
const protocolError = (raw: unknown, req = request()) => {
  try {
    check(raw, req);
  } catch (error) {
    expect(error).toBeInstanceOf(CodeModeError);
    return (error as CodeModeError).code;
  }
  throw new Error('expected a CodeModeError');
};

describe('codemode response validator (Lambda output is untrusted)', () => {
  it('accepts a well formed pending / completed / error body', () => {
    expect(check(pending())).toMatchObject({
      status: 'pending',
      pending: [{ seq: 2, tool: 'list_orders', args: { page: 1 } }],
    });
    expect(check(completed({ logs: ['hi'], blocks: [{ type: 'table' }] }))).toMatchObject({
      status: 'completed',
      result: { total: 3 },
      result_truncated: false,
      logs: ['hi'],
      blocks: [{ type: 'table' }],
    });
    expect(
      check(base({ status: 'error', error_code: 'CODEMODE_RUNTIME', error_message: 'boom' })),
    ).toMatchObject({ status: 'error', error_code: 'CODEMODE_RUNTIME', error_message: 'boom' });
  });

  it('treats ANY journal-like field as a protocol error and never reads it', () => {
    for (const key of ['journal', 'journal_entries', 'outcomes']) {
      expect(protocolError(pending({ [key]: [{ seq: 2 }] }))).toBe('CODEMODE_PROTOCOL');
      expect(protocolError(completed({ [key]: [] }))).toBe('CODEMODE_PROTOCOL');
    }
  });

  it('rejects unknown keys and keys that belong to another status', () => {
    expect(protocolError(pending({ extra: 1 }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ result: 1 }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(completed({ pending: [] }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(base({ status: 'error', error_code: 'CODEMODE_RUNTIME', result: 1 }))).toBe(
      'CODEMODE_PROTOCOL',
    );
    expect(protocolError(pending({ pending: [{ seq: 2, tool: 'list_orders', args: {}, args_hash: 'x' }] }))).toBe(
      'CODEMODE_PROTOCOL',
    );
  });

  it('requires the exact echo of protocol, execution_id, nonce, round and the configured digest', () => {
    expect(protocolError(pending({ protocol: 'vendix.codemode/v2' }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ execution_id: 'other' }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ nonce: 'e'.repeat(64) }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ round: 3 }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ runtime_digest: `sha256:${'f'.repeat(64)}` }))).toBe(
      'CODEMODE_PROTOCOL',
    );
    expect(protocolError('nope')).toBe('CODEMODE_PROTOCOL');
    expect(protocolError([])).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ status: 'weird' }))).toBe('CODEMODE_PROTOCOL');
  });

  it('bounds pending calls: 1..pending_per_round, contiguous seq after the journal, manifest tools, plain args', () => {
    expect(protocolError(pending({ pending: [] }))).toBe('CODEMODE_PROTOCOL');
    const many = Array.from({ length: CODEMODE_LIMITS.pending_per_round + 1 }, (_, i) => ({
      seq: i + 2,
      tool: 'list_orders',
      args: {},
    }));
    expect(protocolError(pending({ pending: many }))).toBe('CODEMODE_PROTOCOL');
    // journal.length = 1 -> first pending seq must be 2
    expect(protocolError(pending({ pending: [{ seq: 1, tool: 'list_orders', args: {} }] }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ pending: [{ seq: 3, tool: 'list_orders', args: {} }] }))).toBe('CODEMODE_PROTOCOL');
    expect(
      protocolError(
        pending({
          pending: [
            { seq: 2, tool: 'list_orders', args: {} },
            { seq: 4, tool: 'list_orders', args: {} },
          ],
        }),
      ),
    ).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ pending: [{ seq: 2, tool: 'delete_everything', args: {} }] }))).toBe(
      'CODEMODE_PROTOCOL',
    );
    expect(protocolError(pending({ pending: [{ seq: 2, tool: 'list_orders', args: [] }] }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(pending({ pending: [{ seq: 2, tool: 'list_orders', args: null }] }))).toBe(
      'CODEMODE_PROTOCOL',
    );
    const huge = { q: 'x'.repeat(CODEMODE_LIMITS.args_bytes) };
    expect(protocolError(pending({ pending: [{ seq: 2, tool: 'list_orders', args: huge }] }))).toBe(
      'CODEMODE_PROTOCOL',
    );
    const proto = JSON.parse('{"__proto__":{"x":1}}');
    expect(protocolError(pending({ pending: [{ seq: 2, tool: 'list_orders', args: proto }] }))).toBe(
      'CODEMODE_PROTOCOL',
    );
  });

  it('truncates an oversized result safely and flags it', () => {
    const big = completed({ result: { rows: 'é'.repeat(CODEMODE_LIMITS.result_bytes) } });
    const out = check(big) as { result: unknown; result_truncated: boolean };
    expect(out.result_truncated).toBe(true);
    expect(typeof out.result).toBe('string');
    expect(Buffer.byteLength(out.result as string)).toBeLessThanOrEqual(CODEMODE_LIMITS.result_bytes);
    expect(out.result as string).not.toContain('�');
    expect((check(completed({ result: null })) as { result: unknown }).result).toBeNull();
    expect(protocolError(base({ status: 'completed' }))).toBe('CODEMODE_PROTOCOL');
  });

  it('bounds logs, blocks and the whole body', () => {
    expect(protocolError(completed({ logs: ['x'.repeat(CODEMODE_LIMITS.log_bytes + 1)] }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(completed({ logs: [1] }))).toBe('CODEMODE_PROTOCOL');
    const blocks = Array.from({ length: CODEMODE_LIMITS.blocks + 1 }, () => ({ type: 'table' }));
    expect(protocolError(completed({ blocks }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(completed({ blocks: ['not-an-object'] }))).toBe('CODEMODE_PROTOCOL');
    const small = request({ limits: { ...CODEMODE_LIMITS, output_bytes: 200 } });
    expect(protocolError(completed({ logs: ['x'.repeat(300)] }), small)).toBe('CODEMODE_PROTOCOL');
  });

  it('only accepts guest error codes and bounds the message', () => {
    expect(protocolError(base({ status: 'error', error_code: 'CODEMODE_UNAVAILABLE' }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(base({ status: 'error', error_code: 'whatever' }))).toBe('CODEMODE_PROTOCOL');
    expect(protocolError(base({ status: 'error' }))).toBe('CODEMODE_PROTOCOL');
    const long = check(
      base({ status: 'error', error_code: 'CODEMODE_SYNTAX', error_message: `a\u0000b${'z'.repeat(900)}` }),
    ) as { error_message: string };
    expect(long.error_message.length).toBeLessThanOrEqual(300);
    expect(long.error_message).not.toContain('\u0000');
  });
});
