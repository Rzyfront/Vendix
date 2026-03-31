import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { UpdateCommissionRuleDto } from './dto/update-commission-rule.dto';
import {
  CommissionRuleQueryDto,
  CommissionCalculationQueryDto,
} from './dto/commission-query.dto';

@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  // ─── LIST RULES ────────────────────────────────────────────
  async findAllRules(query: CommissionRuleQueryDto) {
    const {
      page = 1,
      limit = 20,
      rule_type,
      is_active,
      date_from,
      date_to,
      search,
    } = query;

    const where: any = {};

    if (rule_type) where.rule_type = rule_type;
    if (is_active !== undefined) where.is_active = is_active;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = new Date(date_from);
      if (date_to) where.created_at.lte = new Date(date_to);
    }

    const [data, total] = await Promise.all([
      this.prisma.commission_rules.findMany({
        where,
        include: {
          _count: { select: { commission_calculations: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
      }),
      this.prisma.commission_rules.count({ where }),
    ]);

    return {
      data: data.map((rule) => ({
        ...rule,
        value: rule.value ? Number(rule.value) : null,
        calculations_count: rule._count.commission_calculations,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── DETAIL ────────────────────────────────────────────────
  async findOneRule(id: number) {
    const rule = await this.prisma.commission_rules.findFirst({
      where: { id },
      include: {
        commission_calculations: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        _count: { select: { commission_calculations: true } },
      },
    });

    if (!rule) {
      throw new NotFoundException(`Regla de comisión #${id} no encontrada`);
    }

    return {
      ...rule,
      value: rule.value ? Number(rule.value) : null,
      commission_calculations: rule.commission_calculations.map((calc) => ({
        ...calc,
        base_amount: Number(calc.base_amount),
        commission_amount: Number(calc.commission_amount),
      })),
      calculations_count: rule._count.commission_calculations,
    };
  }

  // ─── CREATE ────────────────────────────────────────────────
  async createRule(dto: CreateCommissionRuleDto) {
    const rule = await this.prisma.commission_rules.create({
      data: {
        name: dto.name,
        description: dto.description || null,
        rule_type: dto.rule_type,
        conditions: dto.conditions,
        commission_type: dto.commission_type,
        value: dto.value ?? null,
        tiers: dto.tiers || null,
        is_active: dto.is_active ?? true,
        priority: dto.priority ?? 0,
        valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
        valid_to: dto.valid_to ? new Date(dto.valid_to) : null,
      },
    });

    return {
      ...rule,
      value: rule.value ? Number(rule.value) : null,
    };
  }

  // ─── UPDATE ────────────────────────────────────────────────
  async updateRule(id: number, dto: UpdateCommissionRuleDto) {
    const existing = await this.prisma.commission_rules.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Regla de comisión #${id} no encontrada`);
    }

    const data: any = { updated_at: new Date() };

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.rule_type !== undefined) data.rule_type = dto.rule_type;
    if (dto.conditions !== undefined) data.conditions = dto.conditions;
    if (dto.commission_type !== undefined)
      data.commission_type = dto.commission_type;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.tiers !== undefined) data.tiers = dto.tiers;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.valid_from !== undefined)
      data.valid_from = dto.valid_from ? new Date(dto.valid_from) : null;
    if (dto.valid_to !== undefined)
      data.valid_to = dto.valid_to ? new Date(dto.valid_to) : null;

    const rule = await this.prisma.commission_rules.update({
      where: { id },
      data,
    });

    return {
      ...rule,
      value: rule.value ? Number(rule.value) : null,
    };
  }

  // ─── DELETE (SOFT) ─────────────────────────────────────────
  async deleteRule(id: number) {
    const existing = await this.prisma.commission_rules.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Regla de comisión #${id} no encontrada`);
    }

    return this.prisma.commission_rules.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });
  }

  // ─── CALCULATIONS (HISTORY) ────────────────────────────────
  async getCalculations(query: CommissionCalculationQueryDto) {
    const {
      page = 1,
      limit = 20,
      source_type,
      commission_rule_id,
      date_from,
      date_to,
    } = query;

    const where: any = {};

    if (source_type) where.source_type = source_type;
    if (commission_rule_id) where.commission_rule_id = commission_rule_id;

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = new Date(date_from);
      if (date_to) where.created_at.lte = new Date(date_to);
    }

    const [data, total] = await Promise.all([
      this.prisma.commission_calculations.findMany({
        where,
        include: {
          commission_rule: {
            select: { id: true, name: true, rule_type: true, commission_type: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.commission_calculations.count({ where }),
    ]);

    return {
      data: data.map((calc) => ({
        ...calc,
        base_amount: Number(calc.base_amount),
        commission_amount: Number(calc.commission_amount),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── REPORT ────────────────────────────────────────────────
  async getCommissionReport() {
    const now = new Date();
    const start_of_month = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total_month, by_rule, recent] = await Promise.all([
      // Total commissions this month
      this.prisma.commission_calculations.aggregate({
        where: { created_at: { gte: start_of_month } },
        _sum: { commission_amount: true, base_amount: true },
        _count: true,
      }),
      // Group by rule
      this.prisma.commission_calculations.groupBy({
        by: ['commission_rule_id'],
        where: { created_at: { gte: start_of_month } },
        _sum: { commission_amount: true, base_amount: true },
        _count: true,
      }),
      // Recent calculations
      this.prisma.commission_calculations.findMany({
        where: { created_at: { gte: start_of_month } },
        include: {
          commission_rule: {
            select: { id: true, name: true, rule_type: true },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ]);

    // Enrich by_rule with rule names
    const rule_ids = by_rule.map((r) => r.commission_rule_id);
    const rules =
      rule_ids.length > 0
        ? await this.prisma.commission_rules.findMany({
            where: { id: { in: rule_ids } },
            select: { id: true, name: true, rule_type: true, commission_type: true },
          })
        : [];

    const rules_map = new Map(rules.map((r) => [r.id, r]));

    return {
      total_month: {
        commission_amount: Number(total_month._sum.commission_amount || 0),
        base_amount: Number(total_month._sum.base_amount || 0),
        count: total_month._count,
      },
      by_rule: by_rule.map((r) => ({
        rule: rules_map.get(r.commission_rule_id) || {
          id: r.commission_rule_id,
          name: 'Desconocida',
        },
        commission_amount: Number(r._sum.commission_amount || 0),
        base_amount: Number(r._sum.base_amount || 0),
        count: r._count,
      })),
      recent: recent.map((calc) => ({
        ...calc,
        base_amount: Number(calc.base_amount),
        commission_amount: Number(calc.commission_amount),
      })),
    };
  }
}
