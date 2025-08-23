import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
} from './dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(createCustomerDto: CreateCustomerDto, user: any) {
    if (createCustomerDto.store_id) {
      await this.validateStoreAccess(createCustomerDto.store_id, user);
    }

    // Check if email already exists in store
    const existingCustomer = await this.prisma.customers.findFirst({
      where: {
        email: createCustomerDto.email,
        store_id: createCustomerDto.store_id,
      },
    });

    if (existingCustomer) {
      throw new ConflictException('Customer with this email already exists in store');
    }

    try {
      return await this.prisma.customers.create({
        data: {
          ...createCustomerDto,
          updated_at: new Date(),
        },
        include: {
          stores: { select: { id: true, name: true } },
          users: { select: { id: true, first_name: true, last_name: true, email: true } },
          addresses: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Customer with this email already exists');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid store or user reference');
        }
      }
      throw error;
    }
  }

  async findAll(query: CustomerQueryDto, user: any) {
    const { page = 1, limit = 10, search, store_id } = query;
    const skip = (page - 1) * limit;

    // Validate store access
    if (store_id) {
      await this.validateStoreAccess(store_id, user);
    }

    const where: Prisma.customersWhereInput = {
      ...(store_id && { store_id }),
      ...(search && {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone_number: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      this.prisma.customers.findMany({
        where,
        skip,
        take: limit,
        include: {
          stores: { select: { id: true, name: true } },
          users: { select: { id: true, first_name: true, last_name: true } },
          addresses: {
            orderBy: { id: 'desc' }, // addresses table doesn't have created_at
            take: 1,
          },
          _count: {
            select: {
              orders: true,
              addresses: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.customers.count({ where }),
    ]);

    return {
      data: customers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number, user: any) {
    const customer = await this.prisma.customers.findFirst({
      where: { id },
      include: {
        stores: { select: { id: true, name: true } },
        users: { select: { id: true, first_name: true, last_name: true, email: true } },
        addresses: {
          orderBy: { id: 'desc' }, // addresses table doesn't have created_at
        },
        orders: {
          select: {
            id: true,
            order_number: true,
            state: true, // orders table has 'state' not 'status'
            grand_total: true, // orders table has 'grand_total' not 'total_amount'
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            orders: true,
            addresses: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Validate store access
    if (customer.store_id) {
      await this.validateStoreAccess(customer.store_id, user);
    }

    return customer;
  }

  async findByEmail(email: string, storeId: number, user: any) {
    await this.validateStoreAccess(storeId, user);

    const customer = await this.prisma.customers.findFirst({
      where: { 
        email,
        store_id: storeId,
      },
      include: {
        stores: { select: { id: true, name: true } },
        users: { select: { id: true, first_name: true, last_name: true } },
        addresses: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async update(id: number, updateCustomerDto: UpdateCustomerDto, user: any) {
    const customer = await this.prisma.customers.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Validate store access
    if (customer.store_id) {
      await this.validateStoreAccess(customer.store_id, user);
    }

    // Check email uniqueness if email is being updated
    if (updateCustomerDto.email && updateCustomerDto.email !== customer.email) {
      const existingCustomer = await this.prisma.customers.findFirst({
        where: {
          email: updateCustomerDto.email,
          store_id: customer.store_id,
          NOT: { id },
        },
      });

      if (existingCustomer) {
        throw new ConflictException('Customer with this email already exists in store');
      }
    }

    try {
      return await this.prisma.customers.update({
        where: { id },
        data: {
          ...updateCustomerDto,
          updated_at: new Date(),
        },
        include: {
          stores: { select: { id: true, name: true } },
          users: { select: { id: true, first_name: true, last_name: true } },
          addresses: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Email already exists');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid store or user reference');
        }
      }
      throw error;
    }
  }

  async remove(id: number, user: any) {
    const customer = await this.prisma.customers.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Validate store access
    if (customer.store_id) {
      await this.validateStoreAccess(customer.store_id, user);
    }

    // Check if customer has orders
    const orderCount = await this.prisma.orders.count({
      where: { customer_id: id },
    });

    if (orderCount > 0) {
      throw new BadRequestException(
        'Cannot delete customer with existing orders. Consider deactivating the customer instead.'
      );
    }

    try {
      await this.prisma.customers.delete({ where: { id } });
      return { message: 'Customer deleted successfully' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'Cannot delete customer due to related data constraints'
          );
        }
      }
      throw error;
    }
  }

  async getCustomersByStore(storeId: number, user: any) {
    await this.validateStoreAccess(storeId, user);

    return await this.prisma.customers.findMany({
      where: { store_id: storeId },
      include: {
        users: { select: { id: true, first_name: true, last_name: true } },
        _count: {
          select: {
            orders: true,
            addresses: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getCustomerStats(customerId: number, user: any) {
    const customer = await this.prisma.customers.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Validate store access
    if (customer.store_id) {
      await this.validateStoreAccess(customer.store_id, user);
    }

    const [totalOrders, totalSpent, recentOrders] = await Promise.all([
      this.prisma.orders.count({
        where: { customer_id: customerId },
      }),      this.prisma.orders.aggregate({
        where: { 
          customer_id: customerId,
          state: { in: ['delivered', 'finished'] }, // using valid order_state_enum values
        },
        _sum: { grand_total: true }, // using 'grand_total' instead of 'total_amount'
      }),
      this.prisma.orders.findMany({
        where: { customer_id: customerId },
        select: {
          id: true,
          order_number: true,
          state: true, // using 'state' instead of 'status'
          grand_total: true, // using 'grand_total' instead of 'total_amount'
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
    ]);

    return {
      totalOrders,
      totalSpent: totalSpent._sum?.grand_total || 0, // proper null safety
      recentOrders,
    };
  }

  async findByStore(storeId: number, query: CustomerQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.customersWhereInput = {
      store_id: storeId,
      ...(search && {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone_number: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      this.prisma.customers.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          stores: { select: { id: true, name: true } },
          users: { select: { id: true, first_name: true, last_name: true } },
          addresses: {
            orderBy: { id: 'desc' },
            take: 1,
          },
          _count: {
            select: {
              orders: true,
              addresses: true,
            },
          },
        },
      }),
      this.prisma.customers.count({ where }),
    ]);

    return {
      data: customers,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async activate(id: number, user: any) {
    const customer = await this.findOne(id, user);

    // Since customers don't have a status field in the schema, we'll just return the customer
    // In a real implementation, you might want to add a status field to the schema
    return customer;
  }

  async deactivate(id: number, user: any) {
    const customer = await this.findOne(id, user);

    // Since customers don't have a status field in the schema, we'll just return the customer
    // In a real implementation, you might want to add a status field to the schema
    return customer;
  }

  async block(id: number, user: any) {
    const customer = await this.findOne(id, user);

    // Since customers don't have a status field in the schema, we'll just return the customer
    // In a real implementation, you might want to add a status field to the schema
    return customer;
  }

  async verify(id: number, user: any) {
    const customer = await this.findOne(id, user);

    // Since customers don't have a status field in the schema, we'll just return the customer
    // In a real implementation, you might want to add a status field to the schema
    return customer;
  }

  private async validateStoreAccess(storeId: number, user: any) {
    // Check if user has access to this store
    const storeAccess = await this.prisma.store_staff.findFirst({
      where: { 
        store_id: storeId, 
        user_id: user.id, 
        is_active: true 
      },
    });

    if (!storeAccess && user.role !== 'system_admin') {
      throw new ForbiddenException('Access denied to this store');
    }
  }
}
