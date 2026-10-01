import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;
const MAX_PAGE = 1000;
const MAX_EXPENSE_ITEMS = 200;
const ALLOWED_STATES = ['pending', 'approved', 'paid'] as const;
const MANUAL_IDENTITY_WARNING = 'MANUAL_SUPPLIER_IDENTITY_UNVERIFIED';

@Injectable()
export class ReceivedDocumentMatchExpensesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly documents: ReceivedDocumentsService,
  ) {}

  async list(
    ctx: ReceivedDocumentsContext,
    documentId: number,
    query: { search?: string; limit?: number; page?: number } = {},
  ): Promise<{
    data: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    warnings: string[];
  }> {
    this.assertPositiveId(documentId, 'document_id');
    const limit = this.positiveBoundedInteger(query.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT);
    const page = this.positiveBoundedInteger(query.page, 'page', 1, MAX_PAGE);
    const search = this.normalizeSearch(query.search);
    await this.documents.assertContext(ctx);

    const document = await this.prisma.received_documents.findFirst({
      where: {
        id: documentId,
        organization_id: ctx.organization_id,
        accounting_entity_id: ctx.accounting_entity_id,
        ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}),
      },
      select: { id: true, store_id: true, currency: true },
    });
    if (!document) throw new NotFoundException('Documento recibido no encontrado.');

    const warnings = [MANUAL_IDENTITY_WARNING];
    const rawCurrency = typeof document.currency === 'string' ? document.currency.trim() : '';
    const currency = rawCurrency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      warnings.push('DOCUMENT_CURRENCY_INVALID');
      return { data: [], total: 0, page, limit, warnings };
    }

    const scopedStoreId = ctx.store_id ?? document.store_id;
    const where = {
      organization_id: ctx.organization_id,
      state: { in: [...ALLOWED_STATES] },
      currency: { equals: currency, mode: 'insensitive' as const },
      ...(scopedStoreId != null ? { store_id: scopedStoreId } : {}),
      ...(search ? this.searchWhere(search) : {}),
    };
    const [expenses, total] = await Promise.all([
      this.prisma.expenses.findMany({
        where,
        orderBy: [{ expense_date: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          store_id: true,
          description: true,
          expense_date: true,
          state: true,
          amount: true,
          currency: true,
          expense_items: {
            orderBy: [{ line_index: 'asc' }, { id: 'asc' }],
            take: MAX_EXPENSE_ITEMS + 1,
            select: { id: true, description: true, quantity: true, unit_price: true, amount: true },
          },
        },
      }),
      this.prisma.expenses.count({ where }),
    ]);

    if (expenses.length === 0) return { data: [], total, page, limit, warnings };

    const expenseIds = expenses.map((expense) => expense.id);
    const allocationGroups = await this.prisma.received_document_match_allocations.groupBy({
      by: ['expense_id', 'expense_item_id'],
      where: {
        organization_id: ctx.organization_id,
        expense_id: { in: expenseIds },
        status: 'active',
      },
      _sum: { allocated_net_amount: true },
    });
    const allocatedByExpense = new Map<number, Prisma.Decimal>();
    const allocatedByItem = new Map<number, Prisma.Decimal>();
    for (const group of allocationGroups) {
      if (group.expense_id == null) continue;
      const amount = group._sum.allocated_net_amount ?? new Prisma.Decimal(0);
      allocatedByExpense.set(
        group.expense_id,
        (allocatedByExpense.get(group.expense_id) ?? new Prisma.Decimal(0)).plus(amount),
      );
      if (group.expense_item_id != null) {
        allocatedByItem.set(
          group.expense_item_id,
          (allocatedByItem.get(group.expense_item_id) ?? new Prisma.Decimal(0)).plus(amount),
        );
      }
    }

    const data = expenses.map((expense) => {
      const allocated = allocatedByExpense.get(expense.id) ?? new Prisma.Decimal(0);
      const amount = new Prisma.Decimal(expense.amount);
      if (allocated.gt(amount)) warnings.push('EXPENSE_OVERALLOCATED');
      if (expense.expense_items.length > MAX_EXPENSE_ITEMS) warnings.push('EXPENSE_ITEMS_LIMIT_REACHED');
      return {
        id: expense.id,
        store_id: expense.store_id,
        description: expense.description,
        expense_date: expense.expense_date.toISOString(),
        state: expense.state,
        amount: amount.toFixed(2),
        currency: expense.currency,
        allocated_net_amount: allocated.toFixed(2),
        remaining_net_amount: Prisma.Decimal.max(amount.minus(allocated), new Prisma.Decimal(0)).toFixed(2),
        items: expense.expense_items.slice(0, MAX_EXPENSE_ITEMS).map((item) => {
          const itemAllocated = allocatedByItem.get(item.id) ?? new Prisma.Decimal(0);
          const itemAmount = new Prisma.Decimal(item.amount);
          if (itemAllocated.gt(itemAmount)) warnings.push('EXPENSE_ITEM_OVERALLOCATED');
          return {
            id: item.id,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity).toString(),
            unit_price: new Prisma.Decimal(item.unit_price).toFixed(2),
            amount: itemAmount.toFixed(2),
            allocated_net_amount: itemAllocated.toFixed(2),
            remaining_net_amount: Prisma.Decimal.max(itemAmount.minus(itemAllocated), new Prisma.Decimal(0)).toFixed(2),
          };
        }),
      };
    });

    return { data, total, page, limit, warnings: [...new Set(warnings)] };
  }

  private searchWhere(search: string): { OR: Array<Record<string, unknown>> } {
    if (/^\d+$/.test(search)) {
      const id = Number(search);
      if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
        throw new BadRequestException('El ID de gasto buscado está fuera del rango permitido.');
      }
      return { OR: [{ id }] };
    }
    return {
      OR: [
        { description: { contains: search, mode: 'insensitive' } },
        { expense_items: { some: { description: { contains: search, mode: 'insensitive' } } } },
      ],
    };
  }

  private normalizeSearch(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new BadRequestException('search debe ser texto.');
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length < 1 || normalized.length > 100) {
      throw new BadRequestException('search debe tener entre 1 y 100 caracteres.');
    }
    return normalized;
  }

  private positiveBoundedInteger(value: number | undefined, field: string, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new BadRequestException(`${field} debe ser un entero entre 1 y ${max}.`);
    }
    return value;
  }

  private assertPositiveId(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
      throw new BadRequestException(`${field} debe ser un entero positivo válido.`);
    }
  }
}
