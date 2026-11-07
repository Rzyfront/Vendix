import { Prisma } from '@prisma/client';
import { recordTriggerEvent } from '../workflow-trigger.outbox';
import { ExpensesService } from '../../../expenses/expenses.service';
import { ExpenseFlowService } from '../../../expenses/expense-flow/expense-flow.service';
import { PayrollFlowService } from '../../../payroll/payroll-runs/payroll-flow.service';
import { JournalEntryFlowService } from '../../../accounting/journal-entries/journal-entry-flow.service';
import { FiscalPeriodsService } from '../../../accounting/fiscal-periods/fiscal-periods.service';
import { SuppliersService } from '../../../inventory/suppliers/suppliers.service';
import { AccountsPayableService } from '../../../accounts-payable/accounts-payable.service';
import { runAsStoreAdmin, transactionOf, noGoverningFlow } from './producers.test-util';

jest.mock('../workflow-trigger.outbox', () => ({
  recordTriggerEvent: jest.fn().mockResolvedValue(true),
}));

const record = recordTriggerEvent as jest.Mock;
const dec = (n: number) => new Prisma.Decimal(n);

describe('Flujos P1.1 producers: finance, payroll, accounting, suppliers', () => {
  beforeEach(() => record.mockClear());

  describe('expense.created (ExpensesService.create)', () => {
    const build = () => {
      const tx = {
        expenses: {
          create: jest.fn().mockResolvedValue({
            id: 5,
            store_id: 11,
            amount: dec(120),
            category_id: 2,
            description: 'Papel',
          }),
        },
      };
      const prisma = {
        ...noGoverningFlow(),
        $transaction: transactionOf(tx),
        organizationWhere: {},
        expense_categories: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) },
      };
      return { tx, service: new ExpensesService(prisma as never) };
    };
    const dto = {
      amount: 120,
      category_id: 2,
      expense_date: '2026-11-01',
      description: 'Papel',
    };

    it('records the event with the transaction client of the insert', async () => {
      const { tx, service } = build();
      await runAsStoreAdmin(() => service.create(dto as never));
      expect(tx.expenses.create).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(tx, 'expense.created', {
        store_id: 11,
        expense_id: 5,
        amount: dec(120),
        category_id: 2,
        description: 'Papel',
      });
    });

    it('fails with the transaction when the outbox write fails', async () => {
      const { service } = build();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(
        runAsStoreAdmin(() => service.create(dto as never)),
      ).rejects.toThrow('outbox down');
    });
  });

  describe('expense.paid (ExpenseFlowService.pay)', () => {
    const build = (emitter = { emit: jest.fn() }) => {
      const tx = {
        expenses: {
          update: jest.fn().mockResolvedValue({
            id: 9,
            amount: dec(50),
            category_id: 4,
            state: 'paid',
          }),
        },
      };
      const prisma = {
        ...noGoverningFlow(),
        $transaction: transactionOf(tx),
        expenses: {
          findFirst: jest.fn().mockResolvedValue({ id: 9, state: 'approved' }),
        },
      };
      return {
        tx,
        emitter,
        service: new ExpenseFlowService(prisma as never, emitter as never),
      };
    };

    it('records the event in the same transaction as the state write', async () => {
      const { tx, service } = build();
      await runAsStoreAdmin(() => service.pay(9));
      expect(record).toHaveBeenCalledWith(tx, 'expense.paid', {
        store_id: 11,
        expense_id: 9,
        amount: dec(50),
        category_id: 4,
      });
    });

    it('emits nothing after the commit when the transaction fails', async () => {
      const { service, emitter } = build();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(runAsStoreAdmin(() => service.pay(9))).rejects.toThrow(
        'outbox down',
      );
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('payroll_run.approved / payroll_run.paid (PayrollFlowService)', () => {
    const run = {
      id: 4,
      store_id: 11,
      organization_id: 3,
      payroll_number: 'NOM-2026-11',
      total_net_pay: dec(1000),
      period_start: new Date('2026-11-01T00:00:00Z'),
      period_end: new Date('2026-11-30T00:00:00Z'),
      payroll_items: [],
    };
    const build = (status: string) => {
      const tx = { payroll_runs: { update: jest.fn().mockResolvedValue(run) } };
      const prisma = {
        ...noGoverningFlow(),
        $transaction: transactionOf(tx),
        payroll_runs: {
          findFirst: jest.fn().mockResolvedValue({ ...run, status }),
        },
      };
      const emitter = { emit: jest.fn() };
      const service = new PayrollFlowService(
        prisma as never,
        {} as never,
        {} as never,
        emitter as never,
        {} as never,
        {} as never,
      );
      return { tx, emitter, service };
    };

    it('approve records payroll_run.approved with the write transaction', async () => {
      const { tx, service } = build('calculated');
      await runAsStoreAdmin(() => service.approve(4));
      expect(record).toHaveBeenCalledWith(tx, 'payroll_run.approved', {
        store_id: 11,
        payroll_run_id: 4,
        payroll_number: 'NOM-2026-11',
        total_net: dec(1000),
        period_start: run.period_start,
        period_end: run.period_end,
      });
    });

    it('pay records payroll_run.paid and does not emit payroll.paid when it fails', async () => {
      const { tx, service, emitter } = build('approved');
      await runAsStoreAdmin(() => service.pay(4));
      expect(record).toHaveBeenCalledWith(tx, 'payroll_run.paid', {
        store_id: 11,
        payroll_run_id: 4,
        payroll_number: 'NOM-2026-11',
        total_net: dec(1000),
      });

      emitter.emit.mockClear();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(runAsStoreAdmin(() => service.pay(4))).rejects.toThrow(
        'outbox down',
      );
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('journal_entry.posted (JournalEntryFlowService.post)', () => {
    const entry = {
      id: 8,
      store_id: 11,
      entry_number: 'AE-2026-000008',
      entry_type: 'manual',
      status: 'draft',
      total_debit: dec(300),
      total_credit: dec(300),
      fiscal_period: { name: '2026-11', status: 'open' },
    };
    const build = () => {
      const tx = {
        accounting_entries: {
          update: jest.fn().mockResolvedValue({ ...entry, status: 'posted' }),
        },
      };
      const prisma = {
        ...noGoverningFlow(),
        $transaction: transactionOf(tx),
        accounting_entries: { findFirst: jest.fn().mockResolvedValue(entry) },
      };
      return { tx, service: new JournalEntryFlowService(prisma as never) };
    };

    it('records the event with the transaction of the posting', async () => {
      const { tx, service } = build();
      await runAsStoreAdmin(() => service.post(8));
      expect(record).toHaveBeenCalledWith(tx, 'journal_entry.posted', {
        store_id: 11,
        journal_entry_id: 8,
        entry_number: 'AE-2026-000008',
        entry_type: 'manual',
        total_debit: dec(300),
      });
    });

    it('rejects when the outbox write fails', async () => {
      const { service } = build();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(runAsStoreAdmin(() => service.post(8))).rejects.toThrow(
        'outbox down',
      );
    });
  });

  describe('fiscal_period.closed (FiscalPeriodsService.close)', () => {
    const closed = {
      id: 6,
      name: '2026-10',
      end_date: new Date('2026-10-31T00:00:00Z'),
    };
    const build = () => {
      const tx = {
        fiscal_periods: { update: jest.fn().mockResolvedValue(closed) },
      };
      const prisma = {
        ...noGoverningFlow(),
        $transaction: transactionOf(tx),
        fiscal_periods: {
          findFirst: jest.fn().mockResolvedValue({ id: 6, status: 'open' }),
        },
        accounting_entries: { count: jest.fn().mockResolvedValue(0) },
      };
      const scope = {
        resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 1 }),
      };
      return {
        tx,
        service: new FiscalPeriodsService(prisma as never, scope as never),
      };
    };

    it('records the event with the transaction of the close', async () => {
      const { tx, service } = build();
      await runAsStoreAdmin(() => service.close(6));
      expect(record).toHaveBeenCalledWith(tx, 'fiscal_period.closed', {
        store_id: 11,
        fiscal_period_id: 6,
        name: '2026-10',
        end_date: closed.end_date,
      });
    });

    it('rejects when the outbox write fails', async () => {
      const { service } = build();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(runAsStoreAdmin(() => service.close(6))).rejects.toThrow(
        'outbox down',
      );
    });
  });

  describe('supplier.created (SuppliersService.create)', () => {
    const build = () => {
      const tx = {
        suppliers: {
          create: jest.fn().mockResolvedValue({
            id: 12,
            store_id: 11,
            name: 'Distribuidora Sur',
            tax_id: '900123456',
            email: 'ventas@sur.co',
          }),
        },
      };
      const prisma = { ...noGoverningFlow(), $transaction: transactionOf(tx) };
      const scope = {
        requireStoreContext: jest.fn(),
        resolveOperatingScope: jest.fn(),
      };
      const emitter = { emit: jest.fn() };
      const service = new SuppliersService(
        prisma as never,
        scope as never,
        emitter as never,
      );
      jest
        .spyOn(
          service as unknown as { getSupplierScopeWhere: () => Promise<unknown> },
          'getSupplierScopeWhere',
        )
        .mockResolvedValue({ organization_id: 3, store_id: 11 });
      return { tx, emitter, service };
    };

    it('records the event with the insert transaction', async () => {
      const { tx, service } = build();
      await runAsStoreAdmin(() =>
        service.create({ name: 'Distribuidora Sur' } as never),
      );
      expect(record).toHaveBeenCalledWith(tx, 'supplier.created', {
        store_id: 11,
        supplier_id: 12,
        name: 'Distribuidora Sur',
        tax_id: '900123456',
        email: 'ventas@sur.co',
      });
    });

    it('does not emit the embedding event when the transaction fails', async () => {
      const { service, emitter } = build();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(
        runAsStoreAdmin(() =>
          service.create({ name: 'Distribuidora Sur' } as never),
        ),
      ).rejects.toThrow('outbox down');
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('payable.payment_registered (AccountsPayableService.registerPayment)', () => {
    const ap = {
      id: 20,
      store_id: 11,
      organization_id: 3,
      supplier_id: 12,
      balance: dec(500),
      paid_amount: dec(0),
      original_amount: dec(500),
      status: 'open',
      source_type: 'manual',
      source_id: null,
      document_number: 'F-1',
    };
    const build = () => {
      const tx = {
        ap_payments: {
          create: jest
            .fn()
            .mockResolvedValue({ id: 31, amount: dec(200), payment_date: new Date() }),
        },
        accounts_payable: {
          update: jest.fn().mockResolvedValue({ ...ap, status: 'partial' }),
        },
      };
      const prisma = {
        ...noGoverningFlow(),
        $transaction: transactionOf(tx),
        accounts_payable: { findFirst: jest.fn().mockResolvedValue(ap) },
      };
      const emitter = { emit: jest.fn() };
      return {
        tx,
        emitter,
        service: new AccountsPayableService(prisma as never, emitter as never),
      };
    };
    const dto = { amount: 200, payment_method: 'transfer' };

    it('records the event with the payment transaction', async () => {
      const { tx, service } = build();
      await service.registerPayment(20, dto as never, 7);
      expect(record).toHaveBeenCalledWith(tx, 'payable.payment_registered', {
        store_id: 11,
        payable_id: 20,
        payment_id: 31,
        supplier_id: 12,
        amount: dec(200),
        status: 'partial',
      });
    });

    it('emits no accounting event when the transaction fails', async () => {
      const { service, emitter } = build();
      record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(service.registerPayment(20, dto as never, 7)).rejects.toThrow(
        'outbox down',
      );
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });
});
