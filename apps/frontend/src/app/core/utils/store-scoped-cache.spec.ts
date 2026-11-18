import { of } from 'rxjs';

import {
  StoreScopedCache,
  activeStoreId,
  registerStoreSwitchReset,
  resetStoreScopedCaches,
} from './store-scoped-cache';

/**
 * QUI-1021: a cache entry belongs to the store that fetched it. A read under
 * another store misses even inside the TTL, and an environment switch empties
 * every registered cache.
 */
describe('StoreScopedCache (QUI-1021)', () => {
  const statsOfA = of({ total: 69 });
  const statsOfB = of({ total: 3 });
  let cache: StoreScopedCache<{ total: number }>;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T12:00:00Z'));
    cache = new StoreScopedCache<{ total: number }>(30_000);
  });

  afterEach(() => {
    cache.clear();
    jasmine.clock().uninstall();
  });

  it('serves an entry only to the store that stored it, even inside the TTL', () => {
    cache.set(1, statsOfA);

    expect(cache.get(1)).toBe(statsOfA);
    expect(cache.get(2)).toBeNull();

    cache.set(2, statsOfB);
    expect(cache.get(1)).toBe(statsOfA);
    expect(cache.get(2)).toBe(statsOfB);
  });

  it('expires an entry after the TTL and restarts it on touch', () => {
    cache.set(1, statsOfA);

    jasmine.clock().tick(29_999);
    expect(cache.get(1)).toBe(statsOfA);

    cache.touch(1);
    jasmine.clock().tick(29_999);
    expect(cache.get(1)).toBe(statsOfA);

    jasmine.clock().tick(1);
    expect(cache.get(1)).toBeNull();
  });

  it('does not bring back an entry dropped before its late response arrives', () => {
    cache.set(1, statsOfA);
    cache.delete(1);

    cache.touch(1);

    expect(cache.get(1)).toBeNull();
  });

  it('caches nothing without an active store', () => {
    cache.set(null, statsOfA);

    expect(cache.get(null)).toBeNull();
  });

  it('is emptied for every store by an environment switch', () => {
    cache.set(1, statsOfA);
    cache.set(2, statsOfB);

    resetStoreScopedCaches();

    expect(cache.get(1)).toBeNull();
    expect(cache.get(2)).toBeNull();
  });

  it('runs registered resets on a switch until they are unregistered', () => {
    const reset = jasmine.createSpy('reset');
    const unregister = registerStoreSwitchReset(reset);

    resetStoreScopedCaches();
    expect(reset).toHaveBeenCalledTimes(1);

    unregister();
    resetStoreScopedCaches();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reads the active store id from the session store, and null outside a store', () => {
    expect(activeStoreId({ userStore: () => ({ id: 7 }) })).toBe(7);
    expect(activeStoreId({ userStore: () => null })).toBeNull();
    expect(activeStoreId({ userStore: () => [{ id: 7 }] })).toBeNull();
  });
});
