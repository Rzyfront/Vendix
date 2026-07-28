import {
  Component,
  OnInit,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import {
  Role,
  RoleQueryDto,
  RoleScope,
  RoleStats,
  PaginatedRolesResponse,
} from './interfaces/role.interface';
import { RolesService } from './services/roles.service';
import { superadminRoleErrorMessage } from './utils/superadmin-role-errors';
import {
  RoleCreateModalComponent,
  RoleEditModalComponent,
  RolePermissionsModalComponent,
} from './components/index';
import {
  ROLE_SCOPE_COLOR_MAP,
  ROLE_SCOPE_FILTER_OPTIONS,
  getRoleScopeLabel,
} from '../../../../shared/constants/role-scope.constant';

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
  SelectorOption,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../shared/components/index';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

/**
 * QUI-72 — Listado de roles a nivel PLATAFORMA.
 *
 * Aquí conviven los roles de todos los tenants, así que el eje de lectura es el
 * ALCANCE (`scope`) publicado por el backend, no el flag binario
 * `is_system_role`: un rol sin dueño y un rol de una tienda concreta tenían
 * antes el mismo par de etiquetas ("Sistema"/"Personalizado") y eran
 * indistinguibles.
 */
@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RoleCreateModalComponent,
    RoleEditModalComponent,
    EmptyStateComponent,
    RolePermissionsModalComponent,
    InputsearchComponent,
    ButtonComponent,
    StatsComponent,
    SelectorComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    CardComponent,
  ],
  templateUrl: './roles.component.html',
  styleUrls: ['./roles.component.css'],
})
export class RolesComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  roles = signal<Role[]>([]);
  roleStats = signal<RoleStats>({
    totalRoles: 0,
    systemRoles: 0,
    customRoles: 0,
    totalPermissions: 0,
    rolesByScope: { system: 0, organization: 0, store: 0 },
  });
  isLoading = signal(false);
  currentRole = signal<Role | null>(null);

  showCreateModal = signal(false);
  showEditModal = signal(false);
  showPermissionsModal = signal(false);

  isCreatingRole = signal(false);
  isUpdatingRole = signal(false);
  isUpdatingPermissions = signal(false);

  pagination = signal({ page: 1, limit: 10, total: 0, totalPages: 0 });

  // Filtros
  filterForm: FormGroup;

  /** Filtro por alcance derivado; las opciones son las del contrato compartido. */
  readonly scopeOptions: SelectorOption[] = [
    { value: '', label: 'Todos los alcances' },
    ...ROLE_SCOPE_FILTER_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ];
  readonly organizationOptions = signal<SelectorOption[]>([
    { value: '', label: 'Todas las organizaciones' },
  ]);
  readonly storeOptions = signal<SelectorOption[]>([
    { value: '', label: 'Todas las tiendas' },
  ]);

  // Services
  private rolesService = inject(RolesService);
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  searchSubject = new Subject<string>(); // LEGÍTIMO — debounceTime+distinctUntilChanged search stream

  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'description', label: 'Descripción', sortable: true, priority: 3 },
    {
      key: 'scope',
      label: 'Alcance',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        // El colorMap se resuelve contra el valor CRUDO de la celda
        // ('system' | 'organization' | 'store'), por eso el hex de 7 caracteres
        // del contrato compartido: la tabla le concatena alfa.
        colorMap: ROLE_SCOPE_COLOR_MAP,
      },
      transform: (value: RoleScope) => getRoleScopeLabel(value),
    },
    {
      // A nivel plataforma hay que decir DE QUIÉN es el rol: sin esta columna
      // dos roles homónimos de tenants distintos son la misma fila a la vista.
      key: 'organization_name',
      label: 'Dueño',
      sortable: false,
      priority: 2,
      defaultValue: 'Plataforma',
      transform: (_value: string, item: Role) => this.ownerLabel(item),
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
      transform: (permissions: { name: string }[]) => {
        if (!permissions || permissions.length === 0) {
          return 'Sin permisos';
        }
        return permissions.length === 1
          ? permissions[0]?.name
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
    badgeKey: 'scope',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: ROLE_SCOPE_COLOR_MAP,
    },
    badgeTransform: (value: RoleScope) => getRoleScopeLabel(value),
    detailKeys: [
      {
        // Se lee de `scope` (nunca nulo) y no de `organization_name`: el card
        // omite el transform cuando el valor de la clave es null, y los roles de
        // sistema no tienen organización — se mostrarían como "-".
        key: 'scope',
        label: 'Dueño',
        icon: 'building-2',
        transform: (_value: RoleScope, item: Role) => this.ownerLabel(item),
      },
      { key: '_count.user_roles', label: 'Usuarios', icon: 'users' },
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
      action: (role: Role) => this.editRole(role),
      variant: 'info',
    },
    {
      label: 'Usuarios',
      icon: 'users',
      action: (role: Role) => this.openRoleUsers(role),
      variant: 'ghost',
    },
    {
      label: 'Permisos',
      icon: 'settings',
      action: (role: Role) => this.openPermissionsModal(role),
      variant: 'ghost',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: Role) => this.confirmDelete(role),
      variant: 'danger',
      disabled: (role: Role) =>
        role.is_system_role || (role._count?.user_roles ?? 0) > 0,
    },
  ];

  constructor() {
    this.filterForm = this.fb.group({
      search: [''],
      scope: [''],
      organization_id: [''],
      store_id: [''],
    });

    // Setup search debounce
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((searchTerm: string) => {
        this.filterForm.patchValue(
          { search: searchTerm },
          { emitEvent: false },
        );
        this.pagination.update((p) => ({ ...p, page: 1 }));
        this.loadRoles();
      });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadRoleStats();
    this.loadOrganizationOptions();

    this.rolesService.isCreatingRole$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isCreating: boolean) => {
        this.isCreatingRole.set(isCreating || false);
      });

    this.rolesService.isUpdatingRole$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isUpdating: boolean) => {
        this.isUpdatingRole.set(isUpdating || false);
      });
  }

  loadRoles(): void {
    this.isLoading.set(true);
    const filters = this.filterForm.value;
    const pag = this.pagination();
    const query: RoleQueryDto = {
      page: pag.page,
      limit: pag.limit,
      search: filters.search || undefined,
      scope: (filters.scope as RoleScope) || undefined,
      organization_id: filters.organization_id
        ? Number(filters.organization_id)
        : undefined,
      store_id: filters.store_id ? Number(filters.store_id) : undefined,
    };

    this.rolesService
      .getRoles(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: PaginatedRolesResponse) => {
          this.roles.set(response.data || []);
          if (response.pagination) {
            this.pagination.update((p) => ({
              ...p,
              total: response.pagination!.total || 0,
              totalPages:
                response.pagination!.total_pages ||
                Math.ceil((response.pagination!.total || 0) / p.limit),
            }));
          }
        },
        error: (error) => {
          console.error('Error loading roles:', error);
          this.roles.set([]);
          this.toastService.error(
            superadminRoleErrorMessage(error, 'Error al cargar roles'),
          );
        },
      })
      .add(() => {
        this.isLoading.set(false);
      });
  }

  loadRoleStats(): void {
    this.rolesService
      .getRolesStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats: RoleStats) => {
          this.roleStats.set(stats);
        },
        error: (error) => {
          console.error('Error loading role stats:', error);
        },
      });
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  /** Cualquier cambio de filtro vuelve a la página 1 y recarga desde el backend. */
  onScopeFilterChange(): void {
    this.resetPageAndReload();
  }

  /**
   * Al cambiar de organización se recargan sus tiendas y se limpia el filtro de
   * tienda: dejarlo puesto mezclaría una tienda de otra organización con un
   * `organization_id` que ya no la contiene y devolvería siempre cero filas.
   */
  onOrganizationFilterChange(value: string | number | null): void {
    const organizationId = value ? Number(value) : null;
    this.filterForm.patchValue({ store_id: '' }, { emitEvent: false });
    this.loadStoreOptions(organizationId);
    this.resetPageAndReload();
  }

  onPageChange(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadRoles();
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    // Implement sort logic here if backend supports it
    // For now, re-load
  }

  refreshRoles(): void {
    this.loadRoles();
    this.loadRoleStats();
  }

  createRole(): void {
    this.showCreateModal.set(true);
  }

  editRole(role: Role): void {
    this.currentRole.set(role);
    this.showEditModal.set(true);
  }

  /** El detalle del rol abre directo en su pestaña de usuarios. */
  openRoleUsers(role: Role): void {
    this.currentRole.set(role);
    this.showEditModal.set(true);
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
        this.rolesService.invalidateCache();
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol eliminado exitosamente');
      },
      error: (error) => {
        console.error('Error deleting role:', error);
        this.toastService.error(
          superadminRoleErrorMessage(error, 'Error al eliminar el rol'),
        );
      },
    });
  }

  // === Modal Outputs === //

  onRoleCreated(roleData: any): void {
    this.rolesService.createRole(roleData).subscribe({
      next: () => {
        this.showCreateModal.set(false);
        this.rolesService.invalidateCache();
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol creado exitosamente');
      },
      error: (error) => {
        console.error('Error creating role:', error);
        this.toastService.error(
          superadminRoleErrorMessage(error, 'Error al crear el rol'),
        );
      },
    });
  }

  onRoleUpdated(roleData: any): void {
    const role = this.currentRole();
    if (!role) return;

    this.rolesService.updateRole(role.id, roleData).subscribe({
      next: () => {
        this.showEditModal.set(false);
        this.currentRole.set(null);
        this.rolesService.invalidateCache();
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol actualizado exitosamente');
      },
      error: (error) => {
        console.error('Error updating role:', error);
        this.toastService.error(
          superadminRoleErrorMessage(error, 'Error al actualizar el rol'),
        );
      },
    });
  }

  /** Una asignación cambió el conteo de usuarios de la fila: se refresca. */
  onRoleUsersChanged(): void {
    this.rolesService.invalidateCache();
    this.loadRoles();
    this.loadRoleStats();
  }

  openPermissionsModal(role: Role): void {
    this.currentRole.set(role);
    this.showPermissionsModal.set(true);
  }

  onPermissionsUpdated(permissionData: any): void {
    const role = this.currentRole();
    if (!role) return;

    this.isUpdatingPermissions.set(true);

    this.rolesService.getRolePermissions(role.id).subscribe({
      next: (currentPermissionIds) => {
        const newPermissionIds = permissionData.permission_ids || [];

        const toAdd = newPermissionIds.filter(
          (id: number) => !currentPermissionIds.includes(id),
        );
        const toRemove = currentPermissionIds.filter(
          (id: number) => !newPermissionIds.includes(id),
        );

        if (toAdd.length === 0 && toRemove.length === 0) {
          this.isUpdatingPermissions.set(false);
          this.showPermissionsModal.set(false);
          this.currentRole.set(null);
          this.toastService.info('No hay cambios en los permisos');
          return;
        }

        const requests: any[] = [];
        if (toAdd.length)
          requests.push(
            this.rolesService.assignPermissionsToRole(role.id, {
              permission_ids: toAdd,
            }),
          );
        if (toRemove.length)
          requests.push(
            this.rolesService.removePermissionsFromRole(role.id, {
              permission_ids: toRemove,
            }),
          );

        let completed = 0;
        let errors = 0;

        const checkDone = () => {
          completed++;
          if (completed === requests.length) {
            this.isUpdatingPermissions.set(false);
            this.showPermissionsModal.set(false);
            this.currentRole.set(null);
            this.loadRoles();
            this.loadRoleStats();
            if (errors === 0) {
              this.toastService.success('Permisos actualizados exitosamente');
            } else {
              this.toastService.warning(
                'Algunos permisos no se pudieron actualizar',
              );
            }
          }
        };

        requests.forEach((req) => {
          req.subscribe({
            next: () => checkDone(),
            error: (e: any) => {
              console.error(e);
              errors++;
              checkDone();
            },
          });
        });
      },
      error: () => {
        this.isUpdatingPermissions.set(false);
        this.toastService.error('Error al obtener permisos actuales');
      },
    });
  }

  /** Dueño legible del rol: "Organización / Tienda", o Plataforma si no tiene. */
  ownerLabel(role: Role | null | undefined): string {
    if (!role) return 'Plataforma';
    if (role.store_name) {
      return `${role.organization_name ?? '—'} / ${role.store_name}`;
    }
    return role.organization_name ?? 'Plataforma';
  }

  hasActiveFilters(): boolean {
    const filters = this.filterForm.value;
    return Boolean(
      filters.search ||
        filters.scope ||
        filters.organization_id ||
        filters.store_id,
    );
  }

  getEmptyStateTitle(): string {
    return this.hasActiveFilters() ? 'No hay roles que coincidan' : 'No hay roles';
  }

  getEmptyStateDescription(): string {
    return this.hasActiveFilters()
      ? 'Intenta ajustar los filtros de búsqueda'
      : 'Comienza creando tu primer rol.';
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

  private resetPageAndReload(): void {
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadRoles();
  }

  private loadOrganizationOptions(): void {
    this.rolesService
      .getOrganizationOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) =>
          this.organizationOptions.set([
            { value: '', label: 'Todas las organizaciones' },
            ...options.map((option) => ({
              value: String(option.id),
              label: option.name,
            })),
          ]),
        error: () =>
          this.organizationOptions.set([
            { value: '', label: 'Todas las organizaciones' },
          ]),
      });
  }

  private loadStoreOptions(organizationId: number | null): void {
    if (organizationId == null) {
      this.storeOptions.set([{ value: '', label: 'Todas las tiendas' }]);
      return;
    }

    this.rolesService
      .getStoreOptions(organizationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) =>
          this.storeOptions.set([
            { value: '', label: 'Todas las tiendas' },
            ...options.map((option) => ({
              value: String(option.id),
              label: option.name,
            })),
          ]),
        error: () =>
          this.storeOptions.set([{ value: '', label: 'Todas las tiendas' }]),
      });
  }
}
