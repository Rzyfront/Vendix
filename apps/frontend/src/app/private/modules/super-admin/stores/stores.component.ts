import {
  Component,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { StoresService } from './services/stores.service';
import {
  StoreListItem,
  StoreState,
  StoreType,
  CreateStoreDto,
  StoreSettingsUpdateDto,
} from './interfaces/store.interface';

// Import new components
import {
  StoreStatsComponent,
  StoreEmptyStateComponent,
  StoreCreateModalComponent,
  StoreEditModalComponent,
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
  ToastService,
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
    StoreEmptyStateComponent,
    StoreCreateModalComponent,
    StoreEditModalComponent,
    StoreSettingsModalComponent,
    InputsearchComponent,
    IconComponent,
    TableComponent,
    ButtonComponent,
  ],
  providers: [StoresService],
  templateUrl: './stores.component.html',
})
export class StoresComponent implements OnInit, OnDestroy, OnChanges {
  stores: StoreListItem[] = [];
  isLoading = false;
  searchTerm = '';
  selectedState = '';
  selectedStoreType = '';
  selectedOrganization = '';

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, width: '160px', priority: 1 },
    { key: 'slug', label: 'Slug', sortable: true, width: '120px', priority: 3 },
    {
      key: 'organizations.name',
      label: 'Organización',
      sortable: true,
      width: '140px',
      defaultValue: 'N/A',
      priority: 2,
    },
    {
      key: 'addresses',
      label: 'Dirección',
      sortable: false,
      width: '150px',
      priority: 3,
      transform: (value: any[]) => {
        if (!value || value.length === 0) return 'N/A';
        const primaryAddress = value.find((addr: any) => addr.is_primary);
        if (primaryAddress) {
          return `${primaryAddress.city}, ${primaryAddress.state_province}`;
        }
        return `${value[0].city}, ${value[0].state_province}`;
      },
    },
    {
      key: 'store_type',
      label: 'Tipo',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          physical: '#22c55e',
          online: '#3b82f6',
          hybrid: '#8b5cf6',
          popup: '#f59e0b',
          kiosko: '#ef4444',
        },
      },
      transform: (value: StoreType) => this.formatStoreType(value),
    },
    {
      key: '_count.store_users',
      label: 'Usuarios',
      sortable: false,
      width: '80px',
      align: 'center',
      defaultValue: '0',
      priority: 3,
    },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      width: '80px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: boolean) => this.formatActiveStatus(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (store) => this.editStore(store),
      variant: 'success',
    },
    {
      label: 'Configuración',
      icon: 'settings',
      action: (store) => this.openSettingsModal(store),
      variant: 'secondary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (store) => this.deleteStore(store),
      variant: 'danger',
    },
  ];

  stats = {
    total_stores: 0,
    active_stores: 0,
    inactive_stores: 0,
    suspended_stores: 0,
    draft_stores: 0,
    total_revenue: 0,
    total_orders: 0,
    total_products: 0,
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
    private toastService: ToastService,
  ) {
    this.initializeCreateForm();
  }

  ngOnInit(): void {
    this.loadStores();
    this.loadStats();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Detect changes and reload if necessary
    if (changes['stores'] && !changes['stores'].firstChange) {
      console.log('Stores changed:', changes['stores'].currentValue);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
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
      state: ['active'],
    });
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.selectedState ||
      this.selectedStoreType ||
      this.selectedOrganization
    );
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
      state: 'active',
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
        Object.keys(this.createStoreForm.controls).forEach((key) => {
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
        store_type: StoreType.PHYSICAL,
      };
    }

    this.isCreatingStore = true;

    const sub = this.storesService
      .createStore(storeData as CreateStoreDto)
      .subscribe({
        next: (response) => {
          console.log('Create store response:', response);
          if (response.success && response.data) {
            this.isCreateModalOpen = false;
            this.loadStores(); // Reload the list
            this.loadStats(); // Reload stats
            this.toastService.success('Tienda creada exitosamente');
            console.log('Store created successfully:', response.data);
          } else {
            console.warn('Invalid create store response:', response);
            this.toastService.error('Respuesta inválida al crear la tienda');
          }
          this.isCreatingStore = false;
        },
        error: (error) => {
          console.error('Error creating store:', error);
          this.toastService.error('Error al crear la tienda');
          this.isCreatingStore = false;
        },
      });

    this.subscriptions.push(sub);
  }

  loadStores(): void {
    this.isLoading = true;

    const query = {
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.selectedState && {
        is_active:
          this.selectedState === 'active'
            ? true
            : this.selectedState === 'inactive'
              ? false
              : undefined,
      }),
      ...(this.selectedStoreType && {
        store_type: this.selectedStoreType as StoreType,
      }),
      ...(this.selectedOrganization && {
        organization_id: parseInt(this.selectedOrganization),
      }),
    };

    const sub = this.storesService.getStores(query).subscribe({
      next: (response) => {
        console.log('Stores response:', response);
        if (response.success && response.data) {
          this.stores = response.data.map((store: any) => ({
            id: store.id,
            name: store.name,
            slug: store.slug,
            store_code: store.store_code || '',
            store_type: store.store_type || StoreType.PHYSICAL,
            timezone: store.timezone || 'America/Bogota',
            is_active: store.is_active !== undefined ? store.is_active : true,
            manager_user_id: store.manager_user_id,
            organization_id: store.organization_id,
            created_at: store.created_at || new Date().toISOString(),
            updated_at: store.updated_at || new Date().toISOString(),
            organizations: store.organizations || {
              id: store.organization_id,
              name: 'Unknown',
              slug: 'unknown',
            },
            addresses: store.addresses || [],
            _count: store._count || { products: 0, orders: 0, store_users: 0 },
          }));
          console.log('Processed stores:', this.stores);
        } else {
          console.warn('Invalid response structure:', response);
          this.stores = [];
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading stores:', error);
        this.isLoading = false;
        // TODO: Show error notification
      },
    });

    this.subscriptions.push(sub);
  }

  loadStats(): void {
    const sub = this.storesService.getStoreStatsList().subscribe({
      next: (response) => {
        console.log('Store stats response:', response);
        if (response.success && response.data) {
          // Map backend response to component stats format
          this.stats = {
            total_stores: response.data.totalStores || 0,
            active_stores: response.data.activeStores || 0,
            inactive_stores: response.data.storesByState?.['false'] || 0,
            suspended_stores: 0, // Backend doesn't track suspended separately
            draft_stores: 0, // Backend doesn't track draft separately
            total_revenue: 0, // Not provided by backend dashboard
            total_orders: 0, // Not provided by backend dashboard
            total_products: 0, // Not provided by backend dashboard
          };
        } else {
          console.warn('Invalid stats response structure:', response);
          // Fallback to calculating stats from loaded data
          this.updateStats();
        }
      },
      error: (error) => {
        console.error('Error loading store stats:', error);
        // Fallback to calculating stats from loaded data
        this.updateStats();
      },
    });

    this.subscriptions.push(sub);
  }

  updateStats(): void {
    this.stats.total_stores = this.stores.length;
    this.stats.active_stores = this.stores.filter(
      (store) => store.is_active === true,
    ).length;
    this.stats.inactive_stores = this.stores.filter(
      (store) => store.is_active === false,
    ).length;
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
    this.loadStores();
  }

  onStoreTypeChange(event: any): void {
    this.selectedStoreType = event.target.value;
    this.loadStores();
  }

  onStateChange(event: any): void {
    this.selectedState = event.target.value;
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

    const sub = this.storesService
      .updateStoreSettings(this.selectedStoreForSettings.id, settingsData)
      .subscribe({
        next: (response) => {
          console.log('Update store settings response:', response);
          if (response.success && response.data) {
            this.isSettingsModalOpen = false;
            this.selectedStoreForSettings = undefined;
            this.toastService.success('Configuración actualizada exitosamente');
            console.log('Store settings updated successfully:', response.data);
          } else {
            console.warn('Invalid update store settings response:', response);
            this.toastService.error(
              'Respuesta inválida al actualizar la configuración',
            );
          }
          this.isUpdatingSettings = false;
        },
        error: (error) => {
          console.error('Error updating store settings:', error);
          this.toastService.error('Error al actualizar la configuración');
          this.isUpdatingSettings = false;
        },
      });

    this.subscriptions.push(sub);
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.loadStores();
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    // TODO: Implement server-side sorting
    console.log('Sort event:', sortEvent);
    // For now, just reload the stores
    this.loadStores();
  }

  // Helper methods for table display
  formatStatus(status: string): string {
    const statusMap: { [key: string]: string } = {
      active: 'Activo',
      inactive: 'Inactivo',
      draft: 'Borrador',
      suspended: 'Suspendido',
      archived: 'Archivado',
    };
    return statusMap[status] || status;
  }

  formatStoreType(type: StoreType): string {
    const typeMap: { [key in StoreType]: string } = {
      [StoreType.PHYSICAL]: 'Física',
      [StoreType.ONLINE]: 'Online',
      [StoreType.HYBRID]: 'Híbrida',
      [StoreType.POPUP]: 'Temporal',
      [StoreType.KIOSKO]: 'Kiosco',
    };
    return typeMap[type] || type;
  }

  formatActiveStatus(isActive: boolean): string {
    return isActive ? 'active' : 'inactive';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  deleteStore(store: StoreListItem): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Tienda',
        message: `¿Estás seguro de que deseas eliminar la tienda "${store.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          const sub = this.storesService.deleteStore(store.id).subscribe({
            next: (response) => {
              console.log('Delete store response:', response);
              if (response.success) {
                this.loadStores(); // Reload the list
                this.toastService.success('Tienda eliminada exitosamente');
              } else {
                console.warn('Invalid delete store response:', response);
                this.toastService.error(
                  'Respuesta inválida al eliminar la tienda',
                );
              }
            },
            error: (error) => {
              console.error('Error deleting store:', error);
              this.toastService.error('Error al eliminar la tienda');
            },
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
      store_type: storeData.store_type || StoreType.PHYSICAL,
    };

    const sub = this.storesService
      .updateStore(this.selectedStore.id, updateData)
      .subscribe({
        next: (response) => {
          console.log('Update store response:', response);
          if (response.success && response.data) {
            this.isEditModalOpen = false;
            this.selectedStore = undefined;
            this.loadStores(); // Reload the list
            this.loadStats(); // Reload stats
            this.toastService.success('Tienda actualizada exitosamente');
            console.log('Store updated successfully:', response.data);
          } else {
            console.warn('Invalid update store response:', response);
            this.toastService.error(
              'Respuesta inválida al actualizar la tienda',
            );
          }
          this.isUpdatingStore = false;
        },
        error: (error) => {
          console.error('Error updating store:', error);
          this.toastService.error('Error al actualizar la tienda');
          this.isUpdatingStore = false;
        },
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
