import { VendixHttpException } from '@common/errors';
import { RutScannerService } from './rut-scanner.service';

describe('RutScannerService (async core)', () => {
  const ai_json = JSON.stringify({
    nit: '900123456',
    nit_dv: '1',
    legal_name: 'ACME SAS',
    person_type: 'JURIDICA',
    tax_regime: 'COMUN',
    ciiu: '4711',
    tax_responsibilities: ['05', '48'],
    confidence: 88,
  });
  let aiEngine: { assertVisionModelLinked: jest.Mock; run: jest.Mock };
  let service: RutScannerService;

  const multer = {
    buffer: Buffer.from('not-an-image'),
    mimetype: 'application/pdf',
    originalname: 'rut.pdf',
    size: 12,
  } as Express.Multer.File;
  const ai_file = {
    buffer: multer.buffer,
    mimeType: 'application/pdf',
    originalName: 'rut.pdf',
    size: 12,
  };

  beforeEach(() => {
    aiEngine = {
      assertVisionModelLinked: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({ success: true, content: ai_json }),
    };
    service = new RutScannerService(aiEngine as any);
  });

  it('scanRutFromFiles returns the same result as the sync method', async () => {
    const sync_result = await service.scanRutDocument(multer);
    const async_result = await service.scanRutFromFiles([ai_file]);
    expect(async_result).toEqual(sync_result);
    expect(async_result.nit).toBe('900123456');
    expect(async_result.person_type).toBe('JURIDICA');
  });

  it('assertReady delegates to assertVisionModelLinked', async () => {
    await service.assertReady();
    expect(aiEngine.assertVisionModelLinked).toHaveBeenCalledWith('rut_scanner');
  });

  it('assertReady propagates the failure', async () => {
    aiEngine.assertVisionModelLinked.mockRejectedValue(new Error('no vision'));
    await expect(service.assertReady()).rejects.toThrow('no vision');
  });

  it('scanRutFromFiles throws VendixHttpException when the AI fails', async () => {
    aiEngine.run.mockResolvedValue({ success: false, error: 'boom' });
    await expect(service.scanRutFromFiles([ai_file])).rejects.toBeInstanceOf(
      VendixHttpException,
    );
  });
});
