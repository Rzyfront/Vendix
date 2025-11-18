import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../audit/audit.service';

@Injectable()
export class EnvironmentSwitchService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async switchEnvironment(
    userId: number,
    targetEnvironment: 'STORE_ADMIN' | 'ORG_ADMIN',
    storeSlug?: string,
  ) {
    // Validar que el usuario exista
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
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
      throw new UnauthorizedException('Usuario no encontrado');
    }

    // Validar el entorno objetivo
    if (targetEnvironment === 'STORE_ADMIN' && !storeSlug) {
      throw new BadRequestException(
        'Se requiere el slug de la tienda para cambiar a STORE_ADMIN',
      );
    }

    // Verificar que el usuario tenga los roles necesarios
    const userRoles = user.user_roles.map((ur) => ur.roles.name);

    let storeId = null;
    if (targetEnvironment === 'STORE_ADMIN') {
      const hasStoreRole =
        userRoles.includes('store_admin') ||
        userRoles.includes('owner') ||
        userRoles.includes('manager');

      if (!hasStoreRole) {
        throw new UnauthorizedException(
          'No tienes permisos para acceder al entorno de tienda',
        );
      }

      // Verificar que la tienda exista y el usuario tenga acceso
      const store = await this.prismaService.stores.findFirst({
        where: {
          slug: storeSlug,
          organization_id: user.organization_id,
        },
        include: {
          organizations: true,
          store_users: {
            where: {
              user_id: userId,
            },
          },
        },
      });

      if (!store) {
        throw new NotFoundException('Tienda no encontrada');
      }

      // Verificar que el usuario pertenezca a la organización de la tienda o esté asignado a la tienda
      const hasAccess =
        userRoles.includes('super_admin') ||
        userRoles.includes('owner') ||
        store.organizations.owner_id === userId ||
        store.store_users.length > 0;

      if (!hasAccess) {
        throw new UnauthorizedException('No tienes acceso a esta tienda');
      }

      storeId = store.id;
    }

    if (targetEnvironment === 'ORG_ADMIN') {
      const hasOrgRole =
        userRoles.includes('org_admin') ||
        userRoles.includes('owner') ||
        userRoles.includes('super_admin');

      if (!hasOrgRole) {
        throw new UnauthorizedException(
          'No tienes permisos para acceder al entorno de organización',
        );
      }
    }

    // Generar tokens con scope específico para el cambio de entorno
    const payload = {
      sub: user.id,
      email: user.email,
      environment: targetEnvironment,
      storeSlug: storeSlug,
      organizationId: storeId
        ? (
            await this.prismaService.stores.findUnique({
              where: { id: storeId },
              select: { organization_id: true },
            })
          )?.organization_id || user.organization_id
        : user.organization_id,
      storeId: storeId,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN', '1h'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    const tokens = {
      accessToken,
      refreshToken,
    };

    // Primero actualizar user settings con el nuevo entorno (antes de consultar)
    await this.prismaService.user_settings.upsert({
      where: { user_id: userId },
      update: {
        config: {
          app: targetEnvironment,
        },
      },
      create: {
        user_id: userId,
        config: {
          app: targetEnvironment,
        },
      },
    });

    // Obtener el usuario completo con todas las relaciones necesarias
    const completeUser = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
        organizations: true,
        addresses: true,
      },
    });

    // Transformar user_roles a roles array simple para compatibilidad con frontend
    const { user_roles, ...userWithoutRoles } = completeUser;
    const roles = user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];

    console.log('🔍 SWITCH - Transformación de roles:', {
      user_id: userId,
      targetEnvironment,
      original_user_roles_count: user_roles?.length || 0,
      transformed_roles: roles,
    });

    const userWithRolesArray = {
      ...userWithoutRoles,
      roles, // Array simple: ["owner", "admin"]
    };

    // Obtener user_settings actualizados (después de la actualización)
    const userSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userId },
    });

    // Registrar el cambio de entorno en auditoría
    await this.auditService.log({
      userId: userId,
      action: AuditAction.UPDATE,
      resource: AuditResource.USERS,
      metadata: {
        action: 'environment_switch',
        targetEnvironment,
        storeSlug: storeSlug || null,
      },
    });

    // Remover password del response (igual que en login)
    const { password, ...userWithRolesAndPassword } =
      userWithRolesArray || user;

    // Estructura idéntica a la del login: { user, user_settings, ...tokens }
    const response = {
      user: userWithRolesAndPassword, // Usar usuario con roles array simple
      user_settings: userSettings,
      access_token: accessToken, // Formato igual que login
      refresh_token: refreshToken, // Formato igual que login
      token_type: 'Bearer', // Igual que login
      expires_in: 3600, // Igual que login
      updatedEnvironment: targetEnvironment, // Campo adicional específico del switch
    };

    return response;
  }
}
