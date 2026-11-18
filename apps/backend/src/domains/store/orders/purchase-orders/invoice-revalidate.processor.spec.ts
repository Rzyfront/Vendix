import { UnrecoverableError } from 'bullmq';
import {
  InvoiceRevalidateProcessor,
  mimeFromBytes,
} from './invoice-revalidate.processor';
import { InvoiceScannerService } from './invoice-scanner.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build(aiContent: string | { success: false; error: string }) {
  const aiEngine = {
    run: jest.fn().mockResolvedValue(
      typeof aiContent === 'string'
        ? { success: true, content: aiContent }
        : aiContent,
    ),
  };
  const settings = {
    getStoreCurrencyInfo: jest
      .fn()
      .mockResolvedValue({ code: 'COP', decimal_places: 0 }),
  };
  const scanner = new InvoiceScannerService(
    aiEngine as any,
    null as any,
    null as any,
    settings as any,
    null as any,
    null as any,
  );
  const s3 = { downloadFile: jest.fn().mockResolvedValue(Buffer.from('doc')) };
  const monitor = {
    runAiWork: jest.fn((_job: unknown, _source: unknown, work: () => unknown) =>
      work(),
    ),
    onFailed: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new InvoiceRevalidateProcessor(
    scanner,
    s3 as any,
    monitor as any,
  );
  return { processor, aiEngine, s3, monitor };
}

const job = (over: Record<string, unknown> = {}) =>
  ({
    id: '7',
    data: {
      store_id: 1,
      organization_id: 1,
      user_id: 9,
      scan_attachment_key: 'org/store/purchase-orders/scans/1-f.pdf',
      order_type: 'retail',
      consolidated: {
        supplier: { name: 'ACME' },
        invoice_number: 'FV-1',
        invoice_date: '2026-09-01',
        prices_include_tax: false,
        line_items: [
          {
            description: 'Lata',
            quantity: 2,
            unit_price: 1000,
            unit_price_gross: 1000,
            total: 2380,
            taxes: [
              {
                tax_type: 'iva',
                tax_rate: 19,
                calc_mode: 'percent',
                fixed_amount_per_unit: null,
                amount_override: null,
                is_inclusive: false,
              },
            ],
          },
        ],
        subtotal: 2000,
        tax_amount: 380,
        total: 2380,
      },
      note: 'cambié el precio a propósito',
      ...over,
    },
  }) as any;

describe('InvoiceRevalidateProcessor', () => {
  it('devuelve consolidated normalizado (taxes en %) y report saneado', async () => {
    const ai = JSON.stringify({
      consolidated: {
        supplier: { name: 'ACME SAS' },
        invoice_number: 'FV-1',
        invoice_date: '2026-09-01',
        prices_include_tax: false,
        line_items: [
          {
            description: 'Lata',
            quantity: 3,
            unit_price: 1000,
            total: 3570,
            tax_rate: 0.19,
            taxes: [
              { type: 'iva', rate: 0.19, amount: null, inclusive: false },
            ],
            discount_amount: 0,
          },
        ],
        subtotal: 3000,
        tax_amount: 570,
        total: 3570,
      },
      report: {
        summary: 'x'.repeat(1500),
        confidence: 'bogus',
        findings: [{ severity: 'warning', message: 'Revisar' }],
        divergences: [
          {
            line_index: 0,
            field: 'quantity',
            consolidated_value: 2,
            document_value: 3,
            revalidated_value: 3,
            reason: 'La cantidad impresa es 3',
          },
        ],
      },
    });
    const { processor, aiEngine, s3 } = build(ai);

    const res = await processor.process(job());

    expect(s3.downloadFile).toHaveBeenCalledWith(
      'org/store/purchase-orders/scans/1-f.pdf',
    );
    const [appKey, vars, extra] = aiEngine.run.mock.calls[0];
    expect(appKey).toBe('invoice_ocr_revalidate');
    expect(vars.user_note).toContain('a propósito');
    expect(JSON.parse(vars.consolidated_json).line_items[0].taxes[0]).toEqual(
      expect.objectContaining({ type: 'iva', rate: 19 }),
    );
    expect(extra[0].content[1].image_url.url).toMatch(/^data:/);

    expect(res.consolidated.line_items[0].quantity).toBe(3);
    expect(res.consolidated.line_items[0].taxes![0]).toEqual(
      expect.objectContaining({
        tax_type: 'iva',
        tax_rate: 19,
        calc_mode: 'percent',
      }),
    );
    expect(res.consolidated.line_items[0].unit_price_gross).toBe(1000);
    expect((res.consolidated as any).scan_attachment).toBeUndefined();
    expect(res.report.summary).toHaveLength(1000);
    expect(res.report.confidence).toBe('medium');
    expect(res.report.red_flags).toEqual([]);
    expect(res.report.findings).toEqual([
      { severity: 'warning', message: 'Revisar' },
    ]);
    expect(res.report.divergences).toHaveLength(1);
    expect(res.report.divergences[0]).toEqual(
      expect.objectContaining({ line_index: 0, field: 'quantity' }),
    );
  });

  it('limita a 100 divergencias', async () => {
    const divergences = Array.from({ length: 150 }, (_, i) => ({
      line_index: i,
      field: 'total',
      reason: 'r',
    }));
    const { processor } = build(
      JSON.stringify({
        consolidated: {
          supplier: { name: 'A' },
          line_items: [{ description: 'x', quantity: 1, unit_price: 1, total: 1 }],
          total: 1,
        },
        report: { divergences },
      }),
    );
    const res = await processor.process(job());
    expect(res.report.divergences).toHaveLength(100);
  });

  it('JSON inválido => UnrecoverableError en español', async () => {
    const { processor } = build('esto no es json');
    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('consolidated ausente => UnrecoverableError', async () => {
    const { processor } = build(JSON.stringify({ report: {} }));
    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('fallo de la IA => se relanza (BullMQ reintenta)', async () => {
    const { processor } = build({ success: false, error: 'boom' });
    const p = processor.process(job());
    await expect(p).rejects.toThrow('INV_SCAN_AI_FAIL');
    await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
  });

  it('JSON inválido => failedReason es el CODIGO INV_SCAN_PARSE_FAIL', async () => {
    const { processor } = build('esto no es json');
    await expect(processor.process(job())).rejects.toMatchObject({
      message: 'INV_SCAN_PARSE_FAIL',
    });
  });

  it('envuelve la IA en runAiWork con la fuente invoice-revalidate', async () => {
    const { processor, monitor } = build(
      JSON.stringify({ consolidated: {}, report: {} }),
    );
    const j = job();
    await processor.process(j).catch(() => undefined);
    expect(monitor.runAiWork).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.invoiceRevalidate,
      expect.any(Function),
    );
  });

  it('onFailed delega en el monitor con la fuente y el dueño del job', async () => {
    const { processor, monitor } = build('x');
    const j = job();
    await processor.onFailed(j);
    expect(monitor.onFailed).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.invoiceRevalidate,
      j.data,
    );
  });
});

describe('mimeFromBytes', () => {
  it('detecta PDF, PNG, WEBP y JPEG por bytes mágicos', () => {
    expect(mimeFromBytes(Buffer.from('%PDF-1.7 x'))).toBe('application/pdf');
    expect(
      mimeFromBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])),
    ).toBe('image/png');
    expect(
      mimeFromBytes(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    ).toBe('image/webp');
    expect(mimeFromBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(mimeFromBytes(Buffer.from('doc'))).toBeNull();
  });

  it('el processor prioriza los bytes sobre la extensión y cae a la extensión', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { processor, s3, aiEngine } = build(
      JSON.stringify({ consolidated: {}, report: {} }),
    );
    s3.downloadFile.mockResolvedValue(png);
    await processor.process(job()).catch(() => undefined);
    const call = aiEngine.run.mock.calls[0];
    expect(JSON.stringify(call)).toContain('image/png');
  });
});
