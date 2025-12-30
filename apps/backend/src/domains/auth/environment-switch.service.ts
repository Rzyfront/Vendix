import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  AuditService,
  AuditLogData,
  AuditAction,
  AuditResource,
} from '../../common/audit/audit.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EnvironmentSwitchService {
  constructor(
    private readonly prismaService: GlobalPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) { }

  async switchEnvironment(
    userId: number,
    targetEnvironment: 'STORE_ADMIN' | 'ORG_ADMIN',
    storeSlug?: string,
    client_info?: { ip_address?: string; user_agent?: string },
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
    const user_role_names = user.user_roles
      .map((ur) => ur.roles?.name)
      .filter((name): name is string => Boolean(name));

    let store_id: number | null = null;
    let active_store: any = null;

    // 1. Lógica para STORE_ADMIN
    if (targetEnvironment === 'STORE_ADMIN') {
      const has_store_role =
        user_role_names.includes('store_admin') ||
        user_role_names.includes('owner') ||
        user_role_names.includes('manager') ||
        user_role_names.includes('admin') ||
        user_role_names.includes('super_admin');

      if (!has_store_role) {
        throw new UnauthorizedException(
          'No tienes permisos para acceder al entorno de tienda',
        );
      }

      // Auto-selección de tienda si no se proporciona slug
      let effective_store_slug = storeSlug;
      const has_high_privilege =
        user_role_names.includes('owner') ||
        user_role_names.includes('admin') ||
        user_role_names.includes('super_admin');

      if (!effective_store_slug) {
        console.log('🔄 SWITCH - STORE_ADMIN switch without slug - Attempting to auto-select store context');

        // Estrategia 1: Main Store
        if (user.main_store_id) {
          const main_store = await this.prismaService.stores.findUnique({
            where: { id: user.main_store_id },
          });

          if (main_store && main_store.organization_id === user.organization_id) {
            const has_access = await this.prismaService.store_users.findUnique({
              where: {
                store_id_user_id: {
                  store_id: main_store.id,
                  user_id: user.id
                }
              }
            });

            if (has_access || has_high_privilege) {
              effective_store_slug = main_store.slug;

              // AUTO-RELATION
              if (has_high_privilege && !has_access) {
                console.log(`✨ SWITCH - Creating automatic store_users relation in Main Store: ${main_store.slug}`);
                await this.prismaService.store_users.create({
                  data: { store_id: main_store.id, user_id: user.id }
                });
              }
            }
          }
        }

        // Estrategia 2: Primera tienda disponible (donde YA tiene acceso)
        if (!effective_store_slug) {
          const first_store_user = await this.prismaService.store_users.findFirst({
            where: {
              user_id: user.id,
              store: { organization_id: user.organization_id }
            },
            include: { store: true }
          });
          if (first_store_user?.store) {
            effective_store_slug = first_store_user.store.slug;
          }
        }

        // Estrategia 3: High Privilege Fallback
        if (!effective_store_slug && has_high_privilege) {
          const first_org_store = await this.prismaService.stores.findFirst({
            where: { organization_id: user.organization_id }
          });
          if (first_org_store) {
            effective_store_slug = first_org_store.slug;
            // AUTO-RELATION
            console.log(`✨ SWITCH - Creating automatic store_users relation in Fallback Store: ${first_org_store.slug}`);
            await this.prismaService.store_users.create({
              data: { store_id: first_org_store.id, user_id: user.id }
            });
          }
        }
      }

      if (!effective_store_slug) {
        throw new BadRequestException(
          'No se pudo determinar el contexto de tienda. Proporcione store_slug explícitamente.',
        );
      }

      // Verificar la tienda final
      const store = await this.prismaService.stores.findFirst({
        where: {
          slug: effective_store_slug,
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

      // Verificar acceso final (redundante pero seguro)
      const has_access =
        has_high_privilege ||
        store.store_users.length > 0;

      if (!has_access) {
        // Doble check por si se acaba de crear la relación y prisma no la trajo en el include anterior (aunque unlikely en misma transacción, pero aquí son commmits distintos)
        const specific_access = await this.prismaService.store_users.findFirst({
          where: { store_id: store.id, user_id: userId }
        });

        if (!specific_access) {
          throw new UnauthorizedException('No tienes acceso a esta tienda');
        }
      }

      store_id = store.id;
      active_store = store;
    }

    if (targetEnvironment === 'ORG_ADMIN') {
      const has_org_role =
        user_role_names.includes('org_admin') ||
        user_role_names.includes('owner') ||
        user_role_names.includes('super_admin');

      if (!has_org_role) {
        throw new UnauthorizedException(
          'No tienes permisos para acceder al entorno de organización',
        );
      }
    }

    // Generar tokens con scope específico para el cambio de entorno
    // Usar el MISMO formato que auth.service.ts para que el JwtStrategy funcione correctamente
    let organization_id: number;
    if (store_id) {
      // Switch a STORE_ADMIN: usar la org del store seleccionado
      const store = await this.prismaService.stores.findUnique({
        where: { id: store_id },
        select: { organization_id: true },
      });
      organization_id = store?.organization_id || user.organization_id;
    } else {
      // Switch a ORG_ADMIN: volver a la org original del usuario
      organization_id = user.organization_id;
    }

    const payload = {
      sub: user.id,
      organization_id: organization_id, // ✅ snake_case como en auth.service.ts
      store_id: store_id, // ✅ snake_case como en auth.service.ts
    };

    const accessTokenExpiry =
      this.configService.get<string>('JWT_EXPIRES_IN') || '1h';
    const refreshTokenExpiry =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';

    const access_token = this.jwtService.sign(payload, {
      expiresIn: accessTokenExpiry as any,
    });

    const refresh_token = this.jwtService.sign(payload, {
      expiresIn: refreshTokenExpiry as any,
    });

    // Guardar sesión en DB
    await this.createUserSession(user.id, refresh_token, client_info);

    const tokens = {
      access_token: access_token,
      refresh_token: refresh_token,
    };

    // Obtener configuración actual para no perder preferencias (ej: panel_ui)
    const currentSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userId },
    });

    const currentConfig = (currentSettings?.config as Record<string, any>) || {};
    const newConfig = {
      ...currentConfig,
      app: targetEnvironment,
    };

    // Primero actualizar user settings con el nuevo entorno (antes de consultar)
    await this.prismaService.user_settings.upsert({
      where: { user_id: userId },
      update: {
        config: newConfig,
      },
      create: {
        user_id: userId,
        config: {
          app: targetEnvironment,
        },
      },
    });

    // También actualizar main_store_id cuando se cambia a STORE_ADMIN
    if (targetEnvironment === 'STORE_ADMIN' && store_id) {
      await this.prismaService.users.update({
        where: { id: userId },
        data: { main_store_id: store_id },
      });
      console.log('🔍 SWITCH - Updated main_store_id:', {
        user_id: userId,
        targetEnvironment,
        store_id,
        main_store_id: store_id,
      });
    }

    // Obtener el usuario completo con todas las relaciones necesarias
    const complete_user = await this.prismaService.users.findUnique({
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

    if (!complete_user) {
      throw new Error('Usuario no encontrado');
    }

    // Transformar user_roles a roles array simple para compatibilidad con frontend
    const { user_roles, ...user_without_roles } = complete_user;
    const roles = user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];

    console.log('🔍 SWITCH - Transformación de roles:', {
      user_id: userId,
      targetEnvironment,
      original_user_roles_count: user_roles?.length || 0,
      transformed_roles: roles,
    });

    const user_with_roles_array = {
      ...user_without_roles,
      roles, // Array simple: ["owner", "admin"]
    };

    // Obtener user_settings actualizados (después de la actualización)
    const user_settings = await this.prismaService.user_settings.findUnique({
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
    const { password, ...user_with_roles_and_password } =
      user_with_roles_array || user;

    // Agregar active_store al usuario para consistencia con login
    const user_with_store = {
      ...user_with_roles_and_password,
      store: active_store,
    };

    // Estructura idéntica a la del login: { user, user_settings, ...tokens }
    const response = {
      user: user_with_store, // Usar usuario con roles array simple y store activo
      user_settings: user_settings,
      access_token: access_token, // Formato igual que login
      refresh_token: refresh_token, // Formato igual que login
      token_type: 'Bearer', // Igual que login
      expires_in: this.parseExpiryToMilliseconds(accessTokenExpiry), // ✅ Correct ms
      updatedEnvironment: targetEnvironment, // Campo adicional específico del switch
    };

    return response;
  }

  private async createUserSession(
    user_id: number,
    refresh_token: string,
    client_info?: {
      ip_address?: string;
      user_agent?: string;
    },
  ) {
    // Obtener duración del refresh token del entorno
    const refreshTokenExpiry =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);

    // Generar fingerprint del dispositivo
    const device_fingerprint = this.generateDeviceFingerprint(client_info);

    // Hashear el refresh token para almacenamiento seguro
    const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);

    await this.prismaService.refresh_tokens.create({
      data: {
        user_id: user_id,
        token: hashedRefreshToken, // Guardar hash en lugar del token en claro
        expires_at: new Date(Date.now() + expiryMs),
        ip_address: client_info?.ip_address || null,
        user_agent: client_info?.user_agent || null,
        device_fingerprint: device_fingerprint,
        last_used: new Date(),
        revoked: false,
      },
    });
  }

  // Método auxiliar para convertir duraciones JWT a milisegundos
  private parseExpiryToMilliseconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 7 * 24 * 60 * 60 * 1000; // Default: 7 días
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000; // Default: 7 días
    }
  }

  // Generar fingerprint único del dispositivo
  private generateDeviceFingerprint(client_info?: {
    ip_address?: string;
    user_agent?: string;
  }): string {
    if (!client_info) {
      return 'unknown-device';
    }

    // Extraer información básica del User Agent
    const browser = this.extractBrowserFromUserAgent(
      client_info.user_agent || '',
    );
    const os = this.extractOSFromUserAgent(client_info.user_agent || '');

    // Crear fingerprint básico (sin ser invasivo)
    const fingerprint = `${browser}-${os}-${client_info.ip_address?.split('.')[0] || 'unknown'}`;

    // Hash para ofuscar información sensible
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(fingerprint)
      .digest('hex')
      .substring(0, 32);
  }

  // Extraer navegador principal del User Agent
  private extractBrowserFromUserAgent(userAgent: string): string {
    if (!userAgent) return 'unknown';

    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
      return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    if (userAgent.includes('Opera')) return 'Opera';

    return 'other';
  }

  // Extraer sistema operativo del User Agent
  private extractOSFromUserAgent(userAgent: string): string {
    if (!userAgent) return 'unknown';

    if (userAgent.includes('Windows NT 10.0')) return 'Windows10';
    if (userAgent.includes('Windows NT')) return 'Windows';
    if (userAgent.includes('Mac OS X')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iPhone') || userAgent.includes('iPad'))
      return 'iOS';

    return 'other';
  }
}
