import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { industriesSupportIngredients } from '../../../../../shared/constants/industry-modules.constant';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { environment } from '../../../../../../environments/environment';
import { selectStoreSettings } from '../../../../../core/store/auth/auth.selectors';
import { MenusService } from '../../restaurant-ops/menus/services/menus.service';
import type { MenuFull } from '../../restaurant-ops/menus/interfaces';
import type {
  Table,
  TableSession,
  OpenTableSessionDto,
  AddItemsToTableSessionDto,
  TableSessionAddItem,
  SplitByItemsDto,
  SplitByAmountDto,
  SplitResult,
  SplitMode,
} from '../../restaurant-ops/tables/interfaces';

interface FireOrderItemsResponse {
  kitchen_ticket_id: number;
  order_id: number;
  fired_item_ids: number[];
  skipped_item_ids: number[];
  cogs_total: string | number;
  consumed_line_count: number;
}

/** A single line to seed a counter (table-less) draft order before firing. */
export interface CounterOrderLine {
  product_id: number;
  product_variant_id?: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_rate?: number;
}

/** Shape returned by POST /store/orders (subset used by the counter-fire flow). */
export interface CounterOrderResult {
  id: number;
  order_number?: string;
  state?: string;
  order_items: Array<{
    id: number;
    product_id: number | null;
    product_variant_id?: number | null;
    product_name: string;
    quantity: number;
  }>;
}

export interface OpenTableSessionResult {
  session: TableSession;
  order: {
    id: number;
    state: string;
    grand_total: number | string;
    subtotal_amount?: number | string;
    tax_amount?: number | string;
    order_items?: Array<{
      id: number;
      product_id: number | null;
      product_name: string;
      quantity: number;
      unit_price: number | string;
      total_price: number | string;
    }>;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ActiveMenuSection {
  id: number;
  name: string;
  sort_order: number;
  product_ids: number[];
  is_active_window: boolean;
}

interface ActiveMenuSnapshot {
  menu: MenuFull | null;
  sections: ActiveMenuSection[];
  loaded: boolean;
  loadedAt: number | null;
}

const ACTIVE_MENU_TTL_MS = 60_000;

/**
 * PosRestaurantIntegrationService (Restaurant Suite — Fase H)
 *
 * Thin seam that lets the existing retail POS delegate to the new
 * restaurant modules (kitchen-fire, tables, menus) WITHOUT forking
 * the POS or breaking retail tenants. All restaurant-specific UI
 * (fire / open table / split) is gated on the `isRestaurantMode`
 * computed signal so the buttons are simply absent for stores
 * without the `restaurant` industry.
 *
 * The service also exposes an `activeMenu` signal used by the POS
 * product picker to group products by active menu sections within
 * their availability windows. A short TTL (60s) avoids hammering
 * the backend on every product reload while still picking up menu
 * edits within a minute.
 */
@Injectable({ providedIn: 'root' })
export class PosRestaurantIntegrationService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);
  private readonly menusService = inject(MenusService);

  private readonly apiUrl = environment.apiUrl;

  /** Reactive view of the current store industries. */
  private readonly industries = signal<string[]>([]);

  /** `true` only when the active store is tagged with the `restaurant` industry. */
  readonly isRestaurantMode = computed(() =>
    this.industries().includes('restaurant'),
  );
  /**
   * Fase 0: ingredient capacity flag for the same store industries. Today
   * identical to `isRestaurantMode`, but routed through the shared resolver
   * so future industries can opt in without touching call sites.
   */
  readonly storeSupportsIngredients = computed(() =>
    industriesSupportIngredients(this.industries()),
  );

  /** Active menu snapshot used by the POS product picker to group items. */
  readonly activeMenu = signal<ActiveMenuSnapshot>({
    menu: null,
    sections: [],
    loaded: false,
    loadedAt: null,
  });

  /**
   * Currently open table session for this POS operator, if any. When set,
   * the cart binds to `session.order_id` (draft order) and Fire/Split
   * buttons become available. Cleared by closeTableSession().
   */
  readonly currentTableSession = signal<TableSession | null>(null);

  /** Convenience computed: true when a table session is open and active. */
  readonly hasOpenTableSession = computed(
    () => this.currentTableSession() != null,
  );

  constructor() {
    this.store
      .select(selectStoreSettings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings: any) => {
        const next =
          (settings?.general?.industries as string[] | undefined) ?? [];
        this.industries.set(Array.isArray(next) ? next : []);
        if (this.isRestaurantMode()) {
          this.refreshActiveMenu();
        } else {
          this.activeMenu.set({
            menu: null,
            sections: [],
            loaded: true,
            loadedAt: Date.now(),
          });
        }
      });
  }

  // ─── Kitchen fire ─────────────────────────────────────────────────

  /**
   * Fire a list of order_items to the kitchen. The backend (Phase D) consumes
   * the recipe stock + emits the COGS auto-entry; the kitchen ticket is
   * returned so the POS can refresh the UI.
   */
  fireOrderItems(
    orderId: number,
    orderItemIds: number[],
    notes?: string,
  ): Observable<FireOrderItemsResponse> {
    return this.http
      .post<ApiResponse<FireOrderItemsResponse>>(
        `${this.apiUrl}/store/kitchen-fire`,
        { order_id: orderId, order_item_ids: orderItemIds, notes },
      )
      .pipe(
        map((res) => res.data),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo enviar a cocina')),
        ),
      );
  }

  /**
   * Anti-doble-fire guard. Tracks whether the KDS has already been triggered
   * for the current cart session (Create / Cobrar / Envío all share this flag
   * to avoid double-discounting the same `prepared` order_items). The flag is
   * reset by the POS component on clearCart / newSale.
   */
  private readonly _preparedFired = signal(false);
  readonly preparedFiredForCurrentCart = this._preparedFired.asReadonly();
  markPreparedFired(): void {
    this._preparedFired.set(true);
  }
  resetPreparedFired(): void {
    this._preparedFired.set(false);
  }

  /**
   * Fire `prepared` order_items to the kitchen in a single, idempotent call.
   * Returns `null` (no-op) when:
   *  - the store is not a `restaurant` industry tenant, OR
   *  - the caller passed an empty `orderItemIds` list, OR
   *  - the cart session has already fired (anti-double-fire).
   *
   * Safe to call multiple times for the same `orderId`/`orderItemIds`: the
   * backend `inventory_consumed_at_fire` guard (kitchen-fire.service.ts)
   * returns the `skipped_item_ids` and never double-discounts.
   *
   * Failures are **swallowed**: the order/payment has already been persisted
   * upstream (Create / Cobrar / Envío) so we do not roll back the sale. The
   * operator sees a toast and can re-fire manually.
   */
  maybeFireKitchen(
    orderId: number,
    orderItemIds: number[],
    notes?: string,
  ): Observable<FireOrderItemsResponse | null> {
    if (!this.isRestaurantMode() || !orderItemIds?.length) {
      return of(null);
    }
    if (this._preparedFired()) {
      return of(null);
    }
    this._preparedFired.set(true);
    return this.fireOrderItems(orderId, orderItemIds, notes).pipe(
      catchError((err) => {
        // Roll the guard back so the operator can retry from the UI.
        this._preparedFired.set(false);
        return throwError(() => err);
      }),
    );
  }

  /**
   * Create a draft counter (table-less) order so its `prepared` items can be
   * fired to the kitchen without opening a table. Used for mostrador / para
   * llevar flows where there is no `table_session`. The backend creates the
   * `orders` row in `draft` state and returns the persisted `order_items`
   * with their ids — those ids are what `fireOrderItems` consumes.
   *
   * Stock for tracked products is reserved (non-restrictive: availability is
   * NOT validated, matching the existing POS create path); the prepared
   * ingredient consumption happens later at fire, never here.
   */
  createCounterDraftOrder(
    customerId: number,
    lines: CounterOrderLine[],
    notes?: string,
  ): Observable<CounterOrderResult> {
    const subtotal = lines.reduce((sum, l) => sum + (l.total_price || 0), 0);
    const body = {
      customer_id: customerId,
      state: 'draft',
      subtotal: Number(subtotal.toFixed(2)),
      total_amount: Number(subtotal.toFixed(2)),
      internal_notes: notes,
      items: lines.map((l) => ({
        product_id: l.product_id,
        product_variant_id: l.product_variant_id,
        item_type: 'product',
        product_name: l.product_name,
        quantity: l.quantity,
        unit_price: Number((l.unit_price || 0).toFixed(2)),
        total_price: Number((l.total_price || 0).toFixed(2)),
        tax_rate: l.tax_rate,
      })),
    };
    return this.http
      .post<ApiResponse<CounterOrderResult>>(`${this.apiUrl}/store/orders`, body)
      .pipe(
        map((res) => res.data),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo crear la orden de mostrador')),
        ),
      );
  }

  // ─── Tables / open checks ────────────────────────────────────────

  /** List tables for the floor map picker (used by the "Open Table" modal). */
  listTables(): Observable<Table[]> {
    return this.http
      .get<ApiResponse<Table[]>>(`${this.apiUrl}/store/tables/floor-map`)
      .pipe(
        map((res) => res.data ?? []),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo cargar el mapa de mesas')),
        ),
      );
  }

  /**
   * Open a new table session: creates a draft `order` linked to a
   * `table_sessions` row. On success, the resulting session is cached in
   * `currentTableSession` so the Fire/Split buttons can use it.
   */
  openTableSession(
    dto: OpenTableSessionDto,
  ): Observable<OpenTableSessionResult> {
    return this.http
      .post<ApiResponse<OpenTableSessionResult>>(
        `${this.apiUrl}/store/table-sessions`,
        dto,
      )
      .pipe(
        map((res) => {
          const data = res.data;
          const session = (data?.session ?? data) as TableSession;
          this.currentTableSession.set(session);
          return data;
        }),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo abrir la mesa')),
        ),
      );
  }

  /**
   * Append items to the open table session's draft order. The backend
   * creates `order_items` server-side and the returned session reflects
   * the updated order.
   */
  addItemsToTableSession(
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
        map((res) => {
          const session = (res.data ?? null) as TableSession | null;
          if (session) this.currentTableSession.set(session);
          return session as TableSession;
        }),
        catchError((err) =>
          throwError(
            () => this.toMessage(err, 'No se pudieron agregar items a la mesa'),
          ),
        ),
      );
  }

  /** Close the active table session (does NOT close the order; use split or pay). */
  closeTableSession(sessionId: number): Observable<TableSession> {
    return this.http
      .post<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}/close`,
        {},
      )
      .pipe(
        map((res) => {
          const session = (res.data ?? null) as TableSession | null;
          if (this.currentTableSession()?.id === sessionId) {
            this.currentTableSession.set(null);
          }
          return session as TableSession;
        }),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo cerrar la mesa')),
        ),
      );
  }

  /**
   * Refresh the current table session from the backend (useful after
   * fire/split to pull the latest order_items + their ids).
   */
  refreshTableSession(sessionId: number): Observable<TableSession> {
    return this.http
      .get<ApiResponse<TableSession>>(
        `${this.apiUrl}/store/table-sessions/${sessionId}`,
      )
      .pipe(
        map((res) => {
          const session = (res.data ?? null) as TableSession | null;
          if (session) this.currentTableSession.set(session);
          return session as TableSession;
        }),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo refrescar la mesa')),
        ),
      );
  }

  // ─── Split order (financial) ──────────────────────────────────────

  splitByItems(orderId: number, dto: SplitByItemsDto): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(
        `${this.apiUrl}/store/orders/${orderId}/split-by-items`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo dividir por ítems')),
        ),
      );
  }

  splitByAmount(
    orderId: number,
    mode: SplitMode,
    nSplits: number,
    amounts?: number[],
  ): Observable<SplitResult> {
    const dto: SplitByAmountDto = { mode, n_splits: nSplits, amounts };
    return this.http
      .post<ApiResponse<SplitResult>>(
        `${this.apiUrl}/store/orders/${orderId}/split-by-amount`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError((err) =>
          throwError(() => this.toMessage(err, 'No se pudo dividir por monto')),
        ),
      );
  }

  // ─── Active menu grouping (POS product picker) ────────────────────

  /**
   * Refresh the cached active menu. Skips the call when restaurant mode
   * is off. The POS product picker calls this once on boot and then
   * relies on the TTL until something explicitly invalidates it.
   */
  refreshActiveMenu(force = false): void {
    if (!this.isRestaurantMode()) return;

    const cached = this.activeMenu();
    const fresh =
      cached.loaded &&
      cached.loadedAt != null &&
      Date.now() - cached.loadedAt < ACTIVE_MENU_TTL_MS;
    if (fresh && !force) return;

    this.menusService
      .listPaginated({ is_active: true, page: 1, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const first = res?.data?.[0];
          if (!first) {
            this.activeMenu.set({
              menu: null,
              sections: [],
              loaded: true,
              loadedAt: Date.now(),
            });
            return;
          }
          this.menusService
            .getFull(first.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (full) => this.applyActiveMenu(full),
              error: () => this.clearActiveMenu(),
            });
        },
        error: () => this.clearActiveMenu(),
      });
  }

  private applyActiveMenu(full: MenuFull): void {
    const now = new Date();
    const dow = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const sections: ActiveMenuSection[] = (full.sections ?? []).map((s) => {
      const wins: Array<{
        day_of_week: number;
        start_time: string;
        end_time: string;
      }> = (s as any).availability_windows ?? [];
      const inWindow =
        wins.length === 0
          ? true
          : wins.some((w) => {
              if (w.day_of_week !== dow) return false;
              const start = toMinutes(w.start_time);
              const end = toMinutes(w.end_time);
              return minutes >= start && minutes <= end;
            });
      return {
        id: s.id,
        name: s.name,
        sort_order: s.sort_order ?? 0,
        product_ids: (s.items ?? []).map((i: any) => Number(i.product_id)),
        is_active_window: inWindow,
      };
    });
    this.activeMenu.set({
      menu: full,
      sections,
      loaded: true,
      loadedAt: Date.now(),
    });
  }

  private clearActiveMenu(): void {
    this.activeMenu.set({
      menu: null,
      sections: [],
      loaded: true,
      loadedAt: Date.now(),
    });
  }

  /**
   * Resolve the section a product belongs to (first active section, then
   * first inactive). Returns `null` when the product is not in the active
   * menu — the POS product picker then keeps the default category grouping.
   */
  resolveSectionForProduct(productId: number): ActiveMenuSection | null {
    const numericId = Number(productId);
    if (!Number.isFinite(numericId)) return null;
    const sections = this.activeMenu().sections;
    const active = sections.find(
      (s) => s.is_active_window && s.product_ids.includes(numericId),
    );
    if (active) return active;
    const any = sections.find((s) => s.product_ids.includes(numericId));
    return any ?? null;
  }

  private toMessage(error: any, fallback: string): string {
    const apiMessage = error?.error?.message;
    if (typeof apiMessage === 'string') return apiMessage;
    if (Array.isArray(apiMessage) && apiMessage.length)
      return apiMessage.join(', ');
    if (error?.status === 403) return 'No tienes permisos suficientes';
    if (error?.status === 404) return 'Recurso no encontrado';
    if (typeof error?.status === 'number' && error.status >= 500)
      return 'Error del servidor. Inténtalo más tarde';
    return fallback;
  }
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
