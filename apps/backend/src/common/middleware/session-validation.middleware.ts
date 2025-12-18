import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SessionValidationMiddleware implements NestMiddleware {
  constructor(private readonly prismaService: GlobalPrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Solo validar para rutas protegidas que usan refresh tokens
    if (req.method === 'POST' && req.path === '/auth/refresh') {
      const { refresh_token } = req.body;

      if (refresh_token) {
        try {
          // Hashear el token para comparación
          const hashedToken = await bcrypt.hash(refresh_token, 12);

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
          console.error('Error validating refresh token:', error);
        }
      }
    }

    next();
  }
}
