import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

export interface AutoEntryEventData {
  source_type: string;
  source_id: number;
  organization_id: number;
  store_id?: number;
  entry_date: Date;
  description: string;
  lines: AutoEntryLine[];
  user_id?: number;
}

export interface AutoEntryLine {
  account_code: string;
  description?: string;
  debit_amount: number;
  credit_amount: number;
}

/**
 * AutoEntryService - Hub for automatic journal entry creation.
 *
 * This service listens to events from other modules (invoicing, payments,
 * expenses, payroll) and creates corresponding journal entries automatically.
 *
 * Event handlers can be wired via @OnEvent() decorators if @nestjs/event-emitter
 * is available, or invoked directly by other services.
 */
@Injectable()
export class AutoEntryService {
  private readonly logger = new Logger(AutoEntryService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Create an automatic journal entry from event data.
   * Validates accounts exist, finds the appropriate fiscal period,
   * creates a balanced entry and auto-posts it.
   */
  async createAutoEntry(event_data: AutoEntryEventData) {
    const {
      source_type,
      source_id,
      organization_id,
      store_id,
      entry_date,
      description,
      lines,
      user_id,
    } = event_data;

    // Validate lines balance
    const total_debit = lines.reduce((sum, l) => sum + Number(l.debit_amount), 0);
    const total_credit = lines.reduce((sum, l) => sum + Number(l.credit_amount), 0);

    if (Math.abs(total_debit - total_credit) > 0.001) {
      this.logger.error(
        `Auto-entry balance error for ${source_type}#${source_id}: ` +
        `debit=${total_debit}, credit=${total_credit}`,
      );
      throw new Error(
        `Auto-entry lines do not balance: debit=${total_debit}, credit=${total_credit}`,
      );
    }

    // Find the open fiscal period for the entry date
    const fiscal_period = await this.prisma.fiscal_periods.findFirst({
      where: {
        organization_id,
        status: 'open',
        start_date: { lte: entry_date },
        end_date: { gte: entry_date },
      },
    });

    if (!fiscal_period) {
      this.logger.error(
        `No open fiscal period found for date ${entry_date.toISOString()} ` +
        `in organization #${organization_id}`,
      );
      throw new Error(
        `No open fiscal period found for date ${entry_date.toISOString()}`,
      );
    }

    // Resolve account codes to IDs
    const account_codes = lines.map((l) => l.account_code);
    const accounts = await this.prisma.chart_of_accounts.findMany({
      where: {
        organization_id,
        code: { in: account_codes },
      },
    });

    const account_map = new Map(accounts.map((a: any) => [a.code, a]));

    // Validate all account codes exist
    for (const code of account_codes) {
      if (!account_map.has(code)) {
        this.logger.error(
          `Account code '${code}' not found for auto-entry ${source_type}#${source_id}`,
        );
        throw new Error(`Account code '${code}' not found in chart of accounts`);
      }
    }

    // Map entry type from source_type
    const entry_type_map: Record<string, string> = {
      'invoice.validated': 'auto_invoice',
      'payment.received': 'auto_payment',
      'expense.approved': 'auto_expense',
      'expense.paid': 'auto_expense',
      'payroll.approved': 'auto_payroll',
      'payroll.paid': 'auto_payroll',
    };
    const entry_type = entry_type_map[source_type] || 'manual';

    // Generate entry number
    const year = new Date().getFullYear();
    const prefix = `AE-${year}-`;
    const latest = await this.prisma.accounting_entries.findFirst({
      where: {
        organization_id,
        entry_number: { startsWith: prefix },
      },
      orderBy: { entry_number: 'desc' },
    });

    let sequence = 1;
    if (latest) {
      const last_number = parseInt(latest.entry_number.replace(prefix, ''), 10);
      if (!isNaN(last_number)) {
        sequence = last_number + 1;
      }
    }
    const entry_number = `${prefix}${String(sequence).padStart(6, '0')}`;

    // Create the entry and lines in a transaction, auto-posted
    const entry = await this.prisma.$transaction(async (tx: any) => {
      const created_entry = await tx.accounting_entries.create({
        data: {
          organization_id,
          store_id: store_id || null,
          entry_number,
          entry_type: entry_type as any,
          status: 'posted',
          fiscal_period_id: fiscal_period.id,
          entry_date,
          description,
          source_type,
          source_id,
          total_debit: new Prisma.Decimal(total_debit),
          total_credit: new Prisma.Decimal(total_credit),
          created_by_user_id: user_id || null,
          posted_by_user_id: user_id || null,
          posted_at: new Date(),
        },
      });

      await tx.accounting_entry_lines.createMany({
        data: lines.map((line) => {
          const account: any = account_map.get(line.account_code);
          return {
            entry_id: created_entry.id,
            account_id: account.id,
            description: line.description || null,
            debit_amount: new Prisma.Decimal(line.debit_amount),
            credit_amount: new Prisma.Decimal(line.credit_amount),
          };
        }),
      });

      return created_entry;
    });

    this.logger.log(
      `Auto journal entry created: ${entry_number} for ${source_type}#${source_id} ` +
      `(debit=${total_debit}, credit=${total_credit})`,
    );

    return entry;
  }

  // ===== Event Handler Methods =====
  // These can be called directly by other services or wired via @OnEvent()

  /**
   * invoice.validated: Debit Accounts Receivable, Credit Revenue + VAT Payable
   */
  async onInvoiceValidated(data: {
    invoice_id: number;
    organization_id: number;
    store_id?: number;
    subtotal: number;
    tax_amount: number;
    total: number;
    user_id?: number;
  }) {
    const lines: AutoEntryLine[] = [
      {
        account_code: '1305',
        description: 'Accounts Receivable',
        debit_amount: data.total,
        credit_amount: 0,
      },
      {
        account_code: '4135',
        description: 'Revenue',
        debit_amount: 0,
        credit_amount: data.subtotal,
      },
    ];

    if (data.tax_amount > 0) {
      lines.push({
        account_code: '2408',
        description: 'VAT Payable',
        debit_amount: 0,
        credit_amount: data.tax_amount,
      });
    }

    return this.createAutoEntry({
      source_type: 'invoice.validated',
      source_id: data.invoice_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Invoice validated #${data.invoice_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * payment.received: Debit Cash/Bank, Credit Accounts Receivable
   */
  async onPaymentReceived(data: {
    payment_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    return this.createAutoEntry({
      source_type: 'payment.received',
      source_id: data.payment_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Payment received #${data.payment_id}`,
      lines: [
        {
          account_code: '1105',
          description: 'Cash/Bank',
          debit_amount: data.amount,
          credit_amount: 0,
        },
        {
          account_code: '1305',
          description: 'Accounts Receivable',
          debit_amount: 0,
          credit_amount: data.amount,
        },
      ],
      user_id: data.user_id,
    });
  }

  /**
   * expense.approved: Debit Expense account, Credit Accounts Payable
   */
  async onExpenseApproved(data: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    expense_account_code?: string;
    user_id?: number;
  }) {
    const expense_code = data.expense_account_code || '5195';

    return this.createAutoEntry({
      source_type: 'expense.approved',
      source_id: data.expense_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Expense approved #${data.expense_id}`,
      lines: [
        {
          account_code: expense_code,
          description: 'Expense',
          debit_amount: data.amount,
          credit_amount: 0,
        },
        {
          account_code: '2205',
          description: 'Accounts Payable',
          debit_amount: 0,
          credit_amount: data.amount,
        },
      ],
      user_id: data.user_id,
    });
  }

  /**
   * expense.paid: Debit Accounts Payable, Credit Cash/Bank
   */
  async onExpensePaid(data: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    return this.createAutoEntry({
      source_type: 'expense.paid',
      source_id: data.expense_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Expense paid #${data.expense_id}`,
      lines: [
        {
          account_code: '2205',
          description: 'Accounts Payable',
          debit_amount: data.amount,
          credit_amount: 0,
        },
        {
          account_code: '1105',
          description: 'Cash/Bank',
          debit_amount: 0,
          credit_amount: data.amount,
        },
      ],
      user_id: data.user_id,
    });
  }

  /**
   * payroll.approved: Debit Payroll Expense + SS, Credit Salaries Payable + Health + Pension
   */
  async onPayrollApproved(data: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    total_earnings: number;
    total_employer_costs: number;
    total_deductions: number;
    total_net_pay: number;
    health_deduction: number;
    pension_deduction: number;
    user_id?: number;
  }) {
    const lines: AutoEntryLine[] = [
      {
        account_code: '5105',
        description: 'Payroll Expense',
        debit_amount: data.total_earnings,
        credit_amount: 0,
      },
      {
        account_code: '5110',
        description: 'Social Security Expense',
        debit_amount: data.total_employer_costs,
        credit_amount: 0,
      },
      {
        account_code: '2505',
        description: 'Salaries Payable',
        debit_amount: 0,
        credit_amount: data.total_net_pay,
      },
      {
        account_code: '2370',
        description: 'Health Payable',
        debit_amount: 0,
        credit_amount: data.health_deduction,
      },
      {
        account_code: '2380',
        description: 'Pension Payable',
        debit_amount: 0,
        credit_amount: data.pension_deduction,
      },
    ];

    // Balance check: the remaining deductions go to a generic withholdings account
    const total_debit = data.total_earnings + data.total_employer_costs;
    const total_credit = data.total_net_pay + data.health_deduction + data.pension_deduction;
    const remaining = total_debit - total_credit;

    if (Math.abs(remaining) > 0.001) {
      lines.push({
        account_code: '2365',
        description: 'Other Withholdings Payable',
        debit_amount: 0,
        credit_amount: remaining,
      });
    }

    return this.createAutoEntry({
      source_type: 'payroll.approved',
      source_id: data.payroll_run_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Payroll approved #${data.payroll_run_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * payroll.paid: Debit Salaries Payable, Credit Bank
   */
  async onPayrollPaid(data: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    total_net_pay: number;
    user_id?: number;
  }) {
    return this.createAutoEntry({
      source_type: 'payroll.paid',
      source_id: data.payroll_run_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Payroll paid #${data.payroll_run_id}`,
      lines: [
        {
          account_code: '2505',
          description: 'Salaries Payable',
          debit_amount: data.total_net_pay,
          credit_amount: 0,
        },
        {
          account_code: '1110',
          description: 'Bank',
          debit_amount: 0,
          credit_amount: data.total_net_pay,
        },
      ],
      user_id: data.user_id,
    });
  }
}
