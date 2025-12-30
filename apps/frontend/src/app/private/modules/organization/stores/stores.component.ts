import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import {
  StoreListItem,
  StoreQueryDto,
  Store,

  StoreFilters,
  StoreType,
} from './interfaces/store.interface';
import { OrganizationStoresService } from './services/organization-stores.service';

// Import new components
import {
  StoreEmptyStateComponent,
  StoreCreateModalComponent,
  StoreEditModalComponent,
} from './components/index';

import { StoreSettingsModalComponent } from './components/store-settings-modal/store-settings-modal.component';

import { EnvironmentSwitchService } from '../../../../core/services/environment-switch.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';

// Import shared components
import {
  InputsearchComponent,
  IconComponent,
  TableComponent,
  ButtonComponent,
  ToastService,
} from '../../../../shared/components/index';
import {
  TableColumn,
  TableAction,
  StatsComponent,
} from '../../../../shared/components/index';

interface StatItem {
  title: string;
  value: string | number;
  smallText: string;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    StatsComponent,
    StoreEmptyStateComponent,
    StoreCreateModalComponent,
    StoreEditModalComponent,
    StoreSettingsModalComponent,
    InputsearchComponent,
    IconComponent,
    TableComponent,
    ButtonComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6">
        <app-stats
          *ngFor="let item of statsItems"
          [title]="item.title"
          [value]="item.value"
          [smallText]="item.smallText"
          [iconName]="item.iconName"
          [iconBgColor]="item.iconBgColor"
          [iconColor]="item.iconColor"
        >
        </app-stats>
      </div>

      <!-- Stores List -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Todas las tiendas ({{ stores.length }})
              </h2>
            </div>

            <div
              class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
            >
              <!-- Input de búsqueda compacto -->
              <app-inputsearch
                class="w-full sm:w-64"
                size="sm"
                placeholder="Buscar tiendas..."
                [debounceTime]="1000"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>

              <!-- Filtro de tipo de tienda -->
              <select
                class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
                (change)="onStoreTypeChange($event)"
                [value]="selectedStoreType"
              >
                <option value="">Todos los Tipos</option>
                <option value="physical">Tienda Física</option>
                <option value="online">Tienda Online</option>
                <option value="hybrid">Tienda Híbrida</option>
                <option value="popup">Tienda Temporal</option>
                <option value="kiosko">Kiosko</option>
              </select>

              <!-- Filtro de estado -->
              <select
                class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
                (change)="onStateChange($event)"
                [value]="selectedState"
              >
                <option value="">Todos los Estados</option>
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
              </select>

              <div class="flex gap-2 items-center">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="refreshStores()"
                  [disabled]="isLoading"
                  title="Actualizar"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateStoreModal()"
                  title="Nueva Tienda"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Nueva Tienda</span>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="p-8 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando tiendas...</p>
        </div>

        <!-- Empty State -->
        <app-store-empty-state
          *ngIf="!isLoading && stores.length === 0"
          [title]="getEmptyStateTitle()"
          [description]="getEmptyStateDescription()"
          [showAdditionalActions]="hasFilters"
          (actionClick)="openCreateStoreModal()"
          (refreshClick)="refreshStores()"
          (clearFiltersClick)="clearFilters()"
        >
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
            (rowClick)="viewStore($event)"
          >
          </app-table>
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
        [isOpen]="isSettingsModalOpen"
        [isSubmitting]="isUpdatingSettings"
        [settings]="selectedStoreForSettings?.settings || null"
        (openChange)="onSettingsModalChange($event)"
        (submit)="updateStoreSettings($event)"
        (cancel)="onSettingsModalCancel()"
      ></app-store-settings-modal>
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
export class StoresComponent implements OnInit, OnDestroy {
  stores: StoreListItem[] = [];
  isLoading = false;
  searchTerm = '';
  selectedState = '';
  selectedStoreType = '';

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, width: '200px', priority: 1 },
    { key: 'slug', label: 'Slug', sortable: true, width: '150px', priority: 3 },
    {
      key: 'organizations.name',
      label: 'Organización',
      sortable: true,
      width: '180px',
      defaultValue: 'N/A',
      priority: 2,
    },
    {
      key: 'addresses',
      label: 'Dirección',
      sortable: false,
      width: '200px',
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
      width: '120px',
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
      width: '100px',
      align: 'center',
      defaultValue: '0',
      priority: 3,
    },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      width: '100px',
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
      variant: 'primary',
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

  constructor(
    private storesService: OrganizationStoresService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService,
    private environmentSwitchService: EnvironmentSwitchService,
  ) {
    this.initializeCreateForm();
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
      state: ['active'],
    });
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm || this.selectedState || this.selectedStoreType);
  }

  ngOnInit(): void {
    this.loadStores();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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

  createStore(storeData?: any | Event): void {
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
        is_active: formData.state === 'active' ? true : false,
        store_type: StoreType.PHYSICAL,
      };
    }

    this.isCreatingStore = true;

    this.storesService
      .createStore(storeData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('Create store response:', response);
          if (response.success && response.data) {
            this.isCreateModalOpen = false;
            this.loadStores();
            this.loadStats();
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
    };

    this.storesService.getStores(query).subscribe({
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
            onboarding: store.onboarding || false,
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
      },
    });
  }

  statsItems: StatItem[] = [];

  loadStats(): void {
    this.storesService
      .getOrganizationStoreStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const data = response.data || {};

          this.statsItems = [
            {
              title: 'Total Tiendas',
              value: data.total_stores || 0,
              smallText: 'Registradas',
              iconName: 'building',
              iconBgColor: 'bg-primary/10',
              iconColor: 'text-primary'
            },
            {
              title: 'Activas',
              value: data.active_stores || 0,
              smallText: 'En funcionamiento',
              iconName: 'check-circle',
              iconBgColor: 'bg-green-100',
              iconColor: 'text-green-600'
            },
            {
              title: 'Total Pedidos',
              value: this.formatNumber(data.total_orders || 0),
              smallText: 'Procesados',
              iconName: 'shopping-cart',
              iconBgColor: 'bg-pink-100',
              iconColor: 'text-pink-600'
            },
            {
              title: 'Total Ganancias',
              value: this.formatCurrency(data.total_revenue || 0),
              smallText: 'Ingresos totales',
              iconName: 'dollar-sign',
              iconBgColor: 'bg-blue-100',
              iconColor: 'text-blue-600'
            }
          ];
        },
        error: (error) => {
          console.error('Error loading stats:', error);
          this.toastService.error('Error al cargar estadísticas');
        },
      });
  }

  // Formatear número para visualización
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  // Formatear moneda
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  refreshStores(): void {
    this.loadStores();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedState = '';
    this.selectedStoreType = '';
    this.loadStores();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
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

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    console.log('Sort event:', sortEvent);
    this.loadStores();
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
          console.log('Update store response:', response);
          if (response.success && response.data) {
            this.isEditModalOpen = false;
            this.selectedStore = undefined;
            this.loadStores();
            this.loadStats();
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
  }

  // Store actions
  viewStore(store: StoreListItem): void {
    console.log('View store:', store);
    this.switchToStoreEnvironment(store);
  }

  toggleStoreStatus(store: StoreListItem): void {
    const newStatus = store.is_active ? 'inactive' : 'active';
    const action = store.is_active ? 'deactivate' : 'activate';

    if (
      confirm(
        `¿Está seguro de que desea ${action === 'deactivate' ? 'desactivar' : 'activar'} la tienda "${store.name}"?`,
      )
    ) {
      this.storesService
        .updateStore(store.id, { is_active: !store.is_active })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            store.is_active = !store.is_active;
            this.loadStats();
            this.toastService.success(
              `Tienda ${action === 'deactivate' ? 'desactivada' : 'activada'} exitosamente`,
            );
          },
          error: (error) => {
            console.error('Error toggling store status:', error);
            this.toastService.error(
              `Error al ${action === 'deactivate' ? 'desactivar' : 'activar'} la tienda`,
            );
          },
        });
    }
  }

  deleteStore(store: StoreListItem): void {
    if (
      confirm(
        `¿Está seguro de que desea eliminar la tienda "${store.name}"? Esta acción no se puede deshacer.`,
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

    this.storesService
      .updateStoreSettings(this.selectedStoreForSettings.id, settingsData)
      .pipe(takeUntil(this.destroy$))
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
  }

  // Helper methods for table display
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

  private async switchToStoreEnvironment(store: StoreListItem): Promise<void> {
    try {
      const confirmed = await this.dialogService.confirm(
        {
          title: 'Cambiar al entorno de la tienda',
          message: `¿Deseas cambiar al entorno de administración de la tienda <strong class="text-lg font-semibold text-[var(--color-primary)]">${store.name}</strong>?<br><br>Serás redirigido al panel de administración de STORE_ADMIN para esta tienda específica.`,
          confirmText: 'Cambiar de entorno',
          cancelText: 'Cancelar',
          confirmVariant: 'primary',
        },
        {
          size: 'md',
          customClasses: 'store-switch-modal',
        },
      );

      if (confirmed) {
        const success =
          await this.environmentSwitchService.performEnvironmentSwitch(
            'STORE_ADMIN',
            store.slug,
          );

        if (success) {
          this.toastService.success(
            `Cambiado al entorno de la tienda "${store.name}"`,
          );
        } else {
          this.toastService.error('No se pudo cambiar al entorno de la tienda');
        }
      }
    } catch (error) {
      console.error('Error switching to store environment:', error);
      this.toastService.error('Error al cambiar al entorno de la tienda');
    }
  }
}
