import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
  UsersDashboardDto,
} from './dto';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { EmailService } from '../../email/email.service';
import * as crypto from 'crypto';
import { RequestContextService } from '../../common/context/request-context.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const {
      organization_id,
      email,
      password,
      app = 'VENDIX_LANDING',
      ...rest
    } = createUserDto;

    // Validar contexto de organización
    const context = RequestContextService.getContext();
    const target_organization_id = organization_id || context?.organization_id;

    if (!target_organization_id && !context?.is_super_admin) {
      throw new BadRequestException('Organization context is required');
    }

    const existing_user = await this.prisma.users.findFirst({
      where: {
        email,
        ...(target_organization_id && { organization_id: target_organization_id })
      },
    });
    if (existing_user) {
      throw new ConflictException(
        'User with this email already exists in this organization',
      );
    }

    const hashed_password = await bcrypt.hash(password, 10);

    const user = await this.prisma.users.create({
      data: {
        ...rest,
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
      },
    });

    // Crear user_settings con el app indicado
    let panel_ui = {};
    if (app === 'ORG_ADMIN') {
      panel_ui = {
        stores: true,
        users: true,
        dashboard: true,
        orders: true,
        analytics: true,
        reports: true,
        inventory: true,
        billing: true,
        ecommerce: true,
        audit: true,
        settings: true,
      };
    } else if (app === 'STORE_ADMIN') {
      panel_ui = {
        pos: true,
        users: true,
        dashboard: true,
        analytics: true,
        reports: true,
        billing: true,
        ecommerce: true,
        settings: true,
      };
    } else if (app === 'STORE_ECOMMERCE') {
      panel_ui = {
        profile: true,
        history: true,
        dashboard: true,
        favorites: true,
        orders: true,
        settings: true,
      };
    }
    await this.prisma.user_settings.create({
      data: {
        user_id: user.id,
        config: { app, panel_ui },
      },
    });

    // Generate email verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.prisma.email_verification_tokens.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expires_at,
      },
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
      console.error('❌ Error obteniendo slug de organización:', error);
      // Continuar sin organization slug si hay error
    }

    // Send verification email after user creation
    const full_name = `${user.first_name} ${user.last_name}`.trim();
    await this.emailService.sendVerificationEmail(
      user.email,
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
          organizations: { select: { id: true, name: true } },
          user_roles: {
            include: {
              roles: true,
            },
          },
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    return {
      data: users,
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
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findUserSettings(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      include: {
        user_settings: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
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
      throw new NotFoundException('User not found');
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
}
