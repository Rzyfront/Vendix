import { BadRequestException, HttpException } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { BulkUploadHandlerRegistry } from './bulk-upload-handler.registry';
import { BulkUploadJobRunnerService } from './bulk-upload-job-runner.service';
import {
  emptyCursor,
  type BulkJobHandle,
  type BulkJobPageResult,
  type BulkJobType,
  type BulkUploadJobData,
  type BulkUploadJobHandler,
} from './bulk-upload-job.types';

const NOW = Date.parse('2026-11-17T10:00:00.000Z');

const makeData = (
  over: Partial<BulkUploadJobData> = {},
  type: BulkJobType = 'products',
): BulkUploadJobData => ({
  log_id: 7,
  upload_type: type,
  store_id: 9,
  organization_id: 3,
  user_id: 42,
  roles: ['owner'],
  permissions: ['store:products:create'],
  request_id: 'req-1',
  user: { id: 42 },
  file_name: 'productos.xlsx',
  file_hash: 'a'.repeat(64),
  params: { session_id: 's1' },
  cursor: emptyCursor(),
  enqueued_at: new Date(NOW).toISOString(),
  started_at: null,
  finished_at: null,
  deadline_at: new Date(NOW + 60 * 60 * 1000).toISOString(),
  retry: null,
  error: null,
  incident_ticket_number: null,
  ...over,
});

const page = (over: Partial<BulkJobPageResult> = {}): BulkJobPageResult => ({
  total: 100,
  successful: 100,
  failed: 0,
  skipped: 0,
  created: null,
  rows: [{ row_number: 1, status: 'success', product: { id: 1, huge: true } }],
  done: true,
  ...over,
});

describe('BulkUploadJobRunnerService', () => {
  let handler: jest.Mocked<BulkUploadJobHandler>;
  let updateMany: jest.Mock;
  let hashes: Map<string, Map<string, string>>;
  let redis: { hset: jest.Mock; expire: jest.Mock };
  let release: jest.Mock;
  let report: jest.Mock;
  let sleeps: number[];
  let runner: BulkUploadJobRunnerService;
  let now: number;

  const handle = (data: BulkUploadJobData): BulkJobHandle & { updates: BulkUploadJobData[] } => {
    const h: any = {
      id: `bulk-upload-${data.log_id}`,
      data,
      updates: [] as BulkUploadJobData[],
      updateData: jest.fn(async (next: BulkUploadJobData) => {
        h.data = next;
        h.updates.push(JSON.parse(JSON.stringify(next)));
      }),
    };
    return h;
  };

  const register = (type: BulkJobType, autoRetry: boolean) => {
    handler = {
      type,
      autoRetry,
      runPage: jest.fn(),
      cleanup: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<BulkUploadJobHandler>;
    const registry = new BulkUploadHandlerRegistry();
    registry.register(handler);
    runner = new BulkUploadJobRunnerService(
      registry,
      { bulk_upload_logs: { updateMany } } as never,
      redis as never,
      { release } as never,
      { report } as never,
    );
    runner.sleep = async (ms) => {
      sleeps.push(ms);
    };
    runner.now = () => now;
  };

  const lastLog = () => updateMany.mock.calls[updateMany.mock.calls.length - 1][0];

  beforeEach(() => {
    now = NOW;
    sleeps = [];
    hashes = new Map();
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    redis = {
      hset: jest.fn(async (key: string, field: string, value: string) => {
        if (!hashes.has(key)) hashes.set(key, new Map());
        hashes.get(key)!.set(field, value);
      }),
      expire: jest.fn().mockResolvedValue(1),
    };
    release = jest.fn().mockResolvedValue(undefined);
    report = jest
      .fn()
      .mockResolvedValue({ ticketNumber: 'INC-20261117-ABC123', created: true, emailed: 1 });
    register('products', true);
  });

  it('technical failure on a batch waits 2000 ms, retries and the job completes', async () => {
    handler.runPage
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(page());
    const job = handle(makeData());

    const outcome = await runner.run(job);

    expect(outcome).toBe('completed');
    expect(sleeps).toEqual([2000]);
    expect(handler.runPage).toHaveBeenCalledTimes(2);
    expect(handler.runPage).toHaveBeenNthCalledWith(1, expect.anything(), 0, 100);
    expect(handler.runPage).toHaveBeenNthCalledWith(2, expect.anything(), 0, 100);
    const retryUpdate = job.updates.find((u) => u.retry);
    expect(retryUpdate!.retry).toMatchObject({
      attempt: 1,
      max_attempts: 3,
      next_retry_at: new Date(NOW + 2000).toISOString(),
    });
    expect(job.data.retry).toBeNull();
    expect(job.data.error).toBeNull();
    expect(lastLog().data).toMatchObject({
      status: 'completed',
      total_rows: 100,
      successful_rows: 100,
      failed_rows: 0,
      skipped_rows: 0,
    });
    expect(report).not.toHaveBeenCalled();
    expect(handler.cleanup).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(9, 'products', 7);
  });

  it('treats 408 and 429 as technical (retried), unlike other 4xx', async () => {
    handler.runPage
      .mockRejectedValueOnce(new HttpException('rate', 429))
      .mockRejectedValueOnce(new HttpException('timeout', 408))
      .mockResolvedValueOnce(page());
    expect(await runner.run(handle(makeData()))).toBe('completed');
    expect(sleeps).toEqual([2000, 4000]);
  });

  it('3 retries exhausted -> failed technical, sleeps 2000/4000/8000, 1 incident, ticket in view data and result_reference', async () => {
    handler.runPage.mockRejectedValue(new Error('S3 down'));
    const job = handle(makeData());

    const outcome = await runner.run(job);

    expect(outcome).toBe('failed_technical');
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect(handler.runPage).toHaveBeenCalledTimes(4);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({
      dedupeKey: 'bulk-upload-job:7',
      source: 'bulk_upload_job',
      severity: 'critical',
      organizationId: 3,
      storeId: 9,
      userId: 42,
      correlationId: expect.stringContaining('bulk-upload-7'),
      // The raw technical message only goes to the e-mail, never to the ticket.
      internalDetails: { Mensaje: 'S3 down' },
    });
    expect(Object.values(report.mock.calls[0][0].details ?? {})).not.toContain('S3 down');
    expect(job.data.incident_ticket_number).toBe('INC-20261117-ABC123');
    expect(job.data.error).toMatchObject({ kind: 'technical' });
    expect(job.data.finished_at).not.toBeNull();
    expect(lastLog().data).toMatchObject({
      status: 'failed',
      result_reference: 'INC-20261117-ABC123',
    });
    // Temp files are kept for the manual retry; the lock is released.
    expect(handler.cleanup).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(9, 'products', 7);
  });

  it('data error (4xx) -> no sleep, no retry, failed data, no incident, files cleaned', async () => {
    handler.runPage.mockRejectedValue(
      new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED),
    );
    const job = handle(makeData());

    const outcome = await runner.run(job);

    expect(outcome).toBe('failed_data');
    expect(sleeps).toEqual([]);
    expect(handler.runPage).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    expect(job.data.error).toMatchObject({
      kind: 'data',
      code: ErrorCodes.BULK_PROD_SESSION_EXPIRED.code,
    });
    expect(job.data.incident_ticket_number).toBeNull();
    expect(lastLog().data).toMatchObject({ status: 'failed' });
    expect(lastLog().data.result_reference).toBeUndefined();
    expect(handler.cleanup).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(9, 'products', 7);
  });

  it('a plain BadRequestException is a data error too', async () => {
    handler.runPage.mockRejectedValue(new BadRequestException('offset fuera'));
    expect(await runner.run(handle(makeData()))).toBe('failed_data');
    expect(sleeps).toEqual([]);
  });

  it('customers (autoRetry=false): technical failure -> no retry, failed technical, incident, in-flight batch marked', async () => {
    register('customers', false);
    handler.runPage.mockRejectedValue(new Error('prisma timeout'));
    const job = handle(makeData({ upload_type: 'customers', cursor: emptyCursor(250) }, 'customers'));

    const outcome = await runner.run(job);

    expect(outcome).toBe('failed_technical');
    expect(sleeps).toEqual([]);
    expect(handler.runPage).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(job.data.cursor.in_flight_offset).toBe(0);
    expect(lastLog().data).toMatchObject({ status: 'failed', result_reference: 'INC-20261117-ABC123' });
    expect(handler.cleanup).not.toHaveBeenCalled();
  });

  it('customers with a pending in_flight_offset -> BULK_JOB_INTERRUPTED without calling the page', async () => {
    register('customers', false);
    const job = handle(
      makeData(
        {
          upload_type: 'customers',
          cursor: { ...emptyCursor(300), offset: 100, batch: 1, successful: 100, in_flight_offset: 100 },
        },
        'customers',
      ),
    );

    const outcome = await runner.run(job);

    expect(outcome).toBe('failed_technical');
    expect(handler.runPage).not.toHaveBeenCalled();
    expect(job.data.error).toMatchObject({
      kind: 'technical',
      code: 'BULK_JOB_INTERRUPTED',
    });
    expect(report).toHaveBeenCalledTimes(1);
    expect(lastLog().data).toMatchObject({ status: 'failed', successful_rows: 100 });
  });

  it('resume after a worker restart runs only the batches from cursor.offset and continues the totals', async () => {
    handler.runPage.mockResolvedValue(
      page({ total: 300, successful: 90, failed: 10, done: true }),
    );
    const job = handle(
      makeData({
        cursor: { ...emptyCursor(300), offset: 200, batch: 2, successful: 190, failed: 10 },
        started_at: new Date(NOW - 1000).toISOString(),
      }),
    );

    const outcome = await runner.run(job);

    expect(outcome).toBe('completed');
    expect(handler.runPage).toHaveBeenCalledTimes(1);
    expect(handler.runPage).toHaveBeenCalledWith(expect.anything(), 200, 100);
    expect(job.data.cursor).toMatchObject({
      offset: 300,
      batch: 3,
      successful: 280,
      failed: 20,
      total: 300,
      in_flight_offset: null,
    });
    // Absolute counts from the cursor, never increments.
    expect(lastLog().data).toMatchObject({
      status: 'partial',
      total_rows: 300,
      successful_rows: 280,
      failed_rows: 20,
    });
    // started_at survives the restart.
    expect(job.data.started_at).toBe(new Date(NOW - 1000).toISOString());
  });

  it('a job whose last batch was committed before the crash finalizes without running a page', async () => {
    const job = handle(
      makeData({
        cursor: { ...emptyCursor(200), offset: 200, batch: 2, successful: 200 },
      }),
    );
    expect(await runner.run(job)).toBe('completed');
    expect(handler.runPage).not.toHaveBeenCalled();
    expect(lastLog().data).toMatchObject({ status: 'completed', successful_rows: 200 });
  });

  it('commits the cursor after each batch, stores rows without nested objects and keeps absolute log counts', async () => {
    handler.runPage
      .mockResolvedValueOnce(page({ total: 250, successful: 95, failed: 5, created: 40, done: false, rows: [{ row_number: 1, status: 'success', warnings: ['a'], product: { id: 1 } }] }))
      .mockResolvedValueOnce(page({ total: 250, successful: 100, skipped: 0, created: 60, done: false, rows: [{ row_number: 101, status: 'success' }] }))
      .mockResolvedValueOnce(page({ total: 250, successful: 50, created: 10, done: true, rows: [{ row_number: 201, status: 'success' }] }));
    const job = handle(makeData());

    const outcome = await runner.run(job);

    expect(outcome).toBe('completed');
    expect(handler.runPage.mock.calls.map((c) => c[1])).toEqual([0, 100, 200]);
    const cursors = job.updates
      .map((u) => u.cursor)
      .filter((c, i, all) => c.batch > 0 && (i === 0 || all[i - 1].batch !== c.batch));
    expect(cursors.map((c) => [c.offset, c.batch, c.successful, c.failed, c.created])).toEqual([
      [100, 1, 95, 5, 40],
      [200, 2, 195, 5, 100],
      [300, 3, 245, 5, 110],
    ]);
    const logCounts = updateMany.mock.calls.map((c) => c[0].data.successful_rows);
    expect(logCounts.filter((n: number) => n > 0)).toEqual([95, 195, 245, 245]);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 7 });
    expect(updateMany.mock.calls[0][0].data.status).toBe('running');

    const hash = hashes.get('bulk-upload:job:7:results')!;
    expect([...hash.keys()]).toEqual(['0', '100', '200']);
    expect(JSON.parse(hash.get('0')!)).toEqual([
      { row_number: 1, status: 'success', warnings: ['a'] },
    ]);
    expect(redis.expire).toHaveBeenCalledWith('bulk-upload:job:7:results', 7 * 24 * 60 * 60);
    expect(lastLog().data).toMatchObject({ status: 'partial', created_rows: 110, total_rows: 250 });
  });

  it('keeps row_error flat (the screen reads column, value and suggestion) and drops nested objects like customer', async () => {
    register('customers', false);
    handler.runPage.mockResolvedValueOnce(
      page({
        total: 1,
        successful: 0,
        failed: 1,
        rows: [
          {
            row_number: 2,
            status: 'error',
            customer: { id: 5, password: 'hash' },
            row_error: {
              column: 'Correo',
              value: 'ana@',
              message: 'Correo inválido',
              suggestion: 'Revisa el formato',
              meta: { internal: true },
            },
          },
        ],
      }),
    );

    await runner.run(handle(makeData({}, 'customers')));

    const stored = JSON.parse(hashes.get('bulk-upload:job:7:results')!.get('0')!);
    expect(stored).toEqual([
      {
        row_number: 2,
        status: 'error',
        row_error: {
          column: 'Correo',
          value: 'ana@',
          message: 'Correo inválido',
          suggestion: 'Revisa el formato',
        },
      },
    ]);
  });

  it('if the database fails while recording a technical failure, the error surfaces but the lock is released', async () => {
    register('customers', false);
    handler.runPage.mockRejectedValueOnce(new Error('connection reset'));
    updateMany.mockImplementation(async (args: { data: { status: string } }) => {
      if (args.data.status === 'failed') throw new Error('db down');
      return { count: 1 };
    });

    await expect(runner.run(handle(makeData({}, 'customers')))).rejects.toThrow('db down');

    expect(report).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(9, 'customers', 7);
  });

  it('if the database fails while marking the job running, it fails technical: incident, view error and lock released', async () => {
    updateMany.mockRejectedValueOnce(new Error('db down at start'));
    const job = handle(makeData());

    const outcome = await runner.run(job);

    expect(outcome).toBe('failed_technical');
    expect(handler.runPage).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(job.data.error).toMatchObject({ kind: 'technical' });
    expect(job.data.incident_ticket_number).toBe('INC-20261117-ABC123');
    expect(lastLog().data).toMatchObject({ status: 'failed', result_reference: 'INC-20261117-ABC123' });
    expect(release).toHaveBeenCalledWith(9, 'products', 7);
  });

  it('customers: if Redis fails while marking the batch in flight, it fails technical and releases the lock', async () => {
    register('customers', false);
    const job = handle(makeData({ upload_type: 'customers', cursor: emptyCursor(250) }, 'customers'));
    const updateData = job.updateData as jest.Mock;
    const original = updateData.getMockImplementation()!;
    updateData.mockImplementation(async (next: BulkUploadJobData) => {
      if (next.cursor.in_flight_offset != null && next.error == null) {
        throw new Error('redis down');
      }
      return original(next);
    });

    const outcome = await runner.run(job);

    expect(outcome).toBe('failed_technical');
    expect(handler.runPage).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(9, 'customers', 7);
  });

  it('re-running a batch overwrites its hash field instead of duplicating rows', async () => {
    handler.runPage
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(page());
    await runner.run(handle(makeData()));
    expect(hashes.get('bulk-upload:job:7:results')!.size).toBe(1);
  });

  it('deadline exceeded before a batch -> BULK_JOB_TIMEOUT failed technical', async () => {
    now = NOW + 61 * 60 * 1000;
    const job = handle(makeData());

    const outcome = await runner.run(job);

    expect(outcome).toBe('failed_technical');
    expect(handler.runPage).not.toHaveBeenCalled();
    expect(job.data.error).toMatchObject({ kind: 'technical', code: 'BULK_JOB_TIMEOUT' });
    expect(report).toHaveBeenCalledTimes(1);
    expect(lastLog().data.status).toBe('failed');
  });

  it('a job without a registered handler fails technical', async () => {
    const empty = new BulkUploadJobRunnerService(
      new BulkUploadHandlerRegistry(),
      { bulk_upload_logs: { updateMany } } as never,
      redis as never,
      { release } as never,
      { report } as never,
    );
    const job = handle(makeData());
    expect(await empty.run(job)).toBe('failed_technical');
    expect(job.data.error).toMatchObject({ kind: 'technical', code: 'BULK_JOB_NO_HANDLER' });
  });
});
