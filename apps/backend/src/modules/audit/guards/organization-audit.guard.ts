import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class OrganizationAuditGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const { user } = request;

    if (!user) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    // Si es admin del sistema, permitir acceso completo
    if (user.roles?.some(role => role.name === 'super_admin' || role.name === 'system_admin')) {
      return true;
    }

    // Para usuarios normales, filtrar por su organización
    if (user.organization_id) {
      // Agregar automáticamente el filtro de organización
      const query = request.query || {};
      if (!query.organizationId) {
        query.organizationId = user.organization_id.toString();
        request.query = query;
      }
      return true;
    }

    // Si no tiene organización asignada, denegar acceso
    throw new ForbiddenException('Usuario sin organización asignada');
  }
}
