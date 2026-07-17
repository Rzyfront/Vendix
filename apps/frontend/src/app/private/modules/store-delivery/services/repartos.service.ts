import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import type {
  CarrierActiveRouteResponse,
  CarrierClaimResult,
  CarrierCloseRouteResult,
  CloseDispatchRouteDto,
  DispatchRoute,
  DispatchRouteStop,
  PoolQuery,
  PoolResponse,
  PublishToPoolResult,
  ReleaseStopDto,
  SettleStopDto,
} from '../interfaces/repartos.interface';

/**
 * Error normalizado del namespace carrier. Conserva `errorCode` (p. ej.
 * `CARRIER_CLAIM_TAKEN`, `CARRIER_NO_ACTIVE_ROUTE`) para que las páginas
 * F3-F6 puedan ramificar por código, y `userMessage` listo para el toast.
 */
export interface RepartosApiError extends Error {
  errorCode: string | null;
  original: unknown;
}

/**
 * Cliente HTTP del namespace Carrier (Vendix Repartos, app_type STORE_DELIVERY).
 *
 * Fuente de verdad: `scratchpad/carrier-api-contract.md`. Todas las respuestas
 * usan el wrapper `ResponseService` → `{ success, data, ... }`, por eso cada
 * lectura hace `map(r => r.data)`. El backend resuelve "mi ruta" desde el JWT
 * (`driver_user_id = ctx.user_id`), SIN route-id en la URL.
 */
@Injectable({ providedIn: 'root' })
export class RepartosService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);

  // ── Pool ────────────────────────────────────────────────────────────────

  /** `GET /store/carrier/pool` — órdenes esperando carrier (paginado). */
  getPool(query: PoolQuery = {}): Observable<PoolResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, String(v));
      }
    });
    const qs = params.toString();
    return this.http
      .get<any>(`${this.apiUrl}/store/carrier/pool${qs ? `?${qs}` : ''}`)
      .pipe(
        map((r) => r.data as PoolResponse),
        catchError((e) => this.handleError(e)),
      );
  }

  /**
   * `POST /store/carrier/pool/:orderId/claim` — toma atómica (primero-gana).
   * 409 `CARRIER_CLAIM_TAKEN` si otra persona ya tomó la orden.
   */
  takeToMyRoute(orderId: number): Observable<CarrierClaimResult> {
    return this.http
      .post<any>(`${this.apiUrl}/store/carrier/pool/${orderId}/claim`, {})
      .pipe(
        map((r) => r.data as CarrierClaimResult),
        catchError((e) => this.handleError(e)),
      );
  }

  // ── Mi ruta activa ────────────────────────────────────────────────────────

  /**
   * `GET /store/carrier/route` — ruta activa (draft/dispatched/in_transit) del
   * carrier + paradas + payout estimado. `route` es `null` si no hay ruta.
   */
  getMyActiveRoute(): Observable<CarrierActiveRouteResponse> {
    return this.http
      .get<any>(`${this.apiUrl}/store/carrier/route`)
      .pipe(
        map((r) => r.data as CarrierActiveRouteResponse),
        catchError((e) => this.handleError(e)),
      );
  }

  /**
   * `POST /store/carrier/route/dispatch` — inicia el recorrido (status →
   * dispatched). 404 `CARRIER_NO_ACTIVE_ROUTE` si no hay ruta.
   */
  dispatchRoute(): Observable<DispatchRoute> {
    return this.http
      .post<any>(`${this.apiUrl}/store/carrier/route/dispatch`, {})
      .pipe(
        map((r) => r.data as DispatchRoute),
        catchError((e) => this.handleError(e)),
      );
  }

  // ── Paradas ──────────────────────────────────────────────────────────────

  /**
   * `POST /store/carrier/route/stops/:stopId/start` — inicia una parada.
   * 403 si `stopId` no pertenece a mi ruta.
   */
  startStop(stopId: number): Observable<DispatchRouteStop> {
    return this.http
      .post<any>(`${this.apiUrl}/store/carrier/route/stops/${stopId}/start`, {})
      .pipe(
        map((r) => r.data as DispatchRouteStop),
        catchError((e) => this.handleError(e)),
      );
  }

  /**
   * `POST /store/carrier/route/stops/:stopId/settle` — liquida/entrega la
   * parada. Solo `result: 'delivered' | 'rejected'` (partial bloqueado).
   */
  settleStop(stopId: number, dto: SettleStopDto): Observable<DispatchRouteStop> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/carrier/route/stops/${stopId}/settle`,
        dto,
      )
      .pipe(
        map((r) => r.data as DispatchRouteStop),
        catchError((e) => this.handleError(e)),
      );
  }

  /**
   * `POST /store/carrier/route/stops/:stopId/release` — libera la parada (no
   * entregada); vuelve al pool y `orders.claimed_by_carrier_user_id = null`.
   */
  releaseStop(stopId: number, dto: ReleaseStopDto): Observable<DispatchRouteStop> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/carrier/route/stops/${stopId}/release`,
        dto,
      )
      .pipe(
        map((r) => r.data as DispatchRouteStop),
        catchError((e) => this.handleError(e)),
      );
  }

  // ── Cierre y cuadre ───────────────────────────────────────────────────────

  /**
   * `POST /store/carrier/route/close` — cierra y cuadra la ruta. Devuelve la
   * ruta cerrada, la varianza y el payout con `earned`.
   */
  closeRoute(dto: CloseDispatchRouteDto): Observable<CarrierCloseRouteResult> {
    return this.http
      .post<any>(`${this.apiUrl}/store/carrier/route/close`, dto)
      .pipe(
        map((r) => r.data as CarrierCloseRouteResult),
        catchError((e) => this.handleError(e)),
      );
  }

  // ── Lado admin (STORE_ADMIN order-details) ────────────────────────────────

  /**
   * `POST /store/dispatch-notes/orders/:orderId/send-to-dispatch` — envía la
   * orden al pool de reparto (idempotente). Llamado desde order-details con la
   * auth admin normal, NO desde la app carrier.
   */
  publishToPool(orderId: number): Observable<PublishToPoolResult> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-notes/orders/${orderId}/send-to-dispatch`,
        {},
      )
      .pipe(
        map((r) => r.data as PublishToPoolResult),
        catchError((e) => this.handleError(e)),
      );
  }

  /**
   * Normaliza cualquier error HTTP a `RepartosApiError`: `parseApiError` para
   * el `userMessage` y `errorCode`, conservando el error original por si el
   * consumidor necesita inspeccionar el `HttpErrorResponse` crudo.
   */
  private handleError(error: unknown): Observable<never> {
    const parsed = parseApiError(error);
    const wrapped = new Error(parsed.userMessage) as RepartosApiError;
    wrapped.errorCode = parsed.errorCode;
    wrapped.original = error;
    return throwError(() => wrapped);
  }
}
