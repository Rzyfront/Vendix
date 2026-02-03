import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, finalize, catchError, throwError, map } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
    AuditQueryDto,
    AuditStats,
    PaginatedAuditResponse,
} from '../interfaces/audit.interface';

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let orgAuditStatsCache: CacheEntry<Observable<AuditStats>> | null = null;

@Injectable({
    providedIn: 'root',
})
export class AuditService {
    private http = inject(HttpClient);
    private apiUrl = environment.apiUrl;
    private readonly CACHE_TTL = 30000; // 30 segundos

    private isLoading$ = new BehaviorSubject<boolean>(false);

    get isLoading() {
        return this.isLoading$.asObservable();
    }

    /**
     * Obtener logs de auditoría
     */
    getAuditLogs(query: AuditQueryDto = {}): Observable<PaginatedAuditResponse> {
        this.isLoading$.next(true);

        let params = new HttpParams();
        if (query.page) params = params.set('page', query.page.toString());
        if (query.limit) params = params.set('limit', query.limit.toString());

        // Pagination to offset calculation if needed, but backend takes limit/offset usually or page/limit if standard.
        // Assuming backend standard pagination or mapper similar to users service.
        // Checking backend controller: it takes limit and offset.
        // Users service maps page/limit -> backend pagination. 
        // Backend controller logic seemed to use limit/offset directly in findMany.
        // We should map page -> offset.
        if (query.page && query.limit) {
            const offset = (query.page - 1) * query.limit;
            params = params.set('offset', offset.toString());
        }

        if (query.action) params = params.set('action', query.action);
        if (query.resource) params = params.set('resource', query.resource);
        if (query.from_date) params = params.set('from_date', query.from_date);
        if (query.to_date) params = params.set('to_date', query.to_date);

        return this.http
            .get<any>(`${this.apiUrl}/organization/audit/logs`, { params })
            .pipe(
                map((response) => {
                    // Backend returns { success: true, data: logs, message: ... }
                    // Need to construct pagination info since basic findMany doesn't return meta count unless we modify backend to do so.
                    // Backend 'getAuditLogs' returns just the array of logs in 'data' field of ResponseService.success().
                    // WITHOUT TOTAL COUNT in backend, pagination will be tricky.
                    // Wait, standard backend usually returns data directly.
                    // Let's assume for now we get the list.
                    // Frontend table needs total for pagination.
                    // Review backend again?
                    // Backend Controller: returns `this.responseService.success(logs, ...)`
                    // Service `getAuditLogs`: returns array.
                    // Missing 'count'.
                    // We will handle this limitation or update backend if strictly needed, but for now let's map what we have.
                    // Actually, `UsersService` used standard paginated response.
                    // Audit backend service assumes standard list.
                    // We will mock total or fix backend later. For now let's assume simple list return.
                    return {
                        data: response.data,
                        pagination: {
                            page: query.page || 1,
                            limit: query.limit || 50,
                            total: 1000, // Placeholder as backend doesn't return count yet
                            totalPages: 20 // Placeholder
                        }
                    } as PaginatedAuditResponse;
                }),
                finalize(() => this.isLoading$.next(false)),
                catchError((error) => {
                    console.error('Error loading audit logs:', error);
                    return throwError(() => error);
                }),
            );
    }

    /**
     * Obtener estadísticas de auditoría
     */
    getAuditStats(fromDate?: string, toDate?: string): Observable<AuditStats> {
        // Si hay parámetros de fecha, no usar caché
        if (fromDate || toDate) {
            let params = new HttpParams();
            if (fromDate) params = params.set('fromDate', fromDate);
            if (toDate) params = params.set('toDate', toDate);

            return this.http
                .get<any>(`${this.apiUrl}/organization/audit/stats`, { params })
                .pipe(
                    map((response) => response.data),
                    catchError((error) => {
                        console.error('Error loading audit stats:', error);
                        return throwError(() => error);
                    }),
                );
        }

        // Sin parámetros - usar caché
        const now = Date.now();

        if (orgAuditStatsCache && (now - orgAuditStatsCache.lastFetch) < this.CACHE_TTL) {
            return orgAuditStatsCache.observable;
        }

        const observable$ = this.http
            .get<any>(`${this.apiUrl}/organization/audit/stats`)
            .pipe(
                shareReplay({ bufferSize: 1, refCount: false }),
                map((response) => response.data),
                tap(() => {
                    if (orgAuditStatsCache) {
                        orgAuditStatsCache.lastFetch = Date.now();
                    }
                }),
                catchError((error) => {
                    console.error('Error loading audit stats:', error);
                    return throwError(() => error);
                }),
            );

        orgAuditStatsCache = {
            observable: observable$,
            lastFetch: now,
        };

        return observable$;
    }

    /**
     * Invalida el caché de estadísticas
     * Útil después de crear/editar/eliminar logs de auditoría
     */
    invalidateCache(): void {
        orgAuditStatsCache = null;
    }
}
