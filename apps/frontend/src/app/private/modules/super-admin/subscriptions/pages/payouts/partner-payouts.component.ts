import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import {
  PartnerPayout,
  SubscriptionPaymentRow,
} from '../../interfaces/subscription-admin.interface';
import { environment } from '../../../../../../../environments/environment';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-partner-payouts',
  standalone: true,
  imports: [
    StatsComponent,
    ButtonComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    CardComponent,
    EmptyStateComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <!-- Sub-Tab Toggle -->
      <div class="flex border-b border-border mb-6">
        <button
          type="button"
          class="pb-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer"
          [class.border-primary]="viewMode() === 'subscription_payments'"
          [class.text-primary]="viewMode() === 'subscription_payments'"
          [class.border-transparent]="viewMode() !== 'subscription_payments'"
          [class.text-text-secondary]="viewMode() !== 'subscription_payments'"
          (click)="setViewMode('subscription_payments')"
        >
          <app-icon name="credit-card" [size]="16"></app-icon>
          Pagos de suscripción
        </button>
        <button
          type="button"
          class="pb-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer"
          [class.border-primary]="viewMode() === 'partner_payouts'"
          [class.text-primary]="viewMode() === 'partner_payouts'"
          [class.border-transparent]="viewMode() !== 'partner_payouts'"
          [class.text-text-secondary]="viewMode() !== 'partner_payouts'"
          (click)="setViewMode('partner_payouts')"
        >
          <app-icon name="users" [size]="16"></app-icon>
          Liquidaciones a partners
        </button>
      </div>

      <!-- VIEW 1: Pagos de Suscripción (Default) -->
      @if (viewMode() === 'subscription_payments') {
        <!-- Stats -->
        <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Total pagos"
            [value]="paymentsPagination().total"
            iconName="credit-card"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>
          <app-stats
            title="Exitosos"
            [value]="paymentsSucceededCount()"
            iconName="check"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>
          <app-stats
            title="Fallidos"
            [value]="paymentsFailedCount()"
            iconName="alert-triangle"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
          ></app-stats>
          <app-stats
            title="Recaudo total"
            [value]="paymentsTotalAmount() | currency"
            iconName="wallet"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>
        </div>

        <div class="md:space-y-4">
          <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
            <!-- Search & Filters Section -->
            <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
              <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
                <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                  Transacciones de pago <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ paymentsPagination().total }})</span>
                </h2>
                <div class="flex items-center gap-2 w-full md:w-auto justify-end">
                  <app-inputsearch
                    class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                    size="sm"
                    placeholder="Buscar por tienda, factura o referencia..."
                    [debounceTime]="500"
                    (searchChange)="onPaymentsSearch($event)"
                  />
                  <app-options-dropdown
                    [filters]="paymentFilters()"
                    [filterValues]="paymentFilterValues()"
                    [showActions]="false"
                    triggerLabel="Filtros"
                    triggerIcon="sliders-horizontal"
                    (filterChange)="onPaymentFilterChange($event)"
                    (clearAllFilters)="onClearPaymentFilters()"
                  />
                  <app-button
                    variant="outline"
                    size="md"
                    customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                    (clicked)="loadSubscriptionPayments()"
                    title="Refrescar"
                  >
                    <app-icon slot="icon" name="refresh-cw" [size]="18"></app-icon>
                  </app-button>
                </div>
              </div>
            </div>

            <!-- Loading -->
            @if (paymentsLoading()) {
              <div class="p-4 md:p-6 text-center">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p class="mt-2 text-text-secondary">Cargando pagos...</p>
              </div>
            }

            <!-- Empty -->
            @if (!paymentsLoading() && payments().length === 0) {
              <app-empty-state
                icon="dollar-sign"
                title="No hay pagos de suscripción"
                description="No se encontraron pagos con los filtros aplicados."
                [showActionButton]="false"
              ></app-empty-state>
            }

            <!-- Data View + Pagination -->
            @if (!paymentsLoading() && payments().length > 0) {
              <div class="px-2 pb-2 pt-3 md:p-4">
                <app-responsive-data-view
                  [data]="transformedPayments()"
                  [columns]="paymentColumns"
                  [cardConfig]="paymentCardConfig"
                  [actions]="paymentActions"
                  [loading]="paymentsLoading()"
                />
                @if (paymentsPagination().totalPages > 1) {
                  <div class="mt-4 flex justify-center">
                    <app-pagination
                      [currentPage]="paymentsPagination().page"
                      [totalPages]="paymentsPagination().totalPages"
                      [total]="paymentsPagination().total"
                      [limit]="paymentsPagination().limit"
                      infoStyle="none"
                      (pageChange)="changePaymentsPage($event)"
                    />
                  </div>
                }
              </div>
            }
          </app-card>
        </div>
      }

      <!-- VIEW 2: Liquidaciones a Partners -->
      @if (viewMode() === 'partner_payouts') {
        <!-- Stats -->
        <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Pagos pendientes"
            [value]="pendingCount()"
            iconName="clock"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
          ></app-stats>
          <app-stats
            title="Pagos aprobados"
            [value]="approvedCount()"
            iconName="check"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>
          <app-stats
            title="Pagos pagados"
            [value]="paidCount()"
            iconName="banknote"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>
          <app-stats
            title="Monto total"
            [value]="totalAmount() | currency"
            iconName="wallet"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>
        </div>

        <div class="md:space-y-4">
          <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
            <!-- Header Section -->
            <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
              <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
                <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                  Lotes de liquidación a partners <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
                </h2>
                <div class="flex items-center gap-2 w-full md:w-auto justify-end">
                  <app-button
                    variant="outline"
                    size="md"
                    customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                    (clicked)="loadPayouts()"
                    title="Refrescar"
                  >
                    <app-icon slot="icon" name="refresh-cw" [size]="18"></app-icon>
                  </app-button>
                </div>
              </div>
            </div>

            <!-- Loading -->
            @if (loading()) {
              <div class="p-4 md:p-6 text-center">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p class="mt-2 text-text-secondary">Cargando liquidaciones...</p>
              </div>
            }

            <!-- Empty -->
            @if (!loading() && payouts().length === 0) {
              <app-empty-state
                icon="dollar-sign"
                title="No hay liquidaciones"
                description="No hay lotes de liquidación pendientes para partners."
                [showActionButton]="false"
              ></app-empty-state>
            }

            <!-- Data View + Pagination -->
            @if (!loading() && payouts().length > 0) {
              <div class="px-2 pb-2 pt-3 md:p-4">
                <app-responsive-data-view
                  [data]="payouts()"
                  [columns]="columns"
                  [cardConfig]="cardConfig"
                  [actions]="actions"
                  [loading]="loading()"
                />
                @if (pagination().totalPages > 1) {
                  <div class="mt-4 flex justify-center">
                    <app-pagination
                      [currentPage]="pagination().page"
                      [totalPages]="pagination().totalPages"
                      [total]="pagination().total"
                      [limit]="pagination().limit"
                      infoStyle="none"
                      (pageChange)="changePage($event)"
                    />
                  </div>
                }
              </div>
            }
          </app-card>
        </div>
      }
    </div>
  `,
})
export class PartnerPayoutsComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  readonly router = inject(Router);

  // View mode: defaults to 'subscription_payments' as requested by user
  readonly viewMode = signal<'subscription_payments' | 'partner_payouts'>('subscription_payments');

  // Subscription Payments State
  readonly payments = signal<SubscriptionPaymentRow[]>([]);
  readonly paymentsLoading = signal(false);
  readonly paymentsSearch = signal('');
  readonly paymentsState = signal('');
  readonly paymentsSucceededCount = signal(0);
  readonly paymentsFailedCount = signal(0);
  readonly paymentsTotalAmount = signal(0);

  readonly paymentsPagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  readonly paymentFilterValues = computed<FilterValues>(() => ({
    state: this.paymentsState(),
  }));

  readonly paymentFilters = computed<FilterConfig[]>(() => [
    {
      key: 'state',
      label: 'Estado del pago',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'succeeded', label: 'Exitoso' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'failed', label: 'Fallido' },
        { value: 'refunded', label: 'Reembolsado' },
      ],
      defaultValue: '',
    },
  ]);

  // Transformed payment rows for table compatibility
  readonly transformedPayments = computed(() => {
    return this.payments().map((p) => ({
      ...p,
      store_name: p.invoice?.store?.name ?? '—',
      organization_name: p.invoice?.organization?.name ?? '—',
      plan_name: p.invoice?.plan?.name ?? '—',
      invoice_number: p.invoice?.invoice_number ?? `#${p.invoice_id}`,
      payment_date: p.paid_at || p.created_at,
    }));
  });

  paymentColumns: TableColumn[] = [
    { key: 'store_name', label: 'Tienda', sortable: true, width: '180px', priority: 1 },
    { key: 'invoice_number', label: 'Factura', sortable: true, width: '140px', priority: 1 },
    { key: 'plan_name', label: 'Plan', sortable: true, width: '140px', priority: 2 },
    { key: 'amount', label: 'Monto', sortable: true, width: '120px', align: 'right', priority: 1 },
    { key: 'provider', label: 'Pasarela', sortable: true, width: '110px', priority: 3 },
    { key: 'provider_reference', label: 'Referencia', sortable: false, width: '150px', priority: 3 },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      width: '110px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          succeeded: '#22c55e',
          pending: '#f59e0b',
          failed: '#ef4444',
          refunded: '#6b7280',
        },
      },
    },
    { key: 'payment_date', label: 'Fecha', sortable: true, width: '130px', priority: 2 },
  ];

  paymentActions: TableAction[] = [
    {
      label: 'Copiar Ref.',
      icon: 'copy',
      variant: 'secondary',
      action: (item: any) => {
        if (item.provider_reference) {
          navigator.clipboard.writeText(item.provider_reference);
          this.toast.success('Referencia copiada al portapapeles');
        }
      },
    },
  ];

  paymentCardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    subtitleKey: 'invoice_number',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        succeeded: '#22c55e',
        pending: '#f59e0b',
        failed: '#ef4444',
        refunded: '#6b7280',
      },
    },
    detailKeys: [
      { key: 'amount', label: 'Monto' },
      { key: 'provider', label: 'Pasarela' },
      { key: 'provider_reference', label: 'Ref.' },
      { key: 'payment_date', label: 'Fecha' },
    ],
  };

  // Partner Payouts State
  readonly payouts = signal<PartnerPayout[]>([]);
  readonly loading = signal(false);
  readonly pendingCount = signal(0);
  readonly approvedCount = signal(0);
  readonly paidCount = signal(0);
  readonly totalAmount = signal(0);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  columns: TableColumn[] = [
    { key: 'partner_name', label: 'Partner', sortable: true, width: '200px', priority: 1 },
    { key: 'period_start', label: 'Inicio periodo', sortable: true, width: '130px', priority: 3 },
    { key: 'period_end', label: 'Fin periodo', sortable: true, width: '130px', priority: 3 },
    { key: 'total_amount', label: 'Monto total', sortable: true, width: '120px', align: 'right', priority: 1 },
    { key: 'store_count', label: 'Tiendas', sortable: true, width: '80px', align: 'center', priority: 2 },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      width: '110px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pending: '#f59e0b',
          approved: '#3b82f6',
          rejected: '#ef4444',
          paid: '#22c55e',
        },
      },
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Detalle',
      icon: 'eye',
      variant: 'info',
      action: (item: PartnerPayout) => this.router.navigate(['/super-admin/subscriptions/payouts', item.id]),
    },
    {
      label: 'Aprobar',
      icon: 'check',
      variant: 'success',
      show: (item: PartnerPayout) => item.status === 'pending',
      action: (item: PartnerPayout) => this.approvePayout(item.id),
    },
    {
      label: 'Rechazar',
      icon: 'x',
      variant: 'danger',
      show: (item: PartnerPayout) => item.status === 'pending',
      action: (item: PartnerPayout) => this.rejectPayout(item.id),
    },
    {
      label: 'Marcar pagado',
      icon: 'banknote',
      variant: 'primary',
      show: (item: PartnerPayout) => item.status === 'approved',
      action: (item: PartnerPayout) => this.markAsPaid(item.id),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'partner_name',
    subtitleKey: 'period_start',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        pending: '#f59e0b',
        approved: '#3b82f6',
        rejected: '#ef4444',
        paid: '#22c55e',
      },
    },
    detailKeys: [
      { key: 'total_amount', label: 'Monto total' },
      { key: 'store_count', label: 'Tiendas' },
      { key: 'period_end', label: 'Fin periodo' },
    ],
  };

  constructor() {
    this.loadSubscriptionPayments();
  }

  setViewMode(mode: 'subscription_payments' | 'partner_payouts'): void {
    this.viewMode.set(mode);
    if (mode === 'subscription_payments') {
      if (this.payments().length === 0) {
        this.loadSubscriptionPayments();
      }
    } else {
      if (this.payouts().length === 0) {
        this.loadPayouts();
      }
    }
  }

  loadSubscriptionPayments(): void {
    this.paymentsLoading.set(true);
    const pag = this.paymentsPagination();
    this.service
      .getSubscriptionPayments({
        page: pag.page,
        limit: pag.limit,
        search: this.paymentsSearch(),
        state: this.paymentsState(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.payments.set(res.data);
            this.paymentsPagination.update((p) => ({
              ...p,
              total: res.meta.total,
              totalPages: res.meta.totalPages,
            }));
            this.computePaymentStats(res.data);
          }
          this.paymentsLoading.set(false);
        },
        error: () => this.paymentsLoading.set(false),
      });
  }

  computePaymentStats(data: SubscriptionPaymentRow[]): void {
    this.paymentsSucceededCount.set(data.filter((p) => p.state === 'succeeded').length);
    this.paymentsFailedCount.set(data.filter((p) => p.state === 'failed').length);
    this.paymentsTotalAmount.set(
      data.filter((p) => p.state === 'succeeded').reduce((sum, p) => sum + Number(p.amount || 0), 0),
    );
  }

  onPaymentsSearch(term: string): void {
    this.paymentsSearch.set(term);
    this.paymentsPagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptionPayments();
  }

  onPaymentFilterChange(values: FilterValues): void {
    const stateVal = typeof values['state'] === 'string' ? values['state'] : '';
    this.paymentsState.set(stateVal);
    this.paymentsPagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptionPayments();
  }

  onClearPaymentFilters(): void {
    this.paymentsState.set('');
    this.paymentsPagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptionPayments();
  }

  changePaymentsPage(page: number): void {
    this.paymentsPagination.update((p) => ({ ...p, page }));
    this.loadSubscriptionPayments();
  }

  loadPayouts(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getPayouts({ page: pag.page, limit: pag.limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.payouts.set(res.data);
            this.pagination.update((p) => ({
              ...p,
              total: res.meta.total,
              totalPages: res.meta.totalPages,
            }));
            this.computeStats(res.data);
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  computeStats(data: PartnerPayout[]): void {
    this.pendingCount.set(data.filter((p) => p.status === 'pending').length);
    this.approvedCount.set(data.filter((p) => p.status === 'approved').length);
    this.paidCount.set(data.filter((p) => p.status === 'paid').length);
    this.totalAmount.set(data.reduce((sum, p) => sum + p.total_amount, 0));
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadPayouts();
  }

  approvePayout(id: string): void {
    this.service
      .approvePayout(id, { status: 'approved' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.toast.success('Pago aprobado');
            this.loadPayouts();
          }
        },
        error: () => this.toast.error('Error al aprobar el pago'),
      });
  }

  rejectPayout(id: string): void {
    const reason = window.prompt('Motivo del rechazo (mínimo 3 caracteres):');
    if (!reason || reason.trim().length < 3) {
      this.toast.error('Motivo requerido (mínimo 3 caracteres)');
      return;
    }
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/payouts/${id}/reject`, { reason: reason.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Pago rechazado');
          this.loadPayouts();
        },
        error: () => this.toast.error('Error al rechazar el pago'),
      });
  }

  markAsPaid(id: string): void {
    this.http
      .patch(`${environment.apiUrl}/superadmin/subscriptions/payouts/${id}/pay`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Pago marcado como pagado');
          this.loadPayouts();
        },
        error: () => this.toast.error('Error al marcar como pagado'),
      });
  }
}
