import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { StoreSubscription } from '../../interfaces/subscription-admin.interface';
import {
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  PaginationComponent,
  CardComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { SubscriptionDetailModalComponent } from '../../components/subscription-detail-modal/subscription-detail-modal.component';

@Component({
  selector: 'app-active-subscriptions',
  standalone: true,
  imports: [
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    CardComponent,
    EmptyStateComponent,
    OptionsDropdownComponent,
    SubscriptionDetailModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total"
          [value]="pagination().total"
          iconName="credit-card"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activas"
          [value]="activeCount()"
          iconName="check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Gracia"
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
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search & Dropdown Filters Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Suscripciones por tienda <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar suscripciones..."
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
          @if (!loading() && subscriptions().length === 0) {
            <app-empty-state
              icon="credit-card"
              title="No hay suscripciones"
              description="Ninguna suscripción coincide con los filtros."
              [showActionButton]="false"
            ></app-empty-state>
          }

          <!-- Data View + Pagination -->
          @if (!loading() && subscriptions().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="subscriptions()"
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

      <!-- Unified Detail and Events Modal -->
      <app-subscription-detail-modal
        [isOpen]="isDetailModalOpen()"
        [subscription]="selectedSubscription()"
        [initialTab]="detailModalTab()"
        (closed)="isDetailModalOpen.set(false)"
      />
    </div>
  `,
})
export class ActiveSubscriptionsComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);

  readonly subscriptions = signal<StoreSubscription[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly selectedState = signal('');
  readonly selectedPlanId = signal('');
  readonly selectedBillingCycle = signal('');
  readonly activeCount = signal(0);
  readonly graceCount = signal(0);
  readonly suspendedCount = signal(0);

  // Modal signals
  readonly isDetailModalOpen = signal(false);
  readonly selectedSubscription = signal<StoreSubscription | null>(null);
  readonly detailModalTab = signal<'general' | 'events'>('general');

  // Dynamic plan options
  readonly planOptions = signal<Array<{ value: string; label: string }>>([
    { value: '', label: 'Todos los planes' },
  ]);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  readonly filterValues = computed<FilterValues>(() => ({
    state: this.selectedState(),
    plan_id: this.selectedPlanId(),
    billing_cycle: this.selectedBillingCycle(),
  }));

  readonly filters = computed<FilterConfig[]>(() => [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'active', label: 'Activa' },
        { value: 'grace', label: 'Período de gracia' },
        { value: 'pending_payment', label: 'Pendiente de pago' },
        { value: 'suspended', label: 'Suspendida' },
        { value: 'blocked', label: 'Bloqueada' },
        { value: 'cancelled', label: 'Cancelada' },
        { value: 'trial', label: 'Prueba' },
      ],
      defaultValue: '',
    },
    {
      key: 'plan_id',
      label: 'Plan',
      type: 'select',
      options: this.planOptions(),
      defaultValue: '',
    },
    {
      key: 'billing_cycle',
      label: 'Ciclo de facturación',
      type: 'select',
      options: [
        { value: '', label: 'Todos los ciclos' },
        { value: 'monthly', label: 'Mensual' },
        { value: 'quarterly', label: 'Trimestral' },
        { value: 'semiannual', label: 'Semestral' },
        { value: 'annual', label: 'Anual' },
        { value: 'lifetime', label: 'De por vida' },
      ],
      defaultValue: '',
    },
  ]);

  columns: TableColumn[] = [
    { key: 'store_name', label: 'Tienda', sortable: true, width: '200px', priority: 1 },
    { key: 'organization_name', label: 'Organización', sortable: true, width: '200px', priority: 2 },
    { key: 'plan_name', label: 'Plan', sortable: true, width: '150px', priority: 2 },
    { key: 'billing_cycle', label: 'Ciclo', sortable: true, width: '100px', priority: 3 },
    { key: 'price', label: 'Precio', sortable: true, width: '120px', align: 'right', priority: 2 },
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
          active: '#22c55e',
          grace: '#f59e0b',
          suspended: '#ef4444',
          blocked: '#b91c1c',
          pending_payment: '#8b5cf6',
          cancelled: '#6b7280',
          trial: '#3b82f6',
        },
      },
    },
    { key: 'current_period_end', label: 'Fin del periodo', sortable: true, width: '130px', priority: 3 },
  ];

  actions: TableAction[] = [
    {
      label: 'Detalle',
      icon: 'eye',
      variant: 'primary',
      action: (item: StoreSubscription) => this.openDetail(item, 'general'),
    },
    {
      label: 'Eventos',
      icon: 'activity',
      variant: 'info',
      action: (item: StoreSubscription) => this.openDetail(item, 'events'),
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
        active: '#22c55e',
        grace: '#f59e0b',
        suspended: '#ef4444',
        blocked: '#b91c1c',
        pending_payment: '#8b5cf6',
        cancelled: '#6b7280',
        trial: '#3b82f6',
      },
    },
    detailKeys: [
      { key: 'plan_name', label: 'Plan' },
      { key: 'billing_cycle', label: 'Ciclo' },
      { key: 'price', label: 'Precio' },
      { key: 'current_period_end', label: 'Termina' },
    ],
  };

  constructor() {
    this.loadPlans();
    this.loadSubscriptions();
  }

  loadPlans(): void {
    this.service
      .getPlans({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.data) {
            const opts = [
              { value: '', label: 'Todos los planes' },
              ...res.data.map((p) => ({ value: String(p.id), label: p.name })),
            ];
            this.planOptions.set(opts);
          }
        },
      });
  }

  loadSubscriptions(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getStoreSubscriptions({
        page: pag.page,
        limit: pag.limit,
        search: this.searchTerm(),
        state: this.selectedState(),
        plan_id: this.selectedPlanId(),
        billing_cycle: this.selectedBillingCycle(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.subscriptions.set(res.data);
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

  computeStats(data: StoreSubscription[]): void {
    this.activeCount.set(data.filter((s) => s.status === 'active').length);
    this.graceCount.set(data.filter((s) => s.status === 'grace').length);
    this.suspendedCount.set(
      data.filter((s) => s.status === 'suspended' || s.state === 'blocked').length,
    );
  }

  openDetail(item: StoreSubscription, tab: 'general' | 'events' = 'general'): void {
    this.selectedSubscription.set(item);
    this.detailModalTab.set(tab);
    this.isDetailModalOpen.set(true);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptions();
  }

  onFilterChange(values: FilterValues): void {
    const stateVal = typeof values['state'] === 'string' ? values['state'] : '';
    const planVal = typeof values['plan_id'] === 'string' ? values['plan_id'] : '';
    const cycleVal = typeof values['billing_cycle'] === 'string' ? values['billing_cycle'] : '';

    this.selectedState.set(stateVal);
    this.selectedPlanId.set(planVal);
    this.selectedBillingCycle.set(cycleVal);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptions();
  }

  onClearAllFilters(): void {
    this.selectedState.set('');
    this.selectedPlanId.set('');
    this.selectedBillingCycle.set('');
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptions();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadSubscriptions();
  }
}
