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

describe('PlatformCreditNotesService.createCreditNote', () => {
  function build(prior_sum = 0) {
    const related = {
      id: 5,
      invoice_number: 'FV5',
      invoice_type: 'sales_invoice',
      status: 'accepted',
      cufe: 'c',
      accounting_entity_id: 9,
      organization_id: 1,
    };
    const invoices = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(related)
        .mockResolvedValueOnce({ subtotal_amount: 200 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { subtotal_amount: prior_sum } }),
    };
    const invoicing: any = {
      create: jest.fn().mockResolvedValue({ id: 1, invoice_number: 'NC1', status: 'draft', cufe: null }),
    };
    const svc = new PlatformCreditNotesService(
      { withoutScope: () => ({ invoices }) } as any,
      { requirePlatformContext: jest.fn().mockResolvedValue({ organization_id: 1, accounting_entity_id: 9 }) } as any,
      invoicing,
      { log: jest.fn() } as any,
    );
    return { svc, invoicing };
  }

  const dto = (qty: number, price: number): any => ({
    related_invoice_id: 5,
    note_concept_code: '2',
    reason: 'r',
    items: [{ description: 'x', quantity: qty, unit_price: price }],
  });

  it('finds the invoice, passes decimal qty with NIU', async () => {
    const { svc, invoicing } = build();
    await svc.createCreditNote(dto(1.5, 100), 1);
    const arg = invoicing.create.mock.calls[0][0];
    expect(arg.items[0]).toMatchObject({ quantity: 1.5, unit_code: 'NIU' });
  });

  it('rejects a note larger than the remaining balance', async () => {
    const { svc, invoicing } = build(150);
    await expect(svc.createCreditNote(dto(1, 100), 1)).rejects.toThrow(/supera el saldo/);
    expect(invoicing.create).not.toHaveBeenCalled();
  });
});
