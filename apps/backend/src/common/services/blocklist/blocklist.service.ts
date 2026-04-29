import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

interface BlocklistEntry {
  pattern: string;
  match_type: 'exact' | 'suffix' | 'regex';
  reason: string | null;
}

/**
 * BlocklistService
 *
 * Verifica si un hostname está bloqueado por la blocklist global
 * (tabla `domain_blocklist`). La blocklist NO es scoped por tenant
 * (es a nivel plataforma) por lo que se accede vía GlobalPrismaService.
 *
 * Cache en memoria con TTL de 5min — refresh automático en cada `isBlocked`
 * cuando el cache está expirado, y permite forzar refresh manualmente.
 */
@Injectable()
export class BlocklistService implements OnModuleInit {
  private readonly logger = new Logger(BlocklistService.name);
  private cache: BlocklistEntry[] = [];
  private cacheLoadedAt = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private compiledRegexes = new Map<string, RegExp>();

  constructor(private readonly prisma: GlobalPrismaService) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  /**
   * Verifica si un hostname está bloqueado.
   * Returns { blocked: true, reason, pattern } o { blocked: false }.
   */
  async isBlocked(
    hostname: string,
  ): Promise<{ blocked: boolean; reason?: string; pattern?: string }> {
    if (!hostname) return { blocked: false };
    const normalized = hostname.toLowerCase().trim();

    if (Date.now() - this.cacheLoadedAt > BlocklistService.CACHE_TTL_MS) {
      await this.refreshCache();
    }

    for (const entry of this.cache) {
      if (this.matches(normalized, entry)) {
        return {
          blocked: true,
          reason: entry.reason ?? 'Blocked by policy',
          pattern: entry.pattern,
        };
      }
    }
    return { blocked: false };
  }

  private matches(hostname: string, entry: BlocklistEntry): boolean {
    const pattern = entry.pattern.toLowerCase();
    switch (entry.match_type) {
      case 'exact':
        return hostname === pattern;
      case 'suffix': {
        // 'paypal.com' suffix match — bloquea paypal.com, foo.paypal.com,
        // pero NO foopaypal.com (evita false positives por substring).
        const dotted = pattern.startsWith('.') ? pattern : '.' + pattern;
        return hostname === pattern || hostname.endsWith(dotted);
      }
      case 'regex': {
        let compiled = this.compiledRegexes.get(pattern);
        if (!compiled) {
          try {
            compiled = new RegExp(pattern, 'i');
            this.compiledRegexes.set(pattern, compiled);
          } catch (err) {
            this.logger.warn(
              `Invalid regex in blocklist: ${pattern} — ${(err as Error).message}`,
            );
            return false;
          }
        }
        return compiled.test(hostname);
      }
      default:
        return false;
    }
  }

  private async refreshCache() {
    try {
      const rows = await this.prisma.domain_blocklist.findMany({
        select: { pattern: true, match_type: true, reason: true },
      });
      this.cache = rows as BlocklistEntry[];
      this.cacheLoadedAt = Date.now();
      this.compiledRegexes.clear();
      this.logger.log(`Blocklist cargada: ${rows.length} entries`);
    } catch (err) {
      this.logger.error('Error cargando blocklist', err);
    }
  }

  /** Permite forzar refresh manual (ej. desde superadmin endpoint) */
  async forceRefresh() {
    await this.refreshCache();
  }
}
