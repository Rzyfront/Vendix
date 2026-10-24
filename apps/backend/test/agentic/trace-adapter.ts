import { EvalReceipt, EvalSpan, ProviderAttempt } from './contracts';
import { UUID } from './graders';

/** Shape of the additive trace table; deliberately no Prisma/DB import in the offline harness. */
export interface PersistedTraceRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  objective_id: string | null;
  turn_id: string | null;
  provider_call_id: string | null;
  attempt_id: string | null;
  tool_call_id?: string | null;
  organization_id: number | null;
  store_id: number | null;
  user_id: number | null;
  scope_kind: string;
  kind: string;
  started_at: string | Date;
  ended_at: string | Date | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_usd: number | string | { toString(): string } | null;
  duration_ms?: number | null;
}

/** Only structural telemetry is mapped. No trace status/AIResponse.success proves a postcondition. */
export function mapPersistedTrace(
  rows: PersistedTraceRow[],
  options: {
    promptTokenSemantics:
      | 'fresh_only'
      | 'includes_cache_read'
      | 'includes_cache_read_and_create'
      | 'unknown';
  } = { promptTokenSemantics: 'unknown' },
): Pick<
  EvalReceipt,
  'traceId' | 'objectiveId' | 'turnId' | 'spans' | 'providerAttempts'
> {
  const root = rows.find((row) => row.kind === 'root');
  if (
    !root ||
    !UUID.test(root.trace_id) ||
    (root.objective_id !== null && !UUID.test(root.objective_id)) ||
    !UUID.test(root.turn_id ?? '')
  ) {
    throw new Error('Missing complete root correlation');
  }
  if (
    rows.some(
      (row) =>
        row.trace_id !== root.trace_id ||
        row.scope_kind !== 'tenant' ||
        row.organization_id !== root.organization_id ||
        row.store_id !== root.store_id ||
        row.user_id !== root.user_id,
    )
  ) {
    throw new Error('Mixed/system tenant scope is not an evaluation trace');
  }
  const acceptedKinds = new Set([
    'root',
    'router',
    'context',
    'provider_request',
    'provider_attempt',
    'retry',
    'closing_inference',
    'tool',
    'ui_wait',
    'approval_wait',
    'verifier',
  ]);
  const runtimeKinds: Record<string, EvalSpan['kind']> = {
    provider_call: 'provider_request',
    provider_retry: 'retry',
    UI_wait: 'ui_wait',
  };
  const spans: EvalSpan[] = rows.map((row) => {
    const kind = runtimeKinds[row.kind] ?? row.kind;
    if (!acceptedKinds.has(kind))
      throw new Error('Unknown span kind; update explicit adapter mapping');
    const startedAtMs = new Date(row.started_at).getTime();
    const endedAtMs =
      row.ended_at === null ? null : new Date(row.ended_at).getTime();
    if (
      !Number.isFinite(startedAtMs) ||
      (endedAtMs !== null && !Number.isFinite(endedAtMs))
    )
      throw new Error('Invalid trace timestamp');
    return {
      spanId: row.span_id,
      parentSpanId: row.parent_span_id,
      kind: kind as EvalSpan['kind'],
      providerCallId: row.provider_call_id ?? undefined,
      attemptId: row.attempt_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      transportDurationMs:
        typeof row.duration_ms === 'number' &&
        Number.isFinite(row.duration_ms) &&
        row.duration_ms >= 0
          ? row.duration_ms
          : undefined,
      startedAtMs,
      endedAtMs,
    };
  });
  const providerAttempts: ProviderAttempt[] = rows
    .filter((row) => row.kind === 'provider_attempt')
    .map((row) => {
      if (
        !UUID.test(row.attempt_id ?? '') ||
        !UUID.test(row.provider_call_id ?? '')
      )
        throw new Error('Incomplete provider attempt correlation');
      const costUsd =
        row.cost_usd === null ? null : Number(row.cost_usd.toString());
      if (costUsd !== null && (!Number.isFinite(costUsd) || costUsd < 0))
        throw new Error('Invalid persisted attempt cost');
      let inputTokens: number | null = null;
      if (options.promptTokenSemantics === 'fresh_only')
        inputTokens = row.prompt_tokens;
      if (
        options.promptTokenSemantics === 'includes_cache_read' &&
        row.prompt_tokens !== null &&
        row.cache_read_tokens !== null
      ) {
        inputTokens = row.prompt_tokens - row.cache_read_tokens;
      }
      if (
        options.promptTokenSemantics === 'includes_cache_read_and_create' &&
        row.prompt_tokens !== null &&
        row.cache_read_tokens !== null &&
        row.cache_creation_tokens !== null
      ) {
        inputTokens =
          row.prompt_tokens - row.cache_read_tokens - row.cache_creation_tokens;
      }
      if (inputTokens !== null && inputTokens < 0)
        throw new Error('Inconsistent provider token semantics');
      return {
        attemptId: row.attempt_id!,
        providerCallId: row.provider_call_id!,
        billable: costUsd === null ? null : true,
        costUsd,
        inputTokens,
        reportedInputTokens: row.prompt_tokens,
        outputTokens: row.completion_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreateTokens: row.cache_creation_tokens,
      };
    });
  return {
    traceId: root.trace_id,
    objectiveId: root.objective_id,
    turnId: root.turn_id!,
    spans,
    providerAttempts,
  };
}
