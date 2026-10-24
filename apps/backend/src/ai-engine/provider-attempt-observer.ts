import { AsyncLocalStorage } from 'async_hooks';
import { AILoggingService } from './ai-logging.service';
import {
  AIProviderFetch,
  AIResponse,
  AIStreamChunk,
} from './interfaces/ai-provider.interface';
import {
  AgentTraceHandle,
  AgentTraceService,
  hashTraceValue,
} from './observability/agent-trace.service';

interface DispatchState {
  last?: AgentTraceHandle;
  httpStatus?: number;
  transportError?: boolean;
  finishedAt?: number;
  startedClock?: bigint;
  transportDuration?: number;
  attempts: number;
  usageObserved?: boolean;
  observedUsage?: Partial<NonNullable<AIResponse['usage']>>;
}

/** Observe, never configure, provider retry policy. No payload crosses this seam. */
export class ProviderAttemptObserver {
  private readonly dispatch = new AsyncLocalStorage<DispatchState>();
  private readonly observations = new WeakMap<
    AgentTraceHandle,
    { usage?: Partial<NonNullable<AIResponse['usage']>> }
  >();

  observeUsage(
    usage: Partial<NonNullable<AIResponse['usage']>> | undefined,
  ): void {
    const state = this.dispatch.getStore();
    if (!state) return;
    state.usageObserved = true;
    state.observedUsage = usage;
  }

  observedUsage(
    fallback: AIResponse['usage'],
  ): Partial<NonNullable<AIResponse['usage']>> | undefined {
    const span = this.trace.currentSpan();
    const observation = span && this.observations.get(span);
    return observation ? observation.usage : fallback;
  }

  constructor(
    private readonly trace: AgentTraceService,
    private readonly logging: AILoggingService,
  ) {}

  async call<T extends AIResponse>(
    attributes: Record<string, unknown>,
    callback: () => Promise<T>,
  ): Promise<T> {
    const span = this.trace.startSpan('provider_call', {
      ...attributes,
      unit: 'logical_provider_request',
      cost_source: 'provider_attempt',
    });
    if (!span) return callback();
    try {
      const result = await this.trace.run(span, callback);
      this.trace.endSpan(span, {
        status: result.success ? 'ok' : 'error',
        attributes: { stop_reason: result.finish_reason ?? null },
      });
      return result;
    } catch (error) {
      this.trace.endSpan(span, {
        status: 'error',
        error_code: 'PROVIDER_EXCEPTION',
      });
      throw error;
    }
  }

  async attempt(
    settings: Record<string, any> | undefined,
    attributes: Record<string, unknown>,
    callback: () => Promise<AIResponse>,
  ): Promise<AIResponse> {
    if (!this.trace.currentSpan()) return callback();
    const state: DispatchState = { attempts: 0 };
    let result: AIResponse | undefined;
    try {
      result = await this.dispatch.run(state, callback);
      return result;
    } finally {
      this.finishAttempt(state, settings, attributes, result);
    }
  }

  /** Keep every iterator operation in the same logical scope, including return(). */
  async *callStream(
    factory: () => AsyncGenerator<AIStreamChunk>,
    parent?: AgentTraceHandle,
    onEnd?: (status: 'ok' | 'error' | 'cancelled') => void,
  ): AsyncGenerator<AIStreamChunk> {
    const span = this.trace.startSpan(
      'provider_call',
      { streaming: true },
      parent ?? this.trace.currentSpan(),
    );
    if (!span) {
      yield* factory();
      return;
    }
    const iterator = this.trace.run(span, factory);
    let completed = false;
    let failed = false;
    let last: AIStreamChunk | undefined;
    try {
      let next = await this.trace.run(span, () => iterator.next());
      while (!next.done) {
        last = next.value;
        let input: unknown;
        try {
          input = yield next.value;
        } catch (error) {
          next = await this.trace.run(span, () => iterator.throw(error));
          continue;
        }
        next = await this.trace.run(span, () => iterator.next(input));
      }
      completed = true;
      return next.value;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        if (!completed)
          await this.trace.run(span, () => iterator.return(undefined));
      } finally {
        const status =
          failed || last?.type === 'error'
            ? 'error'
            : !completed
              ? 'cancelled'
              : 'ok';
        this.trace.endSpan(span, {
          status,
          error_code: failed ? 'PROVIDER_EXCEPTION' : undefined,
        });
        onEnd?.(status);
      }
    }
  }

  async *attemptStream(
    settings: Record<string, any> | undefined,
    attributes: Record<string, unknown>,
    factory: () => AsyncGenerator<AIStreamChunk>,
  ): AsyncGenerator<AIStreamChunk> {
    if (!this.trace.currentSpan()) {
      yield* factory();
      return;
    }
    const state: DispatchState = { attempts: 0 };
    const iterator = this.dispatch.run(state, factory);
    let last: AIStreamChunk | undefined;
    let completed = false;
    let failed = false;
    try {
      let next = await this.dispatch.run(state, () => iterator.next());
      while (!next.done) {
        last = next.value;
        let input: unknown;
        try {
          input = yield next.value;
        } catch (error) {
          next = await this.dispatch.run(state, () => iterator.throw(error));
          continue;
        }
        next = await this.dispatch.run(state, () => iterator.next(input));
      }
      completed = true;
      return next.value;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        if (!completed)
          await this.dispatch.run(state, () => iterator.return(undefined));
      } finally {
        this.finishAttempt(
          state,
          settings,
          { ...attributes, streaming: true },
          {
            success: completed && last?.type === 'done',
            usage: last?.usage,
          },
          !completed && !failed ? 'cancelled' : undefined,
        );
      }
    }
  }

  private finishAttempt(
    state: DispatchState,
    settings: Record<string, any> | undefined,
    attributes: Record<string, unknown>,
    result?: AIResponse,
    status?: 'cancelled',
  ): void {
    // A custom provider can hide its transport; a dispatch is not proof of one HTTP request.
    const span =
      state.last ??
      this.trace.startSpan('provider_attempt', {
        ...attributes,
        attempt_unit: 'provider_dispatch',
        internal_attempts: 'unknown',
      });
    const usage = state.usageObserved ? state.observedUsage : result?.usage;
    const logical = this.trace.currentSpan();
    if (logical) this.observations.set(logical, { usage });
    this.trace.endSpan(span, {
      status: status ?? (result?.success ? 'ok' : 'error'),
      error_code: result?.success ? undefined : this.errorCode(state),
      usage: {
        prompt_tokens: usage?.promptTokens ?? null,
        completion_tokens: usage?.completionTokens ?? null,
        cache_read_tokens: usage?.cacheReadTokens ?? null,
        cache_creation_tokens: usage?.cacheCreationTokens ?? null,
      },
      cost_usd: this.cost(settings, usage),
      attributes: {
        ...attributes,
        http_status: state.httpStatus ?? null,
        model_hash: result?.model ? hashTraceValue(result.model) : null,
        stop_reason: result?.finish_reason ?? null,
        usage_known: usage !== undefined,
        billable: usage !== undefined ? 'reported_usage' : 'unknown',
      },
    });
  }

  /** SDK invokes this once per physical HTTP request, including internal retries. */
  wrapFetch(fetchImplementation: AIProviderFetch): AIProviderFetch {
    return async (input, init) => {
      const state = this.dispatch.getStore();
      if (!state) return fetchImplementation(input, init);
      if (state.last) {
        this.trace.endSpan(state.last, {
          status: state.httpStatus && state.httpStatus < 400 ? 'ok' : 'error',
          error_code: this.errorCode(state),
          usage: {
            prompt_tokens: null,
            completion_tokens: null,
            cache_read_tokens: null,
            cache_creation_tokens: null,
          },
          cost_usd: null,
          // Prior HTTP latency excludes SDK retry backoff. The final attempt
          // remains open until provider decoding/stream consumption completes.
          duration_ms: state.transportDuration,
          attributes: {
            http_status: state.httpStatus ?? null,
            billable: 'unknown',
          },
        });
        const retry = this.trace.startSpan('provider_retry', {
          retry_source: 'sdk',
          retry_number: state.attempts,
          delay_ms:
            state.finishedAt === undefined
              ? null
              : Date.now() - state.finishedAt,
        });
        this.trace.endSpan(retry, { status: 'ok' });
      }
      state.attempts++;
      state.last = this.trace.startSpan('provider_attempt', {
        attempt_unit: 'http_request',
        attempt_number: state.attempts,
      });
      state.httpStatus = undefined;
      state.transportError = false;
      state.startedClock = process.hrtime.bigint();
      try {
        const response = await fetchImplementation(input, init);
        state.httpStatus = response.status;
        return response;
      } catch (error) {
        state.transportError = true;
        throw error;
      } finally {
        state.finishedAt = Date.now();
        state.transportDuration =
          Number(process.hrtime.bigint() - state.startedClock!) / 1e6;
      }
    };
  }

  async retry(delayMs: number, callback: () => Promise<void>): Promise<void> {
    const span = this.trace.startSpan('provider_retry', {
      retry_source: 'engine',
      delay_ms: delayMs,
    });
    try {
      await callback();
    } finally {
      this.trace.endSpan(span, { status: 'ok' });
    }
  }

  private errorCode(state: DispatchState): string {
    return state.httpStatus && state.httpStatus >= 400
      ? `HTTP_${state.httpStatus}`
      : state.transportError
        ? 'TRANSPORT_ERROR'
        : 'PROVIDER_ERROR';
  }

  private cost(
    settings: Record<string, any> | undefined,
    usage: Partial<NonNullable<AIResponse['usage']>> | undefined,
  ): number | null {
    const validTokens = (value: number | undefined) =>
      value !== undefined && Number.isSafeInteger(value) && value >= 0;
    if (
      !usage ||
      !validTokens(usage.promptTokens) ||
      !validTokens(usage.completionTokens) ||
      (usage.cacheReadTokens !== undefined &&
        !validTokens(usage.cacheReadTokens)) ||
      (usage.cacheCreationTokens !== undefined &&
        !validTokens(usage.cacheCreationTokens))
    )
      return null;
    const pricing = settings?.pricing;
    const knownRate = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (
      !pricing ||
      (usage.promptTokens! > 0 && !knownRate(pricing.input_per_1k)) ||
      (usage.completionTokens! > 0 && !knownRate(pricing.output_per_1k)) ||
      ((usage.cacheReadTokens ?? 0) > 0 &&
        !knownRate(pricing.cache_read_per_1k)) ||
      ((usage.cacheCreationTokens ?? 0) > 0 &&
        !knownRate(pricing.cache_creation_per_1k)) ||
      (pricing.cache_read_per_1k !== undefined &&
        (!knownRate(pricing.cache_read_per_1k) ||
          usage.cacheReadTokens === undefined)) ||
      (pricing.cache_creation_per_1k !== undefined &&
        (!knownRate(pricing.cache_creation_per_1k) ||
          usage.cacheCreationTokens === undefined))
    )
      return null;
    return this.logging.calculateCost(
      settings,
      usage.promptTokens!,
      usage.completionTokens!,
      usage.cacheReadTokens ?? 0,
      usage.cacheCreationTokens ?? 0,
    );
  }
}
