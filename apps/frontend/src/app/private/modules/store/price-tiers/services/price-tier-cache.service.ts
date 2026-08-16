import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { PriceTier, ProductPriceTierOverride } from '../interfaces';
import { PriceTiersService } from './price-tiers.service';

/**
 * Light cache around `PriceTiersService` for sale flows (POS, orders create,
 * quotations) that repeatedly need:
 *
 *  - The catalog of active price tiers for the current store (single call,
 *    shareReplay'd until the user navigates away or `invalidate()` is called).
 *  - Per-product overrides (cached per `product_id`, fetched once per product
 *    that is added to a sale).
 *
 * The cache is intentionally simple — the tier catalog rarely changes during
 * a sale and the override list per product is small. Mutations from the admin
 * Price Tiers module should call `invalidate()` to force a refresh.
 *
 * Aligned with `vendix-frontend-cache`: shareReplay({ bufferSize:1, refCount:false })
 * for the catalog stream + a Map of Observables for per-product overrides.
 */
@Injectable({ providedIn: 'root' })
export class PriceTierCacheService {
  private readonly priceTiersService = inject(PriceTiersService);

  private activeTiers$: Observable<PriceTier[]> | null = null;
  private readonly overridesCache = new Map<
    number,
    Observable<ProductPriceTierOverride[]>
  >();

  /**
   * Active tiers for the current store. First subscriber triggers the HTTP
   * call, subsequent subscribers reuse the cached result.
   *
   * Errors are mapped to an empty array so the calling UI degrades gracefully
   * to "no tiers available" instead of breaking the cart flow.
   */
  getActiveTiers(): Observable<PriceTier[]> {
    if (!this.activeTiers$) {
      this.activeTiers$ = this.priceTiersService
        .list({ is_active: true, limit: 200, sort_by: 'sort_order' })
        .pipe(
          map((tiers) =>
            [...(tiers || [])].sort(
              (a, b) =>
                (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
                a.name.localeCompare(b.name),
            ),
          ),
          catchError(() => of([] as PriceTier[])),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.activeTiers$;
  }

  /**
   * Per-product overrides, cached by `product_id`. Returns an empty list on
   * error so callers can fall back to tier discount_percentage.
   */
  getProductOverrides(
    productId: number,
  ): Observable<ProductPriceTierOverride[]> {
    if (!Number.isFinite(productId) || productId <= 0) {
      return of([]);
    }
    let cached = this.overridesCache.get(productId);
    if (!cached) {
      cached = this.priceTiersService.getProductOverrides(productId).pipe(
        catchError(() => of([] as ProductPriceTierOverride[])),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.overridesCache.set(productId, cached);
    }
    return cached;
  }

  /**
   * Pre-fetch a product's overrides into the cache. Useful when adding items
   * to the cart so the selector is responsive when the user opens it.
   */
  prefetchProductOverrides(productId: number): void {
    void firstValueFrom(this.getProductOverrides(productId).pipe(tap(() => void 0)));
  }

  /** Drop all cached entries — call after admin mutations on tiers/overrides. */
  invalidate(): void {
    this.activeTiers$ = null;
    this.overridesCache.clear();
  }

  /** Drop a single product's overrides cache (e.g. after editing in product form). */
  invalidateProductOverrides(productId: number): void {
    this.overridesCache.delete(productId);
  }
}
