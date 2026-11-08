// The executor pulls the SMS provider (a package missing from some installs); actions are mocked here.
jest.mock('./workflow-actions.executor', () => ({ WorkflowActionsExecutor: class {} }));

import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { seedPeople } from '../../../../testing/workflows/workflow-test-kit';
import {
  DISPATCHER_HEARTBEAT_KEY,
  DISPATCHER_HEARTBEAT_TTL_SECONDS,
  OUTBOX_BATCH,
} from './workflow-outbox.dispatcher.constants';
import { WorkflowOutboxDispatcher } from './workflow-outbox.dispatcher';

describe('WorkflowOutboxDispatcher · P7.4 drain, processed_at and heartbeat', () => {
  let db: FakeWorkflowDb;
  const engine = { tick: jest.fn(), onActionDead: jest.fn() };
  const actions = { execute: jest.fn(), recordFailure: jest.fn() };
  const redis = { set: jest.fn() };
  const past = () => new Date(Date.now() - 60_000);
  const rows = () => db.table('workflow_outbox');
  const enqueue = (kind: string, payload: Record<string, unknown> = { instance_id: 1 }) =>
    db.insert('workflow_outbox', {
      store_id: 1, instance_id: 1, kind, payload, available_at: past(), created_at: new Date(),
    });

  const build = (withRedis = true) =>
    new WorkflowOutboxDispatcher(
      db.asStorePrisma(),
      engine as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      actions as any,
      {} as any,
      {} as any,
      {} as any,
      withRedis ? (redis as any) : undefined,
    );

  beforeEach(() => {
    db = new FakeWorkflowDb();
    seedPeople(db);
    db.insert('workflow_instances', {
      id: 1, store_id: 1, organization_id: 1, reference: 'FLU-000001', title: 'Compra',
      current_stage_key: 'a', stage_entry_seq: 1, started_by_type: 'user', started_by_id: 1,
    });
    engine.tick.mockReset().mockResolvedValue({ action: 'advanced' });
    engine.onActionDead.mockReset().mockResolvedValue(undefined);
    actions.execute.mockReset();
    actions.recordFailure.mockReset().mockResolvedValue(undefined);
    redis.set.mockReset().mockResolvedValue('OK');
  });

  it('sets processed_at when a row reaches done', async () => {
    enqueue('advance');
    await build().dispatchBatch();
    expect(rows()[0].status).toBe('done');
    expect(rows()[0].processed_at).toBeInstanceOf(Date);
  });

  it('sets processed_at when a row reaches dead and leaves a retried row without it', async () => {
    actions.execute.mockRejectedValue(new Error('caído'));
    enqueue('action', { action: 'vendix.crm_task.create', max_attempts: 1 });
    enqueue('action', { action: 'vendix.crm_task.create' });
    await build().dispatchBatch();
    const [dead, retried] = rows();
    expect(dead).toMatchObject({ status: 'dead' });
    expect(dead.processed_at).toBeInstanceOf(Date);
    expect(retried).toMatchObject({ status: 'pending' });
    expect(retried.processed_at ?? null).toBeNull();
  });

  it('keeps the previous behavior: a due row is claimed once and ends done without redis wired', async () => {
    enqueue('advance');
    const summary = await build(false).dispatchBatch();
    expect(summary).toMatchObject({ claimed: 1, done: 1, retried: 0, dead: 0 });
    expect(rows()[0]).toMatchObject({ status: 'done', attempts: 1, last_error: null });
    await expect(build(false).handle()).resolves.toBeUndefined();
  });

  it('drains several batches in one cycle until the queue has no due rows', async () => {
    const total = OUTBOX_BATCH * 2 + 5;
    for (let i = 0; i < total; i++) enqueue('advance');
    const result = await build().drain();
    expect(result.processed).toBe(total);
    expect(result.batches).toBe(4);
    expect(rows().every((r) => r.status === 'done')).toBe(true);
  });

  it('stops draining when the time budget is spent even if rows remain', async () => {
    for (let i = 0; i < OUTBOX_BATCH * 3; i++) enqueue('advance');
    let now = 0;
    const clock = () => (now += 40_000);
    const result = await build().drain(50_000, clock);
    expect(result.batches).toBe(2);
    expect(result.processed).toBe(OUTBOX_BATCH * 2);
    expect(rows().filter((r) => r.status === 'pending')).toHaveLength(OUTBOX_BATCH);
  });

  it('writes the heartbeat at the end of every cycle, empty ones included', async () => {
    await build().handle();
    enqueue('advance');
    enqueue('advance');
    await build().handle();
    expect(redis.set).toHaveBeenCalledTimes(2);
    const [key, value, mode, ttl] = redis.set.mock.calls[1];
    expect(key).toBe(DISPATCHER_HEARTBEAT_KEY);
    expect(mode).toBe('EX');
    expect(ttl).toBe(DISPATCHER_HEARTBEAT_TTL_SECONDS);
    expect(JSON.parse(value)).toMatchObject({ processed: 2, batches: 2 });
    expect(JSON.parse(value).duration_ms).toEqual(expect.any(Number));
    expect(Date.parse(JSON.parse(value).at)).not.toBeNaN();
    expect(JSON.parse(redis.set.mock.calls[0][1])).toMatchObject({ processed: 0, batches: 1 });
  });

  it('a cycle that fails leaves no heartbeat, so a dispatcher failing every cycle ages and alerts', async () => {
    const dispatcher = build();
    jest.spyOn(dispatcher, 'drain').mockRejectedValue(new Error('base caída'));
    await expect(dispatcher.handle()).resolves.toBeUndefined();
    expect(redis.set).not.toHaveBeenCalled();
    enqueue('advance');
    await build().handle();
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('never overlaps two cycles: the second call returns without running or beating', async () => {
    enqueue('advance');
    let release!: () => void;
    engine.tick.mockImplementation(() => new Promise((resolve) => { release = () => resolve({}); }));
    const dispatcher = build();
    const first = dispatcher.handle();
    while (engine.tick.mock.calls.length === 0) await new Promise((r) => setImmediate(r));
    await dispatcher.handle();
    expect(redis.set).not.toHaveBeenCalled();
    release();
    await first;
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('a Redis failure never fails the cycle', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));
    enqueue('advance');
    await expect(build().handle()).resolves.toBeUndefined();
    expect(rows()[0].status).toBe('done');
  });
});
