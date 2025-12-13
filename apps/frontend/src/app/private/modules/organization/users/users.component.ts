import { Component, OnInit, OnDestroy } from '@angular/core';
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
import { UserStatsService } from './services/user-stats.service';
import {
  UserCreateModalComponent,
  UserEditModalComponent,
  UserEmptyStateComponent,
  UserCardComponent,
} from './components/index';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  DialogService,
  ToastService,
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
} from '../../../../shared/components/index';
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
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    UserCreateModalComponent,
    UserEditModalComponent,
    UserEmptyStateComponent,
    UserCardComponent,
    TableComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
  ],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.css'],
})
export class UsersComponent implements OnInit, OnDestroy {
  users: User[] = [];
  userStats: UserStats | null = null;
  statsItems: StatItem[] = [];
  isLoading = false;
  currentUser: User | null = null;
  showCreateModal = false;
  showEditModal = false;
  userToDelete: User | null = null;
  showDeleteModal = false;
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();
  viewMode: 'table' | 'cards' = 'table';

  // Form for filters
  filterForm: FormGroup;

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'first_name', label: 'Nombre', sortable: true, width: '120px' },
    { key: 'last_name', label: 'Apellido', sortable: true, width: '120px' },
    { key: 'username', label: 'Usuario', sortable: true, width: '140px' },
    { key: 'email', label: 'Email', sortable: true, width: '180px' },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      width: '100px',
      align: 'center',
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
      width: '120px',
      defaultValue: 'N/A',
    },
    {
      key: 'last_login',
      label: 'Último Acceso',
      sortable: true,
      width: '140px',
      transform: (value: string) => (value ? this.formatDate(value) : 'Nunca'),
    },
    {
      key: 'created_at',
      label: 'Fecha Creación',
      sortable: true,
      width: '140px',
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
    private usersService: UsersService,
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
    };

    this.usersService
      .getUsers(query)
      .subscribe({
        next: (response: PaginatedUsersResponse) => {
          this.users = response.data || [];

          // Validar que response.pagination exista y tenga las propiedades esperadas
          if (response.pagination) {
            this.pagination = {
              page: response.pagination.page || 1,
              limit: response.pagination.limit || 10,
              total: response.pagination.total || 0,
              totalPages: response.pagination.total_pages || 0,
            };
          } else {
            // Si no hay paginación, mantener valores por defecto
            console.warn(
              'La respuesta no contiene información de paginación:',
              response,
            );
            this.pagination = {
              page: 1,
              limit: 10,
              total: this.users.length,
              totalPages: 1,
            };
          }
        },
        error: (error) => {
          console.error('Error loading organization users:', error);
          this.users = []; // Limpiar usuarios en caso de error
          // Resetear paginación a valores seguros
          this.pagination = {
            page: 1,
            limit: 10,
            total: 0,
            totalPages: 0,
          };
          // Handle error - show toast or notification
        },
      })
      .add(() => {
        this.isLoading = false; // Asegurar que el estado de carga se resetee
      });
  }

  loadUserStats(): void {
    // Calculate stats from current users list
    this.userStats = this.userStatsService.calculateStats(this.users);
    this.updateStatsItems();
  }

  private updateStatsItems(): void {
    const s = this.userStats || {
      total_usuarios: 0,
      activos: 0,
      pendientes: 0,
      con_2fa: 0,
      inactivos: 0,
      suspendidos: 0,
      email_verificado: 0,
      archivados: 0,
    };
    const total = s.total_usuarios || 0;

    this.statsItems = [
      {
        title: 'Total Usuarios',
        value: total,
        smallText: 'en la organización',
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
        title: 'Pendientes',
        value: s.pendientes || 0,
        smallText: `${this.calculatePercentage(s.pendientes || 0, total)}% del total`,
        iconName: 'clock',
        iconBgColor: 'bg-yellow-100',
        iconColor: 'text-yellow-600',
      },
      {
        title: 'Con 2FA',
        value: s.con_2fa || 0,
        smallText: `${this.calculatePercentage(s.con_2fa || 0, total)}% del total`,
        iconName: 'shield',
        iconBgColor: 'bg-purple-100',
        iconColor: 'text-purple-600',
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
        title: 'Suspendidos',
        value: s.suspendidos || 0,
        smallText: `${this.calculatePercentage(s.suspendidos || 0, total)}% del total`,
        iconName: 'alert-triangle',
        iconBgColor: 'bg-red-100',
        iconColor: 'text-red-600',
      },
      {
        title: 'Email Verificado',
        value: s.email_verificado || 0,
        smallText: `${this.calculatePercentage(s.email_verificado || 0, total)}% del total`,
        iconName: 'mail-check',
        iconBgColor: 'bg-emerald-100',
        iconColor: 'text-emerald-600',
      },
      {
        title: 'Archivados',
        value: s.archivados || 0,
        smallText: `${this.calculatePercentage(s.archivados || 0, total)}% del total`,
        iconName: 'archive',
        iconBgColor: 'bg-red-100',
        iconColor: 'text-red-600',
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

    this.usersService.deleteUser(this.userToDelete.id).subscribe({
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

  toggleUserStatus(user: User): void {
    const action = user.state === UserState.ACTIVE ? 'archive' : 'reactivate';
    const actionText = action === 'archive' ? 'archivar' : 'reactivar';

    this.dialogService
      .confirm({
        title: `${action === 'archive' ? 'Archivar' : 'Reactivar'} Usuario`,
        message: `¿Estás seguro de que deseas ${actionText} al usuario "${user.first_name} ${user.last_name}"?`,
        confirmText: action === 'archive' ? 'Archivar' : 'Reactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          if (action === 'archive') {
            this.usersService.archiveUser(user.id).subscribe({
              next: () => {
                this.loadUsers();
                this.loadUserStats();
                this.toastService.success('Usuario archivado exitosamente');
              },
              error: (error) => {
                console.error('Error archiving user:', error);
                this.toastService.error('Error al archivar el usuario');
              },
            });
          } else {
            this.usersService.reactivateUser(user.id).subscribe({
              next: () => {
                this.loadUsers();
                this.loadUserStats();
                this.toastService.success('Usuario reactivado exitosamente');
              },
              error: (error) => {
                console.error('Error reactivating user:', error);
                this.toastService.error('Error al reactivar el usuario');
              },
            });
          }
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

  getRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
      return `Hace ${diffInMinutes} minuto${diffInMinutes !== 1 ? 's' : ''}`;
    } else if (diffInHours < 24) {
      return `Hace ${diffInHours} hora${diffInHours !== 1 ? 's' : ''}`;
    } else if (diffInHours < 48) {
      return 'Ayer';
    } else {
      return this.formatDate(dateString);
    }
  }

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state) {
      return 'No users match your filters';
    }
    return 'No users found';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first user.';
  }

  toggleViewMode(): void {
    this.viewMode = this.viewMode === 'table' ? 'cards' : 'table';
  }
}
