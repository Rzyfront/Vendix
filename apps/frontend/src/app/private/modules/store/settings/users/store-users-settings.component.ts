import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  StoreUser,
  StoreUserQuery,
  StoreUserStats,
  StoreUserState,
  PaginatedStoreUsersResponse,
} from './interfaces/store-user.interface';
import { StoreUsersManagementService } from './services/store-users-management.service';

import {
  StoreUserCreateModalComponent,
  StoreUserEditModalComponent,
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
  selector: 'app-store-users-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    StoreUserCreateModalComponent,
    StoreUserEditModalComponent,
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

      <!-- Users Table Header -->
      <div
        class="p-2 md:px-6 md:py-4 border-b border-border sticky top-0 bg-surface z-10"
      >
        <div
          class="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 md:gap-4"
        >
          <!-- Titulo y contador -->
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              Usuarios ({{ users.length }})
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
              placeholder="Buscar usuarios..."
              [debounceTime]="500"
              (searchChange)="onSearchChange($event)"
            ></app-inputsearch>

            <!-- Filtro por estado -->
            <select
              formControlName="state"
              class="px-3 py-2 border border-border rounded-button bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary text-sm min-w-[140px]"
              [disabled]="isLoading"
            >
              <option *ngFor="let state of userStates" [value]="state.value">
                {{ state.label }}
              </option>
            </select>

            <!-- Botones de accion -->
            <div class="flex gap-2 items-center">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="refreshUsers()"
                [disabled]="isLoading"
                title="Actualizar"
              >
                <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="createUser()"
                title="Nuevo Usuario"
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
          <p class="mt-2 text-text-secondary">Cargando usuarios...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!isLoading && users.length === 0" class="p-8 text-center">
          <app-icon
            name="users"
            [size]="48"
            class="text-text-secondary mx-auto mb-4"
          ></app-icon>
          <h3 class="text-lg font-medium text-text-primary mb-2">
            {{ getEmptyStateTitle() }}
          </h3>
          <p class="text-text-secondary mb-4">
            {{ getEmptyStateDescription() }}
          </p>
          <app-button variant="primary" size="sm" (clicked)="createUser()">
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Crear Usuario
          </app-button>
        </div>

        <!-- Responsive Data View -->
        <app-responsive-data-view
          *ngIf="users.length > 0"
          [data]="users"
          [columns]="tableColumns"
          [actions]="tableActions"
          [cardConfig]="cardConfig"
          [loading]="isLoading"
          (sort)="onSortChange($event.column, $event.direction)"
        >
        </app-responsive-data-view>
      </div>

      <!-- Create User Modal -->
      <app-store-user-create-modal
        [(isOpen)]="showCreateModal"
        (onUserCreated)="onUserCreated()"
      ></app-store-user-create-modal>

      <!-- Edit User Modal -->
      <app-store-user-edit-modal
        *ngIf="currentUser"
        [user]="currentUser"
        [(isOpen)]="showEditModal"
        (onUserUpdated)="onUserUpdated()"
      ></app-store-user-edit-modal>
    </div>
  `,
})
export class StoreUsersSettingsComponent implements OnInit, OnDestroy {
  users: StoreUser[] = [];
  userStats: StoreUserStats | null = null;
  statsItems: StatItem[] = [];
  isLoading = false;
  currentUser: StoreUser | null = null;
  showCreateModal = false;
  showEditModal = false;
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  // Form for filters
  filterForm: FormGroup;

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'first_name',
      label: 'Nombre',
      sortable: true,
      width: '120px',
      priority: 1,
    },
    {
      key: 'last_name',
      label: 'Apellido',
      sortable: true,
      width: '120px',
      priority: 1,
    },
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      width: '200px',
      priority: 1,
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      width: '120px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: StoreUserState) => this.getStateDisplay(value).text,
    },
    {
      key: 'created_at',
      label: 'Fecha Creacion',
      sortable: true,
      width: '140px',
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'first_name',
    titleTransform: (item: StoreUser) => `${item.first_name} ${item.last_name}`,
    subtitleKey: 'email',
    badgeKey: 'state',
    badgeConfig: {
      type: 'status',
      size: 'sm',
    },
    badgeTransform: (value: StoreUserState) => this.getStateDisplay(value).text,
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        transform: (v) => this.formatDate(v),
      },
    ],
  };

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (user: StoreUser) => this.editUser(user),
      variant: 'success',
    },
    {
      label: 'Desactivar',
      icon: 'user-x',
      action: (user: StoreUser) => this.toggleUserStatus(user),
      variant: 'danger',
      show: (user: StoreUser) => user.state === StoreUserState.ACTIVE,
    },
    {
      label: 'Reactivar',
      icon: 'user-check',
      action: (user: StoreUser) => this.toggleUserStatus(user),
      variant: 'success',
      show: (user: StoreUser) => user.state !== StoreUserState.ACTIVE,
    },
  ];

  // Pagination
  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  // Filter states
  userStates = [
    { value: '', label: 'Todos los estados' },
    { value: StoreUserState.ACTIVE, label: 'Activo' },
    { value: StoreUserState.INACTIVE, label: 'Inactivo' },
    {
      value: StoreUserState.PENDING_VERIFICATION,
      label: 'Pendiente de Verificacion',
    },
    { value: StoreUserState.SUSPENDED, label: 'Suspendido' },
    { value: StoreUserState.ARCHIVED, label: 'Archivado' },
  ];

  constructor(
    private storeUsersService: StoreUsersManagementService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      state: [''],
    });

    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((searchTerm: string) => {
        this.filterForm.patchValue(
          { search: searchTerm },
          { emitEvent: false },
        );
        this.pagination.page = 1;
        this.loadUsers();
      });
  }

  ngOnInit(): void {
    this.loadUsers();
    this.loadStats();

    // Subscribe to form changes (state filter)
    this.filterForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.pagination.page = 1;
        this.loadUsers();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadUsers(): void {
    this.isLoading = true;
    const filters = this.filterForm.value;
    const query: StoreUserQuery = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      search: filters.search || undefined,
      state: filters.state || undefined,
    };

    this.storeUsersService
      .getUsers(query)
      .subscribe({
        next: (response: PaginatedStoreUsersResponse) => {
          this.users = response.data || [];

          if (response.pagination) {
            this.pagination = {
              page: response.pagination.page || 1,
              limit: response.pagination.limit || 10,
              total: response.pagination.total || 0,
              totalPages: response.pagination.total_pages || 0,
            };
          } else {
            this.pagination = {
              page: 1,
              limit: 10,
              total: this.users.length,
              totalPages: 1,
            };
          }
        },
        error: (error) => {
          console.error('Error loading store users:', error);
          this.users = [];
          this.pagination = {
            page: 1,
            limit: 10,
            total: 0,
            totalPages: 0,
          };
        },
      })
      .add(() => {
        this.isLoading = false;
      });
  }

  loadStats(): void {
    this.storeUsersService.getStats().subscribe({
      next: (stats) => {
        this.userStats = stats;
        this.updateStatsItems();
      },
      error: (err) => console.error('Error loading store user stats', err),
    });
  }

  private updateStatsItems(): void {
    const s = this.userStats || {
      total: 0,
      activos: 0,
      inactivos: 0,
      pendientes: 0,
    };
    const total = s.total || 0;

    this.statsItems = [
      {
        title: 'Total Usuarios',
        value: total,
        smallText: 'en la tienda',
        iconName: 'users',
        iconBgColor: 'bg-primary/10',
        iconColor: 'text-primary',
      },
      {
        title: 'Activos',
        value: s.activos || 0,
        smallText: `${this.calculatePercentage(s.activos || 0, total)}% del total`,
        iconName: 'check-circle',
        iconBgColor: 'bg-green-100',
        iconColor: 'text-green-600',
      },
      {
        title: 'Inactivos',
        value: s.inactivos || 0,
        smallText: `${this.calculatePercentage(s.inactivos || 0, total)}% del total`,
        iconName: 'user-x',
        iconBgColor: 'bg-gray-100',
        iconColor: 'text-gray-600',
      },
      {
        title: 'Pendientes',
        value: s.pendientes || 0,
        smallText: `${this.calculatePercentage(s.pendientes || 0, total)}% del total`,
        iconName: 'clock',
        iconBgColor: 'bg-yellow-100',
        iconColor: 'text-yellow-600',
      },
    ];
  }

  private calculatePercentage(part: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onPageChange(page: number): void {
    this.pagination.page = page;
    this.loadUsers();
  }

  onSortChange(column: string, direction: 'asc' | 'desc' | null): void {
    this.loadUsers();
  }

  refreshUsers(): void {
    this.storeUsersService.invalidateCache();
    this.loadUsers();
    this.loadStats();
  }

  createUser(): void {
    this.showCreateModal = true;
  }

  onUserCreated(): void {
    this.showCreateModal = false;
    this.storeUsersService.invalidateCache();
    this.loadUsers();
    this.loadStats();
  }

  editUser(user: StoreUser): void {
    this.currentUser = user;
    this.showEditModal = true;
  }

  onUserUpdated(): void {
    this.showEditModal = false;
    this.currentUser = null;
    this.storeUsersService.invalidateCache();
    this.loadUsers();
    this.loadStats();
  }

  toggleUserStatus(user: StoreUser): void {
    const isActive = user.state === StoreUserState.ACTIVE;
    const actionText = isActive ? 'desactivar' : 'reactivar';
    const actionTitle = isActive ? 'Desactivar' : 'Reactivar';

    this.dialogService
      .confirm({
        title: `${actionTitle} Usuario`,
        message: `Estas seguro de que deseas ${actionText} al usuario "${user.first_name} ${user.last_name}"?`,
        confirmText: actionTitle,
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          const action$ = isActive
            ? this.storeUsersService.deactivateUser(user.id)
            : this.storeUsersService.reactivateUser(user.id);

          action$.subscribe({
            next: () => {
              this.storeUsersService.invalidateCache();
              this.loadUsers();
              this.loadStats();
              this.toastService.success(
                `Usuario ${isActive ? 'desactivado' : 'reactivado'} exitosamente`,
              );
            },
            error: (error) => {
              console.error(`Error ${actionText} user:`, error);
              this.toastService.error(`Error al ${actionText} el usuario`);
            },
          });
        }
      });
  }

  getStateDisplay(state: StoreUserState): { text: string; class: string } {
    switch (state) {
      case StoreUserState.ACTIVE:
        return { text: 'Activo', class: 'bg-green-100 text-green-800' };
      case StoreUserState.INACTIVE:
        return { text: 'Inactivo', class: 'bg-gray-100 text-gray-800' };
      case StoreUserState.PENDING_VERIFICATION:
        return { text: 'Pendiente', class: 'bg-yellow-100 text-yellow-800' };
      case StoreUserState.SUSPENDED:
        return { text: 'Suspendido', class: 'bg-orange-100 text-orange-800' };
      case StoreUserState.ARCHIVED:
        return { text: 'Archivado', class: 'bg-red-100 text-red-800' };
      default:
        return { text: 'Desconocido', class: 'bg-gray-100 text-gray-800' };
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state) {
      return 'No se encontraron usuarios con esos filtros';
    }
    return 'No hay usuarios registrados';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state) {
      return 'Intenta ajustar los terminos de busqueda o filtros';
    }
    return 'Comienza creando el primer usuario de la tienda.';
  }
}
