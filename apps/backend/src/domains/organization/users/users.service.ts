import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
  UsersDashboardDto,
  UserConfigDto,
  InviteUserDto,
} from './dto';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { EmailService } from '../../../email/email.service';
import * as crypto from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../../../common/audit/audit.service';
import { S3Service } from '@common/services/s3.service';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import { StaffProvisioningService } from '@common/services/staff-provisioning.service';
import { toTitleCase } from '@common/utils/format.util';

@Injectable()
export class UsersService {
  constructor(
    private prisma: OrganizationPrismaService,
    private emailService: EmailService,
    private auditService: AuditService,
    private s3Service: S3Service,
    private defaultPanelUIService: DefaultPanelUIService,
    private staffProvisioning: StaffProvisioningService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const {
      organization_id,
      email,
      password,
      role_id,
      main_store_id,
      // `app` ya no dirige el app_type (se deriva del rol, CD5). Se
      // desestructura solo para excluirlo del spread a `users.create`.
      app: _app,
      ...rest
    } = createUserDto;

    // Validar contexto de organización
    const context = RequestContextService.getContext();
    const target_organization_id = organization_id || context?.organization_id;

    if (!target_organization_id && !context?.is_super_admin) {
      throw new BadRequestException('Organization context is required');
    }

    // CD5/CD7: toda creación exige rol; el app_type se deriva del rol
    // (nunca VENDIX_LANDING). Regla de negocio: cliente creado en tienda →
    // STORE_ECOMMERCE; owner/admin/super_admin → ORG_ADMIN (tienda opcional);
    // el resto (manager/supervisor/employee/staff) → STORE_ADMIN. Las cuentas
    // scoped a tienda (STORE_ADMIN/STORE_ECOMMERCE) exigen tienda para no
    // dejar huérfanos.
    if (!role_id) {
      throw new BadRequestException(
        'Debe indicar el rol del usuario (role_id)',
      );
    }
    const role = await this.prisma.roles.findFirst({ where: { id: role_id } });
    if (!role) {
      throw new VendixHttpException(ErrorCodes.AUTH_ROLE_001);
    }
    const isCustomer = role.name?.toLowerCase() === 'customer';

    // A1: unicidad de email SOLO para cuentas no-customer (staff/owner). Un
    // customer con el mismo correo en otra org/tienda no bloquea.
    if (!isCustomer) {
      await this.staffProvisioning.assertEmailAvailableForStaff(email);
    }

    const isOrgLevel = StaffProvisioningService.hasHighPrivilege([role.name]);
    const appType = isCustomer
      ? 'STORE_ECOMMERCE'
      : isOrgLevel
        ? 'ORG_ADMIN'
        : 'STORE_ADMIN';

    if (appType !== 'ORG_ADMIN' && !main_store_id) {
      throw new BadRequestException(
        'Debe seleccionar una tienda para este rol',
      );
    }

    const hashed_password = await bcrypt.hash(password, 10);

    // Convertir nombres a Title Case
    const formatted_first_name = toTitleCase(rest.first_name || '');
    const formatted_last_name = toTitleCase(rest.last_name || '');

    // Generate email verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Todo dentro de una sola transacción (usuario + membresía + rol +
    // user_settings + main_store + token) para que la invariante CD7 se
    // cumpla atómicamente: no existe un usuario a medio provisionar.
    const user = await this.prisma.withoutScope().$transaction(async (tx) => {
      // `db: any` para las operaciones crudas (convención del repo); `tx`
      // tipado se pasa al helper que exige `Prisma.TransactionClient`.
      const db: any = tx;
      const created = await db.users.create({
        data: {
          ...rest,
          first_name: formatted_first_name,
          last_name: formatted_last_name,
          email,
          password: hashed_password,
          ...(target_organization_id && {
            organizations: { connect: { id: target_organization_id } },
          }),
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          state: true,
          organization_id: true,
        },
      });

      if (appType === 'STORE_ADMIN' || appType === 'STORE_ECOMMERCE') {
        // Cuenta scoped a tienda: store_users + user_roles + user_settings.
        // STORE_ADMIN (staff) fija main_store_id como tienda de arranque del
        // panel; STORE_ECOMMERCE (cliente) NO usa main_store_id (igual que el
        // camino real de cliente en customers.service), solo la membresía.
        await this.staffProvisioning.provisionStaffMembership(tx, {
          userId: created.id,
          storeId: main_store_id!,
          organizationId: target_organization_id!,
          roleName: role.name,
          appType,
          setMainStore: appType === 'STORE_ADMIN',
        });
      } else if (main_store_id) {
        // Rol org-level pero con tienda indicada (owner/admin multi-tienda):
        // provisiona la membresía sin degradar un main_store existente.
        await this.staffProvisioning.provisionStaffMembership(tx, {
          userId: created.id,
          storeId: main_store_id,
          organizationId: target_organization_id!,
          roleName: role.name,
          appType: 'ORG_ADMIN',
          setMainStore: 'if-empty',
        });
      } else {
        // Rol org-level sin tienda: rol + user_settings(ORG_ADMIN) directos
        // (provisionStaffMembership requiere una tienda).
        await db.user_roles.upsert({
          where: {
            user_id_role_id: { user_id: created.id, role_id: role.id },
          },
          update: {},
          create: { user_id: created.id, role_id: role.id },
        });
        const orgConfig =
          await this.defaultPanelUIService.generatePanelUI('ORG_ADMIN');
        await db.user_settings.create({
          data: {
            user_id: created.id,
            app_type: 'ORG_ADMIN' as any,
            config: orgConfig as any,
          },
        });
      }

      await db.email_verification_tokens.create({
        data: {
          user_id: created.id,
          token,
          expires_at: expires_at,
        },
      });

      return created;
    });

    // Obtener el slug de la organización para el vLink
    let organization_slug: string | undefined;
    try {
      if (user.organization_id) {
        const organization = await this.prisma.organizations.findUnique({
          where: { id: user.organization_id },
          select: { slug: true },
        });
        organization_slug = organization?.slug;
      }
    } catch (error) {
      // Continuar sin organization slug si hay error
    }

    // Send verification email after user creation
    const full_name = `${user.first_name} ${user.last_name}`.trim();
    await this.emailService.sendVerificationEmail(
      email,
      token,
      full_name,
      organization_slug,
    );

    return user;
  }

  async findAll(query: UserQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      state,
      organization_id,
      role,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.usersWhereInput = {
      // Excluir usuarios suspended y archived por defecto
      state: { notIn: ['suspended', 'archived'] },
      ...(search && {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(state && { state }),
      ...(role && {
        user_roles: {
          some: {
            roles: {
              name: role,
            },
          },
        },
      }),
    };

    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          state: true,
          last_login: true,
          created_at: true,
          email_verified: true,
          two_factor_enabled: true,
          organization_id: true,
          avatar_url: true,
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    const signedUsers = await Promise.all(
      users.map(async (user) => ({
        ...user,
        avatar_url: await this.s3Service.signUrl(user.avatar_url, true),
      })),
    );

    return {
      data: signedUsers,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, includeSuspended = false) {
    const where: Prisma.usersWhereInput = { id };

    if (!includeSuspended) {
      where.state = { notIn: ['suspended', 'archived'] };
    }

    const user = await this.prisma.users.findFirst({
      where,
      include: {
        organizations: true,
        user_roles: { include: { roles: true } },
        store_users: { include: { store: true } },
        user_settings: true,
      },
    });
    if (!user) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_001);
    }
    return {
      ...user,
      avatar_url: await this.s3Service.signUrl(user.avatar_url),
    };
  }

  async findUserSettings(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      include: {
        user_settings: true,
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_001);
    }

    return {
      ...user,
      avatar_url: await this.s3Service.signUrl(user.avatar_url),
    };
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    await this.findOne(id);
    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }
    return this.prisma.users.update({
      where: { id },
      data: { ...updateUserDto, updated_at: new Date() },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.users.update({
      where: { id },
      data: {
        state: 'suspended',
        updated_at: new Date(),
      },
    });
  }

  async archive(id: number) {
    await this.findOne(id);
    return this.prisma.users.update({
      where: { id },
      data: {
        state: 'archived',
        updated_at: new Date(),
      },
    });
  }

  async reactivate(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });
    if (!user) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_001);
    }
    if (user.state !== 'suspended' && user.state !== 'archived') {
      throw new ConflictException('User is not suspended or archived');
    }
    return this.prisma.users.update({
      where: { id },
      data: {
        state: 'active',
        updated_at: new Date(),
      },
    });
  }

  async getDashboard(query: UsersDashboardDto) {
    // Estadísticas generales de usuarios
    const [
      totalUsuarios,
      usuariosActivos,
      usuariosPendientes,
      usuariosCon2FA,
      usuariosInactivos,
      usuariosSuspendidos,
      usuariosEmailVerificado,
      usuariosArchivados,
    ] = await Promise.all([
      // Total Usuarios
      this.prisma.users.count(),

      // Activos
      this.prisma.users.count({
        where: {
          state: 'active',
        },
      }),

      // Pendientes
      this.prisma.users.count({
        where: {
          state: 'pending_verification',
        },
      }),

      // Con 2FA
      this.prisma.users.count({
        where: {
          two_factor_enabled: true,
        },
      }),

      // Inactivos
      this.prisma.users.count({
        where: {
          state: 'inactive',
        },
      }),

      // Suspendidos
      this.prisma.users.count({
        where: {
          state: 'suspended',
        },
      }),

      // Email Verificado
      this.prisma.users.count({
        where: {
          email_verified: true,
        },
      }),

      // Archivados
      this.prisma.users.count({
        where: {
          state: 'archived',
        },
      }),
    ]);

    return {
      data: {
        total_usuarios: totalUsuarios,
        activos: usuariosActivos,
        pendientes: usuariosPendientes,
        con_2fa: usuariosCon2FA,
        inactivos: usuariosInactivos,
        suspendidos: usuariosSuspendidos,
        email_verificado: usuariosEmailVerificado,
        archivados: usuariosArchivados,
      },
    };
  }

  async verifyEmail(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_001);
    }

    const old_state = user.state;

    // Update user state to active (or keep current state if suspended/archived)
    const new_state =
      user.state === 'pending_verification' ? 'active' : user.state;

    const updated_user = await this.prisma.users.update({
      where: { id },
      data: {
        state: new_state,
        email_verified: true,
        updated_at: new Date(),
      },
    });

    // Delete any existing email verification tokens
    await this.prisma.email_verification_tokens.deleteMany({
      where: { user_id: id },
    });

    // Log the action
    await this.auditService.logUpdate(
      id,
      AuditResource.USERS,
      id,
      { state: old_state },
      { state: new_state, email_verified: true },
      {
        action: 'verify_email',
        verified_by: 'admin',
      },
    );

    return updated_user;
  }

  async resetPassword(id: number, resetPasswordDto: any) {
    const { new_password, confirm_password } = resetPasswordDto;

    // Validate passwords match
    if (new_password !== confirm_password) {
      throw new BadRequestException('Passwords do not match');
    }

    // Validate password length
    if (new_password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long',
      );
    }

    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_001);
    }

    // Hash the new password
    const hashed_password = await bcrypt.hash(new_password, 10);

    // Update user password
    const updated_user = await this.prisma.users.update({
      where: { id },
      data: {
        password_hash: hashed_password,
        updated_at: new Date(),
      },
    });

    // Log the action
    await this.auditService.logUpdate(
      id,
      AuditResource.USERS,
      id,
      { password_hash: '[REDACTED]' },
      { password_hash: '[REDACTED]' },
      {
        action: 'reset_password',
        reset_by_admin: true,
      },
    );

    return updated_user;
  }

  async findConfiguration(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
        store_users: true,
        user_settings: true,
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_001);
    }

    const config: UserConfigDto = {
      app: user.user_settings[0]?.app_type || 'VENDIX_LANDING',
      roles: user.user_roles.map((ur) => ur.role_id),
      store_ids: user.store_users.map((su) => su.store_id),
      panel_ui: user.user_settings[0]?.config?.panel_ui || {},
    };

    return config;
  }

  async updateConfiguration(id: number, configDto: UserConfigDto) {
    const { app, roles, store_ids, panel_ui } = configDto;

    return this.prisma.$transaction(async (tx) => {
      const existingSettings = await tx.user_settings.findFirst({
        where: { user_id: id },
      });

      if (existingSettings) {
        const existingConfig = existingSettings.config || {};

        await tx.user_settings.update({
          where: { id: existingSettings.id },
          data: {
            app_type: app,
            config: {
              ...existingConfig,
              panel_ui,
            },
            updated_at: new Date(),
          },
        });
      } else {
        await tx.user_settings.create({
          data: {
            user_id: id,
            app_type: app,
            config: { panel_ui },
          },
        });
      }

      // 2. Update Roles
      if (roles) {
        // Remove roles not in the new list
        await tx.user_roles.deleteMany({
          where: {
            user_id: id,
            role_id: { notIn: roles },
          },
        });

        // Add new roles
        for (const roleId of roles) {
          const exists = await tx.user_roles.findFirst({
            where: { user_id: id, role_id: roleId },
          });
          if (!exists) {
            await tx.user_roles.create({
              data: {
                user_id: id,
                role_id: roleId,
              },
            });
          }
        }
      }

      // 3. Update Stores (A3: staff no-privilegiado = exactamente 1 tienda)
      if (store_ids) {
        // Resolver los roles efectivos (nuevos si vienen, si no los actuales)
        // para decidir si es privilegio alto (owner/admin/super_admin).
        const effectiveRoleIds =
          roles ??
          (
            await tx.user_roles.findMany({
              where: { user_id: id },
              select: { role_id: true },
            })
          ).map((ur) => ur.role_id);
        const roleRows = await tx.roles.findMany({
          where: { id: { in: effectiveRoleIds } },
          select: { name: true },
        });
        const isHighPriv = StaffProvisioningService.hasHighPrivilege(
          roleRows.map((r) => r.name),
        );

        // A3: un usuario de tienda debe tener EXACTAMENTE una tienda. Los
        // privilegios altos (owner/admin) pueden ser multi-tienda.
        if (!isHighPriv && store_ids.length !== 1) {
          throw new BadRequestException(
            'Un usuario de tienda debe tener exactamente una tienda asignada. ' +
              'Solo propietarios/administradores pueden pertenecer a varias.',
          );
        }

        // Remove stores not in the new list
        await tx.store_users.deleteMany({
          where: {
            user_id: id,
            store_id: { notIn: store_ids },
          },
        });

        // Add new stores
        for (const storeId of store_ids) {
          const exists = await tx.store_users.findFirst({
            where: { user_id: id, store_id: storeId },
          });
          if (!exists) {
            await tx.store_users.create({
              data: {
                user_id: id,
                store_id: storeId,
              },
            });
          }
        }

        // main_store_id como driver (CD4/CD7): staff de tienda apunta a su
        // única tienda; privilegio alto solo se fija si está vacío (no pisa
        // el arranque de un owner multi-tienda).
        if (store_ids.length > 0) {
          if (!isHighPriv) {
            await tx.users.update({
              where: { id },
              data: { main_store_id: store_ids[0] },
            });
          } else {
            const current = await tx.users.findUnique({
              where: { id },
              select: { main_store_id: true },
            });
            if (current?.main_store_id == null) {
              await tx.users.update({
                where: { id },
                data: { main_store_id: store_ids[0] },
              });
            }
          }
        }
      }

      return this.findConfiguration(id);
    });
  }

  async invite(inviteDto: InviteUserDto) {
    const { first_name, last_name, email, app = 'VENDIX_LANDING' } = inviteDto;

    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;

    if (!organization_id && !context?.is_super_admin) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    // A1: solo bloquea si el correo ya pertenece a una cuenta staff/owner.
    // El usuario invitado nace sin rol/tienda (pending_verification): queda
    // como "requiere segundo paso" — el login huérfano lo bloquea A4 hasta
    // que se le asigne rol + tienda vía updateConfiguration/store-users.
    await this.staffProvisioning.assertEmailAvailableForStaff(email);

    const formatted_first_name = toTitleCase(first_name || '');
    const formatted_last_name = toTitleCase(last_name || '');

    const tempPassword = crypto.randomBytes(16).toString('hex');
    const hashed_password = await bcrypt.hash(tempPassword, 10);

    const user = await this.prisma.users.create({
      data: {
        first_name: formatted_first_name,
        last_name: formatted_last_name,
        username:
          email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_') + '_' + Date.now(),
        email,
        password: hashed_password,
        state: 'pending_verification',
        ...(organization_id && {
          organizations: { connect: { id: organization_id } },
        }),
        updated_at: new Date(),
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        email: true,
        state: true,
      },
    });

    const config = await this.defaultPanelUIService.generatePanelUI(app);
    await this.prisma.user_settings.create({
      data: {
        user_id: user.id,
        app_type: app,
        config: config,
      },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.email_verification_tokens.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expires_at,
      },
    });

    let organization_slug: string | undefined;
    try {
      if (user.organization_id) {
        const organization = await this.prisma.organizations.findUnique({
          where: { id: user.organization_id },
          select: { slug: true },
        });
        organization_slug = organization?.slug;
      }
    } catch {
      // Continue without slug
    }

    const full_name = `${user.first_name} ${user.last_name}`.trim();
    await this.emailService.sendInvitationEmail(
      user.email,
      token,
      full_name,
      organization_slug,
      app,
    );

    return {
      user_id: user.id,
      token,
    };
  }
}
