import { VendixHttpException } from '@common/errors';
import { ResolutionScannerService } from './resolution-scanner.service';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';

/** ia-cargas F5b: pages stub (a PDF → one page of native text + its image). */
const fakePages = () => ({
  prepareForAi: jest.fn().mockResolvedValue({
    source: 'pdf',
    pages: [{ page_number: 1, mode: 'text+image', text: 'DIAN ' + 'x'.repeat(220), image: 'data:image/jpeg;base64,AAAA' }],
    page_count: 1,
    unreadable_pages: [],
  }),
});


describe('ResolutionScannerService (async core)', () => {
  const ai_json = JSON.stringify({
    prefix: 'SETP',
    document_type: 'sales_invoice',
    resolution_number: '18760000001',
    resolution_date: '2025-01-15',
    range_from: 1,
    range_to: 5000,
    valid_from: '2025-01-15',
    valid_to: '2027-01-15',
    field_confidence: { prefix: 90, range_from: 90, range_to: 90 },
  });
  let aiEngine: { assertVisionModelLinked: jest.Mock; run: jest.Mock };
  let service: ResolutionScannerService;

  const multer = {
    buffer: Buffer.from('%PDF-1.7 doc'),
    mimetype: 'application/pdf',
    originalname: 'res.pdf',
    size: 12,
  } as Express.Multer.File;
  const ai_file = {
    buffer: multer.buffer,
    mimeType: 'application/pdf',
    originalName: 'res.pdf',
    size: 12,
  };

  beforeEach(() => {
    aiEngine = {
      assertVisionModelLinked: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({ success: true, content: ai_json }),
    };
    service = new ResolutionScannerService(
      aiEngine as any,
      new AiExtractionService(aiEngine as any),
      fakePages() as any,
    );
  });

  it('scanResolutionFromFiles returns the same result as the sync method', async () => {
    const sync_result = await service.scanResolutionDocument(multer);
    const async_result = await service.scanResolutionFromFiles([ai_file]);
    expect(async_result).toEqual(sync_result);
  });

  it('assertReady delegates to assertVisionModelLinked', async () => {
    await service.assertReady();
    expect(aiEngine.assertVisionModelLinked).toHaveBeenCalledWith(
      'dian_resolution_scanner',
    );
  });

  it('scanResolutionFromFiles throws VendixHttpException when the AI fails', async () => {
    aiEngine.run.mockResolvedValue({ success: false, error: 'boom' });
    await expect(
      service.scanResolutionFromFiles([ai_file]),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });
});
