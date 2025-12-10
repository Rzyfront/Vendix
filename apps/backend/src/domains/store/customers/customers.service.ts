import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  ChangeCustomerStatusDto,
  CustomerQueryDto,
  CustomerStatsDto,
} from './dto';
import { user_state_enum } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class CustomersService {
  constructor(private prisma: StorePrismaService) {}

  async createCustomer(createCustomerDto: CreateCustomerDto) {
    const { password, ...customerData } = createCustomerDto;

    // Get context
    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;
    const store_id = context?.store_id;

    if (!organization_id) {
      throw new Error('Organization context required');
    }

    if (!store_id) {
      throw new Error('Store context required');
    }

    // Find customer role
    const customerRole = await this.prisma.roles.findFirst({
      where: { name: 'customer' },
    });

    if (!customerRole) {
      throw new Error('Customer role not found');
    }

    // Generate password if not provided
    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : await bcrypt.hash(this.generateRandomPassword(), 10);

    // Create user with customer role
    const user = await this.prisma.users.create({
      data: {
        ...customerData,
        password: hashedPassword,
        state: user_state_enum.active, // New customers are active by default
        organization_id, // Set organization_id from context
        user_roles: {
          create: {
            role_id: customerRole.id,
          },
        },
      },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Associate user with current store
    await this.prisma.store_users.create({
      data: {
        store_id: store_id,
        user_id: user.id,
      },
    });

    return user;
  }

  async getCustomers(query: CustomerQueryDto) {
    const {
      search,
      state,
      page = 1,
      limit = 10,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;
    const where: any = {
      user_roles: {
        some: {
          roles: {
            name: 'customer',
          },
        },
      },
    };

    // Debug logging
    console.log('Customers query where:', JSON.stringify(where, null, 2));

    const [customers, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        select: {
          id: true,
          username: true,
          email: true,
          first_name: true,
          last_name: true,
          phone: true,
          document_type: true,
          document_number: true,
          state: true,
          created_at: true,
          updated_at: true,
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    console.log('Customers found:', customers.length);
    console.log('Total customers:', total);
    console.log('Customers data sample:', customers.slice(0, 2));

    return {
      data: customers,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async getCustomerById(id: number) {
    return this.prisma.users.findFirst({
      where: {
        id: id,
        user_roles: {
          some: {
            roles: {
              name: 'customer',
            },
          },
        },
      },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
        store_users: {
          include: {
            store: true,
          },
        },
      },
    });
  }

  async updateCustomer(id: number, updateCustomerDto: UpdateCustomerDto) {
    return this.prisma.users.update({
      where: { id },
      data: updateCustomerDto,
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        document_type: true,
        document_number: true,
        state: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async changeCustomerStatus(
    id: number,
    changeStatusDto: ChangeCustomerStatusDto,
  ) {
    return this.prisma.users.update({
      where: { id },
      data: { state: changeStatusDto.state },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        state: true,
        updated_at: true,
      },
    });
  }

  async getCustomerStats(): Promise<CustomerStatsDto> {
    console.log('getCustomerStats: Starting stats calculation...');

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Filter for customers only
    const customerWhere = {
      user_roles: {
        some: {
          roles: {
            name: 'customer',
          },
        },
      },
    };

    console.log(
      'getCustomerStats: customerWhere:',
      JSON.stringify(customerWhere, null, 2),
    );

    const [totalCustomers, activeCustomers, newCustomersThisMonth] =
      await Promise.all([
        this.prisma.users.count({ where: customerWhere }),
        this.prisma.users.count({
          where: {
            ...customerWhere,
            state: user_state_enum.active,
          },
        }),
        this.prisma.users.count({
          where: {
            ...customerWhere,
            created_at: {
              gte: firstDayOfMonth,
            },
          },
        }),
      ]);

    console.log('getCustomerStats: Results:', {
      totalCustomers,
      activeCustomers,
      newCustomersThisMonth,
    });

    const result = {
      total_customers: totalCustomers,
      active_customers: activeCustomers,
      new_customers_this_month: newCustomersThisMonth,
    };

    console.log('getCustomerStats: Final result:', result);

    return result;
  }

  private generateRandomPassword(): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  // DEBUG: Get all users without role filter for troubleshooting
  async debugGetAllUsers() {
    console.log('DEBUG: Getting all users in current store context...');

    const allUsers = await this.prisma.users.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        document_type: true,
        document_number: true,
        state: true,
        created_at: true,
        updated_at: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    console.log('DEBUG: All users found:', allUsers.length);

    // Check which users have customer role
    const customers = allUsers.filter((user) =>
      user.user_roles.some((ur) => ur.roles?.name === 'customer'),
    );

    console.log('DEBUG: Users with customer role:', customers.length);

    return {
      total_users: allUsers.length,
      customers: customers.length,
      users: allUsers.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        state: user.state,
        roles: user.user_roles.map((ur) => ur.roles?.name).filter(Boolean),
      })),
    };
  }
}
