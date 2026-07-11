import {
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, tap } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';
import { QrScanBehavior } from '../../../../core/models/store-settings.interface';

/**
 * Shape persisted to localStorage `vendix_table_context`.
 */
interface PersistedTableContext {
  token: string;
  name: string;
  behavior: QrScanBehavior;
  autoFire: boolean;
  sessionId: number | null;
}

/**
 * Response from `GET /api/ecommerce/tables/resolve?token=...`.
 */
interface ResolveTableResponse {
  success: boolean;
  data: {
    table: { id: number; name: string };
    behavior: QrScanBehavior;
    auto_fire: boolean;
    session_id?: number | null;
  };
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

  // ── HTTP helpers ─────────────────────────────────────────────────
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
            const data = response.data;
            this.tableToken.set(token);
            this.tableName.set(data.table?.name ?? null);
            this.behavior.set(data.behavior);
            this.autoFire.set(!!data.auto_fire);
            this.sessionId.set(data.session_id ?? null);
            this.persist();
          }
        }),
      );
  }

  /**
   * Adds items to the running table tab/order. Only valid when
   * `behavior === 'open_tab'` (or `require_staff` confirmed by staff).
   * Backend returns 409 for `menu_only` / `mark_occupied`.
   */
  addOrder(items: TableOrderItem[]): Observable<AddTableOrderResponse> {
    const token = this.tableToken();
    if (!token) {
      throw new Error('TableContextService.addOrder: no active table token');
    }
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
    if (this.is_browser) {
      localStorage.removeItem(this.storage_key);
    }
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
    };
    localStorage.setItem(this.storage_key, JSON.stringify(payload));
  }
}