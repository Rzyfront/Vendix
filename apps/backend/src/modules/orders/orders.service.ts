import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import { Prisma, order_state_enum, payments_state_enum } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(createOrderDto: CreateOrderDto) {
    try {
      // Generar número de orden único si no se proporciona
      if (!createOrderDto.order_number) {
        createOrderDto.order_number = await this.generateOrderNumber();
      }

      // Verificar que el customer existe
      const customer = await this.prisma.customers.findUnique({
        where: { id: createOrderDto.customer_id },
      });

      if (!customer) {
        throw new NotFoundException('Cliente no encontrado');
      }

      // Verificar que la tienda existe
      const store = await this.prisma.stores.findUnique({
        where: { id: createOrderDto.store_id },
      });

      if (!store) {
        throw new NotFoundException('Tienda no encontrada');
      }

      // Crear la orden con sus items
      return await this.prisma.orders.create({
        data: {
          customer_id: createOrderDto.customer_id,
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
          customers: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          stores: {
            select: {
              id: true,
              name: true,
              store_code: true,
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
                  price_override: true,
                  stock_quantity: true,
                },
              },
            },
          },
          addresses_orders_billing_address_idToaddresses: {
            select: {
              id: true,
              address_line1: true,
              address_line2: true,
              city: true,
              state_province: true,
              country_code: true,
              postal_code: true,
            },
          },
          addresses_orders_shipping_address_idToaddresses: {
            select: {
              id: true,
              address_line1: true,
              address_line2: true,
              city: true,
              state_province: true,
              country_code: true,
              postal_code: true,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Número de orden ya existe');
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
      payment_status,
      customer_id,
      store_id,
      sort,
      date_from,
      date_to,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ordersWhereInput = {
      ...(search && {
        OR: [
          { order_number: { contains: search, mode: 'insensitive' } },
          {
            customers: {
              OR: [
                { first_name: { contains: search, mode: 'insensitive' } },
                { last_name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        ],
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
          customers: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          stores: {
            select: {
              id: true,
              name: true,
              store_code: true,
            },
          },
          order_items: {
            select: {
              id: true,
              product_name: true,
              quantity: true,
              unit_price: true,
              total_price: true,
            },
          },
        },
      }),
      this.prisma.orders.count({ where }),
    ]);

    return {
      data: orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const order = await this.prisma.orders.findUnique({
      where: { id },
      include: {
        customers: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone_number: true,
          },
        },
        stores: {
          select: {
            id: true,
            name: true,
            store_code: true,
          },
        },
        order_items: {
          include: {
            products: {
              select: {
                id: true,
                name: true,
                sku: true,
                description: true,
              },
            },
            product_variants: {
              select: {
                id: true,
                sku: true,
                price_override: true,
                stock_quantity: true,
              },
            },
          },
        },
        addresses_orders_billing_address_idToaddresses: true,
        addresses_orders_shipping_address_idToaddresses: true,
        payments: {
          select: {
            id: true,
            amount: true,
            state: true,
            payment_methods: {
              select: {
                name: true,
                type: true,
              },
            },
            created_at: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }

    return order;
  }

  async findByOrderNumber(orderNumber: string) {
    const order = await this.prisma.orders.findUnique({
      where: { order_number: orderNumber },
      include: {
        customers: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        stores: {
          select: {
            id: true,
            name: true,
            store_code: true,
          },
        },
        order_items: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }

    return order;
  }

  async findByCustomer(customerId: number, query: OrderQueryDto) {
    const { page = 1, limit = 10, status, sort } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ordersWhereInput = {
      customer_id: customerId,
      ...(status && { state: status }),
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
          stores: {
            select: {
              id: true,
              name: true,
              store_code: true,
            },
          },
          order_items: {
            select: {
              id: true,
              product_name: true,
              quantity: true,
              unit_price: true,
              total_price: true,
            },
          },
        },
      }),
      this.prisma.orders.count({ where }),
    ]);

    return {
      data: orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByStore(storeId: number, query: OrderQueryDto) {
    const { page = 1, limit = 10, status, sort, date_from, date_to } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ordersWhereInput = {
      store_id: storeId,
      ...(status && { state: status }),
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
          customers: {
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
              product_name: true,
              quantity: true,
              unit_price: true,
              total_price: true,
            },
          },
        },
      }),
      this.prisma.orders.count({ where }),
    ]);

    return {
      data: orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(id: number, updateOrderDto: UpdateOrderDto) {
    try {
      // Verificar que la orden existe
      await this.findOne(id);

      return await this.prisma.orders.update({
        where: { id },
        data: {
          ...updateOrderDto,
          updated_at: new Date(),
        },
        include: {
          customers: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          stores: {
            select: {
              id: true,
              name: true,
              store_code: true,
            },
          },
          order_items: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Orden no encontrada');
      }
      throw error;
    }
  }

  async updateStatus(id: number, status: order_state_enum) {
    try {
      const updateData: any = {
        state: status,
        updated_at: new Date(),
      };

      // Agregar timestamps automáticos según el estado
      if (status === order_state_enum.shipped) {
        updateData.shipped_at = new Date();
      } else if (status === order_state_enum.delivered) {
        updateData.delivered_at = new Date();
      }

      return await this.prisma.orders.update({
        where: { id },
        data: updateData,
        include: {
          customers: {
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
              product_name: true,
              quantity: true,
              total_price: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Orden no encontrada');
      }
      throw error;
    }
  }

  async cancel(id: number, reason?: string) {
    try {
      return await this.prisma.orders.update({
        where: { id },
        data: {
          state: order_state_enum.cancelled,
          internal_notes: reason ? `Cancelada: ${reason}` : 'Cancelada',
          updated_at: new Date(),
        },
        include: {
          customers: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          order_items: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Orden no encontrada');
      }
      throw error;
    }
  }

  async remove(id: number) {
    try {
      // Verificar que la orden existe
      await this.findOne(id);

      // Eliminar orden (esto eliminará automáticamente los items por cascada)
      return await this.prisma.orders.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException('Orden no encontrada');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar la orden porque tiene pagos o datos relacionados',
          );
        }
      }
      throw error;
    }
  }

  private async generateOrderNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');

    // Buscar el último número de orden del día
    const lastOrder = await this.prisma.orders.findFirst({
      where: {
        order_number: {
          startsWith: `ORD${year}${month}${day}`,
        },
      },
      orderBy: {
        order_number: 'desc',
      },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.order_number.slice(-4));
      sequence = lastSequence + 1;
    }

    return `ORD${year}${month}${day}${sequence.toString().padStart(4, '0')}`;
  }
}
