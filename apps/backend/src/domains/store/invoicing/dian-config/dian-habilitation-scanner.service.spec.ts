import { VendixHttpException } from '@common/errors';
import { DianHabilitationScannerService } from './dian-habilitation-scanner.service';

describe('DianHabilitationScannerService (async core)', () => {
  const ai_json = JSON.stringify({
    software_id: '123e4567-e89b-12d3-a456-426614174000',
    test_set_id: '123e4567-e89b-12d3-a456-426614174001',
    prefix: 'SETP',
    field_confidence: {},
  });
  let aiEngine: { assertVisionModelLinked: jest.Mock; run: jest.Mock };
  let service: DianHabilitationScannerService;

  const multers = [
    { buffer: Buffer.from('a'), mimetype: 'application/pdf', originalname: 'a.pdf', size: 1 },
    { buffer: Buffer.from('b'), mimetype: 'application/pdf', originalname: 'b.pdf', size: 1 },
  ] as Express.Multer.File[];
  const ai_files = multers.map((m) => ({
    buffer: m.buffer,
    mimeType: m.mimetype,
    originalName: m.originalname,
    size: m.size,
  }));

  beforeEach(() => {
    aiEngine = {
      assertVisionModelLinked: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({ success: true, content: ai_json }),
    };
    service = new DianHabilitationScannerService(aiEngine as any);
  });

  it('scanHabilitationFromFiles returns the same result as the sync method', async () => {
    const sync_result = await service.scanHabilitationDocuments(multers);
    const async_result = await service.scanHabilitationFromFiles(ai_files);
    expect(async_result).toEqual(sync_result);
    expect(aiEngine.run).toHaveBeenCalledTimes(2);
  });

  it('assertReady delegates to assertVisionModelLinked', async () => {
    await service.assertReady();
    expect(aiEngine.assertVisionModelLinked).toHaveBeenCalledWith(
      'dian_habilitation_scanner',
    );
  });

  it('scanHabilitationFromFiles throws VendixHttpException when the AI fails', async () => {
    aiEngine.run.mockResolvedValue({ success: false, error: 'boom' });
    await expect(
      service.scanHabilitationFromFiles(ai_files),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });
});
