import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContextService, RequestContext } from '../context/request-context.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const user = (req as any).user;

    // Si no hay usuario autenticado, continuar sin contexto
    if (!user) {
      return next();
    }

    // Extraer información del usuario
    const roles = user.user_roles?.map(ur => ur.roles?.name).filter(Boolean) || [];
    const isSuperAdmin = roles.includes('super_admin');
    const isOwner = roles.includes('owner');

    // Construir el contexto
    const context: RequestContext = {
      userId: user.id,
      organizationId: user.organization_id,
      storeId: user.store_id,
      roles,
      isSuperAdmin,
      isOwner,
      email: user.email,
    };

    // Log del contexto (solo en desarrollo)
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(
        `Context set: User ${user.id} | Org ${context.organizationId || 'N/A'} | Store ${context.storeId || 'N/A'} | Roles: ${roles.join(', ')}`
      );
    }

    // Ejecutar el siguiente middleware dentro del contexto
    // AsyncLocalStorage mantiene el contexto durante toda la ejecución asíncrona
    const storage = (RequestContextService as any).asyncLocalStorage;
    storage.run(context, () => {
      next();
    });
  }
}
