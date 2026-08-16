/**
 * Store-scoped cache helper (QUI-563 Fase 1).
 *
 * Wraps a single cached value with a `(store_id, cached_at)` pair so that any
 * read returns null when the active tenant does not match the cached tenant.
 *
 * This is a defense-by-construction pattern: even if a service forgets to
 * register itself with the TenantCacheRegistry or to listen to the switch
 * event, the cache can never serve data from a different tenant — the
 * store_id check happens inside `get()`, on every read.
 *
 * Tenant key semantics:
 *   - `store_id` (number) when the cache was filled under a STORE_ADMIN scope
 *   - `null` when filled under an ORG_ADMIN scope (organization-wide)
 *
 * The same `activeStoreId` value must be used to set and to read; passing
 * different values is the cache's primary invalidation trigger and is
 * cheaper than waiting for the TTL.
 *
 * NOT a thread-safe structure. Angular services are singletons and this
 * is intended for them — never share a single instance across multiple
 * `inject()` calls within a single request.
 */
export interface StoreScopedCacheEntry<T> {
  /** Tenant the cache was populated under. `null` means ORG_ADMIN scope. */
  readonly store_id: number | null;
  /** Epoch ms when the entry was written. Used for the TTL check. */
  readonly cached_at: number;
  /** The cached value. */
  readonly value: T;
}

export class StoreScopedCache<T> {
  private entry: StoreScopedCacheEntry<T> | null = null;

  /**
   * @param ttlMs TTL in milliseconds. 0 disables TTL (cache never expires
   *              on time alone; only tenant mismatch or explicit clear
   *              will evict). Use a positive value for normal use.
   */
  constructor(private readonly ttlMs: number) {}

  /**
   * Returns the cached value when the entry's store_id matches the active
   * tenant AND it has not expired. Returns `null` otherwise.
   *
   * `null` is intentionally indistinguishable from "never cached" so the
   * caller does not branch on cache state.
   */
  get(activeStoreId: number | null): T | null {
    if (!this.entry) {
      return null;
    }
    if (this.entry.store_id !== activeStoreId) {
      // Tenant mismatch — silent miss. This is the primary defense: even
      // a TTL-fresh entry from a previous tenant is invisible.
      return null;
    }
    if (this.ttlMs > 0 && Date.now() - this.entry.cached_at > this.ttlMs) {
      return null;
    }
    return this.entry.value;
  }

  /**
   * Stores `value` under the given tenant. If the tenant differs from the
   * existing entry, the previous value is dropped first — callers should
   * not rely on `set()` to perform an automatic migration.
   */
  set(activeStoreId: number | null, value: T): void {
    this.entry = {
      store_id: activeStoreId,
      cached_at: Date.now(),
      value,
    };
  }

  /**
   * Drops the cached value. Safe to call from the TenantCacheRegistry or
   * from a manual `invalidateCache()` method.
   */
  clear(): void {
    this.entry = null;
  }

  /**
   * Diagnostic helper. `true` means the next `get()` will return `null`
   * (either no entry, tenant mismatch, or TTL expired). Useful for tests.
   */
  isStale(activeStoreId: number | null): boolean {
    return this.get(activeStoreId) === null;
  }
}
