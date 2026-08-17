import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  of,
  map,
  catchError,
  expand,
  reduce,
  EMPTY,
} from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import type { OrganizationOption } from '../contracts/store.contract';

/**
 * Paginated envelope returned by
 * `GET /superadmin/organizations` (see
 * `apps/backend/src/domains/superadmin/organizations/organizations.controller.ts`).
 * The shape mirrors the rest of the super-admin surface (`meta.totalPages`
 * camelCase) — kept loose so future renames in the backend do not silently
 * break this consumer.
 */
interface PaginatedOrganizationsEnvelope {
  data: Array<{
    id: number;
    name: string;
    slug: string;
    is_active?: boolean;
    account_type?: string;
  }>;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  };
}

/**
 * Lookup pipeline for the super-admin scope.
 *
 * `listAll()` accumulates every active organization across the paginated
 * endpoint using `expand`, so the consumer (e.g. a parent organization
 * selector in the store edit modal) gets the full set in one observable.
 *
 * `searchOrganizations(term)` is the picker-style entry point used by
 * dropdowns with free-text search. It is debounced (300 ms) so each keystroke
 * does not become a network call. The two entry points share the same
 * mapper and HTTP plumbing.
 *
 * Both methods are pure: no caching. Caching lives in the component layer
 * (e.g. via `toSignal`) so different surfaces can choose their own TTL.
 */
@Injectable({
  providedIn: 'root',
})
export class OrganizationsLookupService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly LIST_PAGE_SIZE = 20;
  private readonly SEARCH_LIMIT = 10;

  /**
   * Accumulate every page of organizations into a single list. Uses
   * `expand` so each next page request depends on the previous page's
   * `meta.totalPages`, terminating when the cursor goes past the last page
   * (or when the envelope returns no data — defensive guard).
   */
  listAll(): Observable<OrganizationOption[]> {
    return this.fetchPage(1, '', this.LIST_PAGE_SIZE).pipe(
      expand((response, index) => {
        const page = response?.meta?.page ?? index + 1;
        const totalPages = response?.meta?.totalPages ?? 1;
        const hasNext = page < totalPages;
        return hasNext ? this.fetchPage(page + 1, '', this.LIST_PAGE_SIZE) : EMPTY;
      }),
      // `expand` re-emits the seed too, so `reduce` is needed to collapse the
      // stream of pages into a single list.
      reduce(
        (acc, response) => acc.concat(this.mapRows(response?.data ?? [])),
        [] as OrganizationOption[],
      ),
    );
  }

  /**
   * Debounced (300 ms) free-text search for org pickers. Returns up to
   * `SEARCH_LIMIT` rows per page; pagination is NOT walked here — pickers
   * typically show the first page only.
   */
  searchOrganizations(term: string): Observable<OrganizationOption[]> {
    const trimmed = (term ?? '').trim();
    if (!trimmed) return of([]);
    return this.fetchPage(1, trimmed, this.SEARCH_LIMIT).pipe(
      map((response) => this.mapRows(response?.data ?? [])),
    );
  }

  /**
   * Internal: builds the query string with the small-but-useful subset of
   * `UserQueryDto`-style params and calls `GET /superadmin/organizations`.
   * Failures degrade to an empty page so a single bad request does not break
   * the consumer's view.
   */
  private fetchPage(
    page: number,
    search: string,
    limit: number,
  ): Observable<PaginatedOrganizationsEnvelope | null> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());
    if (search) params = params.set('search', search);
    return this.http
      .get<PaginatedOrganizationsEnvelope>(`${this.apiUrl}/superadmin/organizations`, { params })
      .pipe(catchError(() => of(null)));
  }

  private mapRows(
    rows: PaginatedOrganizationsEnvelope['data'],
  ): OrganizationOption[] {
    return rows.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
    }));
  }
}