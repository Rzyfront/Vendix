import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { ReportQueryDto } from './dto/report-query.dto';

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Trial Balance: sums debit/credit by account for a fiscal period
   */
  async getTrialBalance(query: ReportQueryDto) {
    const fiscal_period = await this.validateFiscalPeriod(
      query.fiscal_period_id,
    );

    const entry_where: Prisma.accounting_entriesWhereInput = {
      fiscal_period_id: query.fiscal_period_id,
      status: 'posted',
      ...(query.store_id && { store_id: query.store_id }),
      ...(query.date_from && {
        entry_date: {
          gte: new Date(query.date_from),
          ...(query.date_to && { lte: new Date(query.date_to) }),
        },
      }),
    };

    // Get all posted entries for the period
    const entries = await this.prisma.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });

    const entry_ids = entries.map((e) => e.id);

    if (entry_ids.length === 0) {
      return {
        fiscal_period,
        accounts: [],
        totals: { total_debit: 0, total_credit: 0 },
      };
    }

    // Aggregate by account
    const lines = await this.prisma.accounting_entry_lines.groupBy({
      by: ['account_id'],
      where: {
        entry_id: { in: entry_ids },
      },
      _sum: {
        debit_amount: true,
        credit_amount: true,
      },
    });

    // Get account details
    const account_ids = lines.map((l) => l.account_id);
    const accounts = await this.prisma.chart_of_accounts.findMany({
      where: { id: { in: account_ids } },
      orderBy: { code: 'asc' },
    });

    const account_map = new Map(accounts.map((a: any) => [a.id, a]));

    const trial_balance = lines
      .map((line) => {
        const account: any = account_map.get(line.account_id);
        const debit = Number(line._sum.debit_amount || 0);
        const credit = Number(line._sum.credit_amount || 0);

        return {
          account_id: line.account_id,
          account_code: account?.code || '',
          account_name: account?.name || '',
          account_type: account?.account_type || '',
          nature: account?.nature || '',
          total_debit: debit,
          total_credit: credit,
          balance: debit - credit,
        };
      })
      .sort((a, b) => a.account_code.localeCompare(b.account_code));

    const totals = trial_balance.reduce(
      (acc, item) => ({
        total_debit: acc.total_debit + item.total_debit,
        total_credit: acc.total_credit + item.total_credit,
      }),
      { total_debit: 0, total_credit: 0 },
    );

    return {
      fiscal_period,
      accounts: trial_balance,
      totals,
    };
  }

  /**
   * Balance Sheet: assets - liabilities = equity
   */
  async getBalanceSheet(query: ReportQueryDto) {
    const trial_balance = await this.getTrialBalance(query);

    const assets = trial_balance.accounts.filter(
      (a) => a.account_type === 'asset',
    );
    const liabilities = trial_balance.accounts.filter(
      (a) => a.account_type === 'liability',
    );
    const equity = trial_balance.accounts.filter(
      (a) => a.account_type === 'equity',
    );

    const total_assets = assets.reduce((sum, a) => sum + a.balance, 0);
    const total_liabilities = liabilities.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const total_equity = equity.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );

    return {
      fiscal_period: trial_balance.fiscal_period,
      assets: {
        accounts: assets,
        total: total_assets,
      },
      liabilities: {
        accounts: liabilities,
        total: total_liabilities,
      },
      equity: {
        accounts: equity,
        total: total_equity,
      },
      balance_check: {
        total_assets,
        total_liabilities_and_equity: total_liabilities + total_equity,
        is_balanced:
          Math.abs(total_assets - (total_liabilities + total_equity)) < 0.01,
      },
    };
  }

  /**
   * Income Statement: revenue - expenses = net income
   */
  async getIncomeStatement(query: ReportQueryDto) {
    const trial_balance = await this.getTrialBalance(query);

    const revenue_accounts = trial_balance.accounts.filter(
      (a) => a.account_type === 'revenue',
    );
    const expense_accounts = trial_balance.accounts.filter(
      (a) => a.account_type === 'expense',
    );

    const total_revenue = revenue_accounts.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const total_expenses = expense_accounts.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const net_income = total_revenue - total_expenses;

    return {
      fiscal_period: trial_balance.fiscal_period,
      revenue: {
        accounts: revenue_accounts,
        total: total_revenue,
      },
      expenses: {
        accounts: expense_accounts,
        total: total_expenses,
      },
      net_income,
    };
  }

  /**
   * General Ledger: all entries for a specific account
   */
  async getGeneralLedger(query: ReportQueryDto) {
    if (!query.account_id) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        'account_id is required for general ledger report',
      );
    }

    const fiscal_period = await this.validateFiscalPeriod(
      query.fiscal_period_id,
    );

    // Validate account exists
    const account = await this.prisma.chart_of_accounts.findFirst({
      where: { id: query.account_id },
    });

    if (!account) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_001);
    }

    const entry_where: Prisma.accounting_entriesWhereInput = {
      fiscal_period_id: query.fiscal_period_id,
      status: 'posted',
      ...(query.store_id && { store_id: query.store_id }),
      ...(query.date_from && {
        entry_date: {
          gte: new Date(query.date_from),
          ...(query.date_to && { lte: new Date(query.date_to) }),
        },
      }),
    };

    const entries = await this.prisma.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });

    const entry_ids = entries.map((e) => e.id);

    // Get all lines for this account in the period
    const lines = await this.prisma.accounting_entry_lines.findMany({
      where: {
        account_id: query.account_id,
        entry_id: { in: entry_ids },
      },
      include: {
        entry: {
          select: {
            id: true,
            entry_number: true,
            entry_date: true,
            description: true,
            entry_type: true,
            store: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { entry: { entry_date: 'asc' } },
    });

    // Calculate running balance
    let running_balance = 0;
    const ledger_lines = lines.map((line) => {
      const debit = Number(line.debit_amount);
      const credit = Number(line.credit_amount);
      running_balance += debit - credit;

      return {
        line_id: line.id,
        entry_id: line.entry_id,
        entry_number: line.entry.entry_number,
        entry_date: line.entry.entry_date,
        entry_description: line.entry.description,
        entry_type: line.entry.entry_type,
        store: line.entry.store,
        line_description: line.description,
        debit_amount: debit,
        credit_amount: credit,
        running_balance,
      };
    });

    const totals = ledger_lines.reduce(
      (acc, line) => ({
        total_debit: acc.total_debit + line.debit_amount,
        total_credit: acc.total_credit + line.credit_amount,
      }),
      { total_debit: 0, total_credit: 0 },
    );

    return {
      fiscal_period,
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        account_type: account.account_type,
        nature: account.nature,
      },
      lines: ledger_lines,
      totals: {
        ...totals,
        final_balance: running_balance,
      },
    };
  }

  private async validateFiscalPeriod(fiscal_period_id: number) {
    const period = await this.prisma.fiscal_periods.findFirst({
      where: { id: fiscal_period_id },
    });

    if (!period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    return period;
  }
}
