import { Injectable, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../../analytics/dto/analytics-query.dto';
import { parseDateRange } from '../../analytics/utils/date.util';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { RECOGNIZED_EXPENSE_STATES } from '../../analytics/analytics-metrics.contract';

/**
 * QUI-544: agregaciones de gastos del período.
 *
 * `state` ∈ RECOGNIZED_EXPENSE_STATES = ['approved', 'paid']. El estado
 * `pending` NO cuenta (es un borrador pendiente de aprobación que aún no
 * es un gasto real del período).
 *
 * El campo `expense_date` es DateTime (instante), no business-date a
 * medianoche — usamos `parseDateRange` que respeta la TZ de la tienda.
 */
@Injectable()
export class ExpensesAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Resumen agregado por período: total, count, promedio, distribución
   * por estado. Una sola fila con los totales del período (no es time
   * series).
   */
  async getExpensesSummaryForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new ForbiddenException('Store context required');
    }
    const storeId = context.store_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    const expenses = await this.prisma.expenses.findMany({
      where: {
        store_id: storeId,
        expense_date: { gte: startDate, lte: endDate },
      },
      select: {
        amount: true,
        state: true,
        expense_date: true,
      },
    });

    const totalExpenses = expenses.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0,
    );
    const recognizedExpenses = expenses.filter((e) =>
      RECOGNIZED_EXPENSE_STATES.includes(e.state as any),
    );
    const totalRecognized = recognizedExpenses.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0,
    );
    const totalPending = expenses
      .filter((e) => e.state === 'pending')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return [
      {
        period_start: startDate,
        period_end: endDate,
        total_expenses: Math.round(totalExpenses * 100) / 100,
        total_recognized: Math.round(totalRecognized * 100) / 100,
        total_pending: Math.round(totalPending * 100) / 100,
        total_count: expenses.length,
        recognized_count: recognizedExpenses.length,
        pending_count: expenses.filter((e) => e.state === 'pending').length,
        average_expense:
          expenses.length > 0
            ? Math.round((totalExpenses / expenses.length) * 100) / 100
            : 0,
      },
    ];
  }

  /**
   * Desglose por categoría de gasto. Una fila por categoría con
   * total, count, promedio y % de participación.
   */
  async getExpensesByCategoryForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new ForbiddenException('Store context required');
    }
    const storeId = context.store_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    const expenses = await this.prisma.expenses.findMany({
      where: {
        store_id: storeId,
        expense_date: { gte: startDate, lte: endDate },
      },
      select: {
        amount: true,
        state: true,
        category_id: true,
        expense_categories: { select: { name: true } },
      },
    });

    const recognized = expenses.filter((e) =>
      RECOGNIZED_EXPENSE_STATES.includes(e.state as any),
    );

    const total = recognized.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0,
    );

    const buckets = new Map<
      number | null,
      {
        category_id: number | null;
        category_name: string;
        total_amount: number;
        expense_count: number;
      }
    >();

    for (const e of recognized) {
      const key = e.category_id ?? null;
      const bucket = buckets.get(key) ?? {
        category_id: key,
        category_name: e.expense_categories?.name ?? 'Sin categoría',
        total_amount: 0,
        expense_count: 0,
      };
      bucket.total_amount += Number(e.amount || 0);
      bucket.expense_count += 1;
      buckets.set(key, bucket);
    }

    return Array.from(buckets.values())
      .map((b) => ({
        category_id: b.category_id,
        category_name: b.category_name,
        total_amount: Math.round(b.total_amount * 100) / 100,
        expense_count: b.expense_count,
        percentage:
          total > 0
            ? Math.round((b.total_amount / total) * 10000) / 100
            : 0,
        average_expense:
          b.expense_count > 0
            ? Math.round((b.total_amount / b.expense_count) * 100) / 100
            : 0,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);
  }

  /**
   * Detalle crudo de gastos para el export XLSX. Filas crudas con
   * Date, número y string — el emitter las formatea con TZ de la tienda.
   * Filtra por RECOGNIZED_EXPENSE_STATES por defecto (se puede
   * desactivar pasando `include_pending: true` en el query en el futuro).
   */
  async getExpensesDetailForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new ForbiddenException('Store context required');
    }
    const storeId = context.store_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    const expenses = await this.prisma.expenses.findMany({
      where: {
        store_id: storeId,
        expense_date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        description: true,
        expense_date: true,
        state: true,
        receipt_url: true,
        notes: true,
        expense_categories: { select: { name: true } },
        created_by_user: { select: { first_name: true, last_name: true } },
        approved_by_user: { select: { first_name: true, last_name: true } },
      },
      orderBy: { expense_date: 'desc' },
      take: 10000,
    });

    return expenses.map((e) => ({
      id: e.id,
      expense_date: e.expense_date,
      category_name: e.expense_categories?.name ?? 'Sin categoría',
      description: e.description ?? '',
      amount: Math.round(Number(e.amount || 0) * 100) / 100,
      currency: e.currency ?? 'COP',
      state: e.state,
      is_recognized: RECOGNIZED_EXPENSE_STATES.includes(e.state as any),
      created_by:
        e.created_by_user
          ? `${e.created_by_user.first_name} ${e.created_by_user.last_name}`.trim()
          : '',
      approved_by:
        e.approved_by_user
          ? `${e.approved_by_user.first_name} ${e.approved_by_user.last_name}`.trim()
          : '',
      receipt_url: e.receipt_url,
      notes: e.notes,
    }));
  }
}
