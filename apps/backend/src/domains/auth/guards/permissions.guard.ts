import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { UserRole } from '../enums/user-role.enum';

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
      throw new ForbiddenException('Usuario no autenticado');
    }

    // Bypass para super admin - tiene acceso a todo sin verificar permisos
    if (user.roles && user.roles.includes(UserRole.SUPER_ADMIN)) {
      return true;
    }

    if (!user.permissions || user.permissions.length === 0) {
      throw new ForbiddenException('Usuario sin permisos asignados');
    }

    // Verificar si el usuario tiene permisos para esta ruta y método específico
    const currentPath = route?.path || request.url;
    const currentMethod = method.toUpperCase();

    const hasPermission = user.permissions.some((permission) => {
      // Verificar si coincide exactamente con ruta y método
      const pathMatches =
        permission.path === currentPath ||
        currentPath.startsWith(permission.path);
      const methodMatches =
        permission.method === currentMethod || permission.method === 'ALL';
      const isActive = permission.status === 'active';

      return pathMatches && methodMatches && isActive;
    });

    // También verificar permisos por nombre (para flexibilidad)
    const hasNamedPermission = requiredPermissions.some((permissionName) =>
      user.permissions.some(
        (userPerm) =>
          userPerm.path.includes(permissionName) &&
          userPerm.status === 'active',
      ),
    );

    if (!hasPermission && !hasNamedPermission) {
      throw new ForbiddenException(
        `Acceso denegado. Se requiere permiso para ${currentMethod} ${currentPath}`,
      );
    }

    return true;
  }
}
