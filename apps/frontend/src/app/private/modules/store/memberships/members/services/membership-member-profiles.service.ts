import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { GymMemberProfile, UpsertMemberProfileDto } from '../interfaces';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Store-scoped service for member profiles (Membership Suite).
 *
 * Mirrors the backend member-profiles controller
 * (`/store/memberships/member-profiles`). One profile per (store, customer).
 * The profile is keyed by `customerId`, not by its own id. `getByCustomer` may
 * resolve to `null` when no profile exists yet.
 */
@Injectable({ providedIn: 'root' })
export class MembershipMemberProfilesService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/memberships/member-profiles';
  private readonly http = inject(HttpClient);

  getByCustomer(customerId: number): Observable<GymMemberProfile | null> {
    return this.http
      .get<ApiResponse<GymMemberProfile | null>>(
        `${this.apiUrl}${this.basePath}/${customerId}`,
      )
      .pipe(
        map((res) => res.data ?? null),
        catchError(this.handleError),
      );
  }

  upsert(
    customerId: number,
    dto: UpsertMemberProfileDto,
  ): Observable<GymMemberProfile> {
    return this.http
      .put<ApiResponse<GymMemberProfile>>(
        `${this.apiUrl}${this.basePath}/${customerId}`,
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
    } else if (err?.status === 403) {
      message = 'No tienes permisos suficientes';
    } else if (typeof err?.status === 'number' && err.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  };
}
