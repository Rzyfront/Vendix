import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { UpdateBudgetLinesDto } from './dto/update-budget-lines.dto';
import { QueryBudgetDto } from './dto/query-budget.dto';

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryBudgetDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.budgetsWhereInput = {
      ...(query.fiscal_period_id && {
        fiscal_period_id: query.fiscal_period_id,
      }),
      ...(query.status && { status: query.status as any }),
      // store_id filter dropped (phase3-round2): StorePrismaService auto-scopes.
    };

    const [data, total] = await Promise.all([
      this.prisma.budgets.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          fiscal_period: {
            select: { id: true, name: true, start_date: true, end_date: true },
          },
          store: { select: { id: true, name: true } },
          created_by: {
            select: { id: true, first_name: true, last_name: true },
          },
          approved_by: {
            select: { id: true, first_name: true, last_name: true },
          },
          _count: { select: { budget_lines: true } },
        },
      }),
      this.prisma.budgets.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const budget = await this.prisma.budgets.findFirst({
      where: { id },
      include: {
        fiscal_period: {
          select: { id: true, name: true, start_date: true, end_date: true },
        },
        store: { select: { id: true, name: true } },
        created_by: {
          select: { id: true, first_name: true, last_name: true },
        },
        approved_by: {
          select: { id: true, first_name: true, last_name: true },
        },
        budget_lines: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                account_type: true,
                nature: true,
              },
            },
          },
          orderBy: { account: { code: 'asc' } },
        },
      },
    });

    if (!budget) {
      throw new VendixHttpException(ErrorCodes.BUDGET_NOT_FOUND);
    }

    return budget;
  }

  async create(dto: CreateBudgetDto) {
    const context = this.getContext();

    // Validate fiscal period exists
    const fiscal_period = await this.prisma.fiscal_periods.findFirst({
      where: { id: dto.fiscal_period_id },
    });

    if (!fiscal_period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    return this.prisma.budgets.create({
      data: {
        organization_id: context.organization_id,
        fiscal_period_id: dto.fiscal_period_id,
        name: dto.name,
        description: dto.description,
        variance_threshold: dto.variance_threshold,
        store_id: dto.store_id,
        created_by_user_id: context.user_id,
        status: 'draft',
      },
      include: {
        fiscal_period: {
          select: { id: true, name: true, start_date: true, end_date: true },
        },
        store: { select: { id: true, name: true } },
        created_by: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }

  async update(id: number, dto: UpdateBudgetDto) {
    const budget = await this.findOne(id);

    if (budget.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.BUDGET_NOT_DRAFT);
    }

    return this.prisma.budgets.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.variance_threshold !== undefined && {
          variance_threshold: dto.variance_threshold,
        }),
        updated_at: new Date(),
      },
      include: {
        fiscal_period: {
          select: { id: true, name: true, start_date: true, end_date: true },
        },
        store: { select: { id: true, name: true } },
      },
    });
  }

  async updateLines(id: number, dto: UpdateBudgetLinesDto) {
    const budget = await this.findOne(id);

    if (budget.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.BUDGET_NOT_DRAFT);
    }

    // Batch upsert all lines in a transaction
    const operations = dto.lines.map((line) => {
      const total_budgeted =
        line.month_01 +
        line.month_02 +
        line.month_03 +
        line.month_04 +
        line.month_05 +
        line.month_06 +
        line.month_07 +
        line.month_08 +
        line.month_09 +
        line.month_10 +
        line.month_11 +
        line.month_12;

      return this.prisma.budget_lines.upsert({
        where: {
          budget_id_account_id: {
            budget_id: id,
            account_id: line.account_id,
          },
        },
        create: {
          budget_id: id,
          account_id: line.account_id,
          month_01: line.month_01,
          month_02: line.month_02,
          month_03: line.month_03,
          month_04: line.month_04,
          month_05: line.month_05,
          month_06: line.month_06,
          month_07: line.month_07,
          month_08: line.month_08,
          month_09: line.month_09,
          month_10: line.month_10,
          month_11: line.month_11,
          month_12: line.month_12,
          total_budgeted,
        },
        update: {
          month_01: line.month_01,
          month_02: line.month_02,
          month_03: line.month_03,
          month_04: line.month_04,
          month_05: line.month_05,
          month_06: line.month_06,
          month_07: line.month_07,
          month_08: line.month_08,
          month_09: line.month_09,
          month_10: line.month_10,
          month_11: line.month_11,
          month_12: line.month_12,
          total_budgeted,
          updated_at: new Date(),
        },
      });
    });

    await this.prisma.$transaction(operations);

    return this.findOne(id);
  }

  async approve(id: number) {
    const budget = await this.findOne(id);
    const context = this.getContext();

    if (budget.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.BUDGET_CANNOT_APPROVE);
    }

    return this.prisma.budgets.update({
      where: { id },
      data: {
        status: 'approved',
        approved_by_user_id: context.user_id,
        approved_at: new Date(),
        updated_at: new Date(),
      },
      include: {
        fiscal_period: {
          select: { id: true, name: true, start_date: true, end_date: true },
        },
        approved_by: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }

  async activate(id: number) {
    const budget = await this.findOne(id);
    const context = this.getContext();

    if (budget.status !== 'approved') {
      throw new VendixHttpException(ErrorCodes.BUDGET_CANNOT_ACTIVATE);
    }

    // Validate no other active budget for same org + store + period
    const existing_active = await this.prisma.budgets.findFirst({
      where: {
        fiscal_period_id: budget.fiscal_period_id,
        store_id: budget.store_id,
        status: 'active',
        id: { not: id },
      },
    });

    if (existing_active) {
      throw new VendixHttpException(ErrorCodes.BUDGET_ALREADY_ACTIVE);
    }

    return this.prisma.budgets.update({
      where: { id },
      data: {
        status: 'active',
        updated_at: new Date(),
      },
      include: {
        fiscal_period: {
          select: { id: true, name: true, start_date: true, end_date: true },
        },
        store: { select: { id: true, name: true } },
      },
    });
  }

  async close(id: number) {
    const budget = await this.findOne(id);

    if (budget.status !== 'active') {
      throw new VendixHttpException(ErrorCodes.BUDGET_CANNOT_CLOSE);
    }

    return this.prisma.budgets.update({
      where: { id },
      data: {
        status: 'closed',
        updated_at: new Date(),
      },
      include: {
        fiscal_period: {
          select: { id: true, name: true, start_date: true, end_date: true },
        },
      },
    });
  }

  async remove(id: number) {
    const budget = await this.findOne(id);

    if (budget.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.BUDGET_NOT_DRAFT);
    }

    // Cascade delete is handled by Prisma (onDelete: Cascade on budget_lines)
    await this.prisma.budgets.delete({
      where: { id },
    });
  }

  async duplicate(id: number, new_fiscal_period_id: number) {
    const budget = await this.findOne(id);
    const context = this.getContext();

    // Validate new fiscal period
    const fiscal_period = await this.prisma.fiscal_periods.findFirst({
      where: { id: new_fiscal_period_id },
    });

    if (!fiscal_period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    // Create new budget header
    const new_budget = await this.prisma.budgets.create({
      data: {
        organization_id: context.organization_id,
        fiscal_period_id: new_fiscal_period_id,
        name: `${budget.name} (Copy)`,
        description: budget.description,
        variance_threshold: budget.variance_threshold
          ? Number(budget.variance_threshold)
          : undefined,
        store_id: budget.store_id,
        created_by_user_id: context.user_id,
        status: 'draft',
      },
    });

    // Copy lines
    if (budget.budget_lines && budget.budget_lines.length > 0) {
      const line_data = budget.budget_lines.map((line: any) => ({
        budget_id: new_budget.id,
        account_id: line.account_id,
        month_01: line.month_01,
        month_02: line.month_02,
        month_03: line.month_03,
        month_04: line.month_04,
        month_05: line.month_05,
        month_06: line.month_06,
        month_07: line.month_07,
        month_08: line.month_08,
        month_09: line.month_09,
        month_10: line.month_10,
        month_11: line.month_11,
        month_12: line.month_12,
        total_budgeted: line.total_budgeted,
      }));

      await this.prisma.budget_lines.createMany({ data: line_data });
    }

    return this.findOne(new_budget.id);
  }
}
