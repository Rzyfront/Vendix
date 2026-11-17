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
          { product: { id: 1 }, status: 'success', message: 'ok', action: 'create' },
          { product: { id: 2 }, status: 'success', message: 'ok', action: 'update' },
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

    await handler.cleanup(data);
    expect(bulk.cancelSession).toHaveBeenCalledWith('sid', 1);
  });

  it('maps a missing S3 object to the session-expired error', async () => {
    const s3 = { objectExists: jest.fn().mockResolvedValue(false) };
    const handler = new ProductsBulkJobHandler({} as any, s3 as any);
    await RequestContextService.run({ store_id: 1 } as any, async () => {
      await expect(handler.assertSessionExists('sid')).rejects.toMatchObject({
        errorCode: 'BULK_PROD_SESSION_EXPIRED',
      });
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
