import {
  CODEMODE_PROTOCOL,
  CodeModeError,
  CodeModeGuestErrorCode,
  CodeModeJson,
  CodeModePendingCall,
  CodeModeRoundRequest,
  codeModeCanonicalJson,
} from './interfaces/codemode-protocol.interface';

/**
 * F10 (T64): everything the Lambda returns is untrusted. This validator is the
 * only place a Lambda body becomes a typed value. The response has NO journal
 * field: the host journal lives in server memory and is never read back from
 * the Lambda, so any journal-like (or otherwise unknown) key is a protocol
 * error.
 */
export type ValidatedRound =
  | {
      status: 'pending';
      pending: CodeModePendingCall[];
      logs: string[];
    }
  | {
      status: 'completed';
      result: CodeModeJson;
      result_truncated: boolean;
      blocks: CodeModeJson[];
      logs: string[];
    }
  | {
      status: 'error';
      error_code: CodeModeGuestErrorCode;
      error_message?: string;
      logs: string[];
    };

const NONCE = /^[a-f0-9]{64}$/;
const TOOL = /^[a-z][a-z0-9_]{0,79}$/;
const MAX_MESSAGE = 300;
const MAX_DEPTH = 32;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const GUEST_CODES: ReadonlySet<string> = new Set<CodeModeGuestErrorCode>([
  'CODEMODE_INPUT',
  'CODEMODE_SYNTAX',
  'CODEMODE_RUNTIME',
  'CODEMODE_TIMEOUT',
  'CODEMODE_MEMORY',
  'CODEMODE_STALLED',
  'CODEMODE_REPLAY_DIVERGENCE',
  'CODEMODE_LIMIT',
  'CODEMODE_OUTPUT',
]);
const COMMON = ['protocol', 'execution_id', 'nonce', 'round', 'runtime_digest', 'status', 'logs', 'usage'];
const BY_STATUS: Record<string, { required: string[]; optional: string[] }> = {
  pending: { required: ['pending'], optional: [] },
  completed: { required: ['result'], optional: ['blocks'] },
  error: { required: ['error_code'], optional: ['error_message'] },
};

const protocol = (detail: string): never => {
  throw new CodeModeError('CODEMODE_PROTOCOL', detail);
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Plain JSON only: no accessors, prototype keys, non-finite numbers, deep nesting. */
function assertJson(value: unknown, depth = 0): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) protocol('non-finite number');
    return;
  }
  if (typeof value !== 'object' || depth > MAX_DEPTH) return protocol('not plain JSON');
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, depth + 1);
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_KEYS.has(key)) protocol('forbidden key');
    assertJson((value as Record<string, unknown>)[key], depth + 1);
  }
}

function cleanText(value: string, max: number): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .trim()
      .slice(0, max)
  );
}

/** Cuts the serialized value on a UTF-8 boundary so the result stays valid text. */
function truncateSerialized(json: string, maxBytes: number): string {
  const buffer = Buffer.from(json, 'utf8').subarray(0, Math.max(0, maxBytes));
  let text = buffer.toString('utf8');
  while (text.endsWith('�')) text = text.slice(0, -1);
  return text;
}

function validatePending(
  raw: unknown,
  request: CodeModeRoundRequest,
): CodeModePendingCall[] {
  const limits = request.limits;
  if (
    !Array.isArray(raw) ||
    raw.length < 1 ||
    raw.length > limits.pending_per_round
  )
    protocol('pending size');
  const calls = raw as unknown[];
  return calls.map((entry, index) => {
    if (
      !isObject(entry) ||
      Object.keys(entry).sort().join(',') !== 'args,seq,tool'
    )
      return protocol('pending keys');
    const seq = entry.seq;
    if (!Number.isSafeInteger(seq) || seq !== request.journal.length + 1 + index)
      protocol('pending seq');
    if (
      typeof entry.tool !== 'string' ||
      !TOOL.test(entry.tool) ||
      !request.manifest.includes(entry.tool)
    )
      protocol('pending tool');
    if (!isObject(entry.args)) protocol('pending args');
    assertJson(entry.args);
    if (
      Buffer.byteLength(codeModeCanonicalJson(entry.args), 'utf8') >
      limits.args_bytes
    )
      protocol('pending args size');
    return {
      seq: seq as number,
      tool: entry.tool as string,
      args: entry.args as CodeModePendingCall['args'],
    };
  });
}

export function validateCodeModeResponse(
  raw: unknown,
  request: CodeModeRoundRequest,
  runtimeDigest: string,
): ValidatedRound {
  if (!isObject(raw)) return protocol('body is not an object');
  const limits = request.limits;
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > limits.output_bytes)
    protocol('body too large');
  const spec = BY_STATUS[String(raw.status)];
  if (!spec) return protocol('status');
  const allowed = new Set([...COMMON, ...spec.required, ...spec.optional]);
  for (const key of Object.keys(raw))
    if (!allowed.has(key))
      protocol(/journal/i.test(key) ? 'journal field is not accepted' : 'unknown key');
  for (const key of spec.required) if (!(key in raw)) protocol(`missing ${key}`);
  if (
    raw.protocol !== CODEMODE_PROTOCOL ||
    raw.execution_id !== request.execution_id ||
    typeof raw.nonce !== 'string' ||
    !NONCE.test(raw.nonce) ||
    raw.nonce !== request.nonce ||
    raw.round !== request.round ||
    raw.runtime_digest !== runtimeDigest
  )
    protocol('echo mismatch');

  let logs: string[] = [];
  if (raw.logs !== undefined) {
    if (!Array.isArray(raw.logs) || raw.logs.some((l) => typeof l !== 'string'))
      protocol('logs');
    logs = raw.logs as string[];
    if (
      logs.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8'), 0) >
      limits.log_bytes
    )
      protocol('logs too large');
  }
  if (raw.usage !== undefined) {
    const usage = raw.usage;
    if (
      !isObject(usage) ||
      typeof usage.duration_ms !== 'number' ||
      Object.entries(usage).some(
        ([key, value]) =>
          !['duration_ms', 'cpu_ms', 'max_rss_mb'].includes(key) ||
          typeof value !== 'number' ||
          !Number.isFinite(value),
      )
    )
      protocol('usage');
  }

  if (raw.status === 'pending')
    return { status: 'pending', pending: validatePending(raw.pending, request), logs };

  if (raw.status === 'completed') {
    assertJson(raw.result);
    const blocks = raw.blocks === undefined ? [] : raw.blocks;
    if (
      !Array.isArray(blocks) ||
      blocks.length > limits.blocks ||
      blocks.some((block) => !isObject(block))
    )
      protocol('blocks');
    assertJson(blocks);
    const serialized = codeModeCanonicalJson(raw.result);
    const truncated = Buffer.byteLength(serialized, 'utf8') > limits.result_bytes;
    return {
      status: 'completed',
      result: truncated
        ? truncateSerialized(serialized, limits.result_bytes)
        : (raw.result as CodeModeJson),
      result_truncated: truncated,
      blocks: blocks as CodeModeJson[],
      logs,
    };
  }

  if (typeof raw.error_code !== 'string' || !GUEST_CODES.has(raw.error_code))
    protocol('error code');
  if (raw.error_message !== undefined && typeof raw.error_message !== 'string')
    protocol('error message');
  const message =
    typeof raw.error_message === 'string'
      ? cleanText(raw.error_message, MAX_MESSAGE) || undefined
      : undefined;
  return {
    status: 'error',
    error_code: raw.error_code as CodeModeGuestErrorCode,
    ...(message ? { error_message: message } : {}),
    logs,
  };
}
