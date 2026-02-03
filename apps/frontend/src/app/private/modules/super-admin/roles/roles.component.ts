import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  Role,
  RoleQueryDto,
  RoleStats,
  PaginatedRolesResponse,
} from './interfaces/role.interface';
import { RolesService } from './services/roles.service';
import {
  RoleCreateModalComponent,
  RoleEditModalComponent,
  RoleEmptyStateComponent,
  RolePermissionsModalComponent,
} from './components/index';

// Import components from shared
import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  ButtonComponent,
  DialogService,
  ToastService,
  StatsComponent,
  SelectorComponent,
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
  selector: 'app-roles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RoleCreateModalComponent,
    RoleEditModalComponent,
    RoleEmptyStateComponent,
    RolePermissionsModalComponent,
    InputsearchComponent,
    ButtonComponent,
    StatsComponent,
    SelectorComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './roles.component.html',
  styleUrls: ['./roles.component.css'],
})
export class RolesComponent implements OnInit, OnDestroy {
  roles: Role[] = [];
  roleStats: RoleStats = {
    totalRoles: 0,
    systemRoles: 0,
    customRoles: 0,
    totalPermissions: 0,
  };
  isLoading = false;
  currentRole: Role | null = null;

  // Modals state
  showCreateModal = false;
  showEditModal = false;
  showPermissionsModal = false;

  isCreatingRole = false;
  isUpdatingRole = false;
  isUpdatingPermissions = false;

  // Filter states
  filterForm: FormGroup;
  roleTypes = [
    { value: '', label: 'Todos los tipos' },
    { value: 'true', label: 'Roles de Sistema' },
    { value: 'false', label: 'Roles Personalizados' },
  ];

  // Services
  private rolesService = inject(RolesService);
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  private destroy$ = new Subject<void>();
  searchSubject = new Subject<string>();

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'description', label: 'Descripción', sortable: true, priority: 2 },
    {
      key: 'is_system_role',
      label: 'Tipo',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          true: '#3b82f6', // Blue for system roles
          false: '#10b981', // Green for custom roles
        },
      },
      transform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    },
    {
      key: '_count.user_roles',
      label: 'Usuarios',
      sortable: true,
      defaultValue: '0',
      priority: 3,
    },
    {
      key: 'permissions',
      label: 'Permisos',
      sortable: true,
      priority: 3,
      transform: (permissions: string[]) => {
        if (!permissions || permissions.length === 0) {
          return 'Sin permisos';
        }
        return permissions.length === 1
          ? permissions[0]
          : `${permissions.length} permisos`;
      },
    },
    {
      key: 'created_at',
      label: 'Fecha Creación',
      sortable: true,
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    badgeKey: 'is_system_role',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        true: '#3b82f6', // Blue for system roles
        false: '#10b981', // Green for custom roles
      },
    },
    badgeTransform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    detailKeys: [
      { key: '_count.user_roles', label: 'Usuarios', icon: 'users' },
      { key: 'created_at', label: 'Fecha', transform: (v) => this.formatDate(v) },
    ],
  };

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (role: Role) => this.editRole(role),
      variant: 'success',
    },
    {
      label: 'Permisos',
      icon: 'settings',
      action: (role: Role) => this.openPermissionsModal(role),
      variant: 'secondary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: Role) => this.confirmDelete(role),
      variant: 'danger',
      disabled: (role: Role) => role.is_system_role || ((role._count?.user_roles ?? 0) > 0),
    },
  ];

  constructor() {
    this.filterForm = this.fb.group({
      search: [''],
      is_system_role: [''],
    });

    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((searchTerm: string) => {
        this.filterForm.patchValue(
          { search: searchTerm },
          { emitEvent: false },
        );
        this.loadRoles();
      });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadRoleStats();

    // Subscribe to form changes
    this.filterForm.get('is_system_role')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadRoles();
      });

    // Subscribe to service loading states
    this.rolesService.isCreatingRole
      .pipe(takeUntil(this.destroy$))
      .subscribe((isCreating) => {
        this.isCreatingRole = isCreating || false;
      });

    this.rolesService.isUpdatingRole
      .pipe(takeUntil(this.destroy$))
      .subscribe((isUpdating) => {
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
      is_system_role: filters.is_system_role && filters.is_system_role !== ''
        ? filters.is_system_role === 'true'
        : undefined,
    };

    this.rolesService
      .getRoles(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: PaginatedRolesResponse) => {
          this.roles = response.data || [];
        },
        error: (error) => {
          console.error('Error loading roles:', error);
          this.roles = [];
          this.toastService.error('Error al cargar roles');
        },
      })
      .add(() => {
        this.isLoading = false;
      });
  }

  loadRoleStats(): void {
    this.rolesService.getRolesStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: RoleStats) => {
          this.roleStats = stats;
        },
        error: (error) => {
          console.error('Error loading role stats:', error);
        },
      });
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    // Implement sort logic here if backend supports it
    // For now, re-load
    console.log('Sort changed:', event);
  }

  refreshRoles(): void {
    this.loadRoles();
    this.loadRoleStats();
  }

  createRole(): void {
    this.showCreateModal = true;
  }

  editRole(role: Role): void {
    this.currentRole = role;
    this.showEditModal = true;
  }

  confirmDelete(role: Role): void {
    // Double check system role
    if (role.is_system_role) {
      this.toastService.warning('No se pueden eliminar roles del sistema.');
      return;
    }

    this.dialogService
      .confirm({
        title: 'Eliminar Rol',
        message: `¿Estás seguro de que deseas eliminar el rol "${role.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteRole(role.id);
        }
      });
  }

  deleteRole(id: number): void {
    this.rolesService.deleteRole(id).subscribe({
      next: () => {
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol eliminado exitosamente');
      },
      error: (error) => {
        console.error('Error deleting role:', error);
        this.toastService.error('Error al eliminar el rol');
      },
    });
  }

  // === Modal Outputs === //

  onRoleCreated(roleData: any): void {
    this.rolesService.createRole(roleData).subscribe({
      next: () => {
        this.showCreateModal = false;
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol creado exitosamente');
      },
      error: (error) => {
        console.error('Error creating role:', error);
        this.toastService.error('Error al crear el rol');
      },
    });
  }

  onRoleUpdated(roleData: any): void {
    if (!this.currentRole) return;

    this.rolesService.updateRole(this.currentRole.id, roleData).subscribe({
      next: () => {
        this.showEditModal = false;
        this.currentRole = null;
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol actualizado exitosamente');
      },
      error: (error) => {
        console.error('Error updating role:', error);
        this.toastService.error('Error al actualizar el rol');
      },
    });
  }

  // === Permissions === //

  openPermissionsModal(role: Role): void {
    this.currentRole = role;
    this.showPermissionsModal = true;
  }

  onPermissionsUpdated(permissionData: any): void {
    if (!this.currentRole) return;

    this.isUpdatingPermissions = true;

    // Delegate logic to service or handle here
    // For simplicity, we can do simpler logic than the original component's massive parallel block if the backend supports bulk assign
    // The original code calculated diffs. Let's see if we can just assign the new set if the API supports it.
    // The Service has assignPermissionsToRole and removePermissionsFromRole. It seems we need to calc diffs.

    // NOTE: Keep original logic logic or Refactor? 
    // I'll keep the diff logic but cleaner.

    this.rolesService.getRolePermissions(this.currentRole.id).subscribe({
      next: (currentPermissionIds) => {
        const newPermissionIds = permissionData.permission_ids || [];

        const toAdd = newPermissionIds.filter((id: number) => !currentPermissionIds.includes(id));
        const toRemove = currentPermissionIds.filter((id: number) => !newPermissionIds.includes(id));

        if (toAdd.length === 0 && toRemove.length === 0) {
          this.isUpdatingPermissions = false;
          this.showPermissionsModal = false;
          this.currentRole = null;
          this.toastService.info('No hay cambios en los permisos');
          return;
        }

        const requests = [];
        if (toAdd.length) requests.push(this.rolesService.assignPermissionsToRole(this.currentRole!.id, { permission_ids: toAdd }));
        if (toRemove.length) requests.push(this.rolesService.removePermissionsFromRole(this.currentRole!.id, { permission_ids: toRemove }));

        // Execute sequentially or parallel. 
        // Using forkJoin or similar would be better but let's stick to simple promise/subscribe chain or just parallel.
        // I will use a simple counter for now as RxJS forkJoin needs import

        let completed = 0;
        let errors = 0;

        const checkDone = () => {
          completed++;
          if (completed === requests.length) {
            this.isUpdatingPermissions = false;
            this.showPermissionsModal = false;
            this.currentRole = null;
            this.loadRoles();
            this.loadRoleStats(); // Stats might change (total permissions)
            if (errors === 0) {
              this.toastService.success('Permisos actualizados exitosamente');
            } else {
              this.toastService.warning('Algunos permisos no se pudieron actualizar');
            }
          }
        };

        requests.forEach(req => {
          req.subscribe({
            next: () => checkDone(),
            error: (e) => {
              console.error(e);
              errors++;
              checkDone();
            }
          });
        });

      },
      error: (err) => {
        this.isUpdatingPermissions = false;
        this.toastService.error('Error al obtener permisos actuales');
      }
    });
  }

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.is_system_role) {
      return 'No hay roles que coincidan';
    }
    return 'No hay roles';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.is_system_role) {
      return 'Intenta ajustar los filtros de búsqueda';
    }
    return 'Comienza creando tu primer rol.';
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
}
