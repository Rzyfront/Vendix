import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { parseDateRange } from '../utils/date.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class PurchasesAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly PENDING_STATES = ['draft', 'approved', 'partial'] as const;
  private readonly COMPLETED_STATES = ['received'] as const;

  async getPurchasesSummary(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const { startDate, endDate } = parseDateRange(query);

    const purchaseOrders = await this.prisma.purchase_orders.findMany({
      where: {
        organization_id: organizationId,
        suppliers: {
          store_id: storeId,
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
      (po) => this.PENDING_STATES.includes(po.status as any),
    ).length;
    const completedOrders = purchaseOrders.filter(
      (po) => this.COMPLETED_STATES.includes(po.status as any),
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
    if (!context?.store_id || !context.organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;
    const organizationId = context.organization_id;

    const { startDate, endDate } = parseDateRange(query);

    const suppliers = await this.prisma.suppliers.findMany({
      where: {
        organization_id: organizationId,
        store_id: storeId,
      },
      select: {
        id: true,
        name: true,
        purchase_orders: {
          where: {
            organization_id: organizationId,
            location: { store_id: storeId },
            order_date: {
              gte: startDate,
              lte: endDate,
            },
          },
          select: {
            status: true,
            total_amount: true,
            order_date: true,
          },
        },
      },
    });

    const supplierStats = suppliers
      .map((supplier) => {
        const orders = supplier.purchase_orders;
        const totalSpent = orders.reduce(
          (sum, order) => sum + Number(order.total_amount || 0),
          0,
        );
        const pendingOrders = orders.filter((order) =>
          this.PENDING_STATES.includes(order.status as any),
        ).length;
        let lastOrderDate: Date | null = null;
        for (const order of orders) {
          if (
            order.order_date &&
            (!lastOrderDate || order.order_date > lastOrderDate)
          ) {
            lastOrderDate = order.order_date;
          }
        }

        return {
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          order_count: orders.length,
          total_spent: totalSpent,
          pending_orders: pendingOrders,
          last_order_date: lastOrderDate,
        };
      })
      .sort((a, b) => b.total_spent - a.total_spent);

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const total = supplierStats.length;
      const paginatedData = supplierStats.slice((page - 1) * limit, page * limit);

      const mapped = paginatedData.map((s) => ({
        ...s,
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

    return supplierStats.slice(0, query.limit || supplierStats.length).map((s) => ({
      ...s,
      last_order_date: s.last_order_date?.toISOString() || null,
    }));
  }
}
