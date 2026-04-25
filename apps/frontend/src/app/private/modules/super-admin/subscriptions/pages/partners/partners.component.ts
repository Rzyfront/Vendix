import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { PartnerOrganization } from '../../interfaces/subscription-admin.interface';
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

@Component({
  selector: 'app-partners',
  standalone: true,
  imports: [
    RouterModule,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    CardComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Partners"
          [value]="totalPartners()"
          iconName="handshake"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Active Partners"
          [value]="activePartners()"
          iconName="check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Pending Payout"
          [value]="pendingPayout()"
          iconName="banknote"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Referred Stores"
          [value]="totalReferredStores()"
          iconName="store"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Partners <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Search partners..."
                  [debounceTime]="500"
                  (searchChange)="onSearch($event)"
                />
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
          @if (!loading() && partners().length === 0) {
            <app-empty-state
              icon="users"
              title="No partners found"
              description="No partner organizations match your filters."
              [showActionButton]="false"
            ></app-empty-state>
          }

          <!-- Data View + Pagination -->
          @if (!loading() && partners().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="partners()"
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
export class PartnersComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);

  readonly partners = signal<PartnerOrganization[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly totalPartners = signal(0);
  readonly activePartners = signal(0);
  readonly pendingPayout = signal(0);
  readonly totalReferredStores = signal(0);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  columns: TableColumn[] = [
    { key: 'name', label: 'Name', sortable: true, width: '200px', priority: 1 },
    { key: 'slug', label: 'Slug', sortable: true, width: '150px', priority: 3 },
    { key: 'email', label: 'Email', sortable: true, width: '250px', priority: 2 },
    {
      key: 'is_partner',
      label: 'Partner',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (v: boolean) => (v ? 'Yes' : 'No'),
    },
    { key: 'partner_margin_percent', label: 'Margin %', sortable: true, width: '100px', align: 'right', priority: 2 },
    { key: 'total_referred_stores', label: 'Stores', sortable: true, width: '100px', align: 'center', priority: 2 },
    { key: 'total_earnings', label: 'Earnings', sortable: true, width: '120px', align: 'right', priority: 3 },
  ];

  actions: TableAction[] = [
    {
      label: 'Edit',
      icon: 'edit',
      variant: 'primary',
      action: (item: PartnerOrganization) => this.router.navigate(['/super-admin/subscriptions/partners', item.id]),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'email',
    badgeKey: 'is_partner',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: boolean) => (v ? 'Partner' : 'Regular'),
    detailKeys: [
      { key: 'partner_margin_percent', label: 'Margin %' },
      { key: 'total_referred_stores', label: 'Stores' },
      { key: 'total_earnings', label: 'Earnings' },
    ],
  };

  constructor() {
    this.loadPartners();
  }

  loadPartners(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getPartners({
        page: pag.page,
        limit: pag.limit,
        search: this.searchTerm(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.partners.set(res.data);
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

  computeStats(data: PartnerOrganization[]): void {
    this.totalPartners.set(data.filter((p) => p.is_partner).length);
    this.activePartners.set(data.filter((p) => p.is_partner && p.state === 'active').length);
    this.pendingPayout.set(data.reduce((sum, p) => sum + p.pending_payout, 0));
    this.totalReferredStores.set(data.reduce((sum, p) => sum + p.total_referred_stores, 0));
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadPartners();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadPartners();
  }
}
