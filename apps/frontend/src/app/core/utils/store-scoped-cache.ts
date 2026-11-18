import { Observable } from 'rxjs';

/**
 * Store-scoped caches (QUI-1021).
 *
 * The backend resolves the store from the session token, so a URL such as
 * `/store/dispatch-notes/stats` does not say whose numbers a response holds.
 * A module-level cache keyed only by URL keeps serving store A's figures after
 * the user switches to store B without reloading the page.
 *
 * Every module-level cache that holds per-store API data must therefore:
 * 1. key its entries by the active store id ({@link activeStoreId}), and
 * 2. register a reset ({@link registerStoreSwitchReset}) that
 *    `EnvironmentSwitchService` runs on every environment switch.
 *
 * {@link StoreScopedCache} does both for a single value per store.
 */

type StoreSwitchReset = () => void;

const storeSwitchResets = new Set<StoreSwitchReset>();

/**
 * Registers a reset to run on every environment switch. Returns a function
 * that unregisters it, for owners that live shorter than the page.
 */
export function registerStoreSwitchReset(reset: StoreSwitchReset): () => void {
  storeSwitchResets.add(reset);
  return () => {
    storeSwitchResets.delete(reset);
  };
}

/**
 * Runs every registered reset. `EnvironmentSwitchService` calls it once the
 * session of the new environment is in place.
 */
export function resetStoreScopedCaches(): void {
  storeSwitchResets.forEach((reset) => reset());
}

/**
 * Id of the store active in this tab's session (`AuthFacade.userStore()`), or
 * `null` outside a store. Uses the same source as the auth interceptor's
 * session, not `localStorage`, which another tab may already have switched.
 */
export function activeStoreId(authFacade: { userStore: () => unknown }): number | null {
  const id = (authFacade.userStore() as { id?: unknown } | null)?.id;
  return typeof id === 'number' ? id : null;
}

interface StoreScopedEntry<T> {
  observable: Observable<T>;
  lastFetch: number;
}

/**
 * TTL cache with one entry per store, emptied on every environment switch.
 *
 * A read for store B never returns the entry stored for store A, even inside
 * the TTL. Without a store id (`null`) nothing is read or stored.
 */
export class StoreScopedCache<T> {
  private readonly entries = new Map<number, StoreScopedEntry<T>>();

  constructor(private readonly ttlMs: number) {
    registerStoreSwitchReset(() => this.clear());
  }

  /** Cached observable of `storeId`, or `null` when absent or expired. */
  get(storeId: number | null): Observable<T> | null {
    if (storeId === null) return null;
    const entry = this.entries.get(storeId);
    if (!entry || Date.now() - entry.lastFetch >= this.ttlMs) return null;
    return entry.observable;
  }

  set(storeId: number | null, observable: Observable<T>): void {
    if (storeId === null) return;
    this.entries.set(storeId, { observable, lastFetch: Date.now() });
  }

  /**
   * Restarts the TTL of the entry of `storeId` (call it when the response
   * arrives). No-op when the entry was dropped meanwhile, so a late response
   * of a store the user already left does not bring its entry back.
   */
  touch(storeId: number | null): void {
    if (storeId === null) return;
    const entry = this.entries.get(storeId);
    if (entry) entry.lastFetch = Date.now();
  }

  /** Drops the entry of one store. */
  delete(storeId: number | null): void {
    if (storeId !== null) this.entries.delete(storeId);
  }

  /** Drops the entries of every store. */
  clear(): void {
    this.entries.clear();
  }
}
