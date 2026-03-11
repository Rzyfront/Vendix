import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Default Payroll Rules Seed
 *
 * For each organization that has organization_settings but no payroll section,
 * adds the default Colombian payroll rules for 2026.
 * Deep-merges to preserve existing branding/fonts/panel_ui.
 */

const COLOMBIAN_PAYROLL_DEFAULTS_2026 = {
  health_employee_rate: 0.04,
  pension_employee_rate: 0.04,
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
  minimum_wage: 1423500,
  transport_subsidy: 200000,
  transport_subsidy_threshold: 2,
  retention_exempt_threshold: 4,
  severance_rate: 1 / 12,
  severance_interest_rate: 0.12,
  vacation_rate: 15 / 360,
  bonus_rate: 1 / 12,
  days_per_month: 30,
  days_per_year: 360,
};

export async function seedDefaultPayrollRules(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();
  console.log('🌱 Seeding default payroll rules...');

  const org_settings = await client.organization_settings.findMany();

  let updated_count = 0;

  for (const os of org_settings) {
    const settings = (os.settings as Record<string, any>) || {};

    // Skip if already has payroll rules
    if (settings.payroll?.rules) {
      console.log(`  ⏭ Organization settings #${os.id} already has payroll rules, skipping`);
      continue;
    }

    const updated_settings = {
      ...settings,
      payroll: {
        rules: {
          '2026': COLOMBIAN_PAYROLL_DEFAULTS_2026,
        },
      },
    };

    await client.organization_settings.update({
      where: { id: os.id },
      data: { settings: updated_settings },
    });

    updated_count++;
    console.log(`  ✅ Added payroll defaults to organization settings #${os.id}`);
  }

  console.log(`✅ Payroll rules seed complete: ${updated_count} organizations updated`);
}

// Allow direct execution
if (require.main === module) {
  seedDefaultPayrollRules()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
