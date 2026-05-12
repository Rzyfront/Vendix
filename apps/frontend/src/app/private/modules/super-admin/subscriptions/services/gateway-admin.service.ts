import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import {
  PlatformGatewayView,
  TestConnectionResult,
  TestGatewayDto,
  UpsertGatewayDto,
} from '../interfaces/platform-gateway.interface';

/**
 * Generic API envelope used across SuperAdmin endpoints (matches
 * `ResponseService` in the backend).
 */
interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/**
 * HTTP client for the platform-level payment gateway configuration
 * (Wompi only for now). Targets `/superadmin/subscriptions/gateway/:processor`
 * on the backend.
 *
 * The service unwraps the backend `ApiEnvelope` so callers receive plain
 * domain objects. Errors propagate as raw `HttpErrorResponse` — let the
 * component show the toast.
 */
@Injectable({ providedIn: 'root' })
export class GatewayAdminService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/superadmin/subscriptions/gateway`;

  /**
   * GET /superadmin/subscriptions/gateway/wompi
   * Returns the masked view (never the raw secrets).
   */
  getWompi(): Observable<PlatformGatewayView> {
    return this.http
      .get<ApiEnvelope<PlatformGatewayView>>(`${this.base}/wompi`)
      .pipe(map((res) => res.data));
  }

  /**
   * PATCH /superadmin/subscriptions/gateway/wompi
   * Persists credentials. Backend enforces:
   *   - production requires confirm_production=true
   *   - production+is_active requires a fresh (<=1h) successful test
   */
  saveWompi(dto: UpsertGatewayDto): Observable<PlatformGatewayView> {
    return this.http
      .patch<ApiEnvelope<PlatformGatewayView>>(`${this.base}/wompi`, dto)
      .pipe(map((res) => res.data));
  }

  /**
   * POST /superadmin/subscriptions/gateway/wompi/test
   * Probes the gateway. When `dto` is undefined/empty the backend uses
   * stored credentials (re-test). Otherwise tests the supplied set without
   * persisting.
   */
  testWompi(dto?: TestGatewayDto): Observable<TestConnectionResult> {
    return this.http
      .post<ApiEnvelope<TestConnectionResult>>(
        `${this.base}/wompi/test`,
        dto ?? {},
      )
      .pipe(map((res) => res.data));
  }
}
