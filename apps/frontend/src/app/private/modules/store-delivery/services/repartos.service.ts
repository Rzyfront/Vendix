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
  PoolMeta,
  PoolQuery,
  PoolResponse,
  PublishToPoolResult,
  ReleaseStopDto,
  RouteHistoryQuery,
  RouteHistoryResponse,
  SettleStopDto,
} from '../interfaces/repartos.interface';
import type { DispatchNote } from '../../store/dispatch-notes/interfaces/dispatch-note.interface';
import type { DispatchNoteAddressPayload } from '../../../../shared/components/dispatch-note-address-editor/dispatch-note-address-editor.service';

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
        // La envelope estándar (responseService.paginated) trae `data` (lista)
        // y `meta` (total/page/limit/totalPages) como hermanos de nivel superior.
        map((r) => ({ data: r.data, meta: r.meta }) as PoolResponse),
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

  /**
   * `POST /store/carrier/route/reorder` — reordena las paradas pending de MI
   * ruta activa (resuelta por JWT). Body `{ order: [{ stopId, sequence }] }`
   * (DTO `ReorderStopsDto`). Devuelve la ruta fresca; el store igual hace
   * `refresh()` tras el éxito, así que la forma exacta no se consume aquí.
   */
  reorderStops(
    order: Array<{ stopId: number; sequence: number }>,
  ): Observable<DispatchRoute> {
    return this.http
      .post<any>(`${this.apiUrl}/store/carrier/route/reorder`, { order })
      .pipe(
        map((r) => r.data as DispatchRoute),
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

  // ── Detalle de parada + editar dirección (Items 4+5) ──────────────────────

  /**
   * `GET /store/carrier/route/stops/:stopId` — remisión COMPLETA de una parada
   * de MI ruta (cliente, NIT, dirección, total, fecha de entrega, ítems +
   * producto). Mismo shape que el admin `GET /store/dispatch-notes/:id`, para
   * alimentar `[note]` del `StopDetailModalComponent` sin un contrato nuevo. El
   * backend valida pertenencia por JWT (`assertStopBelongsToRoute`); 403 si la
   * parada no es de mi ruta activa.
   */
  getStopDetail(stopId: number): Observable<DispatchNote> {
    return this.http
      .get<any>(`${this.apiUrl}/store/carrier/route/stops/${stopId}`)
      .pipe(
        map((r) => r.data as DispatchNote),
        catchError((e) => this.handleError(e)),
      );
  }

  /**
   * `PATCH /store/carrier/route/stops/:stopId/address` — re-snapshotea la
   * `customer_address` de la remisión de una parada de MI ruta. Delega en el
   * mismo `updateCustomerAddressSnapshot` del admin (solo display + mapa, NO
   * toca inventario ni contabilidad). Consumido por el editor de dirección
   * compartido en modo carrier (`[saveFn]`).
   */
  updateStopAddress(
    stopId: number,
    payload: DispatchNoteAddressPayload,
  ): Observable<unknown> {
    return this.http
      .patch<any>(
        `${this.apiUrl}/store/carrier/route/stops/${stopId}/address`,
        payload,
      )
      .pipe(
        map((r) => r.data),
        catchError((e) => this.handleError(e)),
      );
  }

  // ── Historial de rutas (Item 3b) ──────────────────────────────────────────

  /**
   * `GET /store/carrier/routes` — historial paginado de MIS planillas
   * (`driver_user_id = ctx.user_id`, TODOS los estados incl. closed/voided),
   * orden `created_at desc`. Nunca acepta un `driver_user_id` de query — el
   * scope sale SIEMPRE del JWT.
   */
  getRouteHistory(query: RouteHistoryQuery = {}): Observable<RouteHistoryResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, String(v));
      }
    });
    const qs = params.toString();
    return this.http
      .get<any>(`${this.apiUrl}/store/carrier/routes${qs ? `?${qs}` : ''}`)
      .pipe(
        map(
          (r) =>
            ({ data: r.data, meta: r.meta as PoolMeta }) as RouteHistoryResponse,
        ),
        catchError((e) => this.handleError(e)),
      );
  }

  /**
   * `GET /store/carrier/routes/:id` — detalle de UNA de mis planillas del
   * historial (con paradas + remisión + vehículo), validando pertenencia por
   * JWT. 404 si la planilla no es del conductor autenticado.
   */
  getRouteById(routeId: number): Observable<DispatchRoute> {
    return this.http
      .get<any>(`${this.apiUrl}/store/carrier/routes/${routeId}`)
      .pipe(
        map((r) => r.data as DispatchRoute),
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
