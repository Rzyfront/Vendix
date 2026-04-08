import { getPrismaClient, disconnectPrisma } from './shared/client';

export interface SeedPayrollSystemDefaultsResult {
  created: number;
  skipped: number;
}

const PAYROLL_2026 = {
  year: 2026,
  decree_ref: 'Decreto 2292 de 2024',
  notes: 'Parámetros oficiales de nómina Colombia 2026. SMLMV: $1,423,500. Aux. transporte: $200,000.',
  is_published: true,
  published_at: new Date('2024-12-24T00:00:00.000Z'),
  rules: {
    // Employee deductions
    health_employee_rate: 0.04,
    pension_employee_rate: 0.04,
    // Employer contributions
    health_employer_rate: 0.085,
    pension_employer_rate: 0.12,
    arl_rates: {
      1: 0.00522,
      2: 0.01044,
      3: 0.02436,
      4: 0.0435,
      5: 0.0696,
    },
    sena_rate: 0.02,
    icbf_rate: 0.03,
    compensation_fund_rate: 0.04,
    // Annual values
    minimum_wage: 1423500,
    transport_subsidy: 200000,
    // Thresholds
    transport_subsidy_threshold: 2,
    retention_exempt_threshold: 4,
    // Provisions (monthly accrual)
    severance_rate: 0.0833333333,
    severance_interest_rate: 0.12,
    vacation_rate: 0.0416666667,
    bonus_rate: 0.0833333333,
    // Calendar
    days_per_month: 30,
    days_per_year: 360,
  },
};

export async function seedPayrollSystemDefaults(
  prisma?: ReturnType<typeof getPrismaClient>,
): Promise<SeedPayrollSystemDefaultsResult> {
  const client = prisma ?? getPrismaClient();
  const result: SeedPayrollSystemDefaultsResult = { created: 0, skipped: 0 };

  const defaults_to_seed = [PAYROLL_2026];

  for (const entry of defaults_to_seed) {
    const existing = await (client as any).payroll_system_defaults.findFirst({
      where: { year: entry.year },
    });

    if (existing) {
      result.skipped++;
      continue;
    }

    await (client as any).payroll_system_defaults.create({
      data: {
        year: entry.year,
        rules: entry.rules,
        decree_ref: entry.decree_ref,
        notes: entry.notes,
        is_published: entry.is_published,
        published_at: entry.published_at,
      },
    });
    result.created++;
  }

  return result;
}

// Run directly
if (require.main === module) {
  const client = getPrismaClient();
  seedPayrollSystemDefaults(client)
    .then((res) => {
      console.log(`✅ Payroll System Defaults (created=${res.created}, skipped=${res.skipped})`);
    })
    .catch(console.error)
    .finally(() => disconnectPrisma());
}
