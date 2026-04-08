import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationSettings } from '../../../organization/settings/interfaces/organization-settings.interface';
import { PayrollRules, PayrollUpdateAvailable } from './interfaces/payroll-rules.interface';
import { getDefaultPayrollRules } from './colombian-rules';

@Injectable()
export class PayrollRulesService {
  constructor(
    private readonly org_prisma: OrganizationPrismaService,
    private readonly global_prisma: GlobalPrismaService,
  ) {}

  /**
   * Resolves the effective PayrollRules for a given year.
   * Resolution chain: org override → system defaults → hardcoded
   */
  async getRulesForYear(year: number): Promise<PayrollRules> {
    const org_settings = await this.org_prisma.organization_settings.findFirst();
    const settings = org_settings?.settings as OrganizationSettings | null;
    const db_rules = settings?.payroll?.rules?.[String(year)];

    // Consultar system defaults publicados
    const system_record = await this.global_prisma.payroll_system_defaults.findFirst({
      where: { year, is_published: true },
    });
    const system_rules = system_record?.rules as PayrollRules | null;

    // Base = system defaults si existen, sino hardcoded
    const base = system_rules ?? getDefaultPayrollRules(year);

    if (!db_rules) return base;

    return {
      ...base,
      ...db_rules,
      arl_rates: { ...base.arl_rates, ...(db_rules.arl_rates || {}) },
    };
  }

  /**
   * Returns available system default updates with diff against current org config.
   */
  async getAvailableUpdates(): Promise<PayrollUpdateAvailable[]> {
    const published = await this.global_prisma.payroll_system_defaults.findMany({
      where: { is_published: true },
      orderBy: { year: 'desc' },
    });

    const org_settings = await this.org_prisma.organization_settings.findFirst();
    const settings = org_settings?.settings as OrganizationSettings | null;
    const org_rules_by_year = settings?.payroll?.rules ?? {};

    return published.map(sys => {
      const system_rules = sys.rules as unknown as PayrollRules;
      const org_rules = org_rules_by_year[String(sys.year)] as Partial<PayrollRules> | undefined;

      const diff: Record<string, { current: any; system: any }> = {};
      const COMPARABLE_FIELDS: (keyof PayrollRules)[] = [
        'minimum_wage', 'transport_subsidy', 'health_employee_rate',
        'pension_employee_rate', 'health_employer_rate', 'pension_employer_rate',
        'sena_rate', 'icbf_rate', 'compensation_fund_rate',
        'severance_rate', 'severance_interest_rate', 'vacation_rate', 'bonus_rate',
      ];

      for (const field of COMPARABLE_FIELDS) {
        const current_val = org_rules?.[field] ?? system_rules[field];
        const system_val = system_rules[field];
        if (current_val !== system_val) {
          diff[field] = { current: current_val, system: system_val };
        }
      }

      // ARL rates diff
      if (org_rules?.arl_rates) {
        const arl_diff: any = {};
        for (const level of [1, 2, 3, 4, 5]) {
          const curr = org_rules.arl_rates?.[level] ?? system_rules.arl_rates[level];
          const sys_val = system_rules.arl_rates[level];
          if (curr !== sys_val) arl_diff[level] = { current: curr, system: sys_val };
        }
        if (Object.keys(arl_diff).length > 0) diff['arl_rates'] = arl_diff;
      }

      return {
        year: sys.year,
        decree_ref: sys.decree_ref,
        published_at: sys.published_at,
        has_diff: Object.keys(diff).length > 0,
        diff,
      };
    });
  }

  /**
   * Applies the published system defaults for a year to the org override.
   */
  async applySystemDefaults(year: number): Promise<PayrollRules> {
    const system = await this.global_prisma.payroll_system_defaults.findFirst({
      where: { year, is_published: true },
    });
    if (!system) {
      throw new NotFoundException(`No hay parámetros publicados para el año ${year}`);
    }

    const system_rules = system.rules as unknown as PayrollRules;
    return this.updateRulesForYear(year, system_rules);
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
