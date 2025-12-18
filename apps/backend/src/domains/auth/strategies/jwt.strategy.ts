import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

export interface JwtPayload {
  sub: number; // user id
  organization_id: number; // ✅ Scope de organización del token
  store_id?: number | null; // ✅ Scope de tienda del token (opcional)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prismaService: GlobalPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') || 'fallback-secret-key',
    });
  }
  async validate(payload: JwtPayload) {
    console.log('JWT Strategy - Validating payload:', payload);
    console.log(
      'JWT Strategy - Using secret:',
      this.configService.get<string>('JWT_SECRET'),
    );
    try {
      const user = await this.prismaService.users.findUnique({
        where: { id: parseInt(payload.sub.toString()) },
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
        throw new UnauthorizedException(
          'Usuario no encontrado en base de datos',
        );
      }

      // if (!user.email_verified) {
      //   throw new UnauthorizedException('Email no verificado');
      // }

      if (user.locked_until && user.locked_until > new Date()) {
        throw new UnauthorizedException('Cuenta bloqueada temporalmente');
      }

      // 🔒 VALIDACIÓN DE ORGANIZACIÓN: Asegurar que el organization_id del token
      // corresponde al usuario (incluso para super_admin para consistencia)
      if (Number(payload.organization_id) !== user.organization_id) {
        console.error('JWT Strategy - Organization mismatch:', {
          token_org_id: payload.organization_id,
          user_org_id: user.organization_id,
          user_id: user.id,
          email: user.email,
        });
        throw new UnauthorizedException(
          'Token scope inválido: organización no corresponde al usuario',
        );
      }

      // ✅ Retornamos el usuario con scope del TOKEN (no de la BD)
      // Esto permite tener diferentes scopes por sesión/token
      return {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        fullName: `${user.first_name} ${user.last_name}`,
        organization_id: payload.organization_id, // ✅ Del TOKEN - Corregido
        store_id: payload.store_id || null, // ✅ Del TOKEN - Corregido
        user_roles: user.user_roles, // ✅ Mantener para el middleware
        roles: user.user_roles.map((ur) => ur.roles?.name || ''),
        permissions: user.user_roles.flatMap(
          (ur) =>
            ur.roles?.role_permissions?.map((rp) => ({
              name: rp.permissions?.name || '',
              path: rp.permissions?.path || '',
              method: rp.permissions?.method || '',
              status: rp.permissions?.status || '',
            })) || [],
        ),
      };
    } catch (error) {
      console.error('JWT Strategy - Error validating payload:', error);
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
