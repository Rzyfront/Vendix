import {
  RequestContextService,
  type RequestContext,
} from '../../common/context/request-context.service';
import type { RegisteredTool } from './interfaces/tool.interface';
import {
  ToolSchedulerService,
  type ToolBatchInput,
  type ScheduledToolCall,
} from './tool-scheduler.service';

const context = (store_id = 1): RequestContext => ({
  user_id: store_id,
  organization_id: store_id,
  store_id,
  is_owner: true,
  is_super_admin: false,
  permissions: [`store${store_id}.read`],
  roles: ['owner'],
});
const tool = (
  name = 'get_order',
  patch: Partial<RegisteredTool> = {},
): RegisteredTool => ({
  name,
  domain: 'orders',
  description: name,
  parameters: { type: 'object' },
  readOnly: true,
  scheduling: {
    parallelSafe: true,
    idempotent_read: true,
    resource_keys: [],
    max_result_bytes: 4096,
  },
  ...patch,
});
const calls = (count = 8, name = 'get_order'): ScheduledToolCall[] =>
  Array.from({ length: count }, (_, i) => ({
    call_id: `c${i}`,
    tool_name: name,
    arguments: { id: i },
  }));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
const tick = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const run = <T>(
  scheduler: ToolSchedulerService,
  patch: Partial<ToolBatchInput<T>> = {},
) => {
  const input: ToolBatchInput<T> = {
    objective_id: 'objective1',
    context: context(),
    calls: calls(),
    offered_tools: [tool()],
    validate: () => true,
    execute: async () => ({ ok: true }) as T,
    ...patch,
  };
  return RequestContextService.runIsolated(input.context, () =>
    scheduler.executeBatch(input),
  );
};

describe('ToolSchedulerService bounded opt-in reads', () => {
  let scheduler: ToolSchedulerService;

  const oldCap = process.env.AI_PARALLEL_READS_GLOBAL_CAP;
  const oldPool = process.env.DATABASE_POOL_MAX;
  const oldObjectiveCap = process.env.AI_PARALLEL_READS_OBJECTIVE_CAP;
  beforeEach(() => {
    scheduler = new ToolSchedulerService();

    delete process.env.AI_PARALLEL_READS_GLOBAL_CAP;
    delete process.env.DATABASE_POOL_MAX;
    delete process.env.AI_PARALLEL_READS_OBJECTIVE_CAP;
  });
  afterEach(() => {
    if (oldCap === undefined) delete process.env.AI_PARALLEL_READS_GLOBAL_CAP;
    else process.env.AI_PARALLEL_READS_GLOBAL_CAP = oldCap;
    if (oldPool === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = oldPool;
    if (oldObjectiveCap === undefined)
      delete process.env.AI_PARALLEL_READS_OBJECTIVE_CAP;
    else process.env.AI_PARALLEL_READS_OBJECTIVE_CAP = oldObjectiveCap;
    jest.useRealTimers();
  });
  it('runs eight audited reads with max three per objective and stable call order', async () => {
    let active = 0,
      max = 0;
    const gate = deferred();
    const promise = run(scheduler, {
      execute: async (call) => {
        active++;
        max = Math.max(max, active);
        await gate.promise;
        active--;
        return call.call_id;
      },
    });
    await tick();
    expect(active).toBe(3);
    gate.resolve();
    const results = await promise;
    expect(max).toBe(3);
    expect(active).toBe(0);
    expect(results.map((r) => r.call_id)).toEqual(
      calls().map((c) => c.call_id),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
  it('shares the objective cap across simultaneous batches and reduces it for a one-connection pool', async () => {
    const gate = deferred();
    let active = 0,
      max = 0;
    const execute = async () => {
      active++;
      max = Math.max(max, active);
      await gate.promise;
      active--;
      return 'ok';
    };
    const first = run(scheduler, { execute }),
      second = run(scheduler, { execute });
    await tick();
    expect(active).toBe(3);
    gate.resolve();
    await Promise.all([first, second]);
    expect(max).toBe(3);
    process.env.DATABASE_POOL_MAX = '1';
    const poolGate = deferred();
    active = 0;
    max = 0;
    const small = run(scheduler, {
      execute: async () => {
        active++;
        max = Math.max(max, active);
        await poolGate.promise;
        active--;
        return 'ok';
      },
    });
    await tick();
    expect(active).toBe(1);
    poolGate.resolve();
    await small;
    expect(max).toBe(1);
  });
  it('resolves resource templates from own primitive args so different products can run independently', async () => {
    const gate = deferred();
    let active = 0,
      max = 0;
    const templated = tool('get_order', {
      scheduling: { ...tool().scheduling!, resource_keys: ['product:{id}'] },
    });
    const promise = run(scheduler, {
      calls: calls(3),
      offered_tools: [templated],
      execute: async () => {
        active++;
        max = Math.max(max, active);
        await gate.promise;
        active--;
        return 'ok';
      },
    });
    await tick();
    expect(active).toBe(3);
    gate.resolve();
    await promise;
    expect(max).toBe(3);
    const sharedGate = deferred();
    active = 0;
    max = 0;
    const shared = run(scheduler, {
      calls: calls(3).map((c) => ({ ...c, arguments: { id: 1 } })),
      offered_tools: [templated],
      execute: async () => {
        active++;
        max = Math.max(max, active);
        await sharedGate.promise;
        active--;
        return 'ok';
      },
    });
    await tick();
    expect(active).toBe(1);
    sharedGate.resolve();
    await shared;
    expect(max).toBe(1);
  });
  it('retains successful siblings and exact failure even when completion order differs', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const settled: string[] = [];
    const error = new Error('read2 failed');
    const promise = run(scheduler, {
      calls: calls(3),
      onSettled: (r) => {
        settled.push(r.call_id);
      },
      execute: async (call) => {
        const index = Number(call.arguments.id);
        await gates[index].promise;
        if (index === 1) throw error;
        return { id: index };
      },
    });
    await tick();
    gates[2].resolve();
    await tick();
    gates[1].resolve();
    await tick();
    gates[0].resolve();
    const results = await promise;
    expect(settled).toEqual(['c2', 'c1', 'c0']);
    expect(results).toEqual([
      { call_id: 'c0', status: 'fulfilled', value: { id: 0 } },
      { call_id: 'c1', status: 'rejected', reason: error },
      { call_id: 'c2', status: 'fulfilled', value: { id: 2 } },
    ]);
  });
  it('validates the entire offered/schema/context batch before any dispatch', async () => {
    const execute = jest.fn();
    await expect(
      run(scheduler, {
        execute,
        calls: [
          ...calls(7),
          { call_id: 'bad', tool_name: 'not_offered', arguments: {} },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULER_NOT_OFFERED' });
    expect(execute).not.toHaveBeenCalled();
    await expect(
      run(scheduler, {
        execute,
        validate: (call) => (call.call_id === 'c7' ? { ok: false } : true),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULER_INVALID_ARGS' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('requires explicit matching ALS and never adopts static fallback or a widened permission snapshot', async () => {
    const input = {
      objective_id: 'o',
      context: context(),
      calls: calls(1),
      offered_tools: [tool()],
      validate: () => true,
      execute: async () => 'ok',
    };
    RequestContextService.run(context(), () => undefined); // legacy fallback is not authority
    await expect(scheduler.executeBatch(input)).rejects.toMatchObject({
      code: 'SCHEDULER_CONTEXT',
    });
    await expect(
      RequestContextService.runIsolated(context(), () =>
        scheduler.executeBatch({ ...input, context: context(2) }),
      ),
    ).rejects.toMatchObject({ code: 'SCHEDULER_CONTEXT' });
    await expect(
      RequestContextService.runIsolated(context(), () =>
        scheduler.executeBatch({
          ...input,
          context: { ...context(), permissions: ['admin'] },
        }),
      ),
    ).rejects.toMatchObject({ code: 'SCHEDULER_CONTEXT' });
  });
  it('isolates two tenants and each mutable context clone, including permissions arrays', async () => {
    const gate = deferred();
    const observed: number[] = [];
    const execute = (expected: number) => async (call: ScheduledToolCall) => {
      const local = RequestContextService.asyncLocalStorage.getStore()!;
      expect(local.store_id).toBe(expected);
      expect(local.permissions).toEqual([`store${expected}.read`]);
      local.permissions!.push(`mutated${call.call_id}`);
      await gate.promise;
      expect(RequestContextService.asyncLocalStorage.getStore()).toBe(local);
      expect(local.store_id).toBe(expected);
      observed.push(local.store_id!);
      return call.call_id;
    };
    const firstContext = context(1),
      secondContext = context(2);
    const first = run(scheduler, {
      context: firstContext,
      calls: calls(3),
      execute: execute(1),
    });
    const second = run(scheduler, {
      context: secondContext,
      calls: calls(3),
      execute: execute(2),
    });
    await tick();
    gate.resolve();
    await Promise.all([first, second]);
    expect(observed.sort()).toEqual([1, 1, 1, 2, 2, 2]);
    expect(firstContext.permissions).toEqual(['store1.read']);
    expect(secondContext.permissions).toEqual(['store2.read']);
  });
  it('serializes server DAG dependencies and skips a failed dependent without erasing siblings', async () => {
    const events: string[] = [];
    const dependentCalls = calls(3).map((call, i) =>
      i ? { ...call, depends_on: [`c${i - 1}`] } : call,
    );
    const results = await run(scheduler, {
      calls: dependentCalls,
      execute: async (call) => {
        events.push(`start${call.call_id}`);
        await Promise.resolve();
        events.push(`end${call.call_id}`);
        if (call.call_id === 'c1') throw new Error('missing ID');
        return call.call_id;
      },
    });
    expect(events).toEqual(['startc0', 'endc0', 'startc1', 'endc1']);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toMatchObject({
      call_id: 'c2',
      status: 'rejected',
      reason: { code: 'SCHEDULER_DEPENDENCY_FAILED' },
    });
  });
  it('rejects unresolved, cyclic or forward dependencies before dispatch', async () => {
    const execute = jest.fn();
    for (const depends_on of [['missing'], ['c0'], ['c1']])
      await expect(
        run(scheduler, {
          calls: [{ ...calls(1)[0], depends_on }, calls(2)[1]],
          execute,
        }),
      ).rejects.toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
  it('serializes intersecting resource keys across objectives while other stores remain independent', async () => {
    const gate = deferred();
    let active = 0,
      max = 0;
    const execute = async () => {
      active++;
      max = Math.max(max, active);
      await gate.promise;
      active--;
      return 'ok';
    };
    const guarded = tool('get_order', {
      scheduling: { ...tool().scheduling!, resource_keys: ['stock:location'] },
    });
    const first = run(scheduler, {
      calls: calls(2),
      offered_tools: [guarded],
      execute,
    });
    const second = run(scheduler, {
      objective_id: 'o2',
      calls: calls(2),
      offered_tools: [guarded],
      execute,
    });
    await tick();
    expect(active).toBe(1);
    const other = run(scheduler, {
      context: context(2),
      calls: calls(1),
      offered_tools: [guarded],
      execute,
    });
    await tick();
    expect(active).toBe(2);
    gate.resolve();
    await Promise.all([first, second, other]);
    expect(max).toBe(2);
  });
  it('allows only one heavy query per store even across objectives', async () => {
    const gate = deferred();
    let active = 0,
      max = 0;
    const heavy = tool('get_order', {
      scheduling: { ...tool().scheduling!, heavy: true },
    });
    const execute = async () => {
      active++;
      max = Math.max(max, active);
      await gate.promise;
      active--;
      return 'ok';
    };
    const first = run(scheduler, {
      calls: calls(4),
      offered_tools: [heavy],
      execute,
    });
    const second = run(scheduler, {
      objective_id: 'o2',
      calls: calls(4),
      offered_tools: [heavy],
      execute,
    });
    await tick();
    expect(active).toBe(1);
    gate.resolve();
    await Promise.all([first, second]);
    expect(max).toBe(1);
  });
  it('enforces a separate configurable worker-wide cap', async () => {
    process.env.AI_PARALLEL_READS_GLOBAL_CAP = '2';
    const gate = deferred();
    let active = 0,
      max = 0;
    const execute = async () => {
      active++;
      max = Math.max(max, active);
      await gate.promise;
      active--;
      return 'ok';
    };
    const first = run(scheduler, { execute });
    const second = run(scheduler, { context: context(2), execute });
    await tick();
    expect(active).toBe(2);
    gate.resolve();
    await Promise.all([first, second]);
    expect(max).toBe(2);
  });
  it.each([
    tool('get_order', { scheduling: undefined }),
    tool('ui_navigate', { clientSide: true }),
    tool('vex_block_create'),
    tool('create_plan', { domain: 'planning' }),
    tool('write_order', { readOnly: false, requiresConfirmation: true }),
    tool('proposal', { requiresConfirmation: true }),
    tool('get_order', {
      scheduling: {
        ...tool().scheduling!,
        idempotent_read: false as unknown as true,
      },
    }),
  ])(
    'never parallelizes unaudited/UI/block/plan/write/proposal $name',
    async (definition) => {
      const gate = deferred();
      let active = 0,
        max = 0;
      const promise = run(scheduler, {
        offered_tools: [definition],
        calls: calls(4, definition.name),
        execute: async () => {
          active++;
          max = Math.max(max, active);
          await gate.promise;
          active--;
          return 'ok';
        },
      });
      await tick();
      expect(active).toBe(1);
      gate.resolve();
      await promise;
      expect(max).toBe(1);
    },
  );

  it('settles cancellation without waiting for non-cooperative handlers, retaining permits until their actual completion', async () => {
    const gate = deferred(),
      abort = new AbortController();
    let starts = 0;
    const late: string[] = [];
    const promise = run(scheduler, {
      signal: abort.signal,
      onLateResult: (result) => {
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.store_id,
        ).toBe(1);
        late.push(result.call_id);
      },
      execute: async () => {
        starts++;
        await gate.promise;
        return 'late';
      },
    });
    await tick();
    expect(starts).toBe(3);
    abort.abort();
    // This MUST resolve while gate is still closed, not merely after releasing it.
    const results = await promise;
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(starts).toBe(3);
    expect(late).toHaveLength(0);
    const blockedAbort = new AbortController();
    const blockedHandler = jest.fn(async () => 'must wait');
    const blocked = run(scheduler, {
      signal: blockedAbort.signal,
      calls: calls(1),
      execute: blockedHandler,
    });
    await tick();
    expect(blockedHandler).not.toHaveBeenCalled();
    blockedAbort.abort();
    await blocked;
    gate.resolve();
    await tick();
    expect(late.sort()).toEqual(['c0', 'c1', 'c2']);
    const after = await run(scheduler, {
      calls: calls(1),
      execute: blockedHandler,
    });
    expect(after[0].status).toBe('fulfilled');
    expect(blockedHandler).toHaveBeenCalledTimes(1);
    expect(late).toHaveLength(3); // exactly one audit callback per actual late fulfillment
  });
  it('enforces hard deadline for a never-resolving handler while the global permit remains occupied', async () => {
    jest.useFakeTimers();
    process.env.AI_PARALLEL_READS_GLOBAL_CAP = '1';
    const handler = jest.fn(() => new Promise<string>(() => undefined));
    const late = jest.fn();
    const promise = run(scheduler, {
      calls: calls(1),
      deadline_at: Date.now() + 25,
      execute: handler,
      onLateResult: late,
    });
    await tick();
    expect(handler).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(25);
    const result = await promise;
    expect(result[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'SCHEDULER_DEADLINE' },
    });
    const cancel = new AbortController(),
      nextHandler = jest.fn(async () => 'not permitted');
    const next = run(scheduler, {
      context: context(2),
      objective_id: 'another',
      calls: calls(1),
      signal: cancel.signal,
      execute: nextHandler,
    });
    await tick();
    expect(nextHandler).not.toHaveBeenCalled();
    cancel.abort();
    await next;
    expect(late).not.toHaveBeenCalled();
  });
  it('enforces audited max_result_bytes without silently slicing structured evidence', async () => {
    const small = tool('get_order', {
      scheduling: { ...tool().scheduling!, max_result_bytes: 5 },
    });
    const result = await run(scheduler, {
      calls: calls(1),
      offered_tools: [small],
      execute: async () => ({ data: 'oversize' }),
    });
    expect(result[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'SCHEDULER_RESULT_LIMIT' },
    });
  });
  it('does not let observer errors erase successful results', async () => {
    const results = await run(scheduler, {
      onSettled: () => {
        throw new Error('observer');
      },
    });
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
  it('offline fake-clock fan-out fixture reduces eight independent reads from 800ms to 300ms (not provider/runtime benchmark)', async () => {
    jest.useFakeTimers();
    const measure = async (cap: string) => {
      process.env.AI_PARALLEL_READS_OBJECTIVE_CAP = cap;
      const start = Date.now();
      const promise = run(new ToolSchedulerService(), {
        execute: async (call) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return call.call_id;
        },
      });
      await tick();
      await jest.runAllTimersAsync();
      await promise;
      return Date.now() - start;
    };
    const serial = await measure('1'),
      parallel = await measure('3');
    expect(serial).toBe(800);
    expect(parallel).toBe(300);
    expect(parallel).toBeLessThanOrEqual(serial * 0.7);
  });
});
