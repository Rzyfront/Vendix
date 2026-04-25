import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
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
  SelectorComponent,
  CardComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-active-subscriptions',
  standalone: true,
  imports: [
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    SelectorComponent,
    CardComponent,
    EmptyStateComponent,
    FormsModule,
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
          title="Active"
          [value]="activeCount()"
          iconName="check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Grace"
          [value]="graceCount()"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Suspended"
          [value]="suspendedCount()"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Store Subscriptions <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Search subscriptions..."
                  [debounceTime]="500"
                  (searchChange)="onSearch($event)"
                />
                <div class="w-36">
                  <app-selector
                    [options]="statusOptions"
                    [(ngModel)]="selectedStatus"
                    (ngModelChange)="onStatusChange($any($event))"
                    size="sm"
                    variant="outline"
                  ></app-selector>
                </div>
              </div>
            </div>
          </div>

          <!-- Loading -->
          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p class="mt-2 text-text-secondary">Loading...</p>
            </div>
          }

          <!-- Empty -->
          @if (!loading() && subscriptions().length === 0) {
            <app-empty-state
              icon="credit-card"
              title="No subscriptions found"
              description="No store subscriptions match your filters."
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
  `,
})
export class ActiveSubscriptionsComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);

  readonly subscriptions = signal<StoreSubscription[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly selectedStatus = signal('');
  readonly activeCount = signal(0);
  readonly graceCount = signal(0);
  readonly suspendedCount = signal(0);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  readonly statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'active', label: 'Active' },
    { value: 'grace', label: 'Grace' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'trial', label: 'Trial' },
  ];

  columns: TableColumn[] = [
    { key: 'store_name', label: 'Store', sortable: true, width: '200px', priority: 1 },
    { key: 'organization_name', label: 'Organization', sortable: true, width: '200px', priority: 2 },
    { key: 'plan_name', label: 'Plan', sortable: true, width: '150px', priority: 2 },
    { key: 'billing_cycle', label: 'Cycle', sortable: true, width: '100px', priority: 3 },
    { key: 'price', label: 'Price', sortable: true, width: '120px', align: 'right', priority: 2 },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '100px',
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
          cancelled: '#6b7280',
          trial: '#3b82f6',
        },
      },
    },
    { key: 'current_period_end', label: 'Period End', sortable: true, width: '130px', priority: 3 },
  ];

  actions: TableAction[] = [
    {
      label: 'Events',
      icon: 'activity',
      variant: 'info',
      action: (item: StoreSubscription) => this.router.navigate(['/super-admin/subscriptions/events'], { queryParams: { subscriptionId: item.id } }),
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
        cancelled: '#6b7280',
        trial: '#3b82f6',
      },
    },
    detailKeys: [
      { key: 'plan_name', label: 'Plan' },
      { key: 'billing_cycle', label: 'Cycle' },
      { key: 'price', label: 'Price' },
      { key: 'current_period_end', label: 'Ends' },
    ],
  };

  constructor() {
    this.loadSubscriptions();
  }

  loadSubscriptions(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getStoreSubscriptions({
        page: pag.page,
        limit: pag.limit,
        search: this.searchTerm(),
        status: this.selectedStatus(),
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
    this.suspendedCount.set(data.filter((s) => s.status === 'suspended').length);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptions();
  }

  onStatusChange(status: string): void {
    this.selectedStatus.set(status);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadSubscriptions();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadSubscriptions();
  }
}
