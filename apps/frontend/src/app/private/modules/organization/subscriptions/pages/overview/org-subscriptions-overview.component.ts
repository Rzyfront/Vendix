import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  EmptyStateComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { TenantFacade } from '../../../../../../core/store/tenant/tenant.facade';
import { OrgSubscriptionsService } from '../../services/org-subscriptions.service';
import {
  StoreSubscription,
  SubscriptionOverviewStats,
} from '../../interfaces/org-subscription.interface';

@Component({
  selector: 'app-org-subscriptions-overview',
  standalone: true,
  imports: [
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full">
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Tiendas Activas"
          [value]="stats().active_stores"
          smallText="Con suscripción"
          iconName="building"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Suscripciones Activas"
          [value]="stats().active_subscriptions"
          smallText="Vigentes"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Ingresos del Mes"
          [value]="formatCurrency(stats().monthly_revenue)"
          smallText="Total"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        @if (isPartner()) {
          <app-stats
            title="Comisiones Partner"
            [value]="formatCurrency(stats().partner_commissions)"
            smallText="Acumuladas"
            iconName="percent"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
          ></app-stats>
        }
      </div>

      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
               md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Tiendas Suscritas ({{ subscriptions().length }})
          </h2>
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar tienda..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
          </div>
        </div>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando suscripciones...</p>
        </div>
      }

      @if (!loading() && subscriptions().length === 0) {
        <app-empty-state
          icon="credit-card"
          title="Sin suscripciones"
          description="No hay tiendas con suscripción activa"
        ></app-empty-state>
      }

      @if (!loading() && subscriptions().length > 0) {
        <div class="bg-surface rounded-card shadow-card border border-border md:min-h-[600px]">
          <div class="p-2 md:p-4">
            <app-responsive-data-view
              [data]="filteredSubscriptions()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="loading()"
              (rowClick)="viewStoreDetail($event)"
            ></app-responsive-data-view>
          </div>
        </div>
      }
    </div>
  `,
})
export class OrgSubscriptionsOverviewComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);
  private tenantFacade = inject(TenantFacade);
  private orgSubsService = inject(OrgSubscriptionsService);

  readonly stats = signal<SubscriptionOverviewStats>({
    active_stores: 0,
    active_subscriptions: 0,
    monthly_revenue: 0,
    partner_commissions: 0,
    currency: 'COP',
  });
  readonly subscriptions = signal<StoreSubscription[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly isPartner = computed(() => !!this.tenantFacade.currentOrganization()?.is_partner);
  readonly filteredSubscriptions = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.subscriptions();
    if (!term) return items;
    return items.filter(
      (s) =>
        s.store_name.toLowerCase().includes(term) ||
        s.plan_name.toLowerCase().includes(term),
    );
  });

  columns: TableColumn[] = [
    { key: 'store_name', label: 'Tienda', sortable: true, priority: 1 },
    { key: 'plan_name', label: 'Plan', sortable: true, priority: 1 },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (val: string) => val,
    },
    {
      key: 'effective_price',
      label: 'Precio',
      sortable: true,
      align: 'right',
      priority: 2,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'next_billing_at',
      label: 'Próximo Cobro',
      sortable: true,
      priority: 2,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    subtitleKey: 'plan_name',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    footerKey: 'effective_price',
    footerLabel: 'Precio',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'next_billing_at',
        label: 'Próximo Cobro',
        icon: 'calendar',
        transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
      },
    ],
  };

  actions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'primary',
      action: (item: StoreSubscription) => this.viewStoreDetail(item),
    },
  ];

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }

  private loadData(): void {
    this.loading.set(true);
    this.orgSubsService.getOverviewStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) this.stats.set(res.data);
        },
      });

    this.orgSubsService.getStoreSubscriptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.subscriptions.set(res.data);
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  viewStoreDetail(sub: StoreSubscription): void {
    this.router.navigate(['/admin/subscriptions/stores', sub.store_id]);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0, 0);
  }
}
