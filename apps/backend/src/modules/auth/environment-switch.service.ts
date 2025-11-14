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
      const store = await this.prismaService.stores.findUnique({
        where: { domain: storeSlug },
        include: {
          organizations: true,
        },
      });

      if (!store) {
        throw new NotFoundException('Tienda no encontrada');
      }

      // Verificar que el usuario pertenezca a la organización de la tienda
      const hasAccess =
        userRoles.includes('super_admin') ||
        userRoles.includes('owner') ||
        store.organizations.owner_id === userId;

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

    // Generar tokens simples para el cambio de entorno
    const payload = {
      sub: user.id,
      email: user.email,
      environment: targetEnvironment,
      storeSlug: storeSlug,
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

    // Obtener permisos y roles actualizados
    const permissions = this.getPermissionsFromRoles(user.user_roles);
    const roles = userRoles;

    // Registrar el cambio de entorno en auditoría
    await this.auditService.log({
      userId: userId,
      action: AuditAction.UPDATE,
      resource: AuditResource.USERS,
      metadata: `Cambio de entorno a ${targetEnvironment}${storeSlug ? ` (tienda: ${storeSlug})` : ''}`,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        roles,
        permissions,
      },
      tokens,
      permissions,
      roles,
      updatedEnvironment: targetEnvironment,
    };
  }

  // Método auxiliar para obtener permisos de roles
  private getPermissionsFromRoles(userRoles: any[]): string[] {
    const permissions = new Set<string>();

    for (const userRole of userRoles) {
      if (userRole.roles?.role_permissions) {
        for (const rolePermission of userRole.roles.role_permissions) {
          if (rolePermission.permissions?.name) {
            permissions.add(rolePermission.permissions.name);
          }
        }
      }
    }

    return Array.from(permissions);
  }
}
