import { Queue } from 'bullmq';
import { PlatformAlertJobWatcherService, WORKER_HEARTBEAT_KEY } from './platform-alert-job-watcher.service';

/** Instancia de `Queue` sin conexión: solo los métodos que lee el barrido. */
function fakeQueue(name: string, over: Partial<Record<string, jest.Mock>> = {}): Queue {
  const queue = Object.create(Queue.prototype) as Queue;
  Object.defineProperty(queue, 'name', { value: name });
  Object.assign(queue, {
    getFailed: jest.fn().mockResolvedValue([]),
    getActive: jest.fn().mockResolvedValue([]),
    getJobCounts: jest.fn().mockResolvedValue({ wait: 0, prioritized: 0, active: 0 }),
    getJobs: jest.fn().mockResolvedValue([]),
    isPaused: jest.fn().mockResolvedValue(false),
    ...over,
  });
  return queue;
}

describe('PlatformAlertJobWatcherService', () => {
  let store: Map<string, string>;
  let capture: jest.Mock;
  let resolveGroup: jest.Mock;
  let resolveMissing: jest.Mock;
  let queues: Queue[];

  const redis = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string, ...rest: unknown[]) => {
      if (rest.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
  const settings = {
    enabled: true,
    jobActiveStallMinutes: 15,
    jobWaitingStallMinutes: 5,
    workerHeartbeatMaxMinutes: 3,
  };
  const build = () =>
    new PlatformAlertJobWatcherService(
      { getProviders: () => queues.map((instance) => ({ instance })) } as never,
      { settings, capture, resolveGroup, resolveMissingConditions: resolveMissing } as never,
      redis as never,
    );

  beforeEach(() => {
    store = new Map();
    capture = jest.fn();
    resolveGroup = jest.fn();
    resolveMissing = jest.fn();
    queues = [];
  });

  it('no barre las colas que ya avisan por incidente (IA, cargas masivas)', () => {
    queues = [fakeQueue('ai-scan'), fakeQueue('email-notifications')];
    expect(build().discoverQueues().map((q) => q.name)).toEqual(['email-notifications']);
  });

  it('jobs fallidos: el primer barrido solo marca; luego reporta los nuevos con tienda y sin data', async () => {
    const failed = [
      { id: '1', name: 'charge', finishedOn: 1000, failedReason: 'card 4111111111111111 declined', attemptsMade: 3, data: { store_id: 4, email: 'a@b.co' } },
    ];
    const getFailed = jest.fn().mockResolvedValue(failed);
    queues = [fakeQueue('subscription-billing', { getFailed })];
    const watcher = build();
    await watcher.sweepQueues(5000);
    expect(capture).not.toHaveBeenCalled();

    failed.unshift({ ...failed[0], id: '2', finishedOn: 2000 });
    await watcher.sweepQueues(6000);
    expect(capture).toHaveBeenCalledTimes(1);
    const event = capture.mock.calls[0][0];
    expect(event).toMatchObject({
      source: 'job',
      process: 'cola subscription-billing · charge',
      severity: 'critical',
      storeId: 4,
    });
    expect(JSON.stringify(event)).not.toContain('a@b.co');
  });

  it('job activo colgado: cuenta una vez y los barridos siguientes solo lo mantienen abierto', async () => {
    const now = 60 * 60_000;
    const active = [{ id: '9', name: 'send', processedOn: now - 20 * 60_000, data: {} }];
    queues = [fakeQueue('email-notifications', { getActive: jest.fn().mockResolvedValue(active) })];
    const watcher = build();
    await watcher.sweepQueues(now);
    await watcher.sweepQueues(now + 60_000);
    expect(capture.mock.calls.map(([e]) => e.alreadyCounted)).toEqual([false, true]);
    expect(capture.mock.calls[0][0]).toMatchObject({ source: 'job_stalled', severity: 'warning' });
    expect(resolveMissing).toHaveBeenCalledWith(['job_stalled', 'queue_stalled'], expect.any(Set));
  });

  it('cola con trabajo esperando y sin worker: grave tras confirmarse en dos barridos', async () => {
    const now = 60 * 60_000;
    queues = [
      fakeQueue('email-notifications', {
        getJobCounts: jest.fn().mockResolvedValue({ wait: 4, prioritized: 0, active: 0 }),
        getJobs: jest.fn().mockResolvedValue([{ id: '1', timestamp: now - 10 * 60_000, delay: 0 }]),
      }),
    ];
    const watcher = build();
    await watcher.sweepQueues(now);
    expect(capture).not.toHaveBeenCalled();
    await watcher.sweepQueues(now + 60_000);
    expect(capture.mock.calls[0][0]).toMatchObject({
      source: 'queue_stalled',
      severity: 'critical',
      errorType: 'queue_without_worker',
    });
  });

  it('latido: sin latido reciente alerta grave; con latido cierra la alerta', async () => {
    const watcher = build();
    store.set(WORKER_HEARTBEAT_KEY, String(1_000));
    await watcher.checkWorkerHeartbeat(1_000 + 4 * 60_000);
    expect(capture.mock.calls[0][0]).toMatchObject({ source: 'worker', severity: 'critical' });

    store.set(WORKER_HEARTBEAT_KEY, String(10_000_000));
    await watcher.checkWorkerHeartbeat(10_000_000 + 60_000);
    expect(resolveGroup).toHaveBeenCalledWith('worker|heartbeat', 'recovered');
  });
});
