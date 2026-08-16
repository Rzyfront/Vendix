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

    const hasPermission = user.permissions.some((permission) => {
      // Coincidencia EXACTA por ruta. El prefijo `startsWith(permission.path)`
      // que estaba antes abría TODO `/api/*` GET al `customer` cuando el
      // permiso `system.health` tenía `path = '/api'`: cualquier ruta que
      // empezara por `/api` quedaba autorizada por error, y `system.health`
      // se asignaba a 8 roles incluido `customer`.
      //
      // El permiso `system.health` apunta a una ruta concreta
      // (`/api/health`, ver `permissions-roles.seed.ts`), no a un prefijo,
      // así que la coincidencia exacta es lo correcto. Permisos con `path`
      // que sea de verdad un prefijo (los módulos multi-ruta) deben
      // declararlo así explícitamente con un `*` final, que es lo que
      // distingue una ruta de un prefijo.
      const pathMatches = permission.path === currentPath;
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
