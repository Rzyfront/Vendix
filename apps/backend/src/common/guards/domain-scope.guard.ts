import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { ALLOW_CROSS_DOMAIN_KEY } from '@common/decorators/allow-cross-domain.decorator';
import { domainScopeDecision } from './domain-scope.rule';

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

  // Los marcadores de path (/store/, /organization/, /store/carrier/) viven en
  // `domain-scope.rule.ts`; acá se compara `req.path` u `originalUrl`.

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Rutas públicas: pasar sin tocar.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 1b. Bootstrap cross-domain explícito (@AllowCrossDomain): handlers de
    // transición de dominio (p. ej. upgrade SINGLE_STORE → MULTI_STORE_ORG) que
    // un token del dominio origen debe poder llamar aunque vivan bajo el prefijo
    // del dominio destino. Salta SOLO el aislamiento de dominio; PermissionsGuard
    // y validaciones de servicio (owner) siguen activos.
    const allowCrossDomain = this.reflector.getAllAndOverride<boolean>(
      ALLOW_CROSS_DOMAIN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowCrossDomain) return true;

    const req = context.switchToHttp().getRequest();

    // 2. CORS preflight: pasar (consistente con JwtAuthGuard).
    if (req.method === 'OPTIONS') return true;

    const user = req.user;

    // 3. Si no hay user, JwtAuthGuard ya rechazó o es ruta no protegida que
    // permitió pasar. No es responsabilidad de este guard.
    if (!user) return true;

    // 4-6. Matriz de aislamiento (super-admin, VENDIX_ADMIN, store/org,
    // STORE_DELIVERY, carve-out de campana para customers). Vive en
    // `domain-scope.rule.ts` porque el puente de la IA aplica la misma regla
    // para no ofrecer ni despachar rutas que este guard va a rechazar.
    const path: string = (req.path || req.originalUrl || '').toLowerCase();
    const decision = domainScopeDecision(user, path);
    if (decision.allowed) return true;

    switch (decision.reason) {
      case 'missing_app_type':
        this.logger.warn(
          `Token sin app_type accediendo a ${path} (user_id=${user.id}). Re-login requerido.`,
        );
        break;
      case 'org_admin_store_path':
        this.logger.warn(
          `ORG_ADMIN (user_id=${user.id}) intentó acceder a path de store: ${path}`,
        );
        break;
      case 'store_admin_org_path':
        this.logger.warn(
          `STORE_ADMIN (user_id=${user.id}) intentó acceder a path de organization: ${path}`,
        );
        break;
      case 'delivery_outside_carrier':
        // Contrato previo: `false` (403 genérico de Nest), sin log.
        return false;
      case 'non_admin_app_type':
        this.logger.warn(
          `app_type=${user.app_type} (user_id=${user.id}) intentó acceder a path admin: ${path}`,
        );
        break;
    }
    throw new ForbiddenException(decision.message);
  }
}
