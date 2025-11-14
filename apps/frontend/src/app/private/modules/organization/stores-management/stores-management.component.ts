import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import {
  StoreListItem,
  StoreQueryDto,
  Store,
  StoreStats,
  StoreFilters,
} from './interfaces/store.interface';
import { OrganizationStoresService } from './services/organization-stores.service';
import { StoreListComponent } from './components/store-list/store-list.component';
import { StoreFiltersComponent } from './components/store-filters/store-filters.component';
import { StoreCreateModalComponent } from './components/store-create-modal/store-create-modal.component';
import { StoreStatsComponent } from './components/store-stats/store-stats.component';
import { StoreEmptyStateComponent } from './components/store-empty-state/store-empty-state.component';
import { StoreEditModalComponent } from './components/store-edit-modal/store-edit-modal.component';
import { StoreSettingsModalComponent } from './components/store-settings-modal/store-settings-modal.component';
import { StoreCardComponent } from './components/store-card/store-card.component';
import { StorePaginationComponent } from './components/store-pagination/store-pagination.component';
import { StoreSwitchDialogComponent } from './components/store-switch-dialog/store-switch-dialog.component';
import { EnvironmentSwitchService } from '../../../../core/services/environment-switch.service';

// App shared components
import {
  SpinnerComponent,
  ButtonComponent,
  ModalComponent,
  ToastService,
} from '../../../../shared/components/index';

@Component({
  selector: 'app-stores-management',
  standalone: true,
  imports: [
    CommonModule,
    StoreListComponent,
    StoreFiltersComponent,
    StoreCreateModalComponent,
    StoreStatsComponent,
    StoreEmptyStateComponent,
    StoreEditModalComponent,
    StoreSettingsModalComponent,
    StoreCardComponent,
    StorePaginationComponent,
    StoreSwitchDialogComponent,
    // App shared components
    SpinnerComponent,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <div class="min-h-screen bg-[var(--color-background)]">
      <!-- Header -->
      <div class="bg-surface border-b border-border">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="py-6">
            <div class="flex items-center justify-between">
              <div>
                <h1 class="text-2xl font-semibold text-text-primary">
                  Stores Management
                </h1>
                <p class="mt-1 text-sm text-text-secondary">
                  Manage all stores in your organization
                </p>
              </div>

              <!-- View Toggle -->
              <div class="flex items-center space-x-3">
                <div class="bg-gray-100 rounded-lg p-1 flex">
                  <button
                    (click)="viewMode = 'table'"
                    [class]="viewMode === 'table' ? 'bg-white shadow-sm' : ''"
                    class="px-3 py-1.5 text-sm font-medium rounded-md transition-all"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      ></path>
                    </svg>
                  </button>
                  <button
                    (click)="viewMode = 'card'"
                    [class]="viewMode === 'card' ? 'bg-white shadow-sm' : ''"
                    class="px-3 py-1.5 text-sm font-medium rounded-md transition-all"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                      ></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <!-- Store Statistics Dashboard -->
        <app-store-stats [stats]="stats"></app-store-stats>

        <!-- Filters -->
        <app-store-filters
          [loading]="loading"
          (filterChange)="onFilterChange($event)"
          (refresh)="loadStores()"
          (createStore)="openCreateModal()"
        ></app-store-filters>

        <!-- Loading State -->
        <div *ngIf="loading" class="flex justify-center items-center py-12">
          <app-spinner size="lg" />
        </div>

        <!-- Empty State -->
        <app-store-empty-state
          *ngIf="!loading && stores.length === 0"
          (createStore)="openCreateModal()"
        ></app-store-empty-state>

        <!-- Content when not loading and has data -->
        <div *ngIf="!loading && stores.length > 0">
          <!-- Table View -->
          <div *ngIf="viewMode === 'table'">
            <app-store-list
              [stores]="stores"
              [loading]="loading"
              [pagination]="pagination"
              (createStore)="openCreateModal()"
              (viewStore)="viewStore($event)"
              (editStore)="editStore($event)"
              (deleteStore)="deleteStore($event)"
              (pageChange)="onPageChange($event)"
              (sortChange)="onSortChange($event)"
            ></app-store-list>
          </div>

          <!-- Card View -->
          <div *ngIf="viewMode === 'card'">
            <div
              class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6"
            >
              <app-store-card
                *ngFor="let store of stores"
                [store]="store"
                [isSelected]="selectedStores.has(store.id)"
                (select)="selectStore($event)"
                (edit)="editStore($event)"
                (delete)="deleteStore($event)"
                (toggleStatus)="toggleStoreStatus($event)"
                (viewStore)="viewStore($event)"
              ></app-store-card>
            </div>
          </div>

          <!-- Pagination -->
          <app-store-pagination
            [pagination]="paginationInfo"
            [disabled]="loading"
            (pageChange)="onPageChange($event)"
            (pageSizeChange)="onPageSizeChange($event)"
          ></app-store-pagination>
        </div>
      </div>

      <!-- Create Store Modal -->
      <app-store-create-modal
        [(isOpen)]="showCreateModal"
        (storeCreated)="onStoreCreated($event)"
      ></app-store-create-modal>

      <!-- Edit Store Modal -->
      <app-store-edit-modal
        [store]="selectedStore"
        [isVisible]="showEditModal"
        [isLoading]="editLoading"
        (close)="closeEditModal()"
        (save)="onStoreUpdate($event)"
      ></app-store-edit-modal>

      <!-- Store Switch Dialog -->
      <app-store-switch-dialog
        [isVisible]="showStoreSwitchDialog"
        [isLoading]="isSwitchingEnvironment"
        [data]="{
          storeName: selectedStoreForSwitch?.name || '',
          storeSlug: selectedStoreForSwitch?.domain || '',
        }"
        (close)="onStoreSwitchDialogClose($event)"
      ></app-store-switch-dialog>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StoresManagementComponent implements OnInit, OnDestroy {
  stores: StoreListItem[] = [];
  loading = false;
  showCreateModal = false;
  showEditModal = false;
  editLoading = false;
  showStoreSwitchDialog = false;
  isSwitchingEnvironment = false;
  selectedStoreForSwitch: StoreListItem | null = null;

  // View management
  viewMode: 'table' | 'card' = 'table';
  selectedStores = new Set<number>();
  selectedStore: Store | null = null;

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    total_pages: 0,
  };

  // Enhanced pagination info
  get paginationInfo() {
    return {
      currentPage: this.pagination.page,
      totalPages: this.pagination.total_pages,
      totalItems: this.pagination.total,
      itemsPerPage: this.pagination.limit,
      hasNextPage: this.pagination.page < this.pagination.total_pages,
      hasPreviousPage: this.pagination.page > 1,
    };
  }

  currentFilters: Omit<StoreQueryDto, 'organization_id'> = {};
  currentSort = { column: '', direction: 'asc' as 'asc' | 'desc' };
  stats: StoreStats | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private storesService: OrganizationStoresService,
    private toastService: ToastService,
    private environmentSwitchService: EnvironmentSwitchService,
  ) {}

  ngOnInit(): void {
    this.loadStores();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStores(): void {
    this.loading = true;

    const queryParams: Omit<StoreQueryDto, 'organization_id'> = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      ...this.currentFilters,
    };

    this.storesService
      .getStores(queryParams)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          console.log('API Response:', response);

          // Handle the response data
          if (response && Array.isArray(response.data)) {
            this.stores = response.data.map((store: StoreListItem) => ({
              ...store,
              // Add UI-specific fields
              status: store.is_active ? 'active' : 'inactive',
              email: `${store.name.toLowerCase().replace(/\s+/g, '.')}@${store.organizations.slug}.com`,
              stats: {
                productsCount: store._count?.products || 0,
                ordersCount: store._count?.orders || 0,
                revenue: Math.floor(Math.random() * 10000), // Mock data for now
                customersCount: Math.floor(Math.random() * 1000), // Mock data for now
                averageOrderValue: Math.floor(Math.random() * 200), // Mock data for now
                conversionRate: Math.random() * 5, // Mock data for now
              },
              // Ensure organization object matches expected format
              organization: store.organizations,
            }));
          } else {
            console.error('Unexpected response structure:', response);
            this.stores = [];
          }

          this.pagination = {
            page: response?.meta?.page || 1,
            limit: response?.meta?.limit || 10,
            total: response?.meta?.total || 0,
            total_pages: response?.meta?.totalPages || 0,
          };
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading stores:', error);
          this.loading = false;
          this.toastService.error('Failed to load stores');
        },
      });
  }

  loadStats(): void {
    this.storesService
      .getOrganizationStoreStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.stats = {
            totalStores: response.data?.total_stores || 0,
            activeStores: response.data?.active_stores || 0,
            inactiveStores: response.data?.inactive_stores || 0,
            storesGrowthRate: Math.random() * 20 - 10, // Mock growth rate
            activeStoresGrowthRate: Math.random() * 20 - 10, // Mock growth rate
            totalRevenue: Math.floor(Math.random() * 100000), // Mock revenue
            revenueGrowthRate: Math.random() * 20 - 10, // Mock growth rate
            totalProducts: Math.floor(Math.random() * 1000), // Mock products
            productsGrowthRate: Math.random() * 20 - 10, // Mock growth rate
            totalOrders: Math.floor(Math.random() * 5000), // Mock orders
            ordersGrowthRate: Math.random() * 20 - 10, // Mock growth rate
            averageOrderValue: Math.floor(Math.random() * 200), // Mock AOV
            aovGrowthRate: Math.random() * 20 - 10, // Mock growth rate
            conversionRate: Math.random() * 5, // Mock conversion rate
            conversionGrowthRate: Math.random() * 2 - 1, // Mock growth rate
            customerSatisfaction: Math.random() * 2 + 3, // Mock satisfaction (3-5)
            satisfactionGrowthRate: Math.random() * 1 - 0.5, // Mock growth rate
          };
        },
        error: (error) => {
          console.error('Error loading stats:', error);
        },
      });
  }

  onFilterChange(filters: any): void {
    this.currentFilters = filters;
    this.pagination.page = 1; // Reset to first page when filtering
    this.loadStores();
  }

  onPageChange(page: number): void {
    this.pagination.page = page;
    this.loadStores();
  }

  onPageSizeChange(pageSize: number): void {
    this.pagination.limit = pageSize;
    this.pagination.page = 1; // Reset to first page when changing page size
    this.loadStores();
  }

  onSortChange(sort: { column: string; direction: 'asc' | 'desc' }): void {
    this.currentSort = sort;
    // Apply sorting logic here if backend supports it
    this.loadStores();
  }

  // Store selection for card view
  selectStore(store: StoreListItem): void {
    if (this.selectedStores.has(store.id)) {
      this.selectedStores.delete(store.id);
    } else {
      this.selectedStores.add(store.id);
    }
  }

  // Modal management
  openCreateModal(): void {
    this.showCreateModal = true;
  }

  onStoreCreated(store: StoreListItem): void {
    this.loadStores();
    this.loadStats();
    this.toastService.success('Store created successfully');
  }

  editStore(store: StoreListItem): void {
    this.storesService
      .getStore(store.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.selectedStore = response.data;
          this.showEditModal = true;
        },
        error: (error) => {
          console.error('Error loading store details:', error);
          this.toastService.error('Failed to load store details');
        },
      });
  }

  closeEditModal(): void {
    this.showEditModal = false;
    this.selectedStore = null;
  }

  onStoreUpdate(updatedStore: StoreListItem): void {
    this.editLoading = true;

    this.storesService
      .updateStore(updatedStore.id, updatedStore)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.editLoading = false;
          this.closeEditModal();
          this.loadStores();
          this.loadStats();
          this.toastService.success('Store updated successfully');
        },
        error: (error) => {
          this.editLoading = false;
          console.error('Error updating store:', error);
          this.toastService.error('Failed to update store');
        },
      });
  }

  // Store actions
  viewStore(store: StoreListItem): void {
    console.log('View store:', store);
    this.selectedStoreForSwitch = store;
    this.showStoreSwitchDialog = true;
  }

  toggleStoreStatus(store: StoreListItem): void {
    const newStatus = store.is_active ? 'inactive' : 'active';
    const action = store.is_active ? 'deactivate' : 'activate';

    if (confirm(`Are you sure you want to ${action} store "${store.name}"?`)) {
      this.storesService
        .updateStore(store.id, { is_active: !store.is_active })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            store.is_active = !store.is_active;
            this.loadStats();
            this.toastService.success(`Store ${action}d successfully`);
          },
          error: (error) => {
            console.error('Error toggling store status:', error);
            this.toastService.error(`Failed to ${action} store`);
          },
        });
    }
  }

  deleteStore(store: StoreListItem): void {
    if (
      confirm(
        `Are you sure you want to delete store "${store.name}"? This action cannot be undone.`,
      )
    ) {
      this.storesService
        .deleteStore(store.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.stores = this.stores.filter((s) => s.id !== store.id);
            this.loadStats();
            this.toastService.success('Store deleted successfully');
          },
          error: (error) => {
            console.error('Error deleting store:', error);
            this.toastService.error('Failed to delete store');
          },
        });
    }
  }

  // Store switch dialog handlers
  onStoreSwitchDialogClose(confirmed: boolean): void {
    this.showStoreSwitchDialog = false;

    if (confirmed && this.selectedStoreForSwitch) {
      this.switchToStoreEnvironment(this.selectedStoreForSwitch);
    }

    this.selectedStoreForSwitch = null;
  }

  private async switchToStoreEnvironment(store: StoreListItem): Promise<void> {
    this.isSwitchingEnvironment = true;

    try {
      const success =
        await this.environmentSwitchService.performEnvironmentSwitch(
          'STORE_ADMIN',
          store.domain,
        );

      if (success) {
        this.toastService.success(
          `Cambiado al entorno de la tienda "${store.name}"`,
        );
      } else {
        this.toastService.error('No se pudo cambiar al entorno de la tienda');
      }
    } catch (error) {
      console.error('Error switching to store environment:', error);
      this.toastService.error('Error al cambiar al entorno de la tienda');
    } finally {
      this.isSwitchingEnvironment = false;
    }
  }
}
