import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, finalize, catchError, throwError, map } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import {
    AuditQueryDto,
    AuditStats,
    PaginatedAuditResponse,
} from '../interfaces/audit.interface';

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
    private readonly CACHE_TTL = 30000;

    readonly isLoading = signal<boolean>(false);
    readonly isLoading$ = toObservable(this.isLoading);

    /**
     * Obtener logs de auditoría con paginación real del backend
     */
    getAuditLogs(query: AuditQueryDto = {}): Observable<PaginatedAuditResponse> {
        this.isLoading.set(true);

        let params = new HttpParams();
        if (query.page) params = params.set('page', query.page.toString());
        if (query.limit) params = params.set('limit', query.limit.toString());
        if (query.action) params = params.set('action', query.action);
        if (query.resource) params = params.set('resource', query.resource);
        if (query.from_date) params = params.set('from_date', query.from_date);
        if (query.to_date) params = params.set('to_date', query.to_date);

        return this.http
            .get<any>(`${this.apiUrl}/organization/audit/logs`, { params })
            .pipe(
                map((response) => {
                    return {
                        data: response.data || [],
                        pagination: response.meta || {
                            page: query.page || 1,
                            limit: query.limit || 50,
                            total: 0,
                            totalPages: 0,
                        },
                    } as PaginatedAuditResponse;
                }),
                finalize(() => this.isLoading.set(false)),
                catchError((error) => {
                    console.error('Error loading audit logs:', error);
                    return throwError(() => error);
                }),
            );
    }

    /**
     * Exportar logs de auditoría como CSV
     */
    exportAuditLogs(query: AuditQueryDto = {}): void {
        let params = new HttpParams();
        if (query.action) params = params.set('action', query.action);
        if (query.resource) params = params.set('resource', query.resource);
        if (query.from_date) params = params.set('from_date', query.from_date);
        if (query.to_date) params = params.set('to_date', query.to_date);
        params = params.set('format', 'csv');

        const url = `${this.apiUrl}/organization/audit/export?${params.toString()}`;
        window.open(url, '_blank');
    }

    /**
     * Obtener estadísticas de auditoría
     */
    getAuditStats(fromDate?: string, toDate?: string): Observable<AuditStats> {
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

    invalidateCache(): void {
        orgAuditStatsCache = null;
    }
}
