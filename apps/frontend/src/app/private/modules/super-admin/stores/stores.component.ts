import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { StoresService } from './services/stores.service';
import { StoreListItem, StoreState, StoreType, CreateStoreDto, StoreSettingsUpdateDto } from './interfaces/store.interface';

// Import new components
import {
  StoreStatsComponent,
  StorePaginationComponent,
  StoreEmptyStateComponent,
  StoreCreateModalComponent,
  StoreEditModalComponent
} from './components/index';

import { StoreSettingsModalComponent } from './components/store-settings-modal.component';

// Import shared components
import {
  ModalComponent,
  InputsearchComponent,
  IconComponent,
  TableComponent,
  ButtonComponent,
  DialogService,
  ToastService
} from '../../../../shared/components/index';
import { TableColumn, TableAction } from '../../../../shared/components/index';

// Import styles (CSS instead of SCSS to avoid loader issues)
import './stores.component.css';

@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    StoreStatsComponent,
    StorePaginationComponent,
    StoreEmptyStateComponent,
    StoreCreateModalComponent,
    StoreEditModalComponent,
    StoreSettingsModalComponent,
    InputsearchComponent,
    IconComponent,
    TableComponent,
    ButtonComponent
  ],
  providers: [StoresService],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <app-store-stats [stats]="stats"></app-store-stats>

      <!-- Stores List -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                All Stores ({{ pagination.total }})
              </h2>
            </div>
            
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <!-- Input de búsqueda compacto -->
              <app-inputsearch
                class="w-full sm:w-64"
                size="sm"
                placeholder="Search stores..."
                [debounceTime]="1000"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>
              
              <!-- Filtro de tipo de tienda -->
              <select
                class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
                (change)="onStoreTypeChange($event)"
                [value]="selectedStoreType">
                <option value="">All Types</option>
                <option value="physical">Physical</option>
                <option value="online">Online</option>
                <option value="hybrid">Hybrid</option>
                <option value="popup">Popup</option>
                <option value="kiosko">Kiosko</option>
              </select>

              <!-- Filtro de estado -->
              <select
                class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
                (change)="onStateChange($event)"
                [value]="selectedState">
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              
              <div class="flex gap-2 items-center">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="refreshStores()"
                  [disabled]="isLoading"
                  title="Refresh"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateStoreModal()"
                  title="New Store"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">New Store</span>
                </app-button>
              </div>
            </div>
            
            <!-- Paginación info -->
            <div class="flex items-center gap-2 mt-2 sm:mt-0">
              <span class="text-sm text-text-secondary">
                Page {{ pagination.page }} of {{ pagination.totalPages }}
              </span>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Loading stores...</p>
        </div>

        <!-- Empty State -->
        <app-store-empty-state
          *ngIf="!isLoading && stores.length === 0"
          [title]="getEmptyStateTitle()"
          [description]="getEmptyStateDescription()"
          [showAdditionalActions]="hasFilters"
          (actionClick)="openCreateStoreModal()"
          (refreshClick)="refreshStores()"
          (clearFiltersClick)="clearFilters()">
        </app-store-empty-state>

        <!-- Stores Table -->
        <div *ngIf="!isLoading && stores.length > 0" class="p-6">
          <app-table
            [data]="stores"
            [columns]="tableColumns"
            [actions]="tableActions"
            [loading]="isLoading"
            [sortable]="true"
            [hoverable]="true"
            [striped]="true"
            size="md"
            (sort)="onTableSort($event)"
            (rowClick)="viewStore($event)">
          </app-table>

          <!-- Pagination -->
          <div class="mt-6 flex justify-center">
            <app-store-pagination
              [pagination]="pagination"
              (pageChange)="changePage($event)">
            </app-store-pagination>
          </div>
        </div>
      </div>

      <!-- Create Store Modal -->
      <app-store-create-modal
        [isOpen]="isCreateModalOpen"
        [isSubmitting]="isCreatingStore"
        (openChange)="onCreateModalChange($event)"
        (submit)="createStore($event)"
        (cancel)="onCreateModalCancel()"
      ></app-store-create-modal>

      <!-- Edit Store Modal -->
      <app-store-edit-modal
        [isOpen]="isEditModalOpen"
        [isSubmitting]="isUpdatingStore"
        [store]="selectedStore"
        (openChange)="onEditModalChange($event)"
        (submit)="updateStore($event)"
        (cancel)="onEditModalCancel()"
      ></app-store-edit-modal>

      <!-- Settings Store Modal -->
      <app-store-settings-modal
        *ngIf="selectedStoreForSettings"
        [isOpen]="isSettingsModalOpen"
        [isSubmitting]="isUpdatingSettings"
        (openChange)="onSettingsModalChange($event)"
        (submit)="updateStoreSettings($event)"
        (cancel)="onSettingsModalCancel()"
      ></app-store-settings-modal>
    </div>
  `
})
export class StoresComponent implements OnInit, OnDestroy {
  stores: StoreListItem[] = [];
  isLoading = false;
  searchTerm = '';
  selectedState = '';
  selectedStoreType = '';
  selectedOrganization = '';

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, width: '200px' },
    { key: 'store_code', label: 'Código', sortable: true, width: '120px' },
    { key: 'slug', label: 'Slug', sortable: true, width: '150px' },
    { key: 'email', label: 'Email', sortable: true, width: '250px' },
    { key: 'phone', label: 'Teléfono', sortable: true, width: '150px' },
    { key: 'city', label: 'Ciudad', sortable: true, width: '120px' },
    { key: 'country', label: 'País', sortable: true, width: '120px' },
    { key: 'organization_name', label: 'Organización', sortable: true, width: '180px' },
    {
      key: 'store_type',
      label: 'Tipo',
      sortable: true,
      width: '120px',
      align: 'center',
      badge: true,
      badgeConfig: {
        type: 'status',
        size: 'sm'
      },
      transform: (value: StoreType) => this.formatStoreType(value)
    },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      badgeConfig: {
        type: 'status',
        size: 'sm'
      },
      transform: (value: boolean) => this.formatActiveStatus(value)
    }
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (store) => this.editStore(store),
      variant: 'primary'
    },
    {
      label: 'Configuración',
      icon: 'settings',
      action: (store) => this.openSettingsModal(store),
      variant: 'secondary'
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (store) => this.deleteStore(store),
      variant: 'danger'
    }
  ];

  stats = {
    total_stores: 0,
    active_stores: 0,
    inactive_stores: 0,
    suspended_stores: 0,
    draft_stores: 0,
    total_revenue: 0,
    total_orders: 0,
    total_products: 0
  };

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  };

  // Modal state
  isCreateModalOpen = false;
  isCreatingStore = false;
  createStoreForm!: FormGroup;

  // Edit Modal state
  isEditModalOpen = false;
  isUpdatingStore = false;
  selectedStore?: StoreListItem;

  // Settings Modal state
  isSettingsModalOpen = false;
  isUpdatingSettings = false;
  selectedStoreForSettings?: StoreListItem;

  private subscriptions: Subscription[] = [];

  constructor(
    private storesService: StoresService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService
  ) {
    this.initializeCreateForm();
  }

  ngOnInit(): void {
    this.loadStores();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeCreateForm(): void {
    this.createStoreForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      slug: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      website: [''],
      description: [''],
      address: [''],
      city: [''],
      country: [''],
      organization_id: [null, [Validators.required]],
      state: ['active']
    });
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm || this.selectedState || this.selectedStoreType || this.selectedOrganization);
  }

  openCreateStoreModal(): void {
    this.isCreateModalOpen = true;
    this.createStoreForm.reset({
      name: '',
      slug: '',
      email: '',
      phone: '',
      website: '',
      description: '',
      address: '',
      city: '',
      country: '',
      organization_id: null,
      state: 'active'
    });
  }

  onCreateModalChange(isOpen: boolean): void {
    this.isCreateModalOpen = isOpen;
    if (!isOpen) {
      this.createStoreForm.reset();
    }
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen = false;
    this.createStoreForm.reset();
  }

  createStore(storeData?: CreateStoreDto | Event): void {
    // If it's an Event, it means method was called from the new modal
    // If no data is provided, it means method was called from the old form
    // This maintains backward compatibility while transitioning to the new modal
    if (!storeData || storeData instanceof Event) {
      if (this.createStoreForm.invalid) {
        // Mark all fields as touched to trigger validation messages
        Object.keys(this.createStoreForm.controls).forEach(key => {
          this.createStoreForm.get(key)?.markAsTouched();
        });
        return;
      }

      const formData = this.createStoreForm.value;
      storeData = {
        name: formData.name,
        slug: formData.slug,
        store_code: formData.name.toLowerCase().replace(/\s+/g, '-'), // Generate slug-based code
        email: formData.email,
        phone: formData.phone || undefined,
        website: formData.website || undefined,
        description: formData.description || undefined,
        address: formData.address || undefined,
        city: formData.city || undefined,
        country: formData.country || undefined,
        organization_id: formData.organization_id,
        is_active: formData.state === 'active' ? true : false,
        store_type: StoreType.PHYSICAL
      };
    }

    this.isCreatingStore = true;

    const sub = this.storesService.createStore(storeData as CreateStoreDto).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreateModalOpen = false;
          this.loadStores(); // Reload the list
          this.loadStats(); // Reload stats
          this.toastService.success('Tienda creada exitosamente');
          console.log('Store created successfully:', response.data);
        }
        this.isCreatingStore = false;
      },
      error: (error) => {
        console.error('Error creating store:', error);
        this.toastService.error('Error al crear la tienda');
        this.isCreatingStore = false;
      }
    });

    this.subscriptions.push(sub);
  }

  loadStores(): void {
    this.isLoading = true;

    const query = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.selectedState && { is_active: this.selectedState === 'active' ? true : this.selectedState === 'inactive' ? false : undefined }),
      ...(this.selectedStoreType && { store_type: this.selectedStoreType as StoreType }),
      ...(this.selectedOrganization && { organization_id: parseInt(this.selectedOrganization) })
    };

    const sub = this.storesService.getStores(query).subscribe({
      next: (response) => {
        if (response.success) {
          this.stores = response.data.map((store: any) => ({
            id: store.id,
            name: store.name,
            slug: store.slug,
            store_code: store.store_code || '',
            email: store.email,
            phone: store.phone || '',
            city: store.city || '',
            country: store.country || '',
            store_type: store.store_type || StoreType.PHYSICAL,
            is_active: store.is_active !== undefined ? store.is_active : true,
            organization_id: store.organization_id,
            organization_name: store.organization?.name || 'Unknown',
            products_count: store.products_count || 0,
            orders_count: store.orders_count || 0,
            revenue: store.revenue || 0,
            created_at: store.created_at || new Date().toISOString()
          }));

          this.pagination.total = response.meta.total;
          this.pagination.totalPages = response.meta.totalPages;
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading stores:', error);
        this.isLoading = false;
        // TODO: Show error notification
      }
    });

    this.subscriptions.push(sub);
  }

  loadStats(): void {
    const sub = this.storesService.getStoreStats().subscribe({
      next: (response) => {
        if (response.success) {
          this.stats = response.data;
        }
      },
      error: (error) => {
        console.error('Error loading store stats:', error);
        // Fallback to calculating stats from loaded data
        this.updateStats();
      }
    });

    this.subscriptions.push(sub);
  }

  updateStats(): void {
    this.stats.total_stores = this.stores.length;
    this.stats.active_stores = this.stores.filter(store => store.is_active === true).length;
    this.stats.inactive_stores = this.stores.filter(store => store.is_active === false).length;
    // Note: suspended and draft states are not directly available in StoreListItem
    // These would need to be calculated from the backend or additional data
    this.stats.suspended_stores = 0;
    this.stats.draft_stores = 0;
  }

  refreshStores(): void {
    this.loadStores();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedState = '';
    this.selectedStoreType = '';
    this.selectedOrganization = '';
    this.pagination.page = 1;
    this.loadStores();
  }

  onStoreTypeChange(event: any): void {
    this.selectedStoreType = event.target.value;
    this.pagination.page = 1;
    this.loadStores();
  }

  onStateChange(event: any): void {
    this.selectedState = event.target.value;
    this.pagination.page = 1;
    this.loadStores();
  }

  openSettingsModal(store: StoreListItem): void {
    this.selectedStoreForSettings = store;
    this.isSettingsModalOpen = true;
  }

  onSettingsModalChange(isOpen: boolean): void {
    this.isSettingsModalOpen = isOpen;
    if (!isOpen) {
      this.selectedStoreForSettings = undefined;
    }
  }

  onSettingsModalCancel(): void {
    this.isSettingsModalOpen = false;
    this.selectedStoreForSettings = undefined;
  }

  updateStoreSettings(settingsData: any): void {
    if (!this.selectedStoreForSettings) return;

    this.isUpdatingSettings = true;

    const sub = this.storesService.updateStoreSettings(this.selectedStoreForSettings.id, settingsData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isSettingsModalOpen = false;
          this.selectedStoreForSettings = undefined;
          this.toastService.success('Configuración actualizada exitosamente');
          console.log('Store settings updated successfully:', response.data);
        }
        this.isUpdatingSettings = false;
      },
      error: (error) => {
        console.error('Error updating store settings:', error);
        this.toastService.error('Error al actualizar la configuración');
        this.isUpdatingSettings = false;
      }
    });

    this.subscriptions.push(sub);
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.pagination.page = 1;
    this.loadStores();
  }

  onTableSort(sortEvent: { column: string; direction: 'asc' | 'desc' | null }): void {
    // TODO: Implement server-side sorting
    console.log('Sort event:', sortEvent);
    // For now, just reload the stores
    this.loadStores();
  }

  changePage(page: number): void {
    this.pagination.page = page;
    this.loadStores();
  }

  // Helper methods for table display
  formatStatus(status: string): string {
    const statusMap: { [key: string]: string } = {
      'active': 'Activo',
      'inactive': 'Inactivo',
      'draft': 'Borrador',
      'suspended': 'Suspendido',
      'archived': 'Archivado'
    };
    return statusMap[status] || status;
  }

  formatStoreType(type: StoreType): string {
    const typeMap: { [key in StoreType]: string } = {
      [StoreType.PHYSICAL]: 'Física',
      [StoreType.ONLINE]: 'Online',
      [StoreType.HYBRID]: 'Híbrida',
      [StoreType.POPUP]: 'Temporal',
      [StoreType.KIOSKO]: 'Kiosco'
    };
    return typeMap[type] || type;
  }

  formatActiveStatus(isActive: boolean): string {
    return isActive ? 'Activo' : 'Inactivo';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  deleteStore(store: StoreListItem): void {
    this.dialogService.confirm({
      title: 'Eliminar Tienda',
      message: `¿Estás seguro de que deseas eliminar la tienda "${store.name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'
    }).then((confirmed) => {
      if (confirmed) {
        const sub = this.storesService.deleteStore(store.id).subscribe({
          next: (response) => {
            if (response.success) {
              this.loadStores(); // Reload the list
              this.toastService.success('Tienda eliminada exitosamente');
            }
          },
          error: (error) => {
            console.error('Error deleting store:', error);
            this.toastService.error('Error al eliminar la tienda');
          }
        });

        this.subscriptions.push(sub);
      }
    });
  }

  viewStore(store: StoreListItem): void {
    // Navigate to store details
    // TODO: Implement navigation when details page is created
    console.log('View store:', store);
  }

  editStore(store: StoreListItem): void {
    this.selectedStore = store;
    this.isEditModalOpen = true;
  }

  onEditModalChange(isOpen: boolean): void {
    this.isEditModalOpen = isOpen;
    if (!isOpen) {
      this.selectedStore = undefined;
    }
  }

  onEditModalCancel(): void {
    this.isEditModalOpen = false;
    this.selectedStore = undefined;
  }

  updateStore(storeData: any): void {
    if (!this.selectedStore) return;

    this.isUpdatingStore = true;

    // Transform data to match the UpdateStoreDto interface from backend
    const updateData = {
      name: storeData.name,
      slug: storeData.slug,
      description: storeData.description,
      email: storeData.email,
      phone: storeData.phone,
      website: storeData.website,
      address: storeData.address,
      city: storeData.city,
      country: storeData.country,
      is_active: storeData.state === 'active' ? true : false,
      store_type: storeData.store_type || StoreType.PHYSICAL
    };

    const sub = this.storesService.updateStore(this.selectedStore.id, updateData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isEditModalOpen = false;
          this.selectedStore = undefined;
          this.loadStores(); // Reload the list
          this.loadStats(); // Reload stats
          this.toastService.success('Tienda actualizada exitosamente');
          console.log('Store updated successfully:', response.data);
        }
        this.isUpdatingStore = false;
      },
      error: (error) => {
        console.error('Error updating store:', error);
        this.toastService.error('Error al actualizar la tienda');
        this.isUpdatingStore = false;
      }
    });

    this.subscriptions.push(sub);
  }

  getEmptyStateTitle(): string {
    if (this.hasFilters) {
      return 'No stores match your filters';
    }
    return 'No stores found';
  }

  getEmptyStateDescription(): string {
    if (this.hasFilters) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first store.';
  }
}