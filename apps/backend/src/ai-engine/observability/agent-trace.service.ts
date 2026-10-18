import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

export type AgentOutcome =
  | 'completed_verified'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'blocked_permission'
  | 'blocked_plan'
  | 'not_found'
  | 'partial'
  | 'unknown_effect'
  | 'failed'
  | 'cancelled';

export type AgentSpanKind =
  | 'root'
  | 'router'
  | 'context'
  | 'provider_call'
  | 'provider_attempt'
  | 'provider_retry'
  | 'closing_inference'
  | 'tool'
  | 'ui_wait'
  | 'UI_wait'
  | 'approval_wait'
  | 'verifier';

interface TraceIdentity {
  readonly request_id?: string;
  readonly objective_id?: string;
  readonly conversation_id?: string | number;
  readonly turn_id?: string;
  readonly surface?: string;
  readonly agent?: string;
}

/** Authority is supplied by the authenticated caller, never resolved from a fallback. */
export type AgentTraceScope = TraceIdentity &
  (
    | {
        readonly kind: 'tenant';
        readonly organization_id: number;
        readonly store_id: number;
        readonly user_id?: number;
      }
    | {
        readonly kind: 'system';
        readonly system_purpose:
          | 'platform_knowledge'
          | 'evaluation'
          | 'maintenance';
        readonly organization_id?: never;
        readonly store_id?: never;
        readonly user_id?: never;
      }
  );

export interface AgentTraceHandle {
  readonly trace_id: string;
  readonly span_id: string;
  readonly kind: AgentSpanKind;
  readonly scope: Readonly<AgentTraceScope>;
}

export interface AgentTraceContext {
  readonly trace_id: string;
  readonly span_id: string;
  readonly request_id: string;
  readonly objective_id?: string;
  readonly conversation_id?: string;
  readonly turn_id?: string;
  readonly provider_call_id?: string;
  readonly attempt_id?: string;
  readonly tool_call_id?: string;
}

export interface AgentTraceUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
}

export interface AgentSpanEnd {
  status?: 'ok' | 'error' | 'cancelled';
  outcome?: AgentOutcome;
  error_code?: string;
  attributes?: Record<string, unknown>;
  usage?: AgentTraceUsage;
  cost_usd?: number | null;
  /** Measured transport time, excluding SDK backoff when a receipt is closed later. */
  duration_ms?: number;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const OUTCOMES = new Set<AgentOutcome>([
  'completed_verified',
  'awaiting_approval',
  'awaiting_input',
  'blocked_permission',
  'blocked_plan',
  'not_found',
  'partial',
  'unknown_effect',
  'failed',
  'cancelled',
]);
const KINDS = new Set<AgentSpanKind>([
  'root',
  'router',
  'context',
  'provider_call',
  'provider_attempt',
  'provider_retry',
  'closing_inference',
  'tool',
  'ui_wait',
  'UI_wait',
  'approval_wait',
  'verifier',
]);
const HASH_KEYS = new Set([
  'catalog_hash',
  'prompt_hash',
  'config_hash',
  'model_hash',
  'options_hash',
  'tool_name_hash',
  'tool_call_id_hash',
  'external_request_id_hash',
  'external_objective_id_hash',
  'external_turn_id_hash',
  'error_hash',
  'result_hash',
]);
const COUNT_KEYS = new Set([
  'tool_count',
  'definition_tokens',
  'context_tokens',
  'context_window_tokens',
  'estimated_output_tokens',
  'omitted_messages',
  'estimated_cost_microusd',
  'round',
  'result_bytes',
  'requested_count',
  'allowed_count',
  'requested_tool_count',
  'allowed_tool_count',
  'retry_count',
  'attempt',
  'attempt_number',
  'dispatch_number',
  'retry_number',
  'delay_ms',
  'http_status',
  'message_count',
  'empty_retry_count',
  'closing_call_count',
  'active_span_count',
]);
const BOOLEAN_KEYS = new Set([
  'ui_result_known',
  'usage_known',
  'verified',
  'cancelled',
  'retryable',
  'streaming',
]);
const ENUM_KEYS: Record<string, ReadonlySet<string>> = {
  call_reason: new Set([
    'agent_round',
    'agent',
    'initial',
    'closing',
    'closing_inference',
    'empty_retry',
    'retry',
    'tool_result',
    'direct',
    'application',
    'embedding',
    'streaming',
    'unknown',
  ]),
  stop_reason: new Set([
    'stop',
    'length',
    'tool_calls',
    'tool_use',
    'end_turn',
    'max_tokens',
    'stop_sequence',
    'content_filter',
    'pause_turn',
    'refusal',
    'done',
    'error',
    'cancelled',
    'unknown',
  ]),
  retry_source: new Set([
    'sdk',
    'engine',
    'application',
    'empty',
    'provider',
    'unknown',
  ]),
  attempt_unit: new Set([
    'http_request',
    'http',
    'provider_dispatch',
    'sdk_request',
  ]),
  internal_attempts: new Set(['unknown', 'observed']),
  usage_source: new Set(['provider', 'unknown']),
  billable: new Set(['reported_usage', 'unknown']),
  cost_measurement: new Set(['reported', 'estimated', 'unknown']),
  context_budget_source: new Set(['configured', 'fallback']),
  estimation_method: new Set(['conservative_estimate']),
};

/** Only technical fingerprints/counts are retained; arbitrary metadata is discarded. */
export function redactTraceAttributes(
  input?: Record<string, unknown>,
): Prisma.InputJsonObject {
  const safe: Record<string, Prisma.InputJsonValue | null> = {};
  if (!input) return safe;
  for (const key of [
    ...HASH_KEYS,
    ...COUNT_KEYS,
    ...BOOLEAN_KEYS,
    ...Object.keys(ENUM_KEYS),
    'catalog_version',
  ]) {
    const value = input[key];
    if (HASH_KEYS.has(key) && typeof value === 'string' && HASH.test(value))
      safe[key] = value;
    else if (
      COUNT_KEYS.has(key) &&
      (value === null ||
        (typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= 2_147_483_647))
    )
      safe[key] = value;
    else if (BOOLEAN_KEYS.has(key) && typeof value === 'boolean')
      safe[key] = value;
    else if (
      ENUM_KEYS[key] &&
      typeof value === 'string' &&
      ENUM_KEYS[key].has(value)
    )
      safe[key] = value;
    else if (
      key === 'catalog_version' &&
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
      safe[key] = value;
    else if (
      key === 'catalog_version' &&
      typeof value === 'string' &&
      /^v?\d+(?:\.\d+){0,3}$/.test(value)
    )
      safe[key] = value;
  }
  return safe;
}

/** Hash inputs without serializing bodies into telemetry. Circular inputs are safe. */
export function hashTraceValue(value: unknown): string {
  let serialized: string;
  try {
    serialized =
      typeof value === 'string'
        ? value
        : (JSON.stringify(value) ?? 'undefined');
  } catch {
    serialized = '[unserializable]';
  }
  return createHash('sha256').update(serialized).digest('hex');
}

/** Untrusted request ids never reach a UUID column verbatim. This is NOT a metering id. */
export function normalizeRequestId(value?: unknown): string {
  if (typeof value === 'string' && UUID.test(value)) return value.toLowerCase();
  if (value === undefined || value === null || value === '')
    return randomUUID();
  const hex = hashTraceValue(value).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

interface SpanState {
  handle: AgentTraceHandle;
  root: AgentTraceHandle;
  context: Readonly<AgentTraceContext>;
  parent_span_id: string | null;
  started_at: Date;
  started_clock: bigint;
  attributes: Prisma.InputJsonObject;
  closed: boolean;
}

@Injectable()
export class AgentTraceService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentTraceService.name);
  private readonly storage = new AsyncLocalStorage<
    AgentTraceHandle | undefined
  >();
  private readonly states = new WeakMap<AgentTraceHandle, SpanState>();
  private readonly active = new Map<string, SpanState>();
  // Coalesce start/end snapshots. At most one DB operation is in flight, even on outage.
  private readonly queue = new Map<
    string,
    Prisma.ai_agent_trace_spansUncheckedCreateInput
  >();
  private draining?: Promise<void>;
  private readonly maxQueuedSpans = 512;
  private readonly maxActiveSpans = 2048;
  private droppedSpans = 0;
  private writeFailures = 0;
  private lastAlarmAt = 0;
  readonly retention = Object.freeze({ spans_days: 14, aggregates_days: 90 });

  constructor(private readonly prisma: GlobalPrismaService) {}

  isEnabled(): boolean {
    return process.env.AI_AGENT_TRACING_ENABLED === 'true';
  }

  hash(value: unknown): string {
    return hashTraceValue(value);
  }
  normalizeRequestId(value?: unknown): string {
    return normalizeRequestId(value);
  }

  startTrace(
    scope: AgentTraceScope,
    attributes?: Record<string, unknown>,
  ): AgentTraceHandle | undefined {
    if (!this.isEnabled()) return undefined;
    if (!this.validScope(scope)) {
      this.alarm('invalid_scope');
      return undefined;
    }
    const immutableScope = this.copyScope(scope);
    const handle = Object.freeze({
      trace_id: randomUUID(),
      span_id: randomUUID(),
      kind: 'root' as const,
      scope: immutableScope,
    });
    const identity: AgentTraceContext = {
      trace_id: handle.trace_id,
      span_id: handle.span_id,
      request_id: immutableScope.request_id!,
      ...(immutableScope.objective_id
        ? { objective_id: immutableScope.objective_id }
        : {}),
      ...(immutableScope.conversation_id !== undefined
        ? { conversation_id: String(immutableScope.conversation_id) }
        : {}),
      turn_id: immutableScope.turn_id,
    };
    const fingerprints = { ...attributes };
    if (scope.request_id && !UUID.test(scope.request_id))
      fingerprints.external_request_id_hash = hashTraceValue(scope.request_id);
    if (scope.objective_id && !UUID.test(scope.objective_id))
      fingerprints.external_objective_id_hash = hashTraceValue(
        scope.objective_id,
      );
    if (scope.turn_id && !UUID.test(scope.turn_id))
      fingerprints.external_turn_id_hash = hashTraceValue(scope.turn_id);
    return this.register(handle, handle, identity, null, fingerprints);
  }

  startSpan(
    kind: AgentSpanKind,
    attributes?: Record<string, unknown>,
    parent = this.currentSpan(),
  ): AgentTraceHandle | undefined {
    if (!this.isEnabled() || !parent || !KINDS.has(kind) || kind === 'root')
      return undefined;
    const parentState = this.states.get(parent);
    if (
      !parentState ||
      parentState.closed ||
      this.states.get(parentState.root)?.closed
    )
      return undefined;
    const handle = Object.freeze({
      trace_id: parent.trace_id,
      span_id: randomUUID(),
      kind,
      scope: parent.scope,
    });
    const context = { ...parentState.context, span_id: handle.span_id };
    if (kind === 'provider_call') {
      context.provider_call_id = handle.span_id;
      delete context.attempt_id;
    }
    if (kind === 'provider_attempt') context.attempt_id = handle.span_id;
    if (kind === 'tool')
      context.tool_call_id = attributes?.tool_call_id
        ? normalizeRequestId(attributes.tool_call_id)
        : handle.span_id;
    if (
      kind === 'tool' &&
      attributes?.tool_call_id &&
      !UUID.test(String(attributes.tool_call_id))
    )
      attributes = {
        ...attributes,
        tool_call_id_hash: hashTraceValue(attributes.tool_call_id),
      };
    return this.register(
      handle,
      parentState.root,
      context,
      parent.span_id,
      attributes,
    );
  }

  currentSpan(): AgentTraceHandle | undefined {
    const handle = this.storage.getStore();
    return handle && !this.states.get(handle)?.closed ? handle : undefined;
  }

  currentTraceContext(): Readonly<AgentTraceContext> | undefined {
    const handle = this.currentSpan();
    const state = handle && this.states.get(handle);
    return state && !state.closed ? state.context : undefined;
  }

  /** run(undefined) deliberately clears a parent's context; there is no global fallback. */
  run<T>(handle: AgentTraceHandle | undefined, callback: () => T): T {
    const state = handle && this.states.get(handle);
    return this.storage.run(
      state && !state.closed ? handle : undefined,
      callback,
    );
  }

  /** A generator executes in the caller's context, not where it was constructed. */
  async *runGenerator<T, TReturn = unknown, TNext = unknown>(
    handle: AgentTraceHandle | undefined,
    factory: () => AsyncGenerator<T, TReturn, TNext>,
  ): AsyncGenerator<T, TReturn, TNext> {
    let iterator: AsyncGenerator<T, TReturn, TNext> | undefined;
    let completed = false;
    let failed = false;
    try {
      iterator = this.run(handle, factory);
      let next = await this.run(handle, () => iterator!.next());
      while (!next.done) {
        let input: TNext;
        try {
          input = yield next.value;
        } catch (error) {
          // Match yield* delegation: the source may catch the consumer's error
          // and yield a recovery result. An injected throw is not itself failure.
          next = await this.run(handle, () => iterator!.throw(error));
          continue;
        }
        next = await this.run(handle, () => iterator!.next(input));
      }
      completed = true;
      return next.value;
    } catch (error) {
      failed = true;
      this.finishTrace(handle, 'failed', {
        status: 'error',
        error_code: 'TRACE_OPERATION_FAILED',
      });
      throw error;
    } finally {
      try {
        if (!completed && iterator)
          await this.run(handle, () => iterator!.return(undefined as TReturn));
      } catch (error) {
        failed = true;
        this.finishTrace(handle, 'failed', {
          status: 'error',
          error_code: 'TRACE_OPERATION_FAILED',
        });
        throw error;
      } finally {
        if (!failed)
          this.finishTrace(handle, completed ? 'partial' : 'cancelled', {
            status: completed ? 'ok' : 'cancelled',
          });
      }
    }
  }

  endSpan(handle: AgentTraceHandle | undefined, end: AgentSpanEnd = {}): void {
    if (!handle) return;
    const state = this.states.get(handle);
    if (!state || state.closed) return;
    if (handle.kind === 'root') {
      this.finishTrace(
        handle,
        end.outcome ??
          (end.status === 'error'
            ? 'failed'
            : end.status === 'cancelled'
              ? 'cancelled'
              : 'partial'),
        end,
      );
      return;
    }
    this.close(state, end);
  }

  finishTrace(
    handle: AgentTraceHandle | undefined,
    outcome: AgentOutcome = 'partial',
    end: AgentSpanEnd = {},
  ): void {
    if (!handle) return;
    const state = this.states.get(handle);
    if (!state) return;
    const root = this.states.get(state.root);
    if (!root || root.closed) return;
    const safeOutcome = OUTCOMES.has(outcome) ? outcome : 'partial';
    // Unfinished children are NOT inferred to have succeeded from a successful root.
    for (const child of this.active.values()) {
      if (child.root === root.handle && child !== root)
        this.close(child, {
          status: end.status === 'error' ? 'error' : 'cancelled',
          outcome: end.status === 'error' ? 'failed' : 'cancelled',
          error_code: 'TRACE_PARENT_CLOSED',
        });
    }
    this.close(root, { ...end, outcome: safeOutcome });
  }

  getHealth(): Readonly<{
    queued_spans: number;
    active_spans: number;
    dropped_spans: number;
    write_failures: number;
  }> {
    return Object.freeze({
      queued_spans: this.queue.size,
      active_spans: this.active.size,
      dropped_spans: this.droppedSpans,
      write_failures: this.writeFailures,
    });
  }

  /** Tests/shutdown only: business paths never await a telemetry write. */
  async flush(timeoutMs = 2000): Promise<boolean> {
    if (!this.draining && this.queue.size) this.scheduleDrain();
    if (!this.draining) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      this.draining.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!finished) this.alarm('flush_timeout');
    return finished;
  }

  async onModuleDestroy(): Promise<void> {
    for (const state of this.active.values())
      if (state.handle.kind === 'root')
        this.finishTrace(state.handle, 'cancelled', { status: 'cancelled' });
    await this.flush();
  }

  private register(
    handle: AgentTraceHandle,
    root: AgentTraceHandle,
    context: AgentTraceContext,
    parent: string | null,
    attributes?: Record<string, unknown>,
  ): AgentTraceHandle | undefined {
    if (this.active.size >= this.maxActiveSpans) {
      this.droppedSpans++;
      this.alarm('active_limit');
      return undefined;
    }
    const state: SpanState = {
      handle,
      root,
      context: Object.freeze(context),
      parent_span_id: parent,
      started_at: new Date(),
      started_clock: process.hrtime.bigint(),
      attributes: redactTraceAttributes(attributes),
      closed: false,
    };
    this.states.set(handle, state);
    this.active.set(handle.span_id, state);
    this.enqueue(this.snapshot(state));
    return handle;
  }

  private close(state: SpanState, end: AgentSpanEnd): void {
    state.closed = true;
    this.active.delete(state.handle.span_id);
    state.attributes = {
      ...state.attributes,
      ...redactTraceAttributes(end.attributes),
    };
    const usage = end.usage;
    const row = this.snapshot(state);
    const measuredDuration = Math.min(
      2_147_483_647,
      Math.max(
        0,
        Math.floor(Number(process.hrtime.bigint() - state.started_clock) / 1e6),
      ),
    );
    row.duration_ms =
      typeof end.duration_ms === 'number' &&
      Number.isFinite(end.duration_ms) &&
      end.duration_ms >= 0
        ? Math.min(2_147_483_647, Math.floor(end.duration_ms))
        : measuredDuration;
    row.ended_at =
      typeof end.duration_ms === 'number' &&
      Number.isFinite(end.duration_ms) &&
      end.duration_ms >= 0
        ? new Date(state.started_at.getTime() + row.duration_ms)
        : new Date();
    row.status =
      end.status === 'error' || end.status === 'cancelled' ? end.status : 'ok';
    row.outcome = end.outcome && OUTCOMES.has(end.outcome) ? end.outcome : null;
    row.error_code =
      end.error_code && /^[A-Z][A-Z0-9_]{0,99}$/.test(end.error_code)
        ? end.error_code
        : null;
    row.prompt_tokens = this.tokenCount(usage?.prompt_tokens);
    row.completion_tokens = this.tokenCount(usage?.completion_tokens);
    row.cache_read_tokens = this.tokenCount(usage?.cache_read_tokens);
    row.cache_creation_tokens = this.tokenCount(usage?.cache_creation_tokens);
    // A logical request and its HTTP attempts must never both enter cost aggregation.
    row.cost_usd =
      state.handle.kind === 'provider_attempt' &&
      typeof end.cost_usd === 'number' &&
      Number.isFinite(end.cost_usd) &&
      end.cost_usd >= 0 &&
      end.cost_usd < 10_000
        ? end.cost_usd
        : null;
    this.enqueue(row);
  }

  private snapshot(
    state: SpanState,
  ): Prisma.ai_agent_trace_spansUncheckedCreateInput {
    const { handle, context } = state;
    const scope = handle.scope;
    return {
      span_id: handle.span_id,
      trace_id: handle.trace_id,
      parent_span_id: state.parent_span_id,
      request_id: context.request_id,
      objective_id: context.objective_id,
      conversation_id: context.conversation_id,
      turn_id: context.turn_id,
      provider_call_id: context.provider_call_id,
      attempt_id: context.attempt_id,
      tool_call_id: context.tool_call_id,
      scope_kind: scope.kind,
      system_purpose: scope.kind === 'system' ? scope.system_purpose : null,
      organization_id: scope.kind === 'tenant' ? scope.organization_id : null,
      store_id: scope.kind === 'tenant' ? scope.store_id : null,
      user_id: scope.kind === 'tenant' ? scope.user_id : null,
      surface: scope.surface,
      agent: scope.agent,
      kind: handle.kind,
      status: 'started',
      started_at: state.started_at,
      prompt_tokens: null,
      completion_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      cost_usd: null,
      attributes: state.attributes,
    };
  }

  private enqueue(row: Prisma.ai_agent_trace_spansUncheckedCreateInput): void {
    const spanId = row.span_id;
    if (!spanId) {
      this.alarm('missing_span_id');
      return;
    }
    if (!this.queue.has(spanId) && this.queue.size >= this.maxQueuedSpans) {
      this.droppedSpans++;
      this.alarm('queue_full');
      return;
    }
    this.queue.set(spanId, row);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = Promise.resolve()
      .then(async () => {
        while (this.queue.size) {
          const [id, row] = this.queue.entries().next().value!;
          this.queue.delete(id);
          try {
            // This system telemetry sink always carries immutable, validated explicit scope.
            // Never use a request-scoped delegate here: the caller has already returned.
            await this.prisma.ai_agent_trace_spans.upsert({
              where: { span_id: id },
              create: row,
              update: row,
            });
          } catch {
            this.writeFailures++;
            this.alarm('write_failed'); // Deliberately omit driver error strings/payloads.
          }
        }
      })
      .finally(() => {
        this.draining = undefined;
        if (this.queue.size) this.scheduleDrain();
      });
  }

  private alarm(reason: string): void {
    const now = Date.now();
    if (now - this.lastAlarmAt < 30_000) return;
    this.lastAlarmAt = now;
    this.logger.error(
      `AI_AGENT_TRACE_LOSS reason=${reason} dropped=${this.droppedSpans} write_failures=${this.writeFailures}`,
    );
  }

  private tokenCount(value?: number | null): number | null {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 2_147_483_647
      ? value
      : null;
  }

  private validScope(scope: AgentTraceScope): boolean {
    if (!scope || typeof scope !== 'object') return false;
    const positiveInt = (value: unknown) =>
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= 2_147_483_647;
    if (scope.kind === 'tenant')
      return (
        positiveInt(scope.organization_id) &&
        positiveInt(scope.store_id) &&
        (scope.user_id === undefined || positiveInt(scope.user_id))
      );
    return (
      scope.kind === 'system' &&
      ['platform_knowledge', 'evaluation', 'maintenance'].includes(
        scope.system_purpose,
      ) &&
      scope.organization_id === undefined &&
      scope.store_id === undefined &&
      scope.user_id === undefined
    );
  }

  private copyScope(scope: AgentTraceScope): Readonly<AgentTraceScope> {
    const identity: TraceIdentity = {
      request_id: normalizeRequestId(scope.request_id),
      ...(scope.objective_id
        ? { objective_id: normalizeRequestId(scope.objective_id) }
        : {}),
      ...(scope.conversation_id !== undefined
        ? { conversation_id: this.safeConversationId(scope.conversation_id) }
        : {}),
      turn_id: normalizeRequestId(scope.turn_id),
      ...([
        'text',
        'stt',
        'stt_chat',
        'realtime',
        'voice',
        'worker',
        'eval',
        'api',
        'mcp',
      ].includes(scope.surface ?? '')
        ? { surface: scope.surface }
        : {}),
      ...(['vex', 'vexi', 'system', 'engine'].includes(scope.agent ?? '')
        ? { agent: scope.agent }
        : {}),
    };
    return Object.freeze(
      scope.kind === 'tenant'
        ? {
            ...identity,
            kind: 'tenant',
            organization_id: scope.organization_id,
            store_id: scope.store_id,
            ...(scope.user_id ? { user_id: scope.user_id } : {}),
          }
        : { ...identity, kind: 'system', system_purpose: scope.system_purpose },
    );
  }

  private safeConversationId(value: string | number): string {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
      return String(value);
    if (
      typeof value === 'string' &&
      (UUID.test(value) || /^\d{1,16}$/.test(value))
    )
      return value.toLowerCase();
    return hashTraceValue(value);
  }
}
