import {
  ToolExecutionReceipt,
  ToolExecutionResult,
  ToolExecutionStatus,
} from './interfaces/tool.interface';

export interface ToolResultContext {
  write?: boolean;
  clientSide?: boolean;
  evidenceRef?: string;
  handlerStarted?: boolean;
  truncated?: boolean;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const ACTIONS: Record<ToolExecutionStatus, string | null> = {
  ok: null,
  recoverable_error:
    'Comprueba el identificador o los datos requeridos antes de volver a intentarlo.',
  blocked:
    'Puedes solicitar a un administrador que revise los permisos o el plan; no se aplicó el cambio.',
  pending_confirmation: 'Revisa y aprueba la propuesta para aplicar el cambio.',
  needs_user_input: 'Indica el dato o la opción que falta para continuar.',
  unknown_effect:
    'Verifica el estado actual del registro antes de intentar otro cambio. No repetiré la escritura.',
};

function result(
  status: ToolExecutionStatus,
  data: unknown,
  context: ToolResultContext,
  errorCode: string | null = null,
): ToolExecutionResult {
  return {
    schema_version: '1',
    status,
    data,
    error_code: errorCode,
    retryable: status === 'recoverable_error',
    next_action: ACTIONS[status],
    evidence_refs: [],
    resource_ids: {},
    pagination: null,
    freshness: 'unknown',
    effect_status:
      status === 'unknown_effect'
        ? 'unknown'
        : status === 'pending_confirmation'
          ? 'pending'
          : context.write
            ? 'not_applied'
            : 'not_applicable',
  };
}

/** Only structured codes/statuses, not a substring search over business text. */
function classify(code: string, status?: number): ToolExecutionStatus {
  if (
    status === 401 ||
    status === 403 ||
    /^(SUBSCRIPTION_|PLAN_|TRIAL_)/.test(code) ||
    [
      'AI_AGENT_004',
      'AI_AGENT_TOOL_NOT_ALLOWED',
      'FORBIDDEN',
      'PERMISSION_DENIED',
    ].includes(code)
  )
    return 'blocked';
  return 'recoverable_error';
}

export function normalizeToolResult(
  raw: unknown,
  context: ToolResultContext = {},
): ToolExecutionResult {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      /* Preserve unclassifiable legacy text. */
    }
  }
  const outer = object(value);
  const envelope =
    outer &&
    typeof outer.tool === 'string' &&
    typeof outer.version === 'string';
  const data = envelope && 'data' in outer! ? outer!.data : value;
  const body = object(data);
  const candidate = body ?? outer;
  const typed =
    outer?.schema_version === '1' && typeof outer.status === 'string';
  const states: ToolExecutionStatus[] = [
    'ok',
    'recoverable_error',
    'blocked',
    'pending_confirmation',
    'needs_user_input',
    'unknown_effect',
  ];
  // Recognise error envelopes only at protocol boundaries. A domain record's
  // arbitrary `error` column does not make its successful read an API failure.
  const protocolError = (item: Record<string, unknown> | null): boolean =>
    !!item &&
    (item.success === false ||
      item.ok === false ||
      item.applied === false ||
      (typeof item.statusCode === 'number' && item.statusCode >= 400) ||
      (typeof item.error === 'string' &&
        (typeof item.next_step === 'string' ||
          typeof item.error_code === 'string' ||
          Object.keys(item).every((k) =>
            ['error', 'message', 'detail', 'note', 'tool', 'version'].includes(
              k,
            ),
          ))) ||
      [
        'error',
        'failed',
        'not_found',
        'blocked',
        'forbidden',
        'redirected',
        'no_refresh_available',
      ].includes(String(item.status)));
  const failure = protocolError(outer)
    ? outer
    : protocolError(body)
      ? body
      : null;
  let status: ToolExecutionStatus =
    typed && states.includes(outer!.status as ToolExecutionStatus)
      ? (outer!.status as ToolExecutionStatus)
      : 'ok';
  let code =
    typeof candidate?.error_code === 'string' ? candidate.error_code : null;
  if (candidate?.result_unknown === true) status = 'unknown_effect';
  else if (
    candidate?.requires_confirmation === true ||
    candidate?.pending_confirmation === true ||
    candidate?.status === 'pending_confirmation'
  )
    status = 'pending_confirmation';
  else if (
    candidate?.status === 'needs_user_input' ||
    candidate?.needs_user_input === true
  )
    status = 'needs_user_input';
  else if (failure) {
    code =
      typeof failure.error_code === 'string'
        ? failure.error_code
        : failure.status === 'not_found' || failure.statusCode === 404
          ? 'NOT_FOUND'
          : 'TOOL_BUSINESS_ERROR';
    const httpStatus =
      Number(failure.statusCode ?? failure.status) || undefined;
    status = classify(
      code,
      httpStatus ||
        (['blocked', 'forbidden'].includes(String(failure.status))
          ? 403
          : undefined),
    );
    if (context.write && !httpStatus && code === 'TOOL_BUSINESS_ERROR')
      status = 'unknown_effect';
  }
  // The generic bridge historically wraps an HTTP200 success:false body in
  // applied:true. Inspect this known transport boundary, never arbitrary nested
  // domain fields, and treat contradictory application claims as uncertain.
  if (candidate?.applied === true) {
    let responseBody = candidate.data;
    if (typeof responseBody === 'string') {
      try {
        responseBody = JSON.parse(responseBody);
      } catch {
        /* Not an envelope. */
      }
    }
    if (protocolError(object(responseBody))) status = 'unknown_effect';
  }
  const normalized = result(status, typed ? outer!.data : data, context, code);
  const next = candidate?.next_action ?? candidate?.next_step;
  if (typeof next === 'string' && next.trim()) normalized.next_action = next;
  const structured = value !== null && typeof value === 'object';
  const truncated =
    context.truncated ||
    candidate?.truncated === true ||
    candidate?.freshness === 'truncated';
  normalized.freshness = truncated
    ? 'truncated'
    : typed && candidate?.freshness === 'unknown'
      ? 'unknown'
      : structured
        ? 'observed'
        : 'unknown';
  if (normalized.freshness === 'observed' && context.evidenceRef)
    normalized.evidence_refs = [context.evidenceRef];
  // Resource IDs are copied only from explicit protocol metadata or a top-level
  // record. Never collect nested IDs from arbitrary payloads or infer them in prose.
  const ids = object(candidate?.resource_ids);
  for (const [key, id] of Object.entries(ids ?? {})) {
    if (typeof id === 'string' || typeof id === 'number')
      normalized.resource_ids[key] = id;
  }
  if (
    candidate &&
    (typeof candidate.id === 'string' || typeof candidate.id === 'number')
  )
    normalized.resource_ids.id = candidate.id;
  const page = object(candidate?.pagination);
  if (page) {
    const cursor = page.next_cursor;
    normalized.pagination = {
      ...(typeof cursor === 'string' ||
      typeof cursor === 'number' ||
      cursor === null
        ? { next_cursor: cursor }
        : {}),
      ...(typeof page.has_more === 'boolean'
        ? { has_more: page.has_more }
        : {}),
      complete:
        !truncated &&
        page.complete === true &&
        page.has_more !== true &&
        cursor == null,
    };
  }
  if (normalized.status === 'ok') {
    if (context.write) {
      if (
        candidate?.applied === true ||
        (typed && candidate?.effect_status === 'applied')
      )
        normalized.effect_status = 'applied';
      else {
        normalized.status = 'unknown_effect';
        normalized.effect_status = 'unknown';
        normalized.retryable = false;
        normalized.next_action = ACTIONS.unknown_effect;
      }
    } else
      normalized.effect_status =
        context.clientSide ||
        !structured ||
        truncated ||
        (typed && candidate?.effect_status === 'unverified')
          ? 'unverified'
          : 'not_applicable';
    if (!structured || truncated)
      normalized.next_action =
        'El resultado no constituye evidencia completa. Verifica el registro o consulta la siguiente página antes de darlo por terminado.';
  }
  if (normalized.status !== 'recoverable_error') normalized.retryable = false;
  else if (typed && candidate?.retryable === false)
    normalized.retryable = false;
  return normalized;
}

export function normalizeToolException(
  error: unknown,
  context: ToolResultContext = {},
): ToolExecutionResult {
  const err = error as {
    getResponse?: () => unknown;
    getStatus?: () => number;
    code?: string;
    status?: number;
  };
  const payload = object(err?.getResponse?.());
  const status = err?.getStatus?.() ?? err?.status;
  const code =
    typeof payload?.error_code === 'string'
      ? payload.error_code
      : (err?.code ?? 'AI_TOOL_INFRASTRUCTURE_ERROR');
  // A thrown timeout/5xx after entering a write handler may have committed.
  // Confirmation/permission/validation failures before it cannot have done so.
  const uncertain =
    context.write &&
    context.handlerStarted &&
    (!status || status >= 500 || status === 408 || status === 504);
  const normalized = result(
    uncertain ? 'unknown_effect' : classify(code, status),
    null,
    context,
    status === 404 ? 'NOT_FOUND' : status === 400 ? 'INVALID_ARGS' : code,
  );
  if (status === 404)
    normalized.next_action =
      'No encontré ese registro. Indica otro identificador o confirma si deseas crear uno mediante una propuesta.';
  return normalized;
}

export function toolReceipt(result: ToolExecutionResult): ToolExecutionReceipt {
  const { data: _data, ...receipt } = result;
  return receipt;
}

export function countsAsToolSuccess(result: ToolExecutionResult): boolean {
  return (
    result.status === 'ok' &&
    result.freshness === 'observed' &&
    result.evidence_refs.length > 0 &&
    ['not_applicable', 'applied'].includes(result.effect_status)
  );
}
