import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  AccessLogQuery,
  AccessValidationResult,
  CreateCredentialDto,
  CreateCredentialResponse,
  CredentialQuery,
  GymAccessCredential,
  GymAccessLog,
  Occupancy,
  UpdateCredentialDto,
  ValidateAccessDto,
} from '../interfaces';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: unknown;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}

/**
 * Store-scoped service for membership access control (Membership Suite — Ola 1).
 *
 * Mirrors `apps/backend/src/domains/store/memberships/access` (`/store/memberships/access`):
 * credentials CRUD, access logs listing, and the reception validate endpoint.
 */
@Injectable({ providedIn: 'root' })
export class MembershipAccessService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/memberships/access';
  private readonly http = inject(HttpClient);

  // ─── Logs ──────────────────────────────────────────────────────────────
  listLogs(
    query: AccessLogQuery = {},
  ): Observable<PaginatedApiResponse<GymAccessLog>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.customer_id != null) {
      params = params.set('customer_id', String(query.customer_id));
    }
    if (query.result) params = params.set('result', query.result);
    if (query.date_from) params = params.set('date_from', query.date_from);
    if (query.date_to) params = params.set('date_to', query.date_to);

    return this.http
      .get<PaginatedApiResponse<GymAccessLog>>(
        `${this.apiUrl}${this.basePath}/logs`,
        { params },
      )
      .pipe(catchError(this.handleError));
  }

  // ─── Credentials ───────────────────────────────────────────────────────
  listCredentials(
    query: CredentialQuery = {},
  ): Observable<PaginatedApiResponse<GymAccessCredential>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.customer_id != null) {
      params = params.set('customer_id', String(query.customer_id));
    }
    if (query.is_active != null) {
      params = params.set('is_active', String(query.is_active));
    }

    return this.http
      .get<PaginatedApiResponse<GymAccessCredential>>(
        `${this.apiUrl}${this.basePath}/credentials`,
        { params },
      )
      .pipe(catchError(this.handleError));
  }

  createCredential(
    dto: CreateCredentialDto,
  ): Observable<CreateCredentialResponse> {
    return this.http
      .post<ApiResponse<CreateCredentialResponse>>(
        `${this.apiUrl}${this.basePath}/credentials`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  updateCredential(
    id: number,
    dto: UpdateCredentialDto,
  ): Observable<GymAccessCredential> {
    return this.http
      .patch<ApiResponse<GymAccessCredential>>(
        `${this.apiUrl}${this.basePath}/credentials/${id}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  deactivateCredential(id: number): Observable<{ deactivated: boolean }> {
    return this.http
      .delete<ApiResponse<{ deactivated: boolean }>>(
        `${this.apiUrl}${this.basePath}/credentials/${id}`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * Archive a credential (soft-delete). Unlike `deactivateCredential` — which
   * only flips `is_active` — this removes it from the listing entirely. The
   * member can no longer use it to enter.
   */
  archiveCredential(id: number): Observable<{ archived: boolean; id: number }> {
    return this.http
      .post<ApiResponse<{ archived: boolean; id: number }>>(
        `${this.apiUrl}${this.basePath}/credentials/${id}/archive`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Validate (reception) ────────────────────────────────────────────────
  validate(dto: ValidateAccessDto): Observable<AccessValidationResult> {
    return this.http
      .post<ApiResponse<AccessValidationResult>>(
        `${this.apiUrl}${this.basePath}/validate`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Occupancy (aforo) ─────────────────────────────────────────────────────
  getOccupancy(): Observable<Occupancy> {
    return this.http
      .get<ApiResponse<Occupancy>>(
        `${this.apiUrl}${this.basePath}/occupancy`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  registerExit(
    body: { credential_value?: string; device_id?: string } = {},
  ): Observable<Occupancy> {
    return this.http
      .post<ApiResponse<Occupancy>>(
        `${this.apiUrl}${this.basePath}/exit`,
        body,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  adjustOccupancy(delta: number): Observable<Occupancy> {
    return this.http
      .patch<ApiResponse<Occupancy>>(
        `${this.apiUrl}${this.basePath}/occupancy/adjust`,
        { delta },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  private handleError = (error: unknown): Observable<never> => {
    const err = error as {
      status?: number;
      error?: { message?: string | string[] };
    };
    let message = 'Error al procesar la solicitud';
    const apiMessage = err?.error?.message;
    if (apiMessage) {
      message =
        typeof apiMessage === 'string'
          ? apiMessage
          : Array.isArray(apiMessage)
            ? apiMessage.join(', ')
            : message;
    } else if (err?.status === 401) {
      message = 'No autorizado';
    } else if (err?.status === 403) {
      message = 'No tienes permisos suficientes';
    } else if (err?.status === 404) {
      message = 'Credencial no encontrada';
    } else if (err?.status === 409) {
      message = 'Ya existe una credencial con ese valor y tipo';
    } else if (typeof err?.status === 'number' && err.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  };
}
