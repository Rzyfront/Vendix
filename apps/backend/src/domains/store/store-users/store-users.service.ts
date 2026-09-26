import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class StoreUsersService {
  constructor(private prisma: StorePrismaService) {}

  async create(data: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    // Ensure store_id is set
    return this.prisma.store_users.create({
      data: {
        ...data,
        store_id: store_id,
      },
    });
  }

  async findAll(query: any) {
    // Store context is handled automatically by StorePrismaService
    const {
      page = 1,
      limit = 10,
      search,
      role,
      exclude_role,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {
      user: {
        state: 'active', // Only show active users by default
      },
    };

    if (search) {
      where.user = {
        ...where.user,
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    if (role) {
      where.user = {
        ...where.user,
        user_roles: {
          some: {
            roles: {
              name: role,
            },
          },
        },
      };
    }

    // Exclude store users carrying `exclude_role` (e.g. 'customer'). Merges
    // with any existing `some` filter so `role` + `exclude_role` compose
    // (Prisma ANDs `some` and `none` on the same relation).
    if (exclude_role) {
      where.user = {
        ...where.user,
        user_roles: {
          ...(where.user?.user_roles ?? {}),
          none: {
            roles: {
              name: exclude_role,
            },
          },
        },
      };
    }

    // Map Sort Field
    const orderByField = sort_by === 'created_at' ? 'createdAt' : sort_by;

    const [total, data] = await Promise.all([
      this.prisma.store_users.count({ where }),
      this.prisma.store_users.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
              phone: true,
              state: true,
              last_login: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: {
          [orderByField]: sort_order,
        },
      }),
    ]);

    // Transform result to match expected frontend format if needed
    // The frontend expects a flat structure compatible with PosCustomer interface
    return {
      data: data.map((item) => ({
        id: item.user.id, // Use user ID as the main ID for the customer
        email: item.user.email,
        first_name: item.user.first_name,
        last_name: item.user.last_name,
        phone: item.user.phone,
        state: item.user.state, // Mapped from user state
        last_login: item.user.last_login,
        created_at: item.createdAt,
        store_user_id: item.id, // Keep reference to store_user ID if needed
        // Add other fields if available/needed
      })),
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * B9 — lightweight name-only staff search backing `store:pos:access`
   * pickers (e.g. the POS payment-collector waiter-tip selector).
   *
   * `findAll` above requires `store:users:read`, which cashier/waiter do
   * not hold (seed comment: "solo owner/admin"). This method intentionally
   * returns the minimal `{id, first_name, last_name}` projection — no
   * email/phone/roles — so the wider `store:pos:access` permission (already
   * granted to both roles) is safe to gate it with. `id` is `users.id`
   * (not `store_users.id`), matching `orders.tip_waiter_id`'s FK target.
   */
  async staffLookup(query: { search?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 20);

    const where: any = {
      user: {
        state: 'active',
        // Ecommerce customers are also `store_users` rows — customers.service
        // upserts a store_users link on registration — so filtering on
        // `state: 'active'` alone let customers show up in this staff-only
        // picker (POS payment "Buscar mesero" tip selector). Require at
        // least one role that is NOT 'customer' so a staff member who is
        // ALSO a registered customer still appears; a user whose only role
        // is 'customer' (or who has no roles) is excluded.
        user_roles: {
          some: {
            roles: {
              name: { not: 'customer' },
            },
          },
        },
      },
    };

    if (query.search) {
      where.user = {
        ...where.user,
        OR: [
          { first_name: { contains: query.search, mode: 'insensitive' } },
          { last_name: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const rows = await this.prisma.store_users.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      take: limit,
      orderBy: { id: 'asc' },
    });

    return rows.map((row) => ({
      id: row.user.id,
      first_name: row.user.first_name,
      last_name: row.user.last_name,
    }));
  }

  async findOne(id: number) {
    // Auto-scoped
    const user = await this.prisma.store_users.findFirst({
      where: { id },
      include: {
        users: true,
        roles: true,
      },
    });

    if (!user) throw new NotFoundException('Store user not found');
    return user;
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.store_users.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.store_users.delete({
      where: { id },
    });
  }
}
