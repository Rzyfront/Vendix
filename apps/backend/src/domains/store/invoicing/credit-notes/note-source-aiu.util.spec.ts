import { Prisma } from '@prisma/client';
import { VendixHttpException } from 'src/common/errors';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import type { NoteSourceInvoiceSnapshot, NoteSourceItemSnapshot, NoteSourceTaxSnapshot } from './note-source-resolver.util';
import { recalculateNote } from './recalculate-note.util';
import { resolveFrozenNoteAiuInput } from './note-source-aiu.util';

function sourceInvoice(overrides: Partial<NoteSourceInvoiceSnapshot> = {}): NoteSourceInvoiceSnapshot {
  const line: NoteSourceItemSnapshot = {
    id: 501,
    invoice_id: 50,
    product_id: null,
    product_variant_id: null,
    description: 'Contrato de servicios',
    quantity: new Prisma.Decimal(1),
    unit_price: new Prisma.Decimal(100000),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(570),
    total_amount: new Prisma.Decimal(100570),
    is_inclusive: false,
    price_unit_quantity: 1,
    unit_code: 'NIU',
    account_code: null,
    stock_units_consumed: null,
    serial_numbers_snapshot: null,
    aiu_component: 'contrato',
    financial_source_line_id: null,
  };
  const tax: NoteSourceTaxSnapshot = {
    invoice_item_id: line.id,
    tax_rate_id: 9,
    tax_name: 'IVA 19%',
    tax_type: 'iva',
    tax_rate: new Prisma.Decimal(19),
    taxable_amount: new Prisma.Decimal(3000),
    tax_amount: new Prisma.Decimal(570),
    is_inclusive: false,
  };
  return {
    id: 50,
    organization_id: 4,
    store_id: 8,
    accounting_entity_id: 12,
    invoice_items: [line],
    invoice_taxes: [tax],
    subtotal_amount: new Prisma.Decimal(100000),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(570),
    total_amount: new Prisma.Decimal(100570),
    operation_type: '09',
    aiu_contract_object: 'Mantenimiento de instalaciones',
    aiu_regime: 'decreto_1372_1992',
    aiu_minimum_percent: null,
    aiu_taxable_matrix: {
      taxable_basis: 'utilidad',
      regime: 'decreto_1372_1992',
      stage: 'invoice:create',
      minimum: { enforced: false, percent: null },
      components: [{
        component: 'contrato', taxable: true, lines: 1,
        taxable_amount: '3000.00', tax_amount: '570.00',
        rates: [{ tax_type: 'iva', dian_tax_code: '01', tax_rate: '19.00', rate_basis: 'percent' }],
      }],
      taxable_without_rate: [],
    },
    profile_snapshot: {
      config: {
        aiu: {
          components: { administracion: '5', imprevistos: '2', utilidad: '3' },
          components_basis: 'contract',
        },
      },
    },
    ...overrides,
  };
}

function componentizedSource(): NoteSourceInvoiceSnapshot {
  const source = sourceInvoice();
  const amounts = [
    { id: 501, component: 'administracion', base: 5000, tax: 950 },
    { id: 502, component: 'imprevistos', base: 2000, tax: 380 },
    { id: 503, component: 'utilidad', base: 3000, tax: 570 },
  ];
  const items = amounts.map(({ id, component, base, tax }) => ({
    ...source.invoice_items[0]!,
    id,
    description: component,
    unit_price: new Prisma.Decimal(base),
    total_amount: new Prisma.Decimal(base + tax),
    tax_amount: new Prisma.Decimal(tax),
    aiu_component: component,
  }));
  const taxes = amounts.map(({ id, base, tax }): NoteSourceTaxSnapshot => ({
    invoice_item_id: id,
    tax_rate_id: 9,
    tax_name: 'IVA 19%',
    tax_type: 'iva',
    tax_rate: new Prisma.Decimal(19),
    taxable_amount: new Prisma.Decimal(base),
    tax_amount: new Prisma.Decimal(tax),
    is_inclusive: false,
  }));
  return {
    ...source,
    invoice_items: items,
    invoice_taxes: taxes,
    subtotal_amount: new Prisma.Decimal(10000),
    tax_amount: new Prisma.Decimal(1900),
    total_amount: new Prisma.Decimal(11900),
    aiu_regime: 'et_462_1',
    aiu_minimum_percent: new Prisma.Decimal(10),
    aiu_taxable_matrix: {
      taxable_basis: 'aiu',
      regime: 'et_462_1',
      stage: 'invoice:create',
      minimum: { enforced: true, percent: '10.00' },
      components: amounts.map(({ component, base, tax }) => ({
        component,
        taxable: true,
        lines: 1,
        taxable_amount: `${base.toFixed(2)}`,
        tax_amount: `${tax.toFixed(2)}`,
        rates: [{ tax_type: 'iva', dian_tax_code: '01', tax_rate: '19.00', rate_basis: 'percent' }],
      })),
      taxable_without_rate: [],
    },
    profile_snapshot: null,
  };
}

function expectSourceFailure(run: () => unknown): void {
  try {
    run();
    throw new Error('Expected source-integrity error');
  } catch (error) {
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).errorCode).toBe('INVOICING_NOTE_SOURCE_001');
  }
}

describe('frozen AIU source-note calculation', () => {
  const calculator = new InvoiceCalculatorService();

  it('does not attach an AIU calculator input to ordinary invoices', () => {
    expect(resolveFrozenNoteAiuInput(sourceInvoice({ operation_type: null }))).toBeUndefined();
  });

  it('uses the frozen contract split for an edited partial note and persists the newly computed matrix', () => {
    const source = sourceInvoice();
    const frozen = resolveFrozenNoteAiuInput(source);
    expect(frozen).toMatchObject({
      taxable_basis: 'utilidad',
      components_basis: 'contract',
      enforce_minimum_base: false,
    });

    const output = recalculateNote(calculator, source, [{
      source_invoice_item_id: 501,
      quantity: 0.5,
      unit_price: 100000,
      unit_code: 'NIU',
    }]);

    expect(output.subtotal_amount).toEqual(new Prisma.Decimal(50000));
    expect(output.tax_amount).toEqual(new Prisma.Decimal(285));
    expect(output.total_amount).toEqual(new Prisma.Decimal(50285));
    expect(output.aiu_taxable_matrix).toMatchObject({
      taxable_basis: 'utilidad',
      regime: 'decreto_1372_1992',
      components: [{ taxable_amount: '1500.00', tax_amount: '285.00' }],
    });
  });

  it('proves the AIU source header base from total minus tax when a historical document allowance exists', () => {
    const base = sourceInvoice();
    const source = sourceInvoice({
      invoice_items: [{
        ...base.invoice_items[0]!,
        tax_amount: new Prisma.Decimal(513),
        total_amount: new Prisma.Decimal(100513),
      }],
      invoice_taxes: [{
        ...base.invoice_taxes[0]!,
        taxable_amount: new Prisma.Decimal(2700),
        tax_amount: new Prisma.Decimal(513),
      }],
      subtotal_amount: new Prisma.Decimal(100000),
      discount_amount: new Prisma.Decimal(10000),
      tax_amount: new Prisma.Decimal(513),
      total_amount: new Prisma.Decimal(90513),
      aiu_taxable_matrix: {
        ...(base.aiu_taxable_matrix as object),
        components: [{
          component: 'contrato', taxable: true, lines: 1,
          taxable_amount: '2700.00', tax_amount: '513.00',
          rates: [{ tax_type: 'iva', dian_tax_code: '01', tax_rate: '19.00', rate_basis: 'percent' }],
        }],
      },
    });

    const output = recalculateNote(calculator, source, [{
      source_invoice_item_id: 501,
      quantity: 0.5,
      unit_price: 100000,
      unit_code: 'NIU',
    }]);

    expect(output.subtotal_amount).toEqual(new Prisma.Decimal(45000));
    expect(output.tax_amount).toEqual(new Prisma.Decimal('256.50'));
    expect(output.total_amount).toEqual(new Prisma.Decimal('45256.50'));
    expect(output.aiu_taxable_matrix).toMatchObject({
      components: [{ taxable_amount: '1350.00', tax_amount: '256.50' }],
    });
  });

  const invalidSnapshots: Array<[string, (source: NoteSourceInvoiceSnapshot) => NoteSourceInvoiceSnapshot]> = [
    ['missing frozen components', (source: NoteSourceInvoiceSnapshot) => ({ ...source, profile_snapshot: null })],
    ['ambiguous legacy basis', (source: NoteSourceInvoiceSnapshot) => ({
      ...source,
      profile_snapshot: { config: { aiu: { components: { administracion: 5, imprevistos: 2, utilidad: 3 } } } },
    })],
    ['regime/matrix conflict', (source: NoteSourceInvoiceSnapshot) => ({
      ...source,
      aiu_taxable_matrix: { ...(source.aiu_taxable_matrix as object), regime: 'et_462_1' },
    })],
  ];
  it.each(invalidSnapshots)('rejects %s as source integrity failure', (_label, mutate) => {
    const invalid = mutate(sourceInvoice());
    expectSourceFailure(() => resolveFrozenNoteAiuInput(invalid));
  });

  it('reproduces componentized et_462_1 source under the frozen 10% floor', () => {
    const source = componentizedSource();
    const input = resolveFrozenNoteAiuInput(source);
    expect(input).toMatchObject({ taxable_basis: 'aiu', enforce_minimum_base: true });
    expect(input?.minimum_base_percent).toEqual(new Prisma.Decimal(10));

    const output = recalculateNote(calculator, source, [{
      source_invoice_item_id: 503,
      quantity: 1,
      unit_price: 3000,
      unit_code: 'NIU',
    }]);
    expect(output.tax_amount).toEqual(new Prisma.Decimal(570));
    expect(output.aiu_taxable_matrix).toMatchObject({
      taxable_basis: 'aiu',
      minimum: { enforced: true, percent: '10.00' },
      components: [{ component: 'utilidad', taxable_amount: '3000.00', tax_amount: '570.00' }],
    });
  });

  it('keeps total notes on exact trusted snapshots without running the AIU reproduction proof', () => {
    const source = sourceInvoice({
      profile_snapshot: null,
      invoice_items: [{
        ...sourceInvoice().invoice_items[0]!,
        unit_price: new Prisma.Decimal(99000),
      }],
    });
    const output = recalculateNote(calculator, source);
    expect(output.total_amount).toEqual(new Prisma.Decimal(100570));
    expect(output.aiu_taxable_matrix).toBeUndefined();
  });

  it('uses emitted XML units to prove partial sources whose stored unit code is missing or invalid', () => {
    for (const unit_code of [null, 'INVALID']) {
      const source = sourceInvoice({
        invoice_items: [{ ...sourceInvoice().invoice_items[0]!, unit_code }],
      });
      const output = recalculateNote(calculator, source, [{
        source_invoice_item_id: 501,
        quantity: 0.5,
        unit_price: 100000,
      }], { emitted_unit_codes: new Map([[501, 'NIU']]) });
      expect(output.items[0]?.unit_code).toBe('NIU');
    }
  });

  it('compares linked source tax rows per line so offsetting taxable bases cannot hide corruption', () => {
    const base = sourceInvoice();
    const first = base.invoice_items[0]!;
    const second: NoteSourceItemSnapshot = {
      ...first,
      id: 502,
      unit_price: new Prisma.Decimal(200000),
      tax_amount: new Prisma.Decimal(1140),
      total_amount: new Prisma.Decimal(201140),
    };
    const source = sourceInvoice({
      invoice_items: [first, second],
      invoice_taxes: [
        { ...base.invoice_taxes[0]!, invoice_item_id: first.id, taxable_amount: new Prisma.Decimal(4000) },
        { ...base.invoice_taxes[0]!, invoice_item_id: second.id, taxable_amount: new Prisma.Decimal(5000), tax_amount: new Prisma.Decimal(1140) },
      ],
      subtotal_amount: new Prisma.Decimal(300000),
      tax_amount: new Prisma.Decimal(1710),
      total_amount: new Prisma.Decimal(301710),
      aiu_taxable_matrix: {
        ...(base.aiu_taxable_matrix as object),
        components: [{
          component: 'contrato', taxable: true, lines: 2,
          taxable_amount: '9000.00', tax_amount: '1710.00',
          rates: [{ tax_type: 'iva', dian_tax_code: '01', tax_rate: '19.00', rate_basis: 'percent' }],
        }],
      },
    });

    expectSourceFailure(() => recalculateNote(calculator, source, [
      { source_invoice_item_id: first.id, quantity: 1, unit_price: 100000, unit_code: 'NIU' },
      { source_invoice_item_id: second.id, quantity: 1, unit_price: 200000, unit_code: 'NIU' },
    ]));
  });

  it('normalizes lexical matrix rate spellings before comparing the frozen matrix', () => {
    const source = sourceInvoice({
      aiu_taxable_matrix: {
        ...(sourceInvoice().aiu_taxable_matrix as object),
        components: [{
          component: 'contrato', taxable: true, lines: 1,
          taxable_amount: '3000.00', tax_amount: '570.00',
          rates: [{ tax_type: 'iva', dian_tax_code: '01', tax_rate: '19', rate_basis: 'percent' }],
        }],
      },
    });
    const output = recalculateNote(calculator, source, [{
      source_invoice_item_id: 501,
      quantity: 0.5,
      unit_price: 100000,
      unit_code: 'NIU',
    }]);
    expect(output.tax_amount).toEqual(new Prisma.Decimal(285));
  });

  it('rejects a historical AIU line tax quota that the frozen calculator cannot reproduce', () => {
    const source = sourceInvoice({
      invoice_items: [{
        ...sourceInvoice().invoice_items[0]!,
        tax_amount: new Prisma.Decimal(571),
        total_amount: new Prisma.Decimal(100571),
      }],
      tax_amount: new Prisma.Decimal(571),
      total_amount: new Prisma.Decimal(100571),
    });
    expectSourceFailure(() => recalculateNote(calculator, source, [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 100000,
      unit_code: 'NIU',
    }]));
  });
});
