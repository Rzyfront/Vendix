import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: StorePrismaService) { }

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryExpenseDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      state,
      category_id,
      date_from,
      date_to,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.expensesWhereInput = {
      ...(search && {
        OR: [
          { description: { contains: search, mode: 'insensitive' as const } },
          { notes: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(state && { state: state as any }),
      ...(category_id && { category_id }),
      ...(date_from && {
        expense_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.expenses.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          expense_categories: {
            select: { id: true, name: true, color: true },
          },
          created_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
          approved_by_user: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      }),
      this.prisma.expenses.count({ where }),
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
    const expense = await this.prisma.expenses.findFirst({
      where: { id },
      include: {
        expense_categories: true,
        created_by_user: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
        approved_by_user: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    return expense;
  }

  async create(createExpenseDto: CreateExpenseDto) {
    const { category_id, ...data } = createExpenseDto;
    const context = this.getContext();

    if (category_id) {
      const category = await this.prisma.expense_categories.findFirst({
        where: {
          id: category_id,
          ...this.prisma.organizationWhere,
        },
      });

      if (!category) {
        throw new NotFoundException('Expense category not found');
      }
    }

    const expense = await this.prisma.expenses.create({
      data: {
        ...data,
        amount: new Prisma.Decimal(data.amount),
        store_id: context.store_id,
        organization_id: context.organization_id,
        category_id,
        created_by_user_id: context.user_id,
        expense_date: new Date(createExpenseDto.expense_date),
      },
      include: {
        expense_categories: true,
        created_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });

    return expense;
  }

  async update(id: number, updateExpenseDto: UpdateExpenseDto) {
    const expense = await this.findOne(id);

    // Only allow editing expenses in pending state
    if (expense.state !== 'pending') {
      throw new ConflictException(
        `Cannot edit expense in '${expense.state}' state. Only pending expenses can be edited.`,
      );
    }

    const { category_id, ...data } = updateExpenseDto;

    if (category_id) {
      const category = await this.prisma.expense_categories.findFirst({
        where: {
          id: category_id,
          ...this.prisma.organizationWhere,
        },
      });

      if (!category) {
        throw new NotFoundException('Expense category not found');
      }
    }

    const updated = await this.prisma.expenses.update({
      where: { id },
      data: {
        ...data,
        ...(data.amount && { amount: new Prisma.Decimal(data.amount) }),
        ...(category_id && { category_id }),
        ...(data.expense_date && { expense_date: new Date(data.expense_date) }),
      },
      include: {
        expense_categories: true,
        created_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        approved_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });

    return updated;
  }

  async approve(id: number) {
    const expense = await this.findOne(id);
    const context = this.getContext();

    if (expense.state !== 'pending') {
      throw new ConflictException('Expense can only be approved when pending');
    }

    return this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'approved',
        approved_by_user_id: context.user_id,
        approved_at: new Date(),
      },
      include: {
        expense_categories: true,
        created_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        approved_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }

  async reject(id: number) {
    const expense = await this.findOne(id);
    const context = this.getContext();

    if (expense.state !== 'pending') {
      throw new ConflictException('Expense can only be rejected when pending');
    }

    // Fix: reject should NOT set approved_at (semantically incorrect)
    return this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'rejected',
        approved_by_user_id: context.user_id,
      },
      include: {
        expense_categories: true,
        created_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        approved_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }

  async remove(id: number) {
    const expense = await this.findOne(id);

    // Only allow deleting expenses in pending or rejected state
    if (!['pending', 'rejected'].includes(expense.state)) {
      throw new ConflictException(
        `Cannot delete expense in '${expense.state}' state. Only pending or rejected expenses can be deleted. Use cancel instead.`,
      );
    }

    await this.prisma.expenses.delete({
      where: { id },
    });
  }

  async getExpensesSummary(dateFrom?: Date, dateTo?: Date) {
    const where: Prisma.expensesWhereInput = {
      ...(dateFrom &&
        dateTo && {
        expense_date: {
          gte: dateFrom,
          lte: dateTo,
        },
      }),
    };

    // Aggregate totals for approved+paid expenses
    const approvedPaidWhere: Prisma.expensesWhereInput = {
      ...where,
      state: { in: ['approved', 'paid'] },
    };

    const [summary, expensesByCategory, countsByState] = await Promise.all([
      this.prisma.expenses.aggregate({
        where: approvedPaidWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.expenses.groupBy({
        by: ['category_id'],
        where: approvedPaidWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
      // Count by state (all states, for dashboard cards)
      this.prisma.expenses.groupBy({
        by: ['state'],
        where,
        _count: { id: true },
      }),
    ]);

    const context = this.getContext();

    const categories = await this.prisma.expense_categories.findMany({
      where: {
        id: {
          in: expensesByCategory
            .map((item) => item.category_id)
            .filter((id): id is number => id !== null),
        },
        organization_id: context.organization_id,
      },
    });

    const categorySummary = expensesByCategory.map((item) => {
      const category = categories.find((cat) => cat.id === item.category_id);
      return {
        category_id: item.category_id,
        category_name: category?.name || 'Uncategorized',
        color: category?.color || '#6b7280',
        total_amount: item._sum.amount || 0,
        count: item._count.id,
      };
    });

    // Build counts_by_state map
    const counts_by_state: Record<string, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      paid: 0,
      cancelled: 0,
    };
    for (const row of countsByState) {
      if (row.state) {
        counts_by_state[row.state] = row._count.id;
      }
    }

    return {
      total_amount: summary._sum.amount || 0,
      total_count: summary._count.id,
      counts_by_state,
      category_breakdown: categorySummary,
    };
  }

  // --- Categories Management ---

  async findAllCategories() {
    return this.prisma.expense_categories.findMany({
      where: this.prisma.organizationWhere,
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(data: any) {
    const context = this.getContext();
    return this.prisma.expense_categories.create({
      data: {
        ...data,
        organization_id: context.organization_id,
      },
    });
  }

  async updateCategory(id: number, data: any) {
    const category = await this.prisma.expense_categories.findFirst({
      where: {
        id,
        ...this.prisma.organizationWhere,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.prisma.expense_categories.update({
      where: { id },
      data,
    });
  }

  async removeCategory(id: number) {
    const category = await this.prisma.expense_categories.findFirst({
      where: {
        id,
        ...this.prisma.organizationWhere,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // Check if used
    const usageCount = await this.prisma.expenses.count({
      where: { category_id: id },
    });

    if (usageCount > 0) {
      throw new ConflictException(
        'Cannot delete category with associated expenses',
      );
    }

    await this.prisma.expense_categories.delete({
      where: { id },
    });
  }
}
