import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { ReportParamsDto } from './dto/report-params.dto';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  private async requireContext() {
    return this.platformOrg.requirePlatformContext();
  }

  /**
   * Trial balance: sums debit/credit by account for the period.
   * Filters posted entries whose entry_date falls within [from, to].
   */
  async getTrialBalance(query: ReportParamsDto) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    const entry_where: Prisma.accounting_entriesWhereInput = {
      accounting_entity_id: ctx.accounting_entity_id,
      organization_id: ctx.organization_id,
      status: 'posted',
      ...(query.from && {
        entry_date: {
          gte: new Date(query.from),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };

    const entries = await base.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });

    const entry_ids = entries.map((e) => e.id);

    if (entry_ids.length === 0) {
      return {
        accounts: [],
        totals: { total_debit: 0, total_credit: 0 },
        period: { from: query.from ?? null, to: query.to ?? null },
      };
    }

    const lines = await base.accounting_entry_lines.groupBy({
      by: ['account_id'],
      where: { entry_id: { in: entry_ids } },
      _sum: { debit_amount: true, credit_amount: true },
    });

    const account_ids = lines.map((l) => l.account_id);
    const accounts = await base.chart_of_accounts.findMany({
      where: {
        id: { in: account_ids },
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
      orderBy: { code: 'asc' },
    });
    const account_map = new Map(accounts.map((a) => [a.id, a]));

    const trial_balance = lines
      .map((line) => {
        const account = account_map.get(line.account_id);
        const debit = Number(line._sum.debit_amount || 0);
        const credit = Number(line._sum.credit_amount || 0);
        return {
          account_id: line.account_id,
          account_code: account?.code ?? '',
          account_name: account?.name ?? '',
          account_type: account?.account_type ?? '',
          nature: account?.nature ?? '',
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
      accounts: trial_balance,
      totals,
      period: { from: query.from ?? null, to: query.to ?? null },
    };
  }

  /**
   * Balance sheet: assets / liabilities / equity as of date.
   * Uses cumulative posted entries up to `as_of` (inclusive).
   */
  async getBalanceSheet(query: ReportParamsDto) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();
    const as_of = query.as_of ? new Date(query.as_of) : new Date();

    const entry_where: Prisma.accounting_entriesWhereInput = {
      accounting_entity_id: ctx.accounting_entity_id,
      organization_id: ctx.organization_id,
      status: 'posted',
      entry_date: { lte: as_of },
    };

    const entries = await base.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    if (entry_ids.length === 0) {
      return {
        as_of,
        assets: { accounts: [], total: 0 },
        liabilities: { accounts: [], total: 0 },
        equity: { accounts: [], total: 0 },
        balance_check: {
          total_assets: 0,
          total_liabilities_and_equity: 0,
          is_balanced: true,
        },
      };
    }

    const lines = await base.accounting_entry_lines.groupBy({
      by: ['account_id'],
      where: { entry_id: { in: entry_ids } },
      _sum: { debit_amount: true, credit_amount: true },
    });

    const account_ids = lines.map((l) => l.account_id);
    const accounts = await base.chart_of_accounts.findMany({
      where: {
        id: { in: account_ids },
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
    });
    const account_map = new Map(accounts.map((a) => [a.id, a]));

    const rows = lines.map((line) => {
      const account = account_map.get(line.account_id);
      const debit = Number(line._sum.debit_amount || 0);
      const credit = Number(line._sum.credit_amount || 0);
      return {
        account_id: line.account_id,
        account_code: account?.code ?? '',
        account_name: account?.name ?? '',
        account_type: account?.account_type ?? '',
        nature: account?.nature ?? '',
        total_debit: debit,
        total_credit: credit,
        balance: debit - credit,
      };
    });

    const assets = rows.filter((a) => a.account_type === 'asset');
    const liabilities = rows.filter((a) => a.account_type === 'liability');
    const equity = rows.filter((a) => a.account_type === 'equity');

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
      as_of,
      assets: { accounts: assets, total: total_assets },
      liabilities: { accounts: liabilities, total: total_liabilities },
      equity: { accounts: equity, total: total_equity },
      balance_check: {
        total_assets,
        total_liabilities_and_equity: total_liabilities + total_equity,
        is_balanced:
          Math.abs(total_assets - (total_liabilities + total_equity)) < 0.01,
      },
    };
  }

  /**
   * Income statement: revenue − expenses − cost = net income for the period.
   */
  async getIncomeStatement(query: ReportParamsDto) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    const entry_where: Prisma.accounting_entriesWhereInput = {
      accounting_entity_id: ctx.accounting_entity_id,
      organization_id: ctx.organization_id,
      status: 'posted',
      ...(query.from && {
        entry_date: {
          gte: new Date(query.from),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };

    const entries = await base.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    if (entry_ids.length === 0) {
      return {
        period: { from: query.from ?? null, to: query.to ?? null },
        revenue: { accounts: [], total: 0 },
        expenses: { accounts: [], total: 0 },
        cost: { accounts: [], total: 0 },
        net_income: 0,
      };
    }

    const lines = await base.accounting_entry_lines.groupBy({
      by: ['account_id'],
      where: { entry_id: { in: entry_ids } },
      _sum: { debit_amount: true, credit_amount: true },
    });

    const account_ids = lines.map((l) => l.account_id);
    const accounts = await base.chart_of_accounts.findMany({
      where: {
        id: { in: account_ids },
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
    });
    const account_map = new Map(accounts.map((a) => [a.id, a]));

    const rows = lines.map((line) => {
      const account = account_map.get(line.account_id);
      const debit = Number(line._sum.debit_amount || 0);
      const credit = Number(line._sum.credit_amount || 0);
      return {
        account_id: line.account_id,
        account_code: account?.code ?? '',
        account_name: account?.name ?? '',
        account_type: account?.account_type ?? '',
        nature: account?.nature ?? '',
        total_debit: debit,
        total_credit: credit,
        balance: debit - credit,
      };
    });

    const revenue_accounts = rows.filter((a) => a.account_type === 'revenue');
    const expense_accounts = rows.filter((a) => a.account_type === 'expense');
    const cost_accounts = rows.filter((a) => a.account_type === 'cost');

    const total_revenue = revenue_accounts.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const total_expenses = expense_accounts.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const total_cost = cost_accounts.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );

    return {
      period: { from: query.from ?? null, to: query.to ?? null },
      revenue: { accounts: revenue_accounts, total: total_revenue },
      expenses: { accounts: expense_accounts, total: total_expenses },
      cost: { accounts: cost_accounts, total: total_cost },
      net_income: total_revenue - total_expenses - total_cost,
    };
  }

  /**
   * General ledger for one account over [from, to].
   */
  async getGeneralLedger(query: ReportParamsDto) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    if (!query.account_code) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        'account_code is required for the general ledger report',
      );
    }

    const account = await base.chart_of_accounts.findFirst({
      where: {
        code: query.account_code,
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
    });

    if (!account) {
      throw new VendixHttpException(
        ErrorCodes.ACC_FIND_001,
        `Account with code '${query.account_code}' not found`,
      );
    }

    const entry_where: Prisma.accounting_entriesWhereInput = {
      accounting_entity_id: ctx.accounting_entity_id,
      organization_id: ctx.organization_id,
      status: 'posted',
      ...(query.from && {
        entry_date: {
          gte: new Date(query.from),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };

    const entries = await base.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    const lines = await base.accounting_entry_lines.findMany({
      where: {
        account_id: account.id,
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
          },
        },
      },
      orderBy: { entry: { entry_date: 'asc' } },
    });

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
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        account_type: account.account_type,
        nature: account.nature,
      },
      period: { from: query.from ?? null, to: query.to ?? null },
      lines: ledger_lines,
      totals: {
        ...totals,
        final_balance: running_balance,
      },
    };
  }
}
