import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  User,
  UserQueryDto,
  UserStats,
  UserState,
  PaginatedUsersResponse,
} from './interfaces/user.interface';
import { UsersService } from './services/users.service';
import {
  UserStatsComponent,
  UserCreateModalComponent,
  UserEditModalComponent,
  UserEmptyStateComponent,
} from './components/index';

// Import components from shared
import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../shared/components/index';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    UserStatsComponent,
    UserCreateModalComponent,
    UserEditModalComponent,
    UserEmptyStateComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
  ],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.css'],
})
export class UsersComponent implements OnInit, OnDestroy {
  // Services
  private usersService = inject(UsersService);
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  // State
  users: User[] = [];
  userStats: UserStats | null = null;
  isLoading = false;
  currentUser: User | null = null;
  showCreateModal = false;
  showEditModal = false;

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  // Form for filters
  filterForm: FormGroup = this.fb.group({
    search: [''],
    state: [''],
    organization_id: [''],
  });

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'first_name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'last_name', label: 'Apellido', sortable: true, priority: 3 },
    { key: 'username', label: 'Usuario', sortable: true, priority: 3 },
    { key: 'email', label: 'Email', sortable: true, priority: 2 },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: UserState) => this.getStateDisplay(value).text,
    },
    {
      key: 'created_at',
      label: 'Fecha Creación',
      sortable: true,
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (user: User) => this.editUser(user),
      variant: 'success',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (user: User) => this.confirmDelete(user),
      variant: 'danger',
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
    { value: '', label: 'Cualquier estado' },
    { value: UserState.ACTIVE, label: 'Activo' },
    { value: UserState.INACTIVE, label: 'Inactivo' },
    {
      value: UserState.PENDING_VERIFICATION,
      label: 'Pendiente',
    },
    { value: UserState.SUSPENDED, label: 'Suspendido' },
    { value: UserState.ARCHIVED, label: 'Archivado' },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    titleTransform: (item: User) => `${item.first_name} ${item.last_name}`,
    subtitleKey: 'email',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: UserState) => this.getStateDisplay(value).text,
    detailKeys: [
      { key: 'username', label: 'Usuario', icon: 'user' },
      { key: 'created_at', label: 'Registro', transform: (v) => this.formatDate(v) },
    ],
  };

  constructor() {
    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntil(this.destroy$))
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
    this.loadUserStats();

    // Subscribe to form changes
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
    const query: UserQueryDto = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      search: filters.search || undefined,
      state: filters.state || undefined,
      organization_id: filters.organization_id || undefined,
    };

    this.usersService
      .getUsers(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: PaginatedUsersResponse) => {
          this.users = response.data || [];
          if (response.pagination) {
            this.pagination = {
              page: response.pagination.page || 1,
              limit: response.pagination.limit || 10,
              total: response.pagination.total || 0,
              totalPages: response.pagination.total_pages || 0,
            };
          }
        },
        error: (error) => {
          console.error('Error loading users:', error);
          this.users = [];
          this.toastService.error('Error al cargar usuarios');
        },
      })
      .add(() => {
        this.isLoading = false;
      });
  }

  loadUserStats(): void {
    this.usersService.getUsersStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: UserStats) => {
          this.userStats = stats;
        },
        error: (error) => {
          console.error('Error loading user stats:', error);
        },
      });
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onPageChange(page: number): void {
    this.pagination.page = page;
    this.loadUsers();
  }

  onSortChange(column: string, direction: 'asc' | 'desc' | null): void {
    // Implementation can be added here if service supports sorting
    this.loadUsers();
  }

  refreshUsers(): void {
    this.loadUsers();
    this.loadUserStats();
  }

  createUser(): void {
    this.showCreateModal = true;
  }

  onUserCreated(): void {
    this.showCreateModal = false;
    this.refreshUsers();
    this.toastService.success('Usuario creado correctamente');
  }

  editUser(user: User): void {
    this.currentUser = user;
    this.showEditModal = true;
  }

  onUserUpdated(): void {
    this.showEditModal = false;
    this.currentUser = null;
    this.refreshUsers();
  }

  confirmDelete(user: User): void {
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
          this.deleteUser(user.id);
        }
      });
  }

  deleteUser(userId: number): void {
    this.usersService.deleteUser(userId).subscribe({
      next: () => {
        this.refreshUsers();
        this.toastService.success('Usuario eliminado exitosamente');
      },
      error: (error) => {
        console.error('Error deleting user:', error);
        this.toastService.error('Error al eliminar el usuario');
      },
    });
  }

  toggleUserStatus(user: User): void {
    const action = user.state === UserState.ACTIVE ? 'archive' : 'reactivate';
    const actionText = action === 'archive' ? 'archivar' : 'reactivar';

    this.dialogService
      .confirm({
        title: `${action === 'archive' ? 'Archivar' : 'Reactivar'} Usuario`,
        message: `¿Estás seguro de que deseas ${actionText} al usuario "${user.first_name} ${user.last_name}"?`,
        confirmText: action === 'archive' ? 'Archivar' : 'Reactivar',
        cancelText: 'Cancelar',
        confirmVariant: action === 'archive' ? 'danger' : 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          const obs = action === 'archive'
            ? this.usersService.archiveUser(user.id)
            : this.usersService.reactivateUser(user.id);

          obs.subscribe({
            next: () => {
              this.refreshUsers();
              this.toastService.success(`Usuario ${action === 'archive' ? 'archivado' : 'reactivado'} exitosamente`);
            },
            error: (error) => {
              console.error(`Error ${action} user:`, error);
              this.toastService.error(`Error al ${actionText} el usuario`);
            },
          });
        }
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

  formatDate(dateString: string | null | undefined): string {
    if (!dateString) return 'Nunca';
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
      return 'Sin coincidencias';
    }
    return 'No hay usuarios';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state || filters.organization_id) {
      return 'Intenta ajustar los filtros de búsqueda';
    }
    return 'Comienza creando el primer usuario del sistema.';
  }
}
