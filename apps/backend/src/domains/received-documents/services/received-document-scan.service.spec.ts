import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ReceivedDocumentsService } from '../received-documents.service';
import type { ReceivedDocumentSourceFile } from './received-document-pages.service';
import { ReceivedDocumentScanService } from './received-document-scan.service';

const file: ReceivedDocumentSourceFile = {
  buffer: Buffer.from('opaque-test-bytes'),
  mimetype: 'application/pdf',
  size: 17,
  originalname: 'supplier.pdf',
};

const validFacts = () => ({
  document_type: 'invoice',
  invoice_number: 'A-100',
  issuer_tax_id: '900123456',
  issuer_name: 'Proveedor SAS',
  receiver_tax_id: '800123456',
  receiver_name: 'Comprador SAS',
  issue_date: '2026-04-12',
  currency: 'COP',
  subtotal_amount: '100',
  discount_amount: '0',
  tax_amount: '0',
  total_amount: '100',
  items: [{
    description: 'Insumo',
    quantity: '1',
    unit_price: '100',
    discount_amount: '0',
    net_amount: '100',
    total_amount: '100',
  }],
  taxes: [],
});

const pages = {
  page_count: 2,
  pages: [
    { page_number: 1, data_uri: 'data:image/jpeg;base64,AA==', mime_type: 'image/jpeg' as const, text: 'texto-uno' },
    { page_number: 2, data_uri: 'data:image/jpeg;base64,BB==', mime_type: 'image/jpeg' as const, text: '' },
  ],
};

function harness(
  content: string | undefined,
  options: { success?: boolean; model?: string; runError?: Error; configError?: Error } = {},
) {
  const events: string[] = [];
  const aiEngine = {
    assertVisionModelLinked: jest.fn(async () => {
      events.push('configured');
      if (options.configError) throw options.configError;
    }),
    run: jest.fn(async (...args: unknown[]) => {
      events.push('run');
      if (options.runError) throw options.runError;
      return {
        success: options.success ?? true,
        content,
        model: options.model ?? 'vision-model-1',
      };
    }),
  };
  const pagesService = {
    prepare: jest.fn(async () => {
      events.push('prepare');
      return pages;
    }),
  };
  const core = new ReceivedDocumentsService({} as never, {} as never, {} as never);
  const service = new ReceivedDocumentScanService(aiEngine as never, pagesService as never, core);
  return { service, aiEngine, pagesService, core, events };
}

describe('ReceivedDocumentScanService', () => {
  it('checks vision configuration before preparation and makes one multimodal run with every ordered page', async () => {
    const extraction = { facts: validFacts(), evidence: [{ field: 'facts.invoice_number', page: 1, quote: 'A-100' }] };
    const h = harness(JSON.stringify(extraction));
    const result = await h.service.extract(file);

    expect(h.events.slice(0, 2)).toEqual(['configured', 'prepare']);
    expect(h.aiEngine.run).toHaveBeenCalledTimes(1);
    expect(h.aiEngine.run).toHaveBeenCalledWith('received_document_ocr', {}, [expect.objectContaining({ role: 'user' })]);
    const runArgs = h.aiEngine.run.mock.calls[0] as unknown as [string, Record<string, string>, Array<{ content: unknown }>];
    const message = runArgs[2][0] as { content: Array<Record<string, unknown>> };
    expect(message.content).toHaveLength(5);
    expect(message.content.map((part) => part['type'])).toEqual(['text', 'text', 'image_url', 'text', 'image_url']);
    expect(message.content[1]['text']).toContain('Página 1');
    expect(message.content[1]['text']).toContain('texto-uno');
    expect(message.content[3]['text']).toContain('Página 2');
    expect(message.content[3]['text']).toContain('puede estar vacío');
    expect(message.content[2]['image_url']).toEqual({ url: pages.pages[0].data_uri, detail: 'high' });
    expect(message.content[4]['image_url']).toEqual({ url: pages.pages[1].data_uri, detail: 'high' });
    expect(result).toMatchObject({ raw_extraction: extraction, page_count: 2, model: 'vision-model-1' });
  });

  it('refuses unconfigured OCR without preparing pages or calling the AI app', async () => {
    const h = harness('{}', { configError: new Error('vision app is not configured') });
    await expect(h.service.extract(file)).rejects.toThrow('vision app is not configured');
    expect(h.pagesService.prepare).not.toHaveBeenCalled();
    expect(h.aiEngine.run).not.toHaveBeenCalled();
  });

  it('maps provider failures and unsuccessful/missing responses to safe scan errors', async () => {
    const providerFailure = harness(undefined, { runError: new Error('private provider detail') });
    await expect(providerFailure.service.extract(file)).rejects.toMatchObject({ errorCode: ErrorCodes.INV_SCAN_AI_FAIL.code });
    const unsuccessful = harness('ignored', { success: false });
    await expect(unsuccessful.service.extract(file)).rejects.toMatchObject({ errorCode: ErrorCodes.INV_SCAN_AI_FAIL.code });
    const missing = harness(undefined);
    await expect(missing.service.extract(file)).rejects.toMatchObject({ errorCode: ErrorCodes.INV_SCAN_AI_FAIL.code });
  });

  it('preserves safe AI gate/configuration errors instead of hiding actionable codes', async () => {
    const quotaOrConfigError = new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    const h = harness(undefined, { runError: quotaOrConfigError });
    await expect(h.service.extract(file)).rejects.toBe(quotaOrConfigError);
  });

  it('rejects invalid JSON, non-object roots, non-object facts and excessive nesting safely', async () => {
    const cases = ['not-json', '[]', JSON.stringify({ facts: [] })];
    const deep = { facts: {} } as Record<string, unknown>;
    let cursor = deep;
    for (let i = 0; i < 22; i += 1) {
      const child: Record<string, unknown> = {};
      cursor['x'] = child;
      cursor = child;
    }
    cases.push(JSON.stringify(deep));
    for (const content of cases) {
      const h = harness(content);
      await expect(h.service.extract(file)).rejects.toMatchObject({ errorCode: ErrorCodes.INV_SCAN_PARSE_FAIL.code });
    }
  });

  it('retains missing buyer and unknown currency as normalizer blocking errors', async () => {
    const facts = { ...validFacts(), receiver_tax_id: null, receiver_name: null, currency: 'ZZZ' };
    const h = harness(JSON.stringify({ facts, evidence: [] }));
    const result = await h.service.extract(file);
    const errorCodes = result.normalized.validation.errors.map((issue) => issue.code);
    expect(errorCodes).toContain('MISSING_RECEIVER_TAX_ID');
    expect(errorCodes).toContain('MISSING_RECEIVER_NAME');
    expect(errorCodes).toContain('INVALID_CURRENCY');
    expect(result.normalized.currency).toBe('UNKNOWN');
  });

  it('keeps unknown document types and overlength identity facts blocking', async () => {
    const facts = { ...validFacts(), document_type: 'unknown_kind', issuer_tax_id: 'N'.repeat(51) };
    const h = harness(JSON.stringify({ facts, evidence: [] }));
    const result = await h.service.extract(file);
    const codes = result.normalized.validation.errors.map((issue) => issue.code);
    expect(codes).toContain('MISSING_OR_INVALID_DOCUMENT_TYPE');
    expect(codes).toContain('MISSING_ISSUER_TAX_ID');
  });

  it('blocks supplied malformed optional money and date/key fields instead of omitting them', async () => {
    const facts = {
      ...validFacts(),
      charge_amount: '1'.repeat(70),
      payable_rounding_amount: '2'.repeat(70),
      due_date: '2026-01-01'.repeat(6),
      document_key: 'K'.repeat(129),
    };
    const h = harness(JSON.stringify({ facts, evidence: [] }));
    const result = await h.service.extract(file);
    const optionalErrors = result.normalized.validation.errors.filter((issue) => issue.code === 'INVALID_OCR_OPTIONAL_FIELD');
    const message = optionalErrors.map((issue) => issue.message).join(' ');
    expect(message).toContain('facts.charge_amount');
    expect(message).toContain('facts.payable_rounding_amount');
    expect(message).toContain('facts.due_date');
    expect(message).toContain('facts.document_key');
    expect(result.normalized.validation.errors.some((issue) => issue.code.includes('CHARGE') || issue.code.includes('ROUNDING'))).toBe(true);
  });

  it('maps only fixed manual facts and never forwards status or tenant/entity injection', async () => {
    const h = harness(JSON.stringify({ facts: { ...validFacts(), organization_id: 123, accounting_entity_id: 456, review_status: 'reviewed', posting_status: 'posted', accepted: true }, evidence: [] }));
    const normalizeSpy = jest.spyOn(h.core, 'normalizeExtractionFacts');
    await h.service.extract(file);
    const dto = normalizeSpy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(dto).toHaveProperty('receiver_tax_id', '800123456');
    expect(dto).not.toHaveProperty('organization_id');
    expect(dto).not.toHaveProperty('accounting_entity_id');
    expect(dto).not.toHaveProperty('review_status');
    expect(dto).not.toHaveProperty('posting_status');
    expect(dto).not.toHaveProperty('accepted');
  });

  it('preserves source-array overflows as blocking normalization errors', async () => {
    const tooManyFacts = {
      ...validFacts(),
      items: Array.from({ length: 502 }, (_, i) => ({
        description: `Línea ${i + 1}`, quantity: '1', unit_price: '1', discount_amount: '0', net_amount: '1', total_amount: '1',
        taxes: Array.from({ length: 21 }, () => ({ tax_type: 'unclassified', tax_name: 'Otro', rate: '0', base_amount: '1', amount: '0' })),
      })),
      taxes: Array.from({ length: 102 }, () => ({ tax_type: 'unclassified', tax_name: 'Otro', rate: '0', base_amount: '1', amount: '0' })),
    };
    const h = harness(JSON.stringify({ facts: tooManyFacts, evidence: [] }));
    const result = await h.service.extract(file);
    const errorCodes = result.normalized.validation.errors.map((issue) => issue.code);
    expect(errorCodes).toContain('TOO_MANY_DOCUMENT_LINES');
    expect(errorCodes).toContain('TOO_MANY_HEADER_TAX_ROWS');
    expect(errorCodes).toContain('TOO_MANY_LINE_TAX_ROWS');
  });

  it('adds a blocking review issue for nominal unit taxes instead of coercing them to percentages', async () => {
    const facts = {
      ...validFacts(),
      taxes: [{ tax_type: 'ibua', tax_name: 'Impuesto por unidad', tax_basis_type: 'unit', base_quantity: '1', base_unit_code: 'KG', per_unit_amount: '50', rate: null, base_amount: '0', amount: '0' }],
    };
    const h = harness(JSON.stringify({ facts, evidence: [] }));
    const result = await h.service.extract(file);
    expect(result.normalized.validation.errors).toContainEqual(expect.objectContaining({ code: 'UNREVIEWED_NOMINAL_TAX_BASIS' }));
  });

  it('does not mistake null nominal-basis metadata on a monetary tax for a unit tax', async () => {
    const facts = {
      ...validFacts(),
      tax_amount: '19',
      total_amount: '119',
      taxes: [{
        tax_type: 'iva', tax_name: 'IVA', tax_basis_type: 'monetary',
        base_quantity: null, base_unit_code: null, per_unit_amount: null,
        rate: '19', base_amount: '100', amount: '19',
      }],
    };
    const h = harness(JSON.stringify({ facts, evidence: [] }));
    const result = await h.service.extract(file);
    expect(result.normalized.validation.errors).not.toContainEqual(expect.objectContaining({ code: 'UNREVIEWED_NOMINAL_TAX_BASIS' }));
  });

  it('rejects oversized provider JSON before parsing', async () => {
    const h = harness(' '.repeat(1024 * 1024 + 1));
    await expect(h.service.extract(file)).rejects.toMatchObject({ errorCode: ErrorCodes.INV_SCAN_PARSE_FAIL.code });
  });
});
