import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import {
  Role,
  RoleQueryDto,
  RoleStats,
  PaginatedRolesResponse} from './interfaces/role.interface';
import { RolesService } from './services/roles.service';
import {
  RoleCreateModalComponent,
  RoleEditModalComponent,
  RolePermissionsModalComponent} from './components/index';

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
  PaginationComponent,
  EmptyStateComponent,
  CardComponent} from '../../../../shared/components/index';

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup} from '@angular/forms';

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [
    FormsModule,
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
  styleUrls: ['./roles.component.css']})
export class RolesComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  roles = signal<Role[]>([]);
  roleStats = signal<RoleStats>({
    totalRoles: 0,
    systemRoles: 0,
    customRoles: 0,
    totalPermissions: 0});
  isLoading = signal(false);
  currentRole = signal<Role | null>(null);

  showCreateModal = signal(false);
  showEditModal = signal(false);
  showPermissionsModal = signal(false);

  isCreatingRole = signal(false);
  isUpdatingRole = signal(false);
  isUpdatingPermissions = signal(false);

  pagination = signal({ page: 1, limit: 10, total: 0, totalPages: 0 });

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
        }},
      transform: (value: boolean) => (value ? 'Sistema' : 'Personalizado')},
    {
      key: '_count.user_roles',
      label: 'Usuarios',
      sortable: true,
      defaultValue: '0',
      priority: 3},
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
      }},
    {
      key: 'created_at',
      label: 'Fecha Creación',
      sortable: true,
      priority: 3,
      transform: (value: string) => this.formatDate(value)},
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
      }},
    badgeTransform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    detailKeys: [
      { key: '_count.user_roles', label: 'Usuarios', icon: 'users' },
      {
        key: 'created_at',
        label: 'Fecha',
        transform: (v) => this.formatDate(v)},
    ]};

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (role: Role) => this.editRole(role),
      variant: 'info'},
    {
      label: 'Permisos',
      icon: 'settings',
      action: (role: Role) => this.openPermissionsModal(role),
      variant: 'ghost'},
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: Role) => this.confirmDelete(role),
      variant: 'danger',
      disabled: (role: Role) =>
        role.is_system_role || (role._count?.user_roles ?? 0) > 0},
  ];

  constructor() {
    this.filterForm = this.fb.group({
      search: [''],
      is_system_role: ['']});

    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
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

    this.filterForm
      .get('is_system_role')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pagination.update((p) => ({ ...p, page: 1 }));
        this.loadRoles();
      });

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
      is_system_role:
        filters.is_system_role && filters.is_system_role !== ''
          ? filters.is_system_role === 'true'
          : undefined};

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
                Math.ceil((response.pagination!.total || 0) / p.limit)}));
          }
        },
        error: (error) => {
          console.error('Error loading roles:', error);
          this.roles.set([]);
          this.toastService.error('Error al cargar roles');
        }})
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
        }});
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
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
        confirmVariant: 'danger'})
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
      }});
  }

  // === Modal Outputs === //

  onRoleCreated(roleData: any): void {
    this.rolesService.createRole(roleData).subscribe({
      next: () => {
        this.showCreateModal.set(false);
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol creado exitosamente');
      },
      error: (error) => {
        console.error('Error creating role:', error);
        this.toastService.error('Error al crear el rol');
      }});
  }

  onRoleUpdated(roleData: any): void {
    const role = this.currentRole();
    if (!role) return;

    this.rolesService.updateRole(role.id, roleData).subscribe({
      next: () => {
        this.showEditModal.set(false);
        this.currentRole.set(null);
        this.loadRoles();
        this.loadRoleStats();
        this.toastService.success('Rol actualizado exitosamente');
      },
      error: (error) => {
        console.error('Error updating role:', error);
        this.toastService.error('Error al actualizar el rol');
      }});
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
              permission_ids: toAdd}),
          );
        if (toRemove.length)
          requests.push(
            this.rolesService.removePermissionsFromRole(role.id, {
              permission_ids: toRemove}),
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
            }});
        });
      },
      error: (err) => {
        this.isUpdatingPermissions.set(false);
        this.toastService.error('Error al obtener permisos actuales');
      }});
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
      minute: '2-digit'});
  }
}
