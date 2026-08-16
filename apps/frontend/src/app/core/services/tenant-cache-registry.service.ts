import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * QUI-563 Fase 2 — Tenant cache invalidation bus.
 *
 * Pairs with the StoreScopedCache helper (Fase 1). Phase 1 closes the bug
 * "by construction" — every `get()` checks the tenant key. Phase 2 closes
 * it "by event" — every service that holds a cache registers a `clear()`
 * callback here, and the environment-switch service fires the bus before
 * `redirectToEnvironment()` so memory is wiped proactively.
 *
 * Why both? Defense in depth. Fase 1 catches the silent stale read even if
 * a service forgets to register (e.g. a future contributor adds a cache
 * without reading this file). Fase 2 catches the case where the entry is
 * still in scope and the consumer re-reads it before the TTL expires.
 *
 * Registration model:
 *   - Services call `register(id, clearFn)` in their constructor and
 *     store the returned disposer on `OnDestroy`.
 *   - `clearAll()` runs every registered callback in registration order.
 *     Order is not significant for correctness (caches are independent)
 *     but it keeps log lines predictable.
 *   - The bus is also exposed as an Observable for services that prefer
 *     to react to the event instead of holding a disposer (e.g. services
 *     that share their `clear()` via NgRx effects).
 */
@Injectable({
  providedIn: 'root',
})
export class TenantCacheRegistry implements OnDestroy {
  private readonly entries = new Map<
    string,
    { clear: () => void; owner: string | null }
  >();
  private readonly cleared$ = new Subject<void>();

  /**
   * Register a cache to be cleared on every store switch.
   *
   * @param id Stable identifier for the cache (e.g. 'store-settings').
   *           Re-registering with the same id replaces the previous
   *           callback (handy for tests).
   * @param clear Function that drops the cached value.
   * @param owner Optional label for logs.
   */
  register(id: string, clear: () => void, owner: string | null = null): void {
    this.entries.set(id, { clear, owner });
  }

  /**
   * Removes a registration. Returns true if anything was removed.
   */
  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Active eviction. Called by the environment-switch service when the
   * active `store_id` is about to change. Safe to call from anywhere.
   */
  clearAll(): void {
    for (const [id, entry] of this.entries) {
      try {
        entry.clear();
      } catch (err) {
        // Never let a buggy clear() take down the switch flow. Log and
        // continue — Fase 1 still defends against the stale read on the
        // next access.
        console.error(
          `[TenantCacheRegistry] clear() threw for "${id}" (owner=${entry.owner ?? 'unknown'}):`,
          err,
        );
      }
    }
    this.cleared$.next();
  }

  /**
   * Observable version. Useful for services that prefer to react to the
   * event instead of registering (e.g. NgRx effects that invalidate
   * feature state).
   */
  readonly onCleared = this.cleared$.asObservable();

  /**
   * Number of registered caches. Mostly for tests and diagnostics.
   */
  get size(): number {
    return this.entries.size;
  }

  ngOnDestroy(): void {
    this.entries.clear();
    this.cleared$.complete();
  }
}
