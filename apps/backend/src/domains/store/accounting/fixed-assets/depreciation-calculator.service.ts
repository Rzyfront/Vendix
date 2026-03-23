import { Injectable } from '@nestjs/common';

export interface DepreciationScheduleEntry {
  month: number;
  period_date: Date;
  amount: number;
  accumulated: number;
  book_value: number;
}

@Injectable()
export class DepreciationCalculatorService {
  /**
   * Straight-line depreciation: (cost - salvage) / useful_life_months
   */
  calculateStraightLine(
    cost: number,
    salvage: number,
    useful_life_months: number,
  ): number {
    if (useful_life_months <= 0) return 0;
    return (cost - salvage) / useful_life_months;
  }

  /**
   * Declining balance depreciation:
   * rate = 2 / useful_life_years
   * monthly = (rate * book_value) / 12
   * Does not depreciate below salvage value.
   */
  calculateDecliningBalance(
    cost: number,
    salvage: number,
    useful_life_months: number,
    accumulated: number,
  ): number {
    if (useful_life_months <= 0) return 0;

    const useful_life_years = useful_life_months / 12;
    const rate = 2 / useful_life_years;
    const book_value = cost - accumulated;

    if (book_value <= salvage) return 0;

    const monthly = (rate * book_value) / 12;

    // Don't depreciate below salvage value
    const max_depreciation = book_value - salvage;
    return Math.min(monthly, max_depreciation);
  }

  /**
   * Dispatcher: calculates monthly depreciation based on method.
   */
  calculateMonthlyAmount(asset: {
    acquisition_cost: number;
    salvage_value: number;
    useful_life_months: number;
    depreciation_method: string;
    accumulated_depreciation: number;
  }): number {
    const cost = Number(asset.acquisition_cost);
    const salvage = Number(asset.salvage_value);
    const months = asset.useful_life_months;
    const accumulated = Number(asset.accumulated_depreciation);

    if (cost - accumulated <= salvage) return 0;

    switch (asset.depreciation_method) {
      case 'straight_line':
        return this.calculateStraightLine(cost, salvage, months);
      case 'declining_balance':
        return this.calculateDecliningBalance(cost, salvage, months, accumulated);
      default:
        return this.calculateStraightLine(cost, salvage, months);
    }
  }

  /**
   * Generates the full projected depreciation schedule from the start date.
   */
  generateSchedule(asset: {
    acquisition_cost: number;
    salvage_value: number;
    useful_life_months: number;
    depreciation_method: string;
    depreciation_start_date: Date | null;
    accumulated_depreciation: number;
  }): DepreciationScheduleEntry[] {
    const cost = Number(asset.acquisition_cost);
    const salvage = Number(asset.salvage_value);
    const months = asset.useful_life_months;
    const start_date = asset.depreciation_start_date
      ? new Date(asset.depreciation_start_date)
      : new Date();

    const schedule: DepreciationScheduleEntry[] = [];
    let accumulated = 0;

    for (let i = 0; i < months; i++) {
      const period_date = new Date(start_date.getFullYear(), start_date.getMonth() + i, 1);

      let amount: number;
      if (asset.depreciation_method === 'declining_balance') {
        amount = this.calculateDecliningBalance(cost, salvage, months, accumulated);
      } else {
        amount = this.calculateStraightLine(cost, salvage, months);
      }

      // Ensure we don't go below salvage
      const book_value_before = cost - accumulated;
      if (book_value_before <= salvage) break;
      if (amount > book_value_before - salvage) {
        amount = book_value_before - salvage;
      }
      if (amount <= 0) break;

      amount = Math.round(amount * 100) / 100;
      accumulated = Math.round((accumulated + amount) * 100) / 100;
      const book_value = Math.round((cost - accumulated) * 100) / 100;

      schedule.push({
        month: i + 1,
        period_date,
        amount,
        accumulated,
        book_value,
      });
    }

    return schedule;
  }
}
