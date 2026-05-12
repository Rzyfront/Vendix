import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  CreateStoreUserDto,
  UpdateStoreUserDto,
  QueryStoreUsersDto,
  ResetPasswordStoreUserDto,
  UpdateUserRolesDto,
  UpdateUserPanelUIDto,
} from './dto';
import * as bcrypt from 'bcryptjs';
import { toTitleCase } from '@common/utils/format.util';

@Injectable()
export class StoreUserManagementService {
  constructor(
    private prisma: StorePrismaService,
    private defaultPanelUIService: DefaultPanelUIService,
  ) {}

  async create(dto: CreateStoreUserDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const organization_id = context?.organization_id;

    if (!store_id || !organization_id) {
      throw new BadRequestException('Store and organization context required');
    }

    // Check if user with this email already exists
    const existing_user = await this.prisma.users.findFirst({
      where: { email: dto.email },
    });

    if (existing_user) {
      // Check if already linked to this store
      const existing_store_user = await this.prisma.store_users.findFirst({
        where: { user_id: existing_user.id },
      });

      if (existing_store_user) {
        throw new ConflictException(
          'A user with this email already exists in this store',
        );
      }
    }

    const hashed_password = await bcrypt.hash(dto.password, 10);

    const formatted_first_name = toTitleCase(dto.first_name || '');
    const formatted_last_name = toTitleCase(dto.last_name || '');

    // Generate username if not provided
    const username =
      dto.username ||
      `${formatted_first_name.toLowerCase()}_${formatted_last_name.toLowerCase()}_${Date.now()}`;

    // Create user record
    const user = await this.prisma.users.create({
      data: {
        first_name: formatted_first_name,
        last_name: formatted_last_name,
        email: dto.email,
        username,
        password: hashed_password,
        organization_id,
        state: 'active',
        updated_at: new Date(),
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        email: true,
        state: true,
        created_at: true,
      },
    });

    // Generate panel UI settings
    const config =
      await this.defaultPanelUIService.generatePanelUI('STORE_ADMIN');
    await this.prisma.user_settings.create({
      data: {
        user_id: user.id,
        app_type: 'STORE_ADMIN',
        config,
      },
    });

    // Create store_users junction record
    await this.prisma.store_users.create({
      data: {
        store_id,
        user_id: user.id,
      },
    });

    return user;
  }

  async findAll(query: QueryStoreUsersDto) {
    const {
      page = 1,
      limit = 10,
      search,
      state,
      sort_by = 'createdAt',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    // Build user filter
    const user_filter: any = {};

    if (state) {
      user_filter.state = state;
    } else {
      user_filter.state = { notIn: ['suspended', 'archived'] };
    }

    if (search) {
      user_filter.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Exclude users with "customer" role — they belong to the customers module
    user_filter.user_roles = {
      none: {
        roles: { name: 'customer' },
      },
    };

    where.user = user_filter;

    const [total, data] = await Promise.all([
      this.prisma.store_users.count({ where }),
      this.prisma.store_users.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              username: true,
              email: true,
              phone: true,
              state: true,
              last_login: true,
              created_at: true,
              avatar_url: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
      }),
    ]);

    return {
      data: data.map((item) => ({
        id: item.user.id,
        first_name: item.user.first_name,
        last_name: item.user.last_name,
        username: item.user.username,
        email: item.user.email,
        phone: item.user.phone,
        state: item.user.state,
        last_login: item.user.last_login,
        created_at: item.user.created_at,
        avatar_url: item.user.avatar_url,
        store_user_id: item.id,
      })),
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: number) {
    const store_user = await this.prisma.store_users.findFirst({
      where: { user_id: userId },
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            username: true,
            email: true,
            phone: true,
            state: true,
            last_login: true,
            created_at: true,
            avatar_url: true,
            email_verified: true,
            user_roles: {
              include: {
                roles: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    is_system_role: true,
                  },
                },
              },
            },
            user_settings: {
              select: { config: true },
            },
          },
        },
      },
    });

    if (!store_user) {
      throw new NotFoundException('User not found in this store');
    }

    const { user_roles, user_settings, ...userData } = store_user.user;

    // Extract roles from junction table
    const roles = user_roles.map((ur: any) => ur.roles);

    // Merge user's panel_ui with defaults so the frontend sees ALL available keys
    const defaults =
      await this.defaultPanelUIService.generatePanelUI('STORE_ADMIN');
    const defaultPanelUI = defaults.panel_ui; // { ORG_ADMIN: {...}, STORE_ADMIN: {...}, ... }
    const userConfig = user_settings?.config || {};
    const userPanelUI = userConfig.panel_ui || {};

    // Merge: default keys as base, user overrides on top
    const mergedPanelUI: Record<string, Record<string, boolean>> = {};
    for (const appType of Object.keys(defaultPanelUI)) {
      mergedPanelUI[appType] = {
        ...defaultPanelUI[appType],
        ...(userPanelUI[appType] || {}),
      };
    }

    return {
      ...userData,
      store_user_id: store_user.id,
      roles,
      panel_ui: mergedPanelUI,
    };
  }

  async update(userId: number, dto: UpdateStoreUserDto) {
    // Verify user belongs to this store
    await this.findOne(userId);

    const update_data: any = { ...dto, updated_at: new Date() };

    if (dto.first_name) {
      update_data.first_name = toTitleCase(dto.first_name);
    }
    if (dto.last_name) {
      update_data.last_name = toTitleCase(dto.last_name);
    }

    const updated_user = await this.prisma.users.update({
      where: { id: userId },
      data: update_data,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        email: true,
        phone: true,
        state: true,
        created_at: true,
      },
    });

    return updated_user;
  }

  async deactivate(userId: number) {
    await this.findOne(userId);

    return this.prisma.users.update({
      where: { id: userId },
      data: {
        state: 'inactive',
        updated_at: new Date(),
      },
    });
  }

  async reactivate(userId: number) {
    await this.findOne(userId);

    return this.prisma.users.update({
      where: { id: userId },
      data: {
        state: 'active',
        updated_at: new Date(),
      },
    });
  }

  async resetPassword(userId: number, dto: ResetPasswordStoreUserDto) {
    if (dto.new_password !== dto.confirm_password) {
      throw new BadRequestException('Passwords do not match');
    }

    // Verify user belongs to this store
    await this.findOne(userId);

    const hashed_password = await bcrypt.hash(dto.new_password, 10);

    return this.prisma.users.update({
      where: { id: userId },
      data: {
        password: hashed_password,
        updated_at: new Date(),
      },
    });
  }

  /** Roles that cannot be assigned or removed through the management UI */
  private readonly IMMUTABLE_ROLES = ['owner', 'super_admin'];

  async updateRoles(userId: number, dto: UpdateUserRolesDto) {
    // Verify user belongs to this store
    await this.findOne(userId);

    // Reject if any requested role_id belongs to an immutable role
    if (dto.role_ids.length > 0) {
      const requested = await this.prisma.roles.findMany({
        where: { id: { in: dto.role_ids } },
        select: { id: true, name: true },
      });

      const forbidden = requested.filter((r) =>
        this.IMMUTABLE_ROLES.includes(r.name.toLowerCase()),
      );
      if (forbidden.length > 0) {
        throw new BadRequestException(
          `Cannot assign immutable roles: ${forbidden.map((r) => r.name).join(', ')}`,
        );
      }
    }

    // Preserve immutable roles the user already has
    const existingImmutable = await this.prisma.user_roles.findMany({
      where: {
        user_id: userId,
        roles: { name: { in: this.IMMUTABLE_ROLES } },
      },
      select: { role_id: true },
    });
    const immutableIds = existingImmutable.map((r) => r.role_id);

    // Remove only non-immutable roles
    await this.prisma.user_roles.deleteMany({
      where: {
        user_id: userId,
        role_id: { notIn: immutableIds },
      },
    });

    // Assign new roles (immutable ones already excluded above)
    if (dto.role_ids.length > 0) {
      await this.prisma.user_roles.createMany({
        data: dto.role_ids.map((role_id) => ({
          user_id: userId,
          role_id,
        })),
        skipDuplicates: true,
      });
    }

    return this.findOne(userId);
  }

  async updatePanelUI(userId: number, dto: UpdateUserPanelUIDto) {
    // Verify user belongs to this store
    await this.findOne(userId);

    // Read existing user_settings to preserve preferences
    const existing = await this.prisma.user_settings.findFirst({
      where: { user_id: userId },
    });

    const existingConfig = existing?.config || {};
    const newConfig = {
      ...existingConfig,
      panel_ui: dto.panel_ui,
    };

    if (existing) {
      await this.prisma.user_settings.update({
        where: { user_id: userId },
        data: { config: newConfig, updated_at: new Date() },
      });
    } else {
      await this.prisma.user_settings.create({
        data: {
          user_id: userId,
          app_type: 'STORE_ADMIN',
          config: newConfig,
        },
      });
    }

    return this.findOne(userId);
  }

  async getStats() {
    const excludeCustomers = {
      user: {
        user_roles: {
          none: { roles: { name: 'customer' } },
        },
      },
    };

    const [total, activos, inactivos, pendientes] = await Promise.all([
      this.prisma.store_users.count({ where: excludeCustomers }),
      this.prisma.store_users.count({
        where: {
          ...excludeCustomers,
          user: { ...excludeCustomers.user, state: 'active' },
        },
      }),
      this.prisma.store_users.count({
        where: {
          ...excludeCustomers,
          user: { ...excludeCustomers.user, state: 'inactive' },
        },
      }),
      this.prisma.store_users.count({
        where: {
          ...excludeCustomers,
          user: { ...excludeCustomers.user, state: 'pending_verification' },
        },
      }),
    ]);

    return {
      total,
      activos,
      inactivos,
      pendientes,
    };
  }
}
