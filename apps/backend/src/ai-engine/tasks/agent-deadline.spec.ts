import {
  AgentDeadline,
  AgentDeadlineError,
  agentDeadlineContext,
  createAgentOperation,
  agentDeadlineStream,
  agentAbortFailure,
} from './agent-deadline';

describe('D2 opt-in deadlines and late-result fencing', () => {
  const deadlines: AgentDeadline[] = [];
  const make = (
    options: Partial<ConstructorParameters<typeof AgentDeadline>[0]> = {},
  ) => {
    const deadline = new AgentDeadline({
      wallDeadlineMs: Date.now() + 1000,
      activeBudgetMs: 1000,
      reserveMs: 0,
      ...options,
    });
    deadlines.push(deadline);
    return deadline;
  };
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10000);
  });
  afterEach(() => {
    for (const deadline of deadlines.splice(0)) deadline.dispose();
    jest.useRealTimers();
  });

  it('allocates nothing without explicit cancellation or request-local ALS', () => {
    expect(createAgentOperation()).toBeUndefined();
    expect(createAgentOperation({})).toBeUndefined();
  });

  it('reserves checkpoint/verification time before dispatch', async () => {
    const deadline = make({
      wallDeadlineMs: Date.now() + 1000,
      activeBudgetMs: 500,
      reserveMs: 100,
    });
    expect(deadline.remainingMs()).toBe(400);
    await expect(deadline.run(async () => 'read')).resolves.toBe('read');
    await jest.advanceTimersByTimeAsync(400);
    expect(deadline.signal.aborted).toBe(true);
    expect(() => deadline.assertCanStart()).toThrow('Agent deadline exceeded');
  });

  it('aborts an in-flight cooperative tool, without claiming rollback', async () => {
    const deadline = make({ activeBudgetMs: 50 });
    const aborted = jest.fn();
    const result = deadline.run(
      () =>
        new Promise<void>((_resolve, reject) => {
          deadline.signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(deadline.signal.reason);
            },
            { once: true },
          );
        }),
    );
    const assertion = expect(result).rejects.toMatchObject({
      code: 'AGENT_DEADLINE_EXCEEDED',
      retryable: false,
    });
    await jest.advanceTimersByTimeAsync(50);
    await assertion;
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it('fences a late non-cooperative completion from a new generation', async () => {
    const old = make({ activeBudgetMs: 10 });
    let finish!: (value: string) => void;
    const advance = jest.fn();
    const result = old
      .run(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      )
      .then(advance);
    const assertion = expect(result).rejects.toBeInstanceOf(AgentDeadlineError);
    await jest.advanceTimersByTimeAsync(10);
    await assertion;
    const current = make();
    await expect(current.run(async () => 'new-generation')).resolves.toBe(
      'new-generation',
    );
    finish('stale');
    await jest.advanceTimersByTimeAsync(0);
    expect(advance).not.toHaveBeenCalled();
  });

  it('excludes human waits from active time but never from the wall clock', async () => {
    const deadline = make({
      wallDeadlineMs: Date.now() + 2000,
      activeBudgetMs: 500,
      reserveMs: 100,
    });
    await jest.advanceTimersByTimeAsync(300);
    deadline.pauseActive();
    await jest.advanceTimersByTimeAsync(500);
    expect(deadline.remainingMs()).toBe(1100);
    deadline.resumeActive();
    expect(deadline.remainingMs()).toBe(100);
    await jest.advanceTimersByTimeAsync(100);
    expect(deadline.signal.aborted).toBe(true);
  });

  it('still enforces the hard wall during a human wait', async () => {
    const deadline = make({
      wallDeadlineMs: Date.now() + 100,
      activeBudgetMs: 1000,
    });
    deadline.pauseActive();
    await jest.advanceTimersByTimeAsync(100);
    expect(deadline.signal.aborted).toBe(true);
  });

  it('allows plan budget expansion without resetting spent active time or resurrecting an abort', async () => {
    const deadline = make({ activeBudgetMs: 100 });
    await jest.advanceTimersByTimeAsync(50);
    deadline.updateBudgets({ activeBudgetMs: 200 });
    expect(deadline.remainingMs()).toBe(150);
    await jest.advanceTimersByTimeAsync(150);
    deadline.updateBudgets({
      activeBudgetMs: 10000,
      wallDeadlineMs: Date.now() + 10000,
    });
    expect(deadline.signal.aborted).toBe(true);
  });

  it('combines caller cancellation and inherited ALS without borrowing another request', async () => {
    const parent = make();
    const caller = new AbortController();
    const child = agentDeadlineContext.run(parent, () =>
      createAgentOperation({ signal: caller.signal }),
    )!;
    deadlines.push(child);
    expect(child.deadlineMs).toBeLessThanOrEqual(parent.deadlineMs);
    caller.abort();
    expect(child.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(createAgentOperation()).toBeUndefined();
  });

  it('cancels children when the objective is disposed or superseded', () => {
    const parent = make();
    const child = agentDeadlineContext.run(parent, () =>
      createAgentOperation(),
    )!;
    deadlines.push(child);
    parent.dispose();
    expect(child.signal.aborted).toBe(true);
    expect(agentAbortFailure(undefined, child.signal)).toMatchObject({
      error_code: 'AGENT_CANCELLED',
      retryable: false,
    });
  });

  it('never overlaps lease checks and fails closed on a check error', async () => {
    const deadline = make();
    let fail!: (error: Error) => void;
    const check = jest.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          fail = reject;
        }),
    );
    deadline.watchAbort(check, 10);
    await jest.advanceTimersByTimeAsync(100);
    expect(check).toHaveBeenCalledTimes(1);
    fail(new Error('lease unavailable'));
    await jest.advanceTimersByTimeAsync(0);
    expect(deadline.signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(100);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('aborts when the objective is superseded and cleans watcher timers', async () => {
    const deadline = make();
    const check = jest.fn().mockResolvedValue(true);
    deadline.watchAbort(check, 10);
    await jest.advanceTimersByTimeAsync(10);
    expect(deadline.signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(100);
    expect(check).toHaveBeenCalledTimes(1);
    const other = make();
    const unused = jest.fn().mockResolvedValue(false);
    other.watchAbort(unused, 10)();
    await jest.advanceTimersByTimeAsync(10);
    expect(unused).not.toHaveBeenCalled();
  });

  it('fences a stream pull that ignores cancellation, with no late done frame', async () => {
    const deadline = make({ activeBudgetMs: 10 });
    let finish!: (result: IteratorResult<string>) => void;
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    };
    const stream = agentDeadlineStream(source, deadline);
    const assertion = expect(stream.next()).rejects.toBeInstanceOf(
      AgentDeadlineError,
    );
    await jest.advanceTimersByTimeAsync(10);
    await assertion;
    finish({ done: false, value: 'late' });
    await jest.advanceTimersByTimeAsync(0);
    await expect(stream.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('fails closed for invalid or insufficient budgets and pre-aborted callers', async () => {
    expect(make({ activeBudgetMs: NaN }).signal.aborted).toBe(true);
    const caller = new AbortController();
    caller.abort();
    const deadline = make({ signal: caller.signal });
    const work = jest.fn();
    await expect(deadline.run(work)).rejects.toMatchObject({
      code: 'AGENT_CANCELLED',
    });
    expect(work).not.toHaveBeenCalled();
    expect(() => make({ activeBudgetMs: 20 }).assertCanStart(21)).toThrow(
      'Agent deadline exceeded',
    );
  });
});
