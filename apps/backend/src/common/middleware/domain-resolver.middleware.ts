import { Inject, Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Request, Response, NextFunction } from 'express';
import { PublicDomainsService } from '../../domains/public/domains/public-domains.service';

/**
 * D.3 (F-042) — Entero positivo estricto: solo dígitos (sin `+`, `-`, `.`,
 * espacios ni exponentes), > 0 y entero seguro. `Number()` a secas acepta
 * `'3.5'`, `'0x10'` o `'1e3'`; acá no.
 */
export function isValidTenantId(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0;
}

@Injectable()
export class DomainResolverMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DomainResolverMiddleware.name);

  constructor(
    private readonly publicDomains: PublicDomainsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Usar originalUrl para asegurar que detectamos /ecommerce/ incluso con prefijos
    if (!req.originalUrl.includes('/ecommerce/')) {
      return next();
    }

    this.logger.log(`Path matched for domain resolution: ${req.originalUrl}`);

    const hostname = this.extractHostname(req);
    const x_store_id_header = req.headers['x-store-id'] || req.query.store_id;
    // D.3 (F-042): el tenant viaja fuera del ValidationPipe ⇒ validación
    // explícita fail-fast. Presente-pero-inválido → 400 (nunca scope fault
    // silencioso); ausente/vacío → cae a resolución por hostname (intacto).
    // Array (`?store_id=1&store_id=2`, header repetido) u objeto (query
    // extendido `?store_id[a]=1`) → 400: ambiguo / no-escalar.
    // OJO: respuesta directa, NUNCA throw — un throw en middleware async no
    // pasa por AllExceptionsFilter en Express 4 (rejection sin handler).
    // El envelope replica el del filtro (statusCode/error_code/message/...).
    let x_store_id = '';
    if (x_store_id_header !== undefined && x_store_id_header !== '') {
      const candidate =
        typeof x_store_id_header === 'string'
          ? x_store_id_header.trim()
          : Array.isArray(x_store_id_header)
            ? x_store_id_header.join(',')
            : '[object]';
      if (!isValidTenantId(candidate)) {
        res.status(400).json({
          statusCode: 400,
          error_code: 'SYS_VALIDATION_001',
          message: 'Invalid x-store-id: must be a single positive integer',
          timestamp: new Date().toISOString(),
          path: req.originalUrl,
        });
        return;
      }
      x_store_id = candidate;
    }

    this.logger.log(
      `Resolving domain for hostname: ${hostname} (header/query store-id: ${x_store_id})`,
    );

    try {
      // Prioridad 1: x-store-id header o query param (ya validado arriba:
      // '' ⇒ ausente, otro valor ⇒ entero positivo).
      if (x_store_id !== '') {
        const store_id = Number(x_store_id);
        const store_cache_key = `domain:store:${store_id}`;
        const cached_store = await this.cache.get<{
          store_id: number;
          organization_id: number;
        }>(store_cache_key);

        if (cached_store) {
          req['domain_context'] = cached_store;
        } else {
          const resolved = await this.publicDomains.resolveByStoreId(store_id);
          await this.cache.set(store_cache_key, resolved, 300_000);
          req['domain_context'] = resolved;
        }

        this.logger.log(`Store resolved from header/query: ${store_id}`);
        return next();
      }

      // Prioridad 2: Resolución por hostname
      const cacheKey = `domain:${hostname}`;
      const cached = await this.cache.get<{
        store_id: number;
        organization_id?: number;
      }>(cacheKey);
      if (cached) {
        req['domain_context'] = cached;
        return next();
      }

      const domain = await this.publicDomains.resolveDomain(hostname);
      const domain_context = {
        store_id: domain.store_id!,
        organization_id: domain.organization_id,
      };

      await this.cache.set(`domain:${hostname}`, domain_context, 300_000);
      req['domain_context'] = domain_context;

      next();
    } catch (error) {
      this.logger.warn(`Could not resolve domain for hostname: ${hostname}`);
      next();
    }
  }

  /**
   * INVERTED precedence — known debt, tracked by QUI-569.
   *
   * The correct behaviour is `resolveTenantHostname()` from
   * `@common/utils/tenant-hostname.util`: the viewer `Host` wins and
   * `x-forwarded-host` is consulted ONLY when `Host` is the API's own hostname.
   * Here it is still the other way round — the forwarded header always wins —
   * and in production CloudFront `E1I27OYFJX7VYJ` injects a FIXED
   * `X-Forwarded-Host: vendix.online` on the `vendix-backend-api` origin.
   *
   * Deliberately NOT fixed alongside QUI-564: the `domain_context` produced here
   * feeds the scoped Prisma services, so flipping the precedence is a
   * multi-tenant isolation change rather than an SEO one and needs its own
   * verification pass. It does not misfire today because this middleware only
   * runs on `/ecommerce/` routes and `api.vendix.online` resolves straight to
   * the EC2 instance via Route53, never through CloudFront.
   */
  private extractHostname(req: Request): string {
    const forwarded_host = req.headers['x-forwarded-host'] as string; // host-audit:ignore QUI-569
    const host = req.headers['host'] as string; // host-audit:ignore QUI-569
    return forwarded_host || host || 'localhost';
  }
}
