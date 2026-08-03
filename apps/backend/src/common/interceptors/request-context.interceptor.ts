import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  RequestContextService,
  RequestContext,
} from '../context/request-context.service';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestContextInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const user = req.user;
    const domain_context = req['domain_context'];

    // Create context object
    const contextObj: RequestContext = {
      is_super_admin: false,
      is_owner: false,
    };

    // Propagate X-Request-Id for idempotent operations (e.g. quota dedup)
    const requestId = req.headers['x-request-id'];
    if (typeof requestId === 'string' && requestId) {
      contextObj.request_id = requestId;
    }

    // Combined Context Logic
    if (user) {
      const roles =
        user.user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];

      const effectiveRoles: string[] = user.roles || roles;

      contextObj.user_id = user.id || user.user_id;
      contextObj.organization_id = user.organization_id;
      contextObj.store_id = user.store_id;
      contextObj.app_type = user.app_type; // ✅ Del JWT — DomainScopeGuard
      contextObj.roles = effectiveRoles;
      contextObj.permissions = this.normalizePermissions(user.permissions);
      contextObj.is_super_admin =
        user.is_super_admin || effectiveRoles.includes('super_admin');
      contextObj.is_owner = user.is_owner || effectiveRoles.includes('owner');
      contextObj.email = user.email;
    }

    // In ecommerce routes, the DomainResolverMiddleware might have found a store_id
    // This has priority or fills the gap for non-authenticated users
    if (domain_context) {
      if (domain_context.store_id) {
        contextObj.store_id = domain_context.store_id;
      }
      if (domain_context.organization_id && !contextObj.organization_id) {
        contextObj.organization_id = domain_context.organization_id;
      }
    }

    this.logger.debug(
      `Context Initialized: store_id=${contextObj.store_id}, user_id=${contextObj.user_id}, path=${req.originalUrl}`,
    );

    // Always run within AsyncLocalStorage to ensure a request-safe context
    return RequestContextService.asyncLocalStorage.run(contextObj, () => {
      return next.handle();
    });
  }

  /**
   * `JwtStrategy` hydrates `req.user.permissions` as row objects
   * (`{ name, path, method, status }`) because `PermissionsGuard` matches on
   * path + method. `RequestContext.permissions` is declared `string[]` and
   * every ALS consumer calls `.includes('store:...')` on it, so the objects
   * have to be flattened to names here — otherwise the comparison is
   * string-vs-object and silently never matches.
   *
   * Inactive permission rows are dropped so a revoked grant cannot satisfy a
   * name check, mirroring the `status === 'active'` filter in the guard.
   */
  private normalizePermissions(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          const row = p as { name?: unknown; status?: unknown };
          if (row.status !== undefined && row.status !== 'active') return '';
          return typeof row.name === 'string' ? row.name : '';
        }
        return '';
      })
      .filter((name): name is string => name.length > 0);
  }
}
