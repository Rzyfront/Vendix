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
}

export function calculateSchedule(params: ScheduleParams): InstallmentScheduleItem[] {
  const { total_amount, num_installments, frequency, first_installment_date, interest_rate } = params;
  const schedule: InstallmentScheduleItem[] = [];

  if (!interest_rate || interest_rate === 0) {
    // Simple division (no interest)
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
  } else {
    // French amortization (fixed installment)
    const periods_per_year = frequency === 'weekly' ? 52 : frequency === 'biweekly' ? 26 : 12;
    const periodic_rate = interest_rate / periods_per_year;

    // PMT formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
    const factor = Math.pow(1 + periodic_rate, num_installments);
    const fixed_payment = Math.round((total_amount * (periodic_rate * factor) / (factor - 1)) * 100) / 100;

    let remaining_principal = total_amount;

    for (let i = 1; i <= num_installments; i++) {
      const interest_portion = Math.round(remaining_principal * periodic_rate * 100) / 100;
      const is_last = i === num_installments;
      const capital_portion = is_last
        ? Math.round(remaining_principal * 100) / 100
        : Math.round((fixed_payment - interest_portion) * 100) / 100;
      const payment = is_last
        ? Math.round((capital_portion + interest_portion) * 100) / 100
        : fixed_payment;

      remaining_principal = Math.round((remaining_principal - capital_portion) * 100) / 100;

      schedule.push({
        installment_number: i,
        installment_value: payment,
        capital_value: capital_portion,
        interest_value: interest_portion,
        remaining_balance: Math.max(remaining_principal, 0),
        due_date: addFrequency(first_installment_date, frequency, i - 1),
      });
    }
  }

  return schedule;
}

export function addFrequency(base_date: Date, frequency: string, periods: number): Date {
  const date = new Date(base_date);

  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + (7 * periods));
      break;
    case 'biweekly':
      date.setDate(date.getDate() + (15 * periods));
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + periods);
      break;
  }

  return date;
}
