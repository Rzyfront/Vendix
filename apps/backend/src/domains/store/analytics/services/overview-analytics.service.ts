import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  AnalyticsQueryDto,
  Granularity,
} from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import { formatPeriodFromDate, parseDateRange, getPreviousPeriod, getDateTruncInterval } from '../utils/date.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class OverviewAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];
  private readonly VALID_EXPENSE_STATES = ['pending', 'approved', 'paid'];

  async getOverviewSummary(query: AnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    // Current period income (completed orders)
    const currentIncome = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.COMPLETED_STATES },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: { grand_total: true, tax_amount: true },
    });

    // Current period expenses
    const currentExpenses = await this.prisma.expenses.aggregate({
      where: {
        state: { in: this.VALID_EXPENSE_STATES },
        expense_date: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    });

    // Previous period income
    const previousIncome = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.COMPLETED_STATES },
        created_at: { gte: previousStartDate, lte: previousEndDate },
      },
      _sum: { grand_total: true, tax_amount: true },
    });

    // Previous period expenses
    const previousExpenses = await this.prisma.expenses.aggregate({
      where: {
        state: { in: this.VALID_EXPENSE_STATES },
        expense_date: { gte: previousStartDate, lte: previousEndDate },
      },
      _sum: { amount: true },
    });

    const totalIncome =
      Number(currentIncome._sum.grand_total || 0) -
      Number(currentIncome._sum.tax_amount || 0);
    const totalExpenses = Number(currentExpenses._sum.amount || 0);
    const netProfit = totalIncome - totalExpenses;
    const breakevenRatio =
      totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;

    const prevIncome =
      Number(previousIncome._sum.grand_total || 0) -
      Number(previousIncome._sum.tax_amount || 0);
    const prevExpensesVal = Number(previousExpenses._sum.amount || 0);
    const prevNetProfit = prevIncome - prevExpensesVal;

    const totalTaxes = Number(currentIncome._sum.tax_amount || 0);
    const prevTaxes = Number(previousIncome._sum.tax_amount || 0);

    const incomeGrowth =
      prevIncome > 0 ? ((totalIncome - prevIncome) / prevIncome) * 100 : 0;
    const expensesGrowth =
      prevExpensesVal > 0
        ? ((totalExpenses - prevExpensesVal) / prevExpensesVal) * 100
        : 0;
    const netProfitGrowth =
      prevNetProfit !== 0
        ? ((netProfit - prevNetProfit) / Math.abs(prevNetProfit)) * 100
        : 0;
    const taxesGrowth =
      prevTaxes > 0 ? ((totalTaxes - prevTaxes) / prevTaxes) * 100 : 0;

    return {
      total_income: totalIncome,
      total_expenses: totalExpenses,
      net_profit: netProfit,
      breakeven_ratio: breakevenRatio,
      total_taxes: totalTaxes,
      income_growth: incomeGrowth,
      expenses_growth: expensesGrowth,
      net_profit_growth: netProfitGrowth,
      taxes_growth: taxesGrowth,
    };
  }

  async getOverviewTrends(query: AnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const truncSql = Prisma.raw(`'${getDateTruncInterval(granularity)}'`);

    // Sales per period (with cost of goods for gross profit and taxes)
    const salesResults = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: Date;
        sales: any;
        cost_of_goods: any;
        taxes: any;
      }>
    >`
      SELECT
        DATE_TRUNC(${truncSql}, o.created_at) AS period,
        COALESCE(SUM(o.grand_total - o.tax_amount), 0) AS sales,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) AS cost_of_goods,
        COALESCE(SUM(o.tax_amount), 0) AS taxes
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN ('delivered', 'finished')
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
      GROUP BY DATE_TRUNC(${truncSql}, o.created_at)
      ORDER BY period ASC
    `;

    // Expenses per period
    const expenseResults = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: Date;
        expenses: any;
      }>
    >`
      SELECT
        DATE_TRUNC(${truncSql}, e.expense_date) AS period,
        COALESCE(SUM(e.amount), 0) AS expenses
      FROM expenses e
      WHERE e.store_id = ${storeId}
        AND e.state IN ('pending', 'approved', 'paid')
        AND e.expense_date >= ${startDate}
        AND e.expense_date <= ${endDate}
      GROUP BY DATE_TRUNC(${truncSql}, e.expense_date)
      ORDER BY period ASC
    `;

    // Build expense map for merging
    const expenseMap = new Map<string, number>();
    for (const r of expenseResults) {
      const key = formatPeriodFromDate(new Date(r.period), granularity);
      expenseMap.set(key, Number(r.expenses));
    }

    // Merge sales + expenses
    const merged = salesResults.map((r) => {
      const key = formatPeriodFromDate(new Date(r.period), granularity);
      const sales = Number(r.sales);
      const costOfGoods = Number(r.cost_of_goods);
      const taxes = Number(r.taxes);
      const expenses = expenseMap.get(key) || 0;
      expenseMap.delete(key);

      return {
        period: key,
        sales,
        expenses,
        taxes,
        gross_profit: sales - costOfGoods,
        net_profit: sales - expenses,
      };
    });

    // Add expense-only periods (no sales in that period)
    for (const [key, expenses] of expenseMap) {
      merged.push({
        period: key,
        sales: 0,
        expenses,
        taxes: 0,
        gross_profit: 0,
        net_profit: -expenses,
      });
    }

    // Sort by period
    merged.sort((a, b) => a.period.localeCompare(b.period));

    return fillTimeSeries(
      merged,
      startDate,
      endDate,
      granularity,
      { sales: 0, expenses: 0, taxes: 0, gross_profit: 0, net_profit: 0 },
      formatPeriodFromDate,
    );
  }

}
