import { valuateNovelty, PayrollNoveltyRecord } from './novelty-valuation';
import { COLOMBIAN_PAYROLL_DEFAULTS_2026 } from './colombian-rules';

describe('valuateNovelty', () => {
  const rules = COLOMBIAN_PAYROLL_DEFAULTS_2026;
  const BASE_SALARY = 2_300_000; // hourly = 10.000 (230h), daily = 76.666,67

  const novelty = (
    overrides: Partial<PayrollNoveltyRecord> & { novelty_type: string },
  ): PayrollNoveltyRecord => ({
    id: 1,
    date_start: new Date('2026-06-05'),
    ...overrides,
  });

  // ── Overtime (hourly × hours × (1 + rate)) ──

  it('values overtime_nocturna: 10h on 2.3M ⇒ (2.300.000/230)×10×1,75 = 175.000', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'overtime_nocturna', hours: 10 }),
      BASE_SALARY,
      rules,
    );

    expect(result.kind).toBe('earning');
    expect(result.amount).toBe(175_000);
    expect(result.hours).toBe(10);
    expect(result.percentage).toBe(0.75);
    expect(result.date_start).toBe('2026-06-05');
    expect(result.date_end).toBe('2026-06-05'); // falls back to date_start
  });

  it('values overtime_diurna at +25%', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'overtime_diurna', hours: 2 }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(25_000); // 10.000 × 2 × 1,25
  });

  it('values overtime_dominical_diurna at +100% and nocturna at +150%', () => {
    expect(
      valuateNovelty(
        novelty({ novelty_type: 'overtime_dominical_diurna', hours: 3 }),
        BASE_SALARY,
        rules,
      ).amount,
    ).toBe(60_000); // 10.000 × 3 × 2,0
    expect(
      valuateNovelty(
        novelty({ novelty_type: 'overtime_dominical_nocturna', hours: 2 }),
        BASE_SALARY,
        rules,
      ).amount,
    ).toBe(50_000); // 10.000 × 2 × 2,5
  });

  // ── Surcharges (hourly × hours × rate — no base hour) ──

  it('values surcharge_nocturno at 35% of the hour (rate only)', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'surcharge_nocturno', hours: 8 }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(28_000); // 10.000 × 8 × 0,35
  });

  it('values surcharge_dominical at 80% of the hour', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'surcharge_dominical', hours: 8 }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(64_000); // 10.000 × 8 × 0,80
  });

  it('honors a percentage override as the rate', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'overtime_diurna', hours: 2, percentage: 0.5 }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(30_000); // 10.000 × 2 × 1,5
    expect(result.percentage).toBe(0.5);
  });

  // ── Day-based novelties ──

  it('values vacation as (base/30) × days', () => {
    const result = valuateNovelty(
      novelty({
        novelty_type: 'vacation',
        days: 15,
        date_end: new Date('2026-06-20'),
      }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('earning');
    expect(result.amount).toBe(1_150_000); // 76.666,67 × 15
    expect(result.days).toBe(15);
    expect(result.date_end).toBe('2026-06-20');
  });

  it('values incapacity_general: 3 días ⇒ (2.300.000/30)×3×0,6667 = 153.341', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'incapacity_general', days: 3 }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('earning');
    expect(result.amount).toBe(153_341);
    expect(result.percentage).toBe(0.6667);
  });

  it('values incapacity_laboral at 100% of the daily salary', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'incapacity_laboral', days: 4 }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(306_666.67);
  });

  it('values leave_paid as (base/30) × days', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'leave_paid', days: 2 }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(153_333.33);
  });

  it('returns leave_unpaid as a days_adjustment with no payment', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'leave_unpaid', days: 5 }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('days_adjustment');
    expect(result.amount).toBe(0);
    expect(result.days).toBe(5);
  });

  // ── Manual amounts ──

  it('passes through a manual bonus amount as an earning', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'bonus', amount: 300_000 }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('earning');
    expect(result.amount).toBe(300_000);
  });

  it('passes through a commission amount as an earning', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'commission', amount: 120_000 }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('earning');
    expect(result.amount).toBe(120_000);
  });

  it('returns other_deduction as a deduction', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'other_deduction', amount: 50_000 }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('deduction');
    expect(result.amount).toBe(50_000);
  });

  // ── Robustness ──

  it('accepts Prisma.Decimal-like (string) numeric inputs', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'overtime_nocturna', hours: '10' as any }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(175_000);
  });

  it('uses rules.monthly_hours when configured (Ley 2101 reduction)', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'overtime_diurna', hours: 1 }),
      BASE_SALARY,
      { ...rules, monthly_hours: 220 },
    );
    expect(result.amount).toBe(13_068.18); // (2.300.000/220) × 1 × 1,25
  });

  it('throws on an unsupported novelty type', () => {
    expect(() =>
      valuateNovelty(
        novelty({ novelty_type: 'unknown_type' }),
        BASE_SALARY,
        rules,
      ),
    ).toThrow("unsupported novelty type 'unknown_type'");
  });

  // ── Incapacity tramo split (employer days 1-2, EPS day 3+) ──

  it('splits a general incapacity into employer (days 1-2) and EPS (day 3+)', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'incapacity_general', days: 3 }),
      BASE_SALARY,
      rules,
    );
    expect(result.employer_amount).toBe(102_227.33); // 2 días × 51.113,67
    expect(result.reimbursable_amount).toBe(51_113.67); // 1 día EPS
    expect(result.reimbursed_by).toBe('eps');
    expect(result.amount).toBe(153_341); // employer + EPS
  });

  it('applies the 1 SMMLV/30 daily floor to the EPS portion of a low-salary incapacity', () => {
    const base = rules.minimum_wage; // 1 SMMLV
    const result = valuateNovelty(
      novelty({ novelty_type: 'incapacity_general', days: 5 }),
      base,
      rules,
    );
    const rate = rules.incapacity_general_employer_rate as number;
    const daily_pay = (base / 30) * rate;
    const daily_floor = rules.minimum_wage / 30; // piso EPS
    const employer = Math.round(daily_pay * 2 * 100) / 100; // días 1-2
    const eps = Math.round(daily_floor * 3 * 100) / 100; // días 3-5 al piso
    expect(daily_floor).toBeGreaterThan(daily_pay); // el piso realmente aplica
    expect(result.employer_amount).toBe(employer);
    expect(result.reimbursable_amount).toBe(eps);
    expect(result.amount).toBe(Math.round((employer + eps) * 100) / 100);
  });

  it('marks a labor incapacity as fully reimbursed by the ARL from day 1', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'incapacity_laboral', days: 4 }),
      BASE_SALARY,
      rules,
    );
    expect(result.amount).toBe(306_666.67); // 100%
    expect(result.employer_amount).toBe(0);
    expect(result.reimbursable_amount).toBe(306_666.67);
    expect(result.reimbursed_by).toBe('arl');
  });

  // ── Typified leaves (maternity / paternity / bereavement) ──

  it('pays maternity leave 100% and marks it fully reimbursable by the EPS', () => {
    const result = valuateNovelty(
      novelty({
        novelty_type: 'maternity_leave',
        days: 30,
        date_end: new Date('2026-07-04'),
      }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('earning');
    expect(result.amount).toBe(2_300_000); // 76.666,67 × 30
    expect(result.employer_amount).toBe(0);
    expect(result.reimbursable_amount).toBe(2_300_000);
    expect(result.reimbursed_by).toBe('eps');
  });

  it('pays paternity leave from the EPS (not an employer cost)', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'paternity_leave', days: 14 }),
      BASE_SALARY,
      rules,
    );
    expect(result.employer_amount).toBe(0);
    expect(result.reimbursed_by).toBe('eps');
    expect(result.reimbursable_amount).toBe(result.amount);
  });

  it('pays bereavement leave (luto) from the employer, no reimbursement', () => {
    const result = valuateNovelty(
      novelty({ novelty_type: 'bereavement_leave', days: 5 }),
      BASE_SALARY,
      rules,
    );
    expect(result.kind).toBe('earning');
    expect(result.amount).toBe(383_333.33); // 76.666,67 × 5
    expect(result.employer_amount).toBe(383_333.33);
    expect(result.reimbursable_amount).toBe(0);
    expect(result.reimbursed_by).toBeUndefined();
  });
});
