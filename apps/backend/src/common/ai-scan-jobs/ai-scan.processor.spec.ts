jest.mock(
  '../../domains/store/orders/purchase-orders/invoice-revalidate.processor',
  () => ({ mimeFromKey: (k: string) => (k.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg') }),
);
import { UnrecoverableError } from 'bullmq';
import { AiScanProcessor } from './ai-scan.processor';
import { AiScanHandlerRegistry } from './ai-scan-handler.registry';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

describe('AiScanProcessor', () => {
  let registry: AiScanHandlerRegistry;
  let s3: { downloadFile: jest.Mock };
  let processor: AiScanProcessor;
  const job = (over: any = {}) =>
    ({
      id: '1',
      data: {
        kind: 'rut',
        context: { store_id: 5, organization_id: 2, user_id: 7, is_super_admin: false, request_id: 'r1' },
        file_keys: ['ai-scans/2/store-5/rut/1-a.pdf'],
        params: { p: 1 },
        ...over,
      },
    }) as any;

  beforeEach(() => {
    registry = new AiScanHandlerRegistry();
    s3 = { downloadFile: jest.fn().mockResolvedValue(Buffer.from('abc')) };
    processor = new AiScanProcessor(registry, s3 as any);
  });

  it('kind desconocido -> UnrecoverableError', async () => {
    await expect(processor.process(job({ kind: 'nope' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('despacha al handler con buffers y contexto restaurado', async () => {
    let seenCtx: any;
    const handler = jest.fn().mockImplementation(async () => {
      seenCtx = RequestContextService.getContext();
      return { ok: 1 };
    });
    registry.register('rut', handler);
    const res = await processor.process(job());
    expect(res).toEqual({ ok: 1 });
    const arg = handler.mock.calls[0][0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].buffer.toString()).toBe('abc');
    expect(arg.files[0].mimeType).toBe('application/pdf');
    expect(arg.files[0].size).toBe(3);
    expect(arg.params).toEqual({ p: 1 });
    expect(seenCtx).toMatchObject({ store_id: 5, organization_id: 2, user_id: 7, request_id: 'r1' });
  });

  it('VendixHttpException 4xx -> UnrecoverableError(code)', async () => {
    registry.register('rut', async () => {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    });
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toThrow('AI_QUEUE_002');
  });

  it('VendixHttpException 5xx -> Error reintentable', async () => {
    registry.register('rut', async () => {
      throw new VendixHttpException(ErrorCodes.UPLOAD_FAILED_001);
    });
    const p = processor.process(job());
    await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toThrow('UPLOAD_FAILED_001');
  });

  it('error generico se relanza', async () => {
    registry.register('rut', async () => {
      throw new Error('x');
    });
    await expect(processor.process(job())).rejects.toThrow('x');
  });
});
