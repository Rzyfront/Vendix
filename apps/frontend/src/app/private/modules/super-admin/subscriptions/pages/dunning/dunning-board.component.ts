import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import {
  DunningSubscription,
  StoreSubscription,
} from '../../interfaces/subscription-admin.interface';
import {
  StatsComponent,
  ButtonComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  PaginationComponent,
  CardComponent,
  EmptyStateComponent,
  InputsearchComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { environment } from '../../../../../../../environments/environment';
import { DunningPreviewModalComponent } from '../../components/dunning-preview-modal.component';
import { DunningPreviewTargetState } from '../../interfaces/subscription-admin.interface';
import { SubscriptionDetailModalComponent } from '../../components/subscription-detail-modal/subscription-detail-modal.component';

@Component({
  selector: 'app-dunning-board',
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
    DunningPreviewModalComponent,
    SubscriptionDetailModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="En gracia"
          [value]="graceCount()"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Suspendidas"
          [value]="suspendedCount()"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
        <app-stats
          title="Pendiente de pago"
          [value]="pendingPaymentCount()"
          iconName="hourglass"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        <app-stats
          title="Total en mora"
          [value]="totalOverdue() | currency"
          iconName="banknote"
          iconBgColor="bg-orange-100"
          iconColor="text-orange-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search & Filter Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Cobranza / Dunning <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar en cobranza..."
                  [debounceTime]="500"
                  (searchChange)="onSearch($event)"
                />
                <app-options-dropdown
                  [filters]="filters()"
                  [filterValues]="filterValues()"
                  [showActions]="false"
                  triggerLabel="Filtros"
                  triggerIcon="sliders-horizontal"
                  (filterChange)="onFilterChange($event)"
                  (clearAllFilters)="onClearAllFilters()"
                />
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="loadDunning()"
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
              <p class="mt-2 text-text-secondary">Cargando...</p>
            </div>
          }

          <!-- Empty -->
          @if (!loading() && dunning().length === 0) {
            <app-empty-state
              icon="alert-circle"
              title="No hay suscripciones en cobranza"
              description="Ninguna suscripción coincide con los filtros aplicados."
              [showActionButton]="false"
            ></app-empty-state>
          }

          <!-- Data View + Pagination -->
          @if (!loading() && dunning().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="dunning()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [loading]="loading()"
                (rowClick)="openDetail($event, 'general')"
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
    </div>

    <!-- Force-transition preview modal (S4.1) -->
    <app-dunning-preview-modal
      [isOpen]="previewOpen()"
      [subscriptionId]="previewSubscriptionId()"
      [targetState]="previewTargetState()"
      (closed)="closePreview()"
      (confirmed)="confirmTransition($event)"
    />

    <!-- Comprehensive Subscription Detail Modal -->
    <app-subscription-detail-modal
      [isOpen]="isDetailModalOpen()"
      [subscription]="selectedSubscription()"
      [initialTab]="detailModalTab()"
      (closed)="isDetailModalOpen.set(false)"
    />
  `,
})
export class DunningBoardComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  readonly dunning = signal<DunningSubscription[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly selectedState = signal('');

  // Stats signals
  readonly graceCount = signal(0);
  readonly suspendedCount = signal(0);
  readonly pendingPaymentCount = signal(0);
  readonly totalOverdue = signal(0);

  // Detail Modal signals
  readonly isDetailModalOpen = signal(false);
  readonly selectedSubscription = signal<StoreSubscription | null>(null);
  readonly detailModalTab = signal<'general' | 'events'>('general');

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  readonly filterValues = computed<FilterValues>(() => ({
    state: this.selectedState(),
  }));

  readonly filters = computed<FilterConfig[]>(() => [
    {
      key: 'state',
      label: 'Estado de cobranza',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'grace', label: 'En gracia (Soft / Hard)' },
        { value: 'pending_payment', label: 'Pendiente de pago' },
        { value: 'suspended', label: 'Suspendida' },
        { value: 'blocked', label: 'Bloqueada' },
      ],
      defaultValue: '',
    },
  ]);

  // S4.1 — Force-transition preview modal state.
  readonly previewOpen = signal(false);
  readonly previewSubscriptionId = signal<string | null>(null);
  readonly previewTargetState = signal<DunningPreviewTargetState>('cancelled');

  columns: TableColumn[] = [
    { key: 'store_name', label: 'Tienda', sortable: true, width: '200px', priority: 1 },
    { key: 'organization_name', label: 'Organización', sortable: true, width: '200px', priority: 2 },
    { key: 'plan_name', label: 'Plan', sortable: true, width: '150px', priority: 2 },
    { key: 'price', label: 'Monto', sortable: true, width: '120px', align: 'right', priority: 2 },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      width: '120px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          grace: '#f59e0b',
          suspended: '#ef4444',
          blocked: '#b91c1c',
          pending_payment: '#8b5cf6',
        },
      },
    },
    { key: 'days_overdue', label: 'Días en mora', sortable: true, width: '120px', align: 'center', priority: 1 },
    { key: 'payment_attempts', label: 'Intentos', sortable: true, width: '100px', align: 'center', priority: 3 },
  ];

  actions: TableAction[] = [
    {
      label: 'Detalle',
      icon: 'eye',
      variant: 'primary',
      action: (item: DunningSubscription) => this.openDetail(item, 'general'),
    },
    {
      label: 'Eventos',
      icon: 'activity',
      variant: 'info',
      action: (item: DunningSubscription) => this.openDetail(item, 'events'),
    },
    {
      label: 'Recordar',
      icon: 'bell',
      variant: 'secondary',
      action: (item: DunningSubscription) => this.sendReminder(item.id),
    },
    {
      label: 'Reintentar pago',
      icon: 'refresh-cw',
      variant: 'primary',
      action: (item: DunningSubscription) => this.retryPayment(item.id),
    },
    {
      label: 'Cancelar',
      icon: 'x-circle',
      variant: 'danger',
      action: (item: DunningSubscription) => this.cancelSubscription(item.id),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    subtitleKey: 'organization_name',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        grace: '#f59e0b',
        suspended: '#ef4444',
        blocked: '#b91c1c',
        pending_payment: '#8b5cf6',
      },
    },
    detailKeys: [
      { key: 'plan_name', label: 'Plan' },
      { key: 'days_overdue', label: 'Días en mora' },
      { key: 'payment_attempts', label: 'Intentos' },
    ],
  };

  constructor() {
    this.loadStats();
    this.loadDunning();
  }

  loadStats(): void {
    this.service
      .getDunningStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            const d = res.data;
            this.graceCount.set(d.grace_soft + d.grace_hard);
            this.suspendedCount.set(d.suspended + d.blocked);
            this.pendingPaymentCount.set(d.pending_payment ?? 0);
            this.totalOverdue.set(d.total_overdue ?? 0);
          }
        },
        error: () => {},
      });
  }

  loadDunning(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getDunningSubscriptions({
        page: pag.page,
        limit: pag.limit,
        search: this.searchTerm(),
        state: this.selectedState(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.dunning.set(res.data);
            this.pagination.update((p) => ({
              ...p,
              total: res.meta.total,
              totalPages: res.meta.totalPages,
            }));
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  openDetail(item: DunningSubscription, tab: 'general' | 'events' = 'general'): void {
    const subObj: StoreSubscription = {
      id: item.id,
      store_id: item.store_id,
      store_name: item.store_name,
      organization_name: item.organization_name,
      plan_name: item.plan_name,
      billing_cycle: 'monthly',
      price: item.price,
      currency_code: item.currency_code,
      state: item.status,
      status: item.status === 'grace' ? 'grace' : 'suspended',
      current_period_start: '',
      current_period_end: item.current_period_end,
      grace_period_end: item.grace_period_end,
      auto_renew: true,
      partner_id: null,
      partner_margin_amount: 0,
      created_at: '',
    };
    this.selectedSubscription.set(subObj);
    this.detailModalTab.set(tab);
    this.isDetailModalOpen.set(true);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadDunning();
  }

  onFilterChange(values: FilterValues): void {
    const stateVal = typeof values['state'] === 'string' ? values['state'] : '';
    this.selectedState.set(stateVal);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadDunning();
  }

  onClearAllFilters(): void {
    this.selectedState.set('');
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadDunning();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadDunning();
  }

  sendReminder(id: string): void {
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/dunning/${id}/remind`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toast.success('Recordatorio enviado'),
        error: () => this.toast.error('Error al enviar recordatorio'),
      });
  }

  retryPayment(id: string): void {
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/dunning/${id}/retry-payment`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Reintento de pago en cola');
          this.loadDunning();
        },
        error: () => this.toast.error('Error al encolar reintento'),
      });
  }

  cancelSubscription(id: string): void {
    this.openPreview(id, 'cancelled');
  }

  openPreview(id: string, target: DunningPreviewTargetState): void {
    this.previewSubscriptionId.set(id);
    this.previewTargetState.set(target);
    this.previewOpen.set(true);
  }

  closePreview(): void {
    this.previewOpen.set(false);
    this.previewSubscriptionId.set(null);
  }

  confirmTransition(target: DunningPreviewTargetState): void {
    const id = this.previewSubscriptionId();
    if (!id) return;

    if (target === 'cancelled') {
      this.http
        .post(
          `${environment.apiUrl}/superadmin/subscriptions/dunning/${id}/cancel`,
          {},
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toast.success('Suscripción cancelada');
            this.closePreview();
            this.loadDunning();
            this.loadStats();
          },
          error: () => {
            this.toast.error('Error al cancelar');
            this.closePreview();
          },
        });
      return;
    }

    this.toast.error(`Transición a "${target}" no está soportada todavía.`);
    this.closePreview();
  }
}
