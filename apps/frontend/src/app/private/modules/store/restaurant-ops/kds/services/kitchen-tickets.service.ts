import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  parseApiError,
  withApiErrorReference,
} from '../../../../../../../app/core/utils/parse-api-error';
import { DEFAULT_ERROR_MESSAGE } from '../../../../../../../app/core/utils/error-messages';
import {
  KitchenTicket,
  KitchenTicketStatus,
  KdsSnapshotResponse,
  FirePreview,
} from '../interfaces';

/** Result of `POST /store/kitchen-fire` (fire-to-kitchen). */
export interface FireOrderItemsResult {
  kitchen_ticket_id: number;
  cogs_total: number;
  order_id: number;
  ticket?: KitchenTicket;
}

/**
 * Structured error thrown by ticket mutations. Unlike the snapshot/fire
 * paths (which throw a plain string), mutations preserve the backend
 * `error_code` so the board can branch on specific cases — e.g.
 * `KITCHEN_TICKET_NO_RECIPE` → "ir a recetas" dialog — instead of showing a
 * generic toast.
 */
export interface KitchenMutationError {
  code: string | null;
  message: string;
  details?: any;
  /**
   * CP-POLLO-ARABE-727 F.1 — A.8 parcial. Se propaga SIN hornear en
   * `message`: `kds-board-page`/`table-session-page` ya leen este campo con
   * `readApiErrorRequestId(err)` y lo añaden ellos mismos con
   * `withApiErrorReference` al armar el toast (mismo patrón que usan para el
   * `error_code` estructurado). Hornearlo aquí también duplicaría la
   * referencia en ese camino.
   */
  request_id?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

/**
 * Store-scoped HTTP service for the Kitchen Display System (Restaurant
 * Suite — Phase F). Wraps every mutation that the KDS board needs
 * (start/ready/delivered/cancel) plus the REST snapshot endpoint used
 * to warm up before the SSE stream attaches.
 *
 * The SSE stream itself is owned by `KdsSseService` — this class
 * intentionally does NOT open EventSource (single responsibility).
 */
@Injectable({ providedIn: 'root' })
export class KitchenTicketsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/kitchen-fire';
  private http = inject(HttpClient);

  // ─── Snapshot ────────────────────────────────────────────────────────

  getSnapshot(
    windowMinutes: number = 120,
  ): Observable<KdsSnapshotResponse> {
    let params = new HttpParams();
    params = params.set('windowMinutes', String(windowMinutes));

    return this.http
      .get<ApiResponse<KdsSnapshotResponse>>(
        `${this.apiUrl}${this.basePath}/snapshot`,
        { params },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Ticket mutations ────────────────────────────────────────────────

  start(ticketId: number): Observable<KitchenTicket> {
    return this.mutateTicket(ticketId, 'start');
  }

  markReady(ticketId: number): Observable<KitchenTicket> {
    return this.mutateTicket(ticketId, 'ready');
  }

  markDelivered(ticketId: number): Observable<KitchenTicket> {
    return this.mutateTicket(ticketId, 'delivered');
  }

  cancel(ticketId: number): Observable<KitchenTicket> {
    return this.mutateTicket(ticketId, 'cancel');
  }

  /**
   * Revierte el ticket al estado inmediatamente anterior
   * (in_preparation → pending, ready → in_preparation,
   * delivered → ready, cancelled → ready). El backend resuelve el
   * estado destino y devuelve el ticket actualizado; el board lo
   * reconcilia vía el evento SSE `ticket.reverted`.
   */
  revert(ticketId: number): Observable<KitchenTicket> {
    return this.mutateTicket(ticketId, 'revert');
  }

  /**
   * Fire a batch of order items to the kitchen (creates a
   * `kitchen_ticket` and triggers the inventory + COGS seam in
   * Phase D). Returns the new ticket summary.
   */
  /**
   * Previsualiza el envío: devuelve el árbol de receta de cada item elegible para
   * que el modal de confirmación pueda desmarcar ingredientes. QUI-655.
   *
   * NO consume nada. Comparte el seam de explosión con el envío real, así que lo
   * que el modal muestra y lo que se consume no pueden discrepar.
   */
  /**
   * Verificacion del ticket antes de cocinar — QUI-655.
   *
   * Parte del TICKET y no de la elegibilidad para enviar, que es lo que dejaba al
   * modal vacio: `/preview` descarta items ya consumidos, y al verificar el item ya
   * paso por el fire.
   *
   * Devuelve el MISMO contrato que el preview mas `excluded_component_ids`, para
   * que el modal se reutilice sin bifurcar.
   */
  getTicketVerification(ticketId: number): Observable<FirePreview & {
    items: Array<FirePreview['items'][number] & { excluded_component_ids: number[] }>;
  }> {
    return this.http
      .get<ApiResponse<any>>(
        `${this.apiUrl}${this.basePath}/tickets/${ticketId}/verification`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  previewFire(payload: {
    order_id: number;
    order_item_ids: number[];
  }): Observable<FirePreview> {
    return this.http
      .post<ApiResponse<FirePreview>>(
        `${this.apiUrl}${this.basePath}/preview`,
        payload,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  fireOrderItems(payload: {
    order_id: number;
    order_item_ids: number[];
    notes?: string;
    /**
     * QUI-655 — exclusiones confirmadas en el modal, por item. Ausente equivale a
     * "todos los componentes marcados": el backend tiene ese default y no hay que
     * mandar recetas completas en el camino rápido.
     */
    exclusions?: Array<{
      order_item_id: number;
      component_product_ids: number[];
    }>;
  }): Observable<FireOrderItemsResult> {
    return this.http
      .post<ApiResponse<FireOrderItemsResult>>(
        `${this.apiUrl}${this.basePath}`,
        payload,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  private mutateTicket(
    ticketId: number,
    action: 'start' | 'ready' | 'delivered' | 'cancel' | 'revert',
  ): Observable<KitchenTicket> {
    return this.http
      .post<ApiResponse<KitchenTicket>>(
        `${this.apiUrl}${this.basePath}/tickets/${ticketId}/${action}`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleMutationError),
      );
  }

  // ─── Status label helper (Spanish) ───────────────────────────────────

  static statusLabel(status: KitchenTicketStatus): string {
    switch (status) {
      case 'pending':
        return 'Pendiente';
      case 'in_preparation':
        return 'En preparación';
      case 'ready':
        return 'Listo';
      case 'delivered':
        return 'Entregado';
      case 'cancelled':
        return 'Cancelado';
    }
  }

  // ─── Error mapping ───────────────────────────────────────────────────

  private deriveErrorMessage(error: any): string {
    // CP-POLLO-ARABE-727 F.1 / C.2 — migrado a `parseApiError` (aduana única
    // del repo). El orden anterior leía `error?.error?.message` ANTES de la
    // rama 403: un 403 del guard (`AUTH_PERM_001`, devMessage 'Access denied',
    // 13 chars < MIN_PRESENTABLE_LENGTH) pasaba tal cual al toast del cocinero
    // en inglés. parseApiError lo descarta y cae a
    // `ERROR_MESSAGES[AUTH_PERM_001]`. La red por status de abajo solo actúa
    // cuando parseApiError cayó al DEFAULT (para no degradar 404/409/5xx).
    const parsed = parseApiError(error);
    if (parsed.userMessage !== DEFAULT_ERROR_MESSAGE) {
      return parsed.userMessage;
    }
    switch (error?.status) {
      case 401:
        return 'No autorizado';
      case 403:
        return 'No tienes permisos suficientes';
      case 404:
        return 'Ticket de cocina no encontrado';
      case 409:
        return 'Conflicto: el ticket ya cambió de estado';
      default:
        return typeof error?.status === 'number' && error.status >= 500
          ? 'Error del servidor. Inténtalo más tarde'
          : DEFAULT_ERROR_MESSAGE;
    }
  }

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('KitchenTicketsService Error:', error);
    // CP-POLLO-ARABE-727 F.1 — A.8 parcial. Este camino normaliza el error a
    // un string plano (snapshot/preview/fire), así que — igual que
    // `TablesService.handleError` — la referencia de soporte se hornea aquí:
    // no sobrevive ningún objeto crudo hasta el componente donde
    // `readApiErrorRequestId` pudiera leerla después.
    const message = this.deriveErrorMessage(error);
    return throwError(() =>
      withApiErrorReference(message, parseApiError(error).request_id),
    );
  };

  /**
   * Error handler for ticket mutations. Preserves the backend `error_code`
   * + `details` (e.g. `KITCHEN_TICKET_NO_RECIPE`) so the KDS board can branch
   * to an actionable dialog instead of a generic toast. The snapshot/fire
   * paths keep `handleError` (string) so their existing consumers' contract
   * is unchanged.
   */
  private handleMutationError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('KitchenTicketsService Error:', error);
    const mutationError: KitchenMutationError = {
      code: error?.error?.error_code ?? error?.error?.code ?? null,
      message: this.deriveErrorMessage(error),
      details: error?.error?.details ?? null,
      // CP-POLLO-ARABE-727 F.1 — A.8 parcial. Campo crudo, sin hornear en
      // `message`: `onMutationError` (kds-board-page) y
      // `onKitchenMutationError` (table-session-page) lo leen con
      // `readApiErrorRequestId(err)` y arman la referencia ellos mismos.
      request_id: parseApiError(error).request_id,
    };
    return throwError(() => mutationError);
  };
}
