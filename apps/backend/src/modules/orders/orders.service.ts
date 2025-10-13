import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import { Prisma, order_state_enum } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(createOrderDto: CreateOrderDto, creatingUser: any) {
    try {
      if (!createOrderDto.order_number) {
        createOrderDto.order_number = await this.generateOrderNumber();
      }

      const user = await this.prisma.users.findUnique({
        where: { id: createOrderDto.customer_id }, // customer_id is now user_id
      });
      if (!user) {
        throw new NotFoundException('User (customer) not found');
      }

      const store = await this.prisma.stores.findUnique({
        where: { id: createOrderDto.store_id },
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      return await this.prisma.orders.create({
        data: {
          customer_id: createOrderDto.customer_id, // This should be user_id
          store_id: createOrderDto.store_id,
          order_number: createOrderDto.order_number,
          state: createOrderDto.status || order_state_enum.created,
          subtotal_amount: createOrderDto.subtotal,
          tax_amount: createOrderDto.tax_amount || 0,
          shipping_cost: createOrderDto.shipping_amount || 0,
          discount_amount: createOrderDto.discount_amount || 0,
          grand_total: createOrderDto.total_amount,
          currency: createOrderDto.currency_code || 'USD',
          billing_address_id: createOrderDto.billing_address_id,
          shipping_address_id: createOrderDto.shipping_address_id,
          internal_notes: createOrderDto.notes,
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
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Order number already exists');
        }
      }
      throw error;
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
      sort,
      date_from,
      date_to,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ordersWhereInput = {
      ...(search && {
        OR: [{ order_number: { contains: search, mode: 'insensitive' } }],
      }),
      ...(status && { state: status }),
      ...(customer_id && { customer_id }),
      ...(store_id && { store_id }),
      ...(date_from &&
        date_to && {
          created_at: {
            gte: new Date(date_from),
            lte: new Date(date_to),
          },
        }),
    };

    const orderBy: Prisma.ordersOrderByWithRelationInput = {};
    if (sort) {
      const [field, direction] = sort.split(':');
      orderBy[field] = direction === 'desc' ? 'desc' : 'asc';
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
    const order = await this.prisma.orders.findUnique({
      where: { id },
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
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.orders.delete({ where: { id } });
  }

  private async generateOrderNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const lastOrder = await this.prisma.orders.findFirst({
      where: { order_number: { startsWith: `ORD${year}${month}${day}` } },
      orderBy: { order_number: 'desc' },
    });
    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.slice(-4));
      sequence = lastSequence + 1;
    }
    return `ORD${year}${month}${day}${sequence.toString().padStart(4, '0')}`;
  }
}
