import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { parseDateRange } from '../utils/date.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { Prisma } from '@prisma/client';

@Injectable()
export class PurchasesAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getPurchasesSummary(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const { startDate, endDate } = parseDateRange(query);

    const purchaseOrders = await this.prisma.purchase_orders.findMany({
      where: {
        organization_id: organizationId,
        suppliers: {
          store_suppliers: {
            some: { store_id: storeId },
          },
        },
        order_date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        purchase_order_items: true,
        payments: true,
      },
    });

    const totalOrders = purchaseOrders.length;
    const totalSpent = purchaseOrders.reduce(
      (sum, po) => sum + Number(po.total_amount || 0),
      0,
    );
    const pendingOrders = purchaseOrders.filter(
      (po) =>
        po.status === 'draft' ||
        po.status === 'sent' ||
        po.status === 'confirmed',
    ).length;
    const completedOrders = purchaseOrders.filter(
      (po) => po.status === 'completed' || po.status === 'received',
    ).length;
    const totalItemsOrdered = purchaseOrders.reduce(
      (sum, po) =>
        sum +
        po.purchase_order_items.reduce((s, item) => s + item.quantity_ordered, 0),
      0,
    );
    const totalItemsReceived = purchaseOrders.reduce(
      (sum, po) =>
        sum +
        po.purchase_order_items.reduce((s, item) => s + item.quantity_received, 0),
      0,
    );
    const totalTaxAmount = purchaseOrders.reduce(
      (sum, po) => sum + Number(po.tax_amount || 0),
      0,
    );

    return {
      total_orders: totalOrders,
      total_spent: totalSpent,
      pending_orders: pendingOrders,
      completed_orders: completedOrders,
      total_items_ordered: totalItemsOrdered,
      total_items_received: totalItemsReceived,
      total_tax_amount: totalTaxAmount,
      average_order_value: totalOrders > 0 ? totalSpent / totalOrders : 0,
    };
  }

  async getPurchasesBySupplier(
    query: AnalyticsQueryDto & { page?: number; limit?: number },
  ) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const { startDate, endDate } = parseDateRange(query);

    const supplierStats = await this.prisma.$queryRaw<
      Array<{
        supplier_id: number;
        supplier_name: string;
        order_count: bigint;
        total_spent: Prisma.Decimal;
        pending_orders: bigint;
        last_order_date: Date;
      }>
    >`
      SELECT
        s.id as supplier_id,
        s.name as supplier_name,
        COUNT(po.id) as order_count,
        COALESCE(SUM(po.total_amount), 0) as total_spent,
        COUNT(CASE WHEN po.status IN ('draft', 'sent', 'confirmed') THEN 1 END) as pending_orders,
        MAX(po.order_date) as last_order_date
      FROM suppliers s
      INNER JOIN store_suppliers ss ON ss.supplier_id = s.id AND ss.store_id = ${storeId}
      LEFT JOIN purchase_orders po ON po.supplier_id = s.id
        AND po.organization_id = ${organizationId}
        AND po.order_date >= ${startDate}
        AND po.order_date <= ${endDate}
      GROUP BY s.id, s.name
      ORDER BY total_spent DESC
    `;

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const total = supplierStats.length;
      const paginatedData = supplierStats.slice((page - 1) * limit, page * limit);

      const mapped = paginatedData.map((s) => ({
        supplier_id: s.supplier_id,
        supplier_name: s.supplier_name,
        order_count: Number(s.order_count),
        total_spent: Number(s.total_spent),
        pending_orders: Number(s.pending_orders),
        last_order_date: s.last_order_date?.toISOString() || null,
      }));

      return {
        data: mapped,
        meta: {
          pagination: {
            total,
            page,
            limit,
            total_pages: Math.ceil(total / limit),
          },
        },
      };
    }

    return supplierStats.map((s) => ({
      supplier_id: s.supplier_id,
      supplier_name: s.supplier_name,
      order_count: Number(s.order_count),
      total_spent: Number(s.total_spent),
      pending_orders: Number(s.pending_orders),
      last_order_date: s.last_order_date?.toISOString() || null,
    }));
  }
}