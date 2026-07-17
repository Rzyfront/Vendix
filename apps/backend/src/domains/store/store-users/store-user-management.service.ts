import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import { StaffProvisioningService } from '../../../common/services/staff-provisioning.service';
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
    private staffProvisioning: StaffProvisioningService,
  ) {}

  async create(dto: CreateStoreUserDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const organization_id = context?.organization_id;

    if (!store_id || !organization_id) {
      throw new BadRequestException('Store and organization context required');
    }

    // A1 (hard check): a staff/owner account must have a globally-unique email.
    // Throws VendixHttpException ORG_USER_002 (409) if a non-customer account
    // already uses this email anywhere in Vendix.
    await this.staffProvisioning.assertEmailAvailableForStaff(dto.email);

    // UX-only guard: also reject if a user with this email is already linked to
    // this store (friendlier message than the generic uniqueness error).
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

    // Fase B2: el rol es parametrizable (default `employee`, preservando el
    // comportamiento previo). Regla adoptada: `carrier` (Vendix Repartos)
    // fuerza app_type=STORE_DELIVERY; el resto opera bajo STORE_ADMIN.
    const roleName = dto.role ?? 'employee';
    const appType: 'STORE_ADMIN' | 'STORE_DELIVERY' =
      roleName === 'carrier' ? 'STORE_DELIVERY' : 'STORE_ADMIN';

    // Create the user and provision its staff membership atomically. The
    // StaffProvisioningService handles store_users + user_roles + user_settings
    // (default panel_ui) + users.main_store_id, satisfying CD7 (role +
    // main_store_id were previously missing here).
    return this.prisma.withoutScope().$transaction(async (tx) => {
      const user = await tx.users.create({
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

      await this.staffProvisioning.provisionStaffMembership(tx, {
        userId: user.id,
        storeId: store_id,
        organizationId: organization_id,
        roleName,
        appType,
        setMainStore: true,
      });

      return user;
    });
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

    // Fase B2: mantener user_settings.app_type coherente con el rol `carrier`.
    // Regla adoptada: rol `carrier` (Vendix Repartos) ⇒ app_type=STORE_DELIVERY.
    // Al quitarlo degradamos SOLO a un carrier "puro" (app_type actual
    // STORE_DELIVERY y sin rol de alto privilegio); nunca degradamos a un
    // admin/owner (owner/admin/super_admin conservan su app_type intacto).
    await this.syncCarrierAppType(userId);

    return this.findOne(userId);
  }

  /**
   * Sincroniza `user_settings.app_type` con la presencia del rol `carrier`
   * tras un cambio de roles (Fase B2 — Vendix Repartos).
   *
   * - Añadir/conservar `carrier` ⇒ fuerza `STORE_DELIVERY`, salvo que el
   *   usuario conserve un rol de alto privilegio (owner/admin/super_admin),
   *   en cuyo caso NO se toca su app_type para no romper su acceso admin.
   * - Quitar `carrier` a un carrier puro (app_type actual `STORE_DELIVERY`
   *   y sin alto privilegio) ⇒ degrada a `STORE_ADMIN`.
   * - En cualquier otro caso, `app_type` se deja intacto.
   */
  private async syncCarrierAppType(userId: number): Promise<void> {
    const finalRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { roles: { select: { name: true } } },
    });
    const finalRoleNames = finalRoles.map((r) => r.roles.name.toLowerCase());
    const willHaveCarrier = finalRoleNames.includes('carrier');
    const isHighPrivilege =
      StaffProvisioningService.hasHighPrivilege(finalRoleNames);

    const settings = await this.prisma.user_settings.findFirst({
      where: { user_id: userId },
      select: { app_type: true },
    });

    let nextAppType: 'STORE_DELIVERY' | 'STORE_ADMIN' | null = null;
    if (willHaveCarrier) {
      // No degradar a un admin de alto privilegio hacia la app de reparto.
      if (!isHighPrivilege) nextAppType = 'STORE_DELIVERY';
    } else if (settings?.app_type === 'STORE_DELIVERY' && !isHighPrivilege) {
      // Carrier puro que pierde el rol: recupera acceso al panel de tienda.
      nextAppType = 'STORE_ADMIN';
    }

    if (!nextAppType) return;
    if (settings && settings.app_type === nextAppType) return;

    if (settings) {
      await this.prisma.user_settings.update({
        where: { user_id: userId },
        data: { app_type: nextAppType as any, updated_at: new Date() },
      });
    } else {
      // Caso legacy sin user_settings: crear con el app_type derivado.
      const defaultConfig =
        await this.defaultPanelUIService.generatePanelUI(nextAppType);
      await this.prisma.user_settings.create({
        data: {
          user_id: userId,
          app_type: nextAppType as any,
          config: defaultConfig as any,
        },
      });
    }
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
