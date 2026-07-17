import {
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, finalize, map, tap } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';
import { QrScanBehavior } from '../../../../core/models/store-settings.interface';

/**
 * Shape persisted to localStorage `vendix_table_context`.
 *
 * `deviceUuid` is intentionally NOT persisted to localStorage — it lives in
 * `sessionStorage` only. Two tabs on the same device must have distinct
 * device ids (one tab = one diner device), and localStorage is shared across
 * tabs.
 */
interface PersistedTableContext {
  token: string;
  name: string;
  behavior: QrScanBehavior;
  autoFire: boolean;
  sessionId: number | null;
  storeId: number | null;
}

/**
 * Response from `GET /api/ecommerce/tables/resolve?token=...`.
 *
 * `enable_table_checkout` is the per-store flag from
 * `store_settings.restaurant.enable_table_checkout` (gate for the diner
 * self-checkout C2 flow). When `false`, the diner cannot call `payTable`.
 */
interface ResolveTableResponse {
  success: boolean;
  data: {
    store_id: number;
    table: { id: number; name: string };
    behavior: QrScanBehavior;
    auto_fire: boolean;
    session_id?: number | null;
    enable_table_checkout?: boolean;
  };
}

/**
 * Diner-facing payment method view. Mirrors backend `store_payment_methods`
 * joined with `system_payment_methods.type`. Returned by the public
 * `/ecommerce/tables/{token}/payment-methods` endpoint (C2).
 *
 * BLOCKER (D1): this endpoint is NOT yet exposed by the backend. D2/D3
 * components should NOT call `loadPaymentMethods` until C2 lands the route.
 * The method here exists so D3 wiring stays compile-clean.
 */
export interface PaymentMethodView {
  id: number;
  type: 'cash' | 'bank_transfer' | 'wompi' | 'wallet' | string;
  name: string;
}

/**
 * Snapshot of the most recent `payment.pending` SSE event for this table.
 * Used by the banner to flip to "Pago pendiente" without a refetch.
 */
export interface PaymentTablePendingView {
  payment_id: number;
  amount: number;
  method: string;
  state: 'pending';
}

/**
 * Snapshot of the most recent `payment.confirmed` SSE event for this table.
 * Used by the banner to flip to "Pago confirmado" without a refetch.
 */
export interface PaymentTableConfirmedView {
  payment_id: number;
  amount: number;
  method: string;
  state: 'succeeded' | 'captured';
}

/**
 * Result of `POST /ecommerce/tables/{token}/pay`. Mirrors backend
 * `PayTableResult` in `ecommerce-tables.service.ts` (L96-111).
 *
 * - `cash` / `bank_transfer` → only `{ payment_id, state: 'pending' }`.
 * - `wompi` → adds `next: 'wompi_widget'` + the `wompi_data` payload the
 *   storefront renders into the Wompi Widget.
 */
export interface PayTableResult {
  payment_id: number;
  state: string;
  next?: 'wompi_widget';
  wompi_data?: {
    public_key: string;
    currency: string;
    amount_in_cents: number;
    reference: string;
    signature_integrity: string;
    redirect_url: string;
    acceptance_token: string;
    accept_personal_auth: string;
    customer_email: string;
  };
}

/**
 * Payload of a `comensal_joined` / `comensal_left` SSE event. The backend
 * reports the running `active_devices` count so the banner can render
 * "3 dispositivos en la mesa".
 */
export interface DinerJoinEvent {
  device_id: string;
  active_devices: number;
  timestamp: number;
}

/**
 * Payload for `POST /api/ecommerce/tables/{token}/pay`.
 * Mirrors backend `PayTableDto` in `dto/pay-table.dto.ts` (L33-52).
 */
export interface PayTableRequestPayload {
  store_payment_method_id: number;
  amount?: number;
  payment_reference?: string;
  tip_amount?: number;
}

/**
 * Body for `POST /api/ecommerce/tables/:token/order`.
 */
export interface TableOrderItem {
  product_id: number;
  quantity: number;
  product_variant_id?: number;
  price_tier_id?: number;
}

/**
 * Response from `POST /api/ecommerce/tables/:token/order`.
 */
interface AddTableOrderResponse {
  success: boolean;
  data: {
    session_id: number;
    order_id: number;
    added: number;
    fired: boolean;
  };
}

/**
 * A single line in the diner-facing table bill.
 */
export interface TableBillItem {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  /**
   * Product image URL, surfaced by the diner bill so the "Mi cuenta" panel can
   * render a thumbnail per line. Optional — use as-is (never sign/transform;
   * same contract as the catalog). Null/undefined → placeholder icon.
   */
  image_url?: string | null;
}

/**
 * Shape returned by `GET /api/ecommerce/tables/:token/bill` (inside `data`).
 * This is the diner's read-only view of what has been ordered at the table.
 */
export interface TableBill {
  table: { id: number; name: string };
  session_id: number;
  order_id: number;
  items: TableBillItem[];
  subtotal: number;
  grand_total: number;
  currency: string;
  /** Amount already settled against this bill (backend getBill). Optional. */
  total_paid?: number;
  /** Outstanding balance = grand_total − total_paid (backend getBill). Optional. */
  balance_due?: number;
}

interface TableBillResponse {
  success: boolean;
  data: TableBill;
}

/**
 * Generic ack response for staff-notification actions
 * (`call-waiter`, `request-bill`, `request-split`).
 */
interface TableActionResponse {
  success: boolean;
  data: { ok: boolean };
}

/**
 * Response from `POST /api/ecommerce/tables/:token/guests`.
 */
interface SetGuestsResponse {
  success: boolean;
  data: { session_id: number; guest_count: number };
}

/** Payment preference the diner signals when requesting the bill. */
export type TablePaymentPreference = 'cash' | 'card' | 'split';

/** Split modes supported by `request-split`. */
export type TableSplitMode = 'equal' | 'custom' | 'by_items';

/**
 * Root singleton that captures the QR-table context when a customer
 * arrives via `?mesa=<public_token>`. The context is persisted to
 * localStorage so it survives navigation within the storefront.
 *
 * Signals are zoneless-friendly: consumers read them in templates
 * with `@if` / `()()` and Angular's change detection picks them up
 * automatically — no NgZone or markForCheck needed.
 */
@Injectable({ providedIn: 'root' })
export class TableContextService {
  private readonly api_url = `${environment.apiUrl}/ecommerce/tables`;
  private readonly storage_key = 'vendix_table_context';

  private readonly http = inject(HttpClient);
  private readonly tenant_facade = inject(TenantFacade);
  private readonly platform_id = inject(PLATFORM_ID);
  private readonly is_browser = isPlatformBrowser(this.platform_id);

  // ── Signals ──────────────────────────────────────────────────────
  readonly tableToken = signal<string | null>(null);
  readonly tableName = signal<string | null>(null);
  readonly behavior = signal<QrScanBehavior | null>(null);
  readonly autoFire = signal(false);
  readonly sessionId = signal<number | null>(null);
  /** Store the table belongs to — needed by the diner SSE `?store_id=`. */
  readonly storeId = signal<number | null>(null);

  // ── Device identity (D1) ───────────────────────────────────────
  /**
   * Per-tab device identifier. Lives in `sessionStorage`, NOT `localStorage`,
   * so two tabs on the same browser have distinct ids — one tab = one
   * diner device for the shared-bill model (see skill `vendix-restaurant-
   * table-qr` Rule 3: re-scanning re-joins, but a fresh tab is a fresh
   * device so the staff can see how many phones are at the table).
   *
   * The backend will receive this in the join payload (C2/C5) and the
   * store-payment / pay endpoints may use it as the `diner_user_id` fallback
   * when no authenticated user is present.
   */
  private readonly _deviceUuid = signal<string>('');
  readonly deviceUuid = computed(() => this._deviceUuid());
  private readonly device_storage_key = 'vendix_table_device';

  /**
   * Gate for the diner self-checkout flow (C2). Populated by
   * `resolve()` / `setResolveResponse()` from the backend's
   * `enable_table_checkout` flag. When `false`, `payTable` returns
   * 409 from the backend and the storefront should hide the
   * "Pagar desde la mesa" CTA.
   */
  readonly enableTableCheckout = signal(false);

  // ── Diner action / bill state (GAP-5) ───────────────────────────
  readonly bill = signal<TableBill | null>(null);
  readonly loading_bill = signal(false);
  readonly calling_waiter = signal(false);
  readonly requesting_bill = signal(false);

  /**
   * In-flight guard for `addOrder`. While a POST is pending, additional
   * calls short-circuit (no duplicate POST). Belt-and-suspenders alongside
   * the upstream single-dispatch in product-card.onAddToCart (Step 8).
   */
  private readonly addingOrderInFlight = signal(false);
  readonly isAddingOrder = computed(() => this.addingOrderInFlight());

  // ── Payment state (D1 — diner self-checkout C2) ─────────────────
  /** Payment methods the diner can choose from for the table pay flow. */
  private readonly _paymentMethods = signal<PaymentMethodView[]>([]);
  readonly paymentMethods = computed(() => this._paymentMethods());
  readonly loading_payment_methods = signal(false);

  /** Mirrored from the `payment.pending` SSE event. */
  readonly paymentPending = signal<PaymentTablePendingView | null>(null);
  /** Mirrored from the `payment.confirmed` SSE event. */
  readonly paymentConfirmed = signal<PaymentTableConfirmedView | null>(null);
  readonly paying_table = signal(false);
  readonly confirming_payment = signal(false);

  /**
   * True once the table session has been CLOSED (settled at the POS or via
   * diner self-checkout). Set from the `session_closed` SSE event
   * (`TableSessionSseService`). Drives the diner "Mesa cerrada / ¡Gracias por
   * tu visita!" farewell. Reset on a fresh `resolve()` and on `clear()`.
   */
  readonly sessionClosed = signal(false);

  // ── Live counters (D1 — diner presence SSE) ─────────────────────
  /** Number of active devices on the current table (from `comensal_joined` / `comensal_left`). */
  readonly activeDevicesCount = signal<number>(1);
  /** Last diner-presence event received — drives the "X en la mesa" hint. */
  readonly lastJoinEvent = signal<DinerJoinEvent | null>(null);

  // ── Computed ─────────────────────────────────────────────────────
  readonly isActive = computed(() => this.tableToken() !== null);
  readonly isOpenTab = computed(() => this.behavior() === 'open_tab');
  readonly isRequireStaff = computed(
    () => this.behavior() === 'require_staff',
  );
  readonly isMenuOnly = computed(() => this.behavior() === 'menu_only');
  readonly isMarkOccupied = computed(
    () => this.behavior() === 'mark_occupied',
  );
  /**
   * True when the diner MAY attempt a self-checkout (gate resolved +
   * behavior is one that opens a tab + the table has an active session).
   * `enableTableCheckout` alone is not enough — the table must also be
   * in an `open_tab` flow.
   */
  readonly canCheckout = computed(
    () => this.enableTableCheckout() && this.isOpenTab() && this.sessionId() != null,
  );

  /**
   * True when the storefront should HIDE purchase CTAs (add-to-cart /
   * buy-now / quick-add) because the QR-mode forbids ordering right now.
   *
   * Rules (single source of truth — consumed by all 5 storefront surfaces):
   *  - No active table context (`behavior === null`) → never hide. The
   *    diner is browsing the regular ecommerce catalog.
   *  - `menu_only` → always hide (the QR is a digital menu, no orders).
   *  - `mark_occupied` / `require_staff` → hide UNTIL the staff opens a
   *    session for the table (pre-session state). Once `sessionId` is
   *    set, the diner can order — this flips the same way the SSE
   *    `session_opened` handler will populate `sessionId` once Step 4c
   *    lands.
   *  - `open_tab` → never hide (the whole point of the mode is ordering
   *    straight from the QR).
   */
  readonly hideDineInPurchase = computed<boolean>(() => {
    const mode = this.behavior();
    if (mode === null) return false;
    if (mode === 'menu_only') return true;
    if (mode === 'mark_occupied' || mode === 'require_staff') {
      return this.sessionId() === null;
    }
    return false;
  });

  /** Inverse of `hideDineInPurchase` — exposed for template clarity at the
   *  call site (`@if (canOrderToTab())` reads better than `!hideDineInPurchase()`). */
  readonly canOrderToTab = computed<boolean>(() => !this.hideDineInPurchase());

  constructor() {
    // Lazy init — sessionStorage only exists in the browser.
    if (this.is_browser) {
      this.initDeviceUuid();
    }
  }

  // ── HTTP helpers ─────────────────────────────────────────────────

  /**
   * Returns the active table token or throws. Mirrors `addOrder`'s guard so
   * every diner mutation fails loudly (never silently no-ops) when there is
   * no table context.
   */
  private requireToken(): string {
    const token = this.tableToken();
    if (!token) {
      throw new Error('TableContextService: no active table token');
    }
    return token;
  }

  private getHeaders(): HttpHeaders {
    const domainConfig = this.tenant_facade.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Resolves the table context from the backend using the public token
   * encoded in the QR URL (`?mesa=<token>`). Sets the signals and
   * persists to localStorage on success.
   */
  resolve(token: string): Observable<ResolveTableResponse> {
    const params = new HttpParams().set('token', token);
    return this.http
      .get<ResolveTableResponse>(`${this.api_url}/resolve`, {
        params,
        headers: this.getHeaders(),
      })
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            this.setResolveResponse(response.data, token);
            this.persist();
          }
        }),
      );
  }

  /**
   * Applies a `resolve` payload to the live signals. Split out from
   * `resolve()` so it can be reused by tests and by `hydrate()` callers
   * that already have a parsed response (e.g. pre-fetched SSR snapshot).
   *
   * Also resets the payment lifecycle signals — a new resolve means a new
   * table, so any stale `payment.pending` / `payment.confirmed` from the
   * previous table must not bleed into the banner.
   */
  setResolveResponse(
    data: ResolveTableResponse['data'],
    fallbackToken?: string,
  ): void {
    if (fallbackToken) {
      this.tableToken.set(fallbackToken);
    }
    this.tableName.set(data.table?.name ?? null);
    this.behavior.set(data.behavior);
    this.autoFire.set(!!data.auto_fire);
    this.sessionId.set(data.session_id ?? null);
    this.storeId.set(data.store_id ?? null);
    this.enableTableCheckout.set(!!data.enable_table_checkout);

    // Reset diner-payment + presence state for the new table.
    this.paymentPending.set(null);
    this.paymentConfirmed.set(null);
    this._paymentMethods.set([]);
    this.activeDevicesCount.set(1);
    this.lastJoinEvent.set(null);
    this.sessionClosed.set(false);
  }

  /**
   * Adds items to the running table tab/order. Only valid when
   * `behavior === 'open_tab'` (or `require_staff` confirmed by staff).
   * Backend returns 409 for `menu_only` / `mark_occupied`.
   *
   * In-flight guard (Step 8 — BUG A cure): a single diner click must equal a
   * single POST. While one request is pending, additional clicks are dropped
   * here so duplicate dispatch upstream (rapid click, re-emit) can never
   * double the items on the bill. The returned Observable for a guarded
   * call completes immediately with no emission so qty-stepper resets don't
   * false-trigger for ignored clicks.
   */
  addOrder(items: TableOrderItem[]): Observable<AddTableOrderResponse> {
    if (this.addingOrderInFlight()) {
      // Drop the click — another POST is already in flight.
      return new Observable<AddTableOrderResponse>((observer) => {
        observer.complete();
      });
    }
    const token = this.tableToken();
    if (!token) {
      throw new Error('TableContextService.addOrder: no active table token');
    }
    this.addingOrderInFlight.set(true);
    return this.http
      .post<AddTableOrderResponse>(
        `${this.api_url}/${token}/order`,
        { items },
        { headers: this.getHeaders() },
      )
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            this.sessionId.set(response.data.session_id);
            this.persist();
          }
        }),
        finalize(() => this.addingOrderInFlight.set(false)),
      );
  }

  /**
   * Reads the current table bill (running order) for the diner. Sets the
   * `bill` signal on success and toggles `loading_bill`. Errors propagate
   * to the call-site (404 when there is no active session).
   */
  getMyBill(): Observable<TableBill> {
    const token = this.requireToken();
    this.loading_bill.set(true);
    return this.http
      .get<TableBillResponse>(`${this.api_url}/${token}/bill`, {
        headers: this.getHeaders(),
      })
      .pipe(
        map((response) => response.data),
        tap((bill) => this.bill.set(bill)),
        finalize(() => this.loading_bill.set(false)),
      );
  }

  /**
   * Notifies staff that the table needs a waiter. Toggles `calling_waiter`.
   */
  callWaiter(note?: string): Observable<TableActionResponse> {
    const token = this.requireToken();
    this.calling_waiter.set(true);
    return this.http
      .post<TableActionResponse>(
        `${this.api_url}/${token}/call-waiter`,
        { note },
        { headers: this.getHeaders() },
      )
      .pipe(finalize(() => this.calling_waiter.set(false)));
  }

  /**
   * Asks staff to bring the bill, optionally signalling a payment
   * preference. Toggles `requesting_bill`.
   */
  requestBill(
    note?: string,
    payment_preference?: TablePaymentPreference,
  ): Observable<TableActionResponse> {
    const token = this.requireToken();
    this.requesting_bill.set(true);
    return this.http
      .post<TableActionResponse>(
        `${this.api_url}/${token}/request-bill`,
        { note, payment_preference },
        { headers: this.getHeaders() },
      )
      .pipe(finalize(() => this.requesting_bill.set(false)));
  }

  /**
   * Requests a split of the table bill into `n_splits` parts. Reuses the
   * `requesting_bill` flag for button loading state.
   */
  requestSplit(
    n_splits: number,
    mode: TableSplitMode,
  ): Observable<TableActionResponse> {
    const token = this.requireToken();
    this.requesting_bill.set(true);
    return this.http
      .post<TableActionResponse>(
        `${this.api_url}/${token}/request-split`,
        { n_splits, mode },
        { headers: this.getHeaders() },
      )
      .pipe(finalize(() => this.requesting_bill.set(false)));
  }

  /**
   * Sets the number of guests at the table. Backend returns 422
   * (`TABLE_GUEST_COUNT_EXCEEDS_CAPACITY`) when it exceeds table capacity.
   */
  setGuests(guest_count: number): Observable<SetGuestsResponse> {
    const token = this.requireToken();
    return this.http.post<SetGuestsResponse>(
      `${this.api_url}/${token}/guests`,
      { guest_count },
      { headers: this.getHeaders() },
    );
  }

  /**
   * Reads the persisted context from localStorage and populates the
   * signals. Call at storefront bootstrap (guarded by `is_browser`).
   */
  hydrate(): void {
    if (!this.is_browser) return;
    try {
      const raw = localStorage.getItem(this.storage_key);
      if (!raw) return;
      const ctx = JSON.parse(raw) as PersistedTableContext;
      if (!ctx?.token) return;
      this.tableToken.set(ctx.token);
      this.tableName.set(ctx.name ?? null);
      this.behavior.set(ctx.behavior ?? null);
      this.autoFire.set(!!ctx.autoFire);
      this.sessionId.set(ctx.sessionId ?? null);
      this.storeId.set(ctx.storeId ?? null);
    } catch {
      // Corrupted entry — remove it silently.
      localStorage.removeItem(this.storage_key);
    }
  }

  /**
   * Clears all table context (signals + localStorage).
   */
  clear(): void {
    this.tableToken.set(null);
    this.tableName.set(null);
    this.behavior.set(null);
    this.autoFire.set(false);
    this.sessionId.set(null);
    this.storeId.set(null);
    this.enableTableCheckout.set(false);
    this.bill.set(null);
    this.loading_bill.set(false);
    this.calling_waiter.set(false);
    this.requesting_bill.set(false);
    this.paymentPending.set(null);
    this.paymentConfirmed.set(null);
    this._paymentMethods.set([]);
    this.loading_payment_methods.set(false);
    this.paying_table.set(false);
    this.confirming_payment.set(false);
    this.activeDevicesCount.set(1);
    this.lastJoinEvent.set(null);
    this.sessionClosed.set(false);
    if (this.is_browser) {
      localStorage.removeItem(this.storage_key);
    }
  }

  /**
   * Diner acknowledges the "Mesa cerrada" farewell — fully leaves the table
   * (clears context + forgets the per-tab device id). Wire this to the
   * farewell CTA so the storefront returns to normal browsing after a close.
   */
  acknowledgeSessionClosed(): void {
    this.leaveTable();
  }

  /**
   * "Salir de la mesa" — clears table context AND forgets the per-tab
   * device UUID so the next scan of the same QR issues a fresh device id.
   * The next scan of `?mesa=...` will hydrate a brand-new device.
   */
  leaveTable(): void {
    this.clear();
    if (this.is_browser) {
      sessionStorage.removeItem(this.device_storage_key);
    }
    this._deviceUuid.set('');
  }

  /**
   * Loads the diner-facing payment methods for the current table. Used by
   * the "Pagar desde la mesa" modal to render the method picker (cash /
   * bank_transfer / wompi).
   *
   * BLOCKER (D1): the public endpoint `GET /ecommerce/tables/{token}/
   * payment-methods` is NOT yet exposed by the backend — C2 owns that route.
   * Until C2 lands, this method will 404 from the server. The method exists
   * here so D3 wiring (modal component) compiles against a stable contract.
   *
   * Idempotent: safe to call multiple times — the latest server response
   * wins.
   */
  loadPaymentMethods(token: string): Observable<PaymentMethodView[]> {
    this.loading_payment_methods.set(true);
    return this.http
      .get<{ success: boolean; data: PaymentMethodView[] }>(
        `${this.api_url}/${token}/payment-methods`,
        { headers: this.getHeaders() },
      )
      .pipe(
        map((response) => response.data ?? []),
        tap((methods) => this._paymentMethods.set(methods)),
        finalize(() => this.loading_payment_methods.set(false)),
      );
  }

  /**
   * Initiates payment of the table's open session via
   * `POST /ecommerce/tables/{token}/pay`. Mirrors backend `PayTableDto`:
   *
   * - `cash` / `bank_transfer` → returns `{ payment_id, state: 'pending' }`
   *   and the banner flips to "Pago pendiente" via the `payment.pending`
   *   SSE event.
   * - `wompi` → returns the same shape plus `next: 'wompi_widget'` and the
   *   `wompi_data` payload the storefront feeds into the Wompi Widget.
   *
   * Honors the server-side gate `enable_table_checkout` — when the store
   * has it disabled, the backend returns 409 and the call fails. The
   * caller should also gate the UI via `canCheckout()` to avoid the round
   * trip in the common case.
   *
   * The amount is intentionally optional — the server defaults to
   * `order.grand_total` when omitted (full bill pay). Diner-initiated
   * partial pays pass `amount`.
   */
  payTable(
    token: string,
    dto: PayTableRequestPayload,
  ): Observable<PayTableResult> {
    this.paying_table.set(true);
    return this.http
      .post<{ success: boolean; data: PayTableResult }>(
        `${this.api_url}/${token}/pay`,
        dto,
        { headers: this.getHeaders() },
      )
      .pipe(
        map((response) => response.data),
        tap((result) => {
          if (result.state === 'pending') {
            this.paymentPending.set({
              payment_id: result.payment_id,
              amount: dto.amount ?? 0,
              method: dto.store_payment_method_id.toString(),
              state: 'pending',
            });
          }
        }),
        finalize(() => this.paying_table.set(false)),
      );
  }

  /**
   * Force-confirms a Wompi payment registered via `payTable` after the
   * diner returns from the widget. `POST /ecommerce/tables/{token}/pay/
   * confirm` with `{ payment_id }` polls the Wompi API and returns the
   * canonical terminal state.
   *
   * Idempotent — calling twice on a terminal payment is safe (backend
   * short-circuits).
   *
   * On `succeeded` / `captured` the backend also pushes `payment.confirmed`
   * onto the diner SSE stream — the `TableSessionSseService` mirrors it
   * into `paymentConfirmed()` automatically. The explicit `tap()` here is
   * just an optimistic signal so the UI flips state on the same tick the
   * HTTP response lands.
   */
  confirmWompi(
    token: string,
    paymentId: number,
  ): Observable<{ state: string; order_state: string }> {
    this.confirming_payment.set(true);
    return this.http
      .post<{
        success: boolean;
        data: { state: string; order_state: string };
      }>(`${this.api_url}/${token}/pay/confirm`, { payment_id: paymentId }, {
        headers: this.getHeaders(),
      })
      .pipe(
        map((response) => response.data),
        tap((data) => {
          if (data.state === 'succeeded' || data.state === 'captured') {
            this.paymentConfirmed.set({
              payment_id: paymentId,
              amount: this.paymentPending()?.amount ?? 0,
              method: this.paymentPending()?.method ?? 'wompi',
              state: data.state as 'succeeded' | 'captured',
            });
            this.paymentPending.set(null);
          }
        }),
        finalize(() => this.confirming_payment.set(false)),
      );
  }

  /**
   * Records a `comensal_joined` / `comensal_left` SSE event into the live
   * counters. Called by `TableSessionSseService` (D2) on the corresponding
   * event types — kept here (rather than inlined in the SSE service) so the
   * table-context stays the single source of truth for diner presence.
   */
  recordDinerPresence(event: DinerJoinEvent): void {
    this.lastJoinEvent.set(event);
    this.activeDevicesCount.set(Math.max(1, event.active_devices));
  }

  /**
   * Reads / mints the per-tab device UUID. Persisted in `sessionStorage`
   * (NOT localStorage) so two tabs on the same browser see distinct ids.
   */
  private initDeviceUuid(): string {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(this.device_storage_key);
    } catch {
      // sessionStorage may throw in privacy modes — fall through to mint.
      id = null;
    }
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      try {
        sessionStorage.setItem(this.device_storage_key, id);
      } catch {
        // best-effort — even if write fails the in-memory signal still works.
      }
    }
    this._deviceUuid.set(id);
    return id;
  }

  // ── Internal ─────────────────────────────────────────────────────

  private persist(): void {
    if (!this.is_browser) return;
    const payload: PersistedTableContext = {
      token: this.tableToken() ?? '',
      name: this.tableName() ?? '',
      behavior: this.behavior() ?? 'menu_only',
      autoFire: this.autoFire(),
      sessionId: this.sessionId(),
      storeId: this.storeId(),
    };
    localStorage.setItem(this.storage_key, JSON.stringify(payload));
  }
}