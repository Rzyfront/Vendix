import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import { FiscalRulesQueryDto } from '../dto/fiscal-operations.dto';
import {
  CreateFiscalRuleSetDto,
  UpdateFiscalRuleSetDto,
} from '../dto/fiscal-rules.dto';

@Injectable()
export class FiscalRulesService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async list(contexts: FiscalOperationsContext[], query: FiscalRulesQueryDto) {
    const year = query.year ?? new Date().getFullYear();
    const where: Prisma.fiscal_rule_setsWhereInput = {
      country_code: 'CO',
      year,
      // Archived rule sets must not appear in admin list views. Mirrors the
      // pattern used by products/brands/categories. The query DTO has no
      // explicit `include_archived` flag, so this is unconditional.
      status: { not: 'archived' },
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

  /**
   * Resuelve las reglas efectivas para un rule_type/año con la misma
   * precedencia que usan los borradores de declaración:
   * entidad fiscal → organización → global → default Vendix (fallback).
   */
  async resolveEffectiveRules(
    context: { organization_id: number; accounting_entity_id: number },
    ruleType: string,
    year: number,
  ): Promise<Record<string, unknown>> {
    const rule = await this.prisma.fiscal_rule_sets.findFirst({
      where: {
        country_code: 'CO',
        year,
        rule_type: ruleType,
        status: 'active',
        OR: [
          { accounting_entity_id: context.accounting_entity_id },
          {
            organization_id: context.organization_id,
            accounting_entity_id: null,
          },
          { organization_id: null, accounting_entity_id: null },
        ],
      },
      orderBy: [
        { accounting_entity_id: 'desc' },
        { organization_id: 'desc' },
        { version: 'desc' },
      ],
    });

    if (
      rule?.rules &&
      typeof rule.rules === 'object' &&
      !Array.isArray(rule.rules)
    ) {
      return rule.rules as Record<string, unknown>;
    }

    const fallback = this.defaultColombiaRules(year).find(
      (item) => item.rule_type === ruleType,
    );

    return {
      ...(fallback?.rules ?? {}),
      country_code: 'CO',
      year,
      rule_type: ruleType,
      source: 'vendix_default_fallback',
    };
  }

  /**
   * Creates a tenant-owned rule set. Always born as `draft` so it never
   * affects `resolveEffectiveRules()` until it is explicitly activated.
   * Scope is taken from the request context (organization) plus an optional
   * `accounting_entity_id` from the body (validated against the same org).
   */
  async createRuleSet(dto: CreateFiscalRuleSetDto) {
    const organization_id = this.requireOrganizationId();
    this.assertRulesPayload(dto.rules);

    if (dto.accounting_entity_id) {
      const entity = await this.prisma
        .withoutScope()
        .accounting_entities.findFirst({
          where: { id: dto.accounting_entity_id, organization_id },
          select: { id: true },
        });
      if (!entity) {
        throw new NotFoundException(
          'Accounting entity not found for this organization',
        );
      }
    }

    try {
      return await this.prisma.fiscal_rule_sets.create({
        data: {
          organization_id,
          accounting_entity_id: dto.accounting_entity_id ?? null,
          country_code: dto.country_code ?? 'CO',
          year: dto.year,
          rule_type: dto.rule_type,
          status: 'draft',
          name: dto.name,
          version: dto.version ?? '1',
          effective_from: dto.effective_from
            ? new Date(dto.effective_from)
            : new Date(),
          rules: dto.rules as Prisma.InputJsonObject,
          created_by_user_id: RequestContextService.getUserId() ?? null,
        },
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  /** Updates a rule set. Only `draft` rows are editable (active/archived are immutable). */
  async updateRuleSet(id: number, dto: UpdateFiscalRuleSetDto) {
    const organization_id = this.requireOrganizationId();
    const existing = await this.findOwnedRuleSet(id, organization_id);

    if (existing.status !== 'draft') {
      throw new BadRequestException(
        'Only draft fiscal rule sets can be updated',
      );
    }
    if (dto.rules !== undefined) {
      this.assertRulesPayload(dto.rules);
    }

    const data: Prisma.fiscal_rule_setsUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.rule_type !== undefined) data.rule_type = dto.rule_type;
    if (dto.year !== undefined) data.year = dto.year;
    if (dto.version !== undefined) data.version = dto.version;
    if (dto.effective_from !== undefined) {
      data.effective_from = new Date(dto.effective_from);
    }
    if (dto.rules !== undefined) {
      data.rules = dto.rules as Prisma.InputJsonObject;
    }

    try {
      return await this.prisma.fiscal_rule_sets.update({
        where: { id: existing.id },
        data,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  /**
   * Activates a draft rule set. In the same transaction, any other `active`
   * row of the same scope (organization, accounting_entity, country, year,
   * rule_type) is archived with `effective_to = now`, so at most one active
   * version exists per scope/year/type at any time.
   */
  async activateRuleSet(id: number) {
    const organization_id = this.requireOrganizationId();
    const existing = await this.findOwnedRuleSet(id, organization_id);

    if (existing.status !== 'draft') {
      throw new BadRequestException(
        'Only draft fiscal rule sets can be activated',
      );
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.fiscal_rule_sets.updateMany({
        where: {
          id: { not: existing.id },
          organization_id,
          accounting_entity_id: existing.accounting_entity_id,
          country_code: existing.country_code,
          year: existing.year,
          rule_type: existing.rule_type,
          status: 'active',
        },
        data: { status: 'archived', effective_to: now },
      });

      return tx.fiscal_rule_sets.update({
        where: { id: existing.id },
        data: { status: 'active', effective_to: null },
      });
    });
  }

  /** Archives a rule set (draft or active) setting `effective_to = now`. */
  async archiveRuleSet(id: number) {
    const organization_id = this.requireOrganizationId();
    const existing = await this.findOwnedRuleSet(id, organization_id);

    if (existing.status === 'archived') {
      throw new BadRequestException('Fiscal rule set is already archived');
    }

    return this.prisma.fiscal_rule_sets.update({
      where: { id: existing.id },
      data: { status: 'archived', effective_to: new Date() },
    });
  }

  private requireOrganizationId(): number {
    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) {
      throw new BadRequestException('Organization fiscal context is required');
    }
    return organization_id;
  }

  /**
   * Tenant ownership guard: only rows belonging to the caller's organization
   * are mutable. Global rows (organization_id = null, Vendix defaults) are
   * intentionally out of reach.
   */
  private async findOwnedRuleSet(id: number, organization_id: number) {
    const ruleSet = await this.prisma.fiscal_rule_sets.findFirst({
      where: { id, organization_id },
    });
    if (!ruleSet) {
      throw new NotFoundException('Fiscal rule set not found');
    }
    return ruleSet;
  }

  private assertRulesPayload(rules: unknown): void {
    if (
      !rules ||
      typeof rules !== 'object' ||
      Array.isArray(rules) ||
      Object.keys(rules as Record<string, unknown>).length === 0
    ) {
      throw new BadRequestException('rules must be a non-empty JSON object');
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    if ((error as { code?: string })?.code === 'P2002') {
      return new BadRequestException(
        'A fiscal rule set already exists for this scope, year, rule_type and version',
      );
    }
    return error;
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
        rule_type: 'income_tax',
        status: 'active',
        name: `Renta personas jurídicas ${year}`,
        version: `${year}.fallback`,
        rules: {
          general_rate_percent: 35,
          legal_basis: 'Art. 240 ET (Ley 2277 de 2022)',
          disclaimer:
            'Estimación de precierre. No constituye declaración formal (formulario 110).',
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
