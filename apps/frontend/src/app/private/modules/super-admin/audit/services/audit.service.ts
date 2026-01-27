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
import { environment } from '../../../../../../environments/environment';
import {
  AuditLog,
  AuditStats,
  AuditQueryDto,
  AuditLogsResponse,
} from '../interfaces/audit.interface';

@Injectable({
  providedIn: 'root',
})
export class AuditService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  // Loading states
  private readonly isLoading$$ = new BehaviorSubject<boolean>(false);
  private readonly isLoadingStats$$ = new BehaviorSubject<boolean>(false);

  // Exposed observables
  public readonly isLoading$ = this.isLoading$$.asObservable();
  public readonly isLoadingStats$ = this.isLoadingStats$$.asObservable();

  /**
   * Obtener logs de auditoría con paginación y filtros
   */
  getAuditLogs(query: AuditQueryDto = {}): Observable<AuditLogsResponse> {
    this.isLoading$$.next(true);

    let params = new HttpParams();
    if (query.userId) params = params.set('userId', query.userId);
    if (query.storeId) params = params.set('storeId', query.storeId);
    if (query.organizationId)
      params = params.set('organizationId', query.organizationId);
    if (query.action) params = params.set('action', query.action);
    if (query.resource) params = params.set('resource', query.resource);
    if (query.resourceId) params = params.set('resourceId', query.resourceId);
    if (query.fromDate) params = params.set('fromDate', query.fromDate);
    if (query.toDate) params = params.set('toDate', query.toDate);
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.offset) params = params.set('offset', query.offset.toString());

    return this.http
      .get<any>(`${this.apiUrl}/superadmin/admin/audit/logs`, { params })
      .pipe(
        map((response) => {
          // Mapear la respuesta de la API a la estructura esperada por el frontend
          return {
            logs: response.data || [],
            total: response.meta?.total || 0,
            limit: response.meta?.limit || 20,
            offset: response.meta?.offset || 0,
          } as AuditLogsResponse;
        }),
        finalize(() => this.isLoading$$.next(false)),
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
    this.isLoadingStats$$.next(true);

    let params = new HttpParams();
    if (fromDate) params = params.set('fromDate', fromDate);
    if (toDate) params = params.set('toDate', toDate);

    return this.http
      .get<any>(`${this.apiUrl}/superadmin/admin/audit/dashboard`, { params })
      .pipe(
        map((response) => {
          return response.data as AuditStats;
        }),
        finalize(() => this.isLoadingStats$$.next(false)),
        catchError((error) => {
          console.error('Error loading audit stats:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener log de auditoría por ID
   */
  getAuditLogById(id: string): Observable<AuditLog> {
    return this.http
      .get<AuditLog>(`${this.apiUrl}/superadmin/admin/audit/logs/${id}`)
      .pipe(
        catchError((error) => {
          console.error('Error getting audit log:', error);
          return throwError(() => error);
        }),
      );
  }
}
