import {
  Component,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { StoresService } from './services/stores.service';
import {
  StoreListItem,
  StoreState,
  StoreType,
  CreateStoreDto,
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
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  SelectorComponent,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  TableColumn,
  TableAction,
} from '../../../../shared/components/index';

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
    SelectorComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
  ],
  providers: [StoresService],
  templateUrl: './stores.component.html',
})
export class StoresComponent implements OnInit, OnDestroy, OnChanges {
  // Dependencies
  private readonly storesService = inject(StoresService);
  private readonly fb = inject(FormBuilder);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);

  // State
  stores: StoreListItem[] = [];
  isLoading = false;
  searchTerm = '';
  selectedOrganization = '';

  // Filter states
  filterForm: FormGroup;
  storeTypes = [
    { value: '', label: 'Todos los tipos' },
    { value: 'physical', label: 'Física' },
    { value: 'online', label: 'Online' },
    { value: 'hybrid', label: 'Híbrida' },
    { value: 'popup', label: 'Temporal' },
    { value: 'kiosko', label: 'Kiosco' },
  ];
  activeStates = [
    { value: '', label: 'Todos los estados' },
    { value: 'true', label: 'Activo' },
    { value: 'false', label: 'Inactivo' },
  ];

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      width: '160px',
      priority: 1,
    },
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

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'organizations.name',
    badgeKey: 'store_type',
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
    badgeTransform: (value: StoreType) => this.formatStoreType(value),
    detailKeys: [
      { key: 'slug', label: 'Slug' },
      {
        key: 'addresses', label: 'Ciudad', transform: (v) => {
          if (!v || v.length === 0) return 'N/A';
          return v[0].city || 'N/A';
        }
      },
      { key: '_count.store_users', label: 'Usuarios', icon: 'users' },
    ],
    footerKey: 'is_active',
    footerTransform: (val) => (val ? 'Activo' : 'Inactivo'),
  };

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

  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  constructor() {
    this.filterForm = this.fb.group({
      search: [''],
      store_type: [''],
      is_active: [''],
    });
    this.initializeCreateForm();
  }

  ngOnInit(): void {
    this.loadStores();
    this.loadStats();

    // Set up search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((searchTerm) => {
        this.searchTerm = searchTerm;
        this.loadStores();
      });

    // Subscribe to loading states from service
    this.storesService.isLoading$
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => (this.isLoading = loading));

    this.storesService.isCreatingStore$
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => (this.isCreatingStore = loading));

    this.storesService.isUpdatingStore$
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => {
        this.isUpdatingStore = loading;
        this.isUpdatingSettings = loading;
      });

    // Subscribe to filter changes
    this.filterForm.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadStores();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stores'] && !changes['stores'].firstChange) {
      console.log('Stores changed:', changes['stores'].currentValue);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    const filters = this.filterForm.value;
    return !!(filters.search || filters.store_type || filters.is_active);
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
    if (!storeData || storeData instanceof Event) {
      if (this.createStoreForm.invalid) {
        Object.keys(this.createStoreForm.controls).forEach((key) => {
          this.createStoreForm.get(key)?.markAsTouched();
        });
        return;
      }

      const formData = this.createStoreForm.value;
      storeData = {
        name: formData.name,
        slug: formData.slug,
        store_code: formData.name.toLowerCase().replace(/\s+/g, '-'),
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

    this.storesService
      .createStore(storeData as CreateStoreDto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.isCreateModalOpen = false;
            this.loadStores();
            this.loadStats();
            this.toastService.success('Tienda creada exitosamente');
          } else {
            this.toastService.error('Respuesta inválida al crear la tienda');
          }
        },
        error: (error) => {
          this.toastService.error('Error al crear la tienda');
        },
      });
  }

  loadStores(): void {
    const filters = this.filterForm.value;
    const query = {
      ...(filters.search && { search: filters.search }),
      ...(filters.is_active && {
        is_active: filters.is_active === 'true',
      }),
      ...(filters.store_type && {
        store_type: filters.store_type as StoreType,
      }),
      ...(this.selectedOrganization && {
        organization_id: parseInt(this.selectedOrganization),
      }),
    };

    this.storesService
      .getStores(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
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
          } else {
            this.stores = [];
          }
        },
        error: (error) => {
          console.error('Error loading stores:', error);
          this.toastService.error('Error al cargar las tiendas');
        },
      });
  }

  loadStats(): void {
    this.storesService
      .getStoreStatsList()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.stats = {
              total_stores: response.data.totalStores || 0,
              active_stores: response.data.activeStores || 0,
              inactive_stores: response.data.storesByState?.['false'] || 0,
              suspended_stores: 0,
              draft_stores: 0,
              total_revenue: 0,
              total_orders: 0,
              total_products: 0,
            };
          } else {
            this.updateStats();
          }
        },
        error: (error) => {
          this.updateStats();
        },
      });
  }

  updateStats(): void {
    this.stats.total_stores = this.stores.length;
    this.stats.active_stores = this.stores.filter(
      (store) => store.is_active === true,
    ).length;
    this.stats.inactive_stores = this.stores.filter(
      (store) => store.is_active === false,
    ).length;
    this.stats.suspended_stores = 0;
    this.stats.draft_stores = 0;
  }

  refreshStores(): void {
    this.loadStores();
  }

  clearFilters(): void {
    this.filterForm.reset({
      search: '',
      store_type: '',
      is_active: '',
    });
    this.selectedOrganization = '';
  }

  onStoreTypeChange(value: string): void {
    this.filterForm.patchValue({ store_type: value });
  }

  onStateChange(value: string): void {
    this.filterForm.patchValue({ is_active: value });
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

    this.storesService
      .updateStoreSettings(this.selectedStoreForSettings.id, settingsData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.isSettingsModalOpen = false;
            this.selectedStoreForSettings = undefined;
            this.toastService.success('Configuración actualizada exitosamente');
          } else {
            this.toastService.error(
              'Respuesta inválida al actualizar la configuración',
            );
          }
        },
        error: (error) => {
          this.toastService.error('Error al actualizar la configuración');
        },
      });
  }

  onSearchChange(searchTerm: string): void {
    this.filterForm.patchValue({ search: searchTerm });
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    this.loadStores();
  }

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
          this.storesService
            .deleteStore(store.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (response) => {
                if (response.success) {
                  this.loadStores();
                  this.toastService.success('Tienda eliminada exitosamente');
                } else {
                  this.toastService.error(
                    'Respuesta inválida al eliminar la tienda',
                  );
                }
              },
              error: (error) => {
                this.toastService.error('Error al eliminar la tienda');
              },
            });
        }
      });
  }

  viewStore(store: StoreListItem): void {
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

    this.storesService
      .updateStore(this.selectedStore.id, updateData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.isEditModalOpen = false;
            this.selectedStore = undefined;
            this.loadStores();
            this.loadStats();
            this.toastService.success('Tienda actualizada exitosamente');
          } else {
            this.toastService.error(
              'Respuesta inválida al actualizar la tienda',
            );
          }
        },
        error: (error) => {
          this.toastService.error('Error al actualizar la tienda');
        },
      });
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
