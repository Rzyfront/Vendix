import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { INestApplication } from '@nestjs/common';
import { FiscalGateService } from '@common/services/fiscal-gate.service';
import { PlatformOrgService } from '@common/services/platform-org.service';
import { AccountMappingService } from '../account-mappings/account-mapping.service';
import { AutoEntryService } from './auto-entry.service';
import { AccountingEventsListener } from './accounting-events.listener';
import { AccountingEntryFailureService } from './accounting-entry-failure.service';

const codes: Record<string, string> = {
  'payment.received.cash': '1105',
  'payment.received.bank': '1110',
  'payment.received.accounts_receivable': '1305',
  'invoice.validated.accounts_receivable': '1305',
  'payment.received.revenue': '4135',
  'invoice.validated.revenue': '4135',
  'payment.received.sales_discount': '4175',
  'payment.received.iva_payable': '2408',
  'payment.received.vat_payable': '2408',
  'invoice.validated.iva_payable': '2408',
  'invoice.validated.vat_payable': '2408',
  'payment.received.inc_payable': '2436',
  'invoice.validated.inc_payable': '2436',
  'payment.received.shipping_income': '414505',
  'invoice.validated.shipping_income': '414505',
  'payment.received.tip_payable': '238005',
};
const paymentEvent = (paymentId: number) => ({
  financial_account_id: 20,
  payment_id: paymentId,
  organization_id: 1,
  store_id: 2,
  order_id: 9001,
  amount: 999999,
  payment_method: 'cash',
  user_id: 7,
  customer: { id: 8, name: 'Cuenta B' },
});
const invoiceEvent = (id = 500) => ({
  financial_account_id: 20,
  invoice_id: id,
  organization_id: 1,
  store_id: 2,
  accounting_entity_id: 77,
  subtotal: 999999,
  tax_amount: 999999,
  total: 999999,
  user_id: 7,
  customer: { id: 8, name: 'Cuenta B' },
});

function harness() {
  const entries: any[] = [];
  const journalLines: any[] = [];
  const invoices: any[] = [];
  const payments = [
    {
      id: 100,
      amount: new Prisma.Decimal(46),
      state: 'succeeded',
      financial_account_id: 20,
      order_id: 9001,
      store_payment_method: { system_payment_method: { type: 'cash' } },
    },
    {
      id: 101,
      amount: new Prisma.Decimal(69),
      state: 'succeeded',
      financial_account_id: 20,
      order_id: 9001,
      store_payment_method: { system_payment_method: { type: 'cash' } },
    },
  ];
  const account = {
    id: 20,
    store_id: 2,
    role: 'payable',
    split: { source_order_id: 9001, original_payment_ids: [100, 101] },
    subtotal_amount: '100.00',
    discount_amount: '10.00',
    tax_amount: '17.10',
    shipping_cost: '2.90',
    tip_amount: '5.00',
    grand_total: '115.00',
    payments,
    lines: [
      {
        id: 1,
        kind: 'item',
        taxes: [{ id: 1, tax_type: 'iva', tax_amount: '17.10' }],
      },
    ],
  };
  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, condition]: [string, any]) => {
      if (condition === undefined) return true;
      if (condition && typeof condition === 'object') {
        if ('in' in condition) return condition.in.includes(row[key]);
        if ('notIn' in condition) return !condition.notIn.includes(row[key]);
        if ('startsWith' in condition)
          return String(row[key] ?? '').startsWith(condition.startsWith);
      }
      return row[key] === condition;
    });
  const prisma: any = {
    order_financial_accounts: {
      findFirst: jest.fn(async ({ where }) =>
        where.id === account.id &&
        where.store_id === 2 &&
        where.store.organization_id === 1
          ? account
          : null,
      ),
    },
    payments: {
      findMany: jest.fn(async ({ where }) =>
        payments.filter((row) => matches(row, where)),
      ),
      findFirst: jest.fn(
        async ({ where }) =>
          payments.find((row) => matches(row, where)) ?? null,
      ),
    },
    invoices: {
      findFirst: jest.fn(
        async ({ where }) =>
          invoices.find((row) => matches(row, where)) ?? null,
      ),
      findMany: jest.fn(async ({ where }) =>
        invoices.filter((row) => matches(row, where)),
      ),
      updateMany: jest.fn(async ({ where, data }) => {
        const selected = invoices.filter((row) => matches(row, where));
        selected.forEach((row) => Object.assign(row, data));
        return { count: selected.length };
      }),
    },
    accounting_entries: {
      findFirst: jest.fn(async ({ where, orderBy }) => {
        const selected = entries.filter((row) => matches(row, where));
        return (orderBy ? selected[selected.length - 1] : selected[0]) ?? null;
      }),
      findMany: jest.fn(async ({ where }) =>
        entries
          .filter((row) => matches(row, where))
          .sort((a, b) => a.id - b.id),
      ),
      create: jest.fn(async ({ data }) => {
        const row = { id: entries.length + 1, ...data };
        entries.push(row);
        return row;
      }),
    },
    accounting_entry_lines: {
      createMany: jest.fn(async ({ data }) => {
        journalLines.push(...data);
        return { count: data.length };
      }),
    },
    stores: {
      findUnique: jest.fn(async () => ({ timezone: 'America/Bogota' })),
    },
    accounting_entities: {
      findFirst: jest.fn(async () => ({ id: 77, scope: 'STORE', store_id: 2 })),
    },
    fiscal_periods: {
      findFirst: jest.fn(async ({ where }) =>
        where.status === 'closed' ? null : { id: 9 },
      ),
    },
    chart_of_accounts: {
      findMany: jest.fn(async () =>
        [...new Set(Object.values(codes))].map((code) => ({
          id: Number(code),
          code,
          accounting_entity_id: 77,
        })),
      ),
    },
    fiscal_transmissions: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  prisma.withoutScope = () => prisma;
  let lockTail = Promise.resolve();
  const lockCalls: unknown[][] = [];
  prisma.$transaction = jest.fn(async (callback) => {
    let release: (() => void) | undefined;
    let snapshot:
      | { entries: number; lines: number; invoices: any[] }
      | undefined;
    const tx = {
      ...prisma,
      $executeRaw: jest.fn(async (...args) => {
        lockCalls.push(args);
        const previous = lockTail;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        snapshot = {
          entries: entries.length,
          lines: journalLines.length,
          invoices: invoices.map((row) => ({ ...row })),
        };
      }),
    };
    try {
      return await callback(tx);
    } catch (error) {
      if (snapshot) {
        entries.length = snapshot.entries;
        journalLines.length = snapshot.lines;
        invoices.splice(0, invoices.length, ...snapshot.invoices);
      }
      throw error;
    } finally {
      release?.();
    }
  });
  const mapping = {
    getMapping: jest.fn(async (_org, key) =>
      codes[key] ? { account_code: codes[key] } : null,
    ),
  };
  const failure = {
    recordFailure: jest.fn(async (_event: any, _error: Error) => undefined),
    recordSkip: jest.fn(async (_event: unknown) => undefined),
  };
  const fiscalGate = { isAreaEnabled: jest.fn(async () => true) };
  const service = new AutoEntryService(
    prisma,
    mapping as any,
    {
      resolveAccountingEntityForFiscal: jest.fn(async () => ({
        id: 77,
        scope: 'STORE',
        store_id: 2,
      })),
    } as any,
    fiscalGate as any,
    failure as any,
  );
  const addInvoice = (
    status = 'accepted',
    financialAccountId = 20,
    id = 500,
  ) => {
    const invoice = {
      id,
      financial_account_id: financialAccountId,
      order_id: 9001,
      organization_id: 1,
      store_id: 2,
      invoice_type: 'sales_invoice',
      status,
      accounting_entity_id: 77,
    };
    invoices.push(invoice);
    return invoice;
  };
  const amountFor = (code: string, side: 'debit_amount' | 'credit_amount') =>
    journalLines
      .filter((row) => row.account_id === Number(code))
      .reduce((sum, row) => sum.plus(row[side]), new Prisma.Decimal(0))
      .toFixed(2);
  return {
    service,
    prisma,
    entries,
    journalLines,
    invoices,
    payments,
    account,
    mapping,
    failure,
    fiscalGate,
    addInvoice,
    amountFor,
    lockCalls,
  };
}

describe('Financial account accounting — real planner and journal posting', () => {
  it('ignores a draft invoice and another account accepted invoice on the SAME source order', async () => {
    const h = harness();
    h.addInvoice('draft');
    h.addInvoice('accepted', 99, 501);
    h.entries.push({
      id: 1,
      organization_id: 1,
      store_id: 2,
      status: 'posted',
      source_type: 'invoice.validated',
      source_id: 501,
      entry_number: 'AE-2026-000001',
    });
    await h.service.onPaymentReceived(paymentEvent(100));
    expect(h.entries[1].source_type).toBe('financial_account.payment_revenue');
    expect(h.amountFor('4135', 'credit_amount')).toBe('40.00');
    expect(h.amountFor('4175', 'debit_amount')).toBe('4.00');
    expect(h.amountFor('2408', 'credit_amount')).toBe('6.84');
    expect(h.amountFor('238005', 'credit_amount')).toBe('2.00');
    expect(h.amountFor('1305', 'credit_amount')).toBe('0.00');
  });

  it('posts only the remaining account components when its invoice follows a partial direct payment', async () => {
    const h = harness();
    await h.service.onPaymentReceived(paymentEvent(100));
    h.addInvoice();
    await h.service.onInvoiceValidated(invoiceEvent());
    expect(h.amountFor('4135', 'credit_amount')).toBe('100.00');
    expect(h.amountFor('4175', 'debit_amount')).toBe('10.00');
    expect(h.amountFor('2408', 'credit_amount')).toBe('17.10');
    expect(h.amountFor('414505', 'credit_amount')).toBe('2.90');
    expect(h.amountFor('238005', 'credit_amount')).toBe('5.00');
    expect(h.amountFor('1305', 'debit_amount')).toBe('69.00');
    await h.service.onPaymentReceived(paymentEvent(101));
    expect(h.amountFor('1305', 'credit_amount')).toBe('69.00');
    expect(h.amountFor('4135', 'credit_amount')).toBe('100.00');
    expect(h.amountFor('1105', 'debit_amount')).toBe('115.00');
  });

  it('uses this account posted accepted invoice for both later payments, never recognizes revenue twice', async () => {
    const h = harness();
    h.addInvoice();
    await h.service.onInvoiceValidated(invoiceEvent());
    await h.service.onPaymentReceived(paymentEvent(100));
    await h.service.onPaymentReceived(paymentEvent(101));
    expect(h.entries.map((row) => row.source_type)).toEqual([
      'invoice.validated',
      'financial_account.payment_receivable',
      'financial_account.payment_receivable',
    ]);
    expect(h.amountFor('1305', 'debit_amount')).toBe('115.00');
    expect(h.amountFor('1305', 'credit_amount')).toBe('115.00');
    expect(h.amountFor('4135', 'credit_amount')).toBe('100.00');
    expect(h.amountFor('238005', 'credit_amount')).toBe('5.00');
  });

  it('does not add a journal when the entire account was already recognized by direct payments', async () => {
    const h = harness();
    await h.service.onPaymentReceived(paymentEvent(100));
    await h.service.onPaymentReceived(paymentEvent(101));
    h.addInvoice();
    await h.service.onInvoiceValidated(invoiceEvent());
    expect(h.entries).toHaveLength(2);
    expect(h.invoices[0].accounting_status).toBe('not_applicable');
    expect(h.amountFor('4135', 'credit_amount')).toBe('100.00');
  });

  it('retained paid_original invoice is documentary, not new revenue or a new receivable', async () => {
    const h = harness();
    h.account.role = 'paid_original';
    h.payments.forEach((payment) => {
      payment.financial_account_id = null as any;
    });
    h.entries.push(
      ...h.payments.map((payment, index) => ({
        id: index + 1,
        organization_id: 1,
        store_id: 2,
        status: 'posted',
        source_type: 'payment.received',
        source_id: payment.id,
      })),
    );
    h.addInvoice();
    const before = h.payments.map((row) => ({ ...row }));
    await h.service.onInvoiceValidated(invoiceEvent());
    expect(h.entries).toHaveLength(2);
    expect(h.journalLines).toEqual([]);
    expect(h.invoices[0].accounting_status).toBe('not_applicable');
    expect(h.payments).toEqual(before);
  });

  it('audits missing ORIGINAL payment recognition without inventing an invoice journal', async () => {
    const h = harness();
    h.account.role = 'paid_original';
    h.payments.forEach((payment) => {
      payment.financial_account_id = null as any;
    });
    h.addInvoice();
    await expect(h.service.onInvoiceValidated(invoiceEvent())).rejects.toThrow(
      'recovery of ORIGINAL payment.received events [100, 101]',
    );
    expect(h.entries).toEqual([]);
    expect(h.invoices[0].accounting_status).toBeUndefined();
    expect(h.failure.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: 500,
        financial_account_id: 20,
        financial_event: 'invoice',
      }),
      expect.objectContaining({
        message: expect.stringContaining('invoice recognition is forbidden'),
      }),
    );
  });

  it('does not block a retained fiscal document when accounting is intentionally inactive', async () => {
    const h = harness();
    h.account.role = 'paid_original';
    h.fiscalGate.isAreaEnabled.mockResolvedValue(false);
    await expect(h.service.onInvoiceValidated(invoiceEvent())).resolves.toEqual(
      expect.objectContaining({
        skipped: true,
        reason: 'accounting_area_inactive',
      }),
    );
    expect(h.entries).toEqual([]);
    expect(h.failure.recordFailure).not.toHaveBeenCalled();
    expect(h.failure.recordSkip).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'SKIPPED_AREA_INACTIVE' }),
    );
  });

  it('serializes same-account replay and invoice/payment races inside the journal transaction', async () => {
    const h = harness();
    h.addInvoice();
    await Promise.all([
      h.service.onPaymentReceived(paymentEvent(100)),
      h.service.onPaymentReceived(paymentEvent(100)),
      h.service.onInvoiceValidated(invoiceEvent()),
      h.service.onInvoiceValidated(invoiceEvent()),
    ]);
    expect(h.entries).toHaveLength(2);
    expect(h.amountFor('1105', 'debit_amount')).toBe('46.00');
    expect(h.amountFor('4135', 'credit_amount')).toBe('100.00');
    expect(h.lockCalls).toHaveLength(4);
    for (const args of h.lockCalls) {
      expect(String(args[0])).toContain('pg_advisory_xact_lock');
      expect(args[1]).toBe(20);
    }
    // No nested independent transaction can commit the journal outside its lock.
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(4);
  });

  it('rolls journal failure back and replans a retry after an invoice was accepted meanwhile', async () => {
    const h = harness();
    h.prisma.accounting_entry_lines.createMany.mockRejectedValueOnce(
      new Error('line write failed'),
    );
    await expect(
      h.service.onPaymentReceived(paymentEvent(100)),
    ).rejects.toThrow('line write failed');
    expect(h.entries).toEqual([]);
    const retryPayload = h.failure.recordFailure.mock.calls[0][0];
    expect(retryPayload.lines).toEqual([]);
    expect(retryPayload.financial_event).toBe('payment');
    h.addInvoice();
    await h.service.onInvoiceValidated(invoiceEvent());
    await h.service.postAutoEntry(retryPayload);
    expect(h.entries).toHaveLength(2);
    expect(h.entries[1].source_type).toBe(
      'financial_account.payment_receivable',
    );
    expect(h.amountFor('4135', 'credit_amount')).toBe('100.00');
  });

  it('does not rely on an accepted invoice before its revenue journal exists', async () => {
    const h = harness();
    h.addInvoice();
    await h.service.onPaymentReceived(paymentEvent(100));
    expect(h.entries[0].source_type).toBe('financial_account.payment_revenue');
  });

  it('conserves every cent across tiny repeated payments without negative recognition deltas', async () => {
    const h = harness();
    Object.assign(h.account, {
      subtotal_amount: '0.01',
      discount_amount: '0.00',
      tax_amount: '0.01',
      shipping_cost: '0.01',
      tip_amount: '0.01',
      grand_total: '0.04',
    });
    h.account.lines[0].taxes[0].tax_amount = '0.01';
    h.payments.forEach((row) => {
      row.amount = new Prisma.Decimal('0.01');
    });
    h.payments.push(
      { ...h.payments[0], id: 102 },
      { ...h.payments[0], id: 103 },
    );
    for (const row of h.payments)
      await h.service.onPaymentReceived(paymentEvent(row.id));
    expect(h.amountFor('1105', 'debit_amount')).toBe('0.04');
    for (const code of ['4135', '2408', '414505', '238005'])
      expect(h.amountFor(code, 'credit_amount')).toBe('0.01');
    for (const row of h.journalLines) {
      expect(new Prisma.Decimal(row.debit_amount).isNegative()).toBe(false);
      expect(new Prisma.Decimal(row.credit_amount).isNegative()).toBe(false);
    }
  });

  it('uses the typed tax snapshot rather than moving INC into IVA', async () => {
    const h = harness();
    h.account.lines[0].taxes = [
      { id: 1, tax_type: 'iva', tax_amount: '9.00' },
      { id: 2, tax_type: 'inc', tax_amount: '8.10' },
    ];
    h.addInvoice();
    await h.service.onInvoiceValidated(invoiceEvent());
    expect(h.amountFor('2408', 'credit_amount')).toBe('9.00');
    expect(h.amountFor('2436', 'credit_amount')).toBe('8.10');
  });

  it('rejects unaccepted, foreign-account or foreign-tenant event identities before writing journals', async () => {
    const h = harness();
    h.addInvoice('draft');
    await expect(h.service.onInvoiceValidated(invoiceEvent())).rejects.toThrow(
      'not accepted',
    );
    await expect(
      h.service.onPaymentReceived({
        ...paymentEvent(100),
        financial_account_id: 99,
      }),
    ).rejects.toThrow('tenant');
    await expect(
      h.service.onPaymentReceived({ ...paymentEvent(100), store_id: 3 }),
    ).rejects.toThrow('tenant');
    expect(h.entries).toEqual([]);
  });
});

describe('Financial event failure delivery — actual Nest event wrappers', () => {
  let app: INestApplication;
  let emitter: EventEmitter2;
  const posting = {
    onPaymentReceived: jest.fn(),
    onInvoiceValidated: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        AccountingEventsListener,
        { provide: AutoEntryService, useValue: posting },
        { provide: AccountMappingService, useValue: {} },
        {
          provide: FiscalGateService,
          useValue: { isSubflowEnabled: jest.fn(async () => true) },
        },
        { provide: PlatformOrgService, useValue: {} },
        { provide: AccountingEntryFailureService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    emitter = app.get(EventEmitter2);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    posting.onPaymentReceived
      .mockReset()
      .mockRejectedValue(new Error('posting failed'));
    posting.onInvoiceValidated
      .mockReset()
      .mockRejectedValue(new Error('posting failed'));
  });
  it('propagates financial payment failures to emitAsync instead of marking effects completed', async () => {
    await expect(
      emitter.emitAsync('payment.received', paymentEvent(100)),
    ).rejects.toThrow('posting failed');
    expect(posting.onPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({ financial_account_id: 20 }),
    );
  });
  it('propagates financial invoice failures to emitAsync', async () => {
    await expect(
      emitter.emitAsync('invoice.accepted', {
        ...invoiceEvent(),
        invoice_number: 'FE-1',
        subtotal_amount: 100,
        total_amount: 115,
      }),
    ).rejects.toThrow('posting failed');
  });
  it('preserves swallowed-and-logged failures for legacy events without a financial account', async () => {
    await expect(
      emitter.emitAsync('payment.received', {
        ...paymentEvent(100),
        financial_account_id: undefined,
      }),
    ).resolves.toBeDefined();
    await expect(
      emitter.emitAsync('invoice.accepted', {
        ...invoiceEvent(),
        financial_account_id: undefined,
      }),
    ).resolves.toBeDefined();
  });
});
