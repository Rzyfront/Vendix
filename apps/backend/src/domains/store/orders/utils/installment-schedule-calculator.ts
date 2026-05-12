export interface InstallmentScheduleItem {
  installment_number: number;
  installment_value: number;
  capital_value: number;
  interest_value: number;
  remaining_balance: number;
  due_date: Date;
}

export interface ScheduleParams {
  total_amount: number;
  num_installments: number;
  frequency: string;
  first_installment_date: Date;
  interest_rate?: number; // Annual rate as decimal (e.g., 0.12 for 12%)
  interest_type?: 'simple' | 'compound'; // Default: 'simple'
}

export function calculateSchedule(
  params: ScheduleParams,
): InstallmentScheduleItem[] {
  const {
    total_amount,
    num_installments,
    frequency,
    first_installment_date,
    interest_rate,
    interest_type = 'simple',
  } = params;

  if (!interest_rate || interest_rate === 0) {
    return calculateNoInterestSchedule(
      total_amount,
      num_installments,
      frequency,
      first_installment_date,
    );
  }

  if (interest_type === 'compound') {
    return calculateCompoundInterestSchedule(
      total_amount,
      num_installments,
      frequency,
      first_installment_date,
      interest_rate,
    );
  }

  return calculateSimpleInterestSchedule(
    total_amount,
    num_installments,
    frequency,
    first_installment_date,
    interest_rate,
  );
}

/**
 * No interest: equal installments dividing the total amount
 */
function calculateNoInterestSchedule(
  total_amount: number,
  num_installments: number,
  frequency: string,
  first_installment_date: Date,
): InstallmentScheduleItem[] {
  const schedule: InstallmentScheduleItem[] = [];
  const base_value = Math.floor((total_amount / num_installments) * 100) / 100;
  let remaining = total_amount;

  for (let i = 1; i <= num_installments; i++) {
    const is_last = i === num_installments;
    const value = is_last ? Math.round(remaining * 100) / 100 : base_value;
    remaining = Math.round((remaining - value) * 100) / 100;

    schedule.push({
      installment_number: i,
      installment_value: value,
      capital_value: value,
      interest_value: 0,
      remaining_balance: Math.max(remaining, 0),
      due_date: addFrequency(first_installment_date, frequency, i - 1),
    });
  }

  return schedule;
}

/**
 * Simple interest: I = P × r_periodic × n
 * Total = P + I, then divided equally across installments.
 * Each installment has the same total amount with proportional capital/interest split.
 */
function calculateSimpleInterestSchedule(
  total_amount: number,
  num_installments: number,
  frequency: string,
  first_installment_date: Date,
  annual_rate: number,
): InstallmentScheduleItem[] {
  const schedule: InstallmentScheduleItem[] = [];
  const periods_per_year = getPeriodsPerYear(frequency);
  const periodic_rate = annual_rate / periods_per_year;

  // Simple interest: I = P × r × n
  const total_interest =
    Math.round(total_amount * periodic_rate * num_installments * 100) / 100;
  const total_with_interest = total_amount + total_interest;

  const base_installment =
    Math.floor((total_with_interest / num_installments) * 100) / 100;
  const base_capital =
    Math.floor((total_amount / num_installments) * 100) / 100;
  const base_interest =
    Math.floor((total_interest / num_installments) * 100) / 100;

  let remaining_capital = total_amount;
  let remaining_total = total_with_interest;

  for (let i = 1; i <= num_installments; i++) {
    const is_last = i === num_installments;

    const capital_value = is_last
      ? Math.round(remaining_capital * 100) / 100
      : base_capital;
    const interest_value = is_last
      ? Math.round((remaining_total - remaining_capital) * 100) / 100
      : base_interest;
    const installment_value = is_last
      ? Math.round(remaining_total * 100) / 100
      : base_installment;

    remaining_capital =
      Math.round((remaining_capital - capital_value) * 100) / 100;
    remaining_total =
      Math.round((remaining_total - installment_value) * 100) / 100;

    schedule.push({
      installment_number: i,
      installment_value: installment_value,
      capital_value: capital_value,
      interest_value: interest_value,
      remaining_balance: Math.max(remaining_capital, 0),
      due_date: addFrequency(first_installment_date, frequency, i - 1),
    });
  }

  return schedule;
}

/**
 * Compound interest (capitalization): FV = P × (1+r)^n
 * Interest capitalizes each period, then total is divided into equal installments.
 * This results in MORE total interest than simple interest.
 */
function calculateCompoundInterestSchedule(
  total_amount: number,
  num_installments: number,
  frequency: string,
  first_installment_date: Date,
  annual_rate: number,
): InstallmentScheduleItem[] {
  const schedule: InstallmentScheduleItem[] = [];
  const periods_per_year = getPeriodsPerYear(frequency);
  const periodic_rate = annual_rate / periods_per_year;

  // FV = P × (1 + r)^n — interest capitalizes each period
  const total_with_interest =
    Math.round(
      total_amount * Math.pow(1 + periodic_rate, num_installments) * 100,
    ) / 100;
  const total_interest =
    Math.round((total_with_interest - total_amount) * 100) / 100;

  // Equal installments dividing the compounded total
  const base_installment =
    Math.floor((total_with_interest / num_installments) * 100) / 100;
  const base_capital =
    Math.floor((total_amount / num_installments) * 100) / 100;
  const base_interest =
    Math.floor((total_interest / num_installments) * 100) / 100;

  let remaining_capital = total_amount;
  let remaining_total = total_with_interest;

  for (let i = 1; i <= num_installments; i++) {
    const is_last = i === num_installments;

    const capital_value = is_last
      ? Math.round(remaining_capital * 100) / 100
      : base_capital;
    const interest_value = is_last
      ? Math.round((remaining_total - remaining_capital) * 100) / 100
      : base_interest;
    const installment_value = is_last
      ? Math.round(remaining_total * 100) / 100
      : base_installment;

    remaining_capital =
      Math.round((remaining_capital - capital_value) * 100) / 100;
    remaining_total =
      Math.round((remaining_total - installment_value) * 100) / 100;

    schedule.push({
      installment_number: i,
      installment_value: installment_value,
      capital_value: capital_value,
      interest_value: interest_value,
      remaining_balance: Math.max(remaining_capital, 0),
      due_date: addFrequency(first_installment_date, frequency, i - 1),
    });
  }

  return schedule;
}

/**
 * Calculate total amount with interest for display purposes
 */
export function calculateTotalWithInterest(params: ScheduleParams): number {
  const schedule = calculateSchedule(params);
  return schedule.reduce((sum, item) => sum + item.installment_value, 0);
}

function getPeriodsPerYear(frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return 52;
    case 'biweekly':
      return 26;
    case 'monthly':
      return 12;
    default:
      return 12;
  }
}

export function addFrequency(
  base_date: Date,
  frequency: string,
  periods: number,
): Date {
  const date = new Date(base_date);

  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7 * periods);
      break;
    case 'biweekly':
      date.setDate(date.getDate() + 15 * periods);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + periods);
      break;
  }

  return date;
}
