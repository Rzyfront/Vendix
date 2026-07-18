import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/**
 * Normalized store user option for selector components.
 *
 * Shape is derived from the real `GET /store/users` payload, where each item is
 * `{ id, email, first_name, last_name, phone, state, ... }` (see
 * `apps/backend/src/domains/store/store-users/store-users.service.ts`).
 * The backend does not expose an avatar URL today, so `avatar_url` is kept
 * optional/nullable for forward compatibility and consumers fall back to an
 * initials/icon avatar.
 */
export interface StoreUserOption {
  id: number;
  name: string;
  avatar_url?: string | null;
  email?: string;
}

/** Raw item shape returned by `GET /store/users`. */
interface RawStoreUser {
  id: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

/** Standard paginated envelope: `{ success, message, data, meta }`. */
interface PaginatedEnvelope<T> {
  data: T[];
  meta?: { total?: number; page?: number; limit?: number };
}

/** Options accepted by {@link StoreUserLookupService.search}. */
export interface StoreUserSearchOptions {
  limit?: number;
  /** User ids to drop from the result set (e.g. the already-selected driver). */
  excludeIds?: number[];
  /**
   * Role name to exclude from results (server-side `exclude_role`). Used by
   * staff-only pickers to hide ecommerce customers (who are also store users).
   */
  excludeRole?: string;
}

const DEFAULT_LIMIT = 10;
/** Wider page used when resolving a single user by id (no `:id` endpoint exists). */
const GET_BY_ID_LIMIT = 100;

/**
 * Store-scoped lookup for users (`GET /store/users`).
 *
 * The endpoint is automatically scoped to the active store via
 * `StorePrismaService` + request context on the backend, so no store id is sent
 * from the client. Debounce lives in the consuming component, not here.
 */
@Injectable({ providedIn: 'root' })
export class StoreUserLookupService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/users`;

  /**
   * Cache of the full active-user page used by {@link getById}. Store staff
   * lists are small, so a single shared, replayed request is enough to resolve
   * `writeValue(id)` across many selector instances without refetching.
   */
  private allActiveUsers$: Observable<StoreUserOption[]> | null = null;

  /**
   * Remote search against `GET /store/users?search=&limit=&state=ACTIVE`.
   *
   * @param term Free-text search (matches first name / last name / email).
   * @param opts Optional `limit` and `excludeIds`.
   */
  search(term: string, opts?: StoreUserSearchOptions): Observable<StoreUserOption[]> {
    const trimmed = term?.trim() ?? '';
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const excludeIds = opts?.excludeIds ?? [];

    let params = new HttpParams()
      .set('limit', String(limit))
      .set('state', 'ACTIVE');
    if (trimmed) {
      params = params.set('search', trimmed);
    }
    if (opts?.excludeRole) {
      params = params.set('exclude_role', opts.excludeRole);
    }

    return this.http
      .get<PaginatedEnvelope<RawStoreUser>>(this.baseUrl, { params })
      .pipe(
        map((res) => (res?.data ?? []).map(toStoreUserOption)),
        map((options) =>
          excludeIds.length
            ? options.filter((o) => !excludeIds.includes(o.id))
            : options,
        ),
        catchError(() => of([] as StoreUserOption[])),
      );
  }

  /**
   * Resolve a single user by id so `writeValue(id)` can render name/avatar.
   *
   * The backend has no public `GET /store/users/:id` returning the flat option
   * shape, so this fetches the (small) active-user list once and resolves
   * locally. Returns `null` when the id is not found.
   */
  getById(id: number): Observable<StoreUserOption | null> {
    if (id == null) {
      return of(null);
    }
    return this.loadAllActiveUsers().pipe(
      map((users) => users.find((u) => u.id === id) ?? null),
      catchError(() => of(null)),
    );
  }

  private loadAllActiveUsers(): Observable<StoreUserOption[]> {
    if (!this.allActiveUsers$) {
      const params = new HttpParams()
        .set('limit', String(GET_BY_ID_LIMIT))
        .set('state', 'ACTIVE');
      this.allActiveUsers$ = this.http
        .get<PaginatedEnvelope<RawStoreUser>>(this.baseUrl, { params })
        .pipe(
          map((res) => (res?.data ?? []).map(toStoreUserOption)),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.allActiveUsers$;
  }
}

/** Maps a raw `/store/users` item into a normalized {@link StoreUserOption}. */
function toStoreUserOption(raw: RawStoreUser): StoreUserOption {
  const name =
    [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim() ||
    raw.email ||
    `Usuario #${raw.id}`;
  return {
    id: raw.id,
    name,
    avatar_url: raw.avatar_url ?? null,
    email: raw.email ?? undefined,
  };
}
