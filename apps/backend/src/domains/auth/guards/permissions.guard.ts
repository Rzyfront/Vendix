import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { UserRole } from '../enums/user-role.enum';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions) {
      return true; // Si no hay permisos requeridos, permitir acceso
    }

    const request = context.switchToHttp().getRequest();
    const { user } = request;
    const { method, route } = request;

    if (!user) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    // Bypass para super admin - tiene acceso a todo sin verificar permisos
    if (user.roles && user.roles.includes(UserRole.SUPER_ADMIN)) {
      return true;
    }

    if (!user.permissions || user.permissions.length === 0) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    // Verificar si el usuario tiene permisos para esta ruta y método específico
    const currentPath = route?.path || request.url;
    const currentMethod = method.toUpperCase();

    // Strip the global `/api` prefix that the seed uses for `permission.path`
    // but NestJS strips from `route.path`. The named-permission fallback
    // below has been masking this for the common case, but anything that
    // depended on path matching alone (or had a method that wasn't `ALL`)
    // silently failed. Compare normalized paths so both forms work.
    const stripApi = (p: string) => (p.startsWith('/api/') ? p.slice(4) : p);
    const normCurrent = stripApi(currentPath);

    const hasPermission = user.permissions.some((permission) => {
      // Verificar si coincide exactamente con ruta y método
      const normPermissionPath = stripApi(permission.path);
      const pathMatches =
        normPermissionPath === normCurrent ||
        normCurrent.startsWith(normPermissionPath);
      const methodMatches =
        permission.method === currentMethod || permission.method === 'ALL';
      const isActive = permission.status === 'active';

      return pathMatches && methodMatches && isActive;
    });

    // También verificar permisos por nombre (para flexibilidad)
    const hasNamedPermission = requiredPermissions.some((permissionName) =>
      user.permissions.some(
        (userPerm) =>
          userPerm.name === permissionName && userPerm.status === 'active',
      ),
    );

    if (!hasPermission && !hasNamedPermission) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    return true;
  }
}
