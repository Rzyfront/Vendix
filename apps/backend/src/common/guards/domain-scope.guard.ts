import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';

/**
 * DomainScopeGuard
 *
 * Garantiza el aislamiento de dominio backend (REGLA CERO):
 * - Token con `app_type === 'STORE_ADMIN'` solo puede acceder a `/api/store/*`.
 * - Token con `app_type === 'ORG_ADMIN'`  solo puede acceder a `/api/organization/*`.
 * - Cualquier otro `app_type` (VENDIX_*, *_LANDING, STORE_ECOMMERCE) no toca
 *   estos prefijos por construcción; si lo hace, también se rechaza.
 *
 * Decisiones aplicadas:
 * - Sin claim `app_type` → 403. Despliegue forzó logout global; los tokens
 *   válidos siempre traen el claim. No se asume nada por heurística.
 * - `is_super_admin === true` → bypass total (soporte / debugging).
 * - Rutas `@Public()` → bypass (no hay user en req).
 * - Rutas con user pero fuera de `/store/*` y `/organization/*` (auth, ecommerce,
 *   superadmin, public, health) → bypass.
 *
 * Se registra como APP_GUARD entre JwtAuthGuard y StoreOperationsGuard en
 * app.module.ts. JwtAuthGuard ya populó `req.user` (o lo rechazó); aquí solo
 * se valida el cruce de dominio.
 */
@Injectable()
export class DomainScopeGuard implements CanActivate {
  private readonly logger = new Logger(DomainScopeGuard.name);

  // Marcadores de path estrictos: /api/store/ y /api/organization/.
  // Comparamos contra `req.path` u `originalUrl` con normalización.
  private readonly STORE_PATH_MARKER = '/store/';
  private readonly ORG_PATH_MARKER = '/organization/';

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Rutas públicas: pasar sin tocar.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();

    // 2. CORS preflight: pasar (consistente con JwtAuthGuard).
    if (req.method === 'OPTIONS') return true;

    const user = req.user;

    // 3. Si no hay user, JwtAuthGuard ya rechazó o es ruta no protegida que
    // permitió pasar. No es responsabilidad de este guard.
    if (!user) return true;

    // 4. Super-admin: bypass total. Acceso cross-domain para soporte.
    if (user.is_super_admin === true) return true;

    const path: string = (req.path || req.originalUrl || '').toLowerCase();

    const isStorePath = path.includes(this.STORE_PATH_MARKER);
    const isOrgPath = path.includes(this.ORG_PATH_MARKER);

    // 5. Path no es de un dominio gobernado por este guard → bypass.
    // Cubre /api/auth/*, /api/ecommerce/*, /api/superadmin/*, /api/health, etc.
    if (!isStorePath && !isOrgPath) return true;

    // 6. A partir de aquí el path es /store/* o /organization/*.
    //    Necesitamos un app_type claim válido.
    const appType: string | undefined = user.app_type;

    if (!appType) {
      this.logger.warn(
        `Token sin app_type accediendo a ${path} (user_id=${user.id}). Re-login requerido.`,
      );
      throw new ForbiddenException(
        'Token sin app_type claim. Re-login requerido.',
      );
    }

    if (appType === 'ORG_ADMIN' && isStorePath) {
      this.logger.warn(
        `ORG_ADMIN (user_id=${user.id}) intentó acceder a path de store: ${path}`,
      );
      throw new ForbiddenException(
        'ORG_ADMIN no puede acceder a endpoints /store/*',
      );
    }

    if (appType === 'STORE_ADMIN' && isOrgPath) {
      this.logger.warn(
        `STORE_ADMIN (user_id=${user.id}) intentó acceder a path de organization: ${path}`,
      );
      throw new ForbiddenException(
        'STORE_ADMIN no puede acceder a endpoints /organization/*',
      );
    }

    // 7. app_type fuera de ORG_ADMIN/STORE_ADMIN (p. ej. STORE_ECOMMERCE,
    //    *_LANDING, VENDIX_*) tocando /store/* o /organization/* es un cruce
    //    no autorizado. Rechazar.
    if (appType !== 'ORG_ADMIN' && appType !== 'STORE_ADMIN') {
      this.logger.warn(
        `app_type=${appType} (user_id=${user.id}) intentó acceder a path admin: ${path}`,
      );
      throw new ForbiddenException(
        `Token app_type=${appType} no autoriza acceso a endpoints admin`,
      );
    }

    return true;
  }
}
