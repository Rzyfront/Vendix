import {
  Injectable,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
} from '../../organization/users/dto';
import { user_state_enum } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import { toTitleCase } from '@common/utils/format.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { SyncPanelUiDto } from './dto/sync-panel-ui.dto';

const ELIGIBLE_ROLES = [
  'super_admin',
  'org_admin',
  'store_owner',
  'store_admin',
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly defaultPanelUIService: DefaultPanelUIService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    // Check if email already exists
    const existingUser = await this.prisma.users.findFirst({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    if (!createUserDto.organization_id) {
      throw new BadRequestException('organization_id is required');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // Convertir nombres a Title Case
    const formatted_first_name = toTitleCase(createUserDto.first_name || '');
    const formatted_last_name = toTitleCase(createUserDto.last_name || '');

    const user = await this.prisma.users.create({
      data: {
        email: createUserDto.email,
        first_name: formatted_first_name,
        last_name: formatted_last_name,
        username: createUserDto.username,
        password: hashedPassword,
        organization_id: createUserDto.organization_id,
        state: createUserDto.state,
      },
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Create user_settings with default ORG_ADMIN configuration
    const adminConfig =
      await this.defaultPanelUIService.generatePanelUI('ORG_ADMIN');
    await this.prisma.user_settings.create({
      data: {
        user_id: user.id,
        app_type: 'ORG_ADMIN', // Campo directo
        config: adminConfig,
      },
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async findAll(query: UserQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      state,
      organization_id,
      include_non_production,
    } = query;
    const skip = (page - 1) * Number(limit);

    const where: any = {};

    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (state) {
      where.state = state;
    }

    if (organization_id) {
      where.organization_id = organization_id;
    }

    // Filter users by organization mode (exclude demo/test by default)
    if (!include_non_production) {
      where.organizations = { mode: 'production' };
    }

    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          organizations: true,
          user_roles: {
            include: {
              roles: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    // Remove passwords from response
    const usersWithoutPasswords = users.map((user: any) => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    return {
      data: usersWithoutPasswords,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    // Check if email is being changed and if it already exists
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.prisma.users.findFirst({
        where: { email: updateUserDto.email },
      });

      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    // Hash password if it's being updated
    const updateData = { ...updateUserDto };
    if (updateUserDto.password) {
      updateData.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    // Filter out fields that don't exist in the users model
    const allowedFields = [
      'first_name',
      'last_name',
      'username',
      'email',
      'password',
      'organization_id',
      'state',
      'failed_login_attempts',
      'locked_until',
    ];

    const sanitizedData: any = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        sanitizedData[field] = updateData[field];
      }
    }

    const updatedUser = await this.prisma.users.update({
      where: { id },
      data: sanitizedData,
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async remove(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      include: {
        user_roles: true,
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    // Check if user is a super admin
    const hasSuperAdminRole = user.user_roles.some(
      (userRole: any) => userRole.roles?.name === 'super_admin',
    );

    if (hasSuperAdminRole) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_PERM_001);
    }

    // Check if user has important data that shouldn't be deleted
    const [ordersCount, auditLogsCount] = await Promise.all([
      this.prisma.orders.count({
        where: { customer_id: id },
      }),
      this.prisma.audit_logs.count({
        where: { user_id: id },
      }),
    ]);

    if (ordersCount > 0 || auditLogsCount > 0) {
      // Instead of deleting, deactivate the user
      return this.deactivateUser(id);
    }

    await this.prisma.users.delete({
      where: { id },
    });

    return { message: 'User deleted successfully' };
  }

  async activateUser(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    await this.prisma.users.update({
      where: { id },
      data: { state: user_state_enum.active },
    });

    return { message: 'User activated successfully' };
  }

  async deactivateUser(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    await this.prisma.users.update({
      where: { id },
      data: { state: user_state_enum.inactive },
    });

    return { message: 'User deactivated successfully' };
  }

  async assignRole(userId: number, roleId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    const role = await this.prisma.roles.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    // Check if role is already assigned
    const existingUserRole = await this.prisma.user_roles.findFirst({
      where: {
        user_id: userId,
        role_id: roleId,
      },
    });

    if (existingUserRole) {
      throw new ConflictException('Role already assigned to user');
    }

    await this.prisma.user_roles.create({
      data: {
        user_id: userId,
        role_id: roleId,
      },
    });

    return { message: 'Role assigned successfully' };
  }

  async removeRole(userId: number, roleId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    const role = await this.prisma.roles.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    // Check if user is trying to remove super_admin role from themselves
    if (role.name === 'super_admin') {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_PERM_001);
    }

    const userRole = await this.prisma.user_roles.findFirst({
      where: {
        user_id: userId,
        role_id: roleId,
      },
    });

    if (!userRole) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    await this.prisma.user_roles.delete({
      where: { id: userRole.id },
    });

    return { message: 'Role removed successfully' };
  }

  async getDashboardStats() {
    const [
      totalUsers,
      activeUsers,
      inactiveUsers,
      pendingUsers,
      suspendedUsers,
      archivedUsers,
      with2FA,
      emailVerified,
      usersByRole,
      recentUsers,
    ] = await Promise.all([
      // Total users
      this.prisma.users.count(),

      // Active users
      this.prisma.users.count({
        where: { state: user_state_enum.active },
      }),

      // Inactive users
      this.prisma.users.count({
        where: { state: user_state_enum.inactive },
      }),

      // Pending verification users
      this.prisma.users.count({
        where: { state: user_state_enum.pending_verification },
      }),

      // Suspended users
      this.prisma.users.count({
        where: { state: user_state_enum.suspended },
      }),

      // Archived users
      this.prisma.users.count({
        where: { state: user_state_enum.archived },
      }),

      // Users with 2FA enabled
      this.prisma.users.count({
        where: { two_factor_enabled: true },
      }),

      // Users with verified email
      this.prisma.users.count({
        where: { email_verified: true },
      }),

      // Group by role
      this.prisma.user_roles.groupBy({
        by: ['role_id'],
        _count: true,
      }),

      // Recent users
      this.prisma.users.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          organizations: true,
        },
      }),
    ]);

    // Get role details for usersByRole
    const roleIds = usersByRole.map((item: any) => item.role_id);
    const roles = await this.prisma.roles.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true },
    });

    const usersByRoleWithNames = usersByRole.map((item: any) => {
      const role = roles.find((r: any) => r.id === item.role_id);
      return {
        roleName: role?.name || 'Unknown',
        count: item._count,
      };
    });

    // Remove passwords from recent users
    const recentUsersWithoutPasswords = recentUsers.map((user: any) => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    return {
      total_usuarios: totalUsers,
      activos: activeUsers,
      inactivos: inactiveUsers,
      pendientes: pendingUsers,
      suspendidos: suspendedUsers,
      archivados: archivedUsers,
      con_2fa: with2FA,
      email_verificado: emailVerified,
      usersByRole: usersByRoleWithNames,
      recentUsers: recentUsersWithoutPasswords,
    };
  }

  async verifyEmail(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    const updatedUser = await this.prisma.users.update({
      where: { id },
      data: {
        email_verified: true,
        state:
          user.state === user_state_enum.pending_verification
            ? user_state_enum.active
            : undefined,
      },
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async toggle2FA(id: number, enabled: boolean) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    const updatedUser = await this.prisma.users.update({
      where: { id },
      data: { two_factor_enabled: enabled },
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async unlock(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_USER_001);
    }

    const updatedUser = await this.prisma.users.update({
      where: { id },
      data: {
        locked_until: null,
        failed_login_attempts: 0,
      },
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async previewPanelUISync() {
    // 1. Get current defaults from DefaultPanelUIService
    const defaults =
      await this.defaultPanelUIService.generatePanelUI('STORE_ADMIN');

    // 2. Count eligible users (those with admin/owner roles)
    const eligible_users = await this.prisma.user_settings.findMany({
      where: {
        user: {
          user_roles: {
            some: {
              roles: {
                name: { in: ELIGIBLE_ROLES },
              },
            },
          },
        },
      },
      include: {
        user: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
    });

    // 3. Calculate how many have outdated configs (missing keys)
    const default_panel_ui = defaults.panel_ui;
    let outdated_count = 0;
    const sample_diff: Record<string, string[]> = {};

    for (const settings of eligible_users) {
      const config = (settings.config as any) || {};
      const user_panel_ui = config.panel_ui || {};
      let has_missing = false;

      for (const app_type of Object.keys(default_panel_ui)) {
        const default_keys = Object.keys(default_panel_ui[app_type] || {});
        const user_keys = Object.keys(user_panel_ui[app_type] || {});
        const missing = default_keys.filter((k) => !user_keys.includes(k));

        if (missing.length > 0) {
          has_missing = true;
          if (!sample_diff[app_type]) sample_diff[app_type] = [];
          // Only track unique missing keys
          for (const m of missing) {
            if (!sample_diff[app_type].includes(m))
              sample_diff[app_type].push(m);
          }
        }
      }
      if (has_missing) outdated_count++;
    }

    return {
      total_eligible: eligible_users.length,
      outdated_count,
      eligible_roles: ELIGIBLE_ROLES,
      default_panel_ui,
      missing_keys_sample: sample_diff,
    };
  }

  async syncPanelUI(
    dto: SyncPanelUiDto,
  ): Promise<{ updated: number; skipped: number; errors: string[] }> {
    const strategy = dto.strategy || 'merge';
    const defaults =
      await this.defaultPanelUIService.generatePanelUI('STORE_ADMIN');
    const default_panel_ui = defaults.panel_ui;

    // Build where clause
    const where: any = {
      user: {
        user_roles: {
          some: {
            roles: {
              name: { in: ELIGIBLE_ROLES },
            },
          },
        },
      },
    };

    // If specific user_ids provided, add filter
    if (dto.user_ids && dto.user_ids.length > 0) {
      where.user_id = { in: dto.user_ids };
    }

    // Get all eligible user_settings
    const settings_list = await this.prisma.user_settings.findMany({
      where,
      include: {
        user: { select: { id: true, email: true } },
      },
    });

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Determine which app_types to sync
    const target_app_types =
      dto.app_types && dto.app_types.length > 0
        ? dto.app_types
        : Object.keys(default_panel_ui);

    for (const settings of settings_list) {
      try {
        const config = (settings.config as any) || {};
        const current_panel_ui = config.panel_ui || {};
        let changed = false;

        const new_panel_ui = { ...current_panel_ui };

        for (const app_type of target_app_types) {
          if (!default_panel_ui[app_type]) continue;

          if (strategy === 'replace') {
            new_panel_ui[app_type] = { ...default_panel_ui[app_type] };
            changed = true;
          } else {
            // merge: add missing keys, keep existing values
            const current_app = current_panel_ui[app_type] || {};
            const merged = { ...current_app };

            for (const [key, value] of Object.entries(
              default_panel_ui[app_type],
            )) {
              if (!(key in merged)) {
                merged[key] = value;
                changed = true;
              }
            }

            new_panel_ui[app_type] = merged;
          }
        }

        if (!changed && strategy === 'merge') {
          skipped++;
          continue;
        }

        // Update user_settings
        await this.prisma.user_settings.update({
          where: { id: settings.id },
          data: {
            config: {
              ...config,
              panel_ui: new_panel_ui,
            },
            updated_at: new Date(),
          },
        });

        updated++;
      } catch (error) {
        errors.push(
          `User #${settings.user_id} (${settings.user?.email}): ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Panel UI sync completed: ${updated} updated, ${skipped} skipped, ${errors.length} errors (strategy: ${strategy})`,
    );

    return { updated, skipped, errors };
  }
}
