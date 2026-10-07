import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';

describe('Products image AI async scan', () => {
  const makeService = (): any => {
    const svc: any = Object.create(ProductsService.prototype);
    svc.logger = { error: jest.fn() };
    svc.s3Service = {
      uploadFile: jest.fn().mockImplementation(async (_b, k) => k),
      signUrl: jest.fn().mockResolvedValue('https://signed/url'),
    };
    svc.ai_engine = { runImage: jest.fn() };
    return svc;
  };
  const b64 = Buffer.from('png-bytes').toString('base64');
  const ctx = { organization_id: 2, store_id: 5 };

  describe('runImageScanJob', () => {
    it('enhance: sube PNG a S3 y no devuelve base64', async () => {
      const svc = makeService();
      jest.spyOn(svc, 'enhanceImageCore').mockResolvedValue({
        image_url: `data:image/png;base64,${b64}`,
        revised_prompt: 'rp',
        model: 'm',
      });
      const res = await svc.runImageScanJob(
        'product_image_enhance',
        { image_url: 'x', prompt: 'p' },
        ctx,
      );
      const [buf, key, mime] = svc['s3Service'].uploadFile.mock.calls[0];
      expect(Buffer.from(buf).toString()).toBe('png-bytes');
      expect(key).toMatch(/^ai-scans\/2\/store-5\/product-image\/\d+\.png$/);
      expect(mime).toBe('image/png');
      expect(res).toEqual({
        image_key: key,
        image_url: 'https://signed/url',
        revised_prompt: 'rp',
        model: 'm',
      });
      expect(JSON.stringify(res)).not.toContain('data:');
    });

    it('generate: usa generateImageCore', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc, 'generateImageCore').mockResolvedValue({
        image_url: `data:image/png;base64,${b64}`,
        revised_prompt: undefined,
        model: 'm',
      } as any);
      await svc.runImageScanJob('product_image_generate', { prompt: 'p' }, ctx);
      expect(spy).toHaveBeenCalledWith({ prompt: 'p' });
    });

    it('fallo de S3 -> UPLOAD_FAILED_001 (502, reintentable)', async () => {
      const svc = makeService();
      jest.spyOn(svc, 'generateImageCore').mockResolvedValue({
        image_url: `data:image/png;base64,${b64}`,
      } as any);
      svc['s3Service'].uploadFile.mockRejectedValue(new Error('boom'));
      await expect(
        svc.runImageScanJob('product_image_generate', { prompt: 'p' }, ctx),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_FAILED_001' });
    });
  });

  describe('generateImageCore fallback', () => {
    it('AI_APP_001 en el generador cae al enhancer', async () => {
      const svc = makeService();
      const runImage = svc['ai_engine'].runImage as jest.Mock;
      runImage
        .mockRejectedValueOnce(new VendixHttpException(ErrorCodes.AI_APP_001))
        .mockResolvedValueOnce({ success: true, imageBase64: b64, model: 'm' });
      const res = await svc.generateImageCore({ prompt: 'p' } as any);
      expect(runImage.mock.calls[0][0]).toBe('product_image_generator');
      expect(runImage.mock.calls[1][0]).toBe('product_image_enhancer');
      expect(res.image_url).toBe(`data:image/png;base64,${b64}`);
    });
  });

  describe('endpoints async', () => {
    const make = () => {
      const enqueue = jest.fn().mockResolvedValue({ job_id: '7' });
      const response = { success: jest.fn((d, m) => ({ data: d, message: m })) };
      const ctrl = new ProductsController(
        {} as any,
        {} as any,
        response as any,
        { enqueue } as any,
      );
      return { ctrl, enqueue, response };
    };

    it('enhance-image/async encola con kind y params', async () => {
      const { ctrl, enqueue } = make();
      const dto: any = { image_url: 'key/a.png', prompt: 'mejora' };
      const res = await ctrl.enhanceImageAsync(dto);
      expect(enqueue).toHaveBeenCalledWith('product_image_enhance', [], dto);
      expect(res.data).toEqual({ job_id: '7' });
    });

    it('generate-image/async encola con kind y params', async () => {
      const { ctrl, enqueue } = make();
      const dto: any = { prompt: 'una botella' };
      const res = await ctrl.generateImageAsync(dto);
      expect(enqueue).toHaveBeenCalledWith('product_image_generate', [], dto);
      expect(res.data).toEqual({ job_id: '7' });
    });

    it('data URI > 5 MB se rechaza sin encolar', async () => {
      const { ctrl, enqueue } = make();
      const dto: any = {
        image_url: 'data:image/png;base64,' + 'A'.repeat(5 * 1024 * 1024),
        prompt: 'p',
      };
      await expect(ctrl.enhanceImageAsync(dto)).rejects.toMatchObject({
        errorCode: 'SYS_VALIDATION_001',
      });
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe('getAiImageBytes', () => {
    const run = (fn: () => Promise<any>, c: any = { organization_id: 2, store_id: 5 }) =>
      RequestContextService.run(
        { is_super_admin: false, is_owner: false, user_id: 1, ...c } as any,
        fn,
      );
    const okKey = 'ai-scans/2/store-5/product-image/123.png';

    it('key valida -> bytes', async () => {
      const svc = makeService();
      svc['s3Service'].downloadFile = jest.fn().mockResolvedValue(Buffer.from('png'));
      const res = await run(() => svc.getAiImageBytes(okKey));
      expect(res.toString()).toBe('png');
      expect(svc['s3Service'].downloadFile).toHaveBeenCalledWith(okKey);
    });

    it.each([
      'ai-scans/2/store-6/product-image/1.png',
      'ai-scans/3/store-5/product-image/1.png',
      'ai-scans/2/store-5/product-image/../x/1.png',
      'ai-scans/2/store-5/product-image/1.jpg',
      'ai-scans/2/store-50/product-image/1.png',
      '',
    ])('key invalida %s -> 404 sin descargar', async (k) => {
      const svc = makeService();
      svc['s3Service'].downloadFile = jest.fn();
      await expect(run(() => svc.getAiImageBytes(k))).rejects.toMatchObject({
        errorCode: 'SYS_NOT_FOUND_001',
      });
      expect(svc['s3Service'].downloadFile).not.toHaveBeenCalled();
    });

    it('fallo de descarga -> 404', async () => {
      const svc = makeService();
      svc['s3Service'].downloadFile = jest.fn().mockRejectedValue(new Error('x'));
      await expect(run(() => svc.getAiImageBytes(okKey))).rejects.toMatchObject({
        errorCode: 'SYS_NOT_FOUND_001',
      });
    });
  });
});
