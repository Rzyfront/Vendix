import { Prisma } from '@prisma/client';
import { HolderChangeAccountingService } from './holder-change-accounting.service';
const amount = (value: string | number) => new Prisma.Decimal(value);
const op: any = {
  id: 21,
  store_id: 3,
  organization_id: 7,
  accounting_entity_id: 9,
  original_order_id: 12,
  original_invoice_id: 10,
  credit_note_id: 11,
  new_invoice_id: 13,
  target_customer_id: 31,
};

describe('holder accounting source provenance and atomic effects', () => {
  function harness() {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 12 }]),
      invoice_holder_change_accounting_effects: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, state: 'pending' }),
        updateMany: jest.fn(),
      },
      invoices: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 10,
            status: 'accepted',
            store_id: 3,
            organization_id: 7,
            accounting_entity_id: 9,
            total_amount: amount(119),
            withholding_amount: amount(0),
          }),
        updateMany: jest.fn(),
      },
      invoice_taxes: { findMany: jest.fn().mockResolvedValue([{ tax_type: 'iva' }]) },
      payments: { findMany: jest.fn().mockResolvedValue([{ id: 15 }]) },
      accounting_entries: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 80 }),
      },
      accounting_entry_lines: { findFirst: jest.fn().mockResolvedValue(null) },
      fiscal_periods: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
    };
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      invoice_holder_change_accounting_effects: { updateMany: jest.fn() },
    };
    const gate: any = { isAreaEnabled: jest.fn().mockResolvedValue(true) };
    const mappings: any = { getMapping: jest.fn(async (_org, key) => ({ account_code: key.endsWith('.ica_payable') ? '2412' : '2408' })) };
    return {
      mappings,
      tx,
      prisma,
      gate,
      service: new HolderChangeAccountingService(prisma, gate, mappings),
    };
  }
  const invoice: any = {
    id: 10,
    store_id: 3,
    organization_id: 7,
    accounting_entity_id: 9,
    total_amount: amount(119),
    withholding_amount: amount(0),
  };
  const paymentEntry: any = {
    id: 60,
    source_type: 'payment.received',
    accounting_entry_lines: [
      {
        account: { code: '4135' },
        credit_amount: amount(100),
        debit_amount: amount(0),
      },
      {
        account: { code: '2408' },
        credit_amount: amount(19),
        debit_amount: amount(0),
      },
      {
        account: { code: '280505' },
        credit_amount: amount(8),
        debit_amount: amount(0),
      },
    ],
  };
  it('payment source recognizes net fiscal sale, excluding tip liability; requires exact cents', async () => {
    const { service, tx } = harness();
    tx.accounting_entries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([paymentEntry]);
    await expect(service.preflight(tx, invoice, 12)).resolves.toBeUndefined();
    tx.accounting_entries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...paymentEntry,
          accounting_entry_lines: paymentEntry.accounting_entry_lines.map(
            (l: any) =>
              l.account.code === '2408'
                ? { ...l, credit_amount: amount('18.99') }
                : l,
          ),
        },
      ]);
    await expect(service.preflight(tx, invoice, 12)).rejects.toMatchObject({
      errorCode: 'CF_HOLDER_ACCOUNTING_REVIEW_REQUIRED',
    });
  });
  it.each(['2412', '249999'])('uses the canonical ICA mapping or tenant override %s', async accountCode => {
    const { service, tx, mappings } = harness();
    tx.invoice_taxes.findMany.mockResolvedValue([{ tax_type: 'ica' }]);
    mappings.getMapping.mockImplementation(async (_org, key) => ({
      account_code: key.endsWith('.ica_payable') ? accountCode : '2408',
    }));
    tx.accounting_entries.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      ...paymentEntry, accounting_entry_lines: paymentEntry.accounting_entry_lines.map((l: any) =>
        l.account.code === '2408' ? { ...l, account: { code: accountCode + '01' } } : l),
    }]);
    await expect(service.preflight(tx, invoice, 12)).resolves.toBeUndefined();
    expect(mappings.getMapping).toHaveBeenCalledWith(7, 'payment.received.ica_payable', 3);
  });
  it('area shutdown after NC reversal still posts replacement from original recognition', async () => {
    const { service, tx, gate } = harness();
    gate.isAreaEnabled.mockResolvedValue(false);
    const owned = { id: 50, accounting_entry_lines: [
      { account_id: 1, account: { code: '1305' }, debit_amount: amount(119), credit_amount: amount(0) },
      { account_id: 2, account: { code: '4135' }, debit_amount: amount(0), credit_amount: amount(100) },
      { account_id: 3, account: { code: '2408' }, debit_amount: amount(0), credit_amount: amount(19) },
    ] };
    tx.accounting_entries.findMany.mockResolvedValueOnce([owned]).mockResolvedValueOnce([]);
    await (service as any).apply(op, 'replacement');
    expect(tx.accounting_entries.create).toHaveBeenCalledTimes(1);
    expect(tx.invoice_holder_change_accounting_effects.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'posted', invoice_id: 13 }) }),
    );
  });
  it('never uses an entry total as proof of recognized sale', async () => {
    const { service, tx } = harness();
    tx.accounting_entries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 70,
          total_credit: amount(119),
          accounting_entry_lines: [
            {
              account: { code: '1305' },
              credit_amount: amount(119),
              debit_amount: amount(0),
            },
          ],
        },
      ]);
    await expect(service.preflight(tx, invoice, 12)).rejects.toMatchObject({
      errorCode: 'CF_HOLDER_ACCOUNTING_REVIEW_REQUIRED',
    });
  });
  it('recovery skips a payment-recognized mirror in the SAME transaction as its effect checkpoint', async () => {
    const { service, tx, prisma } = harness();
    tx.accounting_entries.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([paymentEntry])
      .mockResolvedValueOnce([]);
    await (service as any).apply(op, 'credit_note');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.accounting_entries.create).not.toHaveBeenCalled();
    expect(
      tx.invoice_holder_change_accounting_effects.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'skipped',
          invoice_id: 11,
          error_message: 'sale_already_recognized_by_payment',
        }),
      }),
    );
  });
  it('a posted/skipped effect is terminal even after duplicate events; no second journal', async () => {
    const { service, tx } = harness();
    tx.invoice_holder_change_accounting_effects.findFirst.mockResolvedValue({
      id: 1,
      state: 'posted',
    });
    await (service as any).apply(op, 'replacement');
    await (service as any).apply(op, 'replacement');
    expect(tx.accounting_entries.create).not.toHaveBeenCalled();
    expect(tx.invoices.findFirst).not.toHaveBeenCalled();
  });
  it('blocked accounting area produces an explicit skipped effect rather than fictitious recognition', async () => {
    const { service, tx, gate } = harness();
    gate.isAreaEnabled.mockResolvedValue(false);
    tx.accounting_entries.findMany.mockResolvedValue([]);
    await (service as any).apply(op, 'replacement');
    expect(
      tx.invoice_holder_change_accounting_effects.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'skipped',
          error_message: 'accounting_area_disabled',
        }),
      }),
    );
    expect(tx.accounting_entries.create).not.toHaveBeenCalled();
  });
});
