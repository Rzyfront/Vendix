import type { TaxOption } from '../../../../../shared/components/tax-selector';
import { computeNitDv } from '../../../../../shared/utils/nit.util';
import type {
  DraftField,
  InvoiceDraftAiu,
  InvoiceDraftWithholding,
  InvoiceDraftAcquirer,
  InvoiceDraftLine,
  InvoiceDraftScanResult,
} from '../interfaces/invoice-draft-scan.interface';
import {
  DRAFT_LOW_CONFIDENCE,
  addDaysToDateOnly,
  draftDocumentDigits,
  draftLinesToLineInputs,
  draftNitDvMismatch,
  draftPathLabel,
  draftPathToControl,
  draftPaymentMeansCode,
  draftPendingPaths,
  draftTaxSelectionForRate,
  draftToAcquirerPatch,
  draftToInlineCustomerBase,
  draftToInvoicePatch,
  isDateOnly,
  isFinalConsumerDocument,
  countDraftFilledFields,
  draftAiuPatch,
  draftWithholdingConceptType,
  draftWithholdingsToRows,
  type DraftWithholdingConcept,
} from './invoice-draft-mapping';

/**
 * Borrador IA de «Nueva factura» → formulario. Fixtures con la forma EXACTA
 * que devuelve el backend (`InvoiceDraftScanResult`, confianza 0-100).
 */
const f = <T>(value: T | null, confidence = 95, warning: string | null = null): DraftField<T> => ({
  value,
  confidence,
  warning,
});
const none = <T>(): DraftField<T> => f<T>(null, 0);

const NIT = '900123456';
const NIT_DV = computeNitDv(NIT)!;

function acquirer(overrides: Partial<InvoiceDraftAcquirer> = {}): InvoiceDraftAcquirer {
  return {
    document_type: f('NIT'),
    document_number: f(NIT),
    verification_digit: f(NIT_DV),
    person_type: f('JURIDICA' as const),
    name: f('Constructora Andina S.A.S.'),
    email: f('compras@andina.co'),
    phone: f('6015551234'),
    address_line: f('Cra 7 # 71-21'),
    city_name: f('Bogotá'),
    department_name: f('Cundinamarca'),
    municipality_code: f('11001'),
    tax_regime: f('COMUN'),
    fiscal_responsibilities: f(['O-13', 'O-15']),
    existing_customer_id: null,
    ...overrides,
  };
}

function line(overrides: Partial<InvoiceDraftLine> = {}): InvoiceDraftLine {
  return {
    description: f('Cemento gris 50kg'),
    quantity: f(10),
    unit_price: f(14500),
    discount_percent: f(0),
    tax_rate: f(19),
    sku: null,
    product_id: null,
    product_variant_id: null,
    match_status: 'none',
    match_confidence: 0,
    ...overrides,
  };
}

function result(overrides: Partial<InvoiceDraftScanResult> = {}): InvoiceDraftScanResult {
  return {
    acquirer: acquirer(),
    invoice: {
      issue_date: f('2026-10-14'),
      due_date: none(),
      currency: f('COP'),
      reference: none(),
      notes: none(),
    },
    payment: {
      payment_form: none(),
      payment_term_days: none(),
      payment_method_hint: none(),
    },
    lines: [line()],
    totals: { subtotal: null, tax_total: null, total: null, consistent: null },
    note_applied: null,
    missing_fields: [],
    requires_review: [],
    extraction_notes: null,
    documents_scanned: 1,
    ...overrides,
  };
}

const TAXES: TaxOption[] = [
  { id: 1, name: 'IVA 19%', rate: 19, tax_type: 'iva' },
  { id: 2, name: 'INC 8%', rate: 8, tax_type: 'inc' },
  { id: 3, name: 'Retefuente 19%', rate: 19, tax_type: 'retefuente' },
  { id: 4, name: 'IVA 5%', rate: 0.05, tax_type: 'iva' },
];

describe('invoice-draft-mapping', () => {
  it('la confianza va en la misma escala 0-100 que el backend', () => {
    expect(DRAFT_LOW_CONFIDENCE).toBeGreaterThan(1);
    expect(DRAFT_LOW_CONFIDENCE).toBeLessThanOrEqual(100);
  });

  describe('adquiriente', () => {
    it('NIT completo ⇒ controles del adquiriente, DV derivado y marcas IA', () => {
      const { patch, aiPaths, documentSigla, documentDigits } = draftToAcquirerPatch(acquirer());
      expect(documentSigla).toBe('NIT');
      expect(documentDigits).toBe(NIT);
      expect(patch).toEqual(
        jasmine.objectContaining({
          customer_document_type: '31',
          customer_tax_id: NIT,
          customer_verification_digit: NIT_DV,
          customer_person_type: 'JURIDICA',
          customer_name: 'Constructora Andina S.A.S.',
          customer_email: 'compras@andina.co',
          customer_address: 'Cra 7 # 71-21',
          customer_municipality_code: '11001',
          customer_city_name: 'Bogotá',
          customer_department_name: 'Cundinamarca',
          customer_tax_regime: 'COMUN',
          customer_fiscal_responsibilities: ['O-13', 'O-15'],
        }),
      );
      // El DV no se marca: la pantalla lo deriva del número.
      expect(aiPaths).not.toContain('customer_verification_digit');
      expect(aiPaths).toContain('customer_tax_id');
    });

    it('número con puntos y DV pegado ⇒ sólo dígitos', () => {
      expect(draftDocumentDigits('900.123.456-7')).toBe(NIT);
    });

    it('cédula ⇒ persona NATURAL sin DV', () => {
      const { patch } = draftToAcquirerPatch(
        acquirer({
          document_type: f('CC'),
          document_number: f('1020304050'),
          verification_digit: none(),
          person_type: f('JURIDICA' as const),
        }),
      );
      expect(patch['customer_person_type']).toBe('NATURAL');
      expect(patch['customer_verification_digit']).toBe('');
    });

    it('municipio sin código DANE de 5 dígitos ⇒ no se precarga ni ciudad ni departamento', () => {
      const { patch } = draftToAcquirerPatch(acquirer({ municipality_code: f('110') }));
      expect(patch['customer_municipality_code']).toBeUndefined();
      expect(patch['customer_city_name']).toBeUndefined();
    });

    it('régimen y responsabilidades fuera de catálogo se descartan', () => {
      const { patch } = draftToAcquirerPatch(
        acquirer({ tax_regime: f('INVENTADO'), fiscal_responsibilities: f(['ZZ-1']) }),
      );
      expect(patch['customer_tax_regime']).toBeUndefined();
      expect(patch['customer_fiscal_responsibilities']).toBeUndefined();
    });

    it('DV leído que contradice el módulo 11 ⇒ mismatch', () => {
      const wrong = String((Number(NIT_DV) + 1) % 10);
      expect(draftNitDvMismatch(acquirer({ verification_digit: f(wrong) }))).toBeTrue();
      expect(draftNitDvMismatch(acquirer())).toBeFalse();
    });

    it('base del cliente inline: jurídica con razón social y DV', () => {
      const base = draftToInlineCustomerBase(acquirer());
      expect(base).toEqual(
        jasmine.objectContaining({
          legal_name: 'Constructora Andina S.A.S.',
          first_name: '',
          document_type: 'NIT',
          document_number: NIT,
          verification_digit: NIT_DV,
          person_type: 'JURIDICA',
          tax_regime: 'COMUN',
        }),
      );
    });
  });

  describe('cabecera y pago', () => {
    const ctx = {
      today: '2026-10-14',
      currentNotes: '',
      notesLimit: 500,
      foreignCurrencies: ['USD'],
    };

    it('crédito con plazo ⇒ forma 2 y vencimiento = emisión + días', () => {
      const { patch, dueDate, aiPaths } = draftToInvoicePatch(
        {
          invoice: result().invoice,
          payment: {
            payment_form: f('credit' as const),
            payment_term_days: f(30),
            payment_method_hint: f('transferencia Bancolombia'),
          },
        },
        ctx,
      );
      expect(patch['payment_form']).toBe('2');
      expect(patch['payment_means_code']).toBe('47');
      expect(dueDate).toBe('2026-11-13');
      expect(aiPaths).toEqual(
        jasmine.arrayContaining(['issue_date', 'payment_form', 'due_date', 'payment_means_code']),
      );
    });

    it('sin forma leída pero con plazo ⇒ crédito', () => {
      const { patch } = draftToInvoicePatch(
        {
          invoice: result().invoice,
          payment: { payment_form: none(), payment_term_days: f(15), payment_method_hint: none() },
        },
        ctx,
      );
      expect(patch['payment_form']).toBe('2');
    });

    it('contado ⇒ no escribe vencimiento', () => {
      const { patch, dueDate } = draftToInvoicePatch(
        {
          invoice: result().invoice,
          payment: { payment_form: f('cash' as const), payment_term_days: none(), payment_method_hint: none() },
        },
        ctx,
      );
      expect(patch['payment_form']).toBe('1');
      expect(dueDate).toBeNull();
    });

    it('referencia y notas se agregan a las notas existentes con tope', () => {
      const { patch } = draftToInvoicePatch(
        {
          invoice: { ...result().invoice, reference: f('OC-123'), notes: f('Anticipo 50 %') },
          payment: result().payment,
        },
        { ...ctx, currentNotes: 'Nota previa', notesLimit: 30 },
      );
      expect(patch['notes']).toBe('Nota previa\nAnticipo 50 %\nReferencia: OC-123'.slice(0, 30));
      expect(String(patch['notes']).length).toBeLessThanOrEqual(30);
    });

    it('divisa no ofrecida ⇒ queda en COP con aviso; ofrecida ⇒ se activa', () => {
      const eur = draftToInvoicePatch(
        { invoice: { ...result().invoice, currency: f('EUR') }, payment: result().payment },
        ctx,
      );
      expect(eur.patch['foreign_currency']).toBeUndefined();
      expect(eur.unresolved.length).toBe(1);

      const usd = draftToInvoicePatch(
        { invoice: { ...result().invoice, currency: f('USD') }, payment: result().payment },
        ctx,
      );
      expect(usd.patch).toEqual(
        jasmine.objectContaining({ use_foreign_currency: true, foreign_currency: 'USD' }),
      );
    });

    it('medio de pago sin equivalente DIAN ⇒ no se escribe y queda como no resuelto', () => {
      expect(draftPaymentMeansCode('bitcoin')).toBeNull();
      expect(draftPaymentMeansCode('Tarjeta débito')).toBe('49');
      expect(draftPaymentMeansCode('efectivo')).toBe('10');
    });

    it('fechas solo-fecha válidas y suma de días sin corrimiento', () => {
      expect(isDateOnly('2026-02-31')).toBeFalse();
      expect(isDateOnly('2026-02-28')).toBeTrue();
      expect(addDaysToDateOnly('2026-12-20', 15)).toBe('2027-01-04');
    });
  });

  describe('líneas', () => {
    it('impuesto: misma tarifa, gana el IVA y nunca una retención', () => {
      expect(draftTaxSelectionForRate(19, TAXES)).toEqual(
        jasmine.objectContaining({ tax_rate_id: 1, is_inclusive: false }),
      );
      expect(draftTaxSelectionForRate(5, TAXES)?.tax_rate_id).toBe(4);
      expect(draftTaxSelectionForRate(0, TAXES)).toBeNull();
      expect(draftTaxSelectionForRate(16, TAXES)).toBeNull();
    });

    it('descuento en % ⇒ importe; línea de catálogo conserva producto y variante', () => {
      const [row] = draftLinesToLineInputs(
        [
          line({
            quantity: f(4),
            unit_price: f(12000),
            discount_percent: f(10),
            product_id: 7,
            product_variant_id: 70,
            match_status: 'matched',
            match_confidence: 95,
          }),
        ],
        TAXES,
      );
      expect(row.value).toEqual(
        jasmine.objectContaining({
          product_id: 7,
          product_variant_id: 70,
          quantity: 4,
          unit_price: 12000,
          discount_amount: 4800,
        }),
      );
      expect(row.value.taxes[0].tax_rate_id).toBe(1);
      expect(row.pendingFields).toEqual([]);
    });

    it('coincidencia parcial ⇒ «Revisar: producto»; sin coincidencia ⇒ ítem libre', () => {
      const [partial, free] = draftLinesToLineInputs(
        [
          line({ product_id: 9, match_status: 'partial', match_confidence: 60 }),
          line({ product_id: 9, match_status: 'none' }),
        ],
        TAXES,
      );
      expect(partial.pendingFields).toContain('product');
      expect(free.value.product_id).toBeNull();
      expect(free.note).toContain('Ítem libre');
    });

    it('faltantes y baja confianza quedan pendientes; tarifa sin catálogo ⇒ sin impuesto', () => {
      const [row] = draftLinesToLineInputs(
        [
          line({
            quantity: none(),
            unit_price: f(1000, DRAFT_LOW_CONFIDENCE - 1),
            tax_rate: f(16),
          }),
        ],
        TAXES,
      );
      expect(row.value.quantity).toBe(1);
      expect(row.value.taxes).toEqual([]);
      expect(row.pendingFields).toEqual(
        jasmine.arrayContaining(['quantity', 'unit_price', 'taxes']),
      );
      expect(row.note).toContain('16 %');
    });

    it('confianza alta (escala 0-100) NO marca para revisar', () => {
      const [row] = draftLinesToLineInputs([line({ unit_price: f(1000, 90) })], TAXES);
      expect(row.pendingFields).not.toContain('unit_price');
    });
  });

  describe('pendientes', () => {
    it('rutas del backend ⇒ controles de pantalla', () => {
      expect(draftPathToControl('acquirer.address_line')).toBe('customer_address');
      expect(draftPathToControl('lines.2.tax_rate')).toBe('lines.2.taxes');
      expect(draftPathToControl('lines.0.product_id')).toBe('lines.0.product');
      expect(draftPathToControl('lines.1')).toBe('lines.1');
      expect(draftPathToControl('totals.total')).toBeNull();
    });

    it('cliente nuevo sin dirección ni DANE ⇒ obligatorios DIAN pendientes', () => {
      const pending = draftPendingPaths(
        result({
          acquirer: acquirer({ address_line: none(), municipality_code: none() }),
          missing_fields: ['acquirer.address_line'],
          requires_review: ['lines.0.unit_price'],
        }),
        { today: '2026-10-14' },
      );
      expect(pending).toEqual(
        jasmine.arrayContaining([
          'customer_address',
          'customer_municipality_code',
          'lines.0.unit_price',
        ]),
      );
    });

    it('cliente existente no exige dirección; fecha distinta de hoy y crédito sin plazo sí se marcan', () => {
      const pending = draftPendingPaths(
        result({
          acquirer: acquirer({ address_line: none(), existing_customer_id: 55 }),
          invoice: { ...result().invoice, issue_date: f('2026-10-01') },
          payment: {
            payment_form: f('credit' as const),
            payment_term_days: none(),
            payment_method_hint: none(),
          },
        }),
        { today: '2026-10-14' },
      );
      expect(pending).not.toContain('customer_address');
      expect(pending).toEqual(jasmine.arrayContaining(['issue_date', 'due_date']));
    });

    it('baja confianza en un campo del adquiriente ⇒ pendiente', () => {
      const pending = draftPendingPaths(
        result({ acquirer: acquirer({ email: f('x@y.co', 40) }) }),
        { today: '2026-10-14' },
      );
      expect(pending).toContain('customer_email');
      expect(pending).not.toContain('customer_name');
    });

    it('borrador sin correo y adquiriente con documento ⇒ correo pendiente', () => {
      const pending = draftPendingPaths(
        result({ acquirer: acquirer({ email: none() }) }),
        { today: '2026-10-14' },
      );
      expect(pending).toContain('customer_email');
    });

    it('con correo leído (confianza alta) el correo no queda pendiente', () => {
      const pending = draftPendingPaths(result(), { today: '2026-10-14' });
      expect(pending).not.toContain('customer_email');
    });

    it('consumidor final (sin documento o 222222222222) no exige correo', () => {
      const sinDocumento = draftPendingPaths(
        result({
          acquirer: acquirer({
            email: none(),
            document_number: none(),
            verification_digit: none(),
          }),
        }),
        { today: '2026-10-14' },
      );
      expect(sinDocumento).not.toContain('customer_email');

      const generico = draftPendingPaths(
        result({
          acquirer: acquirer({
            email: none(),
            document_type: f('CC'),
            document_number: f('222222222222'),
            verification_digit: none(),
          }),
        }),
        { today: '2026-10-14' },
      );
      expect(generico).not.toContain('customer_email');
    });

    it('cliente reconocido sin correo en el borrador no se marca (lo trae su ficha)', () => {
      const pending = draftPendingPaths(
        result({ acquirer: acquirer({ email: none(), existing_customer_id: 55 }) }),
        { today: '2026-10-14' },
      );
      expect(pending).not.toContain('customer_email');
    });

    it('isFinalConsumerDocument reconoce vacío y el documento genérico DIAN', () => {
      expect(isFinalConsumerDocument('')).toBe(true);
      expect(isFinalConsumerDocument(null)).toBe(true);
      expect(isFinalConsumerDocument('222222222222')).toBe(true);
      expect(isFinalConsumerDocument('222.222.222.222')).toBe(true);
      expect(isFinalConsumerDocument('900123456')).toBe(false);
    });

    it('etiquetas legibles', () => {
      expect(draftPathLabel('acquirer.address_line')).toBe('Dirección fiscal');
      expect(draftPathLabel('lines.1.tax_rate')).toBe('Línea 2: impuesto');
    });
  });

  describe('campos v2 del escáner', () => {
    const ctx = {
      today: '2026-10-14',
      currentNotes: '',
      notesLimit: 500,
      foreignCurrencies: ['USD'],
    };

    it('unidad leída del selector ⇒ unit_code con marca IA; ausente ⇒ NIU sin marca', () => {
      const [kg, noUnit, unknown] = draftLinesToLineInputs(
        [
          line({ unit_code: f('kgm') }),
          line(),
          line({ unit_code: f<string>(null, 90, 'Unidad «ML» no reconocida') }),
        ],
        TAXES,
      );
      expect(kg.value.unit_code).toBe('KGM');
      expect(kg.aiFields).toContain('unit_code');
      expect(noUnit.value.unit_code).toBe('NIU');
      expect(noUnit.aiFields).not.toContain('unit_code');
      expect(unknown.value.unit_code).toBe('NIU');
      expect(unknown.note).toContain('Unidad leída no reconocida');
      expect(unknown.pendingFields).not.toContain('unit_code');
    });

    it('una unidad fuera del selector no se escribe', () => {
      const [row] = draftLinesToLineInputs([line({ unit_code: f('XYZ') })], TAXES);
      expect(row.value.unit_code).toBe('NIU');
      expect(row.aiFields).not.toContain('unit_code');
    });

    it('la unidad por revisar del backend no marca la fila (no tiene marca propia)', () => {
      expect(draftPathToControl('lines.0.unit_code')).toBeNull();
      expect(draftPathLabel('lines.0.unit_code')).toBe('Línea 1: unidad');
    });

    it('divisa ofrecida con TRM y fecha ⇒ exchange_rate y exchange_rate_date', () => {
      const { patch, aiPaths } = draftToInvoicePatch(
        {
          invoice: {
            ...result().invoice,
            currency: f('USD'),
            exchange_rate: f(4123.46),
            exchange_rate_date: f('2026-10-13'),
          },
          payment: result().payment,
        },
        ctx,
      );
      expect(patch['foreign_currency']).toBe('USD');
      expect(patch['exchange_rate']).toBe(4123.46);
      expect(patch['exchange_rate_date']).toBe('2026-10-13');
      expect(aiPaths).toEqual(
        jasmine.arrayContaining(['foreign_currency', 'exchange_rate', 'exchange_rate_date']),
      );
    });

    it('TRM sin divisa ofrecida, o en COP, no se escribe', () => {
      const cop = draftToInvoicePatch(
        {
          invoice: { ...result().invoice, exchange_rate: f(4000) },
          payment: result().payment,
        },
        ctx,
      );
      expect(cop.patch['exchange_rate']).toBeUndefined();
      const eur = draftToInvoicePatch(
        {
          invoice: { ...result().invoice, currency: f('EUR'), exchange_rate: f(4500) },
          payment: result().payment,
        },
        ctx,
      );
      expect(eur.patch['exchange_rate']).toBeUndefined();
    });

    it('TRM con confianza baja queda pendiente', () => {
      const pending = draftPendingPaths(
        result({
          invoice: {
            ...result().invoice,
            currency: f('USD'),
            exchange_rate: f(4123, 40),
          },
        }),
        { today: '2026-10-14' },
      );
      expect(pending).toContain('exchange_rate');
    });

    const CONCEPTS: DraftWithholdingConcept[] = [
      { id: 1, label: '2304 · Compras', name: 'Compras', ratePercent: 2.5, type: 'retefuente' },
      { id: 2, label: '2307 · Servicios', name: 'Servicios', ratePercent: 4, type: 'retefuente' },
      { id: 3, label: '2308 · Honorarios', name: 'Honorarios', ratePercent: 11, type: 'retefuente' },
      { id: 4, label: 'RIVA · ReteIVA', name: 'ReteIVA', ratePercent: 15, type: 'reteiva' },
      { id: 5, label: 'ICA1 · Industria', name: 'Industria', ratePercent: 0.966, type: 'reteica' },
      { id: 6, label: 'ICA2 · Comercio', name: 'Comercio', ratePercent: 0.966, type: 'reteica' },
    ];
    const wh = (
      type: InvoiceDraftWithholding['type']['value'],
      rate: number | null,
      concept_hint: string | null = null,
      confidence = 95,
    ): InvoiceDraftWithholding => ({
      type: f(type, confidence) as InvoiceDraftWithholding['type'],
      rate: f(rate, confidence) as InvoiceDraftWithholding['rate'],
      concept_hint,
    });

    it('retenciones: misma clase y tarifa ⇒ concepto, rol sufrida y tarifa leída', () => {
      const { rows, unresolved } = draftWithholdingsToRows(
        [wh('retefuente', 2.5), wh('reteiva', 15)],
        CONCEPTS,
      );
      expect(rows).toEqual([
        { draftIndex: 0, concept_id: 1, concept: '2304 · Compras', role: 'suffered', rate: 2.5, needsReview: false },
        { draftIndex: 1, concept_id: 4, concept: 'RIVA · ReteIVA', role: 'suffered', rate: 15, needsReview: false },
      ]);
      expect(unresolved).toEqual([]);
    });

    it('retenciones: empate de tarifa lo decide el concepto impreso; sin él, la primera y por revisar', () => {
      const hinted = draftWithholdingsToRows([wh('reteica', 0.966, 'comercio')], CONCEPTS);
      expect(hinted.rows[0]).toEqual(jasmine.objectContaining({ concept_id: 6, needsReview: false }));
      const blind = draftWithholdingsToRows([wh('reteica', 0.966)], CONCEPTS);
      expect(blind.rows[0]).toEqual(jasmine.objectContaining({ concept_id: 5, needsReview: true }));
    });

    it('retenciones: tarifa sin concepto igual ⇒ el impreso o nada, nunca se inventa', () => {
      const byHint = draftWithholdingsToRows([wh('retefuente', 6, 'Honorarios')], CONCEPTS);
      expect(byHint.rows[0]).toEqual(
        jasmine.objectContaining({ concept_id: 3, rate: 6, needsReview: true }),
      );
      const unmatched = draftWithholdingsToRows([wh('retefuente', 6)], CONCEPTS);
      expect(unmatched.rows).toEqual([]);
      expect(unmatched.unresolved[0]).toContain('Retención en la fuente 6 %');
    });

    it('retenciones: sin catálogo, sin clase o con confianza baja', () => {
      expect(draftWithholdingsToRows([wh('retefuente', 2.5)], []).unresolved[0]).toContain(
        'catálogo de conceptos no está disponible',
      );
      expect(draftWithholdingsToRows([wh(null, 2.5)], CONCEPTS).unresolved[0]).toContain(
        'sin clase o tarifa',
      );
      expect(draftWithholdingsToRows([wh('retefuente', 2.5, null, 40)], CONCEPTS).rows[0].needsReview).toBeTrue();
      expect(draftWithholdingsToRows(undefined, CONCEPTS)).toEqual({ rows: [], unresolved: [] });
    });

    it('clase del concepto por tipo declarado o por su nombre', () => {
      expect(draftWithholdingConceptType({ type: 'withholding' })).toBe('retefuente');
      expect(draftWithholdingConceptType({ name: 'Retención de ICA Bogotá' })).toBe('reteica');
      expect(draftWithholdingConceptType({ name: 'ReteIVA 15%' })).toBe('reteiva');
      expect(draftWithholdingConceptType({ name: 'Retención en la fuente servicios' })).toBe('retefuente');
      expect(draftWithholdingConceptType({ name: 'Otro' })).toBeNull();
    });

    const AIU: InvoiceDraftAiu = {
      administracion_percent: f(10),
      imprevistos_percent: f(5),
      utilidad_percent: f(5, 50),
      contract_object: f('Obra civil bodega norte'),
    };
    const emptyAiu = {
      isAiu: true,
      current: { administracion: '', imprevistos: '', utilidad: '' },
      currentContractObject: '',
    };

    it('AIU con documento en operación AIU ⇒ porcentajes con dos decimales y objeto', () => {
      const out = draftAiuPatch(AIU, emptyAiu);
      expect(out.patch).toEqual({
        aiu: { administracion: '10.00', imprevistos: '5.00', utilidad: '5.00' },
        aiu_contract_object: 'Obra civil bodega norte',
      });
      expect(out.aiPaths).toEqual([
        'aiu.administracion',
        'aiu.imprevistos',
        'aiu.utilidad',
        'aiu_contract_object',
      ]);
      expect(out.pendingPaths).toEqual(['aiu.utilidad']);
    });

    it('AIU sin operación AIU ⇒ no escribe y avisa', () => {
      const out = draftAiuPatch(AIU, { ...emptyAiu, isAiu: false });
      expect(out.patch).toEqual({});
      expect(out.unresolved[0]).toContain('operación AIU (09)');
      expect(draftAiuPatch(null, emptyAiu).unresolved).toEqual([]);
    });

    it('AIU no pisa porcentajes del perfil; si difieren, avisa', () => {
      const out = draftAiuPatch(AIU, {
        ...emptyAiu,
        current: { administracion: '8.00', imprevistos: '5.00', utilidad: '' },
        currentContractObject: 'Contrato vigente',
      });
      expect(out.patch).toEqual({ aiu: { utilidad: '5.00' } });
      expect(out.unresolved.length).toBe(1);
      expect(out.unresolved[0]).toContain('administracion');
    });

    it('conteo: cabecera + adquiriente + campos de línea + retenciones, sin duplicados', () => {
      const summary = countDraftFilledFields({
        acquirer: { aiPaths: ['customer_name', 'customer_tax_id', 'customer_name'] },
        invoice: { aiPaths: ['issue_date', 'payment_form', 'due_date'] },
        headerMarks: {
          customer_name: 'ai',
          customer_tax_id: 'pending',
          issue_date: 'pending',
          payment_form: 'ai',
        },
        lines: [
          { mark: { ai: ['description', 'quantity', 'unit_price'], pending: ['taxes'] } },
          { mark: { ai: ['description'], pending: [] } },
        ],
        withholdings: [{ needsReview: true }],
        aiu: { aiPaths: ['aiu.administracion'] },
      });
      expect(summary).toEqual({
        filled: 2 + 4 + 4 + 1,
        acquirer: 2,
        document: 4,
        lines: 4,
        withholdings: 1,
        review: 2 + 1 + 1,
      });
    });

    it('conteo sin adquiriente (cliente existente): no cuenta sus campos ni sus «Revisar»', () => {
      const summary = countDraftFilledFields(
        {
          acquirer: { aiPaths: ['external_legal_name'] },
          invoice: { aiPaths: ['issue_date'] },
          headerMarks: { external_email: 'pending', issue_date: 'ai' },
          lines: [],
        },
        { includeAcquirer: false },
      );
      expect(summary.filled).toBe(1);
      expect(summary.acquirer).toBe(0);
      expect(summary.review).toBe(0);
    });

    it('etiquetas de retenciones, TRM y AIU', () => {
      expect(draftPathLabel('withholdings.0.rate')).toBe('Retención 1: tarifa');
      expect(draftPathLabel('invoice.exchange_rate')).toBe('Tasa de cambio (TRM)');
      expect(draftPathLabel('aiu.utilidad_percent')).toBe('AIU: utilidad');
    });
  });
});
