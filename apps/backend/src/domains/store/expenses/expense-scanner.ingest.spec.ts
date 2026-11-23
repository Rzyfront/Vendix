/**
 * ia-cargas F5a (#7) — the expense invoice scanner reads through the shared
 * document reader (pages, native text first, schema + repair) and, for the
 * same model answer, produces the SAME amounts, taxes, currency and category
 * the old single call produced.
 */
import { ExpenseScannerService } from './expense-scanner.service';
import { EXPENSE_IMAGE_INSTRUCTION } from './expense-ingest.profile';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import { parseAiJson } from '../../../ai-engine/utils/ai-json.util';
import { VendixHttpException, ErrorCodes } from '@common/errors';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports

const PDF = Buffer.from('%PDF-1.7 factura de gasto');

type FakePage = { page_number: number; mode: 'text' | 'image' | 'text+image'; text: string; image?: string };

const textPages = (n: number): FakePage[] =>
  Array.from({ length: n }, (_, i) => ({
    page_number: i + 1,
    mode: 'text' as const,
    text: `FACTURA ELECTRONICA FE-881 pagina ${i + 1} ` + 'x'.repeat(220),
  }));

function build(options: {
  answers?: Array<string | Record<string, unknown>>;
  answerFor?: (text: string) => string | Record<string, unknown>;
  pages?: FakePage[];
  prepareError?: Error;
  realPages?: boolean;
  categories?: Array<{ id: number; name: string }>;
}) {
  const queue = [...(options.answers ?? [])];
  const toResponse = (a: string | Record<string, unknown>) =>
    typeof a === 'string' ? { success: true, content: a, finish_reason: 'stop' } : a;
  const ai = {
    run: jest.fn(async (_app: string, _vars: unknown, messages: any[]) => {
      if (options.answerFor) {
        return toResponse(options.answerFor(JSON.stringify(messages[0]?.content ?? '')));
      }
      return toResponse(queue.shift() ?? '{}');
    }),
  };
  const pages = options.realPages
    ? new DocumentPagesService()
    : {
        prepareForAi: options.prepareError
          ? jest.fn().mockRejectedValue(options.prepareError)
          : jest.fn().mockResolvedValue({
              source: 'pdf',
              pages: options.pages ?? textPages(1),
              page_count: (options.pages ?? textPages(1)).length,
              unreadable_pages: [],
            }),
      };
  const prisma = {
    organizationWhere: { organization_id: 3 },
    expense_categories: {
      findMany: jest.fn().mockResolvedValue(options.categories ?? []),
    },
  };
  const service = new ExpenseScannerService(
    prisma as any,
    new AiExtractionService(ai as any),
    pages as any,
  );
  return { service, ai, pages, prisma };
}

// ── A fixed answer: COP, IVA, amounts as numbers AND as strings, a null ──
const FIXED_ANSWER = JSON.stringify({
  supplier_name: 'Papelería El Cid',
  supplier_tax_id: '900555111-2',
  invoice_number: 'FE-881',
  invoice_date: '2026-11-18',
  currency: 'COP',
  line_items: [
    { description: 'Resma carta', quantity: 2, unit_price: 18500, amount: 37000, line_index: 0 },
    { description: 'Tóner HP 85A', quantity: '1', unit_price: '245000', amount: '245000', line_index: 1 },
    { description: 'Ganchos', quantity: 3, unit_price: 2100.5, amount: 6301.5, line_index: null },
  ],
  subtotal: 288301.5,
  tax_amount: '54777.29',
  total: 343078.79,
  confidence: 91,
  extraction_notes: '  IVA 19 % incluido en el total  ',
});

const CATEGORIES = [
  { id: 7, name: 'Papelería' },
  { id: 8, name: 'Servicios públicos' },
];

/** The OLD path for the same model answer: parseAiJson + normalize. */
function oldPath(service: ExpenseScannerService, content: string) {
  return service.normalizeExpenseOcrResponse(parseAiJson(content));
}

describe('ExpenseScannerService — ai-ingest (F5a)', () => {
  it('a 2-page PDF with native text travels as text (no raw PDF, no image) in ONE call', async () => {
    const { service, ai, pages } = build({ answers: [FIXED_ANSWER], pages: textPages(2), categories: CATEGORIES });

    const out = await service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf', originalName: 'f.pdf' });

    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run.mock.calls[0][0]).toBe('expense_invoice_ocr');
    const content = ai.run.mock.calls[0][2][0].content as any[];
    expect(content.some((p) => p.type === 'image_url')).toBe(false);
    expect(JSON.stringify(content)).toContain('pagina 2');
    expect(JSON.stringify(content)).not.toContain('application/pdf');
    expect((pages as any).prepareForAi).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: 'application/pdf' }),
      expect.objectContaining({ maxPages: 10, splitTallImages: false }),
    );
    expect(out.scan.total).toBe(343078.79);
    expect(out.scan_source).toEqual({ pages: 2, text_pages: 2, batches: 1 });
    expect(out.warnings).toBeUndefined();
    expect(out.matched_category).toEqual(expect.objectContaining({ id: 7, name: 'Papelería' }));
  });

  it('a phone photo is straightened and reduced to a JPEG and gets the exact old request', async () => {
    const png = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 250, g: 250, b: 250 } },
    })
      .png()
      .toBuffer();
    const { service, ai } = build({ answers: [FIXED_ANSWER], realPages: true });

    const out = await service.scanFromFile({ buffer: png, mimeType: 'image/png', originalName: 'foto.png' });

    const content = ai.run.mock.calls[0][2][0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: EXPENSE_IMAGE_INSTRUCTION });
    const image = content.find((p) => p.type === 'image_url');
    expect(image.image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const meta = await sharp(Buffer.from(image.image_url.url.split(',')[1], 'base64')).metadata();
    expect(meta.width).toBe(1536);
    expect(out.scan_source).toEqual({ pages: 1, text_pages: 0, batches: 1 });
  });

  it('FIXED CASE: amounts, taxes, currency and category are identical to the old path', async () => {
    const { service } = build({ answers: [FIXED_ANSWER], categories: CATEGORIES });

    const out = await service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf' });
    const before = oldPath(service, FIXED_ANSWER);

    expect(out.scan.subtotal).toBe(before.subtotal);
    expect(out.scan.tax_amount).toBe(before.tax_amount);
    expect(out.scan.total).toBe(before.total);
    expect(out.scan.currency).toBe(before.currency);
    expect(out.scan.line_items.map(({ line_index: _i, ...money }) => money)).toEqual(
      before.line_items.map(({ line_index: _i, ...money }) => money),
    );
    expect(out.scan.supplier_name).toBe(before.supplier_name);
    expect(out.scan.invoice_number).toBe(before.invoice_number);
    expect(out.scan.confidence).toBe(before.confidence);
    expect(out.scan.extraction_notes).toBe(before.extraction_notes);
    // Explicit figures, so a change in normalize itself is caught too.
    expect(out.scan).toEqual(
      expect.objectContaining({
        currency: 'COP',
        subtotal: 288301.5,
        tax_amount: 54777.29,
        total: 343078.79,
        extraction_notes: 'IVA 19 % incluido en el total',
      }),
    );
    expect(out.scan.line_items.map((l) => [l.quantity, l.unit_price, l.amount])).toEqual([
      [2, 18500, 37000],
      [1, 245000, 245000],
      [3, 2100.5, 6301.5],
    ]);
    expect(out.matched_category).toEqual({ id: 7, name: 'Papelería', confidence: expect.any(Number) });
  });

  it('FIXED CASE: missing currency and a null tax keep their old defaults (COP / null)', async () => {
    const answer = JSON.stringify({ supplier_name: 'X', line_items: [], subtotal: 1000, tax_amount: null, total: 1000 });
    const { service } = build({ answers: [answer] });
    const out = await service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf' });
    expect(out.scan).toEqual(oldPath(service, answer));
    expect(out.scan.currency).toBe('COP');
    expect(out.scan.tax_amount).toBeNull();
  });

  it('a 7-page invoice is read in 2 batches merged into ONE expense (header first, totals last)', async () => {
    const { service, ai } = build({
      pages: textPages(7),
      answerFor: (text) =>
        text.includes('pages 1-5')
          ? JSON.stringify({
              supplier_name: 'Ferretería Sur',
              invoice_number: 'F-9',
              currency: 'COP',
              line_items: [
                { description: 'Tornillos', quantity: 10, unit_price: 100, amount: 1000, line_index: 0 },
                { description: 'Brocas', quantity: 2, unit_price: 5000, amount: 10000, line_index: 1 },
              ],
              subtotal: null,
              total: null,
              confidence: 90,
            })
          : JSON.stringify({
              supplier_name: null,
              line_items: [{ description: 'Cinta', quantity: 1, unit_price: 3000, amount: 3000, line_index: 0 }],
              subtotal: 14000,
              tax_amount: 2660,
              total: 16660,
              confidence: 80,
            }),
    });

    const out = await service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf' });

    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(out.scan.supplier_name).toBe('Ferretería Sur');
    expect(out.scan.line_items.map((l) => [l.description, l.line_index])).toEqual([
      ['Tornillos', 0],
      ['Brocas', 1],
      ['Cinta', 2],
    ]);
    expect(out.scan).toEqual(expect.objectContaining({ subtotal: 14000, tax_amount: 2660, total: 16660, confidence: 80 }));
    expect(out.scan_source).toEqual({ pages: 7, text_pages: 7, batches: 2 });
  });

  it('a broken JSON is repaired once; a second broken answer is still INV_SCAN_PARSE_FAIL', async () => {
    const repaired = build({ answers: ['Aquí: {"total": ', FIXED_ANSWER] });
    const ok = await repaired.service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf' });
    expect(repaired.ai.run).toHaveBeenCalledTimes(2);
    expect(ok.scan.total).toBe(343078.79);

    const broken = build({ answers: ['no json', 'tampoco'] });
    await expect(
      broken.service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.INV_SCAN_PARSE_FAIL.code });
  });

  it('an AI failure keeps INV_SCAN_AI_FAIL (retryable by the queue)', async () => {
    const { service } = build({ answers: [{ success: false, error: 'down' }] });
    await expect(
      service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.INV_SCAN_AI_FAIL.code });
  });

  it('document problems arrive as AI_INGEST_* (too many pages, not a PDF/photo)', async () => {
    const tooMany = build({
      prepareError: new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES, 'El PDF excede el máximo de 10 páginas.'),
    });
    await expect(
      tooMany.service.scanFromFile({ buffer: PDF, mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({ errorCode: 'AI_INGEST_TOO_MANY_PAGES' });

    const { service, ai } = build({});
    await expect(
      service.scanFromFile({ buffer: Buffer.from('hola, soy un txt'), mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({ errorCode: 'AI_INGEST_INVALID_FILE' });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('a job queued before F5a (data URI) is decoded and read through the same path', async () => {
    const { service, pages } = build({ answers: [FIXED_ANSWER] });
    const dataUri = `data:application/pdf;base64,${PDF.toString('base64')}`;

    const out = await service.scanFromImage(dataUri, 'application/pdf');

    expect((pages as any).prepareForAi).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: PDF, mimetype: 'application/pdf' }),
      expect.any(Object),
    );
    expect(out.scan.total).toBe(343078.79);
    await expect(service.scanFromImage('not-a-data-uri', 'image/jpeg')).rejects.toMatchObject({
      errorCode: 'AI_INGEST_INVALID_FILE',
    });
  });
});
