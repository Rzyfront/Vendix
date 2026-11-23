import { RequestContextService } from '@common/context/request-context.service';
import { BulkUploadJobLockService } from './bulk-upload-job-lock.service';
import { BulkUploadJobsService } from './bulk-upload-jobs.service';
import {
  emptyCursor,
  type BulkUploadJobData,
} from './bulk-upload-job.types';

const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const STORE = 9;

type Row = Record<string, any>;

describe('BulkUploadJobsService', () => {
  let rows: Row[];
  let nextId: number;
  let kv: Map<string, string>;
  let hashes: Map<string, Record<string, string>>;
  let redis: any;
  let jobs: Map<string, any>;
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let report: jest.Mock;
  let service: BulkUploadJobsService;

  const matches = (row: Row, where: Row) =>
    row.store_id === STORE && // emulates the scoped client injecting store_id
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'in' in (v as object)
        ? (v as any).in.includes(row[k])
        : row[k] === v,
    );

  const prisma = {
    bulk_upload_logs: {
      create: jest.fn(async ({ data }) => {
        const row = { id: nextId++, store_id: STORE, created_at: new Date(NOW), updated_at: new Date(NOW), result_reference: null, created_rows: null, successful_rows: 0, failed_rows: 0, skipped_rows: 0, ...data };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }) => rows.find((r) => matches(r, where)) ?? null),
      updateMany: jest.fn(async ({ where, data }) => {
        rows.filter((r) => matches(r, where)).forEach((r) => Object.assign(r, data));
        return { count: 1 };
      }),
      deleteMany: jest.fn(async ({ where }) => {
        rows = rows.filter((r) => !matches(r, where));
        return { count: 1 };
      }),
    },
  };

  const seedRow = (over: Row = {}): Row => {
    const row = {
      id: nextId++,
      store_id: STORE,
      user_id: 42,
      upload_type: 'products',
      file_name: 'p.xlsx',
      file_hash: 'a'.repeat(64),
      total_rows: 300,
      successful_rows: 100,
      failed_rows: 0,
      skipped_rows: 0,
      created_rows: null,
      status: 'running',
      result_reference: null,
      created_at: new Date(NOW - 1000),
      updated_at: new Date(NOW - 1000),
      ...over,
    };
    rows.push(row);
    return row;
  };

  const seedJob = (row: Row, state: string, over: Partial<BulkUploadJobData> = {}) => {
    const job: any = {
      id: `bulk-upload-${row.id}`,
      data: {
        log_id: row.id,
        upload_type: row.upload_type,
        store_id: STORE,
        organization_id: 3,
        user_id: 42,
        roles: [],
        permissions: [],
        user: { id: 42 },
        file_name: row.file_name,
        file_hash: row.file_hash,
        params: {},
        cursor: { ...emptyCursor(300), offset: 100, batch: 1, successful: 100 },
        enqueued_at: new Date(NOW - 1000).toISOString(),
        started_at: new Date(NOW - 900).toISOString(),
        finished_at: null,
        deadline_at: new Date(NOW + 3_000_000).toISOString(),
        retry: null,
        error: null,
        incident_ticket_number: null,
        ...over,
      },
      getState: jest.fn(async () => state),
      updateData: jest.fn(async (d: any) => {
        job.data = d;
      }),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    jobs.set(job.id, job);
    return job;
  };

  const seedJobFromQueue = (id: string, data: BulkUploadJobData) => {
    const job: any = {
      id,
      data,
      getState: jest.fn(async () => 'waiting'),
      updateData: jest.fn(async (d: any) => {
        job.data = d;
      }),
      retry: jest.fn(),
    };
    jobs.set(id, job);
    return job;
  };

  const inContext = <T>(fn: () => Promise<T>) =>
    RequestContextService.runIsolated(
      {
        is_super_admin: false,
        is_owner: false,
        store_id: STORE,
        organization_id: 3,
        user_id: 42,
        roles: ['owner'],
        permissions: ['store:products:create'],
        request_id: 'req-1',
      },
      fn,
    );

  const enqueue = () =>
    inContext(() =>
      service.enqueue({
        upload_type: 'products',
        file_name: 'productos.xlsx',
        file_hash: 'b'.repeat(64),
        params: { session_id: 's1' },
        user: { id: 42 },
      }),
    );

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    rows = [];
    nextId = 1;
    kv = new Map();
    hashes = new Map();
    jobs = new Map();
    redis = {
      set: jest.fn(async (k: string, v: string, ...rest: unknown[]) => {
        if (rest.includes('NX') && kv.has(k)) return null;
        kv.set(k, v);
        return 'OK';
      }),
      get: jest.fn(async (k: string) => kv.get(k) ?? null),
      eval: jest.fn(async (_s: string, _n: number, k: string, v: string) => {
        if (kv.get(k) === v) {
          kv.delete(k);
          return 1;
        }
        return 0;
      }),
      hgetall: jest.fn(async (k: string) => hashes.get(k) ?? {}),
    };
    queue = {
      add: jest.fn(async (_n: string, data: any, opts: any) => {
        return seedJobFromQueue(opts.jobId, data);
      }),
      getJob: jest.fn(async (id: string) => jobs.get(id)),
    };
    report = jest
      .fn()
      .mockResolvedValue({ ticketNumber: 'INC-20261117-ZZZ999', created: true, emailed: 1 });
    Object.values(prisma.bulk_upload_logs).forEach((m) => (m as jest.Mock).mockClear());
    service = new BulkUploadJobsService(
      queue as never,
      prisma as never,
      redis as never,
      new BulkUploadJobLockService(redis as never),
      { report } as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('enqueue', () => {
    it('creates a queued row, takes the lock and adds the BullMQ job with the tenant snapshot', async () => {
      const view = await enqueue();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'queued', upload_type: 'products', user_id: 42 });
      expect(kv.get(`bulk-upload:active:${STORE}:products`)).toBe(String(rows[0].id));
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = queue.add.mock.calls[0];
      expect(name).toBe('run');
      expect(opts).toMatchObject({
        jobId: `bulk-upload-${rows[0].id}`,
        attempts: 1,
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      });
      expect(data).toMatchObject({
        log_id: rows[0].id,
        store_id: STORE,
        organization_id: 3,
        user_id: 42,
        roles: ['owner'],
        permissions: ['store:products:create'],
        params: { session_id: 's1' },
        deadline_at: new Date(NOW + 60 * 60 * 1000).toISOString(),
        cursor: { offset: 0, batch: 0, in_flight_offset: null },
      });
      expect(view).toMatchObject({
        id: rows[0].id,
        status: 'queued',
        upload_type: 'products',
        auto_retry: true,
        can_retry: false,
        processed_rows: 0,
        incident_ticket_number: null,
      });
    });

    it('second enqueue for the same store+type while active -> 409 BULK_JOB_ALREADY_ACTIVE with the holder id, and no leftover row', async () => {
      const first = await enqueue();
      await expect(enqueue()).rejects.toMatchObject({
        errorCode: 'BULK_JOB_ALREADY_ACTIVE',
        status: 409,
        response: { details: { job_id: first.id } },
      });
      expect(rows).toHaveLength(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('a stale lock (holder row already terminal) is released and the enqueue succeeds', async () => {
      const stale = seedRow({ status: 'completed' });
      kv.set(`bulk-upload:active:${STORE}:products`, String(stale.id));

      const view = await enqueue();

      expect(view.status).toBe('queued');
      expect(kv.get(`bulk-upload:active:${STORE}:products`)).toBe(String(view.id));
    });

    it('a stale lock whose holder row no longer exists is released too', async () => {
      kv.set(`bulk-upload:active:${STORE}:products`, '9999');
      const view = await enqueue();
      expect(kv.get(`bulk-upload:active:${STORE}:products`)).toBe(String(view.id));
    });

    it('a lock held by a running row without BullMQ job is reconciled (failed technical) and released, then the enqueue succeeds', async () => {
      const ghost = seedRow({ status: 'running' });
      kv.set(`bulk-upload:active:${STORE}:products`, String(ghost.id));

      const view = await enqueue();

      expect(rows.find((r) => r.id === ghost.id)!.status).toBe('failed');
      expect(view.id).not.toBe(ghost.id);
    });

    it('a queued row whose BullMQ job is not there yet (just enqueued) is not reconciled', async () => {
      const fresh = seedRow({ status: 'queued', created_at: new Date(NOW - 5000) });
      kv.set(`bulk-upload:active:${STORE}:products`, String(fresh.id));
      await expect(enqueue()).rejects.toMatchObject({ errorCode: 'BULK_JOB_ALREADY_ACTIVE' });
      expect(rows.find((r) => r.id === fresh.id)!.status).toBe('queued');
      expect(report).not.toHaveBeenCalled();
    });

    it('queue failure -> 503 BULK_JOB_ENQUEUE_FAILED, lock released, row removed', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(enqueue()).rejects.toMatchObject({
        errorCode: 'BULK_JOB_ENQUEUE_FAILED',
        status: 503,
      });
      expect(kv.has(`bulk-upload:active:${STORE}:products`)).toBe(false);
      expect(rows).toHaveLength(0);
    });
  });

  describe('read', () => {
    it('a job row of another store and an unknown id answer the same 404 BULK_JOB_NOT_FOUND', async () => {
      const foreign = seedRow({ store_id: 10 });
      await expect(inContext(() => service.getView(foreign.id))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_NOT_FOUND',
        status: 404,
      });
      await expect(inContext(() => service.getView(98765))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_NOT_FOUND',
        status: 404,
      });
      await expect(inContext(() => service.getResults(foreign.id))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_NOT_FOUND',
      });
    });

    it('builds the view from the row counts and the job cursor', async () => {
      const row = seedRow({ status: 'running', total_rows: 250, successful_rows: 95, failed_rows: 5, skipped_rows: 0, created_rows: 40 });
      seedJob(row, 'active', {
        cursor: { ...emptyCursor(250), offset: 100, batch: 1, successful: 95, failed: 5, created: 40 },
        retry: { attempt: 1, max_attempts: 3, next_retry_at: new Date(NOW + 2000).toISOString(), message: 'x' },
      });

      const view = await inContext(() => service.getView(row.id));

      expect(view).toMatchObject({
        id: row.id,
        status: 'running',
        total_rows: 250,
        processed_rows: 100,
        successful_rows: 95,
        failed_rows: 5,
        created_rows: 40,
        batch_current: 1,
        batch_total: 3,
        can_retry: false,
        retry: { attempt: 1, max_attempts: 3 },
        deadline_at: expect.any(String),
      });
    });

    it('reconcile-on-read marks a running row without a BullMQ job as failed technical (+ incident, lock released)', async () => {
      const row = seedRow({ status: 'running' });
      kv.set(`bulk-upload:active:${STORE}:products`, String(row.id));

      const view = await inContext(() => service.getView(row.id));

      expect(view.status).toBe('failed');
      expect(view.error).toMatchObject({ kind: 'technical', code: 'BULK_JOB_INTERRUPTED' });
      expect(view.incident_ticket_number).toBe('INC-20261117-ZZZ999');
      expect(view.can_retry).toBe(false); // no job left in BullMQ to resume
      expect(rows[0]).toMatchObject({ status: 'failed', result_reference: 'INC-20261117-ZZZ999' });
      expect(report).toHaveBeenCalledTimes(1);
      expect(kv.has(`bulk-upload:active:${STORE}:products`)).toBe(false);
    });

    it('reconcile-on-read: BullMQ job stalled out (failed state) while the row says running -> failed technical, retryable', async () => {
      const row = seedRow({ status: 'running' });
      const job = seedJob(row, 'failed');

      const view = await inContext(() => service.getView(row.id));

      expect(view).toMatchObject({ status: 'failed', can_retry: true });
      expect(view.error).toMatchObject({ kind: 'technical' });
      expect(job.data.error).toMatchObject({ kind: 'technical' });
      expect(job.data.incident_ticket_number).toBe('INC-20261117-ZZZ999');
    });

    it('reconcile-on-read: a row overdue by more than 5 minutes is failed technical BULK_JOB_TIMEOUT', async () => {
      const row = seedRow({ status: 'running' });
      seedJob(row, 'active', { deadline_at: new Date(NOW - 6 * 60 * 1000).toISOString() });

      const view = await inContext(() => service.getView(row.id));

      expect(view.status).toBe('failed');
      expect(view.error).toMatchObject({ code: 'BULK_JOB_TIMEOUT' });
    });

    it('an overdue row within the 5 minute grace stays running', async () => {
      const row = seedRow({ status: 'running' });
      seedJob(row, 'active', { deadline_at: new Date(NOW - 4 * 60 * 1000).toISOString() });
      expect((await inContext(() => service.getView(row.id))).status).toBe('running');
      expect(report).not.toHaveBeenCalled();
    });

    it('getActive returns the active job of the store+type or null', async () => {
      expect(await inContext(() => service.getActive('products'))).toBeNull();
      const row = seedRow({ status: 'running' });
      seedJob(row, 'active');
      const active = await inContext(() => service.getActive('products'));
      expect(active?.id).toBe(row.id);
      expect(await inContext(() => service.getActive('customers'))).toBeNull();
    });

    it('getResults returns the rows in file order (hash fields sorted numerically)', async () => {
      const row = seedRow({ status: 'completed' });
      hashes.set(`bulk-upload:job:${row.id}:results`, {
        '100': JSON.stringify([{ row_number: 101, status: 'success' }]),
        '0': JSON.stringify([{ row_number: 1, status: 'success' }, { row_number: 2, status: 'error' }]),
        '200': JSON.stringify([{ row_number: 201, status: 'success' }]),
      });
      const result = await inContext(() => service.getResults(row.id));
      expect(result.rows.map((r) => r.row_number)).toEqual([1, 2, 101, 201]);
    });
  });

  describe('retry', () => {
    const failedTechnical = (state = 'failed') => {
      const row = seedRow({ status: 'failed', result_reference: 'INC-1' });
      const job = seedJob(row, state, {
        error: { kind: 'technical', code: null, message: 'x' },
        incident_ticket_number: 'INC-1',
        finished_at: new Date(NOW - 500).toISOString(),
        deadline_at: new Date(NOW - 3_000_000).toISOString(),
        cursor: { ...emptyCursor(300), offset: 100, batch: 1, successful: 100, in_flight_offset: 100 },
      });
      return { row, job };
    };

    it('retries a failed technical job: new deadline, error cleared, in-flight cleared, row queued, lock taken, job.retry called', async () => {
      const { row, job } = failedTechnical();

      const view = await inContext(() => service.retry(row.id));

      expect(job.data.error).toBeNull();
      expect(job.data.cursor).toMatchObject({ offset: 100, in_flight_offset: null });
      expect(job.data.deadline_at).toBe(new Date(NOW + 60 * 60 * 1000).toISOString());
      expect(job.retry).toHaveBeenCalledWith('failed');
      expect(rows.find((r) => r.id === row.id)!.status).toBe('queued');
      expect(kv.get(`bulk-upload:active:${STORE}:products`)).toBe(String(row.id));
      expect(view.status).toBe('queued');
    });

    it('rejects a completed job with 409 BULK_JOB_NOT_RETRYABLE', async () => {
      const row = seedRow({ status: 'completed' });
      seedJob(row, 'completed');
      await expect(inContext(() => service.retry(row.id))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_NOT_RETRYABLE',
        status: 409,
      });
    });

    it('rejects a failed DATA job with 409 BULK_JOB_NOT_RETRYABLE', async () => {
      const row = seedRow({ status: 'failed' });
      const job = seedJob(row, 'completed', { error: { kind: 'data', code: 'X', message: 'x' } });
      await expect(inContext(() => service.retry(row.id))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_NOT_RETRYABLE',
      });
      expect(job.retry).not.toHaveBeenCalled();
    });

    it('rejects a failed technical job whose BullMQ job is gone', async () => {
      const row = seedRow({ status: 'failed' });
      await expect(inContext(() => service.retry(row.id))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_NOT_RETRYABLE',
      });
    });

    it('rejects with 409 BULK_JOB_ALREADY_ACTIVE when another job of the type is active, leaving the failed job untouched', async () => {
      const { row, job } = failedTechnical();
      const other = seedRow({ status: 'running' });
      seedJob(other, 'active');
      kv.set(`bulk-upload:active:${STORE}:products`, String(other.id));

      await expect(inContext(() => service.retry(row.id))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_ALREADY_ACTIVE',
        response: { details: { job_id: other.id } },
      });
      expect(job.retry).not.toHaveBeenCalled();
      expect(rows.find((r) => r.id === row.id)!.status).toBe('failed');
    });

    it('a job of another store cannot be retried (404)', async () => {
      const foreign = seedRow({ store_id: 10, status: 'failed' });
      await expect(inContext(() => service.retry(foreign.id))).rejects.toMatchObject({
        errorCode: 'BULK_JOB_NOT_FOUND',
      });
    });
  });
});
