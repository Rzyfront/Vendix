import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { UserRole } from '../enums/user-role.enum';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class PermissionsGuard implements CanActivate {
  // A.0 — el 403 de permisos era estructuralmente invisible: los guards corren
  // ANTES que AuditInterceptor, así que un rechazo aquí nunca generaba fila en
  // `audit_logs` ni línea de consola. Este Logger deja rastro forense en cada
  // rama de rechazo.
  private readonly logger = new Logger(PermissionsGuard.name);

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
      this.logDenied(requiredPermissions, null, request);
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    // Bypass para super admin - tiene acceso a todo sin verificar permisos
    if (user.roles && user.roles.includes(UserRole.SUPER_ADMIN)) {
      return true;
    }

    if (!user.permissions || user.permissions.length === 0) {
      this.logDenied(requiredPermissions, user, request);
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
      // así que la coincidencia exacta es lo correcto.
      //
      // `currentPath` es el PATRÓN de la ruta Nest (`route.path`), no la URL
      // concreta: una petición a `/api/inventory/adjustments/42` compara
      // contra `/api/inventory/adjustments/:id`, que es exactamente como el
      // seed declara sus filas. Por eso la igualdad estricta funciona con
      // rutas parametrizadas.
      //
      // EL COMODÍN `*` NO ESTÁ SOPORTADO, ni antes ni ahora. El seed declara
      // ~10 filas con `path` terminado en `/*` (`/api/store/subscriptions/*`,
      // `/api/super-admin/fiscal/accounting/*`, …). Ninguna casa por ruta:
      // con el `startsWith` anterior tampoco lo hacía, porque el asterisco
      // viajaba DENTRO del prefijo comparado. Esas filas autorizan sólo por
      // la vía de NOMBRE de abajo (`hasNamedPermission`), que es la que usan
      // los controladores vía `@Permissions('...')`.
      //
      // No se implementa el comodín acá porque hacerlo AMPLÍA el acceso: esas
      // ~10 filas pasarían de no conceder nada por ruta a conceder subárboles
      // enteros del API, y ese es un cambio de superficie de autorización que
      // debe decidirse explícitamente, no colarse como efecto secundario de
      // un arreglo de matching. Si se decide soportarlo, va con su prueba y
      // con la revisión de a qué roles está asignada cada una de esas filas.
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
      this.logDenied(requiredPermissions, user, request);
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    return true;
  }

  /**
   * A.0 — deja rastro estructurado cuando el guard rechaza. Los guards corren
   * ANTES que `AuditInterceptor` (app.module.ts:193-194), así que un 403 de
   * permisos jamás llegaba a `audit_logs`; este warn es la única huella
   * forense de un intento de explotar un endpoint de dinero.
   */
  private logDenied(
    required: string[] | undefined,
    user: { id?: unknown; roles?: unknown; store_id?: unknown } | null,
    request: any,
  ): void {
    this.logger.warn(
      `PERMISSION_DENIED ${JSON.stringify({
        required: required ?? null,
        user: user
          ? {
              id: user.id ?? null,
              roles: user.roles ?? null,
              store_id: user.store_id ?? null,
            }
          : null,
        route: request?.originalUrl ?? request?.url ?? null,
        method: request?.method ?? null,
      })}`,
    );
  }
}
