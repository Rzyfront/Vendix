import { ProductsBulkJobHandler } from './products-bulk-job.handler';
import { ProductsBulkService } from './products-bulk.service';
import { RequestContextService } from '@common/context/request-context.service';

jest.mock('slugify', () => ({
  default: jest
    .fn()
    .mockImplementation((text) => text.toLowerCase().replace(/\s+/g, '-')),
}));

const data: any = {
  store_id: 1,
  user: { id: 9 },
  params: { session_id: 'sid', initial_load_ack: true },
};

describe('ProductsBulkJobHandler (QUI-1009)', () => {
  it('passes the page window and keeps the session file while the job runs', async () => {
    const bulk = {
      uploadProductsFromSession: jest.fn().mockResolvedValue({
        total_processed: 2,
        successful: 2,
        failed: 0,
        skipped: 0,
        results: [
          { product: { id: 1, name: 'Camisa', sku: 'CAM-1' }, status: 'success', message: 'ok', action: 'create' },
          { product: { id: 2, name: 'Pantalón', sku: 'PAN-1' }, status: 'success', message: 'ok', action: 'update' },
          { product_name: 'Gorra', sku: 'GOR-1', status: 'error', message: 'SKU duplicado' },
        ],
        done: false,
      }),
      cancelSession: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new ProductsBulkJobHandler(bulk as any, {} as any);

    const page = await handler.runPage(data, 100, 100);

    expect(bulk.uploadProductsFromSession).toHaveBeenCalledWith(
      'sid',
      1,
      data.user,
      { offset: 100, limit: 100 },
      { initialLoadAck: true, keepSessionFile: true },
    );
    expect(page.created).toBe(1);
    expect(page.successful).toBe(2);
    // El producto anidado no se guarda: la tabla de resultados lee nombre y SKU de la fila.
    expect(page.rows.map((r) => [r.product_name, r.sku])).toEqual([
      ['Camisa', 'CAM-1'],
      ['Pantalón', 'PAN-1'],
      ['Gorra', 'GOR-1'],
    ]);

    await handler.cleanup(data);
    expect(bulk.cancelSession).toHaveBeenCalledWith('sid', 1);
  });

  it('maps a missing S3 object to the session-expired error', async () => {
    const s3 = { objectExistsStrict: jest.fn().mockResolvedValue(false) };
    const handler = new ProductsBulkJobHandler({} as any, s3 as any);
    await RequestContextService.run({ store_id: 1 } as any, async () => {
      await expect(handler.assertSessionExists('sid')).rejects.toMatchObject({
        errorCode: 'BULK_PROD_SESSION_EXPIRED',
      });
    });
    expect(s3.objectExistsStrict).toHaveBeenCalledWith('tmp/bulk-products/1/sid.xlsx');
  });

  it('S3 unreachable when enqueuing is a 503 technical error, not an expired session', async () => {
    const s3Down = Object.assign(new Error('socket hang up'), {
      name: 'TimeoutError',
      $metadata: { httpStatusCode: 503 },
    });
    const s3 = { objectExistsStrict: jest.fn().mockRejectedValue(s3Down) };
    const handler = new ProductsBulkJobHandler({} as any, s3 as any);
    await RequestContextService.run({ store_id: 1 } as any, async () => {
      await expect(handler.assertSessionExists('sid')).rejects.toMatchObject({
        errorCode: 'BULK_JOB_ENQUEUE_FAILED',
      });
    });
  });

  it('an existing session file passes', async () => {
    const s3 = { objectExistsStrict: jest.fn().mockResolvedValue(true) };
    const handler = new ProductsBulkJobHandler({} as any, s3 as any);
    await RequestContextService.run({ store_id: 1 } as any, async () => {
      await expect(handler.assertSessionExists('sid')).resolves.toBeUndefined();
    });
  });
});

describe('ProductsBulkService.uploadProductsFromSession keepSessionFile', () => {
  const build = () => {
    const s3 = {
      downloadImage: jest.fn().mockResolvedValue(Buffer.from('x')),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const svc: any = Object.create(ProductsBulkService.prototype);
    svc.s3Service = s3;
    svc.MAX_BATCH_SIZE = 5000;
    svc.parseFile = jest.fn().mockReturnValue([{ name: 'a' }]);
    svc.assertInitialLoadAck = jest.fn();
    svc.readSessionInitialLoadLocation = jest.fn().mockResolvedValue(undefined);
    svc.uploadProducts = jest.fn().mockResolvedValue({
      total_processed: 1,
      successful: 1,
      failed: 0,
      skipped: 0,
      results: [],
    });
    return { svc, s3 };
  };

  it('still deletes the temp file on the last page by default', async () => {
    const { svc, s3 } = build();
    await svc.uploadProductsFromSession('sid', 1, {}, { offset: 0, limit: 100 });
    expect(s3.deleteFile).toHaveBeenCalledWith('tmp/bulk-products/1/sid.xlsx');
  });

  it('keeps the temp file on the last page with keepSessionFile', async () => {
    const { svc, s3 } = build();
    await svc.uploadProductsFromSession(
      'sid',
      1,
      {},
      { offset: 0, limit: 100 },
      { keepSessionFile: true },
    );
    expect(s3.deleteFile).not.toHaveBeenCalled();
  });
});
