import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: number; // user id
  email: string;
  roles: string[];
  organizationId: number; // ✅ Scope de organización del token
  storeId?: number | null; // ✅ Scope de tienda del token (opcional)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') || 'fallback-secret-key',
    });
  }
  async validate(payload: JwtPayload) {
    const user = await this.prismaService.users.findUnique({
      where: { id: payload.sub },
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

    // if (!user.email_verified) {
    //   throw new UnauthorizedException('Email no verificado');
    // }

    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException('Cuenta bloqueada temporalmente');
    }

    // ✅ Retornamos el usuario con scope del TOKEN (no de la BD)
    // Esto permite tener diferentes scopes por sesión/token
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      fullName: `${user.first_name} ${user.last_name}`,
      organization_id: payload.organizationId, // ✅ Del TOKEN
      store_id: payload.storeId || null, // ✅ Del TOKEN
      user_roles: user.user_roles, // ✅ Mantener para el middleware
      roles: user.user_roles.map((ur) => ur.roles?.name || ''),
      permissions: user.user_roles.flatMap(
        (ur) =>
          ur.roles?.role_permissions?.map((rp) => ({
            path: rp.permissions?.path || '',
            method: rp.permissions?.method || '',
            status: rp.permissions?.status || '',
          })) || [],
      ),
    };
  }
}
