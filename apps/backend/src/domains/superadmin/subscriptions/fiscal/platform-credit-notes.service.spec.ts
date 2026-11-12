import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  PlatformCreditNotesService,
  buildPlatformNoteLines,
} from './platform-credit-notes.service';
import { PlatformCreateCreditNoteDto } from './dto/platform-credit-note.dto';

describe('buildPlatformNoteLines', () => {
  it('accepts a decimal quantity and defaults unit_code to NIU', () => {
    const r = buildPlatformNoteLines([
      { description: 'x', quantity: 1.5, unit_price: 100 },
    ]);
    expect(r.lines[0].unit_code).toBe('NIU');
    expect(r.lines[0].quantity).toBe(1.5);
    expect(r.total).toBe('150.00');
  });

  it('uses the original line unit when the note line has none', () => {
    const r = buildPlatformNoteLines(
      [{ description: 'x', quantity: 1, unit_price: 10 }],
      { fallback_unit_code: 'LUN' },
    );
    expect(r.lines[0].unit_code).toBe('LUN');
  });

  it('rejects MON', () => {
    expect(() =>
      buildPlatformNoteLines([
        { description: 'x', quantity: 1, unit_price: 10, unit_code: 'MON' },
      ]),
    ).toThrow(/MON|unidad/);
  });

  it('rejects amounts above the balance', () => {
    expect(() =>
      buildPlatformNoteLines(
        [{ description: 'x', quantity: 2, unit_price: 100 }],
        { balance: 150 },
      ),
    ).toThrow(/supera el saldo/);
  });
});

describe('PlatformCreateCreditNoteDto lines', () => {
  const mk = (item: any) =>
    plainToInstance(PlatformCreateCreditNoteDto, {
      related_invoice_id: 1,
      note_concept_code: '2',
      reason: 'r',
      items: [item],
    });

  it('accepts quantity 1.5 and unit NIU', async () => {
    const errors = await validate(mk({ description: 'x', quantity: 1.5, unit_code: 'NIU' }));
    expect(errors.filter((e) => e.property === 'items')).toHaveLength(0);
  });

  it('rejects unit MON and non-positive quantity', async () => {
    const e1 = await validate(mk({ description: 'x', quantity: 1, unit_code: 'MON' }));
    expect(e1.some((e) => e.property === 'items')).toBe(true);
    const e2 = await validate(mk({ description: 'x', quantity: 0 }));
    expect(e2.some((e) => e.property === 'items')).toBe(true);
  });
});

describe('PlatformCreditNotesService (fiscal_transmissions rail)', () => {
  const baseTransmission = {
    id: 5,
    organization_id: 1,
    accounting_entity_id: 9,
    document_type: 'sales_invoice',
    source_type: 'platform_invoice',
    source_id: 0,
    document_number: 'FV5',
    cufe: 'cufe-5',
    dian_status: 'accepted',
  };
  const originalLine = {
    description: 'Servicio',
    quantity: 2,
    unit_price: 100,
    line_total: 200,
    unit_code: 'NIU',
    taxes: [{ tax_type: 'IVA', rate: 0.19, tax_amount: 38, is_inclusive: false }],
  };
  const original = {
    id: 5,
    document_number: 'FV5',
    cufe: 'cufe-5',
    issue_date: '2026-11-01',
    total: '238.00',
    currency: 'COP',
    provider_data: {
      items: [{ description: 'Servicio', quantity: '2', unit_price: '100.00' }],
      taxes: [{ tax_type: 'IVA' }],
      subtotal_amount: '200.00',
      tax_amount: '38.00',
      discount_amount: '0.00',
      total_amount: '238.00',
    },
    lines: [originalLine],
    customer: { legal_name: 'Cliente' },
    tax_breakdown: [],
    counterpart_account_code: null,
  };
  const computation = (total: string) => ({
    lineItems: [{ description: 'x' }],
    snapshotItems: [{ description: 'x' }],
    subtotal: total,
    taxTotal: '0.00',
    discountTotal: '0.00',
    payable: total,
    hasAnyTax: false,
    taxBreakdown: [],
  });

  function build(opts: { transmission?: any; credited?: string[] } = {}) {
    const transmission =
      opts.transmission === undefined ? baseTransmission : opts.transmission;
    const findFirst = jest.fn().mockResolvedValue(transmission);
    const fiscal = {
      loadPlatformNoteOriginal: jest.fn().mockResolvedValue(original),
      computePlatformInvoiceTotals: jest
        .fn()
        .mockImplementation(() => computation('119.00')),
      sumCreditedNotes: jest.fn().mockResolvedValue(opts.credited ?? []),
      listPlatformNotes: jest.fn().mockResolvedValue([]),
      issuePlatformNote: jest.fn().mockResolvedValue({ transmission_id: 77 }),
    };
    const audit = { log: jest.fn() };
    const svc = new PlatformCreditNotesService(
      { withoutScope: () => ({ fiscal_transmissions: { findFirst } }) } as any,
      {
        requirePlatformContext: jest
          .fn()
          .mockResolvedValue({ organization_id: 1, accounting_entity_id: 9 }),
      } as any,
      fiscal as any,
      audit as any,
      { deliverInvoice: jest.fn() } as any,
    );
    return { svc, fiscal, audit };
  }

  const dto = (over: any = {}): any => ({
    related_invoice_id: 5,
    note_concept_code: '2',
    reason: 'r',
    ...over,
  });

  it('fails with a 404-style error when the invoice does not exist', async () => {
    const { svc, fiscal } = build({ transmission: null });
    await expect(svc.createCreditNote(dto(), 1)).rejects.toMatchObject({
      errorCode: 'INVOICING_FIND_001',
    });
    expect(fiscal.issuePlatformNote).not.toHaveBeenCalled();
  });

  it('rejects a support document as original', async () => {
    const { svc, fiscal } = build({
      transmission: { ...baseTransmission, document_type: 'support_document' },
    });
    await expect(svc.createCreditNote(dto(), 1)).rejects.toMatchObject({
      errorCode: 'FISCAL_DOCUMENT_UNSUPPORTED',
    });
    expect(fiscal.issuePlatformNote).not.toHaveBeenCalled();
  });

  it('rejects an original that is not accepted by the DIAN', async () => {
    const { svc, fiscal } = build({
      transmission: { ...baseTransmission, dian_status: 'pending' },
    });
    await expect(svc.createCreditNote(dto(), 1)).rejects.toMatchObject({
      errorCode: 'INVOICING_STATUS_002',
    });
    expect(fiscal.issuePlatformNote).not.toHaveBeenCalled();
  });

  it('a credit note without items is a TOTAL note that copies every original line', async () => {
    const { svc, fiscal, audit } = build();
    await svc.createCreditNote(dto(), 1);
    const arg = fiscal.issuePlatformNote.mock.calls[0][0];
    expect(arg).toMatchObject({
      note_type: 'credit_note',
      is_total: true,
      note_concept_code: '2',
      reason: 'r',
    });
    expect(arg.computation.lineItems).toEqual(original.provider_data.items);
    expect(arg.computation.payable).toBe('238.00');
    expect(fiscal.computePlatformInvoiceTotals).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });

  it('a partial credit note inherits the original tax and is computed by the shared engine', async () => {
    const { svc, fiscal } = build();
    await svc.createCreditNote(
      dto({ items: [{ description: 'x', quantity: 1, unit_price: 100 }] }),
      1,
    );
    const items = fiscal.computePlatformInvoiceTotals.mock.calls[0][0].items;
    expect(items[0]).toMatchObject({
      description: 'x',
      quantity: 1,
      unit_price: 100,
      unit_code: 'NIU',
      taxes: [{ tax_type: 'IVA', rate: 0.19, is_inclusive: false }],
    });
    expect(fiscal.issuePlatformNote.mock.calls[0][0].is_total).toBe(false);
  });

  it('rejects a credit note above the creditable balance and issues nothing', async () => {
    const { svc, fiscal } = build({ credited: ['200.00'] });
    await expect(
      svc.createCreditNote(
        dto({ items: [{ description: 'x', quantity: 1, unit_price: 100 }] }),
        1,
      ),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREDIT_NOTE_001' });
    expect(fiscal.issuePlatformNote).not.toHaveBeenCalled();
  });

  it('a total credit note is refused when earlier notes already consumed part of the balance', async () => {
    const { svc, fiscal } = build({ credited: ['10.00'] });
    await expect(svc.createCreditNote(dto(), 1)).rejects.toMatchObject({
      errorCode: 'INVOICING_CREDIT_NOTE_001',
    });
    expect(fiscal.issuePlatformNote).not.toHaveBeenCalled();
  });

  it('a debit note requires items', async () => {
    const { svc, fiscal } = build();
    await expect(
      svc.createDebitNote(dto({ note_concept_code: '1' }), 1),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_VALIDATE_001' });
    expect(fiscal.issuePlatformNote).not.toHaveBeenCalled();
  });

  it('a debit note is not limited by the balance', async () => {
    const { svc, fiscal } = build({ credited: ['238.00'] });
    await svc.createDebitNote(
      dto({
        note_concept_code: '1',
        items: [{ description: 'Intereses', quantity: 1, unit_price: 500 }],
      }),
      1,
    );
    expect(fiscal.issuePlatformNote.mock.calls[0][0].note_type).toBe('debit_note');
  });

  it('refuses a partial note when the original mixes tax rates', async () => {
    const { svc, fiscal } = build();
    fiscal.loadPlatformNoteOriginal.mockResolvedValue({
      ...original,
      lines: [originalLine, { ...originalLine, taxes: [] }],
    });
    await expect(
      svc.createCreditNote(
        dto({ items: [{ description: 'x', quantity: 1, unit_price: 1 }] }),
        1,
      ),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_VALIDATE_001' });
  });

  it('notes overview of a support document answers 200 data with can_create_notes=false', async () => {
    const { svc } = build({
      transmission: { ...baseTransmission, document_type: 'support_document' },
    });
    const r = await svc.getNotesOverview(5);
    expect(r.can_create_notes).toBe(false);
    expect(r.blocked_reason).toMatch(/documento soporte|no admite/i);
  });

  it('notes overview of an accepted invoice returns balance, lines and notes', async () => {
    const { svc, fiscal } = build({ credited: ['38.00'] });
    fiscal.listPlatformNotes.mockResolvedValue([{ id: 8, document_type: 'credit_note' }]);
    const r = await svc.getNotesOverview(5);
    expect(r.can_create_notes).toBe(true);
    expect(r.blocked_reason).toBeNull();
    expect(r.credit_balance).toBe('200.00');
    expect(r.lines[0]).toMatchObject({ description: 'Servicio', tax_rate: 19 });
    expect(r.invoice).toMatchObject({ id: 5, document_number: 'FV5', cufe: 'cufe-5' });
    expect(r.notes).toHaveLength(1);
  });

  it('notes overview of an invoice the DIAN did not accept is blocked, not an error', async () => {
    const { svc } = build({
      transmission: { ...baseTransmission, dian_status: 'rejected' },
    });
    const r = await svc.getNotesOverview(5);
    expect(r.can_create_notes).toBe(false);
    expect(r.blocked_reason).toBeTruthy();
  });
});
