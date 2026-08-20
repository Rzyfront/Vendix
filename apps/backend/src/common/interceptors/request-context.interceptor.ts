import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as crypto from 'crypto';
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
    const res = ctx.getResponse();
    const user = req.user;
    const domain_context = req['domain_context'];

    // Create context object
    const contextObj: RequestContext = {
      is_super_admin: false,
      is_owner: false,
    };

    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.1 · X-Request-Id correlation.
    //
    // Honor a caller-provided X-Request-Id when present (lets a frontend or
    // upstream gateway pin the same correlation token across services); fall
    // back to a fresh UUID so EVERY request is correlatable, even if the
    // caller forgot to set the header. We also stamp the same id on the
    // response header so the client can echo it back in support tickets
    // without having to dig through DevTools.
    const inboundRequestId = req.headers['x-request-id'];
    const requestId =
      typeof inboundRequestId === 'string' && inboundRequestId.length > 0
        ? inboundRequestId
        : crypto.randomUUID();
    contextObj.request_id = requestId;
    try {
      res.setHeader('X-Request-Id', requestId);
    } catch {
      // Some response shapes (e.g. SSE) forbid header mutation after stream
      // start; the ALS context still carries the id, so logging keeps working.
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

      // Only captured for authenticated requests. The AI api-bridge replays
      // requests as this user over internal HTTP; that is the whole reason the
      // token has to survive past the guard layer.
      //
      // Both sources are read, in the same order as `JwtStrategy`'s
      // `fromExtractors([fromAuthHeaderAsBearerToken, fromUrlQueryParameter])`.
      // Reading only the header made this silently asymmetric: `EventSource`
      // cannot send headers, so the SSE chat endpoint authenticates via
      // `?token=` and lands inside this `if (user)` block with no token
      // captured. Every bridge call during an agent turn then failed with "no
      // hay credencial", which reads like a permissions problem and is really
      // this branch. If the two extractor lists ever diverge again, the same
      // class of bug comes back.
      const authHeader = req.headers?.authorization;
      const queryToken = req.query?.token;
      if (typeof authHeader === 'string' && /^Bearer /i.test(authHeader)) {
        contextObj.access_token = authHeader.slice(7);
      } else if (typeof queryToken === 'string' && queryToken) {
        contextObj.access_token = queryToken;
      }
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
      `Context Initialized: store_id=${contextObj.store_id}, user_id=${contextObj.user_id}, request_id=${contextObj.request_id}, path=${req.originalUrl}`,
    );

    // Always run within AsyncLocalStorage to ensure a request-safe context
    return RequestContextService.asyncLocalStorage.run(contextObj, () => {
      return next.handle().pipe(
        tap({
          // Defensive: also stamp the header on completion in case a
          // middleware short-circuited before the synchronous `setHeader`
          // (rare, but free insurance).
          next: () => {
            try {
              res.setHeader('X-Request-Id', requestId);
            } catch {}
          },
        }),
      );
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
