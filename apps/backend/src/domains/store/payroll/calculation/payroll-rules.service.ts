import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OrganizationSettings } from '../../../organization/settings/interfaces/organization-settings.interface';
import { PayrollRules } from './interfaces/payroll-rules.interface';
import { getDefaultPayrollRules } from './colombian-rules';

@Injectable()
export class PayrollRulesService {
  constructor(
    private readonly org_prisma: OrganizationPrismaService,
  ) {}

  /**
   * Resolves the effective PayrollRules for a given year.
   * Deep-merges DB overrides with defaults so partial updates work.
   */
  async getRulesForYear(year: number): Promise<PayrollRules> {
    const org_settings = await this.org_prisma.organization_settings.findFirst();
    const settings = org_settings?.settings as OrganizationSettings | null;
    const db_rules = settings?.payroll?.rules?.[String(year)];
    const defaults = getDefaultPayrollRules(year);

    if (!db_rules) return defaults;

    return {
      ...defaults,
      ...db_rules,
      arl_rates: { ...defaults.arl_rates, ...(db_rules.arl_rates || {}) },
    };
  }

  /**
   * Returns all configured years and their resolved rules.
   */
  async getConfiguredYears(): Promise<{ years: string[]; default_year: string }> {
    const org_settings = await this.org_prisma.organization_settings.findFirst();
    const settings = org_settings?.settings as OrganizationSettings | null;
    const configured_years = settings?.payroll?.rules
      ? Object.keys(settings.payroll.rules)
      : [];

    const current_year = String(new Date().getFullYear());

    // Always include current year
    const all_years = new Set([...configured_years, current_year]);

    return {
      years: Array.from(all_years).sort(),
      default_year: current_year,
    };
  }

  /**
   * Partially updates payroll rules for a given year in organization_settings.
   */
  async updateRulesForYear(year: number, partial_rules: Partial<PayrollRules>): Promise<PayrollRules> {
    const org_settings = await this.org_prisma.organization_settings.findFirst();

    if (!org_settings) {
      throw new Error('Organization settings not found');
    }

    const settings = (org_settings.settings as OrganizationSettings) || {};
    const current_payroll = settings.payroll || { rules: {} };
    const current_year_rules = current_payroll.rules[String(year)] || {};

    // Deep-merge arl_rates separately
    const merged_arl = partial_rules.arl_rates
      ? { ...(current_year_rules as Partial<PayrollRules>).arl_rates, ...partial_rules.arl_rates }
      : (current_year_rules as Partial<PayrollRules>).arl_rates;

    const updated_year_rules = {
      ...current_year_rules,
      ...partial_rules,
      ...(merged_arl ? { arl_rates: merged_arl } : {}),
    };

    const updated_settings = {
      ...settings,
      payroll: {
        ...current_payroll,
        rules: {
          ...current_payroll.rules,
          [String(year)]: updated_year_rules,
        },
      },
    };

    await this.org_prisma.organization_settings.update({
      where: { id: org_settings.id },
      data: { settings: updated_settings as any },
    });

    // Return resolved (merged with defaults)
    return this.getRulesForYear(year);
  }
}
