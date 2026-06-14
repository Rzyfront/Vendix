import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  KitchenTicket,
  KitchenTicketStatus,
  KdsSnapshotResponse,
} from '../interfaces';

/** Result of `POST /store/kitchen-fire` (fire-to-kitchen). */
export interface FireOrderItemsResult {
  kitchen_ticket_id: number;
  cogs_total: number;
  order_id: number;
  ticket?: KitchenTicket;
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
   * Fire a batch of order items to the kitchen (creates a
   * `kitchen_ticket` and triggers the inventory + COGS seam in
   * Phase D). Returns the new ticket summary.
   */
  fireOrderItems(payload: {
    order_id: number;
    order_item_ids: number[];
    notes?: string;
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
    action: 'start' | 'ready' | 'delivered' | 'cancel',
  ): Observable<KitchenTicket> {
    return this.http
      .post<ApiResponse<KitchenTicket>>(
        `${this.apiUrl}${this.basePath}/tickets/${ticketId}/${action}`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
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

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('KitchenTicketsService Error:', error);
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
    return throwError(() => message);
  };
}
