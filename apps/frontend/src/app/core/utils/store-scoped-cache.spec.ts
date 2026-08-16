import { StoreScopedCache } from './store-scoped-cache';

describe('StoreScopedCache', () => {
  const STORE_A = 101;
  const STORE_B = 202;
  let cache: StoreScopedCache<string>;

  beforeEach(() => {
    cache = new StoreScopedCache<string>(60_000);
  });

  describe('empty state', () => {
    it('returns null when no entry was ever written', () => {
      expect(cache.get(STORE_A)).toBeNull();
    });

    it('isStale() reports true for an empty cache', () => {
      expect(cache.isStale(STORE_A)).toBeTrue();
    });
  });

  describe('tenant-scoped reads (QUI-563 Fase 1 — defense by construction)', () => {
    it('returns the cached value when the active tenant matches', () => {
      cache.set(STORE_A, 'store-a-value');
      expect(cache.get(STORE_A)).toBe('store-a-value');
    });

    it('returns null when the active tenant differs from the cached tenant', () => {
      cache.set(STORE_A, 'store-a-value');
      // The exact bug window: a TTL-fresh entry from store A is invisible
      // to store B, even though the TTL has not expired.
      expect(cache.get(STORE_B)).toBeNull();
    });

    it('keeps the entry across reads as long as the tenant matches', () => {
      cache.set(STORE_A, 'store-a-value');
      cache.get(STORE_A);
      cache.get(STORE_A);
      expect(cache.get(STORE_A)).toBe('store-a-value');
    });

    it('treats ORG_ADMIN scope (store_id=null) as a separate tenant from any store', () => {
      cache.set(null, 'org-wide');
      expect(cache.get(null)).toBe('org-wide');
      expect(cache.get(STORE_A)).toBeNull();
      expect(cache.get(STORE_B)).toBeNull();
    });
  });

  describe('TTL', () => {
    it('returns null after the TTL has expired', () => {
      cache = new StoreScopedCache<string>(50);
      cache.set(STORE_A, 'value');
      jasmine.clock().tick(51);
      expect(cache.get(STORE_A)).toBeNull();
    });

    it('still returns the value just before the TTL expires', () => {
      cache = new StoreScopedCache<string>(100);
      cache.set(STORE_A, 'value');
      jasmine.clock().tick(99);
      expect(cache.get(STORE_A)).toBe('value');
    });

    it('disables TTL when ttlMs is 0 (entry survives indefinitely, only tenant key and clear() can evict)', () => {
      cache = new StoreScopedCache<string>(0);
      cache.set(STORE_A, 'value');
      jasmine.clock().tick(10_000_000);
      expect(cache.get(STORE_A)).toBe('value');
    });
  });

  describe('overwrite semantics', () => {
    it('replaces the entry when set() is called again with the same tenant', () => {
      cache.set(STORE_A, 'first');
      cache.set(STORE_A, 'second');
      expect(cache.get(STORE_A)).toBe('second');
    });

    it('discards the previous entry silently when set() is called with a different tenant', () => {
      // The previous store's entry is dropped without ceremony — callers
      // should not rely on `set()` to perform an automatic migration.
      cache.set(STORE_A, 'store-a-value');
      cache.set(STORE_B, 'store-b-value');
      expect(cache.get(STORE_A)).toBeNull();
      expect(cache.get(STORE_B)).toBe('store-b-value');
    });
  });

  describe('clear()', () => {
    it('drops the cached value entirely', () => {
      cache.set(STORE_A, 'value');
      cache.clear();
      expect(cache.get(STORE_A)).toBeNull();
    });

    it('is idempotent on an empty cache', () => {
      expect(() => cache.clear()).not.toThrow();
      cache.clear();
      expect(cache.get(STORE_A)).toBeNull();
    });
  });
});
