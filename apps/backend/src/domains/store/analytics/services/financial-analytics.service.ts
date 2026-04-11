import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  AnalyticsQueryDto,
  DatePreset,
} from '../dto/analytics-query.dto';

@Injectable()
export class FinancialAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  async getTaxSummary(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    // Aggregate tax from order_item_taxes via order_items -> orders
    const orderItems = await this.prisma.order_items.findMany({
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
      },
      select: {
        id: true,
        total_price: true,
        tax_amount_item: true,
        order_item_taxes: {
          select: {
            tax_name: true,
            tax_rate: true,
            tax_amount: true,
            is_compound: true,
          },
        },
      },
    });

    // Aggregate by tax_name
    const taxBreakdown = new Map<
      string,
      {
        tax_name: string;
        tax_rate: number;
        total_tax: number;
        taxable_amount: number;
        is_compound: boolean;
      }
    >();

    let totalTaxCollected = 0;
    let totalTaxableRevenue = 0;

    for (const item of orderItems) {
      const itemTotal = Number(item.total_price || 0);
      const itemTax = Number(item.tax_amount_item || 0);
      totalTaxCollected += itemTax;
      totalTaxableRevenue += itemTotal;

      for (const tax of item.order_item_taxes) {
        const taxName = tax.tax_name;
        const existing = taxBreakdown.get(taxName) || {
          tax_name: taxName,
          tax_rate: Number(tax.tax_rate || 0),
          total_tax: 0,
          taxable_amount: 0,
          is_compound: tax.is_compound || false,
        };
        existing.total_tax += Number(tax.tax_amount || 0);
        existing.taxable_amount += itemTotal;
        taxBreakdown.set(taxName, existing);
      }
    }

    // Get tax refunds
    const taxRefunds = await this.prisma.refunds.aggregate({
      where: {
        state: { in: ['completed', 'approved'] },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        tax_refund: true,
      },
    });
    const totalTaxRefunded = Number(taxRefunds._sum.tax_refund || 0);

    return {
      total_tax_collected: totalTaxCollected,
      total_tax_refunded: totalTaxRefunded,
      net_tax: totalTaxCollected - totalTaxRefunded,
      total_taxable_revenue: totalTaxableRevenue,
      effective_tax_rate:
        totalTaxableRevenue > 0
          ? Number(((totalTaxCollected / totalTaxableRevenue) * 100).toFixed(2))
          : 0,
      breakdown: Array.from(taxBreakdown.values()).map((b) => ({
        ...b,
        total_tax: Number(b.total_tax.toFixed(2)),
        taxable_amount: Number(b.taxable_amount.toFixed(2)),
      })),
    };
  }

  async getCashSessionsReport(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const page = query.page || 1;
    const limit = query.limit || 20;

    // Count total sessions
    const totalCount = await this.prisma.cash_register_sessions.count({
      where: {
        opened_at: { gte: startDate, lte: endDate },
      },
    });

    // Get sessions with details
    const sessions = await this.prisma.cash_register_sessions.findMany({
      where: {
        opened_at: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        status: true,
        opened_at: true,
        closed_at: true,
        opening_amount: true,
        expected_closing_amount: true,
        actual_closing_amount: true,
        difference: true,
        opened_by: true,
        closed_by: true,
        movements: {
          select: {
            type: true,
            amount: true,
          },
        },
      },
      orderBy: { opened_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Get session-level aggregates
    const aggregates = await this.prisma.cash_register_sessions.aggregate({
      where: {
        opened_at: { gte: startDate, lte: endDate },
        status: 'closed',
      },
      _sum: {
        opening_amount: true,
        expected_closing_amount: true,
        actual_closing_amount: true,
        difference: true,
      },
      _count: {
        id: true,
      },
    });

    // Movement totals across all sessions in range
    const sessionIds = sessions.map((s) => s.id);
    const movementTotals =
      sessionIds.length > 0
        ? await this.prisma.cash_register_movements.groupBy({
            by: ['session_id'],
            where: {
              session_id: { in: sessionIds },
              type: 'sale',
            },
            _sum: {
              amount: true,
            },
          })
        : [];

    const movementMap = new Map<number | null, number>(
      movementTotals.map((m) => [m.session_id, Number(m._sum.amount || 0)]),
    );

    const data = sessions.map((s) => {
      const salesTotal = movementMap.get(s.id) || 0;

      return {
        session_id: s.id,
        status: s.status,
        opened_at: s.opened_at.toISOString(),
        closed_at: s.closed_at ? s.closed_at.toISOString() : null,
        opening_amount: Number(s.opening_amount || 0),
        expected_closing_amount: Number(s.expected_closing_amount || 0),
        actual_closing_amount: Number(s.actual_closing_amount || 0),
        difference: Number(s.difference || 0),
        sales_total: salesTotal,
        total_movements: s.movements.length,
      };
    });

    return {
      data,
      summary: {
        total_sessions: totalCount,
        closed_sessions: aggregates._count.id || 0,
        total_opening_amount: Number(aggregates._sum.opening_amount || 0),
        total_expected: Number(aggregates._sum.expected_closing_amount || 0),
        total_actual: Number(aggregates._sum.actual_closing_amount || 0),
        total_difference: Number(aggregates._sum.difference || 0),
      },
      meta: {
        pagination: {
          total: totalCount,
          page,
          limit,
          total_pages: Math.ceil(totalCount / limit),
        },
      },
    };
  }

  async getProfitLossSummary(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    // Revenue from completed orders
    const orderAggregates = await this.prisma.orders.aggregate({
      where: {
        state: { in: this.COMPLETED_STATES },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        subtotal_amount: true,
        discount_amount: true,
        tax_amount: true,
        shipping_cost: true,
        grand_total: true,
      },
      _count: {
        id: true,
      },
    });

    // Cost of goods sold from order_items
    const cogsResult = await this.prisma.order_items.aggregate({
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
      },
      _sum: {
        cost_price: true,
        quantity: true,
      },
    });

    // Refunds
    const refundAggregates = await this.prisma.refunds.aggregate({
      where: {
        state: { in: ['completed', 'approved'] },
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: {
        amount: true,
        subtotal_refund: true,
        tax_refund: true,
        shipping_refund: true,
      },
    });

    // Operating expenses
    const expenseAggregates = await this.prisma.expenses.aggregate({
      where: {
        state: 'paid',
        expense_date: { gte: startDate, lte: endDate },
      },
      _sum: {
        amount: true,
      },
    });

    const revenue = Number(orderAggregates._sum.subtotal_amount || 0);
    const discounts = Number(orderAggregates._sum.discount_amount || 0);
    const netRevenue = revenue - discounts;
    const totalCOGS = Number(cogsResult._sum.cost_price || 0) * Number(cogsResult._sum.quantity || 0);
    const grossProfit = netRevenue - totalCOGS;
    const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const taxCollected = Number(orderAggregates._sum.tax_amount || 0);
    const shippingRevenue = Number(orderAggregates._sum.shipping_cost || 0);
    const refundAmount = Number(refundAggregates._sum.amount || 0);
    const refundSubtotal = Number(refundAggregates._sum.subtotal_refund || 0);
    const refundTax = Number(refundAggregates._sum.tax_refund || 0);
    const refundShipping = Number(refundAggregates._sum.shipping_refund || 0);
    const operatingExpenses = Number(expenseAggregates._sum.amount || 0);
    const netProfit = grossProfit + shippingRevenue - refundSubtotal - operatingExpenses;
    const netMargin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

    return {
      period: {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      },
      revenue: {
        gross_revenue: revenue,
        discounts,
        net_revenue: netRevenue,
        shipping_revenue: shippingRevenue,
        tax_collected: taxCollected,
      },
      costs: {
        cost_of_goods_sold: totalCOGS,
        gross_profit: grossProfit,
        gross_margin: Number(grossMargin.toFixed(2)),
      },
      refunds: {
        total_refunds: refundAmount,
        subtotal_refunds: refundSubtotal,
        tax_refunds: refundTax,
        shipping_refunds: refundShipping,
      },
      operating_expenses: operatingExpenses,
      bottom_line: {
        net_profit: netProfit,
        net_margin: Number(netMargin.toFixed(2)),
        order_count: orderAggregates._count.id || 0,
      },
    };
  }

  async getTaxSummaryForExport(query: AnalyticsQueryDto) {
    const result = await this.getTaxSummary(query);
    // The breakdown array has per-tax-type details
    const rows = (result.breakdown || []).map((b: any) => ({
      'Tipo de Impuesto': b.tax_name,
      'Tasa (%)': b.tax_rate,
      'Base Gravable': b.taxable_amount,
      'Impuesto Cobrado': b.total_tax,
      'Compuesto': b.is_compound ? 'Sí' : 'No',
    }));
    // Add a summary row at the end
    rows.push({
      'Tipo de Impuesto': 'TOTAL',
      'Tasa (%)': '',
      'Base Gravable': result.total_taxable_revenue,
      'Impuesto Cobrado': result.total_tax_collected,
      'Compuesto': '',
    });
    return rows;
  }

  async getCashSessionsForExport(query: AnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    const sessions = await this.prisma.cash_register_sessions.findMany({
      where: {
        opened_at: { gte: startDate, lte: endDate },
      },
      select: {
        status: true,
        opened_at: true,
        closed_at: true,
        opening_amount: true,
        expected_closing_amount: true,
        actual_closing_amount: true,
        difference: true,
        registers: { select: { name: true } },
        opened_by_user: { select: { first_name: true, last_name: true } },
        closed_by_user: { select: { first_name: true, last_name: true } },
        movements: {
          select: { type: true, amount: true },
        },
      },
      orderBy: { opened_at: 'desc' },
      take: 10000,
    });

    return sessions.map((s) => {
      const salesMovements = s.movements.filter((m) => m.type === 'sale');
      const expenseMovements = s.movements.filter((m) => m.type === 'expense');
      const totalSales = salesMovements.reduce((sum, m) => sum + Number(m.amount || 0), 0);
      const totalExpenses = expenseMovements.reduce((sum, m) => sum + Number(m.amount || 0), 0);

      return {
        'Fecha Apertura': s.opened_at.toISOString().split('T')[0],
        'Caja': (s.registers as any)?.name || '',
        'Cajero Apertura': s.opened_by_user ? `${s.opened_by_user.first_name} ${s.opened_by_user.last_name}` : '',
        'Cajero Cierre': s.closed_by_user ? `${s.closed_by_user.first_name} ${s.closed_by_user.last_name}` : '',
        'Monto Apertura': Number(s.opening_amount || 0),
        'Total Ventas': totalSales,
        'Total Gastos': totalExpenses,
        'Cierre Esperado': Number(s.expected_closing_amount || 0),
        'Cierre Real': Number(s.actual_closing_amount || 0),
        'Diferencia': Number(s.difference || 0),
        'Estado': s.status,
      };
    });
  }

  // Helper methods
  private parseDateRange(query: AnalyticsQueryDto): {
    startDate: Date;
    endDate: Date;
  } {
    if (query.date_from && query.date_to) {
      const endDate = new Date(query.date_to);
      endDate.setUTCHours(23, 59, 59, 999);
      return {
        startDate: new Date(query.date_from),
        endDate,
      };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (query.date_preset) {
      case DatePreset.TODAY:
        return { startDate: today, endDate: now };
      case DatePreset.YESTERDAY:
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { startDate: yesterday, endDate: today };
      case DatePreset.THIS_WEEK:
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return { startDate: weekStart, endDate: now };
      case DatePreset.LAST_WEEK:
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay());
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        return { startDate: lastWeekStart, endDate: lastWeekEnd };
      case DatePreset.LAST_MONTH:
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        const lastMonthStart = new Date(
          today.getFullYear(),
          today.getMonth() - 1,
          1,
        );
        return { startDate: lastMonthStart, endDate: lastMonthEnd };
      case DatePreset.THIS_YEAR:
        return { startDate: new Date(today.getFullYear(), 0, 1), endDate: now };
      case DatePreset.LAST_YEAR:
        return {
          startDate: new Date(today.getFullYear() - 1, 0, 1),
          endDate: new Date(today.getFullYear() - 1, 11, 31),
        };
      case DatePreset.THIS_MONTH:
      default:
        return {
          startDate: new Date(today.getFullYear(), today.getMonth(), 1),
          endDate: now,
        };
    }
  }
}
