import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  BehaviorSubject,
  finalize,
  catchError,
  throwError,
  map,
} from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  StoreUser,
  CreateStoreUserDto,
  UpdateStoreUserDto,
  StoreUserQuery,
  StoreUserStats,
  PaginatedStoreUsersResponse,
} from '../interfaces/store-user.interface';

// Cache estatico global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let storeUsersStatsCache: CacheEntry<Observable<StoreUserStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class StoreUsersManagementService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/users/management`;
  private readonly CACHE_TTL = 30000; // 30 segundos

  // Estado de carga
  private isLoading$ = new BehaviorSubject<boolean>(false);
  private isCreatingUser$ = new BehaviorSubject<boolean>(false);
  private isUpdatingUser$ = new BehaviorSubject<boolean>(false);

  // Exponer estados como observables
  get isLoading() {
    return this.isLoading$.asObservable();
  }
  get isCreatingUser() {
    return this.isCreatingUser$.asObservable();
  }
  get isUpdatingUser() {
    return this.isUpdatingUser$.asObservable();
  }

  /**
   * Obtener lista de usuarios de la tienda con paginacion y filtros
   */
  getUsers(query: StoreUserQuery = {}): Observable<PaginatedStoreUsersResponse> {
    this.isLoading$.next(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.state) params = params.set('state', query.state);

    return this.http
      .get<any>(this.baseUrl, { params })
      .pipe(
        map((response) => {
          return {
            data: response.data,
            pagination: {
              page: response.meta?.page || response.pagination?.page || 1,
              limit: response.meta?.limit || response.pagination?.limit || 10,
              total: response.meta?.total || response.pagination?.total || 0,
              total_pages: response.meta?.totalPages || response.pagination?.total_pages || 0,
            },
          } as PaginatedStoreUsersResponse;
        }),
        finalize(() => this.isLoading$.next(false)),
        catchError((error) => {
          console.error('Error loading store users:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener estadisticas de usuarios de la tienda
   */
  getStats(): Observable<StoreUserStats> {
    const now = Date.now();

    if (
      storeUsersStatsCache &&
      now - storeUsersStatsCache.lastFetch < this.CACHE_TTL
    ) {
      return storeUsersStatsCache.observable;
    }

    const observable$ = this.http
      .get<{ data: StoreUserStats }>(`${this.baseUrl}/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((response) => response.data),
        tap(() => {
          if (storeUsersStatsCache) {
            storeUsersStatsCache.lastFetch = Date.now();
          }
        }),
        catchError((error) => {
          console.error('Error getting store users stats:', error);
          return throwError(() => error);
        }),
      );

    storeUsersStatsCache = {
      observable: observable$,
      lastFetch: Date.now(),
    };

    return observable$;
  }

  /**
   * Crear nuevo usuario en la tienda
   */
  createUser(userData: CreateStoreUserDto): Observable<StoreUser> {
    this.isCreatingUser$.next(true);

    return this.http
      .post<StoreUser>(this.baseUrl, userData)
      .pipe(
        finalize(() => this.isCreatingUser$.next(false)),
        catchError((error) => {
          console.error('Error creating store user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Actualizar usuario existente
   */
  updateUser(id: number, userData: UpdateStoreUserDto): Observable<StoreUser> {
    this.isUpdatingUser$.next(true);

    return this.http
      .patch<StoreUser>(`${this.baseUrl}/${id}`, userData)
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error updating store user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Desactivar usuario
   */
  deactivateUser(id: number): Observable<StoreUser> {
    this.isUpdatingUser$.next(true);

    return this.http
      .post<StoreUser>(`${this.baseUrl}/${id}/deactivate`, {})
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error deactivating store user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Reactivar usuario
   */
  reactivateUser(id: number): Observable<StoreUser> {
    this.isUpdatingUser$.next(true);

    return this.http
      .post<StoreUser>(`${this.baseUrl}/${id}/reactivate`, {})
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error reactivating store user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Resetear contrasena de usuario
   */
  resetPassword(id: number, data: { password: string }): Observable<any> {
    this.isUpdatingUser$.next(true);

    return this.http
      .post<any>(`${this.baseUrl}/${id}/reset-password`, data)
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error resetting store user password:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Invalida el cache de estadisticas
   */
  invalidateCache(): void {
    storeUsersStatsCache = null;
  }
}
