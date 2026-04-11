import { Inject, Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Request, Response, NextFunction } from 'express';
import { PublicDomainsService } from '../../domains/public/domains/public-domains.service';

@Injectable()
export class DomainResolverMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DomainResolverMiddleware.name);

  constructor(
    private readonly publicDomains: PublicDomainsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) { }

  async use(req: Request, res: Response, next: NextFunction) {
    // Usar originalUrl para asegurar que detectamos /ecommerce/ incluso con prefijos
    if (!req.originalUrl.includes('/ecommerce/')) {
      return next();
    }

    this.logger.log(`Path matched for domain resolution: ${req.originalUrl}`);

    const hostname = this.extractHostname(req);
    const x_store_id_header = req.headers['x-store-id'] || req.query.store_id;
    const x_store_id = Array.isArray(x_store_id_header)
      ? x_store_id_header[0]
      : x_store_id_header;

    this.logger.log(
      `Resolving domain for hostname: ${hostname} (header/query store-id: ${x_store_id})`,
    );

    try {
      // Prioridad 1: x-store-id header o query param
      if (x_store_id && !isNaN(Number(x_store_id)) && Number(x_store_id) > 0) {
        req['domain_context'] = {
          store_id: Number(x_store_id),
        };
        this.logger.log(`Store resolved from header/query: ${x_store_id}`);
        return next();
      }

      // Prioridad 2: Resolución por hostname
      const cacheKey = `domain:${hostname}`;
      const cached = await this.cache.get<{ store_id: number; organization_id?: number }>(cacheKey);
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

  private extractHostname(req: Request): string {
    const forwarded_host = req.headers['x-forwarded-host'] as string;
    const host = req.headers['host'] as string;
    return forwarded_host || host || 'localhost';
  }
}
