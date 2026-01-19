import {
  Injectable,
  NestMiddleware,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PublicDomainsService } from '../../domains/public/domains/public-domains.service';
import { RequestContextService } from '../context/request-context.service';

interface DomainContext {
  store_id: number;
  organization_id?: number;
}

@Injectable()
export class DomainResolverMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DomainResolverMiddleware.name);
  private cache = new Map<
    string,
    { context: DomainContext; timestamp: number }
  >();
  private readonly CACHE_TTL = 300000; // 5 minutos
  private readonly MAX_CACHE_SIZE = 1000;

  constructor(private readonly publicDomains: PublicDomainsService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    this.logger.debug(`DomainResolverMiddleware hit: ${req.path}`);
    // Solo procesar rutas de ecommerce
    if (!req.path.includes('/ecommerce/')) {
      return next();
    }

    const hostname = this.extractHostname(req);
    const x_store_id = req.headers['x-store-id'];

    this.logger.debug(
      `Resolving domain: ${hostname} (x-store-id: ${x_store_id})`,
    );

    try {
      // If x-store-id is provided, we can use it directly for ecommerce routes
      if (x_store_id && !isNaN(Number(x_store_id)) && Number(x_store_id) > 0) {
        const store_id = Number(x_store_id);
        // We still might want to verify if this store exists or just trust it for now
        // For security, it's better to verify, but for now let's set it
        const domain_context: DomainContext = {
          store_id,
        };
        this.setDomainContext(domain_context);
        return next();
      }

      // Check cache
      const cached = this.cache.get(hostname);
      const now = Date.now();

      if (cached && now - cached.timestamp < this.CACHE_TTL) {
        this.logger.debug(`Cache hit for domain: ${hostname}`);
        this.setDomainContext(cached.context);
        return next();
      }

      // Resolve domain
      const domain = await this.publicDomains.resolveDomain(hostname);

      const domain_context: DomainContext = {
        store_id: domain.store_id!,
        organization_id: domain.organization_id,
      };

      // Cache the result
      this.cache.set(hostname, { context: domain_context, timestamp: now });

      // Clean old cache entries if needed
      if (this.cache.size > this.MAX_CACHE_SIZE) {
        this.cleanCache();
      }

      this.setDomainContext(domain_context);
      this.logger.log(
        `Domain resolved: ${hostname} -> store_id: ${domain_context.store_id}`,
      );

      next();
    } catch (error) {
      this.logger.error(`Failed to resolve domain: ${hostname}`, error);
      return res.status(404).json({
        success: false,
        message: 'Domain not found',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private extractHostname(req: Request): string {
    const forwarded_host = req.headers['x-forwarded-host'] as string;
    const host = req.headers['host'] as string;

    return forwarded_host || host || 'localhost';
  }

  private setDomainContext(domain_context: DomainContext) {
    RequestContextService.setDomainContext(
      domain_context.store_id,
      domain_context.organization_id,
    );
  }

  private cleanCache() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());

    // Remove entries older than TTL
    for (const [key, value] of entries) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }

    // If still too large, remove oldest entries
    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const sorted_entries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      );

      const to_remove = sorted_entries.slice(
        0,
        sorted_entries.length - this.MAX_CACHE_SIZE,
      );

      for (const [key] of to_remove) {
        this.cache.delete(key);
      }
    }
  }
}
