import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

interface ActualRow {
  account_id: number;
  month_num: number;
  total_debit: string | number;
  total_credit: string | number;
}

export interface VarianceLine {
  account_id: number;
  account_code: string;
  account_name: string;
  budgeted: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

@Injectable()
export class BudgetVarianceService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  /**
   * Get variance report: budget vs actual
   * If month is given, compare that specific month; otherwise compare YTD totals
   */
  async getVarianceReport(
    budget_id: number,
    month?: number,
  ): Promise<{ budget: any; month: number | null; lines: VarianceLine[] }> {
    const context = this.getContext();
    const budget = await this.loadBudgetWithLines(budget_id);

    // Get actual data from accounting entries using raw query
    const actuals = await this.getActualsByMonth(
      budget.fiscal_period_id,
      budget.store_id,
      context.organization_id!,
    );

    // Build actual map: account_id -> { month -> { debit, credit } }
    const actual_map = this.buildActualMap(actuals);

    const lines: VarianceLine[] = budget.budget_lines.map((line: any) => {
      let budgeted: number;
      let actual: number;

      if (month) {
        // Specific month
        const month_key = `month_${String(month).padStart(2, '0')}`;
        budgeted = Number(line[month_key] || 0);

        const month_actual = actual_map.get(line.account_id)?.get(month);
        actual = this.calculateActual(
          month_actual?.debit || 0,
          month_actual?.credit || 0,
          line.account?.nature,
        );
      } else {
        // YTD: sum all months
        budgeted = Number(line.total_budgeted || 0);

        const account_actuals = actual_map.get(line.account_id);
        let total_debit = 0;
        let total_credit = 0;
        if (account_actuals) {
          for (const [, values] of account_actuals) {
            total_debit += values.debit;
            total_credit += values.credit;
          }
        }
        actual = this.calculateActual(
          total_debit,
          total_credit,
          line.account?.nature,
        );
      }

      const variance = actual - budgeted;
      const variance_pct = budgeted !== 0 ? (variance / budgeted) * 100 : 0;

      return {
        account_id: line.account_id,
        account_code: line.account?.code || '',
        account_name: line.account?.name || '',
        budgeted,
        actual,
        variance,
        variance_pct: Math.round(variance_pct * 100) / 100,
      };
    });

    return {
      budget: {
        id: budget.id,
        name: budget.name,
        status: budget.status,
        fiscal_period_id: budget.fiscal_period_id,
        variance_threshold: budget.variance_threshold,
      },
      month: month || null,
      lines: lines.sort((a, b) => a.account_code.localeCompare(b.account_code)),
    };
  }

  /**
   * Monthly trend: 12 months of budgeted vs actual totals
   */
  async getMonthlyTrend(budget_id: number) {
    const context = this.getContext();
    const budget = await this.loadBudgetWithLines(budget_id);

    const actuals = await this.getActualsByMonth(
      budget.fiscal_period_id,
      budget.store_id,
      context.organization_id!,
    );

    const actual_map = this.buildActualMap(actuals);

    const trend: Array<{
      month: number;
      budgeted_total: number;
      actual_total: number;
    }> = [];
    for (let m = 1; m <= 12; m++) {
      const month_key = `month_${String(m).padStart(2, '0')}`;

      let budgeted_total = 0;
      let actual_total = 0;

      for (const line of budget.budget_lines as any[]) {
        budgeted_total += Number(line[month_key] || 0);

        const month_actual = actual_map.get(line.account_id)?.get(m);
        if (month_actual) {
          actual_total += this.calculateActual(
            month_actual.debit,
            month_actual.credit,
            line.account?.nature,
          );
        }
      }

      trend.push({
        month: m,
        budgeted_total: Math.round(budgeted_total * 100) / 100,
        actual_total: Math.round(actual_total * 100) / 100,
      });
    }

    return {
      budget: {
        id: budget.id,
        name: budget.name,
        fiscal_period_id: budget.fiscal_period_id,
      },
      trend,
    };
  }

  /**
   * Variance alerts: lines exceeding the budget's variance threshold
   */
  async getVarianceAlerts(budget_id: number) {
    const report = await this.getVarianceReport(budget_id);
    const threshold = Number(report.budget.variance_threshold || 10);

    const alerts = report.lines.filter(
      (line) => Math.abs(line.variance_pct) > threshold,
    );

    return {
      budget: report.budget,
      threshold,
      alerts: alerts.sort(
        (a, b) => Math.abs(b.variance_pct) - Math.abs(a.variance_pct),
      ),
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────

  private async loadBudgetWithLines(budget_id: number) {
    const budget = await this.prisma.budgets.findFirst({
      where: { id: budget_id },
      include: {
        budget_lines: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                account_type: true,
                nature: true,
              },
            },
          },
        },
      },
    });

    if (!budget) {
      throw new VendixHttpException(ErrorCodes.BUDGET_NOT_FOUND);
    }

    return budget;
  }

  private async getActualsByMonth(
    fiscal_period_id: number,
    store_id: number | null,
    organization_id: number,
  ): Promise<ActualRow[]> {
    const rows = await this.prisma.withoutScope().$queryRaw<ActualRow[]>`
      SELECT
        ael.account_id,
        EXTRACT(MONTH FROM ae.entry_date)::int as month_num,
        SUM(ael.debit_amount)  as total_debit,
        SUM(ael.credit_amount) as total_credit
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      WHERE ae.fiscal_period_id = ${fiscal_period_id}
        AND ae.status = 'posted'
        AND (${store_id}::int IS NULL OR ae.store_id = ${store_id})
        AND ae.organization_id = ${organization_id}
      GROUP BY ael.account_id, EXTRACT(MONTH FROM ae.entry_date)
    `;

    return rows;
  }

  private buildActualMap(
    actuals: ActualRow[],
  ): Map<number, Map<number, { debit: number; credit: number }>> {
    const map = new Map<
      number,
      Map<number, { debit: number; credit: number }>
    >();

    for (const row of actuals) {
      if (!map.has(row.account_id)) {
        map.set(row.account_id, new Map());
      }
      map.get(row.account_id)!.set(row.month_num, {
        debit: Number(row.total_debit || 0),
        credit: Number(row.total_credit || 0),
      });
    }

    return map;
  }

  /**
   * Calculate actual balance based on account nature
   * Revenue (credit nature): actual = credit - debit
   * Expense (debit nature): actual = debit - credit
   */
  private calculateActual(
    debit: number,
    credit: number,
    nature?: string,
  ): number {
    if (nature === 'credit') {
      return credit - debit;
    }
    // debit nature (expenses, assets)
    return debit - credit;
  }
}
