import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';

import { OrgInventoryService } from './org-inventory.service';
import { OrgTransfersService } from './org-transfers.service';
import { OrgAdjustmentsService } from './org-adjustments.service';

/**
 * Aggregated KPIs for the ORG_ADMIN inventory dashboard.
 *
 * Counts come from the four existing org-level inventory endpoints. There is
 * no dedicated `/inventory/dashboard` endpoint today, so we fan-out four
 * `combineLatest` calls and cache the merged result for `CACHE_TTL_MS`.
 */
export interface OrgInventoryDashboardStats {
  /** Distinct stock-level rows across all stores in the organization. */
  total_skus: number;
  /** `is_active=true` locations across all stores. */
  active_locations: number;
  /** Active suppliers across the organization. */
  active_suppliers: number;
  /** Recent movements (last response page) — used as a "recent activity" gauge. */
  recent_movements: number;
  /** Transfers currently in `in_transit` status. */
  transfers_in_transit: number;
  /** Adjustments currently in `pending` status. */
  adjustments_pending: number;
}

/**
 * Frontend-only aggregator for the ORG_ADMIN inventory landing dashboard.
 *
 * - Four parallel HTTP calls (locations, stock-levels, transfers, adjustments)
 *   are merged via `combineLatest`.
 * - The merged Observable is shared with `shareReplay({ bufferSize: 1, refCount: false })`
 *   and re-fetched after `CACHE_TTL_MS` expires (60s).
 * - `invalidate()` clears the cached observable so the next call re-fetches.
 *
 * Pattern aligned with `OrganizationDashboardService` and the
 * `vendix-frontend-cache` skill (TTL + shareReplay).
 */
@Injectable({ providedIn: 'root' })
export class OrgInventoryDashboardService {
  private readonly orgInventory = inject(OrgInventoryService);
  private readonly orgTransfers = inject(OrgTransfersService);
  private readonly orgAdjustments = inject(OrgAdjustmentsService);

  /** Cache TTL for the aggregated stats (60s). */
  private readonly CACHE_TTL_MS = 60_000;

  private cachedStream$: Observable<OrgInventoryDashboardStats> | null = null;
  private cachedAt = 0;

  /**
   * Returns a multicast Observable with the aggregated stats. Subsequent calls
   * within `CACHE_TTL_MS` reuse the same emission. Errors degrade gracefully
   * to zero counters on a per-call basis.
   */
  getDashboardStats(): Observable<OrgInventoryDashboardStats> {
    const now = Date.now();
    if (this.cachedStream$ && now - this.cachedAt < this.CACHE_TTL_MS) {
      return this.cachedStream$;
    }

    // Locations: count is_active=true across the organization.
    const locations$ = this.orgInventory
      .getLocations({ page: 1, limit: 1, is_active: true })
      .pipe(
        map((res) => this.extractTotal(res, res.data?.length ?? 0)),
        catchError(() => of(0)),
      );

    // Stock levels: count distinct SKU rows (variant or base).
    const stock$ = this.orgInventory.getStockLevels({}).pipe(
      map((res) => this.extractTotal(res, res.data?.length ?? 0)),
      catchError(() => of(0)),
    );

    // Suppliers: count active suppliers across the org.
    const suppliers$ = this.orgInventory
      .getSuppliers({ page: 1, limit: 1, is_active: true })
      .pipe(
        map((res) => this.extractTotal(res, res.data?.length ?? 0)),
        catchError(() => of(0)),
      );

    // Movements: best-effort count of recent activity rows.
    const movements$ = this.orgInventory.getMovements({}).pipe(
      map((res) => this.extractTotal(res, res.data?.length ?? 0)),
      catchError(() => of(0)),
    );

    // Transfers in_transit.
    const transfers$ = this.orgTransfers
      .list({ status: 'in_transit', page: 1, limit: 1 })
      .pipe(
        map((res) => this.extractTransferTotal(res)),
        catchError(() => of(0)),
      );

    // Adjustments pending.
    const adjustments$ = this.orgAdjustments
      .list({ status: 'pending', page: 1, limit: 1 })
      .pipe(
        map((res) => this.extractTransferTotal(res)),
        catchError(() => of(0)),
      );

    const merged$ = combineLatest([
      locations$,
      stock$,
      suppliers$,
      movements$,
      transfers$,
      adjustments$,
    ]).pipe(
      map(
        ([
          active_locations,
          total_skus,
          active_suppliers,
          recent_movements,
          transfers_in_transit,
          adjustments_pending,
        ]): OrgInventoryDashboardStats => ({
          total_skus,
          active_locations,
          active_suppliers,
          recent_movements,
          transfers_in_transit,
          adjustments_pending,
        }),
      ),
      tap(() => {
        this.cachedAt = Date.now();
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.cachedStream$ = merged$;
    this.cachedAt = now;
    return merged$;
  }

  /** Drop the cached observable so the next consumer triggers a fresh fan-out. */
  invalidate(): void {
    this.cachedStream$ = null;
    this.cachedAt = 0;
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private extractTotal(
    res: { meta?: { total?: number; pagination?: { total?: number } } },
    fallback: number,
  ): number {
    const total = res?.meta?.total ?? res?.meta?.pagination?.total;
    return typeof total === 'number' && total >= 0 ? total : fallback;
  }

  private extractTransferTotal(res: {
    meta?: { total?: number };
    pagination?: { total?: number };
    data?: unknown[];
  }): number {
    const total = res?.meta?.total ?? res?.pagination?.total;
    if (typeof total === 'number' && total >= 0) return total;
    return Array.isArray(res?.data) ? res.data.length : 0;
  }
}
