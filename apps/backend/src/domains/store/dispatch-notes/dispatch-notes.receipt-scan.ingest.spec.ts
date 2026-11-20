/**
 * ia-cargas F5a (#11) — the purchase-receipt scanner of the dispatch-note
 * wizard reads through the shared page reader, and its `receipt-scan` job
 * carries an S3 key instead of a base64 image (old jobs still work).
 */
import { DispatchNotesService } from './dispatch-notes.service';
import {
  RECEIPT_IMAGE_INSTRUCTION,
  ReceiptScanReaderService,
} from './receipt-scan-reader.service';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

const PDF = Buffer.from('%PDF-1.7 recibo de compra');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const IMG = 'data:image/jpeg;base64,/9j/AAAA';

type FakePage = { page_number: number; mode: 'text' | 'image'; text: string; image?: string };
const textPages = (n: number): FakePage[] =>
  Array.from({ length: n }, (_, i) => ({
    page_number: i + 1,
    mode: 'text' as const,
    text: `REMISION PROVEEDOR pagina ${i + 1} ` + 'x'.repeat(220),
  }));

const ANSWER = JSON.stringify({
  schema_version: 2,
  supplier: { name: 'Lácteos del Valle', tax_id: '900.111.222-3' },
  currency: 'COP',
  line_items: [
    { description: 'Leche entera 1L', sku_if_visible: 'LEC-1', quantity: 24, unit_price: 3200 },
    { description: 'Queso campesino', sku_if_visible: null, quantity: '5', unit_price: '12500' },
  ],
});

function build(options: {
  answers?: Array<string | Record<string, unknown>>;
  answerFor?: (text: string) => string;
  pages?: FakePage[];
  source?: 'pdf' | 'image';
} = {}) {
  const queue = [...(options.answers ?? [ANSWER])];
  const ai = {
    run: jest.fn(async (_app: string, _vars: unknown, messages: any[]) => {
      const a = options.answerFor
        ? options.answerFor(JSON.stringify(messages[0]?.content ?? ''))
        : queue.shift() ?? '{}';
      return typeof a === 'string' ? { success: true, content: a, finish_reason: 'stop' } : a;
    }),
  };
  const pageList = options.pages ?? textPages(1);
  const pages = {
    prepareForAi: jest.fn().mockResolvedValue({
      source: options.source ?? 'pdf',
      pages: pageList,
      page_count: pageList.length,
      unreadable_pages: [],
    }),
  };
  const s3 = {
    uploadFile: jest.fn(async (_b: Buffer, key: string) => key),
    downloadFile: jest.fn(),
    deleteFile: jest.fn(),
  };
  const prisma = {
    suppliers: {
      findFirst: jest.fn().mockResolvedValue({ id: 31 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
    products: {
      findFirst: jest.fn().mockImplementation(async (args: any) =>
        args?.where?.sku ? { id: 70, name: 'Leche entera 1L' } : null,
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const queueMock = { add: jest.fn().mockResolvedValue({ id: '44' }) };
  const reader = new ReceiptScanReaderService(
    s3 as any,
    pages as any,
    new AiExtractionService(ai as any),
  );
  const service = new DispatchNotesService(
    prisma as any,
    {} as any, // dispatchNumberGenerator
    {} as any, // routeNumberGenerator
    {} as any, // eventEmitter
    {} as any, // stockValidator
    {} as any, // aiEngine (no longer used by the receipt scan)
    queueMock as any,
    {} as any, // dispatchFulfillment
    undefined, // purchaseOrdersService
    reader,
  );
  return { service, ai, pages, s3, prisma, queueMock };
}

describe('DispatchNotesService — receipt scan by pages (ia-cargas F5a)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 11,
      organization_id: 3,
      user_id: 9,
      request_id: 'r1',
      is_super_admin: false,
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('enqueue: the job carries the S3 key of the original upload, never a base64 image', async () => {
    const { service, s3, queueMock } = build();

    const res = await service.enqueueReceiptScan({
      buffer: PDF,
      mimetype: 'application/pdf',
      originalname: 'recibo.pdf',
      size: PDF.length,
    } as any);

    expect(res).toEqual({ job_id: '44' });
    const key = s3.uploadFile.mock.calls[0][1];
    expect(key).toMatch(/^ai-scans\/3\/store-11\/receipt\/\d+-recibo\.pdf$/);
    const payload = queueMock.add.mock.calls[0][1];
    expect(payload).toEqual(
      expect.objectContaining({
        file_key: key,
        mimeType: 'application/pdf',
        context: expect.objectContaining({ store_id: 11, request_id: 'r1' }),
      }),
    );
    expect(payload).not.toHaveProperty('dataUri');
  });

  it('enqueue: a file that is not a PDF/photo is rejected as a document problem before S3', async () => {
    const { service, s3, queueMock } = build();
    await expect(
      service.enqueueReceiptScan({ buffer: Buffer.from('hola'), mimetype: 'image/png', originalname: 'x.png', size: 4 } as any),
    ).rejects.toMatchObject({ errorCode: 'AI_INGEST_INVALID_FILE' });
    expect(s3.uploadFile).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('a PDF with native text is read as text (no raw PDF) and keeps the ScanReceiptResult contract', async () => {
    const { service, ai, pages } = build({ pages: textPages(2) });

    const out = await service.scanReceiptFromFile({ buffer: PDF, mimeType: 'application/pdf' });

    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run.mock.calls[0][0]).toBe('invoice_ocr');
    const sent = JSON.stringify(ai.run.mock.calls[0][2]);
    expect(sent).not.toContain('application/pdf');
    expect(sent).not.toContain('image_url');
    expect(pages.prepareForAi).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: 'application/pdf' }),
      expect.objectContaining({ maxPages: 10, splitTallImages: false }),
    );
    expect(out).toEqual(
      expect.objectContaining({
        supplier_name: 'Lácteos del Valle',
        supplier_id: 31,
        currency: 'COP',
      }),
    );
    expect(out.items.map((i) => [i.product_name, i.quantity, i.unit_price])).toEqual([
      ['Leche entera 1L', 24, 3200],
      ['Queso campesino', 5, 12500],
    ]);
  });

  it('a photo gets the exact old request as a prepared JPEG', async () => {
    const { service, ai } = build({ source: 'image', pages: [{ page_number: 1, mode: 'image', text: '', image: IMG }] });
    await service.scanReceiptFromFile({ buffer: JPEG, mimeType: 'image/jpeg' });
    const content = ai.run.mock.calls[0][2][0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: RECEIPT_IMAGE_INSTRUCTION });
    expect(content.some((p) => p.type === 'image_url' && p.image_url.url === IMG)).toBe(true);
  });

  it('a job in the OLD format (data URI) still works: decoded and read by pages', async () => {
    const { service, pages } = build();
    const out = await service.scanReceiptFromImage(
      `data:application/pdf;base64,${PDF.toString('base64')}`,
      'application/pdf',
    );
    expect(pages.prepareForAi).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: PDF, mimetype: 'application/pdf' }),
      expect.any(Object),
    );
    expect(out.items).toHaveLength(2);
  });

  it('7 pages: 2 batches merged into one receipt, every line kept', async () => {
    const { service, ai } = build({
      pages: textPages(7),
      answerFor: (text) =>
        text.includes('pages 1-5')
          ? JSON.stringify({ supplier: { name: 'Lácteos del Valle' }, line_items: [{ description: 'Leche', quantity: 1, unit_price: 10 }] })
          : JSON.stringify({ supplier: { name: null }, line_items: [{ description: 'Yogur', quantity: 2, unit_price: 20 }] }),
    });
    const out = await service.scanReceiptFromFile({ buffer: PDF, mimeType: 'application/pdf' });
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(out.supplier_name).toBe('Lácteos del Valle');
    expect(out.items.map((i) => i.product_name)).toEqual(['Leche', 'Yogur']);
  });

  it('keeps the error contract: parse → DISPATCH_RECEIPT_SCAN_PARSE_FAIL, AI → _AI_FAIL, no lines → _NO_ITEMS', async () => {
    const broken = build({ answers: ['no json', 'otra vez no'] });
    await expect(broken.service.scanReceiptFromFile({ buffer: PDF })).rejects.toMatchObject({
      errorCode: ErrorCodes.DISPATCH_RECEIPT_SCAN_PARSE_FAIL.code,
    });

    const down = build({ answers: [{ success: false, error: 'down' } as any] });
    await expect(down.service.scanReceiptFromFile({ buffer: PDF })).rejects.toMatchObject({
      errorCode: ErrorCodes.DISPATCH_RECEIPT_SCAN_AI_FAIL.code,
    });

    const empty = build({ answers: [JSON.stringify({ line_items: [] })] });
    await expect(empty.service.scanReceiptFromFile({ buffer: PDF })).rejects.toMatchObject({
      errorCode: ErrorCodes.DISPATCH_RECEIPT_SCAN_NO_ITEMS.code,
    });
  });

  it('document problems arrive as AI_INGEST_* (too many pages)', async () => {
    const { service, pages } = build();
    pages.prepareForAi.mockRejectedValue(
      new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES, 'El PDF excede el máximo de 10 páginas.'),
    );
    await expect(service.scanReceiptFromFile({ buffer: PDF })).rejects.toMatchObject({
      errorCode: 'AI_INGEST_TOO_MANY_PAGES',
    });
  });
});
