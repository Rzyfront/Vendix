import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import { FiscalRulesQueryDto } from '../dto/fiscal-operations.dto';

@Injectable()
export class FiscalRulesService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async list(contexts: FiscalOperationsContext[], query: FiscalRulesQueryDto) {
    const year = query.year ?? new Date().getFullYear();
    const where: Prisma.fiscal_rule_setsWhereInput = {
      country_code: 'CO',
      year,
      ...(query.rule_type ? { rule_type: query.rule_type } : {}),
      OR: [
        { organization_id: null, accounting_entity_id: null },
        ...contexts.map((context) => ({
          organization_id: context.organization_id,
          accounting_entity_id: null,
        })),
        ...contexts.map((context) => ({
          accounting_entity_id: context.accounting_entity_id,
        })),
      ],
    };

    const rules = await this.prisma.fiscal_rule_sets.findMany({
      where,
      orderBy: [{ rule_type: 'asc' }, { version: 'desc' }],
    });

    const existingRuleTypes = new Set(rules.map((rule) => rule.rule_type));
    const defaults = this.defaultColombiaRules(year).filter(
      (rule) => !existingRuleTypes.has(rule.rule_type),
    );

    return [...rules, ...defaults];
  }

  private defaultColombiaRules(year: number) {
    return [
      {
        country_code: 'CO',
        year,
        rule_type: 'vat',
        status: 'active',
        name: `IVA Colombia ${year}`,
        version: `${year}.fallback`,
        rules: {
          rates: [19, 5, 0],
          categories: ['gravado', 'exento', 'excluido'],
          disclaimer: 'Reglas base para borrador. Validar con contador antes de presentar.',
        },
      },
      {
        country_code: 'CO',
        year,
        rule_type: 'withholding',
        status: 'active',
        name: `Retenciones Colombia ${year}`,
        version: `${year}.fallback`,
        rules: {
          source: 'withholding_concepts',
          supports_uvt: true,
          disclaimer: 'Usa conceptos configurados por entidad fiscal.',
        },
      },
      {
        country_code: 'CO',
        year,
        rule_type: 'ica',
        status: 'active',
        name: `ICA Colombia ${year}`,
        version: `${year}.fallback`,
        rules: {
          source: 'ica_municipal_rates',
          rate_unit: 'per_mil',
        },
      },
      {
        country_code: 'CO',
        year,
        rule_type: 'obligation_calendar',
        status: 'active',
        name: `Calendario fiscal base ${year}`,
        version: `${year}.fallback`,
        rules: {
          monthly_due_day: 20,
          exogenous_due_month: 4,
          exogenous_due_day: 30,
          income_precierre_month: 3,
          income_precierre_day: 31,
        },
      },
    ];
  }
}
