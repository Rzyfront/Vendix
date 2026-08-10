import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
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
    let message = 'Error al procesar la solicitud';
    const apiMessage = error?.error?.message;
    if (apiMessage) {
      message =
        typeof apiMessage === 'string'
          ? apiMessage
          : Array.isArray(apiMessage)
            ? apiMessage.join(', ')
            : message;
    } else if (error?.status === 401) {
      message = 'No autorizado';
    } else if (error?.status === 403) {
      message = 'No tienes permisos suficientes';
    } else if (error?.status === 404) {
      message = 'Ticket de cocina no encontrado';
    } else if (error?.status === 409) {
      message =
        typeof error?.error?.message === 'string'
          ? error.error.message
          : 'Conflicto: el ticket ya cambió de estado';
    } else if (typeof error?.status === 'number' && error.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return message;
  }

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('KitchenTicketsService Error:', error);
    return throwError(() => this.deriveErrorMessage(error));
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
    };
    return throwError(() => mutationError);
  };
}
