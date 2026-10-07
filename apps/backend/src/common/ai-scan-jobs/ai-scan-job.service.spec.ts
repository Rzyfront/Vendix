import { AiScanJobService } from './ai-scan-job.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';

const ctx = (o: any = {}) => ({
  is_super_admin: false,
  is_owner: false,
  user_id: 7,
  organization_id: 2,
  store_id: 5,
  ...o,
});

describe('AiScanJobService', () => {
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let s3: { uploadFile: jest.Mock };
  let service: AiScanJobService;

  const run = <T>(c: any, fn: () => Promise<T>) =>
    RequestContextService.run(c, fn);

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({ id: 99 }), getJob: jest.fn() };
    s3 = { uploadFile: jest.fn().mockImplementation(async (_b, k) => k) };
    service = new AiScanJobService(queue as any, s3 as any);
  });

  describe('enqueue', () => {
    it('sube a S3 y encola con kind y contexto', async () => {
      const file = {
        buffer: Buffer.from('x'),
        mimetype: 'application/pdf',
        originalname: '../a b.pdf',
        size: 1,
      } as any;
      const res = await run(ctx(), () =>
        service.enqueue('rut', [file], { a: 1 }),
      );
      expect(res).toEqual({ job_id: '99' });
      const key = s3.uploadFile.mock.calls[0][1] as string;
      expect(key).toMatch(/^ai-scans\/2\/store-5\/rut\/\d+-a_b\.pdf$/);
      const [name, data, opts] = queue.add.mock.calls[0];
      expect(name).toBe('rut');
      expect(data.kind).toBe('rut');
      expect(data.file_keys).toEqual([key]);
      expect(data.params).toEqual({ a: 1 });
      expect(data.context).toMatchObject({
        store_id: 5,
        organization_id: 2,
        user_id: 7,
        is_super_admin: false,
      });
      expect(opts.attempts).toBe(2);
    });

    it('usa platform/org sin tienda ni org', async () => {
      await run(ctx({ store_id: undefined, organization_id: undefined }), () =>
        service.enqueue('product_image_generate', [
          { buffer: Buffer.from('x'), mimeType: 'image/png', originalName: 'i.png', size: 1 },
        ]),
      );
      expect(s3.uploadFile.mock.calls[0][1]).toMatch(
        /^ai-scans\/platform\/org\/product_image_generate\//,
      );
    });

    it('falla S3 -> excepcion y NO encola', async () => {
      s3.uploadFile.mockRejectedValue(new Error('boom'));
      await expect(
        run(ctx(), () =>
          service.enqueue('rut', [
            { buffer: Buffer.from('x'), mimetype: 'a/b', originalname: 'f', size: 1 } as any,
          ]),
        ),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_FAILED_001' });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('sin archivos encola igual', async () => {
      await run(ctx(), () => service.enqueue('product_image_enhance', [], { p: 1 }));
      expect(s3.uploadFile).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    const job = (over: any = {}, state = 'completed') => ({
      data: { context: { user_id: 7, organization_id: 2, store_id: 5 } , ...over },
      getState: jest.fn().mockResolvedValue(state),
      returnvalue: { ok: true },
      failedReason: 'CODE_X',
    });
    const expect404 = async (c: any) => {
      let err: any;
      try {
        await run(c, () => service.getStatus('1'));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(VendixHttpException);
      expect(err.errorCode).toBe('AI_QUEUE_002');
    };

    it('inexistente -> 404', async () => {
      queue.getJob.mockResolvedValue(undefined);
      await expect404(ctx());
    });
    it('otra tienda -> 404', async () => {
      queue.getJob.mockResolvedValue(job());
      await expect404(ctx({ store_id: 6 }));
    });
    it('otra org -> 404', async () => {
      queue.getJob.mockResolvedValue(job());
      await expect404(ctx({ organization_id: 3 }));
    });
    it('otro usuario -> 404', async () => {
      queue.getJob.mockResolvedValue(job());
      await expect404(ctx({ user_id: 8 }));
    });
    it('sin user_id -> 404', async () => {
      queue.getJob.mockResolvedValue(job());
      await expect404(ctx({ user_id: undefined }));
    });
    it('getJob lanza -> 404', async () => {
      queue.getJob.mockRejectedValue(new Error('redis'));
      await expect404(ctx());
    });
    it('propio completed -> result', async () => {
      queue.getJob.mockResolvedValue(job());
      await expect(run(ctx(), () => service.getStatus('1'))).resolves.toEqual({
        status: 'completed',
        result: { ok: true },
      });
    });
    it('propio failed -> error', async () => {
      queue.getJob.mockResolvedValue(job({}, 'failed'));
      await expect(run(ctx(), () => service.getStatus('1'))).resolves.toEqual({
        status: 'failed',
        error: 'CODE_X',
      });
    });
    it('normaliza org/store ausentes (undefined -> null)', async () => {
      queue.getJob.mockResolvedValue(
        job({ context: { user_id: 7, organization_id: null, store_id: null } }, 'active'),
      );
      await expect(
        run(ctx({ organization_id: undefined, store_id: undefined }), () =>
          service.getStatus('1'),
        ),
      ).resolves.toEqual({ status: 'active' });
    });
  });
});
