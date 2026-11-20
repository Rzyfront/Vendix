/**
 * ia-cargas F3 — the purchase invoice scanner reads through the shared
 * document reader (pages, native text first) and the numbers it produces are
 * the SAME the old single call produced for the same model answer.
 */
import { InvoiceScannerService } from './invoice-scanner.service';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { PURCHASE_ORDER_ITEMS_MAX } from './dto/create-purchase-order.dto';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports

const COP = { code: 'COP', decimal_places: 0 };
const PDF = Buffer.from('%PDF-1.7 factura de compra');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const IMG = 'data:image/jpeg;base64,/9j/AAAA';

type FakePage = { page_number: number; mode: 'text' | 'image' | 'text+image'; text: string; image?: string };

const textPages = (n: number): FakePage[] =>
  Array.from({ length: n }, (_, i) => ({
    page_number: i + 1,
    mode: 'text' as const,
    text: `FACTURA ELECTRONICA FV-77 pagina ${i + 1} ` + 'x'.repeat(220),
  }));

function build(options: {
  answers?: Array<string | Record<string, unknown>>;
  /** Picks the answer from the batch message (multi-batch runs in parallel). */
  answerFor?: (text: string) => string | Record<string, unknown>;
  pages?: FakePage[];
  prepareError?: Error;
  realPages?: boolean;
}) {
  const queue = [...(options.answers ?? [])];
  const toResponse = (a: string | Record<string, unknown>) =>
    typeof a === 'string'
      ? { success: true, content: a, finish_reason: 'stop' }
      : a;
  const ai = {
    run: jest.fn(async (_app: string, _vars: unknown, messages: any[]) => {
      if (options.answerFor) {
        const text = JSON.stringify(messages[0]?.content ?? '');
        return toResponse(options.answerFor(text));
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
  const settings = { getStoreCurrencyInfo: jest.fn().mockResolvedValue(COP) };
  const service = new InvoiceScannerService(
    ai as any,
    null as any,
    null as any,
    settings as any,
    null as any,
    null as any,
    pages as any,
    new AiExtractionService(ai as any),
  );
  return { service, ai, pages };
}

/** The OLD path for the same model answer: parse + normalizeOcrResponse. */
function oldPath(service: InvoiceScannerService, content: string) {
  return (service as any).normalizeOcrResponse(JSON.parse(content), COP);
}

// ── A fixed v2 answer: COP, IVA 19 % on top, line discounts, IBUA, a bonus ──
const V2_ANSWER = {
  schema_version: 2,
  supplier: { name: 'Distribuidora Andina SAS', tax_id: '900123456-7', address: null, phone: null },
  invoice_number: 'FE-2041',
  invoice_date: '2026-11-15',
  currency: 'COP',
  payment_terms: '30 días',
  price_basis: 'sin_iva',
  line_items: [
    {
      description: 'Gaseosa 400ml x 48',
      sku_if_visible: 'GAS400',
      quantity: 48,
      unit_price: 1250,
      price_basis: null,
      discount: { kind: 'amount', value: 5400, basis: null },
      taxes: [],
      is_bonus: false,
      printed_line_total: 54600,
    },
    {
      description: 'Jugo caja 1L',
      sku_if_visible: null,
      quantity: 24,
      unit_price: 2100,
      price_basis: null,
      discount: { kind: 'none', value: 0, basis: null },
      taxes: [
        { type: 'ibua', treatment: 'gravado', rate: null, fixed_amount_per_unit: null, amount: 3120, inclusive: null },
        { type: 'iva', treatment: 'gravado', rate: 19, fixed_amount_per_unit: null, amount: 9576, inclusive: null },
      ],
      is_bonus: false,
      printed_line_total: 63096,
    },
    {
      description: 'Galleta 10u',
      sku_if_visible: null,
      quantity: 10,
      unit_price: 800,
      price_basis: null,
      discount: { kind: 'percent', value: 5, basis: null },
      taxes: [{ type: 'iva', treatment: 'gravado', rate: 19, fixed_amount_per_unit: null, amount: null, inclusive: null }],
      is_bonus: false,
      printed_line_total: 9044,
    },
    {
      description: 'Bonificación gaseosa',
      sku_if_visible: null,
      quantity: 6,
      unit_price: 0,
      price_basis: null,
      discount: { kind: 'none', value: 0, basis: null },
      taxes: [],
      is_bonus: true,
      printed_line_total: 0,
    },
  ],
  discounts: [],
  printed_subtotal: 112600,
  printed_iva_total: 11020,
  printed_total: 126740,
  confidence: 92,
};

// ── A v1 answer with IVA included and a COP price misread as decimals ──
const V1_INCLUSIVE_ANSWER = {
  supplier: { name: 'Tienda Mayorista', tax_id: '800999888' },
  invoice_number: 'T-88',
  invoice_date: '2026-11-10',
  prices_include_tax: true,
  line_items: [
    { description: 'Arroz 500g', quantity: 10, unit_price: 2.38, total: 23800, tax_rate: 0.19 },
    { description: 'Sal 1kg', quantity: 5, unit_price: 1500, total: 7500, tax_rate: 0 },
  ],
  subtotal: 27500,
  tax_amount: 3800,
  total: 31300,
  confidence: 80,
};

describe('InvoiceScannerService · ia-cargas F3 (lector común)', () => {
  it('PDF con texto nativo: la página viaja como texto, nunca el PDF crudo, en UNA llamada', async () => {
    const content = JSON.stringify(V2_ANSWER);
    const { service, ai, pages } = build({ answers: [content], pages: textPages(1) });

    const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null);

    expect(pages.prepareForAi).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: 'application/pdf', size: PDF.length }),
      expect.objectContaining({ maxPages: 10, maxBytes: 15 * 1024 * 1024, splitTallImages: false }),
    );
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [appKey, , messages] = ai.run.mock.calls[0];
    expect(appKey).toBe('invoice_ocr');
    const parts = messages[0].content as any[];
    expect(parts.some((p) => p.type === 'image_url')).toBe(false);
    expect(JSON.stringify(parts)).not.toContain('application/pdf');
    expect(parts[0].text).toContain('Extract all data from this purchase invoice.');
    // The store currency instruction still travels with the request.
    expect(parts[0].text).toContain('COP');
    expect(parts[1].text).toContain('FACTURA ELECTRONICA FV-77');
    expect(res.scan_source).toEqual({ pages: 1, text_pages: 1, batches: 1 });
  });

  it('PDF escaneado: cada página va como imagen renderizada', async () => {
    const scanned: FakePage[] = [
      { page_number: 1, mode: 'image', text: '', image: IMG },
      { page_number: 2, mode: 'text+image', text: 'Total a pagar', image: IMG },
    ];
    const { service, ai } = build({ answers: [JSON.stringify(V2_ANSWER)], pages: scanned });

    const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'ingredient', null);

    const [appKey, , messages] = ai.run.mock.calls[0];
    expect(appKey).toBe('invoice_ocr_ingredient');
    const images = (messages[0].content as any[]).filter((p) => p.type === 'image_url');
    expect(images).toHaveLength(2);
    images.forEach((p) => expect(p.image_url.url).toMatch(/^data:image\/jpeg;base64,/));
    expect(res.scan_source).toEqual({ pages: 2, text_pages: 0, batches: 1 });
  });

  it('una foto conserva el pedido de siempre (y el tipo real se toma de los bytes)', async () => {
    const photo: FakePage[] = [{ page_number: 1, mode: 'image', text: '', image: IMG }];
    const { service, ai, pages } = build({ answers: [JSON.stringify(V2_ANSWER)], pages: photo });

    // Declared as PDF by the S3 key, but the bytes are a PNG.
    await service.scanInvoiceFromBuffer(PNG, 'application/pdf', 'retail', null);

    expect(pages.prepareForAi).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: 'image/png' }),
      expect.anything(),
    );
    const text = (ai.run.mock.calls[0][2][0].content as any[])[0].text as string;
    expect(text.startsWith('Extract all data from this purchase invoice image. Return ONLY the JSON object matching the schema defined in your system instructions.\n\n')).toBe(true);
  });

  describe('moneda e impuestos idénticos a los de antes (caso fijo)', () => {
    it('v2 con IVA aparte, descuentos, IBUA y bonificación', async () => {
      const content = JSON.stringify(V2_ANSWER);
      const { service } = build({ answers: [content] });
      const attachment = { key: 'k', file_name: 'f.pdf', file_type: 'application/pdf', file_size: 1 };

      const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', attachment);

      const { scan_source, scan_attachment, ...numbers } = res as any;
      expect(numbers).toEqual(oldPath(service, content));
      expect(scan_attachment).toEqual(attachment);
      // Pinned figures (COP, 0 decimals).
      expect(res.subtotal).toBe(112600);
      expect(res.tax_amount).toBe(11020);
      expect(res.total).toBe(126740);
      expect(res.prices_include_tax).toBe(false);
      expect(res.line_items).toHaveLength(4);
      expect(res.line_items[0]).toEqual(
        expect.objectContaining({ quantity: 48, unit_price: 1250, total: 54600, discount_amount: 5400 }),
      );
      expect(res.line_items[1].taxes).toEqual([
        expect.objectContaining({ tax_type: 'ibua', calc_mode: 'fixed_per_unit', amount_override: 3120 }),
        expect.objectContaining({ tax_type: 'iva', tax_rate: 19, calc_mode: 'percent', amount_override: 9576 }),
      ]);
      expect(res.line_items[2]).toEqual(
        expect.objectContaining({ quantity: 10, unit_price: 800, total: 9044 }),
      );
      expect(res.line_items[3]).toEqual(expect.objectContaining({ is_bonus: true, total: 0 }));
    });

    it('v1 con IVA incluido y un precio COP leído con decimales', async () => {
      const content = JSON.stringify(V1_INCLUSIVE_ANSWER);
      const { service } = build({ answers: [content] });

      const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null);

      const { scan_source, scan_attachment, ...numbers } = res as any;
      expect(numbers).toEqual(oldPath(service, content));
      expect(res.prices_include_tax).toBe(true);
      // 2.38 → 2380 (COP has no decimals) and the repair is announced.
      expect(res.line_items[0].unit_price_gross).toBe(2380);
      expect(res.scan_warnings?.some((w) => w.includes('Se corrigieron'))).toBe(true);
      expect(res.total).toBe(31300);
    });
  });

  it('factura de 7 páginas: 2 lotes, sin duplicar la línea repetida en el borde, progreso real', async () => {
    const batch1 = {
      schema_version: 2,
      supplier: { name: 'Distribuidora Andina SAS', tax_id: '900123456-7' },
      invoice_number: 'FE-3000',
      invoice_date: '2026-11-18',
      price_basis: 'sin_iva',
      line_items: [V2_ANSWER.line_items[0], V2_ANSWER.line_items[2]],
      discounts: [],
      printed_subtotal: null,
      printed_total: null,
      confidence: 90,
    };
    const batch2 = {
      schema_version: 2,
      supplier: { name: null },
      invoice_number: null,
      // The model saw the last line of page 5 again at the top of page 6.
      line_items: [V2_ANSWER.line_items[2], V2_ANSWER.line_items[1]],
      discounts: [],
      printed_subtotal: 112600,
      printed_iva_total: 11020,
      printed_total: 126740,
      confidence: 85,
    };
    const { service, ai } = build({
      pages: textPages(7),
      answerFor: (text) =>
        text.includes('pages 6-7 of a 7-page invoice')
          ? JSON.stringify(batch2)
          : JSON.stringify(batch1),
    });
    const reportProgress = jest.fn().mockResolvedValue(undefined);

    const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null, {
      reportProgress,
    });

    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(res.invoice_number).toBe('FE-3000');
    expect(res.supplier.name).toBe('Distribuidora Andina SAS');
    expect(res.line_items.map((l) => l.description)).toEqual([
      'Gaseosa 400ml x 48',
      'Galleta 10u',
      'Jugo caja 1L',
    ]);
    // The repeated line keeps ITS quantity (10), not 20.
    expect(res.line_items.filter((l) => l.description === 'Galleta 10u')).toHaveLength(1);
    expect(res.line_items[1].quantity).toBe(10);
    expect(res.total).toBe(126740);
    expect(res.scan_warnings?.some((w) => w.includes('se contó una sola vez'))).toBe(true);
    expect(res.scan_source).toEqual({ pages: 7, text_pages: 7, batches: 2 });
    expect(reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({ done: 7, total: 7, unit: 'páginas' }),
    );
    // Same quota unit for both calls.
    const keys = ai.run.mock.calls.map((c: any[]) => c[3]?.quotaKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('subtotal impreso que no cuadra con las líneas (varias páginas) → aviso, sin corregir', async () => {
    const answer = { ...V2_ANSWER, printed_subtotal: 150000 };
    const { service } = build({ answers: [JSON.stringify(answer)], pages: textPages(2) });

    const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null);

    expect(res.subtotal).toBe(150000);
    expect(res.scan_warnings?.some((w) => w.includes('El subtotal impreso'))).toBe(true);
  });

  it('una página que el modelo no pudo leer se avisa por número y el resto se carga', async () => {
    const batch1 = { ...V2_ANSWER, printed_total: null };
    const { service } = build({
      pages: textPages(6),
      answerFor: (text) => (text.includes('page 6 of a 6-page') ? 'no es json' : JSON.stringify(batch1)),
    });

    const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null);

    expect(res.line_items).toHaveLength(4);
    expect(res.scan_warnings?.some((w) => w.includes('La página 6 no se pudo interpretar'))).toBe(true);
    expect(res.scan_source?.missing_pages).toEqual([6]);
  });

  describe('más de 100 líneas', () => {
    const many = {
      ...V2_ANSWER,
      line_items: Array.from({ length: 130 }, (_, i) => ({
        ...V2_ANSWER.line_items[0],
        description: `Producto ${i + 1}`,
        sku_if_visible: `SKU${i + 1}`,
      })),
      printed_subtotal: null,
      printed_total: null,
    };

    it('ninguna línea se pierde en el escaneo y el emparejamiento avisa cuántas son y el tope de la OC', async () => {
      const { service } = build({ answers: [JSON.stringify(many)] });
      const scan = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null);
      expect(scan.line_items).toHaveLength(130);

      jest
        .spyOn(service as any, 'resolveVatResponsibility')
        .mockResolvedValue({ responsible: false, indeterminate: false });
      jest
        .spyOn(service as any, 'matchSupplier')
        .mockResolvedValue({ name: 'A', confidence: 100, is_new: false, matched_id: 1 });
      jest
        .spyOn(service as any, 'findProductCandidates')
        .mockResolvedValue({ candidates: [], archivedDiscards: [] });
      jest.spyOn(service as any, 'reconcileFractionalQuantities').mockResolvedValue(undefined);

      const match = await service.matchProducts(scan);

      expect(match.items).toHaveLength(130);
      const limitWarning = match.warnings.find((w) => w.includes(`máximo ${PURCHASE_ORDER_ITEMS_MAX}`));
      expect(limitWarning).toContain('130 líneas');
    });
  });

  describe('errores del documento (AI_INGEST_*) y de la IA', () => {
    it('demasiadas páginas: el código AI_INGEST_TOO_MANY_PAGES llega tal cual', async () => {
      const { service, ai } = build({
        prepareError: new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES, 'El PDF excede el máximo de 10 páginas.'),
      });
      await expect(
        service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null),
      ).rejects.toMatchObject({ errorCode: 'AI_INGEST_TOO_MANY_PAGES' });
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('un archivo que no es PDF ni imagen → AI_INGEST_INVALID_FILE sin llamar a la IA', async () => {
      const { service, ai } = build({});
      await expect(
        service.scanInvoiceFromBuffer(Buffer.from('hola, soy texto'), 'image/jpeg', 'retail', null),
      ).rejects.toMatchObject({ errorCode: 'AI_INGEST_INVALID_FILE' });
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('respuesta ilegible: se repara una vez y, si sigue mal, INV_SCAN_PARSE_FAIL (mismo código de siempre)', async () => {
      const { service, ai } = build({ answers: ['no es json', 'tampoco'] });
      await expect(
        service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null),
      ).rejects.toMatchObject({ errorCode: 'INV_SCAN_PARSE_FAIL' });
      expect(ai.run).toHaveBeenCalledTimes(2);
    });

    it('la reparación recupera la respuesta', async () => {
      const { service } = build({ answers: ['no es json', JSON.stringify(V2_ANSWER)] });
      const res = await service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null);
      expect(res.total).toBe(126740);
    });

    it('la IA falla → INV_SCAN_AI_FAIL (BullMQ reintenta)', async () => {
      const { service } = build({ answers: [{ success: false, error: 'boom' } as any] });
      await expect(
        service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null),
      ).rejects.toMatchObject({ errorCode: 'INV_SCAN_AI_FAIL' });
    });

    it('respuesta cortada de una sola página → AI_INGEST_INCOMPLETE (problema del documento)', async () => {
      const { service } = build({
        answers: [{ success: true, content: '{"line_items":[', finish_reason: 'length' } as any],
      });
      await expect(
        service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null),
      ).rejects.toMatchObject({ errorCode: 'AI_INGEST_INCOMPLETE' });
    });

    it('sin proveedor ni líneas → INV_SCAN_INCOMPLETE como antes', async () => {
      const { service } = build({ answers: [JSON.stringify({ invoice_number: 'X' })] });
      await expect(
        service.scanInvoiceFromBuffer(PDF, 'application/pdf', 'retail', null),
      ).rejects.toMatchObject({ errorCode: 'INV_SCAN_INCOMPLETE' });
    });
  });

  describe('comprobante de pago de OC', () => {
    it('prepareImage: foto enderezada y reducida por el lector común (JPEG)', async () => {
      const png = await sharp({
        create: { width: 3000, height: 1000, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer();
      const { service } = build({ realPages: true });

      const out = await service.prepareImage({
        buffer: png,
        mimetype: 'image/png',
        size: png.length,
        originalname: 'pago.png',
      } as any);

      expect(out.mimeType).toBe('image/jpeg');
      const meta = await sharp(Buffer.from(out.base64, 'base64')).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(1536);
    });

    it('prepareImage: un archivo que no es foto se rechaza como problema del documento', async () => {
      const { service } = build({ realPages: true });
      await expect(
        service.prepareImage({
          buffer: Buffer.from('no soy una imagen'),
          mimetype: 'image/jpeg',
          size: 17,
          originalname: 'x.jpg',
        } as any),
      ).rejects.toMatchObject({ errorCode: 'AI_INGEST_INVALID_FILE' });
    });

    it('scanPaymentFromImage: lee los mismos campos, con reparación si el JSON viene roto', async () => {
      const { service, ai } = build({
        answers: [
          'Aquí está: {"amount": "150000"',
          '```json\n{"amount": 150000, "payment_date": "2026-11-01", "payment_method": "transfer", "reference": "ABC-1", "currency": "COP", "notes": null, "confidence": 88}\n```',
        ],
      });

      const out = await service.scanPaymentFromImage(IMG, 'image/jpeg');

      expect(ai.run).toHaveBeenCalledTimes(2);
      expect(ai.run.mock.calls[0][0]).toBe('payment_receipt_ocr');
      expect(out).toEqual({
        amount: 150000,
        payment_date: '2026-11-01',
        payment_method: 'transfer',
        reference: 'ABC-1',
        currency: 'COP',
        notes: null,
        confidence: 88,
      });
    });

    it('scanPaymentFromImage: JSON imposible → INV_SCAN_PARSE_FAIL (reintentable en su cola)', async () => {
      const { service } = build({ answers: ['nada', 'nada'] });
      await expect(service.scanPaymentFromImage(IMG, 'image/jpeg')).rejects.toMatchObject({
        errorCode: 'INV_SCAN_PARSE_FAIL',
      });
    });
  });
});
