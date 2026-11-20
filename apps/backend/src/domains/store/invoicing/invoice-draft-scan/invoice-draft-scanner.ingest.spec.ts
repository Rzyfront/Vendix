/**
 * ia-cargas F5b (#5) — the sales-invoice draft scanner reads through the
 * shared document reader (pages, native text first, schema + repair, split on
 * a cut answer) and, for the same model answer, produces the SAME quantities,
 * prices, taxes, discounts and customer the old single call produced.
 */
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import { InvoiceDraftScannerService } from './invoice-draft-scanner.service';
import { mergeInvoiceDraftBatches } from './invoice-draft-ingest.profile';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports

const PDF = Buffer.from('%PDF-1.7 cotizacion');
const COP = { code: 'COP', decimal_places: 0 };

type FakePage = { page_number: number; mode: 'text' | 'image' | 'text+image'; text: string; image?: string };

const textPages = (n: number, tag = 'COT'): FakePage[] =>
  Array.from({ length: n }, (_, i) => ({
    page_number: i + 1,
    mode: 'text' as const,
    text: `${tag} pagina ${i + 1} ` + 'x'.repeat(220),
  }));

const pdfFile = (name = 'cotizacion.pdf'): AiScanFile => ({
  buffer: PDF,
  mimeType: 'application/pdf',
  originalName: name,
  size: PDF.length,
});

// ── A fixed answer: buyer by RUT, COP amounts as numbers AND strings, IVA,
// discount, a per-mil ReteICA, AIU, nulls the strict schema would send. ──
const FIXED = {
  acquirer: {
    document_type: 'NIT',
    document_number: '900.123.456-8',
    verification_digit: null,
    person_type: 'JURIDICA',
    name: 'Constructora Andina S.A.S.',
    email: 'compras@andina.co',
    phone: '6015551234',
    address_line: 'Cra 7 # 71-21',
    city_name: 'Bogotá',
    department_name: 'Cundinamarca',
    municipality_code: '11001',
    tax_regime: 'COMUN',
    fiscal_responsibilities: ['O-13', 'O-15'],
  },
  invoice: {
    issue_date: '2026-11-18',
    due_date: '2026-12-18',
    currency: 'COP',
    reference: 'COT-2026-118',
    notes: null,
    exchange_rate: null,
    exchange_rate_date: '',
  },
  payment: { payment_form: 'credit', payment_term_days: 30, payment_method_hint: 'transferencia' },
  lines: [
    { description: 'Cemento gris 50 kg', sku: 'CEM-50', quantity: 40, unit_code: 'NIU', unit_price: 32900, discount_percent: 5, tax_rate: 19, confidence: 92 },
    { description: 'Varilla 1/2"', sku: null, quantity: '120', unit_code: '', unit_price: '18.500', discount_percent: 0, tax_rate: '19', confidence: 85 },
    { description: 'Transporte', sku: null, quantity: 1, unit_code: 'DAY', unit_price: 450000, discount_percent: null, tax_rate: 0.19, confidence: 70 },
  ],
  withholdings: [{ type: 'ReteICA', rate: 9.66, concept: 'Compras', confidence: 80 }],
  aiu: { administracion_percent: 10, imprevistos_percent: 5, utilidad_percent: 5, contract_object: 'Obra bodega' },
  totals: { subtotal: 4880000, tax_total: 927200, total: 5807200 },
  field_confidence: { 'acquirer.document_number': 95, 'acquirer.name': 93, 'invoice.issue_date': 90 },
  note_applied: null,
  confidence: 88,
  extraction_notes: '  Precios sin IVA.  ',
};
const FIXED_JSON = JSON.stringify(FIXED);

function build(options: {
  answers?: Array<string | Record<string, unknown>>;
  answerFor?: (content: string) => string | Record<string, unknown>;
  pagesByFile?: FakePage[][];
  realPages?: boolean;
  prepareError?: Error;
}) {
  const queue = [...(options.answers ?? [])];
  const toResponse = (a: string | Record<string, unknown>) =>
    typeof a === 'string' ? { success: true, content: a, finish_reason: 'stop' } : a;
  const aiEngine = {
    assertVisionModelLinked: jest.fn().mockResolvedValue(undefined),
    run: jest.fn(async (_app: string, _vars: unknown, messages: any[]) => {
      if (options.answerFor) {
        return toResponse(options.answerFor(JSON.stringify(messages[0]?.content ?? '')));
      }
      return toResponse(queue.shift() ?? FIXED_JSON);
    }),
  };
  let call = 0;
  const pages = options.realPages
    ? new DocumentPagesService()
    : {
        prepareForAi: options.prepareError
          ? jest.fn().mockRejectedValue(options.prepareError)
          : jest.fn(async () => {
              const list = options.pagesByFile?.[call++] ?? textPages(1);
              return { source: 'pdf', pages: list, page_count: list.length, unreadable_pages: [] };
            }),
      };
  const prisma = {
    products: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new InvoiceDraftScannerService(
    aiEngine as any,
    prisma as any,
    { getStoreCurrencyInfo: jest.fn().mockResolvedValue(COP) } as any,
    { findByDocumentInOrganization: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    new AiExtractionService(aiEngine as any),
    pages as any,
  );
  return { service, aiEngine, pages };
}

/** The OLD path for the same model answer: parseAiJson + normalize. */
function oldPath(service: InvoiceDraftScannerService, content: string, files = 1) {
  return (service as any).normalize(parseAiJson(content), COP, null, files);
}

/** What the money and the customer of a draft are (enrichments aside). */
function moneyAndCustomer(draft: any) {
  const { existing_customer_id, existing_acquirer, ...acquirer } = draft.acquirer;
  return {
    acquirer,
    invoice: draft.invoice,
    payment: draft.payment,
    lines: draft.lines.map((l: any) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount_percent: l.discount_percent,
      tax_rate: l.tax_rate,
      unit_code: l.unit_code,
      sku: l.sku,
    })),
    withholdings: draft.withholdings,
    aiu: draft.aiu,
    totals: draft.totals,
    note_applied: draft.note_applied,
    extraction_notes: draft.extraction_notes,
  };
}

describe('InvoiceDraftScannerService — ai-ingest (F5b)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 7, store_id: 3, user_id: 1 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('fixed case: quantities, prices, taxes, discounts, withholdings, AIU and customer are IDENTICAL to the old path', async () => {
    const { service } = build({ answers: [FIXED_JSON] });
    const draft = await service.scanDraftFromFiles([pdfFile()]);
    const before = oldPath(service, FIXED_JSON);

    expect(moneyAndCustomer(draft)).toEqual(moneyAndCustomer(before));
    // Spot checks of the money, so a change in both paths is still caught.
    expect(draft.lines.map((l) => [l.quantity.value, l.unit_price.value, l.discount_percent.value, l.tax_rate.value])).toEqual([
      [40, 32900, 5, 19],
      [120, 18500, 0, 19], // "18.500" in COP is eighteen thousand five hundred
      [1, 450000, 0, 19], // 0.19 read as a fraction → 19 %
    ]);
    expect(draft.totals).toMatchObject({ subtotal: 4880000, tax_total: 927200, total: 5807200 });
    expect(draft.acquirer.document_number.value).toBe('900123456');
    expect(draft.withholdings[0].rate.value).toBe(9.66);
    expect(draft.aiu?.administracion_percent.value).toBe(10);
  });

  it('a PDF with native text travels as text (never the raw PDF) and a photo as a JPEG, in ONE call', async () => {
    const photo = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    const { service, aiEngine } = build({ answers: [FIXED_JSON], realPages: false, pagesByFile: [textPages(2)] });
    // The photo goes through the REAL pages service via a second scanner.
    const real = build({ answers: [FIXED_JSON], realPages: true });

    await service.scanDraftFromFiles([pdfFile()]);
    const pdfParts = aiEngine.run.mock.calls[0][2][0].content as any[];
    expect(pdfParts.some((p) => p.type === 'image_url')).toBe(false);
    expect(JSON.stringify(pdfParts)).not.toContain('application/pdf');
    expect(pdfParts.filter((p) => p.type === 'text' && p.text.startsWith('--- Page'))).toHaveLength(2);
    expect(pdfParts[0].text).toContain('The pages follow');

    const out = await real.service.scanDraftFromFiles([
      { buffer: photo, mimeType: 'image/jpeg', originalName: 'cot.jpg', size: photo.length },
    ]);
    expect(real.aiEngine.run).toHaveBeenCalledTimes(1);
    const photoParts = real.aiEngine.run.mock.calls[0][2][0].content as any[];
    const images = photoParts.filter((p) => p.type === 'image_url');
    expect(images).toHaveLength(1);
    expect(images[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    // One photo read in one call: the scanner's request, word for word.
    expect(photoParts[0].text.startsWith('Build a sales-invoice draft from this document.')).toBe(true);
    expect(photoParts[0].text).not.toContain('The pages follow');
    expect(out.scan_source).toEqual({ documents: 1, pages: 1, text_pages: 0, batches: 1 });
  });

  it('several files (RUT + quotation + PO): ONE call, every page labelled by document, the note and currency as prompt variables', async () => {
    const { service, aiEngine } = build({
      answers: [FIXED_JSON],
      pagesByFile: [textPages(2, 'RUT'), textPages(3, 'COT'), textPages(1, 'OC')],
    });
    const out = await service.scanDraftFromFiles([pdfFile('rut.pdf'), pdfFile('cot.pdf'), pdfFile('oc.pdf')], {
      note: 'Facturar el 50 %',
    });

    expect(aiEngine.run).toHaveBeenCalledTimes(1);
    const [, vars, messages] = aiEngine.run.mock.calls[0];
    expect(vars).toEqual({ user_note: 'Facturar el 50 %', store_currency: 'COP' });
    const texts = (messages[0].content as any[]).map((p) => p.text ?? '');
    expect(texts[0]).toContain('from these 3 documents');
    expect(texts.filter((t) => t.startsWith('--- Document 2 of 3, page'))).toHaveLength(3);
    expect(out.documents_scanned).toBe(3);
    expect(out.scan_source).toEqual({ documents: 3, pages: 6, text_pages: 6, batches: 1 });
  });

  it('a long draft (14 pages) is read in 2 parts and NO line is lost; totals add up', async () => {
    const part = (from: number, n: number, total: number) =>
      JSON.stringify({
        ...FIXED,
        lines: Array.from({ length: n }, (_, i) => ({
          description: `Item ${from + i}`,
          quantity: 1,
          unit_price: 1000,
          discount_percent: 0,
          tax_rate: 0,
          confidence: 90,
        })),
        withholdings: [],
        aiu: null,
        totals: { subtotal: total, tax_total: 0, total },
      });
    const { service, aiEngine } = build({
      pagesByFile: [textPages(14)],
      answerFor: (content) => (content.includes('Page 11') ? part(91, 60, 60000) : part(1, 90, 90000)),
    });

    const out = await service.scanDraftFromFiles([pdfFile()]);

    expect(aiEngine.run).toHaveBeenCalledTimes(2);
    const second = (aiEngine.run.mock.calls[1][2][0].content as any[])[0].text as string;
    expect(second).toContain('This message holds only page');
    expect(second).toContain('Report ONLY the lines printed on these pages');
    expect(out.lines).toHaveLength(150);
    expect(out.lines[0].description.value).toBe('Item 1');
    expect(out.lines[149].description.value).toBe('Item 150');
    expect(out.totals).toMatchObject({ subtotal: 150000, total: 150000, consistent: true });
    expect(out.warnings?.[0]).toContain('se leyeron en 2 partes');
    expect(out.scan_source).toMatchObject({ pages: 14, batches: 2 });
  });

  it('a cut answer is split by pages instead of failing; more than 200 lines is a visible warning naming the lines left out', async () => {
    const lines = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        description: `Producto ${from + i}`,
        quantity: 1,
        unit_price: 100,
        tax_rate: 19,
      }));
    const { service, aiEngine } = build({
      pagesByFile: [textPages(4)],
      answerFor: (content) => {
        if (content.includes('Page 1') && content.includes('Page 4')) {
          return { success: true, content: '{"lines": [', finish_reason: 'length' };
        }
        return JSON.stringify({
          ...FIXED,
          lines: content.includes('Page 1') ? lines(1, 120) : lines(121, 110),
          totals: {},
        });
      },
    });

    const out = await service.scanDraftFromFiles([pdfFile()]);

    expect(aiEngine.run).toHaveBeenCalledTimes(3); // cut whole + two halves
    expect(out.lines).toHaveLength(200);
    const warning = out.warnings!.find((w) => w.includes('230 líneas'));
    expect(warning).toContain('no se cargaron de la 201 a la 230');
    expect(warning).toContain('Producto 201');
    // The old note stays as it was.
    expect(out.extraction_notes).toContain('Se tomaron solo las primeras 200 líneas.');
  });

  it('a page the model cannot read is reported by number; the other pages still make the draft', async () => {
    const { service } = build({
      pagesByFile: [textPages(12)],
      answerFor: (content) =>
        /Page 1[12]/.test(content)
          ? { success: true, content: '{"lines": [', finish_reason: 'length' }
          : FIXED_JSON,
    });
    const out = await service.scanDraftFromFiles([pdfFile()]);
    expect(out.lines.length).toBeGreaterThan(0);
    expect(out.warnings!.join(' ')).toContain('La página 11 tiene demasiados datos');
    expect(out.warnings!.join(' ')).toContain('La página 12 tiene demasiados datos');
    expect(out.scan_source?.missing_pages).toEqual([
      { document: 1, page: 11 },
      { document: 1, page: 12 },
    ]);
  });

  describe('errors: AI_INGEST_* are document problems; the scanner keeps its codes', () => {
    it('more than 20 pages among all the files → AI_INGEST_TOO_MANY_PAGES before any call', async () => {
      const { service, aiEngine } = build({ pagesByFile: [textPages(10), textPages(10), textPages(2)] });
      await expect(
        service.scanDraftFromFiles([pdfFile(), pdfFile(), pdfFile()]),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.AI_INGEST_TOO_MANY_PAGES.code });
      expect(aiEngine.run).not.toHaveBeenCalled();
    });

    it('a file that is not a PDF nor a photo → AI_INGEST_INVALID_FILE (signature, not declared type)', async () => {
      const { service, aiEngine } = build({});
      await expect(
        service.scanDraftFromFiles([
          { buffer: Buffer.from('PK\x03\x04 word'), mimeType: 'image/png', originalName: 'x.png', size: 9 },
        ]),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.AI_INGEST_INVALID_FILE.code });
      expect(aiEngine.run).not.toHaveBeenCalled();
    });

    it('a PDF without pages keeps AI_INGEST_NO_PAGES', async () => {
      const { service } = build({
        prepareError: new VendixHttpException(ErrorCodes.AI_INGEST_NO_PAGES, 'sin páginas'),
      });
      await expect(service.scanDraftFromFiles([pdfFile()])).rejects.toMatchObject({
        errorCode: ErrorCodes.AI_INGEST_NO_PAGES.code,
      });
    });

    it('a broken answer is repaired once before failing', async () => {
      const { service, aiEngine } = build({ answers: ['no es json', FIXED_JSON] });
      const out = await service.scanDraftFromFiles([pdfFile()]);
      expect(aiEngine.run).toHaveBeenCalledTimes(2);
      expect(out.lines).toHaveLength(3);
    });

    it('no AI credits → AI_PROVIDER_003 (AI unavailable, not a bad document)', async () => {
      const { service } = build({
        answers: [{ success: false, error: 'insufficient credits', failure_reason: 'credits' }],
      });
      await expect(service.scanDraftFromFiles([pdfFile()])).rejects.toMatchObject({
        errorCode: ErrorCodes.AI_PROVIDER_003.code,
      });
    });

    it('a single page whose answer is still cut → AI_INGEST_INCOMPLETE', async () => {
      const { service } = build({
        answers: [{ success: true, content: '{"lines": [', finish_reason: 'length' }],
      });
      await expect(service.scanDraftFromFiles([pdfFile()])).rejects.toMatchObject({
        errorCode: ErrorCodes.AI_INGEST_INCOMPLETE.code,
      });
    });
  });

  describe('mergeInvoiceDraftBatches', () => {
    const p = (page: number) => [{ document: 1, page }];

    it('one batch is returned as is', () => {
      const data = { lines: [{ description: 'A' }] };
      expect(mergeInvoiceDraftBatches([{ pages: p(1), data }])).toEqual({ data, warnings: [] });
    });

    it('buyer from the first batch that has it, with its confidence; a repeated boundary line counted once', () => {
      const merged = mergeInvoiceDraftBatches([
        {
          pages: p(1),
          data: {
            acquirer: { name: 'Andina', document_number: '' },
            lines: [{ description: 'A', quantity: 1, unit_price: 10 }, { description: 'B', quantity: 2, unit_price: 5 }],
            totals: { subtotal: 20, tax_total: 0, total: 20 },
            field_confidence: { 'acquirer.name': 90 },
            confidence: 90,
          },
        },
        {
          pages: p(2),
          data: {
            acquirer: { name: 'Otro', document_number: '900123456' },
            lines: [{ description: 'B', quantity: 2, unit_price: 5 }, { description: 'C', quantity: 1, unit_price: 7 }],
            totals: { subtotal: 17, tax_total: 0, total: 17 },
            field_confidence: { 'acquirer.name': 40, 'acquirer.document_number': 80 },
            confidence: 70,
          },
        },
      ]);
      expect(merged.data.acquirer).toEqual({ name: 'Andina', document_number: '900123456' });
      expect(merged.data.field_confidence).toEqual({ 'acquirer.name': 90, 'acquirer.document_number': 80 });
      expect(merged.data.lines.map((l: any) => l.description)).toEqual(['A', 'B', 'C']);
      expect(merged.data.totals).toEqual({ subtotal: 37, tax_total: 0, total: 37 });
      expect(merged.data.confidence).toBe(70);
      expect(merged.warnings.join(' ')).toContain('«B» aparece igual al final');
    });

    it('totals written as text are not added: the last one, with a warning', () => {
      const merged = mergeInvoiceDraftBatches([
        { pages: p(1), data: { totals: { total: '1.000' } } },
        { pages: p(2), data: { totals: { total: '2.000' } } },
      ]);
      expect(merged.data.totals.total).toBe('2.000');
      expect(merged.warnings.join(' ')).toContain('No se pudieron sumar los totales');
    });
  });
});
