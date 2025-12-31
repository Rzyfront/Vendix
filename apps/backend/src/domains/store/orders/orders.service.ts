import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import { Prisma, order_state_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { OrderStatsDto } from './dto/order-stats.dto';

@Injectable()
export class OrdersService {
  constructor(private prisma: StorePrismaService) { }

  async create(createOrderDto: CreateOrderDto, creatingUser: any) {
    // Enforce store context
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

    const user = await this.prisma.users.findUnique({
      where: { id: createOrderDto.customer_id },
    });
    if (!user) {
      throw new NotFoundException('User (customer) not found');
    }

    let retries = 3;
    while (retries > 0) {
      try {
        if (!createOrderDto.order_number) {
          createOrderDto.order_number = await this.generateOrderNumber(store_id);
        }

        // Use scoped client (creates are not scoped by extension but using correct service is good style)
        return await this.prisma.orders.create({
          data: {
            customer_id: createOrderDto.customer_id,
            store_id: store_id, // Force strict store_id
            order_number: createOrderDto.order_number,
            state: createOrderDto.state || order_state_enum.created,
            subtotal_amount: createOrderDto.subtotal,
            tax_amount: createOrderDto.tax_amount || 0,
            shipping_cost: createOrderDto.shipping_cost || 0,
            discount_amount: createOrderDto.discount_amount || 0,
            grand_total: createOrderDto.total_amount,
            currency: createOrderDto.currency || 'USD',
            billing_address_id: createOrderDto.billing_address_id,
            shipping_address_id: createOrderDto.shipping_address_id,
            internal_notes: createOrderDto.internal_notes,
            updated_at: new Date(),
            order_items: {
              create: createOrderDto.items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                product_name: item.product_name,
                variant_sku: item.variant_sku,
                variant_attributes: item.variant_attributes,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                tax_rate: item.tax_rate,
                tax_amount_item: item.tax_amount_item,
                updated_at: new Date(),
              })),
            },
          },
          include: {
            stores: { select: { id: true, name: true, store_code: true } },
            order_items: { include: { products: true, product_variants: true } },
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Check if the unique constraint failure is indeed on order_number
          const target = error.meta?.target as string[];
          if (
            Array.isArray(target) &&
            target.includes('order_number')
          ) {
            retries--;
            if (retries === 0) {
              throw new ConflictException('Failed to generate unique order number after multiple attempts');
            }
            // Reset order_number to null so it gets regenerated in the next iteration
            createOrderDto.order_number = undefined;
            continue;
          }
        }
        throw error;
      }
    }
  }

  async findAll(query: OrderQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      store_id,
      sort_by,
      sort_order,
      date_from,
      date_to,
    } = query;
    const skip = (page - 1) * limit;

    // Context validation handled by StorePrismaService auto-scoping

    // Auto-scoped query
    const where: Prisma.ordersWhereInput = {
      ...(search && {
        OR: [{ order_number: { contains: search, mode: 'insensitive' } }],
      }),
      ...(status && { state: status }),
      ...(customer_id && { customer_id }),
      ...(date_from &&
        date_to && {
        created_at: {
          gte: new Date(date_from),
          lte: new Date(date_to),
        },
      }),
    };

    const orderBy: Prisma.ordersOrderByWithRelationInput = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [orders, total] = await Promise.all([
      this.prisma.orders.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: {
            select: { id: true, product_name: true, quantity: true },
          },
        },
      }),
      this.prisma.orders.count({ where }),
    ]);

    return {
      data: orders,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    // Auto-scoped by StorePrismaService
    const order = await this.prisma.orders.findFirst({
      where: {
        id,
      },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        addresses_orders_billing_address_idToaddresses: true,
        addresses_orders_shipping_address_idToaddresses: true,
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async update(id: number, updateOrderDto: UpdateOrderDto) {
    await this.findOne(id);

    return this.prisma.orders.update({
      where: { id },
      data: { ...updateOrderDto, updated_at: new Date() },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        addresses_orders_billing_address_idToaddresses: true,
        addresses_orders_shipping_address_idToaddresses: true,
        payments: true,
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    // Use scoped client (implicit via this.prisma)
    return this.prisma.orders.delete({ where: { id } });
  }

  private async generateOrderNumber(storeId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const prefix = `ORD${year}${month}${day}`;

    // Filter by store_id for per-store unique order numbers
    const lastOrder = await this.prisma.orders.findFirst({
      where: {
        store_id: storeId,
        order_number: { startsWith: prefix },
      },
      orderBy: { order_number: 'desc' },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  async getStats(): Promise<OrderStatsDto> {
    // Auto-scoped
    const where: Prisma.ordersWhereInput = {};

    const [totalOrders, totalRevenue, pendingOrders, completedOrders] =
      await Promise.all([
        this.prisma.orders.count({ where }),
        this.prisma.orders.aggregate({
          where: {
            ...where,
            state: {
              in: ['shipped', 'delivered', 'finished'] as order_state_enum[],
            },
          },
          _sum: { grand_total: true },
        }),
        this.prisma.orders.count({
          where: {
            ...where,
            state: {
              in: [
                'created',
                'pending_payment',
                'processing',
              ] as order_state_enum[],
            },
          },
        }),
        this.prisma.orders.count({
          where: {
            ...where,
            state: {
              in: ['delivered', 'finished'] as order_state_enum[],
            },
          },
        }),
      ]);

    const averageOrderValue =
      totalOrders > 0 ? (totalRevenue._sum.grand_total || 0) / totalOrders : 0;

    return {
      total_orders: totalOrders,
      total_revenue: totalRevenue._sum.grand_total || 0,
      pending_orders: pendingOrders,
      completed_orders: completedOrders,
      average_order_value: averageOrderValue,
    };
  }
}
