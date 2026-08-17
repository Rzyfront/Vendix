import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import type { ManagerOption } from '../contracts/store.contract';
import type { UserPickerOption } from '../../../../../shared/components/user-select/user-select.component';

/**
 * Paginated envelope shape returned by `GET /superadmin/users` and by
 * `UsersController.findAll` (`apps/backend/src/domains/superadmin/users/users.controller.ts:49`).
 *
 * The controller responds via `ResponseService.paginated(...)`, so the payload
 * includes `meta.totalPages` (camelCase) — keep this loose to avoid drift if
 * the backend ever normalizes to snake_case.
 */
interface PaginatedUsersEnvelope {
  data: Array<{
    id: number;
    first_name?: string;
    last_name?: string;
    email: string;
    username?: string;
    state?: string;
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
 * `GET /superadmin/users?search=&state=ACTIVE&limit=10` returns
 * paginated `{ data, meta }`. The shared `UserSelectComponent` calls
 * `searchUsers(term)` and consumes the picker-shape rows directly.
 *
 * The class is `providedIn: 'root'` so the picker can inject it without a
 * module-level dependency. The 300 ms debounce lives in the picker itself —
 * this service is intentionally tiny so it can be reused by other super-admin
 * surfaces (admin tools, owner pickers, etc.) without dragging the debounce
 * along.
 */
@Injectable({
  providedIn: 'root',
})
export class SuperAdminUsersLookupService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly DEFAULT_LIMIT = 10;
  private readonly ACTIVE_STATE = 'ACTIVE';

  /**
   * Search super-admin users by free-text term.
   *
   * Maps the backend `User` shape into the picker-shape `UserPickerOption`
   * (`displayName = first_name + ' ' + last_name`, fallback to `username`
   * or `email`).
   */
  searchUsers(term: string): Observable<UserPickerOption[]> {
    const trimmed = (term ?? '').trim();
    if (!trimmed) return of([]);

    let params = new HttpParams()
      .set('search', trimmed)
      .set('state', this.ACTIVE_STATE)
      .set('limit', this.DEFAULT_LIMIT.toString());

    return this.http
      .get<PaginatedUsersEnvelope>(`${this.apiUrl}/superadmin/users`, { params })
      .pipe(
        map((envelope) => this.mapRows(envelope?.data ?? [])),
        catchError(() => of([] as UserPickerOption[])),
      );
  }

  /**
   * Same source, but maps to the canonical {@link ManagerOption} shape used
   * by the super-admin store contract. Exposed separately so other surfaces
   * (manager pickers in the store edit modal, etc.) can consume the manager
   * shape without re-implementing the mapping.
   */
  searchManagers(term: string): Observable<ManagerOption[]> {
    return this.searchUsers(term).pipe(
      map((rows) =>
        rows.map((r) => {
          // `displayName` for global users is `first_name + ' ' + last_name`;
          // split it back so ManagerOption consumers get the original parts.
          const [first, ...rest] = r.displayName.split(' ');
          return {
            id: r.id,
            first_name: first ?? '',
            last_name: rest.join(' '),
            email: r.email,
          };
        }),
      ),
    );
  }

  private mapRows(
    rows: PaginatedUsersEnvelope['data'],
  ): UserPickerOption[] {
    return rows.map((u) => ({
      id: u.id,
      displayName: this.composeDisplayName(u),
      email: u.email,
      initialsSource: u.first_name ?? u.username ?? u.email,
    }));
  }

  private composeDisplayName(u: {
    first_name?: string;
    last_name?: string;
    username?: string;
    email: string;
  }): string {
    const composed = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    if (composed) return composed;
    if (u.username) return u.username;
    return u.email;
  }
}