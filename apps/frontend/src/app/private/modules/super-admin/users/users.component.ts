import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  User,
  UserQueryDto,
  UserStats,
  UserState,
  PaginatedUsersResponse
} from './interfaces/user.interface';
import { UsersService } from './services/users.service';
import {
  UserStatsComponent,
  UserCreateModalComponent,
  UserEditModalComponent,
  UserEmptyStateComponent
} from './components/index';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ModalComponent
} from '../../../../shared/components/index';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';

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
    TableComponent,
    InputsearchComponent,
    IconComponent,
    ModalComponent
  ],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.css']
})
export class UsersComponent implements OnInit, OnDestroy {
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
      transform: (value: UserState) => this.getStateDisplay(value).text
    },
    {
      key: 'organizations.name',
      label: 'Organización',
      sortable: false,
      defaultValue: 'N/A'
    },
    {
      key: 'last_login',
      label: 'Último Acceso',
      sortable: true,
      transform: (value: string) => value ? this.formatDate(value) : 'Nunca'
    },
    {
      key: 'created_at',
      label: 'Fecha Creación',
      sortable: true,
      transform: (value: string) => this.formatDate(value)
    }
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (user: User) => this.editUser(user),
      variant: 'primary'
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (user: User) => this.confirmDelete(user),
      variant: 'danger'
    }
  ];

  // Pagination
  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  };

  // Filter states
  userStates = [
    { value: '', label: 'Todos los estados' },
    { value: UserState.ACTIVE, label: 'Activo' },
    { value: UserState.INACTIVE, label: 'Inactivo' },
    { value: UserState.PENDING_VERIFICATION, label: 'Pendiente de Verificación' },
    { value: UserState.SUSPENDED, label: 'Suspendido' },
    { value: UserState.ARCHIVED, label: 'Archivado' }
  ];

  constructor(
    private usersService: UsersService,
    private fb: FormBuilder
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      state: [''],
      organization_id: ['']
    });

    // Setup search debounce
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe((searchTerm: string) => {
        this.filterForm.patchValue({ search: searchTerm }, { emitEvent: false });
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

    // Subscribe to service loading states
    this.usersService.isCreatingUser
      .pipe(takeUntil(this.destroy$))
      .subscribe(isCreating => {
        // Optional: Handle global loading state
      });

    this.usersService.isUpdatingUser
      .pipe(takeUntil(this.destroy$))
      .subscribe(isUpdating => {
        // Optional: Handle global loading state
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
      organization_id: filters.organization_id || undefined
    };

    this.usersService.getUsers(query).subscribe({
      next: (response: PaginatedUsersResponse) => {
        this.users = response.data || [];
        
        // Validar que response.pagination exista y tenga las propiedades esperadas
        if (response.pagination) {
          this.pagination = {
            page: response.pagination.page || 1,
            limit: response.pagination.limit || 10,
            total: response.pagination.total || 0,
            totalPages: response.pagination.total_pages || 0
          };
        } else {
          // Si no hay paginación, mantener valores por defecto
          console.warn('La respuesta no contiene información de paginación:', response);
          this.pagination = {
            page: 1,
            limit: 10,
            total: this.users.length,
            totalPages: 1
          };
        }
      },
      error: (error) => {
        console.error('Error loading users:', error);
        this.users = []; // Limpiar usuarios en caso de error
        // Resetear paginación a valores seguros
        this.pagination = {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0
        };
        // Handle error - show toast or notification
      }
    }).add(() => {
      this.isLoading = false; // Asegurar que el estado de carga se resetee
    });
  }

  loadUserStats(): void {
    this.usersService.getUsersDashboard().subscribe({
      next: (stats: UserStats) => {
        this.userStats = stats;
      },
      error: (error) => {
        console.error('Error loading user stats:', error);
        // Establecer valores por defecto para evitar errores de renderizado
        this.userStats = {
          total_usuarios: 0,
          activos: 0,
          pendientes: 0,
          con_2fa: 0,
          inactivos: 0,
          suspendidos: 0,
          email_verificado: 0,
          archivados: 0
        };
      }
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
    this.showDeleteModal = true;
  }

  deleteUser(): void {
    if (!this.userToDelete) return;

    this.usersService.deleteUser(this.userToDelete.id).subscribe({
      next: () => {
        this.showDeleteModal = false;
        this.userToDelete = null;
        this.loadUsers();
        this.loadUserStats();
      },
      error: (error) => {
        console.error('Error deleting user:', error);
        // Handle error - show toast or notification
      }
    });
  }

  toggleUserStatus(user: User): void {
    const action = user.state === UserState.ACTIVE ? 'archive' : 'reactivate';

    if (action === 'archive') {
      this.usersService.archiveUser(user.id).subscribe({
        next: () => {
          this.loadUsers();
          this.loadUserStats();
        },
        error: (error) => {
          console.error('Error archiving user:', error);
        }
      });
    } else {
      this.usersService.reactivateUser(user.id).subscribe({
        next: () => {
          this.loadUsers();
          this.loadUserStats();
        },
        error: (error) => {
          console.error('Error reactivating user:', error);
        }
      });
    }
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
      minute: '2-digit'
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
    if (filters.search || filters.state || filters.organization_id) {
      return 'No users match your filters';
    }
    return 'No users found';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.state || filters.organization_id) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first user.';
  }
}
