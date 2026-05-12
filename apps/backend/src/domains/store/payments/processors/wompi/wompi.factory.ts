import { Injectable } from '@nestjs/common';
import { WompiClient } from './wompi.client';
import { WompiConfig } from './wompi.types';

/**
 * Thread-safe factory that builds immutable, per-tenant WompiClient instances.
 *
 * A simple LRU cache (Map ordered by insertion) stores up to 50 clients keyed
 * by an arbitrary cacheKey (e.g. `store-${storeId}` or `org-${orgId}`).
 * If the cached config no longer matches the requested config the entry is
 * evicted and a fresh instance is created, so credential rotations are
 * respected without restarting the process.
 */
@Injectable()
export class WompiClientFactory {
  private readonly cache = new Map<string, WompiClient>();
  private readonly maxSize = 50;

  getClient(cacheKey: string, config: WompiConfig): WompiClient {
    const existing = this.cache.get(cacheKey);
    if (existing && this.configMatches(existing.config, config)) {
      return existing;
    }

    const client = new WompiClient(config);

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(cacheKey, client);
    return client;
  }

  private configMatches(a: WompiConfig, b: WompiConfig): boolean {
    return (
      a.public_key === b.public_key &&
      a.private_key === b.private_key &&
      a.events_secret === b.events_secret &&
      a.integrity_secret === b.integrity_secret &&
      a.environment === b.environment
    );
  }
}
