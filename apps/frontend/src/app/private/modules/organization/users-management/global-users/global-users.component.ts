import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  User,
  UserQueryDto,
  UserStats,
  UserState,
  PaginatedUsersResponse,
} from '../../users/interfaces/user.interface';
import { GlobalUsersService } from './services/global-users.service';
import { UserStatsService } from './services/user-stats.service';
import {
  UserStatsComponent,
  UserCreateModalComponent,
  UserEditModalComponent,
  UserEmptyStateComponent,
} from '../../users/components/index';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  DialogService,
  ToastService,
} from '../../../../../shared/components/index';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

@Component({
  selector: 'app-global-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    UserStatsComponent,
    UserCreateModalComponent,
    UserEditModalComponent,
    UserEmptyStateComponent,
    TableComponent,
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <app-user-stats [stats]="userStats"></app-user-stats>

      <!-- Users Table Container -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div
            class="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4"
          >
            <!-- Título y contador -->
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Usuarios ({{ users.length }})
              </h2>
            </div>

            <!-- Controles compactos -->
            <div class="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              <!-- Búsqueda -->
              <app-inputsearch
                class="min-w-[200px] flex-1 lg:flex-none"
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

              <!-- Botones de acción -->
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
                  <span class="hidden sm:inline ml-2">Nuevo</span>
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
          <p class="mt-2 text-text-secondary">Cargando usuarios...</p>
        </div>

        <!-- Empty State -->
        <app-user-empty-state
          *ngIf="!isLoading && users.length === 0"
          [title]="getEmptyStateTitle()"
          [description]="getEmptyStateDescription()"
          (actionClick)="createUser()"
        >
        </app-user-empty-state>

        <!-- Table View -->
        <div *ngIf="users.length > 0" class="p-6">
          <app-table
            [data]="users"
            [columns]="tableColumns"
            [actions]="tableActions"
            [loading]="isLoading"
            (sort)="onSortChange($event.column, $event.direction)"
          >
            <!-- Custom cell for status -->
            <ng-template #statusCell let-item>
              <span
                class="px-2 py-1 text-xs font-medium rounded-full"
                [class]="getStateDisplay(item.state).class"
              >
                {{ getStateDisplay(item.state).text }}
              </span>
            </ng-template>

            <!-- Custom cell for 2FA -->
            <ng-template #twoFactorCell let-item>
              <div class="flex items-center gap-2">
                <app-icon
                  name="shield"
                  class="w-4 h-4"
                  [ngClass]="
                    item.two_factor_enabled ? 'text-green-500' : 'text-gray-400'
                  "
                ></app-icon>
                <span class="text-sm text-text">
                  {{ item.two_factor_enabled ? 'Sí' : 'No' }}
                </span>
              </div>
            </ng-template>

            <!-- Custom cell for email verification -->
            <ng-template #emailVerifiedCell let-item>
              <div class="flex items-center gap-2">
                <app-icon
                  name="check"
                  class="w-4 h-4"
                  [ngClass]="
                    item.email_verified ? 'text-green-500' : 'text-yellow-500'
                  "
                ></app-icon>
                <span class="text-sm text-text">
                  {{ item.email_verified ? 'Verificado' : 'Pendiente' }}
                </span>
              </div>
            </ng-template>

            <!-- Custom actions -->
            <ng-template #actionsCell let-item>
              <div class="flex items-center gap-2">
                <!-- Edit Button -->
                <button
                  (click)="editUser(item)"
                  class="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                  title="Editar usuario"
                >
                  <app-icon name="edit" class="w-4 h-4"></app-icon>
                </button>

                <!-- Delete Button -->
                <button
                  (click)="confirmDelete(item)"
                  class="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  title="Eliminar usuario"
                >
                  <app-icon name="delete" class="w-4 h-4"></app-icon>
                </button>
              </div>
            </ng-template>
          </app-table>
        </div>
      </div>

      <!-- Create User Modal -->
      <app-user-create-modal
        *ngIf="showCreateModal"
        [isOpen]="showCreateModal"
        (onClose)="showCreateModal = false"
        (onUserCreated)="onUserCreated()"
      ></app-user-create-modal>

      <!-- Edit User Modal -->
      <app-user-edit-modal
        *ngIf="showEditModal && currentUser"
        [user]="currentUser"
        [isOpen]="showEditModal"
        (onClose)="showEditModal = false"
        (onUserUpdated)="onUserUpdated()"
      ></app-user-edit-modal>
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
export class GlobalUsersComponent implements OnInit, OnDestroy {
  users: User[] = [];
  userStats: UserStats | null = null;
  isLoading = false;
  currentUser: User | null = null;
  showCreateModal = false;
  showEditModal = false;
  userToDelete: User | null = null;
  showDeleteModal = false;
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  // Form for filters
  filterForm: FormGroup;

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'first_name', label: 'Nombre', sortable: true },
    { key: 'last_name', label: 'Apellido', sortable: true },
    { key: 'username', label: 'Usuario', sortable: true },
    { key: 'email', label: 'Email', sortable: true },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: UserState) => this.getStateDisplay(value).text,
    },
    {
      key: 'app',
      label: 'Aplicación',
      sortable: false,
      defaultValue: 'N/A',
    },
    {
      key: 'last_login',
      label: 'Último Acceso',
      sortable: true,
      transform: (value: string) => (value ? this.formatDate(value) : 'Nunca'),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (user: User) => this.editUser(user),
      variant: 'primary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (user: User) => this.confirmDelete(user),
      variant: 'danger',
    },
  ];

  // Filter states
  userStates = [
    { value: '', label: 'Todos los estados' },
    { value: UserState.ACTIVE, label: 'Activo' },
    { value: UserState.INACTIVE, label: 'Inactivo' },
    {
      value: UserState.PENDING_VERIFICATION,
      label: 'Pendiente de Verificación',
    },
    { value: UserState.SUSPENDED, label: 'Suspendido' },
    { value: UserState.ARCHIVED, label: 'Archivado' },
  ];

  constructor(
    private globalUsersService: GlobalUsersService,
    private userStatsService: UserStatsService,
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
        this.loadUsers();
      });
  }

  ngOnInit(): void {
    this.loadUsers();
    this.loadUserStats();

    // Subscribe to form changes
    this.filterForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
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
    const query: UserQueryDto = {
      search: filters.search || undefined,
      state: filters.state || undefined,
    };

    this.globalUsersService
      .getUsers(query)
      .subscribe({
        next: (response: PaginatedUsersResponse) => {
          this.users = response.data || [];
          console.log('Users loaded:', this.users.length);
        },
        error: (error) => {
          console.error('Error loading global users:', error);
          this.users = [];
        },
      })
      .add(() => {
        this.isLoading = false;
      });
  }

  loadUserStats(): void {
    // Calculate stats from current users list
    this.userStats = this.userStatsService.calculateStats(this.users);
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onSortChange(column: string, direction: 'asc' | 'desc' | null): void {
    // TODO: Implement sorting logic
    console.log('Sort changed:', column, direction);
    this.loadUsers();
  }

  refreshUsers(): void {
    this.loadUsers();
  }

  createUser(): void {
    this.showCreateModal = true;
  }

  onUserCreated(): void {
    this.showCreateModal = false;
    this.loadUsers();
    this.loadUserStats();
  }

  editUser(user: User): void {
    this.currentUser = user;
    this.showEditModal = true;
  }

  onUserUpdated(): void {
    this.showEditModal = false;
    this.currentUser = null;
    this.loadUsers();
    this.loadUserStats();
  }

  confirmDelete(user: User): void {
    this.userToDelete = user;
    this.dialogService
      .confirm({
        title: 'Eliminar Usuario',
        message: `¿Estás seguro de que deseas eliminar al usuario "${user.first_name} ${user.last_name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteUser();
        }
      });
  }

  deleteUser(): void {
    if (!this.userToDelete) return;

    this.globalUsersService.deleteUser(this.userToDelete.id).subscribe({
      next: () => {
        this.userToDelete = null;
        this.loadUsers();
        this.loadUserStats();
        this.toastService.success('Usuario eliminado exitosamente');
      },
      error: (error) => {
        console.error('Error deleting user:', error);
        this.toastService.error('Error al eliminar el usuario');
      },
    });
  }

  getStateDisplay(state: UserState): { text: string; class: string } {
    switch (state) {
      case UserState.ACTIVE:
        return { text: 'Activo', class: 'bg-green-100 text-green-800' };
      case UserState.INACTIVE:
        return { text: 'Inactivo', class: 'bg-gray-100 text-gray-800' };
      case UserState.PENDING_VERIFICATION:
        return { text: 'Pendiente', class: 'bg-yellow-100 text-yellow-800' };
      case UserState.SUSPENDED:
        return { text: 'Suspendido', class: 'bg-orange-100 text-orange-800' };
      case UserState.ARCHIVED:
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
    if (filters.search || filters.state || filters.organization_id) {
      return 'No users match your filters';
    }
    return 'No users found';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state) {
      return 'Intenta ajustar tu búsqueda o filtros';
    }
    return 'Comienza creando tu primer usuario.';
  }
}
