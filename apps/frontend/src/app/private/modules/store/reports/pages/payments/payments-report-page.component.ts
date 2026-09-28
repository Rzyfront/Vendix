import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { Subject, catchError, of, switchMap, tap } from 'rxjs';

import {
  CardComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  SortDirection,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components';
import type {
  DropdownAction,
  FilterConfig,
  FilterValues,
  HeaderPinConfig,
} from '../../../../../../shared/components';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatStoreDateTime, storeToday } from '../../../../../../shared/utils/date.util';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

import {
  PaymentReportRow,
  PaymentsReportQuery,
  PaymentsSortBy,
  PaymentsSummary,
  StorePaymentMethodOption,
} from '../../../shared/interfaces/payments-report.interface';
import { PaymentsReportService } from '../../../shared/services/payments-report.service';
import {
  PAYMENTS_PINNED_PREFIX,
  PAYMENTS_PIN_FILTER_KEY,
  PAYMENT_STATE_BADGE,
  PAYMENT_STATE_LABELS,
  PaymentsFilterState,
  buildPaymentsFilterConfigs,
  defaultPaymentsFilterState,
  filterValuesToState,
  hasActiveFilters,
  paymentsUrlHasNoFilters,
  queryParamsToState,
  stateToFilterValues,
  stateToQuery,
  stateToQueryParams,
  stateToUrlPatch,
} from '../../../shared/utils/payments-filters.util';
import {
  buildPinnedFiltersKey,
  persistPinnedFilters,
  readPinnedFilters,
} from '../../../shared/utils/pinned-filters.util';
import { ReportExportService } from '../../services/report-export.service';

const PAGE_LIMIT = 25;
/** Prefijo propio del reporte (la analítica usa `analytics_`). */
const REPORT_PIN_PREFIX = PAYMENTS_PINNED_PREFIX + 'report_';

/** Fila aplanada para la tabla (evita rutas anidadas con `null`). */
interface PaymentViewRow {
  id: number;
  order_id: number;
  effective_date: string;
  order_number: string;
  customer_name: string;
  customer_document: string;
  payment_method: string;
  state: string;
  amount: number;
  refunded_amount: number;
  net_amount: number;
  reference: string;
  register_name: string;
  bank_account: string;
  has_receipt: string;
}

/**
 * Reporte «Pagos» (STORE_ADMIN): tabla con columnas ricas, stats, búsqueda,
 * filtros multi-select fijables, paginación y sort de servidor y export XLSX.
 * La URL es la fuente de verdad de los filtros (los tabs/filtros por query van
 * por el Router); página y sort viven en signals locales.
 */
@Component({
  selector: 'vendix-payments-report-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  templateUrl: './payments-report-page.component.html',
})
export class PaymentsReportPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(PaymentsReportService);
  private readonly authFacade = inject(AuthFacade);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly exportService = inject(ReportExportService);
  private readonly toast = inject(ToastService);

  // ── Estado ──────────────────────────────────────────────────────────────
  readonly state = signal<PaymentsFilterState>(defaultPaymentsFilterState());
  readonly page = signal(1);
  readonly limit = PAGE_LIMIT;
  readonly sortBy = signal<PaymentsSortBy | null>(null);
  readonly sortOrder = signal<'asc' | 'desc'>('desc');
  readonly pinned = signal(false);
  readonly filterValues = signal<FilterValues>({
    ...stateToFilterValues(defaultPaymentsFilterState()),
    [PAYMENTS_PIN_FILTER_KEY]: null,
  });

  readonly rows = signal<PaymentReportRow[]>([]);
  readonly summary = signal<PaymentsSummary | null>(null);
  readonly totalItems = signal(0);
  readonly totalPages = signal(0);
  readonly loading = signal(false);
  readonly loadingSummary = signal(false);
  readonly exporting = signal(false);
  readonly methods = signal<StorePaymentMethodOption[]>([]);
  readonly searchTerm = computed(() => this.state().search ?? '');

  /** Referencia ESTABLE: un literal nuevo por evaluación causaría ticks infinitos. */
  readonly headerPin: HeaderPinConfig = {
    key: PAYMENTS_PIN_FILTER_KEY,
    label: 'Fijar',
  };

  readonly filterConfigs = computed<FilterConfig[]>(() =>
    buildPaymentsFilterConfigs(this.methods(), { withGranularity: false }),
  );

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: this.exporting() ? 'Exportando…' : 'Exportar XLSX',
      icon: 'download',
      action: 'export-xlsx',
      variant: 'outline',
      disabled: this.exporting() || this.loading(),
    },
  ]);

  readonly viewRows = computed<PaymentViewRow[]>(() =>
    this.rows().map((r) => ({
      id: r.id,
      order_id: r.order.id,
      effective_date: r.effective_date,
      order_number: r.order.order_number,
      customer_name: r.customer?.name ?? 'Sin cliente',
      customer_document: r.customer?.document ?? '',
      payment_method: r.payment_method?.display_name ?? 'Sin método',
      state: r.state,
      amount: r.amount,
      refunded_amount: r.refunded_amount,
      net_amount: r.net_amount,
      reference: r.gateway_reference ?? r.transaction_id ?? '',
      register_name: r.cash_register?.register_name ?? '',
      bank_account: r.bank_account?.name ?? '',
      has_receipt: r.has_receipt ? 'Sí' : 'No',
    })),
  );

  readonly growthText = computed(() => {
    const g = this.summary()?.collected_growth;
    if (g === null || g === undefined) return 'Recaudo del período';
    return `${g >= 0 ? '+' : ''}${g.toFixed(1)}% vs período anterior`;
  });

  readonly hasFilters = computed(() => hasActiveFilters(this.state()));

  // ── Config de tabla ─────────────────────────────────────────────────────
  private readonly money = (v: unknown): string =>
    this.currencyService.format(v as number);
  private readonly dash = (v: unknown): string =>
    v === null || v === undefined || v === '' ? '—' : String(v);

  readonly columns: TableColumn[] = [
    {
      key: 'effective_date',
      label: 'Fecha de pago',
      sortable: true,
      priority: 1,
      transform: (v) =>
        v ? formatStoreDateTime(v, this.settingsFacade.timezone()) : '—',
    },
    { key: 'order_number', label: '# Orden', priority: 1, transform: this.dash },
    { key: 'customer_name', label: 'Cliente', priority: 2, transform: this.dash },
    { key: 'customer_document', label: 'Documento', priority: 3, transform: this.dash },
    { key: 'payment_method', label: 'Método', priority: 2, transform: this.dash },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      priority: 1,
      badge: true,
      badgeConfig: PAYMENT_STATE_BADGE,
      // La tabla pinta el texto del badge con `transform`; `badgeTransform` solo lo lee la tarjeta móvil.
      transform: (v) => PAYMENT_STATE_LABELS[v as keyof typeof PAYMENT_STATE_LABELS] ?? String(v),
    },
    { key: 'amount', label: 'Monto', sortable: true, align: 'right', priority: 1, transform: this.money },
    { key: 'refunded_amount', label: 'Reembolsado', align: 'right', priority: 3, transform: this.money },
    { key: 'net_amount', label: 'Neto', align: 'right', priority: 2, transform: this.money },
    { key: 'reference', label: 'Referencia', priority: 3, transform: this.dash },
    { key: 'register_name', label: 'Caja', priority: 3, transform: this.dash },
    { key: 'bank_account', label: 'Cuenta bancaria', priority: 3, transform: this.dash },
    { key: 'has_receipt', label: 'Comprobante', align: 'center', priority: 3 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    titleTransform: (item) => `Orden ${item.order_number}`,
    subtitleKey: 'customer_name',
    badgeKey: 'state',
    badgeConfig: PAYMENT_STATE_BADGE,
    badgeTransform: (v) => PAYMENT_STATE_LABELS[v as keyof typeof PAYMENT_STATE_LABELS] ?? String(v),
    detailKeys: [
      { key: 'amount', label: 'Monto', icon: 'wallet', transform: this.money },
      { key: 'payment_method', label: 'Método', icon: 'credit-card' },
      {
        key: 'effective_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (v) =>
          v ? formatStoreDateTime(v, this.settingsFacade.timezone()) : '—',
      },
      { key: 'net_amount', label: 'Neto', icon: 'receipt', transform: this.money },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Ver orden',
      icon: 'eye',
      variant: 'ghost',
      action: (item: PaymentViewRow) => this.openOrder(item.order_id),
    },
  ];

  // ── Carga ───────────────────────────────────────────────────────────────
  private readonly reload$ = new Subject<void>();
  private lastUrlKey: string | null = null;

  constructor() {
    this.reload$
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(() =>
          this.service.getPayments(this.currentQuery()).pipe(
            catchError((err) => {
              this.toast.error(
                extractApiErrorMessage(err) || 'No se pudieron cargar los pagos',
              );
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.loading.set(false);
        if (!res) {
          this.rows.set([]);
          this.totalItems.set(0);
          this.totalPages.set(0);
          return;
        }
        this.rows.set(res.data ?? []);
        this.totalItems.set(res.meta?.total ?? 0);
        this.totalPages.set(res.meta?.totalPages ?? 0);
      });

    this.reloadSummary$
      .pipe(
        tap(() => this.loadingSummary.set(true)),
        switchMap(() =>
          this.service.getSummary(this.currentQuery()).pipe(
            catchError(() => of(null)),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((s) => {
        this.loadingSummary.set(false);
        this.summary.set(s);
      });

    this.service
      .getStorePaymentMethods()
      .pipe(
        catchError(() => of([] as StorePaymentMethodOption[])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((m) => this.methods.set(m));

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((qp) => this.onUrlChange(qp));
  }

  private readonly reloadSummary$ = new Subject<void>();

  private currentQuery(): PaymentsReportQuery {
    const q = stateToQuery(this.state(), this.page(), this.limit);
    const sort = this.sortBy();
    if (sort) {
      q.sort_by = sort;
      q.sort_order = this.sortOrder();
    }
    return q;
  }

  private reloadAll(): void {
    this.reload$.next();
    this.reloadSummary$.next();
  }

  // ── URL <-> estado ──────────────────────────────────────────────────────
  private onUrlChange(qp: ParamMap): void {
    let next: PaymentsFilterState;
    let restored = false;

    if (paymentsUrlHasNoFilters(qp) && this.lastUrlKey === null) {
      const saved = this.readPinned();
      if (saved) {
        next = this.sanitizePinned(saved);
        restored = true;
      } else {
        next = queryParamsToState(qp);
      }
    } else {
      next = queryParamsToState(qp);
    }

    const key = JSON.stringify(next);
    const changed = key !== this.lastUrlKey;
    this.lastUrlKey = key;

    this.state.set(next);
    if (restored) this.pinned.set(true);
    this.filterValues.set({
      ...stateToFilterValues(next),
      [PAYMENTS_PIN_FILTER_KEY]: this.pinned() ? 'true' : null,
    });

    if (restored) {
      // Refleja el set fijado en la URL (dispara otra emisión ya con filtros).
      this.updateUrl(next);
      return;
    }
    if (changed) this.page.set(1);
    this.reloadAll();
  }

  private updateUrl(state: PaymentsFilterState): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: stateToUrlPatch(state),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ── Pin ─────────────────────────────────────────────────────────────────
  private pinKey(): string | null {
    return buildPinnedFiltersKey(
      REPORT_PIN_PREFIX,
      this.authFacade.userStore()?.id,
    );
  }

  private readPinned(): PaymentsFilterState | null {
    return readPinnedFilters<PaymentsFilterState>(this.pinKey());
  }

  /** Valida el snapshot guardado pasándolo por el parser de URL. */
  private sanitizePinned(saved: PaymentsFilterState): PaymentsFilterState {
    return queryParamsToState(
      convertToParamMap(
        stateToQueryParams({ ...defaultPaymentsFilterState(), ...saved }),
      ),
    );
  }

  private persistPin(): void {
    persistPinnedFilters(this.pinKey(), this.pinned() ? this.state() : null);
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  onSearchChange(term: string): void {
    const value = (term ?? '').trim();
    if (value === (this.state().search ?? '')) return;
    const next: PaymentsFilterState = { ...this.state() };
    if (value) next.search = value;
    else delete next.search;
    this.applyState(next);
  }

  onFilterChange(values: FilterValues): void {
    this.pinned.set(values[PAYMENTS_PIN_FILTER_KEY] === 'true');
    this.applyState(filterValuesToState(values, this.state()));
  }

  onClearAll(): void {
    this.pinned.set(false);
    this.applyState(defaultPaymentsFilterState());
  }

  private applyState(next: PaymentsFilterState): void {
    this.state.set(next);
    this.page.set(1);
    this.filterValues.set({
      ...stateToFilterValues(next),
      [PAYMENTS_PIN_FILTER_KEY]: this.pinned() ? 'true' : null,
    });
    this.persistPin();
    // La URL es la fuente: al cambiar, `queryParamMap` re-emite y recarga.
    this.updateUrl(next);
  }

  onSort(event: { column: string; direction: SortDirection }): void {
    if (!event.direction) {
      this.sortBy.set(null);
      this.sortOrder.set('desc');
    } else {
      this.sortBy.set(event.column as PaymentsSortBy);
      this.sortOrder.set(event.direction);
    }
    this.page.set(1);
    this.reload$.next();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.reload$.next();
  }

  onActionClick(action: string): void {
    if (action === 'export-xlsx') this.exportXlsx();
  }

  openOrder(orderId: number): void {
    void this.router.navigate(['/admin/orders', orderId]);
  }

  onRowClick(row: PaymentViewRow): void {
    this.openOrder(row.order_id);
  }

  private exportXlsx(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    // Dataset completo: sin page/limit (el export trae todo el rango con tope).
    const query = this.currentQuery();
    delete query.page;
    delete query.limit;
    this.service
      .exportPayments(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          this.exportService.downloadBlob(
            blob,
            `reporte_pagos_${storeToday(this.settingsFacade.timezone())}`,
          );
        },
        error: (err) => {
          this.exporting.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo exportar el reporte',
          );
        },
      });
  }

  formatMoney(v: number | null | undefined): string {
    return this.currencyService.format(v ?? 0);
  }
}
