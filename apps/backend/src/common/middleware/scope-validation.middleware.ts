import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContextService } from '../context/request-context.service';

export interface ScopeValidationOptions {
  require_organization?: boolean;
  require_store?: boolean;
  require_user?: boolean;
  allow_super_admin?: boolean;
}

@Injectable()
export class ScopeValidationMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction, options?: ScopeValidationOptions) {
    const context = RequestContextService.getContext();

    // Opciones por defecto
    const opts: ScopeValidationOptions = {
      require_organization: true,
      require_store: false,
      require_user: true,
      allow_super_admin: true,
      ...options,
    };

    try {
      // Validar que existe contexto
      if (!context) {
        throw new BadRequestException('Request context not found');
      }

      // Validar usuario
      if (opts.require_user && !context.user_id && !context.is_super_admin) {
        throw new BadRequestException('User context is required');
      }

      // Validar organización
      if (opts.require_organization && !context.organization_id && !context.is_super_admin) {
        throw new BadRequestException('Organization context is required');
      }

      // Validar tienda
      if (opts.require_store && !context.store_id && !context.is_super_admin) {
        throw new BadRequestException('Store context is required');
      }

      // Validar permisos de super admin
      if (!opts.allow_super_admin && context.is_super_admin) {
        throw new ForbiddenException('Super admin access not allowed for this endpoint');
      }

      // Log de acceso para auditoría
      this.logScopeValidation(req, context, opts);

      next();
    } catch (error) {
      // Log de error de validación
      this.logScopeValidationError(req, context, opts, error);
      throw error;
    }
  }

  /**
   * Registra validación de scope exitosa para auditoría
   */
  private logScopeValidation(
    req: Request,
    context: any,
    options: ScopeValidationOptions,
  ): void {
    const log_data = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      user_id: context.user_id,
      organization_id: context.organization_id,
      store_id: context.store_id,
      is_super_admin: context.is_super_admin,
      validation_options: options,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    };

    // Aquí podrías integrar con tu servicio de logs
    console.log('Scope validation success:', JSON.stringify(log_data));
  }

  /**
   * Registra error de validación de scope para auditoría de seguridad
   */
  private logScopeValidationError(
    req: Request,
    context: any,
    options: ScopeValidationOptions,
    error: any,
  ): void {
    const log_data = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      user_id: context?.user_id,
      organization_id: context?.organization_id,
      store_id: context?.store_id,
      is_super_admin: context?.is_super_admin || false,
      validation_options: options,
      error_message: error.message,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    };

    // Aquí podrías integrar con tu servicio de logs de seguridad
    console.warn('Scope validation FAILED:', JSON.stringify(log_data));
  }
}

/**
 * Factory function para crear middleware con opciones específicas
 */
export function createScopeValidationMiddleware(options: ScopeValidationOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const middleware = new ScopeValidationMiddleware(new RequestContextService());
    middleware.use(req, res, next, options);
  };
}

/**
 * Middleware predefinidos para casos comunes
 */

// Requiere organización y usuario (default)
export const OrganizationScopeMiddleware = createScopeValidationMiddleware({
  require_organization: true,
  require_store: false,
  require_user: true,
  allow_super_admin: true,
});

// Requiere tienda, organización y usuario
export const StoreScopeMiddleware = createScopeValidationMiddleware({
  require_organization: true,
  require_store: true,
  require_user: true,
  allow_super_admin: true,
});

// Solo super admin
export const SuperAdminOnlyMiddleware = createScopeValidationMiddleware({
  require_organization: false,
  require_store: false,
  require_user: false,
  allow_super_admin: false,
});

// Requiere organización (sin permitir super admin)
export const StrictOrganizationMiddleware = createScopeValidationMiddleware({
  require_organization: true,
  require_store: false,
  require_user: true,
  allow_super_admin: false,
});

// Requiere tienda (sin permitir super admin)
export const StrictStoreMiddleware = createScopeValidationMiddleware({
  require_organization: true,
  require_store: true,
  require_user: true,
  allow_super_admin: false,
});