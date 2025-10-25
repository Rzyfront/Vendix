import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  Role,
  RoleQueryDto,
  RoleStats,
  PaginatedRolesResponse,
  PermissionStatus
} from './interfaces/role.interface';
import { RolesService } from './services/roles.service';
import {
  RoleStatsComponent,
  RoleCreateModalComponent,
  RoleEditModalComponent,
  RoleEmptyStateComponent
} from './components/index';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent
} from '../../../../shared/components/index';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RoleStatsComponent,
    RoleCreateModalComponent,
    RoleEditModalComponent,
    RoleEmptyStateComponent,
    TableComponent,
    InputsearchComponent,
    IconComponent
  ],
  templateUrl: './roles.component.html',
  styleUrls: ['./roles.component.css']
})
export class RolesComponent implements OnInit, OnDestroy {
  roles: Role[] = [];
  roleStats: RoleStats = {
    total_roles: 0,
    system_roles: 0,
    custom_roles: 0,
    total_permissions: 0,
    active_permissions: 0,
    inactive_permissions: 0
  };
  isLoading = false;
  currentRole: Role | null = null;
  showCreateModal = false;
  showEditModal = false;
  roleToDelete: Role | null = null;
  showDeleteModal = false;
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();
  isCreatingRole = false;
  isUpdatingRole = false;

  // Form for filters
  filterForm: FormGroup;

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'description', label: 'Descripción', sortable: true },
    {
      key: 'is_system_role',
      label: 'Tipo',
      sortable: true,
      transform: (value: boolean) => value ? 'Sistema' : 'Personalizado'
    },
    {
      key: '_count.user_roles',
      label: 'Usuarios',
      sortable: true,
      defaultValue: '0'
    },
    {
      key: '_count.role_permissions',
      label: 'Permisos',
      sortable: true,
      defaultValue: '0'
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
      action: (role: Role) => this.editRole(role),
      variant: 'primary'
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: Role) => this.confirmDelete(role),
      variant: 'danger',
      disabled: (role: Role) => role.is_system_role
    }
  ];


  // Filter states
  roleTypes = [
    { value: '', label: 'Todos los tipos' },
    { value: 'true', label: 'Roles de Sistema' },
    { value: 'false', label: 'Roles Personalizados' }
  ];

  constructor(
    private rolesService: RolesService,
    private fb: FormBuilder
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      is_system_role: ['']
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
        this.loadRoles();
      });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadRoleStats();

    // Subscribe to form changes
    this.filterForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadRoles();
      });

    // Subscribe to service loading states
    this.rolesService.isCreatingRole
      .pipe(takeUntil(this.destroy$))
      .subscribe(isCreating => {
        this.isCreatingRole = isCreating || false;
      });

    this.rolesService.isUpdatingRole
      .pipe(takeUntil(this.destroy$))
      .subscribe(isUpdating => {
        this.isUpdatingRole = isUpdating || false;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadRoles(): void {
    this.isLoading = true;
    const filters = this.filterForm.value;
    const query: RoleQueryDto = {
      search: filters.search || undefined,
      is_system_role: filters.is_system_role ? filters.is_system_role === 'true' : undefined
    };

    this.rolesService.getRoles(query).subscribe({
      next: (response: PaginatedRolesResponse) => {
        this.roles = response.data || [];
        
        // Ignorar información de paginación de la respuesta
      },
      error: (error) => {
        console.error('Error loading roles:', error);
        this.roles = []; // Limpiar roles en caso de error
        // Resetear estado de carga
        // Handle error - show toast or notification
      }
    }).add(() => {
      this.isLoading = false; // Asegurar que el estado de carga se resetee
    });
  }

  loadRoleStats(): void {
    this.rolesService.getRolesStats().subscribe({
      next: (stats: RoleStats) => {
        this.roleStats = stats;
      },
      error: (error) => {
        console.error('Error loading role stats:', error);
        // Establecer valores por defecto para evitar errores de renderizado
        this.roleStats = {
          total_roles: 0,
          system_roles: 0,
          custom_roles: 0,
          total_permissions: 0,
          active_permissions: 0,
          inactive_permissions: 0
        };
      }
    });
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onSortChange(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    // TODO: Implement sorting logic
    console.log('Sort changed:', event.column, event.direction);
    this.loadRoles();
  }

  refreshRoles(): void {
    this.loadRoles();
  }

  createRole(): void {
    this.showCreateModal = true;
  }

  updateRole(roleData: any): void {
    if (!this.currentRole) return;
    
    this.rolesService.updateRole(this.currentRole.id, roleData).subscribe({
      next: () => {
        this.showEditModal = false;
        this.currentRole = null;
        this.loadRoles();
        this.loadRoleStats();
      },
      error: (error) => {
        console.error('Error updating role:', error);
      }
    });
  }

  onRoleCreated(roleData: any): void {
    this.rolesService.createRole(roleData).subscribe({
      next: () => {
        this.showCreateModal = false;
        this.loadRoles();
        this.loadRoleStats();
      },
      error: (error) => {
        console.error('Error creating role:', error);
      }
    });
  }

  editRole(role: Role): void {
    this.currentRole = role;
    this.showEditModal = true;
  }

  onRoleUpdated(roleData: any): void {
    if (!this.currentRole) return;
    
    this.rolesService.updateRole(this.currentRole.id, roleData).subscribe({
      next: () => {
        this.showEditModal = false;
        this.currentRole = null;
        this.loadRoles();
        this.loadRoleStats();
      },
      error: (error) => {
        console.error('Error updating role:', error);
      }
    });
  }

  confirmDelete(role: Role): void {
    if (role.is_system_role) {
      alert('No se pueden eliminar roles del sistema.');
      return;
    }
    this.roleToDelete = role;
    this.showDeleteModal = true;
  }

  deleteRole(): void {
    if (!this.roleToDelete) return;

    this.rolesService.deleteRole(this.roleToDelete.id).subscribe({
      next: () => {
        this.showDeleteModal = false;
        this.roleToDelete = null;
        this.loadRoles();
        this.loadRoleStats();
      },
      error: (error) => {
        console.error('Error deleting role:', error);
        // Handle error - show toast or notification
      }
    });
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

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.is_system_role) {
      return 'No roles match your filters';
    }
    return 'No roles found';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.is_system_role) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first role.';
  }
}