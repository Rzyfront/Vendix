import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { CustomersBulkJobHandler } from './customers-bulk-job.handler';
import { CustomersBulkController } from './customers-bulk.controller';
import { CustomersBulkService } from './customers-bulk.service';
import { BulkCustomersJobDto } from './dto/bulk-customers-job.dto';
import { sha256Hex } from '../bulk-uploads/bulk-file-fingerprint.util';

const rows = [
  { first_name: 'Ana', document_type: 'CC', document_number: '1012345671' },
  { first_name: 'Luis', document_type: 'CC', document_number: '1012345672' },
  { first_name: 'Eva', document_type: 'CC', document_number: '1012345673' },
];

const data: any = {
  store_id: 5,
  user: { id: 9 },
  params: { s3_key: 'tmp/bulk-customers/5/abc.json' },
};

function makeS3(overrides: Record<string, jest.Mock> = {}) {
  return {
    uploadFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    downloadFile: jest
      .fn()
      .mockResolvedValue(Buffer.from(JSON.stringify(rows))),
    ...overrides,
  };
}

/** QUI-1009 — la carga de clientes corre como trabajo pero nunca se reintenta sola. */
describe('CustomersBulkJobHandler (QUI-1009)', () => {
  it('declares itself non idempotent: no automatic retry', () => {
    const handler = new CustomersBulkJobHandler({} as any, {} as any);
    expect(handler.type).toBe('customers');
    expect(handler.autoRetry).toBe(false);
  });

  it('stages the rows under the store of the context', async () => {
    const s3 = makeS3();
    const handler = new CustomersBulkJobHandler({} as any, s3 as any);

    const key = await RequestContextService.run({ store_id: 5 } as any, () =>
      handler.stageRows(rows as any),
    );

    expect(key).toMatch(/^tmp\/bulk-customers\/5\/[0-9a-f-]{36}\.json$/);
    expect(s3.uploadFile).toHaveBeenCalledWith(
      Buffer.from(JSON.stringify(rows)),
      key,
      'application/json',
    );
  });

  it('S3 down while staging the rows -> 503 BULK_JOB_ENQUEUE_FAILED, not a raw 500', async () => {
    const s3 = makeS3({
      uploadFile: jest.fn().mockRejectedValue(
        Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }),
      ),
    });
    const handler = new CustomersBulkJobHandler({} as any, s3 as any);

    const error = await RequestContextService.run({ store_id: 5 } as any, () =>
      handler.stageRows(rows as any),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).getStatus()).toBe(503);
    expect((error as VendixHttpException).errorCode).toBe('BULK_JOB_ENQUEUE_FAILED');
  });

  it('runs the page window over the staged rows, downloading the file once', async () => {
    const s3 = makeS3();
    const bulk = {
      uploadCustomers: jest.fn().mockResolvedValue({
        total_processed: 2,
        successful: 2,
        failed: 0,
        results: [
          { status: 'success', row_number: 1 },
          { status: 'success', row_number: 2 },
        ],
      }),
    };
    const handler = new CustomersBulkJobHandler(bulk as any, s3 as any);

    const first = await handler.runPage(data, 0, 2);
    expect(bulk.uploadCustomers).toHaveBeenLastCalledWith({
      customers: rows.slice(0, 2),
    });
    expect(first.total).toBe(3);
    expect(first.done).toBe(false);

    const last = await handler.runPage(data, 2, 2);
    expect(bulk.uploadCustomers).toHaveBeenLastCalledWith({
      customers: rows.slice(2),
    });
    expect(last.done).toBe(true);
    expect(s3.downloadFile).toHaveBeenCalledTimes(1);

    await handler.cleanup(data);
    expect(s3.deleteFile).toHaveBeenCalledWith(data.params.s3_key);
  });

  it('a missing staged file is a data error; any other S3 failure stays technical', async () => {
    const missing = new CustomersBulkJobHandler(
      { uploadCustomers: jest.fn() } as any,
      makeS3({
        downloadFile: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('gone'), { name: 'NoSuchKey' })),
      }) as any,
    );
    await expect(missing.runPage(data, 0, 100)).rejects.toMatchObject({
      errorCode: 'BULK_PROD_SESSION_EXPIRED',
    });

    const outage = new Error('S3 timeout');
    const down = new CustomersBulkJobHandler(
      { uploadCustomers: jest.fn() } as any,
      makeS3({ downloadFile: jest.fn().mockRejectedValue(outage) }) as any,
    );
    await expect(down.runPage(data, 0, 100)).rejects.toBe(outage);
  });
});

describe('CustomersBulkController.enqueueUploadJob (QUI-1009)', () => {
  function setup(enqueue: jest.Mock) {
    const handler = {
      stageRows: jest.fn().mockResolvedValue('tmp/bulk-customers/5/k.json'),
      discardStaged: jest.fn().mockResolvedValue(undefined),
    };
    const response = { success: jest.fn((view: unknown) => ({ success: true, data: view })) };
    const controller = new CustomersBulkController(
      {} as any,
      response as any,
      { enqueue } as any,
      handler as any,
    );
    return { controller, handler };
  }

  it('without a browser hash the history row gets the hash of the received rows', async () => {
    const enqueue = jest.fn().mockResolvedValue({ id: 1 });
    const { controller } = setup(enqueue);

    await controller.enqueueUploadJob(
      { file_name: 'clientes.xlsx', customers: rows } as any,
      { user: { id: 9 } } as any,
    );

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        upload_type: 'customers',
        file_name: 'clientes.xlsx',
        file_hash: sha256Hex(JSON.stringify(rows)),
        params: { s3_key: 'tmp/bulk-customers/5/k.json' },
        total_rows: 3,
      }),
    );
  });

  it('keeps the browser hash when it comes, and discards the staged file if enqueueing fails', async () => {
    const failure = new Error('queue down');
    const enqueue = jest.fn().mockRejectedValue(failure);
    const { controller, handler } = setup(enqueue);

    await expect(
      controller.enqueueUploadJob(
        { file_name: 'c.xlsx', file_hash: 'a'.repeat(64), customers: rows } as any,
        { user: { id: 9 } } as any,
      ),
    ).rejects.toBe(failure);

    expect(enqueue.mock.calls[0][0].file_hash).toBe('a'.repeat(64));
    expect(handler.discardStaged).toHaveBeenCalledWith('tmp/bulk-customers/5/k.json');
  });

  it('the DTO accepts a missing hash but rejects a malformed one', async () => {
    const ok = await validate(
      plainToInstance(BulkCustomersJobDto, { file_name: 'c.xlsx', customers: rows }),
    );
    expect(ok).toHaveLength(0);

    const bad = await validate(
      plainToInstance(BulkCustomersJobDto, {
        file_name: 'c.xlsx',
        file_hash: '',
        customers: rows,
      }),
    );
    expect(bad.map((e) => e.property)).toEqual(['file_hash']);
  });
});

/** QUI-1047 — una fila inválida del archivo queda fallida; las demás se crean. */
describe('CustomersBulkJobHandler — filas inválidas por fila (QUI-1047)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marks the invalid-email row as failed with row/column and creates the rest', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5 } as any);
    const create = jest.fn(async (_s: number, d: any) => ({ id: 1, ...d }));
    const bulk = new CustomersBulkService(
      {} as any,
      { create } as any,
      {} as any,
    );
    const staged = [
      { first_name: 'Ana', email: 'ana@mail.com', row_number: 2 },
      { first_name: 'Alejandra', email: 'alejandra.rios@', row_number: 6 },
      { first_name: 'Eva', row_number: 7 },
    ];
    const s3 = makeS3({
      downloadFile: jest
        .fn()
        .mockResolvedValue(Buffer.from(JSON.stringify(staged))),
    });
    const handler = new CustomersBulkJobHandler(bulk, s3 as any);

    const page = await handler.runPage(data, 0, 100);

    expect(page).toMatchObject({ total: 3, successful: 2, failed: 1, done: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(page.rows[1]).toMatchObject({
      status: 'error',
      row_number: 6,
      message: expect.stringContaining('Fila 6, Correo:'),
      row_error: { row: 6, column: 'Correo', code: 'validation' },
    });
  });
});
