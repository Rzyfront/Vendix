import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { OrganizationOrderQueryDto } from './dto/organization-order-query.dto';
import { Prisma } from '@prisma/client';
import { ResponseService } from '@common/responses/response.service';
import { OrderPdfBuilder, OrderPdfData } from './services/order-pdf.builder';

@Injectable()
export class OrganizationOrdersService {
  private readonly logger = new Logger(OrganizationOrdersService.name);

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  private mapPaymentState(state: string): string {
    const stateMap: Record<string, string> = {
      pending: 'pending',
      succeeded: 'paid',
      failed: 'failed',
      authorized: 'pending',
      captured: 'paid',
      refunded: 'refunded',
      partially_refunded: 'partially_refunded',
    };
    return stateMap[state] || 'pending';
  }

  async findAll(query: OrganizationOrderQueryDto) {
    const {
      page = 1,
      limit = 50,
      sort = 'created_at',
      order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.ordersWhereInput = {};

    if (query.store_id) {
      where.store_id = +query.store_id;
    }

    if (query.status) {
      where.state = query.status as any;
    }

    if (query.search) {
      where.OR = [
        { order_number: { contains: query.search, mode: 'insensitive' } },
        { internal_notes: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) {
        where.created_at.gte = new Date(query.date_from);
      }
      if (query.date_to) {
        const endDate = new Date(query.date_to);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    if (query.min_amount || query.max_amount) {
      where.grand_total = {};
      if (query.min_amount) {
        where.grand_total.gte = query.min_amount;
      }
      if (query.max_amount) {
        where.grand_total.lte = query.max_amount;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.orders.findMany({
        where,
        include: {
          stores: {
            select: {
              id: true,
              name: true,
              store_code: true,
            },
          },
          users: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          order_items: {
            select: {
              id: true,
              product_id: true,
              product_name: true,
              variant_sku: true,
              quantity: true,
              unit_price: true,
              total_price: true,
            },
          },
          payments: {
            select: {
              id: true,
              state: true,
              amount: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { [sort]: order },
      }),
      this.prisma.orders.count({ where }),
    ]);

    const orders = data.map((order) => ({
      id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id,
      customer: order.users
        ? {
            id: order.users.id.toString(),
            first_name: order.users.first_name,
            last_name: order.users.last_name,
            email: order.users.email,
          }
        : null,
      store: {
        id: order.stores.id.toString(),
        name: order.stores.name,
        slug: order.stores.store_code || order.stores.name.toLowerCase().replace(/\s+/g, '-'),
      },
      order_type: order.channel,
      status: order.state,
      payment_status: order.payments?.[0] ? this.mapPaymentState(order.payments[0].state) : 'pending',
      total_amount: Number(order.grand_total),
      subtotal: Number(order.subtotal_amount),
      tax_amount: Number(order.tax_amount),
      shipping_amount: Number(order.shipping_cost),
      discount_amount: Number(order.discount_amount),
      currency: order.currency,
      order_date: order.created_at?.toISOString(),
      items_count: order.order_items?.length || 0,
      notes: order.internal_notes,
      created_at: order.created_at?.toISOString(),
      updated_at: order.updated_at?.toISOString(),
      estimated_ready_at: order.estimated_ready_at?.toISOString(),
      estimated_delivered_at: order.estimated_delivered_at?.toISOString(),
    }));

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id },
      include: {
        stores: {
          select: {
            id: true,
            name: true,
            store_code: true,
          },
        },
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        order_items: {
          include: {
            products: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            product_variants: {
              select: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
        },
        payments: {
          take: 1,
          orderBy: { created_at: 'desc' },
        },
        refunds: true,
      },
    });

    if (!order) {
      return null;
    }

    return {
      id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id,
      customer: order.users
        ? {
            id: order.users.id.toString(),
            first_name: order.users.first_name,
            last_name: order.users.last_name,
            email: order.users.email,
          }
        : null,
      store: {
        id: order.stores.id.toString(),
        name: order.stores.name,
        slug: order.stores.store_code || order.stores.name.toLowerCase().replace(/\s+/g, '-'),
      },
      order_type: order.channel,
      status: order.state,
      payment_status: order.payments?.[0] ? this.mapPaymentState(order.payments[0].state) : 'pending',
      total_amount: Number(order.grand_total),
      subtotal: Number(order.subtotal_amount),
      tax_amount: Number(order.tax_amount),
      shipping_amount: Number(order.shipping_cost),
      discount_amount: Number(order.discount_amount),
      currency: order.currency,
      order_date: order.created_at?.toISOString(),
      items: order.order_items.map((item) => ({
        id: item.id.toString(),
        product_id: item.product_id?.toString() || '',
        product_name: item.product_name,
        product_sku: item.variant_sku || item.products?.sku,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
        total_price: Number(item.total_price),
        variant: item.product_variants?.name,
      })),
      notes: order.internal_notes,
      created_at: order.created_at?.toISOString(),
      updated_at: order.updated_at?.toISOString(),
      estimated_ready_at: order.estimated_ready_at?.toISOString(),
      estimated_delivered_at: order.estimated_delivered_at?.toISOString(),
    };
  }

  async getStats(storeId?: string, dateFrom?: string, dateTo?: string) {
    const where: Prisma.ordersWhereInput = {};

    if (storeId) {
      where.store_id = +storeId;
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) {
        where.created_at.gte = new Date(dateFrom);
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    const [orders, ordersByStatus, ordersByStore] = await Promise.all([
      this.prisma.orders.findMany({
        where,
        select: {
          state: true,
          grand_total: true,
          store_id: true,
          stores: {
            select: {
              name: true,
            },
          },
          payments: {
            select: {
              state: true,
            },
          },
        },
      }),
      this.prisma.orders.groupBy({
        by: ['state'],
        where,
        _count: { state: true },
      }),
      this.prisma.orders.groupBy({
        by: ['store_id'],
        where,
        _count: { store_id: true },
        _sum: { grand_total: true },
      }),
    ]);

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.grand_total), 0);

    const ordersByStatusMap: Record<string, number> = {};
    for (const s of ordersByStatus) {
      ordersByStatusMap[s.state] = s._count.state;
    }

    const ordersByStoreList = ordersByStore.map((s) => ({
      store_id: s.store_id.toString(),
      store_name: orders.find((o) => o.store_id === s.store_id)?.stores?.name || 'Unknown',
      orders_count: s._count.store_id,
      revenue: Number(s._sum.grand_total) || 0,
    }));

    return {
      total_orders: totalOrders,
      pending_orders: ordersByStatusMap['pending_payment'] || 0,
      confirmed_orders: ordersByStatusMap['processing'] || 0,
      processing_orders: ordersByStatusMap['processing'] || 0,
      shipped_orders: ordersByStatusMap['shipped'] || 0,
      delivered_orders: ordersByStatusMap['delivered'] || 0,
      cancelled_orders: ordersByStatusMap['cancelled'] || 0,
      refunded_orders: ordersByStatusMap['refunded'] || 0,
      total_revenue: totalRevenue,
      pending_revenue: orders
        .filter((o) => o.state === 'pending_payment')
        .reduce((sum, o) => sum + Number(o.grand_total), 0),
      average_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      orders_by_status: ordersByStatusMap,
      orders_by_store: ordersByStoreList,
    };
  }

  async generateInvoicePdf(id: number): Promise<Buffer> {
    const order = await this.prisma.orders.findFirst({
      where: { id },
      include: {
        stores: {
          select: {
            id: true,
            name: true,
            store_code: true,
          },
        },
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        order_items: {
          include: {
            products: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            product_variants: {
              select: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
        },
        payments: {
          take: 1,
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const customerName = order.users
      ? `${order.users.first_name} ${order.users.last_name}`
      : 'Guest';

    const pdfData: OrderPdfData = {
      order_number: order.order_number,
      order_date: order.created_at?.toISOString() || new Date().toISOString(),
      customer_name: customerName,
      customer_email: order.users?.email,
      store_name: order.stores.name,
      currency: order.currency || 'COP',
      items: order.order_items.map((item) => ({
        description: item.product_name || item.products?.name || 'Product',
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
        total_price: Number(item.total_price),
      })),
      subtotal: Number(order.subtotal_amount),
      tax_amount: Number(order.tax_amount),
      shipping_amount: Number(order.shipping_cost),
      discount_amount: Number(order.discount_amount),
      total_amount: Number(order.grand_total),
      status: order.state,
      payment_status: order.payments?.[0] ? this.mapPaymentState(order.payments[0].state) : 'pending',
    };

    return OrderPdfBuilder.generate(pdfData);
  }
}
