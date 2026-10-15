import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { computeNitDv } from '@common/utils/nit.util';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import { InvoiceDraftScannerService } from './invoice-draft-scanner.service';
import { INVOICE_DRAFT_SCAN_APP_KEY } from './invoice-draft-scan.types';

/**
 * Fixtures: respuestas JSON del modelo (mockeadas) para un lote típico
 * RUT del cliente + cotización + nota «50 % anticipo, 30 días».
 */
const NIT = '900123456';
const NIT_DV = computeNitDv(NIT);
const WRONG_DV = String((Number(NIT_DV) + 1) % 10);

const RUT_QUOTE_NOTE_RESPONSE = {
  acquirer: {
    document_type: 'NIT',
    document_number: `900.123.456-${WRONG_DV}`,
    verification_digit: '',
    person_type: 'JURIDICA',
    name: 'Constructora Andina S.A.S.',
    email: 'Compras@Andina.CO',
    phone: '+57 (601) 555 1234',
    address_line: 'Cra 7 # 71-21',
    city_name: 'Bogotá',
    department_name: 'Cundinamarca',
    municipality_code: '11001',
    tax_regime: 'Régimen Común',
    fiscal_responsibilities: ['O-13', '15', 'X-99', 'O-13'],
  },
  invoice: {
    issue_date: '2026-10-14',
    due_date: '2026-11-13',
    currency: '',
    reference: 'COT-2026-118',
    notes: 'Anticipo del 50 % según cotización COT-2026-118',
  },
  payment: {
    payment_form: 'crédito',
    payment_term_days: 30,
    payment_method_hint: 'transferencia',
  },
  lines: [
    {
      description: 'Cemento gris 50kg',
      sku: 'CEM-50',
      quantity: 100,
      unit_price: 14.5, // 14.500 COP mal leído como decimal
      discount_percent: 0,
      tax_rate: 19,
      confidence: 92,
    },
    {
      description: 'Varilla corrugada 1/2 pulgada',
      sku: null,
      quantity: 50,
      unit_price: 12000,
      discount_percent: 10,
      tax_rate: 0.19,
      confidence: 60,
    },
    { description: '   ', quantity: 1, unit_price: 1000, tax_rate: 19 },
  ],
  totals: {
    subtotal: 1990000,
    tax_total: 378100,
    total: 2368100,
  },
  field_confidence: {
    'acquirer.document_number': 95,
    'acquirer.verification_digit': 90,
    'acquirer.name': 97,
    'acquirer.municipality_code': 90,
    'acquirer.email': 50,
    'invoice.issue_date': 90,
    'invoice.due_date': 90,
  },
  note_applied: 'Se facturó el 50 % de cada línea de la cotización y pago a 30 días.',
  confidence: 88,
  extraction_notes: null,
};

const file = (mimeType: string, name = 'doc'): AiScanFile => ({
  buffer: Buffer.from('not-really-an-image'),
  mimeType,
  originalName: name,
  size: 19,
});

describe('InvoiceDraftScannerService', () => {
  let aiEngine: { assertVisionModelLinked: jest.Mock; run: jest.Mock };
  let prisma: {
    products: { findFirst: jest.Mock; findMany: jest.Mock };
    product_variants: { findFirst: jest.Mock };
  };
  let settings: { getStoreCurrencyInfo: jest.Mock };
  let customers: { findByDocumentInOrganization: jest.Mock };
  let globalPrisma: {
    organizations: { findFirst: jest.Mock };
    stores: { findFirst: jest.Mock };
    platform_customers: { findFirst: jest.Mock };
    users: { findFirst: jest.Mock };
  };
  let service: InvoiceDraftScannerService;

  const respond = (payload: unknown) =>
    aiEngine.run.mockResolvedValue({
      success: true,
      content: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });

  beforeEach(() => {
    aiEngine = {
      assertVisionModelLinked: jest.fn().mockResolvedValue(undefined),
      run: jest.fn(),
    };
    prisma = {
      products: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    settings = {
      getStoreCurrencyInfo: jest
        .fn()
        .mockResolvedValue({ code: 'COP', decimal_places: 0 }),
    };
    customers = {
      findByDocumentInOrganization: jest.fn().mockResolvedValue(null),
    };
    globalPrisma = {
      organizations: { findFirst: jest.fn().mockResolvedValue(null) },
      stores: { findFirst: jest.fn().mockResolvedValue(null) },
      platform_customers: { findFirst: jest.fn().mockResolvedValue(null) },
      users: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 7, store_id: 3, user_id: 1 } as any);
    service = new InvoiceDraftScannerService(
      aiEngine as any,
      prisma as any,
      settings as any,
      customers as any,
      globalPrisma as any,
    );
    respond(RUT_QUOTE_NOTE_RESPONSE);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('message construction', () => {
    it('sends ONE user message with the instruction text + one image part per file', async () => {
      const files = [
        file('application/pdf', 'rut.pdf'),
        file('image/png', 'cot.png'),
        file('image/jpeg', 'oc.jpg'),
      ];
      const result = await service.scanDraftFromFiles(files, {
        note: '  Facturar el 50 % del anticipo, pago a 30 días  ',
      });

      expect(aiEngine.run).toHaveBeenCalledTimes(1);
      const [appKey, vars, messages] = aiEngine.run.mock.calls[0];
      expect(appKey).toBe(INVOICE_DRAFT_SCAN_APP_KEY);
      expect(vars).toEqual({
        user_note: 'Facturar el 50 % del anticipo, pago a 30 días',
        store_currency: 'COP',
      });
      expect(messages).toHaveLength(1);
      const parts = messages[0].content;
      expect(parts[0].type).toBe('text');
      expect(parts[0].text).toContain('3 documents');
      expect(parts[0].text).toContain('Facturar el 50 % del anticipo, pago a 30 días');
      expect(parts[0].text).toContain('NO decimals'); // currency instruction
      const images = parts.filter((p: any) => p.type === 'image_url');
      expect(images).toHaveLength(3);
      // PDFs viajan crudos con su mime.
      expect(images[0].image_url.url.startsWith('data:application/pdf;base64,')).toBe(true);
      expect(result.documents_scanned).toBe(3);
    });

    it('without a note it says so and nulls note_applied', async () => {
      const result = await service.scanDraftFromFiles([file('image/png')]);
      const [, vars, messages] = aiEngine.run.mock.calls[0];
      expect(vars.user_note).toBe('(sin nota)');
      expect(messages[0].content[0].text).toContain('USER NOTE: none');
      expect(result.note_applied).toBeNull();
    });

    it('applies the note result: note_applied is carried through', async () => {
      const result = await service.scanDraftFromFiles([file('image/png')], {
        note: '50 % anticipo, 30 días',
      });
      expect(result.note_applied).toContain('50 %');
      expect(result.requires_review).not.toContain('note_applied');
    });

    it('flags note_applied for review when a note was given but the model ignored it', async () => {
      respond({ ...RUT_QUOTE_NOTE_RESPONSE, note_applied: null });
      const result = await service.scanDraftFromFiles([file('image/png')], {
        note: '50 % anticipo',
      });
      expect(result.requires_review).toContain('note_applied');
    });
  });

  describe('acquirer normalization', () => {
    it('strips the DV from the NIT, recomputes it and warns on a mismatch', async () => {
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.document_type.value).toBe('NIT');
      expect(acquirer.document_number.value).toBe(NIT);
      expect(acquirer.verification_digit.value).toBe(NIT_DV);
      expect(acquirer.verification_digit.warning).toContain(`«${WRONG_DV}»`);
    });

    it('a matching DV is verified with confidence 100 and no warning', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        acquirer: {
          ...RUT_QUOTE_NOTE_RESPONSE.acquirer,
          document_number: NIT,
          verification_digit: NIT_DV,
        },
      });
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.verification_digit).toEqual({
        value: NIT_DV,
        confidence: 100,
        warning: null,
      });
    });

    it('non-NIT documents carry no DV and are not reported missing it', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        acquirer: {
          ...RUT_QUOTE_NOTE_RESPONSE.acquirer,
          document_type: 'Cédula de ciudadanía',
          document_number: '1.018.234.567',
          person_type: '',
        },
      });
      const result = await service.scanDraftFromFiles([file('image/png')]);
      expect(result.acquirer.document_type.value).toBe('CC');
      expect(result.acquirer.document_number.value).toBe('1018234567');
      expect(result.acquirer.verification_digit.value).toBeNull();
      expect(result.acquirer.person_type.value).toBe('NATURAL');
      expect(result.missing_fields).not.toContain('acquirer.verification_digit');
    });

    it('maps PASSPORT to PA and keeps the alphanumeric number', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        acquirer: {
          ...RUT_QUOTE_NOTE_RESPONSE.acquirer,
          document_type: 'PASSPORT',
          document_number: 'ab-123456',
        },
      });
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.document_type.value).toBe('PA');
      expect(acquirer.document_number.value).toBe('AB123456');
    });

    it('validates enums: unknown values become null with a warning', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        acquirer: {
          ...RUT_QUOTE_NOTE_RESPONSE.acquirer,
          document_type: 'LICENCIA',
          person_type: 'SOCIEDAD',
          tax_regime: 'Régimen raro',
        },
        payment: { ...RUT_QUOTE_NOTE_RESPONSE.payment, payment_form: 'trueque' },
      });
      const result = await service.scanDraftFromFiles([file('image/png')]);
      for (const f of [
        result.acquirer.document_type,
        result.acquirer.person_type,
        result.acquirer.tax_regime,
        result.payment.payment_form,
      ]) {
        expect(f.value).toBeNull();
        expect(f.warning).toBeTruthy();
      }
      expect(result.requires_review).toEqual(
        expect.arrayContaining([
          'acquirer.document_type',
          'acquirer.person_type',
          'acquirer.tax_regime',
          'payment.payment_form',
        ]),
      );
    });

    it('normalizes regime, responsibilities, email, phone and DANE code', async () => {
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.tax_regime.value).toBe('COMUN');
      expect(acquirer.fiscal_responsibilities.value).toEqual(['O-13', 'O-15']);
      expect(acquirer.fiscal_responsibilities.warning).toContain('X-99');
      expect(acquirer.email.value).toBe('compras@andina.co');
      expect(acquirer.email.warning).toBeTruthy(); // confianza 50 < 75
      expect(acquirer.phone.value).toBe('+576015551234');
      expect(acquirer.municipality_code.value).toBe('11001');
    });

    it('drops a low-confidence DANE code instead of pre-filling it', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        field_confidence: {
          ...RUT_QUOTE_NOTE_RESPONSE.field_confidence,
          'acquirer.municipality_code': 40,
        },
      });
      const { acquirer, missing_fields } = await service.scanDraftFromFiles([
        file('image/png'),
      ]);
      expect(acquirer.municipality_code.value).toBeNull();
      expect(acquirer.municipality_code.warning).toBeTruthy();
      expect(missing_fields).toContain('acquirer.municipality_code');
    });
  });

  describe('existing customer lookup', () => {
    it('fills existing_customer_id with a read-only lookup in the organization', async () => {
      customers.findByDocumentInOrganization.mockResolvedValue({ id: 321 });
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(customers.findByDocumentInOrganization).toHaveBeenCalledWith(7, NIT, 'NIT');
      expect(acquirer.existing_customer_id).toBe(321);
      // En tienda nunca se busca un adquiriente de plataforma.
      expect(acquirer.existing_acquirer).toBeNull();
      expect(globalPrisma.organizations.findFirst).not.toHaveBeenCalled();
    });

    it('a lookup failure degrades to null instead of failing the scan', async () => {
      customers.findByDocumentInOrganization.mockRejectedValue(new Error('db down'));
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.existing_customer_id).toBeNull();
    });
  });

  describe('invoice, payment and dates', () => {
    it('keeps valid ISO dates and defaults the currency to the store one', async () => {
      const { invoice, payment } = await service.scanDraftFromFiles([file('image/png')]);
      expect(invoice.issue_date.value).toBe('2026-10-14');
      expect(invoice.due_date.value).toBe('2026-11-13');
      expect(invoice.currency).toEqual({ value: 'COP', confidence: 100, warning: null });
      expect(payment.payment_form.value).toBe('credit');
      expect(payment.payment_term_days.value).toBe(30);
    });

    it('rejects impossible dates (null + warning) and converts DD/MM/YYYY', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        invoice: {
          ...RUT_QUOTE_NOTE_RESPONSE.invoice,
          issue_date: '2026-02-30',
          due_date: '15/11/2026',
        },
      });
      const { invoice, missing_fields, requires_review } =
        await service.scanDraftFromFiles([file('image/png')]);
      expect(invoice.issue_date.value).toBeNull();
      expect(invoice.issue_date.warning).toContain('2026-02-30');
      expect(invoice.due_date.value).toBe('2026-11-15');
      expect(missing_fields).toContain('invoice.issue_date');
      expect(requires_review).toContain('invoice.issue_date');
    });

    it('warns when the due date is before the issue date', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        invoice: { ...RUT_QUOTE_NOTE_RESPONSE.invoice, due_date: '2026-10-01' },
      });
      const { invoice } = await service.scanDraftFromFiles([file('image/png')]);
      expect(invoice.due_date.warning).toContain('anterior');
    });

    it('derives credit + term days from the dates when the model left them empty', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        payment: { payment_form: '', payment_term_days: null, payment_method_hint: '' },
      });
      const { payment } = await service.scanDraftFromFiles([file('image/png')]);
      expect(payment.payment_term_days.value).toBe(30);
      expect(payment.payment_term_days.warning).toBeTruthy();
      expect(payment.payment_form.value).toBe('credit');
    });
  });

  describe('lines and amounts', () => {
    it('repairs COP amounts misread as decimals, normalizes fractional tax rates and drops empty lines', async () => {
      const { lines, extraction_notes } = await service.scanDraftFromFiles([
        file('image/png'),
      ]);
      expect(lines).toHaveLength(2);
      expect(lines[0].unit_price.value).toBe(14500);
      expect(lines[0].unit_price.warning).toContain('14500');
      expect(lines[1].tax_rate.value).toBe(19);
      expect(lines[1].tax_rate.warning).toContain('fracción');
      expect(lines[1].discount_percent.value).toBe(10);
      expect(extraction_notes).toContain('Se corrigieron 1 valor');
    });

    it('confidence is clamped to 0-100', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        confidence: 250,
        lines: [{ description: 'Servicio', quantity: 1, unit_price: 1000, tax_rate: 19, confidence: -5 }],
        field_confidence: { 'acquirer.name': 140 },
      });
      const { lines, acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(lines[0].description.confidence).toBe(0);
      expect(acquirer.name.confidence).toBe(100);
      expect(acquirer.document_number.confidence).toBe(100); // fallback = overall (clamped)
    });

    it('checks totals consistency against the returned lines', async () => {
      // 100 × 14.500 × 1,19 + 50 × 12.000 × 0,9 × 1,19 = 1.725.500 + 642.600 = 2.368.100
      const ok = await service.scanDraftFromFiles([file('image/png')]);
      expect(ok.totals).toEqual({
        subtotal: 1990000,
        tax_total: 378100,
        total: 2368100,
        consistent: true,
      });

      respond({ ...RUT_QUOTE_NOTE_RESPONSE, totals: { ...RUT_QUOTE_NOTE_RESPONSE.totals, total: 5000000 } });
      const bad = await service.scanDraftFromFiles([file('image/png')]);
      expect(bad.totals.consistent).toBe(false);
      expect(bad.requires_review).toContain('totals.total');
      expect(bad.extraction_notes).toContain('no coincide');
    });
  });

  describe('catalog matching', () => {
    it('matches by SKU (product), then variant SKU, then name keywords', async () => {
      prisma.products.findFirst.mockResolvedValueOnce({ id: 11 }); // CEM-50
      prisma.products.findMany.mockResolvedValue([
        { id: 20, name: 'Tornillo drywall' },
        { id: 21, name: 'Varilla corrugada 1/2 pulgada' },
      ]);
      const { lines, requires_review } = await service.scanDraftFromFiles([
        file('image/png'),
      ]);
      expect(lines[0]).toMatchObject({
        product_id: 11,
        product_variant_id: null,
        match_status: 'matched',
        match_confidence: 95,
      });
      expect(lines[1]).toMatchObject({
        product_id: 21,
        match_status: 'matched',
        match_confidence: 100,
      });
      // Archivados nunca se proponen.
      expect(prisma.products.findFirst.mock.calls[0][0].where.state).toEqual({
        not: 'archived',
      });
      expect(prisma.products.findMany.mock.calls[0][0].where.state).toEqual({
        not: 'archived',
      });
      expect(requires_review).not.toContain('lines.1.product_id');
    });

    it('falls back to the variant SKU', async () => {
      prisma.product_variants.findFirst.mockResolvedValueOnce({ id: 501, product_id: 50 });
      const { lines } = await service.scanDraftFromFiles([file('image/png')]);
      expect(lines[0]).toMatchObject({
        product_id: 50,
        product_variant_id: 501,
        match_status: 'matched',
      });
    });

    it('a mid-score name match is partial and flagged for review; a weak one is none', async () => {
      prisma.products.findMany.mockResolvedValue([{ id: 30, name: 'Varilla lisa 3/8' }]);
      const { lines, requires_review } = await service.scanDraftFromFiles([
        file('image/png'),
      ]);
      // "Varilla corrugada 1/2 pulgada" (4 palabras): 1 de 4 → 20 (< 50).
      expect(lines[1].match_status).toBe('none');
      expect(lines[1].product_id).toBeNull();

      prisma.products.findMany.mockResolvedValue([
        { id: 31, name: 'Varilla corrugada 1/2' },
      ]);
      // 3 de 4 palabras → 60: ≥ 50 (partial) y < 90 (matched).
      const second = await service.scanDraftFromFiles([file('image/png')]);
      expect(second.lines[1]).toMatchObject({ product_id: 31, match_status: 'partial' });
      expect(second.requires_review).toContain('lines.1.product_id');
      expect(requires_review).not.toContain('lines.1.product_id');
    });
  });

  describe('missing_fields / requires_review', () => {
    it('lists empty required fields but not optional ones', async () => {
      respond({
        ...RUT_QUOTE_NOTE_RESPONSE,
        acquirer: { ...RUT_QUOTE_NOTE_RESPONSE.acquirer, address_line: '', email: '' },
        invoice: { ...RUT_QUOTE_NOTE_RESPONSE.invoice, reference: '', notes: '' },
        lines: [],
      });
      const { missing_fields } = await service.scanDraftFromFiles([file('image/png')]);
      expect(missing_fields).toEqual(
        expect.arrayContaining(['acquirer.address_line', 'acquirer.email', 'lines']),
      );
      expect(missing_fields).not.toContain('invoice.reference');
      expect(missing_fields).not.toContain('invoice.notes');
    });

    it('requires_review holds low-confidence and warned paths', async () => {
      const { requires_review } = await service.scanDraftFromFiles([file('image/png')]);
      expect(requires_review).toEqual(
        expect.arrayContaining([
          'acquirer.verification_digit', // DV mismatch
          'acquirer.email', // confidence 50
          'lines.0.unit_price', // repaired
          'lines.1.quantity', // line confidence 60
        ]),
      );
      expect(requires_review).not.toContain('acquirer.name');
    });
  });

  describe('prompt v2 fields', () => {
    const base = RUT_QUOTE_NOTE_RESPONSE;

    it('resolves the DANE code from city + department against the DIAN list (with review warning)', async () => {
      respond({
        ...base,
        acquirer: {
          ...base.acquirer,
          municipality_code: '',
          city_name: 'Medellin',
          department_name: 'antioquia',
        },
      });
      const { acquirer, requires_review, missing_fields } =
        await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.municipality_code.value).toBe('05001');
      expect(acquirer.municipality_code.warning).toContain('catálogo DANE');
      expect(requires_review).toContain('acquirer.municipality_code');
      expect(missing_fields).not.toContain('acquirer.municipality_code');
    });

    it('resolves a unique city without department and fills the department name', async () => {
      respond({
        ...base,
        acquirer: {
          ...base.acquirer,
          municipality_code: '',
          city_name: 'Bogotá D.C.',
          department_name: '',
        },
      });
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.municipality_code.value).toBe('11001');
      expect(acquirer.department_name.value).toBe('Bogotá');
    });

    it('never picks among homonyms when the department is missing or unknown', async () => {
      respond({
        ...base,
        acquirer: {
          ...base.acquirer,
          municipality_code: '',
          city_name: 'Villanueva',
          department_name: '',
        },
      });
      let result = await service.scanDraftFromFiles([file('image/png')]);
      expect(result.acquirer.municipality_code.value).toBeNull();

      respond({
        ...base,
        acquirer: {
          ...base.acquirer,
          municipality_code: '',
          city_name: 'Villanueva',
          department_name: 'Atlantida',
        },
      });
      result = await service.scanDraftFromFiles([file('image/png')]);
      expect(result.acquirer.municipality_code.value).toBeNull();
    });

    it('rejects a 5-digit code that is not in the DIAN list and fills names from a valid one', async () => {
      respond({
        ...base,
        acquirer: { ...base.acquirer, municipality_code: '99999', city_name: '', department_name: '' },
      });
      let result = await service.scanDraftFromFiles([file('image/png')]);
      expect(result.acquirer.municipality_code.value).toBeNull();
      expect(result.acquirer.municipality_code.warning).toContain('no existe');

      respond({
        ...base,
        acquirer: { ...base.acquirer, municipality_code: '76001', city_name: '', department_name: '' },
      });
      result = await service.scanDraftFromFiles([file('image/png')]);
      expect(result.acquirer.municipality_code.value).toBe('76001');
      expect(result.acquirer.city_name.value).toBe('Cali');
      expect(result.acquirer.department_name.value).toBe('Valle del Cauca');
    });

    it('warns when the read city contradicts the read DANE code', async () => {
      respond({
        ...base,
        acquirer: { ...base.acquirer, municipality_code: '05001', city_name: 'Cali' },
      });
      const { acquirer } = await service.scanDraftFromFiles([file('image/png')]);
      expect(acquirer.municipality_code.value).toBe('05001');
      expect(acquirer.municipality_code.warning).toContain('no a «Cali»');
    });

    it('normalizes line units to UN/ECE rec. 20 codes; ambiguous ML is not guessed', async () => {
      respond({
        ...base,
        lines: [
          { description: 'Cemento', quantity: 1, unit_price: 1000, tax_rate: 19, unit_code: 'Und', confidence: 90 },
          { description: 'Baldosa', quantity: 3, unit_price: 1000, tax_rate: 19, unit: 'm²', confidence: 90 },
          { description: 'Asesoría', quantity: 2, unit_price: 1000, tax_rate: 19, unit_code: 'HUR', confidence: 90 },
          { description: 'Zócalo', quantity: 2, unit_price: 1000, tax_rate: 19, unit_code: 'ML', confidence: 90 },
          { description: 'Arena', quantity: 2, unit_price: 1000, tax_rate: 19, confidence: 90 },
        ],
      });
      const { lines, requires_review, missing_fields } =
        await service.scanDraftFromFiles([file('image/png')]);
      expect(lines.map((l) => l.unit_code.value)).toEqual(['NIU', 'MTK', 'HUR', null, null]);
      expect(lines[3].unit_code.warning).toContain('ML');
      expect(requires_review).toContain('lines.3.unit_code');
      expect(missing_fields).not.toContain('lines.4.unit_code');
    });

    it('keeps the exchange rate only with a foreign currency', async () => {
      respond({
        ...base,
        invoice: {
          ...base.invoice,
          currency: 'USD',
          exchange_rate: '4123,456',
          exchange_rate_date: '13/10/2026',
        },
      });
      let { invoice } = await service.scanDraftFromFiles([file('image/png')]);
      expect(invoice.exchange_rate.value).toBe(4123.46);
      expect(invoice.exchange_rate_date.value).toBe('2026-10-13');

      respond({
        ...base,
        invoice: { ...base.invoice, currency: 'COP', exchange_rate: 1, exchange_rate_date: '2026-10-13' },
      });
      ({ invoice } = await service.scanDraftFromFiles([file('image/png')]));
      expect(invoice.exchange_rate.value).toBeNull();
      expect(invoice.exchange_rate_date.value).toBeNull();
    });

    it('rejects a non-positive exchange rate and never reports an absent one as missing', async () => {
      respond({ ...base, invoice: { ...base.invoice, currency: 'USD', exchange_rate: -3 } });
      const { invoice, missing_fields } = await service.scanDraftFromFiles([file('image/png')]);
      expect(invoice.exchange_rate.value).toBeNull();
      expect(invoice.exchange_rate.warning).toBeTruthy();
      expect(missing_fields).not.toContain('invoice.exchange_rate');
      expect(missing_fields).not.toContain('invoice.exchange_rate_date');
    });

    it('normalizes printed withholdings: type aliases, percent rate, per-mil ReteICA warning, junk dropped', async () => {
      respond({
        ...base,
        withholdings: [
          { type: 'Retención en la fuente', rate: '2,5', concept: 'Servicios', confidence: 90 },
          { type: 'RETEIVA', rate: 15, confidence: 90 },
          { type: 'ReteICA', rate: 9.66, confidence: 90 },
          { type: 'Estampilla', rate: 1, confidence: 90 },
          { concept: 'nada' },
        ],
      });
      const { withholdings, requires_review } = await service.scanDraftFromFiles([
        file('image/png'),
      ]);
      expect(withholdings).toHaveLength(4);
      expect(withholdings[0]).toEqual({
        type: { value: 'retefuente', confidence: 90, warning: null },
        rate: { value: 2.5, confidence: 90, warning: null },
        concept_hint: 'Servicios',
      });
      expect(withholdings[1].type.value).toBe('reteiva');
      expect(withholdings[2].rate.warning).toContain('por mil');
      expect(withholdings[3].type.value).toBeNull();
      expect(requires_review).toEqual(
        expect.arrayContaining(['withholdings.2.rate', 'withholdings.3.type']),
      );
    });

    it('withholdings default to [] and aiu to null when the model omits them (prompt v1)', async () => {
      const { withholdings, aiu } = await service.scanDraftFromFiles([file('image/png')]);
      expect(withholdings).toEqual([]);
      expect(aiu).toBeNull();
    });

    it('normalizes the AIU split and flags out-of-range percents', async () => {
      respond({
        ...base,
        aiu: {
          administracion_percent: '10',
          imprevistos_percent: 5,
          utilidad_percent: 150,
          contract_object: '  Obra civil   bodega  norte ',
        },
        field_confidence: { ...base.field_confidence, 'aiu.administracion_percent': 95 },
      });
      const { aiu, requires_review, missing_fields } = await service.scanDraftFromFiles([
        file('image/png'),
      ]);
      expect(aiu?.administracion_percent).toEqual({ value: 10, confidence: 95, warning: null });
      expect(aiu?.imprevistos_percent.value).toBe(5);
      expect(aiu?.utilidad_percent.value).toBeNull();
      expect(aiu?.contract_object.value).toBe('Obra civil bodega norte');
      expect(requires_review).toContain('aiu.utilidad_percent');
      expect(missing_fields.some((p) => p.startsWith('aiu.'))).toBe(false);
    });

    it('an empty AIU object is null', async () => {
      respond({ ...base, aiu: { administracion_percent: null, contract_object: '' } });
      const { aiu } = await service.scanDraftFromFiles([file('image/png')]);
      expect(aiu).toBeNull();
    });
  });

  describe('failures', () => {
    it('unparseable model output → INVOICE_DRAFT_SCAN_PARSE_FAIL', async () => {
      respond('esto no es json');
      await expect(service.scanDraftFromFiles([file('image/png')])).rejects.toMatchObject({
        errorCode: ErrorCodes.INVOICE_DRAFT_SCAN_PARSE_FAIL.code,
      });
    });

    it('a JSON array is not a draft → INVOICE_DRAFT_SCAN_PARSE_FAIL', async () => {
      respond('[1,2]');
      await expect(service.scanDraftFromFiles([file('image/png')])).rejects.toMatchObject({
        errorCode: ErrorCodes.INVOICE_DRAFT_SCAN_PARSE_FAIL.code,
      });
    });

    it('AI failure → INVOICE_DRAFT_SCAN_AI_FAILED carrying the provider error', async () => {
      aiEngine.run.mockResolvedValue({ success: false, error: 'model does not accept images' });
      const err = await service
        .scanDraftFromFiles([file('image/png')])
        .catch((e) => e);
      expect(err).toBeInstanceOf(VendixHttpException);
      expect(err.errorCode).toBe(ErrorCodes.INVOICE_DRAFT_SCAN_AI_FAILED.code);
      expect(err.message).toContain('model does not accept images');
    });

    it('missing vision model → INVOICE_DRAFT_SCAN_NOT_READY and the model is never called', async () => {
      aiEngine.assertVisionModelLinked.mockRejectedValue(
        new VendixHttpException(ErrorCodes.AI_VISION_001, 'sin modelo de visión'),
      );
      await expect(service.scanDraftFromFiles([file('image/png')])).rejects.toMatchObject({
        errorCode: ErrorCodes.INVOICE_DRAFT_SCAN_NOT_READY.code,
      });
      expect(aiEngine.run).not.toHaveBeenCalled();
      expect(aiEngine.assertVisionModelLinked).toHaveBeenCalledWith(INVOICE_DRAFT_SCAN_APP_KEY);
    });

    it('assertReady rethrows unrelated errors untouched', async () => {
      const boom = new Error('redis down');
      aiEngine.assertVisionModelLinked.mockRejectedValue(boom);
      await expect(service.assertReady()).rejects.toBe(boom);
    });
  });
  describe('platform context (riel super-admin)', () => {
    const superAdminCtx = {
      store_id: null,
      organization_id: 1,
      user_id: 99,
      is_super_admin: true,
    };
    const scanPlatform = (job_context: any = superAdminCtx) =>
      service.scanDraftFromFiles([file('image/png')], {
        note: null,
        context: 'platform',
        job_context,
      });

    it('uses COP without reading store settings and tells the model the seller is Vendix', async () => {
      settings.getStoreCurrencyInfo.mockResolvedValue({ code: 'USD', decimal_places: 2 });
      const result = await scanPlatform();
      expect(settings.getStoreCurrencyInfo).not.toHaveBeenCalled();
      const [, vars, messages] = aiEngine.run.mock.calls[0];
      expect(vars.store_currency).toBe('COP');
      expect(messages[0].content[0].text).toContain('seller/issuer of this invoice is Vendix');
      expect(result.invoice.currency.value).toBe('COP');
    });

    it('does not cross the product catalog nor the store customers: free lines', async () => {
      const { lines, acquirer } = await scanPlatform();
      expect(prisma.products.findFirst).not.toHaveBeenCalled();
      expect(prisma.products.findMany).not.toHaveBeenCalled();
      expect(prisma.product_variants.findFirst).not.toHaveBeenCalled();
      expect(customers.findByDocumentInOrganization).not.toHaveBeenCalled();
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatchObject({
          product_id: null,
          product_variant_id: null,
          match_status: 'none',
        });
      }
      expect(acquirer.existing_customer_id).toBeNull();
      expect(acquirer.existing_acquirer).toBeNull();
    });

    it('existing_acquirer by tenant (organization first, exact tax_id)', async () => {
      globalPrisma.organizations.findFirst.mockResolvedValue({ id: 44 });
      const { acquirer } = await scanPlatform();
      expect(acquirer.existing_acquirer).toEqual({
        kind: 'organization',
        tenant_id: 44,
        id: 'org:44',
      });
      expect(globalPrisma.organizations.findFirst.mock.calls[0][0].where).toMatchObject({
        tax_id: NIT,
        is_platform: false,
      });
      expect(globalPrisma.platform_customers.findFirst).not.toHaveBeenCalled();
    });

    it('existing_acquirer by store when no organization matches', async () => {
      globalPrisma.stores.findFirst.mockResolvedValue({ id: 12 });
      const { acquirer } = await scanPlatform();
      expect(acquirer.existing_acquirer).toEqual({ kind: 'store', tenant_id: 12, id: 'store:12' });
    });

    it('existing_acquirer by platform_customers (same DIAN document code)', async () => {
      globalPrisma.platform_customers.findFirst.mockResolvedValue({ id: 7 });
      const { acquirer } = await scanPlatform();
      expect(acquirer.existing_acquirer).toEqual({
        kind: 'customer',
        tenant_id: 7,
        id: 'customer:7',
      });
      expect(globalPrisma.platform_customers.findFirst.mock.calls[0][0].where).toEqual({
        tax_id: NIT,
        document_type: '31',
      });
    });

    it('a lookup failure degrades existing_acquirer to null', async () => {
      globalPrisma.organizations.findFirst.mockRejectedValue(new Error('db down'));
      const { acquirer } = await scanPlatform();
      expect(acquirer.existing_acquirer).toBeNull();
    });

    it('rejects a non super-admin or a store context before calling the AI', async () => {
      for (const ctx of [
        { ...superAdminCtx, is_super_admin: false },
        { ...superAdminCtx, store_id: 3 },
      ]) {
        await expect(scanPlatform(ctx)).rejects.toMatchObject({
          errorCode: ErrorCodes.INVOICE_DRAFT_SCAN_PLATFORM_FORBIDDEN.code,
        });
      }
      expect(aiEngine.run).not.toHaveBeenCalled();
    });

    it('without job context falls back to the request context (store user → rejected)', async () => {
      // beforeEach deja un contexto de tienda sin super-admin.
      await expect(scanPlatform(null)).rejects.toMatchObject({
        errorCode: ErrorCodes.INVOICE_DRAFT_SCAN_PLATFORM_FORBIDDEN.code,
      });
    });
  });
});
