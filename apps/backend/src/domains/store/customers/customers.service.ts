import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuditResource } from '../../../common/audit/audit.service';
import * as bcrypt from 'bcrypt';
import { toTitleCase } from '@common/utils/format.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private normalizeOptionalString(
    value?: string | null,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private async generateUniqueUsername(email: string): Promise<string> {
    let baseUsername = email.split('@')[0];
    // Eliminar caracteres especiales
    baseUsername = baseUsername.replace(/[^a-zA-Z0-9]/g, '');

    let username = baseUsername;
    let counter = 1;

    while (true) {
      const existingUser = await this.prisma.users.findUnique({
        where: { username },
      });

      if (!existingUser) {
        return username;
      }

      username = `${baseUsername}${counter}`;
      counter++;
    }
  }

  private generateTemporaryPassword(length = 10): string {
    const charset =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; ++i) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }
    return password;
  }

  private async generateUnreachablePassword(): Promise<string> {
    const random = randomBytes(32).toString('hex');
    return bcrypt.hash(random, 12);
  }

  async resolveGuestCustomerForCheckout(
    storeId: number,
    guest: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
      document_type?: string | null;
      document_number?: string | null;
    } | null,
  ): Promise<{
    customer_id: number;
    was_created: boolean;
    was_updated: boolean;
  } | null> {
    if (!guest) return null;

    const normalizedEmail = guest.email?.toLowerCase().trim() || null;
    const normalizedPhone = guest.phone?.replace(/\s+/g, '').trim() || null;

    if (!normalizedEmail && !normalizedPhone) return null;

    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true, organization_id: true },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    let existing: { id: number } | null = null;

    if (normalizedEmail) {
      existing = await this.prisma.users.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          store_users: { some: { store_id: storeId } },
          user_roles: { some: { roles: { name: 'customer' } } },
        },
        select: { id: true },
      });
    }

    if (!existing && normalizedPhone) {
      existing = await this.prisma.users.findFirst({
        where: {
          phone: normalizedPhone,
          store_users: { some: { store_id: storeId } },
          user_roles: { some: { roles: { name: 'customer' } } },
        },
        select: { id: true },
      });
    }

    if (!existing) {
      if (!normalizedEmail) return null;

      const customerRole = await this.prisma.roles.findFirst({
        where: { name: 'customer' },
      });

      if (!customerRole) {
        throw new VendixHttpException(ErrorCodes.CUST_CREATE_001);
      }

      const hashedPassword = await this.generateUnreachablePassword();
      const formattedFirstName =
        toTitleCase(guest.first_name ?? '') || 'Cliente';
      const formattedLastName =
        toTitleCase(guest.last_name ?? '') || 'Invitado';

      const buildUserData = (username: string) => ({
        email: normalizedEmail,
        password: hashedPassword,
        first_name: formattedFirstName,
        last_name: formattedLastName,
        phone: this.normalizeOptionalString(normalizedPhone),
        document_type: this.normalizeOptionalString(guest.document_type),
        document_number: this.normalizeOptionalString(guest.document_number),
        username,
        email_verified: false,
        state: 'pending_verification' as const,
        organization_id: store.organization_id,
        user_roles: {
          create: {
            role_id: customerRole.id,
          },
        },
        store_users: {
          create: {
            store_id: store.id,
          },
        },
        user_settings: {
          create: {
            app_type: 'STORE_ECOMMERCE' as const,
            config: {
              panel_ui: {
                profile: true,
                history: true,
                dashboard: true,
                favorites: true,
                orders: true,
                settings: true,
              },
            },
          },
        },
      });

      let user: { id: number; first_name: string; last_name: string | null; email: string };
      try {
        const username = await this.generateUniqueUsername(normalizedEmail);
        user = await this.prisma.users.create({
          data: buildUserData(username),
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        });
      } catch (error: any) {
        const isUsernameConflict =
          error?.code === 'P2002' &&
          Array.isArray(error?.meta?.target) &&
          error.meta.target.includes('username');

        if (!isUsernameConflict) throw error;

        const retryUsername =
          await this.generateUniqueUsername(normalizedEmail);
        user = await this.prisma.users.create({
          data: buildUserData(retryUsername),
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        });
      }

      this.eventEmitter.emit('customer.created', {
        store_id: store.id,
        customer_id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      });

      return {
        customer_id: user.id,
        was_created: true,
        was_updated: false,
      };
    }

    const data: Record<string, string> = {};
    if (guest.first_name?.trim()) {
      data.first_name = toTitleCase(guest.first_name);
    }
    if (guest.last_name?.trim()) {
      data.last_name = toTitleCase(guest.last_name);
    }
    if (normalizedPhone) {
      data.phone = normalizedPhone;
    }
    if (guest.document_type?.trim()) {
      data.document_type = guest.document_type.trim();
    }
    if (guest.document_number?.trim()) {
      data.document_number = guest.document_number.trim();
    }

    const hasUpdates = Object.keys(data).length > 0;
    if (hasUpdates) {
      await this.prisma.users.update({
        where: { id: existing.id },
        data,
      });
    }

    try {
      await this.linkCustomerToStore(existing.id, storeId);
    } catch {
      // El enlace ya existe o se creó en paralelo; ignorar para mantener idempotencia.
    }

    return {
      customer_id: existing.id,
      was_created: false,
      was_updated: hasUpdates,
    };
  }

  async create(storeId: number, dto: CreateCustomerDto) {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    // Check if user exists in the organization
    const existingUser = await this.prisma.users.findFirst({
      where: {
        email: dto.email,
        organization_id: store.organization_id,
      },
    });

    if (existingUser) {
      throw new VendixHttpException(ErrorCodes.SYS_CONFLICT_001);
    }

    // Find customer role
    const customerRole = await this.prisma.roles.findFirst({
      where: { name: 'customer' },
    });

    if (!customerRole) {
      throw new VendixHttpException(ErrorCodes.CUST_CREATE_001);
    }

    const password = this.generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(password, 12);
    const username = await this.generateUniqueUsername(dto.email);

    // Convertir nombres a Title Case
    const formatted_first_name = toTitleCase(dto.first_name || '');
    const formatted_last_name = toTitleCase(dto.last_name || '');

    // Create user
    const user = await this.prisma.users.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        first_name: formatted_first_name,
        last_name: formatted_last_name,
        phone: this.normalizeOptionalString(dto.phone),
        document_type: this.normalizeOptionalString(dto.document_type),
        document_number: this.normalizeOptionalString(dto.document_number),
        username: username,
        email_verified: false,
        organization_id: store.organization_id,
        user_roles: {
          create: {
            role_id: customerRole.id,
          },
        },
        store_users: {
          create: {
            store_id: store.id,
          },
        },
        user_settings: {
          create: {
            app_type: 'STORE_ECOMMERCE',
            config: {
              panel_ui: {
                profile: true,
                history: true,
                dashboard: true,
                favorites: true,
                orders: true,
                settings: true,
              },
            },
          },
        },
      },
      include: {
        user_roles: true,
        store_users: true,
      },
    });

    this.eventEmitter.emit('customer.created', {
      store_id: store.id,
      customer_id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
    });

    return user;
  }

  async findAll(
    storeId: number,
    query?: { search?: string; page?: number; limit?: number },
  ) {
    const { search, page = 1, limit = 20 } = query || {};
    const skip = (page - 1) * limit;

    const where: any = {
      store_users: {
        some: {
          store_id: storeId,
        },
      },
      user_roles: {
        some: {
          roles: {
            name: 'customer',
          },
        },
      },
    };

    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { document_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          addresses: {
            where: { type: 'shipping' },
            orderBy: { is_primary: 'desc' },
          },
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(storeId: number, id: number) {
    const user = await this.prisma.users.findFirst({
      where: {
        id,
        store_users: {
          some: {
            store_id: storeId,
          },
        },
        user_roles: {
          some: {
            roles: {
              name: 'customer',
            },
          },
        },
      },
      include: {
        addresses: {
          where: { type: 'shipping' },
          orderBy: { is_primary: 'desc' },
        },
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    }

    return user;
  }

  async update(storeId: number, id: number, dto: UpdateCustomerDto) {
    const user = await this.findOne(storeId, id);

    return this.prisma.users.update({
      where: { id: user.id },
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        phone: this.normalizeOptionalString(dto.phone),
        document_number: this.normalizeOptionalString(dto.document_number),
        document_type: this.normalizeOptionalString(dto.document_type),
        email: dto.email, // Can we update email? Usually requires verification, but for CRUD basic...
      },
    });
  }

  async remove(storeId: number, id: number) {
    const user = await this.findOne(storeId, id);

    // Check if user has orders or other dependencies that prevent deletion?
    // For now, standard delete might fail if foreign keys exist.
    // Prisma `users` delete might be too aggressive if cascade is not set up or set up to cascade.
    // Safe delete often means soft delete or check dependencies.
    // Given "CRUD Basico", I will attempt delete.

    return this.prisma.users.delete({
      where: { id: user.id },
    });
  }

  async findByDocumentInOrganization(
    organizationId: number,
    documentNumber: string,
    documentType?: string,
  ): Promise<any | null> {
    const where: any = {
      organization_id: organizationId,
      document_number: { equals: documentNumber, mode: 'insensitive' },
      user_roles: {
        some: {
          roles: {
            name: 'customer',
          },
        },
      },
    };

    if (documentType) {
      where.document_type = documentType;
    }

    return this.prisma.users.findFirst({
      where,
      include: {
        user_roles: true,
        store_users: true,
        addresses: {
          where: { type: 'shipping' },
          orderBy: { is_primary: 'desc' },
        },
      },
    });
  }

  async linkCustomerToStore(userId: number, storeId: number): Promise<void> {
    const existing = await this.prisma.store_users.findFirst({
      where: {
        user_id: userId,
        store_id: storeId,
      },
    });

    if (!existing) {
      await this.prisma.store_users.create({
        data: {
          user_id: userId,
          store_id: storeId,
        },
      });
    }
  }

  async getStats(storeId: number) {
    try {
      // Get current month start date
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Get all customers for the store
      const where = {
        store_users: {
          some: {
            store_id: storeId,
          },
        },
        user_roles: {
          some: {
            roles: {
              name: 'customer',
            },
          },
        },
      };

      const [totalCustomers, newCustomersThisMonth] = await Promise.all([
        // Total customers count
        this.prisma.users.count({ where }),

        // New customers this month
        this.prisma.users.count({
          where: {
            ...where,
            created_at: {
              gte: currentMonthStart,
            },
          },
        }),
      ]);

      // Calculate active customers (customers who have made at least one order)
      const activeCustomers = await this.prisma.users.count({
        where: {
          ...where,
          orders: {
            some: {
              store_id: storeId,
            },
          },
        },
      });

      // Calculate total revenue from all customer orders
      const revenueResult = await this.prisma.orders.aggregate({
        where: {
          store_id: storeId,
          state: 'finished',
          customer_id: {
            not: null,
          },
        },
        _sum: {
          grand_total: true,
        },
      });

      const totalRevenue = revenueResult._sum.grand_total || 0;

      return {
        total_customers: totalCustomers,
        active_customers: activeCustomers,
        new_customers_this_month: newCustomersThisMonth,
        total_revenue: totalRevenue,
      };
    } catch (error) {
      throw new VendixHttpException(
        ErrorCodes.SYS_INTERNAL_001,
        'Error calculating customer stats',
      );
    }
  }
}
