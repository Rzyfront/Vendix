import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  hmacSha256,
  getRefreshTokenHmacSecret,
} from '../../domains/auth/constants/token.constants';

@Injectable()
export class SessionValidationMiddleware implements NestMiddleware {
  constructor(private readonly prismaService: GlobalPrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Solo validar para rutas protegidas que usan refresh tokens
    if (req.method === 'POST' && req.path === '/auth/refresh') {
      const { refresh_token } = req.body;

      if (refresh_token) {
        try {
          // Hash determinista (HMAC-SHA256) alineado con el esquema de
          // almacenamiento de refresh tokens (ver token.constants.ts). NUNCA
          // usar bcrypt.hash aquí: genera un salt aleatorio por llamada, así que
          // el hash jamás igualaría al almacenado y este lookup fallaría siempre.
          const hashedToken = hmacSha256(
            refresh_token,
            getRefreshTokenHmacSecret(),
          );

          // Verificar si el token existe y no está revocado
          const tokenRecord = await this.prismaService.refresh_tokens.findFirst(
            {
              where: {
                token: hashedToken,
                revoked: false,
                expires_at: { gt: new Date() },
              },
            },
          );

          if (!tokenRecord) {
            throw new UnauthorizedException(
              'Refresh token inválido o revocado',
            );
          }

          // Agregar información del token al request para uso posterior
          (req as any).tokenRecord = tokenRecord;
        } catch (error) {
          if (error instanceof UnauthorizedException) {
            throw error;
          }
          // Log error pero continuar (podría ser un problema de hash)
        }
      }
    }

    next();
  }
}
