import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  GymPlan,
  CreateGymPlanDto,
  UpdateGymPlanDto,
  GymPlanQuery,
  RemoveGymPlanResult,
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
 * Store-scoped service for the Gym Plans domain (Gym Suite — Ola 1).
 *
 * Mirrors the backend controller in
 * `apps/backend/src/domains/store/gym-plans` (`/store/gym/plans`). The backend
 * returns the standard `ResponseService` envelope: `{ success, data, meta }`
 * with a FLAT pagination meta (`meta.total`, `meta.page`, ...).
 */
@Injectable({ providedIn: 'root' })
export class GymPlansService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/gym/plans';
  private readonly http = inject(HttpClient);

  listPaginated(query: GymPlanQuery = {}): Observable<PaginatedApiResponse<GymPlan>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.is_active != null) {
      params = params.set('is_active', String(query.is_active));
    }

    return this.http
      .get<PaginatedApiResponse<GymPlan>>(`${this.apiUrl}${this.basePath}`, {
        params,
      })
      .pipe(catchError(this.handleError));
  }

  getById(id: number): Observable<GymPlan> {
    return this.http
      .get<ApiResponse<GymPlan>>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateGymPlanDto): Observable<GymPlan> {
    return this.http
      .post<ApiResponse<GymPlan>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdateGymPlanDto): Observable<GymPlan> {
    return this.http
      .patch<ApiResponse<GymPlan>>(`${this.apiUrl}${this.basePath}/${id}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  remove(id: number): Observable<RemoveGymPlanResult> {
    return this.http
      .delete<ApiResponse<RemoveGymPlanResult>>(
        `${this.apiUrl}${this.basePath}/${id}`,
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
      message = 'Plan no encontrado';
    } else if (err?.status === 409) {
      message = 'Ya existe un plan con ese código en esta tienda';
    } else if (typeof err?.status === 'number' && err.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  };
}
