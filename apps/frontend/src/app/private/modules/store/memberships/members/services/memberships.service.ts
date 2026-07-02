import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  CreateGymMembershipDto,
  GymMembership,
  GymMembershipQuery,
  RenewMembershipDto,
  RenewMembershipResult,
  UpdateGymMembershipDto,
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
 * Store-scoped service for memberships (Membership Suite).
 *
 * Mirrors the backend memberships controller (`/store/memberships`).
 * List/detail rows carry `plan` and `customer` snapshots attached server-side.
 */
@Injectable({ providedIn: 'root' })
export class MembershipsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/memberships';
  private readonly http = inject(HttpClient);

  listPaginated(
    query: GymMembershipQuery = {},
  ): Observable<PaginatedApiResponse<GymMembership>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.status) params = params.set('status', query.status);
    if (query.customer_id != null) {
      params = params.set('customer_id', String(query.customer_id));
    }
    if (query.gym_plan_id != null) {
      params = params.set('gym_plan_id', String(query.gym_plan_id));
    }

    return this.http
      .get<PaginatedApiResponse<GymMembership>>(
        `${this.apiUrl}${this.basePath}`,
        { params },
      )
      .pipe(catchError(this.handleError));
  }

  getById(id: number): Observable<GymMembership> {
    return this.http
      .get<ApiResponse<GymMembership>>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateGymMembershipDto): Observable<GymMembership> {
    return this.http
      .post<ApiResponse<GymMembership>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdateGymMembershipDto): Observable<GymMembership> {
    return this.http
      .patch<ApiResponse<GymMembership>>(
        `${this.apiUrl}${this.basePath}/${id}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  suspend(id: number): Observable<GymMembership> {
    return this.transition(id, 'suspend');
  }

  freeze(id: number): Observable<GymMembership> {
    return this.transition(id, 'freeze');
  }

  cancel(id: number): Observable<GymMembership> {
    return this.transition(id, 'cancel');
  }

  reactivate(id: number): Observable<GymMembership> {
    return this.transition(id, 'reactivate');
  }

  private transition(
    id: number,
    action: 'suspend' | 'freeze' | 'cancel' | 'reactivate',
  ): Observable<GymMembership> {
    return this.http
      .post<ApiResponse<GymMembership>>(
        `${this.apiUrl}${this.basePath}/${id}/${action}`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  renew(
    id: number,
    dto: RenewMembershipDto,
  ): Observable<RenewMembershipResult> {
    return this.http
      .post<ApiResponse<RenewMembershipResult>>(
        `${this.apiUrl}${this.basePath}/${id}/renew`,
        dto,
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
      message = 'Membresía no encontrada';
    } else if (err?.status === 409) {
      message =
        typeof err?.error?.message === 'string'
          ? err.error.message
          : 'Transición no permitida para el estado actual';
    } else if (typeof err?.status === 'number' && err.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  };
}
