import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AccountingReportsService } from '../reports/accounting-reports.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

@Injectable()
export class ConsolidatedReportsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly accounting_reports: AccountingReportsService,
  ) {}

  private async getSessionWithPeriod(session_id: number) {
    const session = await this.prisma.consolidation_sessions.findFirst({
      where: { id: session_id },
      include: { fiscal_period: true },
    });
    if (!session) {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_FOUND);
    }
    return session;
  }

  private async getSessionAdjustments(session_id: number) {
    return this.prisma.consolidation_adjustments.findMany({
      where: { session_id },
      include: {
        account: {
          select: { id: true, code: true, name: true },
        },
        store: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Apply consolidation adjustments to a trial balance.
   * For each adjustment, add debit/subtract credit from the matching account balance.
   */
  private applyAdjustments(accounts: any[], adjustments: any[]) {
    // Build a map of adjustments by account_id
    const adj_map = new Map<
      number,
      { total_debit: number; total_credit: number }
    >();

    for (const adj of adjustments) {
      const existing = adj_map.get(adj.account_id) || {
        total_debit: 0,
        total_credit: 0,
      };
      existing.total_debit += Number(adj.debit_amount);
      existing.total_credit += Number(adj.credit_amount);
      adj_map.set(adj.account_id, existing);
    }

    return accounts.map((account: any) => {
      const adj = adj_map.get(account.account_id);
      if (!adj) return { ...account };

      const adjusted_debit = account.total_debit + adj.total_debit;
      const adjusted_credit = account.total_credit + adj.total_credit;

      return {
        ...account,
        total_debit: adjusted_debit,
        total_credit: adjusted_credit,
        balance: adjusted_debit - adjusted_credit,
      };
    });
  }

  /**
   * Consolidated Trial Balance:
   * 1. Get combined trial balance (no store_id = all stores)
   * 2. Get adjustments for the session
   * 3. Apply adjustments to produce consolidated figures
   */
  async getConsolidatedTrialBalance(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);
    const adjustments = await this.getSessionAdjustments(session_id);

    // Combined trial balance (all stores)
    const combined = await this.accounting_reports.getTrialBalance({
      fiscal_period_id: session.fiscal_period_id,
    });

    // Apply adjustments
    const consolidated_accounts = this.applyAdjustments(
      combined.accounts,
      adjustments,
    );

    const consolidated_totals = consolidated_accounts.reduce(
      (acc: any, item: any) => ({
        total_debit: acc.total_debit + item.total_debit,
        total_credit: acc.total_credit + item.total_credit,
      }),
      { total_debit: 0, total_credit: 0 },
    );

    return {
      session,
      combined: {
        accounts: combined.accounts,
        totals: combined.totals,
      },
      adjustments,
      consolidated: {
        accounts: consolidated_accounts,
        totals: consolidated_totals,
      },
    };
  }

  /**
   * Consolidated Balance Sheet:
   * 1. Get individual store balance sheets
   * 2. Get combined balance sheet
   * 3. Apply adjustments
   */
  async getConsolidatedBalanceSheet(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);
    const adjustments = await this.getSessionAdjustments(session_id);

    // Get all stores in the organization
    const context_org_id = session.organization_id;
    const stores = await this.prisma.stores.findMany({
      where: { organization_id: context_org_id },
      select: { id: true, name: true },
    });

    // Individual store balance sheets
    const store_balances = await Promise.all(
      stores.map(async (store: any) => {
        const balance = await this.accounting_reports.getBalanceSheet({
          fiscal_period_id: session.fiscal_period_id,
          store_id: store.id,
        });
        return { store, balance };
      }),
    );

    // Combined balance sheet (all stores)
    const combined = await this.accounting_reports.getBalanceSheet({
      fiscal_period_id: session.fiscal_period_id,
    });

    // Apply adjustments to combined trial balance then re-classify
    const combined_trial = await this.accounting_reports.getTrialBalance({
      fiscal_period_id: session.fiscal_period_id,
    });
    const consolidated_accounts = this.applyAdjustments(
      combined_trial.accounts,
      adjustments,
    );

    const assets = consolidated_accounts.filter(
      (a: any) => a.account_type === 'asset',
    );
    const liabilities = consolidated_accounts.filter(
      (a: any) => a.account_type === 'liability',
    );
    const equity = consolidated_accounts.filter(
      (a: any) => a.account_type === 'equity',
    );

    const total_assets = assets.reduce(
      (sum: number, a: any) => sum + a.balance,
      0,
    );
    const total_liabilities = liabilities.reduce(
      (sum: number, a: any) => sum + Math.abs(a.balance),
      0,
    );
    const total_equity = equity.reduce(
      (sum: number, a: any) => sum + Math.abs(a.balance),
      0,
    );

    return {
      session,
      stores: store_balances,
      combined,
      adjustments,
      consolidated: {
        assets: { accounts: assets, total: total_assets },
        liabilities: { accounts: liabilities, total: total_liabilities },
        equity: { accounts: equity, total: total_equity },
        balance_check: {
          total_assets,
          total_liabilities_and_equity: total_liabilities + total_equity,
          is_balanced:
            Math.abs(total_assets - (total_liabilities + total_equity)) < 0.01,
        },
      },
    };
  }

  /**
   * Consolidated Income Statement:
   * 1. Get individual store income statements
   * 2. Get combined income statement
   * 3. Apply adjustments
   */
  async getConsolidatedIncomeStatement(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);
    const adjustments = await this.getSessionAdjustments(session_id);

    // Get all stores in the organization
    const stores = await this.prisma.stores.findMany({
      where: { organization_id: session.organization_id },
      select: { id: true, name: true },
    });

    // Individual store income statements
    const store_statements = await Promise.all(
      stores.map(async (store: any) => {
        const statement = await this.accounting_reports.getIncomeStatement({
          fiscal_period_id: session.fiscal_period_id,
          store_id: store.id,
        });
        return { store, statement };
      }),
    );

    // Combined income statement (all stores)
    const combined = await this.accounting_reports.getIncomeStatement({
      fiscal_period_id: session.fiscal_period_id,
    });

    // Apply adjustments
    const combined_trial = await this.accounting_reports.getTrialBalance({
      fiscal_period_id: session.fiscal_period_id,
    });
    const consolidated_accounts = this.applyAdjustments(
      combined_trial.accounts,
      adjustments,
    );

    const revenue_accounts = consolidated_accounts.filter(
      (a: any) => a.account_type === 'revenue',
    );
    const expense_accounts = consolidated_accounts.filter(
      (a: any) => a.account_type === 'expense',
    );

    const total_revenue = revenue_accounts.reduce(
      (sum: number, a: any) => sum + Math.abs(a.balance),
      0,
    );
    const total_expenses = expense_accounts.reduce(
      (sum: number, a: any) => sum + Math.abs(a.balance),
      0,
    );

    return {
      session,
      stores: store_statements,
      combined,
      adjustments,
      consolidated: {
        revenue: { accounts: revenue_accounts, total: total_revenue },
        expenses: { accounts: expense_accounts, total: total_expenses },
        net_income: total_revenue - total_expenses,
      },
    };
  }

  /**
   * Detailed elimination report: lists all elimination adjustments
   * with from_store, to_store, account, and amount info
   */
  async getEliminationDetail(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);

    const ic_transactions =
      await this.prisma.intercompany_transactions.findMany({
        where: { session_id, eliminated: true },
        include: {
          from_store: { select: { id: true, name: true } },
          to_store: { select: { id: true, name: true } },
          account: { select: { id: true, code: true, name: true } },
        },
        orderBy: { eliminated_at: 'desc' },
      });

    const elimination_adjustments =
      await this.prisma.consolidation_adjustments.findMany({
        where: { session_id, type: 'elimination' },
        include: {
          account: { select: { id: true, code: true, name: true } },
          store: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
      });

    const total_eliminated = ic_transactions.reduce(
      (sum: number, txn: any) => sum + Number(txn.amount),
      0,
    );

    return {
      session,
      intercompany_transactions: ic_transactions,
      elimination_adjustments,
      summary: {
        total_transactions_eliminated: ic_transactions.length,
        total_amount_eliminated: total_eliminated,
      },
    };
  }
}
