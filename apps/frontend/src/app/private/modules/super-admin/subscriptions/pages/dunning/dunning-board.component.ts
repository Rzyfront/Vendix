import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { DunningSubscription } from '../../interfaces/subscription-admin.interface';
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
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';

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
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="In Grace"
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
        <app-stats
          title="Total Overdue"
          [value]="totalOverdue() | currency"
          iconName="banknote"
          iconBgColor="bg-orange-100"
          iconColor="text-orange-600"
        ></app-stats>
        <app-stats
          title="Avg Days Overdue"
          [value]="avgDaysOverdue()"
          iconName="calendar"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Dunning <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto justify-end">
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="loadDunning()"
                  title="Refresh"
                >
                  <app-icon slot="icon" name="refresh" [size]="18"></app-icon>
                </app-button>
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
          @if (!loading() && dunning().length === 0) {
            <app-empty-state
              icon="alert-circle"
              title="No dunning found"
              description="No subscriptions in dunning right now."
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
export class DunningBoardComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);

  readonly dunning = signal<DunningSubscription[]>([]);
  readonly loading = signal(false);
  readonly graceCount = signal(0);
  readonly suspendedCount = signal(0);
  readonly totalOverdue = signal(0);
  readonly avgDaysOverdue = signal(0);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  columns: TableColumn[] = [
    { key: 'store_name', label: 'Store', sortable: true, width: '200px', priority: 1 },
    { key: 'organization_name', label: 'Organization', sortable: true, width: '200px', priority: 2 },
    { key: 'plan_name', label: 'Plan', sortable: true, width: '150px', priority: 2 },
    { key: 'price', label: 'Amount', sortable: true, width: '120px', align: 'right', priority: 2 },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '110px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: { grace: '#f59e0b', suspended: '#ef4444' },
      },
    },
    { key: 'days_overdue', label: 'Days Overdue', sortable: true, width: '120px', align: 'center', priority: 1 },
    { key: 'payment_attempts', label: 'Attempts', sortable: true, width: '100px', align: 'center', priority: 3 },
  ];

  actions: TableAction[] = [
    {
      label: 'Retry',
      icon: 'refresh',
      variant: 'primary',
      action: (item: DunningSubscription) => this.onRetry(item),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    subtitleKey: 'organization_name',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { grace: '#f59e0b', suspended: '#ef4444' },
    },
    detailKeys: [
      { key: 'plan_name', label: 'Plan' },
      { key: 'days_overdue', label: 'Days Overdue' },
      { key: 'payment_attempts', label: 'Attempts' },
    ],
  };

  constructor() {
    this.loadDunning();
  }

  loadDunning(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getDunningSubscriptions({ page: pag.page, limit: pag.limit })
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
            this.computeStats(res.data);
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  computeStats(data: DunningSubscription[]): void {
    this.graceCount.set(data.filter((d) => d.status === 'grace').length);
    this.suspendedCount.set(data.filter((d) => d.status === 'suspended').length);
    this.totalOverdue.set(data.reduce((sum, d) => sum + d.price, 0));
    const avg = data.length > 0 ? data.reduce((sum, d) => sum + d.days_overdue, 0) / data.length : 0;
    this.avgDaysOverdue.set(Math.round(avg));
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadDunning();
  }

  onRetry(item: DunningSubscription): void {
    // TODO: implement retry payment
    console.log('Retry payment for', item.id);
  }

  onViewDetails(item: DunningSubscription): void {
    this.router.navigate(['/super-admin/subscriptions/events'], { queryParams: { subscriptionId: item.id } });
  }
}
