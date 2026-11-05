import { DecimalPipe, NgClass } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { interval, switchMap } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  CustomerSelectComponent,
  CustomerSelectOption,
  DialogService,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components';
import type { PaymentSubmit } from '../../../../../../../shared/components';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { isTipPolicyActive } from '../../../../../../../core/utils/tip-policy.util';
import { environment } from '../../../../../../../../environments/environment';
import { OrderPaymentModalComponent } from '../../../../orders/components/order-payment-modal/order-payment-modal.component';
import { StoreOrdersService } from '../../../../orders/services/store-orders.service';
import type { Order, PayOrderDto } from '../../../../orders/interfaces/order.interface';
import { PaymentMethodsService } from '../../../../settings/payments/services/payment-methods.service';
import {
  PaymentMethodState,
  StorePaymentMethod,
} from '../../../../settings/payments/interfaces/payment-methods.interface';
import { ServiceRegistryService } from '../../service-reminders-page/service-registry.service';
import type { ServiceSessionRow } from '../service-stations-page.component';
import {
  ServiceStation,
  ServiceStationsService,
  SessionAccountPart,
  SessionDeposit,
  StationServiceOption,
} from '../service-stations.service';
import { DepositPanelComponent } from './components/deposit-panel/deposit-panel.component';
import { storePaymentMethodRows } from '../open-session-deposit/deposit-payment-methods.util';
import {
  addMinutesIso,
  computeStationClock,
  isoToStoreLocalInput,
  NextReservation,
  nextReservationLabel,
  shouldWarnNextReservation,
} from '../station-clock.util';
import { stationTypeLabel } from '../station-type-labels';
import { storeWallTimeToIso } from '../service-stations-time.util';

interface SessionOrderItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number | string;
  total_price: number | string;
  final_unit_price?: number | string | null;
  tax_rate?: number | string | null;
  item_type?: string;
}

interface SessionOrder {
  id: number;
  order_number: string;
  state?: string;
  grand_total: number | string;
  subtotal_amount: number | string;
  tax_amount?: number | string | null;
  remaining_balance?: number | string | null;
  customer?: { id?: number } | null;
  customer_id?: number | null;
  order_items?: SessionOrderItem[];
}

type SessionDetail = ServiceSessionRow & {
  /** `GET /service-sessions/:id` returns the subjects as a list; the overview row carries `subject`. */
  subjects?: ServiceSessionRow['subject'][] | null;
  next_reservation?: NextReservation | null;
  station_type?: string | null;
  /** Consumable deposit of the session; null when the station has none. */
  deposit?: SessionDeposit | null;
  /** S11: rental order of an `at_start` session; null when the rental lives in the single account. */
  rental?: SessionAccountPart | null;
  /** S11: consumption order (the session account). */
  consumption?: SessionAccountPart | null;
  /** S11: what is still to collect across the rental and the consumption orders. */
  to_collect?: number;
  order_id?: number | null;
  settled_at?: string | null;
  /** Copy of the station rental rate taken when the session opened (S10); null billing mode = legacy session. */
  rental_billing_mode?: string | null;
  rental_block_minutes?: number | null;
  rental_block_price?: number | string | null;
  rate_windows_snapshot?: unknown;
};

interface BudgetCeiling {
  amount: number | string;
  currency?: string;
  version?: number;
  is_system?: boolean;
}

interface SessionProposal {
  id: number;
  version: number;
  status: string;
  total: number | string;
}

interface SellableVariant {
  id: number;
  name?: string | null;
  sku?: string | null;
  price_override?: number | string | null;
  sale_price?: number | string | null;
  is_on_sale?: boolean;
}

/** Sellable catalog row as returned by the products endpoint (only the fields used here). */
interface SellableProduct {
  id: number;
  name: string;
  product_type?: string;
  base_price?: number | string | null;
  sale_price?: number | string | null;
  is_on_sale?: boolean;
  is_ingredient?: boolean;
  is_sellable?: boolean;
  product_variants?: SellableVariant[];
}

const STATIONS_ROUTE = '/admin/services/stations';
const CLOSE_WITH_BALANCE_PERMISSION = 'store:reservations:close_with_balance';
const CLOSED_STATUSES = ['closed', 'cancelled', 'no_show'];
const DEFAULT_WHATSAPP_COUNTRY_PREFIX = '57';

function toCents(value: number | string | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

/**
 * Dedicated page for one station session (sibling of the stations overview).
 * Replaces the old "Cuenta de Estación" modal: account lines, add and remove
 * items, extend, pause and resume, charge in place and close. Nothing here
 * extends or closes a session on its own; every transition is an explicit click.
 */
@Component({
  selector: 'app-service-session-page',
  standalone: true,
  imports: [
    DecimalPipe,
    NgClass,
    FormsModule,
    CurrencyPipe,
    StickyHeaderComponent,
    SpinnerComponent,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    CustomerSelectComponent,
    OrderPaymentModalComponent,
    DepositPanelComponent,
  ],
  templateUrl: './service-session-page.component.html',
})
export class ServiceSessionPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ServiceStationsService);
  private readonly ordersApi = inject(StoreOrdersService);
  private readonly paymentMethodsApi = inject(PaymentMethodsService);
  private readonly registryApi = inject(ServiceRegistryService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly authFacade = inject(AuthFacade);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly currencyService = inject(CurrencyFormatService);

  protected readonly Number = Number;
  readonly currencyCode = this.currencyService.currencyCode;
  readonly timezone = computed(() => this.storeSettings.timezone());

  // Live clock: one signal ticked every second, cleaned up with the component.
  readonly now = signal(Date.now());

  readonly sessionId = signal<number | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly session = signal<SessionDetail | null>(null);
  readonly order = signal<SessionOrder | null>(null);
  readonly stations = signal<ServiceStation[]>([]);
  readonly services = signal<StationServiceOption[]>([]);
  /** The recurring-service check in requestClose needs the service catalog, so ?close=1 waits for both loads. */
  private readonly servicesLoaded = signal(false);
  private autoClosePending = false;
  readonly budget = signal<BudgetCeiling | null>(null);
  readonly budgetAmount = signal<number | null>(null);
  readonly proposals = signal<SessionProposal[]>([]);
  readonly accessUrl = signal<string | null>(null);
  readonly accessQrDataUrl = signal<string | null>(null);
  readonly accessQrLoading = signal(false);
  readonly reissueIdentityChecked = signal(false);
  readonly reissuingLink = signal(false);

  // Add items to the account
  readonly catalog = signal<SellableProduct[]>([]);
  readonly addProductId = signal<number | null>(null);
  readonly addVariantId = signal<number | null>(null);
  readonly addQuantity = signal<number>(1);
  readonly addUnitPrice = signal<number | null>(null);
  readonly addPriceEdited = signal(false);
  readonly addingItem = signal(false);

  // Extend
  readonly showExtendModal = signal(false);
  readonly customEnd = signal('');
  readonly extending = signal(false);

  // Close
  readonly showCloseDialog = signal(false);
  readonly showRecurringPrompt = signal(false);
  readonly closeCustomer = signal<CustomerSelectOption | null>(null);

  // Charge in place
  readonly showPayModal = signal(false);
  readonly payMethods = signal<StorePaymentMethod[]>([]);
  readonly paying = signal(false);
  readonly preparingCharge = signal(false);
  /** S11: set while the pay modal collects the rental order instead of the consumption order. */
  readonly rentalPayOrder = signal<SessionOrder | null>(null);
  readonly preparingRental = signal(false);
  readonly payError = signal<unknown>(null);

  readonly station = computed<ServiceStation | null>(() => {
    const current = this.session();
    if (!current) return null;
    return this.stations().find((s) => s.id === current.station_id) ?? null;
  });

  readonly stationName = computed(() => {
    const current = this.session();
    return current?.station_name || this.station()?.name || 'Estación';
  });

  readonly typeLabel = computed(() => stationTypeLabel(this.station()?.station_type ?? this.session()?.station_type));

  readonly isClosed = computed(() => {
    const status = this.session()?.status;
    return !!status && CLOSED_STATUSES.includes(status);
  });
  readonly isPaused = computed(() => this.session()?.status === 'paused');
  /** Once the order leaves draft (it was paid) the backend rejects adding or removing items (STATION_006). */
  readonly accountLocked = computed(() => {
    const state = this.order()?.state;
    return !!state && state !== 'draft';
  });

  readonly clock = computed(() => {
    const current = this.session();
    if (!current) return null;
    return computeStationClock(current.opened_at, current.planned_end_at, this.now());
  });

  readonly nextReservation = computed<NextReservation | null>(
    () => this.session()?.next_reservation ?? this.station()?.next_reservation ?? null,
  );
  readonly nextReservationWarning = computed(() => {
    const next = this.nextReservation();
    const current = this.session();
    if (!next || !current || this.isClosed()) return null;
    return shouldWarnNextReservation(current.planned_end_at, next, this.now())
      ? nextReservationLabel(next, this.timezone())
      : null;
  });

  readonly statusLabel = computed(() => {
    if (this.isClosed()) return 'Cerrada';
    return this.isPaused() ? 'En pausa' : 'Atención activa';
  });

  readonly headerSubtitle = computed(() => {
    const current = this.session();
    return `${this.typeLabel()} · ${this.statusLabel()}${current ? ' · Sesión #' + current.id : ''}`;
  });

  readonly clockBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    if (this.isClosed()) return 'gray';
    const mode = this.clock()?.mode;
    if (mode === 'overtime') return 'red';
    if (mode === 'countdown') return 'blue';
    return 'green';
  });

  /** Balance in cents, taken from the order; zero when there is no order yet. */
  readonly balanceCents = computed(() => {
    const order = this.order();
    if (!order) return 0;
    return toCents(order.remaining_balance ?? order.grand_total);
  });
  readonly balance = computed(() => this.balanceCents() / 100);
  readonly paidAmount = computed(() => {
    const order = this.order();
    if (!order) return 0;
    return Math.max(0, (toCents(order.grand_total) - this.balanceCents()) / 100);
  });
  /** Part of the total is already paid: the collector must let the cashier type a smaller amount. */
  readonly hasPartialPayment = computed(() => {
    const order = this.order();
    return !!order && this.balanceCents() > 0 && this.balanceCents() < toCents(order.grand_total);
  });

  /** Order the pay modal collects: the rental order while collecting the rental, else the session account. */
  private readonly payTarget = computed(() => this.rentalPayOrder() ?? this.order());
  readonly payBalance = computed(() => {
    const target = this.payTarget();
    return target ? toCents(target.remaining_balance ?? target.grand_total) / 100 : 0;
  });
  readonly payHasPartial = computed(() => {
    const target = this.payTarget();
    const balanceCents = Math.round(this.payBalance() * 100);
    return !!target && balanceCents > 0 && balanceCents < toCents(target.grand_total);
  });

  readonly canCloseWithBalance = computed(() => {
    const permissions = this.authFacade.userPermissions();
    const roles = this.authFacade.userRoles();
    return (
      permissions.includes(CLOSE_WITH_BALANCE_PERMISSION) ||
      roles.includes('super_admin') ||
      roles.includes('SUPER_ADMIN')
    );
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    if (!this.session() || this.isClosed()) return [];
    return [
      { id: 'extend', label: 'Extender', variant: 'outline', icon: 'timer' },
      this.isPaused()
        ? { id: 'resume', label: 'Reanudar', variant: 'outline', icon: 'play', loading: this.saving() }
        : { id: 'pause', label: 'Pausar', variant: 'outline', icon: 'pause', loading: this.saving() },
      { id: 'charge', label: 'Cobrar', variant: 'primary', icon: 'credit-card', loading: this.preparingCharge() },
      { id: 'close', label: 'Cerrar', variant: 'danger', icon: 'check-circle', loading: this.saving() },
    ];
  });

  readonly linkedServiceIds = computed<number[]>(() => this.station()?.services?.map((s) => s.product_id) ?? []);

  readonly catalogOptions = computed<SelectorOption[]>(() => {
    const linked = this.linkedServiceIds();
    return this.catalog()
      .filter((prod) => {
        if (prod.is_ingredient === true || prod.is_sellable === false) return false;
        if (prod.product_type === 'service' && linked.length) return linked.includes(prod.id);
        return true;
      })
      .map((prod) => ({
        value: prod.id,
        label: `${prod.name} (${this.currencyService.format(Number(prod.base_price || 0))})`,
        description: prod.product_type === 'service' ? 'Servicio' : 'Producto / Consumible',
      }));
  });

  readonly addVariants = computed<SellableVariant[]>(() => {
    const id = this.addProductId();
    if (!id) return [];
    return this.catalog().find((p) => p.id === id)?.product_variants ?? [];
  });
  readonly addVariantOptions = computed<SelectorOption[]>(() =>
    this.addVariants().map((v) => ({
      value: v.id,
      label: `${v.name || v.sku} (${this.currencyService.format(this.variantPrice(v))})`,
    })),
  );
  readonly addEstimatedTotal = computed(() => {
    const current = toCents(this.order()?.grand_total);
    const quantity = Math.max(1, Number(this.addQuantity() || 1));
    return (current + Math.round(quantity * Math.max(0, Number(this.addUnitPrice() ?? 0)) * 100)) / 100;
  });

  readonly extendQuickOptions = [
    { minutes: 15, label: '+15 min' },
    { minutes: 30, label: '+30 min' },
    { minutes: 60, label: '+1 h' },
  ];

  // ---------- Rental + consumption split (S11) ----------

  readonly rental = computed(() => this.session()?.rental ?? null);
  readonly rentalPaid = computed(() => {
    const part = this.rental();
    return !!part && part.remaining <= 0;
  });
  /** Total still to collect: both orders when the session has a rental order, else the account balance. */
  readonly accountDue = computed(() => {
    const current = this.session();
    return current?.rental && current.to_collect != null ? Number(current.to_collect) || 0 : this.balance();
  });
  readonly canCollectRental = computed(() => {
    const part = this.rental();
    return !!part && part.remaining > 0 && !this.isClosed();
  });

  // ---------- Extension price preview (S10) ----------

  /**
   * How the backend will bill an extension, derived from the session rental snapshot:
   * `priced` only for `planned` billing with a time rate and no rate windows (windows change
   * the price per block and are not replicated here, so no price is shown for them).
   */
  private readonly extendBilling = computed<
    | { kind: 'priced'; blockMinutes: number; blockPrice: number }
    | { kind: 'free' }
    | { kind: 'elapsed' }
    | { kind: 'unknown' }
  >(() => {
    const current = this.session();
    if (!current) return { kind: 'unknown' };
    const blockMinutes = Number(current.rental_block_minutes) || 0;
    const blockPrice = Number(current.rental_block_price) || 0;
    const hasRate = blockMinutes > 0 && blockPrice > 0;
    if (!current.rental_billing_mode || !hasRate) return { kind: 'free' };
    if (current.rental_billing_mode !== 'planned') return { kind: 'elapsed' };
    if (!current.order_id) return { kind: 'free' };
    const windows = Array.isArray(current.rate_windows_snapshot) ? current.rate_windows_snapshot : [];
    return windows.length ? { kind: 'unknown' } : { kind: 'priced', blockMinutes, blockPrice };
  });

  /** Price the backend adds for `minutes` more; null when it cannot be derived reliably. */
  private extensionPrice(minutes: number): number | null {
    const billing = this.extendBilling();
    if (billing.kind !== 'priced' || !(minutes > 0)) return null;
    const blocks = Math.max(1, Math.ceil(minutes / billing.blockMinutes));
    return (Math.round(billing.blockPrice * 100) * blocks) / 100;
  }

  readonly extendQuickQuotes = computed(() =>
    this.extendQuickOptions.map((option) => {
      const price = this.extensionPrice(option.minutes);
      return { ...option, price: price == null ? null : this.currencyService.format(price) };
    }),
  );

  /** Price of the custom end time, for the "Extender hasta esa hora" button. */
  readonly customExtendQuote = computed<string | null>(() => {
    const current = this.session();
    const iso = storeWallTimeToIso(this.customEnd(), this.timezone() || 'America/Bogota');
    if (!current?.planned_end_at || !iso) return null;
    const minutes = (Date.parse(iso) - Date.parse(current.planned_end_at)) / 60_000;
    const price = this.extensionPrice(minutes);
    return price == null ? null : this.currencyService.format(price);
  });

  readonly extendNote = computed<string | null>(() => {
    switch (this.extendBilling().kind) {
      case 'free':
        return 'Sin cobro adicional.';
      case 'elapsed':
        return 'El tiempo se cobra al cerrar, según lo transcurrido.';
      default:
        return null;
    }
  });

  readonly intakeAnswers = computed(() => this.session()?.intake?.answers ?? []);

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));

    // The overview hands over the tracking link it still holds in memory right after check-in.
    const handoff = this.router.getCurrentNavigation()?.extras.state as { accessUrl?: string | null } | undefined;
    if (handoff?.accessUrl) this.showAccessUrl(handoff.accessUrl);

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      if (!Number.isInteger(id) || id <= 0) {
        this.loading.set(false);
        this.loadError.set('La atención solicitada no es válida.');
        return;
      }
      this.sessionId.set(id);
      this.loadAll(id);
    });
  }

  // ---------- Loading ----------

  private loadAll(id: number): void {
    this.loading.set(true);
    this.loadError.set(null);
    // "Finalizar" on the overview card lands here with ?close=1; consumed once, never re-fired by retry().
    this.autoClosePending = this.route.snapshot.queryParamMap.get('close') === '1';
    if (this.autoClosePending) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { close: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    this.api
      .getSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full: SessionDetail | null) => {
          this.loading.set(false);
          if (!full) {
            this.loadError.set('No se encontró la atención.');
            return;
          }
          this.applySession(full);
          this.maybeAutoClose();
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(this.errorText(error, 'No fue posible cargar la atención.'));
        },
      });

    this.api
      .list(1, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (response) => this.stations.set(response.data ?? []), error: () => {} });
    this.api
      .getServiceOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (services) => {
          this.services.set(services ?? []);
          this.servicesLoaded.set(true);
          this.maybeAutoClose();
        },
        error: () => {
          this.servicesLoaded.set(true);
          this.maybeAutoClose();
        },
      });
    this.api
      .getSellableProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (prods) => this.catalog.set((prods ?? []) as SellableProduct[]), error: () => {} });
    this.loadBudget(id);
    this.http
      .get<{ data?: SessionProposal[] }>(`${environment.apiUrl}/store/service-sessions/${id}/proposals`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.proposals.set(r?.data ?? []), error: () => this.proposals.set([]) });
  }

  private applySession(full: SessionDetail): void {
    this.session.set(full);
    this.order.set((full.order ?? null) as SessionOrder | null);
    if (full.access_url && !this.accessUrl()) this.showAccessUrl(full.access_url);
  }

  /** Reloads only the session and its order (after items, payment, extend or a deposit change). */
  refreshSession(): void {
    const id = this.sessionId();
    if (!id) return;
    this.api
      .getSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full: SessionDetail | null) => {
          if (full && this.sessionId() === id) this.applySession(full);
        },
        error: () => {},
      });
  }

  private loadBudget(id: number): void {
    this.api
      .getSessionBudget(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (raw) => {
          // The system base is not a customer ceiling: no warning and no "Techo".
          const value = raw && !raw.is_system ? raw : null;
          this.budget.set(value);
          this.budgetAmount.set(value ? Number(value.amount) : null);
        },
        error: () => this.budget.set(null),
      });
  }

  retry(): void {
    const id = this.sessionId();
    if (id) this.loadAll(id);
  }

  private maybeAutoClose(): void {
    if (!this.autoClosePending || !this.servicesLoaded() || !this.session() || this.isClosed()) return;
    this.autoClosePending = false;
    void this.requestClose();
  }

  // ---------- Header ----------

  onHeaderAction(id: string): void {
    switch (id) {
      case 'extend':
        this.openExtend();
        break;
      case 'pause':
        this.transition('pause');
        break;
      case 'resume':
        this.transition('resume');
        break;
      case 'charge':
        this.openCharge();
        break;
      case 'close':
        void this.requestClose();
        break;
    }
  }

  // ---------- Customer helpers (same metadata contract as the overview) ----------

  private readonly subjectRow = computed(() => {
    const current = this.session();
    return current?.subject ?? current?.subjects?.[0] ?? null;
  });

  customerName(): string {
    const subject = this.subjectRow();
    const meta = subject?.metadata as Record<string, unknown> | undefined;
    if (meta && meta['customer_name']) return String(meta['customer_name']);
    return subject?.label || 'Cliente General';
  }

  customerPhone(): string | null {
    const meta = this.subjectRow()?.metadata as Record<string, unknown> | undefined;
    return meta && meta['customer_phone'] ? String(meta['customer_phone']) : null;
  }

  customerDoc(): string | null {
    const meta = this.subjectRow()?.metadata as Record<string, unknown> | undefined;
    return meta && meta['customer_document'] ? String(meta['customer_document']) : null;
  }

  /** The API sends money as Decimal strings; the currency pipe takes numbers. */
  money(value: number | string | null | undefined): number | null {
    return value == null || value === '' ? null : Number(value);
  }

  lineTotalWithTax(item: SessionOrderItem): number {
    return item.final_unit_price != null
      ? Math.round(Number(item.final_unit_price) * Number(item.quantity) * 100) / 100
      : Number(item.total_price);
  }

  formatIntakeAnswer(fieldType: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (fieldType === 'checkbox' || typeof value === 'boolean') {
      return value === true || value === 'true' ? 'Sí' : 'No';
    }
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  // ---------- Items ----------

  private variantPrice(variant: SellableVariant): number {
    if (variant.is_on_sale && Number(variant.sale_price) > 0) return Number(variant.sale_price);
    if (Number(variant.price_override) > 0) return Number(variant.price_override);
    return this.productPrice(this.catalog().find((p) => p.id === this.addProductId()));
  }

  private productPrice(product: SellableProduct | undefined): number {
    if (product?.is_on_sale && Number(product.sale_price) > 0) return Number(product.sale_price);
    return Number(product?.base_price || 0);
  }

  onAddProductSelect(productId: number | string | null): void {
    const id = Number(productId) || null;
    this.addProductId.set(id);
    this.addVariantId.set(null);
    this.addPriceEdited.set(false);
    if (!id) {
      this.addUnitPrice.set(null);
      return;
    }
    this.addUnitPrice.set(this.productPrice(this.catalog().find((p) => p.id === id)));
  }

  onAddVariantSelect(variantId: number | string | null): void {
    const id = Number(variantId) || null;
    this.addVariantId.set(id);
    const variant = this.addVariants().find((v) => v.id === id);
    if (variant) this.addUnitPrice.set(this.variantPrice(variant));
    this.addPriceEdited.set(false);
  }

  onAddUnitPriceChange(value: number | null): void {
    this.addUnitPrice.set(value);
    this.addPriceEdited.set(true);
  }

  addItem(): void {
    const current = this.session();
    const productId = this.addProductId();
    if (!current || !productId) return;
    if (this.addVariants().length && !this.addVariantId()) {
      this.toast.error('Elige la variante del producto.');
      return;
    }
    const quantity = Math.max(1, Number(this.addQuantity() || 1));
    const price = this.addPriceEdited() && this.addUnitPrice() != null ? Number(this.addUnitPrice()) : undefined;
    this.addingItem.set(true);
    this.api
      .addItem(current.id, {
        product_id: productId,
        product_variant_id: this.addVariantId() ?? undefined,
        quantity,
        unit_price: price,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.addingItem.set(false);
          this.addProductId.set(null);
          this.addVariantId.set(null);
          this.addQuantity.set(1);
          this.addUnitPrice.set(null);
          this.addPriceEdited.set(false);
          this.toast.success('Ítem agregado a la cuenta de la estación.');
          this.refreshSession();
        },
        error: (error: unknown) => {
          this.addingItem.set(false);
          this.toast.error(this.errorText(error, 'No fue posible agregar el ítem a la cuenta.'));
        },
      });
  }

  removeItem(itemId: number): void {
    const current = this.session();
    if (!current || !itemId) return;
    this.api
      .removeItem(current.id, itemId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Ítem eliminado de la cuenta.');
          this.refreshSession();
        },
        error: (error: unknown) => this.toast.error(this.errorText(error, 'No fue posible eliminar el ítem.')),
      });
  }

  saveBudget(): void {
    const current = this.session();
    const amount = this.budgetAmount();
    if (!current || amount == null || amount < 0) return;
    this.saving.set(true);
    this.api
      .setBudget(current.id, amount, this.budget()?.currency, this.budget()?.version ?? 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Techo de presupuesto actualizado.');
          this.loadBudget(current.id);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(this.errorText(error, 'No fue posible guardar el presupuesto.'));
        },
      });
  }

  // ---------- Pause / resume ----------

  transition(action: 'pause' | 'resume'): void {
    const current = this.session();
    if (!current) return;
    this.saving.set(true);
    this.api
      .pauseResumeSession(current.id, action)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(action === 'pause' ? 'Atención pausada.' : 'Atención reanudada.');
          this.refreshSession();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(this.errorText(error, 'No fue posible actualizar el estado de la atención.'));
        },
      });
  }

  // ---------- Extend (S16) ----------

  openExtend(): void {
    const current = this.session();
    if (!current) return;
    const base = addMinutesIso(current.planned_end_at, 30, Date.now());
    this.customEnd.set(isoToStoreLocalInput(base, this.timezone()));
    this.showExtendModal.set(true);
  }

  extendBy(minutes: number): void {
    const current = this.session();
    if (!current) return;
    void this.confirmAndExtend(addMinutesIso(current.planned_end_at, minutes, Date.now()), minutes);
  }

  extendToCustom(): void {
    const current = this.session();
    const iso = storeWallTimeToIso(this.customEnd(), this.timezone() || 'America/Bogota');
    if (!current || !iso) {
      this.toast.error('Indica una fecha y hora de fin válidas.');
      return;
    }
    const minutes = current.planned_end_at ? (Date.parse(iso) - Date.parse(current.planned_end_at)) / 60_000 : 0;
    void this.confirmAndExtend(iso, minutes);
  }

  /** Every extension asks first, with the new end time and the price of the added time; cancel changes nothing. */
  private async confirmAndExtend(plannedEndAt: string, minutes: number): Promise<void> {
    if (this.extending()) return;
    const endText = new Intl.DateTimeFormat('es-CO', {
      timeZone: this.timezone() || 'America/Bogota',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(plannedEndAt));
    const price = this.extensionPrice(minutes);
    const priceText =
      price != null
        ? `Valor de la extensión: ${this.currencyService.format(price)}.`
        : (this.extendNote() ?? 'El valor se calcula al confirmar según la tarifa de la estación.');
    const confirmed = await this.dialog.confirm({
      title: 'Extender atención',
      message: `La atención terminará el ${endText}. ${priceText}`,
      confirmText: 'Extender',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;
    this.submitExtend(plannedEndAt);
  }

  private submitExtend(plannedEndAt: string): void {
    const current = this.session();
    if (!current) return;
    this.extending.set(true);
    this.api
      .extendSession(current.id, plannedEndAt)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.extending.set(false);
          this.showExtendModal.set(false);
          this.toast.success('Atención extendida.');
          this.refreshSession();
        },
        error: (error: unknown) => {
          this.extending.set(false);
          // Conflict messages (for example "La estación tiene otra reserva desde las 02:00.") come from the backend.
          this.toast.error(this.errorText(error, 'No fue posible extender la atención.'));
        },
      });
  }

  // ---------- Close (S13) ----------

  /** Balance zero: normal close. Balance above zero: confirmation dialog with the three choices. */
  async requestClose(): Promise<void> {
    const current = this.session();
    if (!current || this.isClosed()) return;
    // Both orders count: a session that only owes its rental still needs the close-with-balance dialog,
    // the server blocks a plain close for the rental debt too.
    if (toCents(this.accountDue()) > 0) {
      this.showCloseDialog.set(true);
      return;
    }
    const recurring = !!this.services().find((s) => s.id === current.product_id)?.is_recurring;
    const order = this.order();
    if (recurring && !order?.customer?.id && !order?.customer_id) {
      this.closeCustomer.set(null);
      this.showRecurringPrompt.set(true);
      return;
    }
    this.closeNormally(null);
  }

  confirmRecurringClose(withCustomer: boolean): void {
    const customer = withCustomer ? this.closeCustomer() : null;
    this.showRecurringPrompt.set(false);
    this.closeNormally(customer?.id ?? null);
  }

  chargeFromCloseDialog(): void {
    this.showCloseDialog.set(false);
    // Nothing left on the account: what is owed is the rental order.
    if (this.balanceCents() <= 0 && this.canCollectRental()) {
      this.openRentalCharge();
      return;
    }
    this.openCharge();
  }

  private closeNormally(assignCustomerId: number | null): void {
    const current = this.session();
    if (!current) return;
    this.saving.set(true);
    this.api
      .closeSession(current.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          const orderId = this.order()?.id;
          if (assignCustomerId && orderId && current.product_id) {
            this.registryApi.assignCustomerToOrder(orderId, current.product_id, assignCustomerId).subscribe({
              error: (error: unknown) =>
                this.toast.warning(
                  this.errorText(error, 'La atención se cerró, pero no se pudo asignar el cliente. Hazlo desde el Registro de servicios.'),
                  undefined,
                  6000,
                ),
            });
          }
          this.toast.success('Atención finalizada con éxito.');
          void this.router.navigate([STATIONS_ROUTE]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          // 409 when a balance appeared meanwhile: refresh so the dialog reflects it.
          this.toast.error(this.errorText(error, 'No fue posible finalizar la atención.'));
          this.refreshSession();
        },
      });
  }

  closeLeavingBalance(): void {
    const current = this.session();
    if (!current) return;
    this.saving.set(true);
    this.api
      .closeSessionPending(current.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showCloseDialog.set(false);
          this.toast.success('Atención cerrada. La cuenta quedó por cobrar.');
          void this.router.navigate([STATIONS_ROUTE]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          // Shows the backend 403/409 text, e.g. the "cliente identificado" rule.
          this.toast.error(this.errorText(error, 'No fue posible cerrar la atención dejando la cuenta por cobrar.'));
        },
      });
  }

  // ---------- Charge in place ----------

  openCharge(): void {
    const current = this.session();
    if (!current || this.preparingCharge()) return;
    this.rentalPayOrder.set(null);
    this.preparingCharge.set(true);
    this.api
      .prepareCharge(current.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // The prepared order replaces the draft: reload it before collecting.
          this.api
            .getSession(current.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (full: SessionDetail | null) => {
                this.preparingCharge.set(false);
                if (full) this.applySession(full);
                this.payError.set(null);
                this.loadPayMethods();
                this.showPayModal.set(true);
              },
              error: (error: unknown) => {
                this.preparingCharge.set(false);
                this.toast.error(this.errorText(error, 'No fue posible cargar la cuenta para cobrar.'));
              },
            });
        },
        error: (error: unknown) => {
          this.preparingCharge.set(false);
          this.toast.error(this.errorText(error, 'No fue posible preparar el cobro de la cuenta.'));
        },
      });
  }

  /** S11: collects the rental order of an `at_start` session through the same pay modal. */
  openRentalCharge(): void {
    const current = this.session();
    if (!current || this.preparingRental()) return;
    this.preparingRental.set(true);
    this.api
      .prepareRentalCharge(current.id)
      .pipe(
        switchMap((prepared) => this.ordersApi.getOrderById(String(prepared.order_id))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (rentalOrder) => {
          this.preparingRental.set(false);
          const asSessionOrder = rentalOrder as unknown as SessionOrder;
          this.rentalPayOrder.set({
            ...asSessionOrder,
            remaining_balance: asSessionOrder.remaining_balance ?? this.rental()?.remaining ?? asSessionOrder.grand_total,
          });
          this.payError.set(null);
          this.loadPayMethods();
          this.showPayModal.set(true);
        },
        error: (error: unknown) => {
          this.preparingRental.set(false);
          this.toast.error(this.errorText(error, 'No fue posible preparar el cobro del alquiler.'));
        },
      });
  }

  closePayModal(): void {
    this.showPayModal.set(false);
    this.rentalPayOrder.set(null);
  }

  private loadPayMethods(): void {
    if (this.payMethods().length) return;
    this.paymentMethodsApi
      .getStorePaymentMethods({ state: PaymentMethodState.ENABLED, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.payMethods.set(storePaymentMethodRows(res)),
        error: () => this.payMethods.set([]),
      });
  }

  /** The order modal reads totals, number and payments; the session order carries them. */
  readonly payOrder = computed(() => this.payTarget() as unknown as Order | null);

  onPaymentSubmitted(submit: PaymentSubmit): void {
    const order = this.payTarget();
    if (!order) return;
    if (submit.storePaymentMethodId == null) {
      this.toast.error('Selecciona un método de pago válido');
      return;
    }
    const dto: PayOrderDto & { bank_account_id?: number } = {
      store_payment_method_id: submit.storePaymentMethodId,
      payment_type: submit.methodType === 'wompi' ? 'online' : 'direct',
      ...(submit.amountReceived != null ? { amount_received: submit.amountReceived } : {}),
      ...(submit.reference ? { payment_reference: submit.reference } : {}),
      ...(submit.bankAccountId != null ? { bank_account_id: submit.bankAccountId } : {}),
    };
    const legs = submit.legs ?? [];
    if (legs.length >= 2) {
      dto.payment_type = 'direct';
      dto.payments = legs.map((leg) => ({
        store_payment_method_id: leg.storePaymentMethodId,
        amount: leg.amount,
        ...(leg.amountReceived != null ? { amount_received: leg.amountReceived } : {}),
        ...(leg.reference ? { payment_reference: leg.reference } : {}),
        ...(leg.bankAccountId != null ? { bank_account_id: leg.bankAccountId } : {}),
      }));
    }
    // A partly paid account is charged by the typed amount, not by the full total.
    if (this.payHasPartial()) dto.amount = submit.amount;
    if (!this.rentalPayOrder() && isTipPolicyActive(this.storeSettings.tipPolicy()) && submit.tip != null && submit.tip > 0) {
      dto.tip_amount = submit.tip;
      if (submit.tipType != null) dto.tip_type = submit.tipType;
      if (submit.tipValue != null) dto.tip_value = submit.tipValue;
      if (submit.tipWaiterId != null) dto.tip_waiter_id = submit.tipWaiterId;
    }

    this.paying.set(true);
    this.ordersApi
      .flowPayOrder(String(order.id), dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.paying.set(false);
          this.closePayModal();
          const change = res.payment?.change ? ` — Cambio: ${this.currencyService.format(res.payment.change)}` : '';
          this.toast.success(`Pago registrado exitosamente${change}`);
          this.refreshSession();
        },
        error: (error: unknown) => {
          this.paying.set(false);
          this.payError.set(error);
          const wrapped = error as { errorCode?: string | null; cause?: unknown; message?: string } | null;
          const parsed = parseApiError(wrapped?.cause ?? error);
          this.toast.error(parsed.userMessage || wrapped?.message || 'Error al registrar el pago');
        },
      });
  }

  // ---------- Access link ----------

  private showAccessUrl(url: string | null): void {
    this.accessUrl.set(url);
    this.accessQrDataUrl.set(null);
    if (!url) return;
    this.accessQrLoading.set(true);
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } }))
      .then((dataUrl) => this.accessQrDataUrl.set(dataUrl))
      .catch(() => {})
      .finally(() => this.accessQrLoading.set(false));
  }

  reissueLink(): void {
    const current = this.session();
    if (!current || !this.reissueIdentityChecked()) return;
    this.reissuingLink.set(true);
    this.api
      .reissueAccessLink(current.id, {
        identity_verified: true,
        verification_method: 'in_person',
        verification_note: 'Reemitido desde la página de la atención con el cliente presente',
        idempotency_key: crypto.randomUUID(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.reissuingLink.set(false);
          this.reissueIdentityChecked.set(false);
          this.showAccessUrl(res.access_url ?? null);
          this.toast.success(
            res.email_delivery_status === 'sent'
              ? 'Enlace nuevo generado y enviado al correo del cliente.'
              : 'Enlace nuevo generado.',
          );
        },
        error: (error: unknown) => {
          this.reissuingLink.set(false);
          this.toast.error(this.errorText(error, 'No fue posible generar el enlace.'));
        },
      });
  }

  copyAccessUrl(): void {
    const url = this.accessUrl();
    if (!url) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => this.toast.success('Enlace de seguimiento copiado al portapapeles.'))
        .catch(() => this.toast.info(`URL de seguimiento: ${url}`));
    } else {
      this.toast.info(`URL de seguimiento: ${url}`);
    }
  }

  shareByWhatsApp(): void {
    const url = this.accessUrl();
    if (!url) return;
    const digitsOnly = (this.customerPhone() || '').replace(/\D/g, '');
    const phone = digitsOnly.length === 10 ? `${DEFAULT_WHATSAPP_COUNTRY_PREFIX}${digitsOnly}` : digitsOnly;
    const message = `Hola ${this.customerName()}, sigue en tiempo real el servicio en ${this.stationName()}: ${url}`;
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
  }

  private errorText(error: unknown, fallback: string): string {
    if (typeof error === 'string' && error.trim()) return error;
    return extractApiErrorMessage(error) || fallback;
  }
}
