import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FinancialAnalyticsService } from '../../store/analytics/services/financial-analytics.service';
import { AnalyticsQueryDto } from '../../store/analytics/dto/analytics-query.dto';
import {
  buildCostCoverage,
  computeGrowth,
  round2,
} from '../../store/analytics/analytics-metrics.contract';

const STORE_BATCH_SIZE = 5;

type ProfitLossSummary = Awaited<
  ReturnType<FinancialAnalyticsService['getProfitLossSummary']>
>;

/**
 * Organization-level aggregation of the store dashboard P&L cards (QUI-945).
 * Reuses FinancialAnalyticsService.getProfitLossSummary per store (store
 * context isolated per call) and sums the results. No new metrics.
 */
@Injectable()
export class StoresDashboardService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly financialAnalytics: FinancialAnalyticsService,
  ) {}

  async getProfitLossSummary(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    // Same criterion as StoresService.getGlobalDashboard: active stores only.
    const stores = await this.prisma.stores.findMany({
      where: { is_active: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const summaries: ProfitLossSummary[] = [];
    for (let i = 0; i < stores.length; i += STORE_BATCH_SIZE) {
      const batch = stores.slice(i, i + STORE_BATCH_SIZE);
      const results = await Promise.all(
        batch.map((store) =>
          RequestContextService.runIsolated(
            { ...context, store_id: store.id },
            () => this.financialAnalytics.getProfitLossSummary(query),
          ),
        ),
      );
      summaries.push(...results);
    }

    return this.aggregate(summaries);
  }

  private aggregate(summaries: ProfitLossSummary[]) {
    const num = (v: unknown): number => Number(v) || 0;
    const sum = (pick: (s: any) => unknown): number =>
      summaries.reduce((acc, s) => acc + num(pick(s)), 0);

    const income = sum((s) => s.cash?.income);
    const incomeWithoutTax = sum((s) => s.cash?.income_without_tax);
    const refunds = sum((s) => s.cash?.refunds);
    const refundsTax = sum((s) => s.cash?.refunds_tax);
    const refundsPending = sum((s) => s.cash?.refunds_pending);
    const netProfit = sum((s) => s.cash?.net_profit);
    const netProfitAfterExpenses = sum(
      (s) => s.cash?.net_profit_after_expenses,
    );
    const balance = sum((s) => s.cash?.balance);
    const balanceAccumulated = sum((s) => s.cash?.balance_accumulated);
    const expensesPaid = sum((s) => s.cash?.expenses_paid);

    // Same formula as the store service: base = income w/o tax - refunds net of tax.
    const profitBase = incomeWithoutTax - (refunds - refundsTax);
    const netMargin = profitBase > 0 ? (netProfit / profitBase) * 100 : 0;

    const operatingExpenses = sum((s) => s.operating_expenses);
    const previousOperatingExpenses = sum(
      (s) => s.comparison?.operating_expenses,
    );

    return {
      store_count: summaries.length,
      cash: {
        income: round2(income),
        income_without_tax: round2(incomeWithoutTax),
        refunds: round2(refunds),
        refunds_tax: round2(refundsTax),
        refunds_pending: round2(refundsPending),
        net_profit: round2(netProfit),
        net_profit_after_expenses: round2(netProfitAfterExpenses),
        balance: round2(balance),
        balance_accumulated: round2(balanceAccumulated),
        expenses_paid: round2(expensesPaid),
        net_margin: round2(netMargin),
        cost_coverage: buildCostCoverage(
          sum((s) => s.cash?.cost_coverage?.units_total),
          sum((s) => s.cash?.cost_coverage?.units_without_cost),
        ),
      },
      operating_expenses: round2(operatingExpenses),
      comparison: {
        operating_expenses: round2(previousOperatingExpenses),
        expenses_growth: computeGrowth(
          operatingExpenses,
          previousOperatingExpenses,
        ),
      },
    };
  }
}
