import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto, DatePreset, Granularity } from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';

@Injectable()
export class OverviewAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];
  private readonly VALID_EXPENSE_STATES = ['pending', 'approved', 'paid'];

  async getOverviewSummary(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const { previousStartDate, previousEndDate } = this.getPreviousPeriod(startDate, endDate);

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

    const totalIncome = Number(currentIncome._sum.grand_total || 0) - Number(currentIncome._sum.tax_amount || 0);
    const totalExpenses = Number(currentExpenses._sum.amount || 0);
    const netProfit = totalIncome - totalExpenses;
    const breakevenRatio = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;

    const prevIncome = Number(previousIncome._sum.grand_total || 0) - Number(previousIncome._sum.tax_amount || 0);
    const prevExpensesVal = Number(previousExpenses._sum.amount || 0);
    const prevNetProfit = prevIncome - prevExpensesVal;

    const totalTaxes = Number(currentIncome._sum.tax_amount || 0);
    const prevTaxes = Number(previousIncome._sum.tax_amount || 0);

    const incomeGrowth = prevIncome > 0
      ? ((totalIncome - prevIncome) / prevIncome) * 100
      : 0;
    const expensesGrowth = prevExpensesVal > 0
      ? ((totalExpenses - prevExpensesVal) / prevExpensesVal) * 100
      : 0;
    const netProfitGrowth = prevNetProfit !== 0
      ? ((netProfit - prevNetProfit) / Math.abs(prevNetProfit)) * 100
      : 0;
    const taxesGrowth = prevTaxes > 0
      ? ((totalTaxes - prevTaxes) / prevTaxes) * 100
      : 0;

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
    const { startDate, endDate } = this.parseDateRange(query);
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new ForbiddenException('Store context required for overview trends');
    }
    const storeId = context.store_id;

    const truncSql = Prisma.raw(`'${this.getDateTruncInterval(granularity)}'`);

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
      const key = this.formatPeriodFromDate(new Date(r.period), granularity);
      expenseMap.set(key, Number(r.expenses));
    }

    // Merge sales + expenses
    const merged = salesResults.map((r) => {
      const key = this.formatPeriodFromDate(new Date(r.period), granularity);
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
      this.formatPeriodFromDate.bind(this),
    );
  }

  private getDateTruncInterval(granularity: Granularity): string {
    switch (granularity) {
      case Granularity.HOUR: return 'hour';
      case Granularity.DAY: return 'day';
      case Granularity.WEEK: return 'week';
      case Granularity.MONTH: return 'month';
      case Granularity.YEAR: return 'year';
      default: return 'day';
    }
  }

  private formatPeriodFromDate(date: Date, granularity: Granularity): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    switch (granularity) {
      case Granularity.HOUR:
        return `${y}-${m}-${d}T${String(date.getHours()).padStart(2, '0')}:00`;
      case Granularity.DAY:
        return `${y}-${m}-${d}`;
      case Granularity.WEEK:
        return `${y}-${m}-${d}`;
      case Granularity.MONTH:
        return `${y}-${m}`;
      case Granularity.YEAR:
        return `${y}`;
      default:
        return `${y}-${m}-${d}`;
    }
  }

  private parseDateRange(query: AnalyticsQueryDto): { startDate: Date; endDate: Date } {
    if (query.date_from && query.date_to) {
      const endDate = new Date(query.date_to);
      endDate.setUTCHours(23, 59, 59, 999);
      return {
        startDate: new Date(query.date_from),
        endDate,
      };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (query.date_preset) {
      case DatePreset.TODAY:
        return { startDate: today, endDate: now };
      case DatePreset.YESTERDAY:
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { startDate: yesterday, endDate: today };
      case DatePreset.THIS_WEEK:
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return { startDate: weekStart, endDate: now };
      case DatePreset.LAST_WEEK:
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay());
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        return { startDate: lastWeekStart, endDate: lastWeekEnd };
      case DatePreset.LAST_MONTH:
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return { startDate: lastMonthStart, endDate: lastMonthEnd };
      case DatePreset.THIS_YEAR:
        return { startDate: new Date(today.getFullYear(), 0, 1), endDate: now };
      case DatePreset.LAST_YEAR:
        return {
          startDate: new Date(today.getFullYear() - 1, 0, 1),
          endDate: new Date(today.getFullYear() - 1, 11, 31),
        };
      case DatePreset.THIS_MONTH:
      default:
        return { startDate: new Date(today.getFullYear(), today.getMonth(), 1), endDate: now };
    }
  }

  private getPreviousPeriod(startDate: Date, endDate: Date): { previousStartDate: Date; previousEndDate: Date } {
    const duration = endDate.getTime() - startDate.getTime();
    const previousEndDate = new Date(startDate.getTime() - 1);
    const previousStartDate = new Date(previousEndDate.getTime() - duration);
    return { previousStartDate, previousEndDate };
  }
}
