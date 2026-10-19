import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentDeadlineOptions {
  /** Epoch milliseconds. Human waits never extend this hard wall. */
  wallDeadlineMs: number;
  /** Total active milliseconds for this instance; spent time survives updates. */
  activeBudgetMs: number;
  /** Leave time for checkpoint, verification and deterministic closure. */
  reserveMs?: number;
  signal?: AbortSignal;
  signals?: readonly AbortSignal[];
}

export class AgentDeadlineError extends Error {
  readonly name = 'AbortError';
  readonly retryable = false;
  constructor(
    readonly code:
      | 'AGENT_DEADLINE_EXCEEDED'
      | 'AGENT_CANCELLED' = 'AGENT_DEADLINE_EXCEEDED',
  ) {
    super(
      code === 'AGENT_CANCELLED'
        ? 'Agent operation cancelled'
        : 'Agent deadline exceeded',
    );
  }
}

/** Cancellation only: never stores tenant identity, credentials or authority. */
export const agentDeadlineContext = new AsyncLocalStorage<AgentDeadline>();

/**
 * Opt-in cooperative cancellation plus a completion fence for non-cooperative
 * handlers. Aborting a dispatched write does NOT prove that it was rolled back.
 */
export class AgentDeadline {
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private wallDeadlineMs: number;
  private activeBudgetMs: number;
  private readonly reserveMs: number;
  private spentActiveMs = 0;
  private activeSince: number | null = performance.now();
  private readonly unlink: Array<() => void> = [];

  constructor(options: AgentDeadlineOptions) {
    this.wallDeadlineMs = this.limit(options.wallDeadlineMs);
    this.activeBudgetMs = this.limit(options.activeBudgetMs);
    this.reserveMs = Number.isFinite(options.reserveMs ?? 2000)
      ? Math.max(0, options.reserveMs ?? 2000)
      : 2000;
    for (const signal of [options.signal, ...(options.signals ?? [])]) {
      if (!signal) continue;
      const abort = () => this.cancel(signal.reason);
      if (signal.aborted) abort();
      else {
        signal.addEventListener('abort', abort, { once: true });
        this.unlink.push(() => signal.removeEventListener('abort', abort));
      }
    }
    this.schedule();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Dispatch deadline (already excludes the checkpoint/closure reserve). */
  get deadlineMs(): number {
    const activeDeadline =
      this.activeSince === null
        ? Infinity
        : Date.now() + this.activeRemainingMs() - this.reserveMs;
    return Math.min(this.wallDeadlineMs - this.reserveMs, activeDeadline);
  }

  remainingMs(): number {
    return this.signal.aborted ? 0 : Math.max(0, this.deadlineMs - Date.now());
  }

  assertCanStart(minimumMs = 1): void {
    if (this.signal.aborted) throw this.abortError();
    if (this.remainingMs() < Math.max(1, minimumMs)) {
      this.cancel(new AgentDeadlineError());
      throw this.abortError();
    }
  }

  /** Plan expansion may increase total budgets, but never resurrect an abort. */
  updateBudgets(options: {
    wallDeadlineMs?: number;
    activeBudgetMs?: number;
  }): void {
    if (options.wallDeadlineMs !== undefined)
      this.wallDeadlineMs = this.limit(options.wallDeadlineMs);
    if (options.activeBudgetMs !== undefined)
      this.activeBudgetMs = this.limit(options.activeBudgetMs);
    this.schedule();
  }

  pauseActive(): void {
    if (this.activeSince === null) return;
    this.spentActiveMs += Math.max(0, performance.now() - this.activeSince);
    this.activeSince = null;
    this.schedule();
  }

  resumeActive(): void {
    if (this.activeSince !== null) return;
    this.activeSince = performance.now();
    this.schedule();
  }

  /** Optional lease/supersession polling; at most one asynchronous check in flight. */
  watchAbort(check: () => Promise<boolean>, intervalMs = 250): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const index = this.unlink.indexOf(stop);
      if (index !== -1) this.unlink.splice(index, 1);
    };
    const schedule = () => {
      if (stopped || this.signal.aborted) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          if (stopped || this.signal.aborted) return;
          void Promise.resolve()
            .then(check)
            .then(
              (abort) => {
                if (stopped || this.signal.aborted) return;
                if (abort) this.cancel();
                else schedule();
              },
              () => {
                if (!stopped) this.cancel();
              },
            );
        },
        Number.isFinite(intervalMs) ? Math.max(10, intervalMs) : 250,
      );
      timer.unref?.();
    };
    this.unlink.push(stop);
    schedule();
    return stop;
  }

  cancel(reason?: unknown): void {
    if (!this.signal.aborted) {
      this.controller.abort(
        reason instanceof AgentDeadlineError
          ? reason
          : new AgentDeadlineError('AGENT_CANCELLED'),
      );
    }
    this.clearTimer();
    for (const unlink of this.unlink.splice(0)) unlink();
  }

  /** Dispose only after consumers have finished; outstanding completions fence. */
  dispose(): void {
    this.cancel();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.assertCanStart();
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.abortError());
      this.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => {
          this.assertCanStart();
          return work();
        })
        .then((value) => {
          // A non-cooperative promise may resolve after abort/lease loss. Never
          // publish its value or let it advance the new generation.
          this.assertCanStart();
          resolve(value);
        }, reject)
        .catch(reject)
        .finally(() => {
          this.signal.removeEventListener('abort', abort);
        });
    });
  }

  private abortError(): AgentDeadlineError {
    return this.signal.reason instanceof AgentDeadlineError
      ? this.signal.reason
      : new AgentDeadlineError('AGENT_CANCELLED');
  }

  private activeRemainingMs(): number {
    return (
      this.activeBudgetMs -
      this.spentActiveMs -
      (this.activeSince === null
        ? 0
        : Math.max(0, performance.now() - this.activeSince))
    );
  }

  private limit(value: number): number {
    // Invalid budgets fail closed instead of silently removing a limit.
    return value === Infinity
      ? value
      : Number.isFinite(value)
        ? Math.max(0, value)
        : 0;
  }

  private schedule(): void {
    this.clearTimer();
    if (this.signal.aborted) return;
    const remaining = this.deadlineMs - Date.now();
    if (remaining <= 0) this.cancel(new AgentDeadlineError());
    else if (Number.isFinite(remaining)) {
      this.timer = setTimeout(
        () => this.schedule(),
        Math.min(remaining, 2_147_483_647),
      );
      this.timer.unref?.();
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export interface AgentCancellationOptions {
  signal?: AbortSignal;
  /** Epoch milliseconds, not a duration. */
  deadlineMs?: number;
}

/** No options/ALS means no timer, signal or legacy-path behavior change. */
export function createAgentOperation(
  options?: AgentCancellationOptions,
): AgentDeadline | undefined {
  const parent = agentDeadlineContext.getStore();
  if (!parent && !options?.signal && options?.deadlineMs === undefined)
    return undefined;
  return new AgentDeadline({
    wallDeadlineMs: Math.min(
      parent?.deadlineMs ?? Infinity,
      options?.deadlineMs ?? Infinity,
    ),
    activeBudgetMs: Infinity,
    reserveMs: 0,
    signals: [parent?.signal, options?.signal].filter(
      (value): value is AbortSignal => !!value,
    ),
  });
}

export function isAgentAbort(error: unknown, signal?: AbortSignal): boolean {
  const err = error as { name?: string; code?: string } | null;
  return (
    !!signal?.aborted ||
    error instanceof AgentDeadlineError ||
    ['AbortError', 'APIUserAbortError'].includes(err?.name ?? '') ||
    [
      'ABORT_ERR',
      'ERR_CANCELED',
      'AGENT_CANCELLED',
      'AGENT_DEADLINE_EXCEEDED',
    ].includes(err?.code ?? '')
  );
}

export function agentAbortFailure(
  error: unknown,
  signal?: AbortSignal,
): {
  success: false;
  error: string;
  error_code: string;
  retryable: false;
} {
  const reason =
    signal?.reason instanceof AgentDeadlineError ? signal.reason : error;
  const code =
    reason instanceof AgentDeadlineError ? reason.code : 'AGENT_CANCELLED';
  return {
    success: false,
    error:
      code === 'AGENT_DEADLINE_EXCEEDED'
        ? 'Agent deadline exceeded'
        : 'Agent operation cancelled',
    error_code: code,
    retryable: false,
  };
}

/** Fence every pull even when a custom stream ignores AbortSignal. */
export async function* agentDeadlineStream<T>(
  source: AsyncIterable<T>,
  deadline?: AgentDeadline,
): AsyncGenerator<T> {
  if (!deadline) {
    yield* source;
    return;
  }
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await deadline.run(() => iterator.next());
      if (next.done) return;
      yield next.value;
    }
  } finally {
    // Do not await an uncooperative iterator's return after cancellation.
    if (iterator.return) {
      try {
        void Promise.resolve(iterator.return()).catch(() => undefined);
      } catch {
        // Cleanup must not replace the original cancellation/result.
      }
    }
  }
}
