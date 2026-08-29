import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../../app/core/utils/parse-api-error';
import { DEFAULT_ERROR_MESSAGE } from '../../../../../../../app/core/utils/error-messages';
import {
  Table,
  CreateTableDto,
  UpdateTableDto,
  TableQuery,
  OpenTableSessionDto,
  AddItemsToTableSessionDto,
  TableSession,
  SplitByItemsDto,
  SplitByAmountDto,
  SplitResult,
  TableStatus,
  TableSessionAddItem,
  PayTableSessionDto,
  PayTableSessionResult,
  TableQrResponse,
  PaymentPendingView,
  ConfirmTablePaymentResult,
} from '../interfaces';
import type { IconName } from '../../../../../../shared/components/icon/icons.registry';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages?: number;
    };
  };
}

/**
 * Store-scoped HTTP service for the Tables + Table Sessions + Split
 * domain (Restaurant Suite — Fase E). One service for the three
 * controllers because the flows are tightly coupled (floor map opens
 * a session, session page triggers a split).
 */
@Injectable({ providedIn: 'root' })
export class TablesService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);

  // ─── Tables ────────────────────────────────────────────────────────

  listPaginated(
    query: TableQuery = {},
  ): Observable<PaginatedApiResponse<Table>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);
    if (query.zone) params = params.set('zone', query.zone);

    return this.http
      .get<PaginatedApiResponse<Table>>(`${this.apiUrl}/store/tables`, {
        params,
      })
      .pipe(catchError(this.handleError));
  }

  getFloorMap(): Observable<Table[]> {
    return this.http
      .get<ApiResponse<Table[]>>(`${this.apiUrl}/store/tables/floor-map`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  getById(id: number): Observable<Table> {
    return this.http
      .get<ApiResponse<Table>>(`${this.apiUrl}/store/tables/${id}`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateTableDto): Observable<Table> {
    return this.http
      .post<ApiResponse<Table>>(`${this.apiUrl}/store/tables`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdateTableDto): Observable<Table> {
    return this.http
      .patch<ApiResponse<Table>>(`${this.apiUrl}/store/tables/${id}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/tables/${id}`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Libera una mesa bloqueada (QUI-535 · paso 7).
   *
   * Devuelve la mesa a `available` cerrando ANTES su cuenta abierta si la
   * arrastra. No hay endpoint nuevo: compone los dos que ya existen, en el
   * único orden válido.
   *
   *   1. `POST /store/table-sessions/:sessionId/close` — solo cuando la
   *      mesa trae `active_session`. Es idempotente en el backend
   *      (`table-sessions.service.ts:781` corta en seco si `closed_at` ya
   *      estaba puesto) y deja la mesa en `cleaning`.
   *   2. `PATCH /store/tables/:id { status: 'available' }`.
   *
   * El orden NO es negociable: `TablesService.update` del backend
   * (`tables.service.ts:429`) rechaza pasar a `available` una mesa con
   * `table_sessions.closed_at IS NULL` con `TABLE_INVALID_STATUS`. Esa
   * validación preexistente es justamente la que garantiza la regla de
   * negocio — jamás se libera una mesa dejando su cuenta abierta —, así
   * que este helper la respeta en vez de esquivarla.
   *
   * Permisos ya existentes: `store:table_sessions:update` para el cierre y
   * `store:tables:update` para el PATCH.
   */
  releaseTable(
    tableId: number,
    activeSessionId?: number | null,
  ): Observable<Table> {
    const markAvailable = () => this.update(tableId, { status: 'available' });
    if (activeSessionId == null) return markAvailable();
    return this.closeSession(activeSessionId).pipe(
      switchMap(() => markAvailable()),
    );
  }

  /**
   * Obtiene el código QR de una mesa (`GET /store/tables/:id/qr`).
   * El backend devuelve `{ public_url, qr_data_url }` donde
   * `qr_data_url` es un PNG base64 data URL listo para `<img [src]>`.
   * Requiere el permiso `store:tables:read`.
   */
  getQr(id: number): Observable<TableQrResponse> {
    return this.http
      .get<ApiResponse<TableQrResponse>>(`${this.apiUrl}/store/tables/${id}/qr`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Table sessions ────────────────────────────────────────────────

  openSession(dto: OpenTableSessionDto): Observable<TableSession> {
    return this.http
      .post<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  getSession(id: number): Observable<TableSession> {
    return this.http
      .get<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${id}`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  addItems(
    sessionId: number,
    items: TableSessionAddItem[],
  ): Observable<TableSession> {
    const dto: AddItemsToTableSessionDto = { items };
    return this.http
      .post<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/add-items`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * Removes a single order item from the session's draft order
   * (`DELETE /store/table-sessions/:id/items/:orderItemId`). Mirrors
   * `addItems`: the backend recalculates totals and returns the SAME
   * `TableSessionView` shape so the caller just replaces its local session.
   *
   * Backend gate (Frente 2): an un-fired item is deleted outright; a fired
   * item whose kitchen ticket is still `pending` cancels the ticket + returns
   * the fire-consumed stock; items in `in_preparation`/`ready`/`delivered`
   * are rejected with 409 `TABLE_SESSION_ITEM_FIRED`.
   */
  removeItem(sessionId: number, orderItemId: number): Observable<TableSession> {
    return this.http
      .delete<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/items/${orderItemId}`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * QUI-652 — marca un item de la cuenta como entregado al cliente.
   *
   * La entrega es un hecho de SERVICIO, no de cocina, así que este endpoint
   * aplica a cualquier tipo de producto. Un plato preparado sigue exigiendo
   * estado `ready` en cocina (409 `TABLE_SESSION_ITEM_NOT_DELIVERABLE`); una
   * cerveza en botella se entrega directo, porque nunca pasa por cocina y por
   * eso nunca tuvo un estado de entrega alcanzable.
   *
   * Idempotente: re-marcar devuelve la sesión sin mover la fecha de entrega.
   */
  markItemDelivered(
    sessionId: number,
    orderItemId: number,
  ): Observable<TableSession> {
    return this.http
      .patch<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/items/${orderItemId}/deliver`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * QUI-655 — receta activa de un producto, para el picker de "sin papas" al
   * tomar el pedido. Devuelve las lineas directas de la receta con su nombre.
   *
   * Se pide on-demand y no al listar el catalogo: seria N llamadas para una
   * captura que la mayoria de las veces nadie abre.
   */
  getRecipeByProduct(productId: number): Observable<
    Array<{ component_product_id: number; name: string; quantity: string | number }>
  > {
    return this.http
      .get<ApiResponse<any>>(
        `${this.apiUrl}/store/recipes/by-product/${productId}`,
      )
      .pipe(
        map((res) => {
          const items = res.data?.items ?? res.data?.recipe_items ?? [];
          return items.map((it: any) => ({
            component_product_id: it.component_product_id ?? it.product_id,
            name:
              it.component_product?.name ??
              it.products?.name ??
              `#${it.component_product_id ?? it.product_id}`,
            quantity: it.quantity,
          }));
        }),
        catchError(this.handleError),
      );
  }

  closeSession(sessionId: number): Observable<TableSession> {
    return this.http
      .post<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/close`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * Assign (or clear) the customer of the table session's draft order.
   * Pass `null` to detach the customer (true anonymous — no "Cliente
   * General" sentinel). Mirrors `PATCH /store/table-sessions/:id/customer`.
   */
  assignCustomer(
    sessionId: number,
    customerId: number | null,
  ): Observable<TableSession> {
    return this.http
      .patch<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/customer`,
        { customer_id: customerId },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Staff payments (Restaurant Suite — C3) ─────────────────────────
  /**
   * List pending manual payments for the order backing a table session
   * (`GET /store/table-sessions/:id/payments/pending`). The mesero UI
   * renders this list under the "Pagos por confirmar" badge and offers
   * a one-click "Confirmar" per row.
   *
   * Returns an empty array when the session has no pending payments —
   * the section hides itself in that case.
   */
  listPendingPayments(sessionId: number): Observable<PaymentPendingView[]> {
    return this.http
      .get<ApiResponse<PaymentPendingView[]>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/payments/pending`,
      )
      .pipe(
        map((res) => res.data ?? []),
        catchError(this.handleError),
      );
  }

  /**
   * Staff-side confirmation of a pending table-session payment
   * (`POST /store/table-sessions/:id/payments/:paymentId/confirm`).
   *
   * Transitions a `state='pending'` payment row to `succeeded`, updates
   * `orders.total_paid` / `remaining_balance`, and broadcasts the
   * canonical events downstream. Manual methods only — gateway-issued
   * payments are finalized by the webhook, not by staff.
   *
   * `tip_amount` is optional (the `payments` table doesn't carry a tip
   * column, but the C3 DTO accepts it for echo-back).
   *
   * The session REMAINS OPEN — staff can confirm multiple payments in
   * sequence until the order's grand_total is fully covered.
   */
  confirmPayment(
    sessionId: number,
    paymentId: number,
    payload: { tip_amount?: number } = {},
  ): Observable<ConfirmTablePaymentResult> {
    const body: { tip_amount?: number } = {};
    if (payload.tip_amount != null && payload.tip_amount > 0) {
      body.tip_amount = payload.tip_amount;
    }
    return this.http
      .post<ApiResponse<ConfirmTablePaymentResult>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/payments/${paymentId}/confirm`,
        body,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Table checkout (POS payment against an open table) ──────────────

  /**
   * Settle the table's bill through the unified POS payment endpoint
   * (`POST /store/payments/pos`) using `table_session_id`. The backend
   * applies the payment to the table's existing draft order, re-derives
   * totals from the order items, closes the session, moves the table to
   * `cleaning`, and auto-fires any still-pending prepared items.
   *
   * `subtotal` and `total_amount` are required by the POS DTO even on the
   * table-close path (the backend re-derives the authoritative totals, but
   * the validator demands the two numbers), so we forward the order's
   * current `subtotal_amount` / `grand_total`.
   */
  payTableSession(payload: PayTableSessionDto): Observable<PayTableSessionResult> {
    const body = {
      table_session_id: payload.table_session_id,
      subtotal: payload.subtotal,
      total_amount: payload.total_amount,
      store_payment_method_id: payload.store_payment_method_id,
      ...(payload.amount_received != null
        ? { amount_received: payload.amount_received }
        : {}),
      ...(payload.payment_reference
        ? { payment_reference: payload.payment_reference }
        : {}),
      ...(payload.tip_amount != null && payload.tip_amount > 0
        ? { tip_amount: payload.tip_amount }
        : {}),
    };
    return this.http
      .post<ApiResponse<PayTableSessionResult>>(
        `${this.apiUrl}/store/payments/pos`,
        body,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Split order ───────────────────────────────────────────────────

  splitByItems(orderId: number, dto: SplitByItemsDto): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(
        `${this.apiUrl}/store/orders/${orderId}/split-by-items`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  splitByAmount(
    orderId: number,
    dto: SplitByAmountDto,
  ): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(
        `${this.apiUrl}/store/orders/${orderId}/split-by-amount`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  static statusLabel(status: TableStatus): string {
    switch (status) {
      case 'available':
        return 'Disponible';
      case 'occupied':
        return 'Ocupada';
      case 'reserved':
        return 'Reservada';
      case 'cleaning':
        return 'Limpieza';
    }
  }

  static statusColorVar(status: TableStatus): string {
    // Design-system semantic color tokens (defined in styles.scss),
    // consumed by the floor-map component via [style.--cell-color].
    // available→success, occupied→error, reserved→warning, cleaning→muted gray.
    switch (status) {
      case 'available':
        return 'var(--color-success)';
      case 'occupied':
        return 'var(--color-error)';
      case 'reserved':
        return 'var(--color-warning)';
      case 'cleaning':
        return 'var(--color-text-muted)';
    }
  }

  static statusIcon(status: TableStatus): IconName {
    switch (status) {
      case 'available':
        return 'circle-check';
      case 'occupied':
        return 'utensils';
      case 'reserved':
        return 'calendar-clock';
      case 'cleaning':
        return 'sparkles';
    }
  }

  // ─── Error mapping ─────────────────────────────────────────────────

  /**
   * `TablesController` ya propaga el status HTTP real (QUI-571): un rechazo
   * por cuenta abierta llega como `409` y no como `200 { success:false }`,
   * así que el error viaja por el canal de error de RxJS y este handler es
   * la única traducción necesaria. Aquí vivía un `unwrapEnvelope` que leía
   * `success:false` de una respuesta 200 — quitarlo es parte del arreglo,
   * no una regresión.
   *
   * CP-POLLO-ARABE-727 C.2 — MIGRADO a `parseApiError`, no parcheado. El
   * orden anterior leía `error?.error?.message` ANTES de la rama 403: un 403
   * de cocina (guard → `AUTH_PERM_001`, `devMessage` 'Access denied', 13
   * chars < `MIN_PRESENTABLE_LENGTH=16`) pasaba tal cual al toast del
   * cocinero en inglés. `parseApiError` es la aduana única del repo:
   * descarta el devMessage no presentable y cae a
   * `ERROR_MESSAGES[AUTH_PERM_001] = 'No tiene permisos para realizar esta
   * accion.'` (error-messages.ts:107). El copy por status de abajo solo actúa
   * de red de seguridad cuando parseApiError no encontró nada mejor
   * (`DEFAULT_ERROR_MESSAGE`), para no degradar la UX de 404/409/422/5xx.
   */
  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('TablesService Error:', error);

    const parsed = parseApiError(error);
    let message = parsed.userMessage;

    if (message === DEFAULT_ERROR_MESSAGE) {
      message = tablesStatusErrorCopy(error);
    }

    return throwError(() => message);
  };
}

/**
 * Copy por status de ÚLTIMO RECURSO para `TablesService.handleError`.
 *
 * Solo se invoca cuando `parseApiError` cayó al `DEFAULT_ERROR_MESSAGE` (sin
 * `error_code` en el catálogo y sin mensaje presentable del backend). No
 * sustituye la aduana de `parseApiError`: la complementa conservando el copy
 * amigable por status de la versión anterior del handler, para no degradar
 * 404/409/422/5xx a un genérico. NO re-lee `error.error.message` en crudo — ese
 * era el origen del bug "Access denied".
 */
function tablesStatusErrorCopy(error: any): string {
  if (error?.status === 401) return 'No autorizado';
  if (error?.status === 403) return 'No tienes permisos suficientes';
  if (error?.status === 404) return 'Mesa o sesión no encontrada';
  if (error?.status === 409) return 'Conflicto: estado incompatible';
  if (error?.status === 422) return 'Operación no permitida';
  if (typeof error?.status === 'number' && error.status >= 500) {
    return 'Error del servidor. Inténtalo más tarde';
  }
  return DEFAULT_ERROR_MESSAGE;
}
