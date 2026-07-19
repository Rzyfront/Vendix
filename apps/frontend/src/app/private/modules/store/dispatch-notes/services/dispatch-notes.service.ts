import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  DispatchNote,
  DispatchNoteQuery,
  PaginatedDispatchNotesResponse,
  DispatchNoteStats,
  CreateDispatchNoteDto,
  CreateDispatchFromOrderDto,
  CreateDispatchFromOrderItemDto,
  CreateDispatchFromOrderRouteAssignmentDto,
  ConfirmDispatchNoteDto,
  CreateTransferDispatchDto,
  CreateReturnDispatchDto,
  CreatePurchaseReceiptDispatchDto,
  ReceiptScanResult,
} from '../interfaces/dispatch-note.interface';

// ============================================================================
// Batch create-from-orders (Modo B del switch A/B — Plan Despacho Economía,
// FASE 7 paso 23). Declarados inline aquí (y NO en
// `../interfaces/dispatch-note.interface.ts`) porque ese archivo del dominio
// está fuera del scope editable de este agente. Mirror del backend
// `CreateFromOrdersBatchDto` y del retorno de
// `DispatchNotesService.createFromOrdersBatch`.
// TODO: si en el futuro se consolida, mover estos tipos al archivo de
// interfaces del dominio junto al resto de DTOs de remisión.
// ============================================================================

/**
 * Body para `POST /store/dispatch-notes/from-orders`. Mirror del backend
 * `CreateFromOrdersBatchDto`.
 *
 * Para el Modo B se invoca con `orders` + `target_status: 'draft'` +
 * `batch_key` (idempotencia) y SIN `items_by_order` (quick-accept: se
 * despacha todo lo pendiente por orden).
 */
export interface CreateFromOrdersBatchDto {
  /** 1..100 order ids. El backend rechaza vacío (DSP_BATCH_EMPTY_001) o >100 (DSP_BATCH_TOO_LARGE_001). */
  orders: number[];
  /**
   * Ítems a despachar por orden (opcional). Si una orden no aparece aquí, el
   * backend asume quick-accept (todas las líneas pendientes).
   */
  items_by_order?: Record<number, CreateDispatchFromOrderItemDto[]>;
  /** Idempotencia: si el `batch_key` ya se aplicó, el backend devuelve todo `skipped`. */
  batch_key?: string;
  /** `true` = transacción todo-o-nada; `false`/omitido = resultado parcial por orden. */
  atomic?: boolean;
  /** Estado destino de las remisiones creadas. Backend default `confirmed`. */
  target_status?: 'draft' | 'confirmed';
  route_assignment?: CreateDispatchFromOrderRouteAssignmentDto;
}

/** Un resultado por orden dentro del batch. */
export type CreateFromOrdersBatchResultItem =
  | {
      status: 'created';
      order_id: number;
      dispatch_note_id: number;
      dispatch_number: string;
    }
  | {
      status: 'failed';
      order_id: number;
      error_code: string;
      message: string;
    }
  | {
      status: 'skipped';
      order_id: number;
      reason: string;
    };

/**
 * Response de `POST /store/dispatch-notes/from-orders`. Mirror del retorno del
 * backend `DispatchNotesService.createFromOrdersBatch`. `partial` es `true`
 * cuando al menos una orden falló (modo no-atómico).
 */
export interface CreateFromOrdersBatchResult {
  results: CreateFromOrdersBatchResultItem[];
  route_id?: number | null;
  partial: boolean;
}

let dispatchNoteStatsCache: { observable: Observable<any>; lastFetch: number } | null = null;

@Injectable({
  providedIn: 'root',
})
export class DispatchNotesService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000;

  constructor(private http: HttpClient) {}

  getDispatchNotes(query: DispatchNoteQuery = {}): Observable<PaginatedDispatchNotesResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });
    const url = `${this.apiUrl}/store/dispatch-notes?${params.toString()}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fetching dispatch notes:', error);
        // Re-lanza crudo (preserva error_code/status); el componente traduce.
        return throwError(() => error);
      }),
    );
  }

  getStats(): Observable<DispatchNoteStats> {
    const now = Date.now();
    if (dispatchNoteStatsCache && now - dispatchNoteStatsCache.lastFetch < this.CACHE_TTL) {
      return dispatchNoteStatsCache.observable;
    }
    const url = `${this.apiUrl}/store/dispatch-notes/stats`;
    const observable$ = this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        if (dispatchNoteStatsCache) dispatchNoteStatsCache.lastFetch = Date.now();
      }),
      catchError((error) => {
        console.error('Error fetching dispatch note stats:', error);
        // Re-lanza crudo (preserva error_code/status); el componente traduce.
        return throwError(() => error);
      }),
    );
    dispatchNoteStatsCache = { observable: observable$, lastFetch: now };
    return observable$;
  }

  getDispatchNote(id: number): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/${id}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  create(dto: CreateDispatchNoteDto): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  createFromSalesOrder(sales_order_id: number, dto: any): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/from-sales-order/${sales_order_id}`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  update(id: number, dto: Partial<CreateDispatchNoteDto>): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/${id}`;
    return this.http.patch<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  remove(id: number): Observable<void> {
    const url = `${this.apiUrl}/store/dispatch-notes/${id}`;
    return this.http.delete<void>(url).pipe(
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Confirm a dispatch note. Pass `body.item_serials` when the note has
   * serialized lines (QUI-431); otherwise the body defaults to `{}` and the
   * backend confirms normally. The backend validates serial parity per
   * serialized line and raises `SERIAL_REQUIRED_001` if any line is short.
   */
  confirm(id: number, body?: ConfirmDispatchNoteDto): Observable<DispatchNote> {
    return this.http
      .post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/confirm`, body ?? {})
      .pipe(
        map((r) => r.data || r),
        tap(() => this.invalidateCache()),
        // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
      );
  }

  deliver(id: number, dto?: any): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/deliver`, dto || {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  void(id: number, dto: { void_reason: string }): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/void`, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  invoice(id: number): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/invoice`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  getBySalesOrder(sales_order_id: number): Observable<DispatchNote[]> {
    const url = `${this.apiUrl}/store/dispatch-notes/by-sales-order/${sales_order_id}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  createFromOrder(order_id: number, dto: CreateDispatchFromOrderDto): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/from-order/${order_id}`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el `HttpErrorResponse` crudo (NO lo aplastamos a `new Error(msg)`):
      // ambos consumidores del wizard (dispatch-note-wizard + generate-dispatch-wizard)
      // discriminan por `err.error.error_code` (p.ej. DISPATCH_NOTE_NO_SHIPPING_ADDRESS)
      // para mostrar un diálogo/mensaje accionable. Aplastarlo destruía el `error_code`.
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Crea remisiones en lote desde N órdenes (Modo B del switch A/B —
   * Plan Despacho Economía, FASE 7 paso 23). `POST /store/dispatch-notes/from-orders`.
   * Devuelve un resultado por orden (`created` / `failed` / `skipped`) y
   * `partial: true` si al menos una orden falló (modo no-atómico).
   * Para el Modo B se llama con `target_status: 'draft'` + `batch_key`
   * (idempotencia) y SIN `items_by_order` (quick-accept de todo lo pendiente).
   */
  createFromOrdersBatch(dto: CreateFromOrdersBatchDto): Observable<CreateFromOrdersBatchResult> {
    const url = `${this.apiUrl}/store/dispatch-notes/from-orders`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el `HttpErrorResponse` crudo (NO lo aplastamos a `new Error(msg)`)
      // para preservar error_code/status; la traducción a mensaje la hace el
      // componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  getByOrder(order_id: number): Observable<DispatchNote[]> {
    const url = `${this.apiUrl}/store/dispatch-notes/by-order/${order_id}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  // ==========================================================================
  // Bidirectional endpoints (ref plan Remisiones Bidireccionales — R2 backend)
  // ==========================================================================

  /**
   * Create a transfer dispatch note (outbound `transfer_out` or inbound
   * `transfer_in`). `direction` + `subtype` determine which location is
   * origin vs destination. Cross-store scope validation is backend-enforced.
   */
  createTransfer(dto: CreateTransferDispatchDto): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/transfer`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Create a customer return dispatch note (inbound). Links to the
   * original dispatch via `related_dispatch_id`; the backend delegates
   * financial processing to `ReturnOrdersService`.
   */
  createReturn(dto: CreateReturnDispatchDto): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/return`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Create a purchase receipt dispatch note (inbound). When
   * `purchase_order_id` is present the backend delegates to
   * `PurchaseOrdersService.receive`; otherwise it emits its own `stock_in`.
   */
  createPurchaseReceipt(dto: CreatePurchaseReceiptDispatchDto): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/purchase-receipt`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Receive an inbound dispatch note (confirmed → received). Used by
   * transfer_in / customer_return / purchase_receipt after confirmation.
   */
  receive(id: number): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/receive`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Download the dispatch-note (remision) PDF as a Blob.
   * `POST /store/dispatch-notes/:id/pdf` (the backend streams an
   * `application/pdf` buffer; we read it as a blob for download/preview).
   */
  downloadPdf(id: number): Observable<Blob> {
    return this.http
      .post(`${this.apiUrl}/store/dispatch-notes/${id}/pdf`, {}, { responseType: 'blob' })
      .pipe(
        // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
      );
  }

  /**
   * Scan a purchase receipt (image or PDF) with the backend AI/OCR pipeline
   * (R4c). Sends `file` as multipart/form-data to
   * `POST /store/dispatch-notes/receipt-scan` and returns detected supplier +
   * line items best-effort matched against the store catalog. Do NOT set a
   * `Content-Type` header manually — the browser sets the multipart boundary.
   */
  scanReceipt(file: File): Observable<ReceiptScanResult> {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${this.apiUrl}/store/dispatch-notes/receipt-scan`;
    return this.http.post<any>(url, formData).pipe(
      map((r) => r.data || r),
      // Re-lanza el HttpErrorResponse crudo para preservar error_code/status;
      // la traducción a mensaje la hace el componente vía extractApiError().
      catchError((error) => throwError(() => error)),
    );
  }

  invalidateCache(): void {
    dispatchNoteStatsCache = null;
  }
}
