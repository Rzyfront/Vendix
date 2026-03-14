import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import { StoreRole, StoreRoleStats } from './interfaces/store-role.interface';
import { StoreRolesService } from './services/store-roles.service';

import {
  StoreRoleCreateModalComponent,
  StoreRoleEditModalComponent,
  StoreRolePermissionsModalComponent,
} from './components/index';

import {
  TableColumn,
  TableAction,
  DialogService,
  ToastService,
  StatsComponent,
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../shared/components/index';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

interface StatItem {
  title: string;
  value: number;
  smallText: string;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

@Component({
  selector: 'app-store-roles-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    StoreRoleCreateModalComponent,
    StoreRoleEditModalComponent,
    StoreRolePermissionsModalComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    StatsComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Grid: sticky at top on mobile -->
      <div
        class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          *ngFor="let item of statsItems"
          [title]="item.title"
          [value]="item.value"
          [smallText]="item.smallText"
          [iconName]="item.iconName"
          [iconBgColor]="item.iconBgColor"
          [iconColor]="item.iconColor"
        ></app-stats>
      </div>

      <!-- Roles Table Header -->
      <div
        class="p-2 md:px-6 md:py-4 border-b border-border sticky top-0 bg-surface z-10"
      >
        <div
          class="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 md:gap-4"
        >
          <!-- Titulo y contador -->
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              Roles ({{ roles.length }})
            </h2>
          </div>

          <!-- Controles compactos -->
          <div
            class="flex flex-wrap items-center gap-3 w-full md:w-auto"
            [formGroup]="filterForm"
          >
            <!-- Busqueda -->
            <app-inputsearch
              class="min-w-[200px] flex-1 md:flex-none"
              size="sm"
              placeholder="Buscar roles..."
              [debounceTime]="500"
              (searchChange)="onSearchChange($event)"
            ></app-inputsearch>

            <!-- Filtro por tipo -->
            <select
              formControlName="type"
              class="px-3 py-2 border border-border rounded-button bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary text-sm min-w-[140px]"
              [disabled]="isLoading"
            >
              <option *ngFor="let type of roleTypes" [value]="type.value">
                {{ type.label }}
              </option>
            </select>

            <!-- Botones de accion -->
            <div class="flex gap-2 items-center">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="refreshRoles()"
                [disabled]="isLoading"
                title="Actualizar"
              >
                <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="createRole()"
                title="Nuevo Rol"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                <span class="hidden md:inline ml-2">Nuevo</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="p-2 md:p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando roles...</p>
        </div>

        <!-- Empty State -->
        <div
          *ngIf="!isLoading && filteredRoles.length === 0"
          class="p-8 text-center"
        >
          <app-icon
            name="shield"
            [size]="48"
            class="text-text-secondary mx-auto mb-4"
          ></app-icon>
          <h3 class="text-lg font-medium text-text-primary mb-2">
            {{ getEmptyStateTitle() }}
          </h3>
          <p class="text-text-secondary mb-4">
            {{ getEmptyStateDescription() }}
          </p>
          <app-button variant="primary" size="sm" (clicked)="createRole()">
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Crear Rol
          </app-button>
        </div>

        <!-- Responsive Data View -->
        <app-responsive-data-view
          *ngIf="filteredRoles.length > 0"
          [data]="filteredRoles"
          [columns]="tableColumns"
          [actions]="tableActions"
          [cardConfig]="cardConfig"
          [loading]="isLoading"
          (sort)="onSortChange($event.column, $event.direction)"
        >
        </app-responsive-data-view>
      </div>

      <!-- Create Role Modal -->
      <app-store-role-create-modal
        [(isOpen)]="showCreateModal"
        (onRoleCreated)="onRoleCreated()"
      ></app-store-role-create-modal>

      <!-- Edit Role Modal -->
      <app-store-role-edit-modal
        *ngIf="currentRole"
        [role]="currentRole"
        [(isOpen)]="showEditModal"
        (onRoleUpdated)="onRoleUpdated()"
      ></app-store-role-edit-modal>

      <!-- Permissions Modal -->
      <app-store-role-permissions-modal
        *ngIf="permissionsRole"
        [role]="permissionsRole"
        [(isOpen)]="showPermissionsModal"
        (onPermissionsUpdated)="onPermissionsUpdated()"
      ></app-store-role-permissions-modal>
    </div>
  `,
})
export class StoreRolesSettingsComponent implements OnInit, OnDestroy {
  roles: StoreRole[] = [];
  filteredRoles: StoreRole[] = [];
  roleStats: StoreRoleStats | null = null;
  statsItems: StatItem[] = [];
  isLoading = false;
  currentRole: StoreRole | null = null;
  permissionsRole: StoreRole | null = null;
  showCreateModal = false;
  showEditModal = false;
  showPermissionsModal = false;
  searchTerm = '';
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  // Form for filters
  filterForm: FormGroup;

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      width: '150px',
      priority: 1,
    },
    {
      key: 'description',
      label: 'Descripcion',
      sortable: true,
      width: '200px',
      priority: 2,
    },
    {
      key: 'system_role',
      label: 'Tipo',
      sortable: true,
      width: '100px',
      priority: 1,
      badge: true,
      transform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    },
    {
      key: '_count.user_roles',
      label: 'Usuarios',
      width: '80px',
      priority: 2,
      transform: (value: any, item: any) => item?._count?.user_roles || 0,
    },
    {
      key: 'permissions',
      label: 'Permisos',
      width: '80px',
      priority: 3,
      transform: (value: any) => (Array.isArray(value) ? value.length : 0),
    },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    subtitleTransform: (value: any) => value || 'Sin descripcion',
    badgeKey: 'system_role',
    badgeTransform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    detailKeys: [
      {
        key: '_count',
        label: 'Usuarios',
        transform: (v: any) => v?.user_roles || 0,
      },
    ],
  };

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (role: StoreRole) => this.editRole(role),
      variant: 'success',
      show: (role: StoreRole) => !role.system_role,
    },
    {
      label: 'Permisos',
      icon: 'key',
      action: (role: StoreRole) => this.managePermissions(role),
      variant: 'primary',
    },
    {
      label: 'Eliminar',
      icon: 'trash',
      action: (role: StoreRole) => this.deleteRole(role),
      variant: 'danger',
      show: (role: StoreRole) => !role.system_role,
    },
  ];

  // Filter types
  roleTypes = [
    { value: '', label: 'Todos' },
    { value: 'system', label: 'Sistema' },
    { value: 'custom', label: 'Personalizado' },
  ];

  constructor(
    private storeRolesService: StoreRolesService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      type: [''],
    });

    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((searchTerm: string) => {
        this.searchTerm = searchTerm;
        this.applyFilters();
      });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadStats();

    // Subscribe to form changes (type filter)
    this.filterForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.applyFilters();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadRoles(): void {
    this.isLoading = true;

    this.storeRolesService
      .getRoles()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.roles = response.data || [];
          this.applyFilters();
        },
        error: (error) => {
          console.error('Error loading store roles:', error);
          this.roles = [];
          this.filteredRoles = [];
        },
      })
      .add(() => {
        this.isLoading = false;
      });
  }

  loadStats(): void {
    this.storeRolesService.getStats().subscribe({
      next: (stats) => {
        this.roleStats = stats;
        this.updateStatsItems();
      },
      error: (err) => console.error('Error loading store role stats', err),
    });
  }

  private applyFilters(): void {
    let filtered = [...this.roles];
    const typeFilter = this.filterForm.get('type')?.value;

    // Apply type filter
    if (typeFilter === 'system') {
      filtered = filtered.filter((r) => r.system_role);
    } else if (typeFilter === 'custom') {
      filtered = filtered.filter((r) => !r.system_role);
    }

    // Apply search filter
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          (r.description && r.description.toLowerCase().includes(term)),
      );
    }

    this.filteredRoles = filtered;
  }

  private updateStatsItems(): void {
    const s = this.roleStats || {
      total_roles: 0,
      system_roles: 0,
      custom_roles: 0,
      total_store_permissions: 0,
    };

    this.statsItems = [
      {
        title: 'Total Roles',
        value: s.total_roles || 0,
        smallText: 'en la tienda',
        iconName: 'shield',
        iconBgColor: 'bg-primary/10',
        iconColor: 'text-primary',
      },
      {
        title: 'Sistema',
        value: s.system_roles || 0,
        smallText: 'roles del sistema',
        iconName: 'lock',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-600',
      },
      {
        title: 'Personalizados',
        value: s.custom_roles || 0,
        smallText: 'roles personalizados',
        iconName: 'edit',
        iconBgColor: 'bg-green-100',
        iconColor: 'text-green-600',
      },
      {
        title: 'Permisos Store',
        value: s.total_store_permissions || 0,
        smallText: 'permisos disponibles',
        iconName: 'key',
        iconBgColor: 'bg-yellow-100',
        iconColor: 'text-yellow-600',
      },
    ];
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onSortChange(column: string, direction: 'asc' | 'desc' | null): void {
    // Client-side sorting since roles are loaded all at once
    if (!direction) return;
    this.filteredRoles.sort((a: any, b: any) => {
      const valA = a[column];
      const valB = b[column];
      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  refreshRoles(): void {
    this.storeRolesService.invalidateCache();
    this.loadRoles();
    this.loadStats();
  }

  createRole(): void {
    this.showCreateModal = true;
  }

  onRoleCreated(): void {
    this.showCreateModal = false;
    this.storeRolesService.invalidateCache();
    this.loadRoles();
    this.loadStats();
  }

  editRole(role: StoreRole): void {
    this.currentRole = role;
    this.showEditModal = true;
  }

  onRoleUpdated(): void {
    this.showEditModal = false;
    this.currentRole = null;
    this.storeRolesService.invalidateCache();
    this.loadRoles();
    this.loadStats();
  }

  managePermissions(role: StoreRole): void {
    this.permissionsRole = role;
    this.showPermissionsModal = true;
  }

  onPermissionsUpdated(): void {
    this.showPermissionsModal = false;
    this.permissionsRole = null;
    this.storeRolesService.invalidateCache();
    this.loadRoles();
    this.loadStats();
  }

  deleteRole(role: StoreRole): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Rol',
        message: `Estas seguro de que deseas eliminar el rol "${role.name}"? Esta accion no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.storeRolesService.deleteRole(role.id).subscribe({
            next: () => {
              this.storeRolesService.invalidateCache();
              this.loadRoles();
              this.loadStats();
              this.toastService.success('Rol eliminado exitosamente');
            },
            error: (error) => {
              console.error('Error deleting role:', error);
              const message =
                error?.error?.message || 'Error al eliminar el rol';
              this.toastService.error(message);
            },
          });
        }
      });
  }

  getEmptyStateTitle(): string {
    const typeFilter = this.filterForm.get('type')?.value;
    if (this.searchTerm || typeFilter) {
      return 'No se encontraron roles con esos filtros';
    }
    return 'No hay roles registrados';
  }

  getEmptyStateDescription(): string {
    const typeFilter = this.filterForm.get('type')?.value;
    if (this.searchTerm || typeFilter) {
      return 'Intenta ajustar los terminos de busqueda o filtros';
    }
    return 'Comienza creando el primer rol personalizado de la tienda.';
  }
}
