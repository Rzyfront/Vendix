import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { SubscriptionPlan, SubscriptionStats } from '../../interfaces/subscription-admin.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { ResponsiveDataViewComponent, TableColumn, TableAction, ItemListCardConfig } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';

@Component({
  selector: 'app-plans',
  standalone: true,
  imports: [
    StatsComponent,
    InputsearchComponent,
    ButtonComponent,
    IconComponent,
    CardComponent,
    EmptyStateComponent,
    CurrencyPipe,
    RouterModule,
    PaginationComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total de planes"
          [value]="stats().totalPlans"
          iconName="clipboard-list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Planes activos"
          [value]="stats().activePlans"
          iconName="check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Suscripciones activas"
          [value]="stats().activeSubscriptions"
          iconName="credit-card"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        <app-stats
          title="Ingresos mensuales"
          [value]="stats().totalMonthlyRevenue | currency"
          iconName="banknote"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Planes <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar planes..."
                  [debounceTime]="500"
                  (searchChange)="onSearch($event)"
                />
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="router.navigate(['/super-admin/subscriptions/plans/new'])"
                  title="Nuevo plan"
                >
                  <app-icon slot="icon" name="plus" [size]="18"></app-icon>
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
          @if (!loading() && plans().length === 0) {
            <app-empty-state
              icon="layers"
              title="No se encontraron planes"
              description="Crea tu primer plan de suscripción para comenzar."
              [showActionButton]="false"
            ></app-empty-state>
          }

          <!-- Data View + Pagination -->
          @if (!loading() && plans().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="plans()"
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
                    (pageChange)="changePage($any($event))"
                  />
                </div>
              }
            </div>
          }
        </app-card>
      </div>
    </div>
  `,
})
export class PlansComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);

  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');

  readonly stats = signal<SubscriptionStats>({
    totalPlans: 0,
    activePlans: 0,
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    graceSubscriptions: 0,
    suspendedSubscriptions: 0,
    totalPartners: 0,
    totalMonthlyRevenue: 0,
    currencyCode: 'USD',
  });

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, width: '200px', priority: 1 },
    { key: 'slug', label: 'Slug', sortable: true, width: '150px', priority: 3 },
    { key: 'description', label: 'Descripción', sortable: false, width: '300px', priority: 2 },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
    },
    {
      key: 'is_public',
      label: 'Visibilidad',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      priority: 2,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: { 'Público': '#3b82f6', 'Privado': '#6b7280' } },
      transform: (v: boolean) => (v ? 'Público' : 'Privado'),
    },
    { key: 'grace_threshold_days', label: 'Gracia', sortable: true, width: '80px', align: 'center', priority: 3 },
  ];

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (item: SubscriptionPlan) => this.router.navigate(['/super-admin/subscriptions/plans', item.id, 'edit']),
    },
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'info',
      action: (item: SubscriptionPlan) => this.router.navigate(['/super-admin/subscriptions/plans', item.id]),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'slug',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'description', label: 'Descripción' },
      { key: 'grace_threshold_days', label: 'Días de gracia' },
    ],
  };

  constructor() {
    this.loadPlans();
    this.loadStats();
  }

  loadPlans(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getPlans({
        page: pag.page,
        limit: pag.limit,
        search: this.searchTerm(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.plans.set(res.data);
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

  loadStats(): void {
    this.service.getStats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success) this.stats.set(res.data);
      },
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadPlans();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadPlans();
  }
}
