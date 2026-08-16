import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap, timer } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/**
 * Normalized PUC account option for selector components.
 *
 * Shape derives from the real `GET /{scope}/accounting/chart-of-accounts`
 * payload (`{ id, code, name, account_type, level, is_active,
 * accepts_entries, ... }`, see
 * `apps/backend/src/domains/store/accounting/chart-of-accounts/chart-of-accounts.service.ts`).
 */
export interface ChartAccountOption {
  id: number;
  code: string;
  name: string;
  /**
   * `false` marks a grouping/heading account (clase, grupo, cuenta) that the
   * ledger refuses to post to; `true` marks a leaf that accepts movements.
   * The selector renders the distinction instead of hiding it, so a user who
   * disabled the leaf filter still knows what they are picking.
   */
  accepts_entries: boolean;
  account_type?: string | null;
  level?: number | null;
  is_active?: boolean;
}

/** Result of one remote page. */
export interface ChartAccountSearchResult {
  items: ChartAccountOption[];
  /** Rows matching the filter server-side (`meta.total`), not just this page. */
  total: number;
  /** `true` when the server has rows this page did not return. */
  hasMore: boolean;
}

/** Which controller answers the lookup. */
export type ChartAccountScope =
  | 'store'
  | 'organization'
  /**
   * Super-admin fiscal: el PUC de CUALQUIER tienda/organización, leído por
   * super-admin con scope fiscal. La ruta del backend tiene guion porque el
   * sub-camino es `fiscal`, no `super-admin`.
   */
  | 'super-admin/fiscal';

export interface ChartAccountLookupOptions {
  /** Defaults to `'store'`; the ORG_ADMIN fiscal wizard passes `'organization'`. */
  scope?: ChartAccountScope;
  /** Narrows an org-level read to one store (`?store_id=`). */
  storeId?: number | null;
  /** Page size. The selector defaults to 5 — the rest arrives via search. */
  limit?: number;
  /** Zero-based row offset. */
  offset?: number;
  /** Restrict to accounts that accept journal lines. Defaults to `true`. */
  acceptsEntriesOnly?: boolean;
  /** Restrict to `is_active` accounts. Defaults to `true`. */
  activeOnly?: boolean;
}

/** Raw row shape returned by the chart-of-accounts list endpoint. */
interface RawChartAccount {
  id: number;
  code?: string | null;
  name?: string | null;
  accepts_entries?: boolean | null;
  account_type?: string | null;
  level?: number | null;
  is_active?: boolean | null;
}

/**
 * Standard envelope. The store controller answers
 * `{ success, message, data, meta: { total, ... } }` (ResponseService.paginated);
 * the organization controller still answers `{ success, message, data }`, so
 * `meta` is optional here and `total` degrades to the page length.
 */
interface PaginatedEnvelope<T> {
  data: T[];
  meta?: { total?: number; page?: number; limit?: number };
}

/** Batched-hydration state, one bucket per lookup context. */
interface HydrationBatch {
  ids: number[];
  flush$: Observable<Map<number, ChartAccountOption>> | null;
}

/** Window the id batcher waits before firing, so N selectors share one GET. */
const HYDRATION_BATCH_MS = 25;
/** Server caps `ids` at 500; stay well under it. */
const HYDRATION_CHUNK = 200;
const DEFAULT_LIMIT = 5;

/**
 * Scoped lookup for chart-of-accounts rows (`GET /{scope}/accounting/chart-of-accounts`).
 *
 * Mirrors {@link import('./store-user-lookup.service').StoreUserLookupService}:
 * the HTTP surface lives here, the debounce lives in the consuming component.
 *
 * Two extras the user lookup does not need:
 *
 * - **First-page cache.** The mappings form renders ~230 selectors at once. The
 *   initial 5-row page is fetched once per context and replayed, not 230 times.
 * - **Batched hydration.** A form opened in edit mode has a stored account id
 *   per row, almost never inside the initial 5. Those ids are collected for a
 *   few milliseconds and resolved with a single `?ids=1,2,3` request. Resolving
 *   through `GET /chart-of-accounts/:id` would not work here anyway: that route
 *   sits behind `ModuleFlowGuard`, which rejects reads while the accounting
 *   module is still WIP during the fiscal wizard, whereas the list route is
 *   `@SkipModuleFlowGuard()`.
 */
@Injectable({ providedIn: 'root' })
export class ChartAccountLookupService {
  private readonly http = inject(HttpClient);

  /** Resolved accounts, keyed by id. Accounts are effectively immutable here. */
  private readonly byId = new Map<number, ChartAccountOption>();
  /** First-page observables, keyed by lookup context. */
  private readonly firstPages = new Map<
    string,
    Observable<ChartAccountSearchResult>
  >();
  /** In-flight hydration batches, keyed by lookup context. */
  private readonly batches = new Map<string, HydrationBatch>();

  /**
   * Remote search by **code or name** — the backend `where` ORs
   * `code contains` with `name contains`, so `4135` and `comercio` both hit.
   */
  search(
    term: string,
    opts?: ChartAccountLookupOptions,
  ): Observable<ChartAccountSearchResult> {
    const trimmed = term?.trim() ?? '';
    const limit = opts?.limit ?? DEFAULT_LIMIT;

    if (!trimmed) {
      return this.firstPage(opts);
    }

    return this.fetchPage({ ...opts, limit }, (params) =>
      params.set('search', trimmed),
    );
  }

  /**
   * First `limit` accounts of the context, fetched once and replayed.
   *
   * This is the "load only 5" page: everything past it is reached by typing.
   */
  firstPage(
    opts?: ChartAccountLookupOptions,
  ): Observable<ChartAccountSearchResult> {
    const key = this.contextKey(opts);
    const cached = this.firstPages.get(key);
    if (cached) {
      return cached;
    }

    const request$ = this.fetchPage(opts).pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.firstPages.set(key, request$);
    return request$;
  }

  /**
   * Resolve one account id so `writeValue(id)` can render `code — name` even
   * when the account is nowhere near the first page.
   */
  resolveById(
    id: number | null | undefined,
    opts?: ChartAccountLookupOptions,
  ): Observable<ChartAccountOption | null> {
    if (id == null || !Number.isFinite(Number(id))) {
      return of(null);
    }
    const numericId = Number(id);
    const cached = this.byId.get(numericId);
    if (cached) {
      return of(cached);
    }
    return this.enqueueHydration(numericId, opts);
  }

  /**
   * Resolve one account by PUC code, for consumers whose stored value is the
   * code rather than the id (the default-mapping cascade speaks codes).
   */
  resolveByCode(
    code: string | null | undefined,
    opts?: ChartAccountLookupOptions,
  ): Observable<ChartAccountOption | null> {
    const trimmed = code?.trim();
    if (!trimmed) {
      return of(null);
    }
    return this.fetchPage({ ...opts, limit: 20 }, (params) =>
      params.set('search', trimmed),
    ).pipe(
      map(
        (res) =>
          res.items.find((a) => a.code === trimmed) ??
          res.items.find((a) => a.code.startsWith(trimmed)) ??
          null,
      ),
      catchError(() => of(null)),
    );
  }

  /** Drops cached pages/accounts — call when the fiscal context changes. */
  reset(): void {
    this.byId.clear();
    this.firstPages.clear();
    this.batches.clear();
  }

  // ── internals ─────────────────────────────────────────────────────────

  private baseUrl(opts?: ChartAccountLookupOptions): string {
    const scope = opts?.scope ?? 'store';
    return `${environment.apiUrl}/${scope}/accounting/chart-of-accounts`;
  }

  private contextKey(opts?: ChartAccountLookupOptions): string {
    return [
      opts?.scope ?? 'store',
      opts?.storeId ?? '',
      opts?.acceptsEntriesOnly === false ? 'all' : 'leaf',
      opts?.activeOnly === false ? 'any' : 'active',
      opts?.limit ?? DEFAULT_LIMIT,
    ].join('|');
  }

  private buildParams(opts?: ChartAccountLookupOptions): HttpParams {
    let params = new HttpParams().set(
      'limit',
      String(opts?.limit ?? DEFAULT_LIMIT),
    );
    if (opts?.offset) {
      params = params.set('offset', String(opts.offset));
    }
    if (opts?.acceptsEntriesOnly !== false) {
      params = params.set('accepts_entries', 'true');
    }
    if (opts?.activeOnly !== false) {
      params = params.set('is_active', 'true');
    }
    // Only the organization controller acts on `store_id`; the store one is
    // already scoped by the request context, so sending it there is noise.
    if (opts?.scope === 'organization' && opts.storeId != null) {
      params = params.set('store_id', String(opts.storeId));
    }
    return params;
  }

  private fetchPage(
    opts?: ChartAccountLookupOptions,
    decorate?: (params: HttpParams) => HttpParams,
  ): Observable<ChartAccountSearchResult> {
    const base = this.buildParams(opts);
    const params = decorate ? decorate(base) : base;
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const offset = opts?.offset ?? 0;

    return this.http
      .get<PaginatedEnvelope<RawChartAccount>>(this.baseUrl(opts), { params })
      .pipe(
        map((res) => {
          const items = (res?.data ?? []).map(toChartAccountOption);
          // `meta.total` only exists on the store controller; without it, a
          // full page is the honest signal that more rows may follow.
          const total = res?.meta?.total ?? offset + items.length;
          return {
            items,
            total,
            hasMore:
              res?.meta?.total != null
                ? offset + items.length < total
                : items.length >= limit,
          } satisfies ChartAccountSearchResult;
        }),
        tap((res) => res.items.forEach((a) => this.byId.set(a.id, a))),
        catchError(() =>
          of({ items: [], total: 0, hasMore: false } as ChartAccountSearchResult),
        ),
      );
  }

  /**
   * Adds `id` to the pending batch for its context and returns the slice of
   * the shared response that belongs to it.
   */
  private enqueueHydration(
    id: number,
    opts?: ChartAccountLookupOptions,
  ): Observable<ChartAccountOption | null> {
    const key = this.contextKey(opts);
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { ids: [], flush$: null };
      this.batches.set(key, batch);
    }
    if (!batch.ids.includes(id)) {
      batch.ids.push(id);
    }

    const pending = batch;
    if (!pending.flush$) {
      pending.flush$ = timer(HYDRATION_BATCH_MS).pipe(
        switchMap(() => {
          const ids = pending.ids;
          // Reset synchronously so ids arriving after the flush start a new
          // batch instead of silently joining one already in flight.
          pending.ids = [];
          pending.flush$ = null;
          return this.fetchByIds(ids, opts);
        }),
        tap((resolved) =>
          resolved.forEach((account, accountId) =>
            this.byId.set(accountId, account),
          ),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }

    // Captured now: the switchMap above nulls `pending.flush$` when it fires,
    // which must not detach the subscribers that already joined this batch.
    const flush$ = pending.flush$;
    return flush$.pipe(
      map((resolved) => resolved.get(id) ?? null),
      catchError(() => of(null)),
    );
  }

  /**
   * One `?ids=` request per chunk. Hydration must see grouping accounts and
   * inactive ones too — a form can legitimately hold an account that no longer
   * passes the selector's own filters, and rendering it blank would be worse
   * than rendering it.
   */
  private fetchByIds(
    ids: number[],
    opts?: ChartAccountLookupOptions,
  ): Observable<Map<number, ChartAccountOption>> {
    if (ids.length === 0) {
      return of(new Map());
    }

    const chunk = ids.slice(0, HYDRATION_CHUNK);
    const rest = ids.slice(HYDRATION_CHUNK);

    let params = new HttpParams()
      .set('ids', chunk.join(','))
      .set('limit', String(chunk.length));
    // Only the organization controller acts on `store_id`; the store one is
    // already scoped by the request context, so sending it there is noise.
    if (opts?.scope === 'organization' && opts.storeId != null) {
      params = params.set('store_id', String(opts.storeId));
    }

    const chunk$ = this.http
      .get<PaginatedEnvelope<RawChartAccount>>(this.baseUrl(opts), { params })
      .pipe(
        map((res) => {
          const resolved = new Map<number, ChartAccountOption>();
          (res?.data ?? []).forEach((raw) => {
            const option = toChartAccountOption(raw);
            resolved.set(option.id, option);
          });
          return resolved;
        }),
        catchError(() => of(new Map<number, ChartAccountOption>())),
      );

    if (rest.length === 0) {
      return chunk$;
    }

    return chunk$.pipe(
      switchMap((resolved) =>
        this.fetchByIds(rest, opts).pipe(
          map((more) => {
            more.forEach((value, key) => resolved.set(key, value));
            return resolved;
          }),
        ),
      ),
    );
  }
}

/** Maps a raw chart-of-accounts row into a normalized option. */
function toChartAccountOption(raw: RawChartAccount): ChartAccountOption {
  return {
    id: raw.id,
    code: raw.code ?? '',
    name: raw.name ?? '',
    accepts_entries: raw.accepts_entries ?? false,
    account_type: raw.account_type ?? null,
    level: raw.level ?? null,
    is_active: raw.is_active ?? true,
  };
}
