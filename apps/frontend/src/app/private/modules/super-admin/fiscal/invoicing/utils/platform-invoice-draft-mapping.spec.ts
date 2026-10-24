import { FormControl } from '@angular/forms';
import { PLATFORM_TAX_CATALOG } from '../../../../../../shared/components/invoice-sections';
import { computeNitDv } from '../../../../../../shared/utils/nit.util';
import type {
  DraftField,
  InvoiceDraftAcquirer,
  InvoiceDraftLine,
  InvoiceDraftScanResult,
} from '../../../../store/invoicing/interfaces/invoice-draft-scan.interface';
import { countDraftFilledFields } from '../../../../store/invoicing/utils/invoice-draft-mapping';
import {
  dropPlatformRowMarkField,
  draftToPlatformAcquirerPatch,
  draftToPlatformInvoicePatch,
  isCapturedPlatformLine,
  isValidPlatformAcquirerEmail,
  planPlatformInvoiceDraft,
  platformAcquirerEmailValidator,
  platformAcquirerMissing,
  platformMissingHint,
  platformPaymentMeansCode,
  platformTaxRegimeCode,
  platformTaxRegimeFromResponsibilities,
  toPlatformControl,
} from './platform-invoice-draft-mapping';

/**
 * Adaptador del borrador IA a la «Nueva factura» de PLATAFORMA. Mismas
 * fixtures que `invoice-draft-mapping.spec.ts` (forma EXACTA del backend,
 * confianza 0-100); aquí se prueba sólo la traducción al vocabulario de la
 * pantalla de plataforma (`external_*`, '1'/'2', '48'/'49', divisa).
 */
const f = <T>(value: T | null, confidence = 95, warning: string | null = null): DraftField<T> => ({
  value,
  confidence,
  warning,
});
const none = <T>(): DraftField<T> => f<T>(null, 0);

const NIT = '900123456';
const NIT_DV = computeNitDv(NIT)!;
const TODAY = '2026-10-14';

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
    existing_acquirer: null,
    ...overrides,
  };
}

function line(overrides: Partial<InvoiceDraftLine> = {}): InvoiceDraftLine {
  return {
    description: f('Suscripción anual Vendix Pro'),
    quantity: f(1),
    unit_price: f(1200000),
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
      issue_date: f(TODAY),
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

const ctx = (overrides: Partial<Parameters<typeof planPlatformInvoiceDraft>[1]> = {}) => ({
  today: TODAY,
  currentNotes: '',
  notesLimit: 500,
  foreignCurrencies: ['USD', 'EUR'],
  taxes: PLATFORM_TAX_CATALOG,
  currentItems: [],
  maxLines: 100,
  descriptionLimit: 300,
  ...overrides,
});

describe('platform-invoice-draft-mapping', () => {
  describe('vocabulario', () => {
    it('renombra los controles de la tienda a los de plataforma', () => {
      expect(toPlatformControl('customer_name')).toBe('external_legal_name');
      expect(toPlatformControl('customer_municipality_code')).toBe('external_city_code');
      expect(toPlatformControl('foreign_currency')).toBe('foreign_currency_code');
      expect(toPlatformControl('issue_date')).toBe('issue_date');
      expect(toPlatformControl('lines.0.unit_price')).toBe('lines.0.unit_price');
    });

    it('régimen: código DIAN, vocabulario de tienda y frases del RUT', () => {
      expect(platformTaxRegimeCode('48')).toBe('48');
      expect(platformTaxRegimeCode('COMUN')).toBe('48');
      expect(platformTaxRegimeCode('Responsable de IVA')).toBe('48');
      expect(platformTaxRegimeCode('GRAN_CONTRIBUYENTE')).toBe('48');
      expect(platformTaxRegimeCode('SIMPLIFICADO')).toBe('49');
      expect(platformTaxRegimeCode('No responsable de IVA')).toBe('49');
      expect(platformTaxRegimeCode('ESPECIAL')).toBe('');
      expect(platformTaxRegimeCode('')).toBe('');
    });

    it('régimen desde responsabilidades cuando no se leyó', () => {
      expect(platformTaxRegimeFromResponsibilities(['O-13', 'O-48'])).toBe('48');
      expect(platformTaxRegimeFromResponsibilities(['R-99-PN'])).toBe('49');
      expect(platformTaxRegimeFromResponsibilities(['O-13'])).toBe('');
    });

    it('medio de pago: los de la lista pasan, las transferencias caen en 42', () => {
      expect(platformPaymentMeansCode('48')).toBe('48');
      expect(platformPaymentMeansCode('47')).toBe('42');
      expect(platformPaymentMeansCode('45')).toBe('42');
      expect(platformPaymentMeansCode('20')).toBeNull();
      expect(platformPaymentMeansCode('ZZZ')).toBeNull();
    });
  });

  describe('adquiriente', () => {
    it('vuelca a external_* con DV derivado, persona 1/2, departamento y régimen', () => {
      const { patch, aiPaths, documentDigits } = draftToPlatformAcquirerPatch(acquirer());
      expect(documentDigits).toBe(NIT);
      expect(patch).toEqual(
        jasmine.objectContaining({
          external_document_type: '31',
          external_tax_id: NIT,
          external_tax_id_dv: NIT_DV,
          external_person_type: '1',
          external_legal_name: 'Constructora Andina S.A.S.',
          external_email: 'compras@andina.co',
          external_phone: '6015551234',
          external_address_line: 'Cra 7 # 71-21',
          external_city_code: '11001',
          external_city: 'Bogotá',
          external_department_code: '11',
          external_tax_regime_code: '48',
          external_fiscal_responsibilities: ['O-13', 'O-15'],
        }),
      );
      expect(aiPaths).toContain('external_legal_name');
      expect(aiPaths).toContain('external_tax_regime_code');
      // El DV se deriva: no es una propuesta de la IA.
      expect(aiPaths).not.toContain('external_tax_id_dv');
    });

    it('cédula ⇒ persona natural y sin DV', () => {
      const { patch } = draftToPlatformAcquirerPatch(
        acquirer({
          document_type: f('CC'),
          document_number: f('1020304050'),
          verification_digit: none(),
          person_type: none(),
        }),
      );
      expect(patch['external_document_type']).toBe('13');
      expect(patch['external_person_type']).toBe('2');
      expect(patch['external_tax_id_dv']).toBe('');
    });

    it('acepta el tipo de documento ya en código DIAN', () => {
      const { patch } = draftToPlatformAcquirerPatch(
        acquirer({ document_type: f('31'), verification_digit: none() }),
      );
      expect(patch['external_document_type']).toBe('31');
      expect(patch['external_tax_id_dv']).toBe(NIT_DV);
    });

    it('tipo de documento que la plataforma no ofrece ⇒ revisar, sin escribirlo', () => {
      const { patch, pendingPaths, unresolved } = draftToPlatformAcquirerPatch(
        acquirer({ document_type: f('TI'), verification_digit: none() }),
      );
      expect(patch['external_document_type']).toBeUndefined();
      expect(pendingPaths).toContain('external_document_type');
      expect(unresolved.length).toBe(1);
    });

    it('régimen ilegible ⇒ se deduce de O-48 / R-99-PN; si no, revisar', () => {
      const deduced = draftToPlatformAcquirerPatch(
        acquirer({ tax_regime: f('ESPECIAL'), fiscal_responsibilities: f(['R-99-PN']) }),
      );
      expect(deduced.patch['external_tax_regime_code']).toBe('49');

      const unknown = draftToPlatformAcquirerPatch(
        acquirer({ tax_regime: f('ESPECIAL'), fiscal_responsibilities: none() }),
      );
      expect(unknown.patch['external_tax_regime_code']).toBeUndefined();
      expect(unknown.pendingPaths).toContain('external_tax_regime_code');
    });

    it('municipio sin código DANE de 5 dígitos no viaja', () => {
      const { patch } = draftToPlatformAcquirerPatch(
        acquirer({ municipality_code: f('Bogotá') }),
      );
      expect(patch['external_city_code']).toBeUndefined();
      expect(patch['external_department_code']).toBeUndefined();
    });
  });

  describe('cabecera y pago', () => {
    it('crédito con plazo, transferencia ⇒ 42, divisa renombrada', () => {
      const out = draftToPlatformInvoicePatch(
        {
          invoice: {
            issue_date: f(TODAY),
            due_date: none(),
            currency: f('USD'),
            reference: f('OC-77'),
            notes: none(),
          },
          payment: {
            payment_form: f('credit' as const),
            payment_term_days: f(30),
            payment_method_hint: f('transferencia Bancolombia'),
          },
        },
        { today: TODAY, currentNotes: '', notesLimit: 500, foreignCurrencies: ['USD'] },
      );
      expect(out.patch['payment_form']).toBe('2');
      expect(out.patch['payment_means_code']).toBe('42');
      expect(out.patch['declare_foreign']).toBeTrue();
      expect(out.patch['foreign_currency_code']).toBe('USD');
      expect(out.patch['use_foreign_currency']).toBeUndefined();
      expect(out.patch['notes']).toBe('Referencia: OC-77');
      expect(out.dueDate).toBe('2026-11-13');
      expect(out.aiPaths).toContain('foreign_currency_code');
      expect(out.aiPaths).toContain('payment_means_code');
    });

    it('medio de pago fuera de la lista de plataforma ⇒ no se escribe y se avisa', () => {
      const out = draftToPlatformInvoicePatch(
        {
          invoice: result().invoice,
          payment: {
            payment_form: none(),
            payment_term_days: none(),
            payment_method_hint: f('cheque'),
          },
        },
        { today: TODAY, currentNotes: '', notesLimit: 500, foreignCurrencies: [] },
      );
      expect(out.patch['payment_means_code']).toBeUndefined();
      expect(out.aiPaths).not.toContain('payment_means_code');
      expect(out.unresolved.some((u) => u.includes('medio de pago'))).toBeTrue();
    });
  });

  describe('plan completo', () => {
    it('líneas sin catálogo: IVA 19 % del catálogo de plataforma y descuento % → importe', () => {
      const plan = planPlatformInvoiceDraft(
        result({
          lines: [line({ quantity: f(2), unit_price: f(100000), discount_percent: f(10) })],
        }),
        ctx(),
      );
      expect(plan.replaceLines).toBeTrue();
      expect(plan.lines.length).toBe(1);
      const value = plan.lines[0].value;
      expect(value.discount_amount).toBe(20000);
      expect(value.taxes.length).toBe(1);
      expect(value.taxes[0].tax_rate_id).toBe(PLATFORM_TAX_CATALOG[0].id);
      expect(value.taxes[0].is_inclusive).toBeFalse();
      // Sin catálogo de productos no se dice «ítem libre» en cada fila.
      expect(plan.lines[0].mark.note).toBeNull();
      expect(plan.lines[0].mark.pending).not.toContain('product');
    });

    it('tarifa sin equivalente ⇒ sin impuesto y por revisar', () => {
      const plan = planPlatformInvoiceDraft(result({ lines: [line({ tax_rate: f(16) })] }), ctx());
      expect(plan.lines[0].value.taxes).toEqual([]);
      expect(plan.lines[0].mark.pending).toContain('taxes');
      expect(plan.lines[0].mark.note).toContain('16');
    });

    it('con líneas capturadas agrega al final y respeta el tope', () => {
      const plan = planPlatformInvoiceDraft(
        result({ lines: [line(), line(), line()] }),
        ctx({
          currentItems: [{ description: 'Hecha a mano', unit_price: 5 }, { description: '' }],
          maxLines: 3,
        }),
      );
      expect(plan.replaceLines).toBeFalse();
      expect(plan.lines.length).toBe(2);
      expect(plan.droppedLines).toBe(1);
      expect(plan.notice.unresolved.some((u) => u.includes('1 línea'))).toBeTrue();
    });

    it('marcas: lo leído es IA y lo que el backend pide revisar gana', () => {
      const plan = planPlatformInvoiceDraft(
        result({ requires_review: ['acquirer.address_line', 'lines.0.sku'] }),
        ctx(),
      );
      expect(plan.headerMarks['external_legal_name']).toBe('ai');
      expect(plan.headerMarks['external_address_line']).toBe('pending');
      expect(plan.headerMarks['issue_date']).toBe('ai');
      // `sku` no tiene representación en plataforma: no ensucia el aviso.
      expect(plan.notice.pending).toEqual(['Dirección fiscal']);
    });

    it('adquiriente reconocido por el backend viaja en existingAcquirer', () => {
      const plan = planPlatformInvoiceDraft(
        result({
          acquirer: acquirer({
            existing_acquirer: { kind: 'customer', tenant_id: 4, id: 'customer:4' },
          }),
        }),
        ctx(),
      );
      expect(plan.existingAcquirer).toEqual({ kind: 'customer', tenant_id: 4, id: 'customer:4' });
      expect(plan.hasAcquirer).toBeTrue();
    });

    it('correo leído con buena confianza ⇒ IA, no «Revisar»', () => {
      const plan = planPlatformInvoiceDraft(result(), ctx());
      expect(plan.acquirer.patch['external_email']).toBe('compras@andina.co');
      expect(plan.headerMarks['external_email']).toBe('ai');
    });

    it('adquiriente nuevo sin correo ⇒ el correo queda en «Revisar» y bloquea', () => {
      const plan = planPlatformInvoiceDraft(
        result({ acquirer: acquirer({ email: none() }) }),
        ctx(),
      );
      expect(plan.headerMarks['external_email']).toBe('pending');
      // Y mientras siga vacío es un faltante para emitir.
      const fields = platformAcquirerMissing({
        external_person_type: '1',
        ...plan.acquirer.patch,
      }).map((m) => m.field);
      expect(fields).toEqual(['external_email']);
    });

    it('correo leído mal formado ⇒ «Revisar»', () => {
      const plan = planPlatformInvoiceDraft(
        result({ acquirer: acquirer({ email: f('compras@andina') }) }),
        ctx(),
      );
      expect(plan.headerMarks['external_email']).toBe('pending');
    });

    it('sin excepción de consumidor final: 222222222222 sin correo también queda en «Revisar»', () => {
      const plan = planPlatformInvoiceDraft(
        result({
          acquirer: acquirer({
            document_type: f('CC'),
            document_number: f('222222222222'),
            verification_digit: none(),
            email: none(),
          }),
        }),
        ctx(),
      );
      expect(plan.headerMarks['external_email']).toBe('pending');
    });

    it('sin adquiriente leído no se toca el adquiriente', () => {
      const empty = acquirer({
        document_type: none(),
        document_number: none(),
        verification_digit: none(),
        name: none(),
      });
      const plan = planPlatformInvoiceDraft(result({ acquirer: empty }), ctx());
      expect(plan.hasAcquirer).toBeFalse();
      expect(plan.existingAcquirer).toBeNull();
    });
  });

  describe('filas', () => {
    it('una fila con descripción o precio es trabajo del operador', () => {
      expect(isCapturedPlatformLine({ description: 'x' })).toBeTrue();
      expect(isCapturedPlatformLine({ unit_price: 1 })).toBeTrue();
      expect(isCapturedPlatformLine({ description: '  ', unit_price: 0 })).toBeFalse();
    });

    it('editar un campo suelta su marca; sin nada más, la fila queda sin marca', () => {
      const mark = { ai: ['description', 'unit_price'], pending: [], note: null };
      const next = dropPlatformRowMarkField(mark, 'description');
      expect(next?.ai).toEqual(['unit_price']);
      expect(dropPlatformRowMarkField(next!, 'unit_price')).toBeNull();
    });
  });

  describe('faltantes para emitir', () => {
    const complete = {
      external_document_type: '31',
      external_tax_id: NIT,
      external_tax_id_dv: NIT_DV,
      external_legal_name: 'Constructora Andina S.A.S.',
      external_person_type: '1',
      external_tax_regime_code: '48',
      external_email: 'compras@andina.co',
      external_address_line: 'Cra 7 # 71-21',
      external_city_code: '11001',
    };

    it('completo ⇒ nada falta', () => {
      expect(platformAcquirerMissing(complete)).toEqual([]);
    });

    it('vacío ⇒ los obligatorios, en orden de la pantalla', () => {
      const fields = platformAcquirerMissing({}).map((m) => m.field);
      expect(fields).toEqual([
        'external_document_type',
        'external_tax_id',
        'external_legal_name',
        'external_person_type',
        'external_tax_regime_code',
        'external_email',
        'external_address_line',
        'external_city_code',
      ]);
    });

    it('correo mal escrito y municipio sin código DANE', () => {
      const fields = platformAcquirerMissing({
        ...complete,
        external_email: 'compras@',
        external_city_code: 'Bogotá',
      }).map((m) => m.field);
      expect(fields).toEqual(['external_email', 'external_city_code']);
    });

    it('sin correo ⇒ «Requerido para emitir»; mal formado ⇒ el motivo', () => {
      const sinCorreo = platformAcquirerMissing({ ...complete, external_email: '   ' });
      expect(sinCorreo.map((m) => m.field)).toEqual(['external_email']);
      expect(platformMissingHint(sinCorreo[0])).toBe('Requerido para emitir');

      const malFormado = platformAcquirerMissing({ ...complete, external_email: 'a@b..co' });
      expect(malFormado.map((m) => m.field)).toEqual(['external_email']);
      expect(platformMissingHint(malFormado[0])).toBe('El correo no tiene un formato válido.');

      expect(platformMissingHint(undefined)).toBe('');
    });

    it('el documento genérico 222222222222 NO exime el correo en plataforma', () => {
      const fields = platformAcquirerMissing({
        ...complete,
        external_document_type: '13',
        external_tax_id: '222222222222',
        external_tax_id_dv: '',
        external_person_type: '2',
        external_email: '',
      }).map((m) => m.field);
      expect(fields).toEqual(['external_email']);
    });

    it('precarga de un destinatario (tenant/cliente) sin correo ⇒ sólo falta el correo', () => {
      // Lo que `onTenantPicked` vuelca cuando la ficha no trae correo.
      const fields = platformAcquirerMissing({ ...complete, external_email: '' }).map(
        (m) => m.field,
      );
      expect(fields).toEqual(['external_email']);
    });

    it('precarga RUES (identidad sin correo ni dirección) ⇒ el correo es faltante', () => {
      const fields = platformAcquirerMissing({
        external_document_type: '31',
        external_tax_id: NIT,
        external_tax_id_dv: NIT_DV,
        external_legal_name: 'Constructora Andina S.A.S.',
        external_person_type: '1',
      }).map((m) => m.field);
      expect(fields).toContain('external_email');
    });

    it('NIT sin DV', () => {
      const fields = platformAcquirerMissing({ ...complete, external_tax_id_dv: '' }).map(
        (m) => m.field,
      );
      expect(fields).toEqual(['external_tax_id_dv']);
    });
  });

  describe('correo del adquiriente (una sola regla)', () => {
    it('isValidPlatformAcquirerEmail', () => {
      expect(isValidPlatformAcquirerEmail('compras@andina.co')).toBeTrue();
      expect(isValidPlatformAcquirerEmail('  compras@andina.co  ')).toBeTrue();
      expect(isValidPlatformAcquirerEmail('')).toBeFalse();
      expect(isValidPlatformAcquirerEmail(null)).toBeFalse();
      expect(isValidPlatformAcquirerEmail('compras@')).toBeFalse();
      // Sin punto en el dominio: Angular lo acepta, la regla de emisión no.
      expect(isValidPlatformAcquirerEmail('compras@andina')).toBeFalse();
      // Doble punto: la regla de emisión lo aceptaba, Angular no.
      expect(isValidPlatformAcquirerEmail('a@b..co')).toBeFalse();
    });

    it('el validador del control coincide con el faltante para emitir', () => {
      const samples = ['', 'compras@andina.co', ' x@y.co ', 'compras@', 'compras@andina', 'a@b..co'];
      for (const email of samples) {
        const control = new FormControl(email, platformAcquirerEmailValidator);
        const listed = platformAcquirerMissing({ external_email: email }).some(
          (m) => m.field === 'external_email',
        );
        // Vacío: lo nombra `required` (en el componente), no el formato.
        if (!email.trim()) {
          expect(control.valid).withContext(`«${email}»`).toBeTrue();
          expect(listed).withContext(`«${email}»`).toBeTrue();
          continue;
        }
        expect(control.invalid).withContext(`«${email}»`).toBe(listed);
      }
    });
  });

  describe('campos v2 del escáner', () => {
    it('unidad leída viaja en la fila; sin unidad queda NIU', () => {
      const plan = planPlatformInvoiceDraft(
        result({ lines: [line({ unit_code: f('HUR') }), line()] }),
        ctx(),
      );
      expect(plan.lines.map((row) => row.value.unit_code)).toEqual(['HUR', 'NIU']);
      expect(plan.lines[0].mark.ai).toContain('unit_code');
    });

    it('USD con TRM impresa ⇒ declare_foreign, foreign_currency_code y exchange_rate', () => {
      const { patch, aiPaths } = draftToPlatformInvoicePatch(
        {
          invoice: {
            ...result().invoice,
            currency: f('USD'),
            exchange_rate: f(4100.5),
            exchange_rate_date: f('2026-10-10'),
          },
          payment: result().payment,
        },
        { today: TODAY, currentNotes: '', notesLimit: 500, foreignCurrencies: ['USD'] },
      );
      expect(patch['declare_foreign']).toBeTrue();
      expect(patch['foreign_currency_code']).toBe('USD');
      expect(patch['exchange_rate']).toBe(4100.5);
      expect(patch['exchange_rate_date']).toBe('2026-10-10');
      expect(aiPaths).toEqual(
        jasmine.arrayContaining(['foreign_currency_code', 'exchange_rate', 'exchange_rate_date']),
      );
    });

    it('retenciones: la clase sale del nombre del concepto y la fila es sufrida', () => {
      const plan = planPlatformInvoiceDraft(
        result({
          withholdings: [
            { type: f('retefuente' as const), rate: f(4), concept_hint: null },
            { type: f('reteica' as const), rate: f(0.966), concept_hint: null },
          ],
        }),
        ctx({
          withholdingConcepts: [
            { id: 1, label: 'Retención en la fuente servicios', name: 'Retención en la fuente servicios', ratePercent: 4, type: null },
            { id: 2, label: 'ReteIVA', name: 'ReteIVA', ratePercent: 15, type: null },
          ],
        }),
      );
      expect(plan.withholdings).toEqual([
        jasmine.objectContaining({ concept_id: 1, role: 'suffered', rate: 4, needsReview: false }),
      ]);
      expect(plan.notice.unresolved.join(' ')).toContain('ReteICA 0,966 %');
      expect(plan.filled.withholdings).toBe(1);
    });

    it('retenciones: con filas ya capturadas no se agregan', () => {
      const plan = planPlatformInvoiceDraft(
        result({ withholdings: [{ type: f('retefuente' as const), rate: f(4), concept_hint: null }] }),
        ctx({
          withholdingConcepts: [
            { id: 1, label: 'Retefuente', name: 'Retención en la fuente', ratePercent: 4, type: null },
          ],
          currentWithholdings: 2,
        }),
      );
      expect(plan.withholdings).toEqual([]);
      expect(plan.notice.unresolved.join(' ')).toContain('ya tiene retenciones');
    });

    it('AIU leído no se aplica en plataforma: se avisa', () => {
      const plan = planPlatformInvoiceDraft(
        result({
          aiu: {
            administracion_percent: f(10),
            imprevistos_percent: f(5),
            utilidad_percent: f(5),
            contract_object: none(),
          },
        }),
        ctx(),
      );
      expect(plan.notice.unresolved.join(' ')).toContain('no emite operación AIU');
    });

    it('conteo del aviso: adquiriente nuevo vs. destinatario registrado', () => {
      const plan = planPlatformInvoiceDraft(result(), ctx());
      expect(plan.filled.acquirer).toBe(new Set(plan.acquirer.aiPaths).size);
      expect(plan.filled.lines).toBe(plan.lines[0].mark.ai.length);
      expect(plan.filled.filled).toBe(
        plan.filled.acquirer + plan.filled.document + plan.filled.lines,
      );
      const withoutAcquirer = countDraftFilledFields(plan, { includeAcquirer: false });
      expect(withoutAcquirer.acquirer).toBe(0);
      expect(withoutAcquirer.filled).toBe(plan.filled.filled - plan.filled.acquirer);
    });
  });
});
