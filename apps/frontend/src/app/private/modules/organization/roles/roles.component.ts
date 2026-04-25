import {
  Component,
  OnInit,
  inject,
  signal,
  model,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import {
  Role,
  RoleQueryDto,
  RoleStats,
  PaginatedRolesResponse,
} from './interfaces/role.interface';
import { OrgRolesService } from './services/org-roles.service';
import {
  RoleCreateModalComponent,
  RoleEditModalComponent,
  PermissionTreeSelectorComponent,
} from './components/index';

import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  ButtonComponent,
  DialogService,
  ToastService,
  StatsComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  EmptyStateComponent,
  IconComponent,
} from '../../../../shared/components/index';

import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';

interface StatItem {
  title: string;
  value: number;
  smallText: string;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    RoleCreateModalComponent,
    RoleEditModalComponent,
    PermissionTreeSelectorComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    ButtonComponent,
    StatsComponent,
    IconComponent,
  ],
  templateUrl: './roles.component.html',
  styleUrls: ['./roles.component.css'],
})
export class RolesComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private rolesService = inject(OrgRolesService);
  private fb = inject(FormBuilder);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  readonly roles = signal<Role[]>([]);
  readonly roleStats = signal<RoleStats | null>(null);
  readonly statsItems = signal<StatItem[]>([]);
  readonly isLoading = signal(false);
  readonly currentRole = signal<Role | null>(null);
  readonly showCreateModal = model<boolean>(false);
  readonly showEditModal = model<boolean>(false);
  readonly showPermissionsModal = model<boolean>(false);
  readonly isSubmitting = signal(false);

  filterForm: FormGroup;
  private searchSubject = new Subject<string>();

  tableColumns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'description',
      label: 'Descripción',
      sortable: true,
      priority: 2,
    },
    {
      key: 'system_role',
      label: 'Tipo',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          true: '#3b82f6',
          false: '#10b981',
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
      sortable: false,
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

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    badgeKey: 'system_role',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        true: '#3b82f6',
        false: '#10b981',
      },
    },
    badgeTransform: (value: boolean) => (value ? 'Sistema' : 'Personalizado'),
    detailKeys: [
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
      label: 'Permisos',
      icon: 'shield',
      action: (role: Role) => this.openPermissionsModal(role),
      variant: 'ghost',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: Role) => this.confirmDelete(role),
      variant: 'danger',
      disabled: (role: Role) =>
        role.system_role || (role._count?.user_roles ?? 0) > 0,
    },
  ];

  constructor() {
    this.filterForm = this.fb.group({
      search: [''],
    });

    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((searchTerm: string) => {
        this.filterForm.patchValue({ search: searchTerm }, { emitEvent: false });
        this.loadRoles();
      });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadRoleStats();
  }

  loadRoles(): void {
    this.isLoading.set(true);
    const filters = this.filterForm.value;
    const query: RoleQueryDto = {
      search: filters.search || undefined,
    };

    this.rolesService
      .getRoles(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: PaginatedRolesResponse) => {
          this.roles.set(response.data || []);
        },
        error: (error) => {
          console.error('Error loading roles:', error);
          this.roles.set([]);
          this.toastService.error('Error al cargar roles');
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
          this.updateStatsItems();
        },
        error: (error) => {
          console.error('Error loading role stats:', error);
        },
      });
  }

  private updateStatsItems(): void {
    const s = this.roleStats() || {
      total_roles: 0,
      system_roles: 0,
      custom_roles: 0,
      total_permissions: 0,
    };
    const total = s.total_roles || 0;

    this.statsItems.set([
      {
        title: 'Total Roles',
        value: total,
        smallText: 'en la organización',
        iconName: 'shield',
        iconBgColor: 'bg-primary/10',
        iconColor: 'text-primary',
      },
      {
        title: 'Roles de Sistema',
        value: s.system_roles || 0,
        smallText: 'no modificables',
        iconName: 'lock',
        iconBgColor: 'bg-purple-100',
        iconColor: 'text-purple-600',
      },
      {
        title: 'Roles Personalizados',
        value: s.custom_roles || 0,
        smallText: 'editables',
        iconName: 'user-check',
        iconBgColor: 'bg-green-100',
        iconColor: 'text-green-600',
      },
      {
        title: 'Permisos Disponibles',
        value: s.total_permissions || 0,
        smallText: 'configurables',
        iconName: 'key',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-600',
      },
    ]);
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
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

  openPermissionsModal(role: Role): void {
    this.currentRole.set(role);
    this.showPermissionsModal.set(true);
  }

  confirmDelete(role: Role): void {
    if (role.system_role) {
      this.toastService.warning('No se pueden eliminar roles del sistema.');
      return;
    }

    if ((role._count?.user_roles ?? 0) > 0) {
      this.toastService.warning(
        'No se puede eliminar un rol que tiene usuarios asignados.',
      );
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

  onRoleCreated(roleData: { name: string; description?: string }): void {
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
      },
    });
  }

  onRoleUpdated(roleData: { name?: string; description?: string }): void {
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
      },
    });
  }

  onPermissionsUpdated(permissionData: { permission_ids: number[] }): void {
    const role = this.currentRole();
    if (!role) return;

    this.isSubmitting.set(true);

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
          this.isSubmitting.set(false);
          this.showPermissionsModal.set(false);
          this.currentRole.set(null);
          this.toastService.info('No hay cambios en los permisos');
          return;
        }

        const requests: any[] = [];
        if (toAdd.length) {
          requests.push(
            this.rolesService.assignPermissionsToRole(role.id, {
              permission_ids: toAdd,
            }),
          );
        }
        if (toRemove.length) {
          requests.push(
            this.rolesService.removePermissionsFromRole(role.id, {
              permission_ids: toRemove,
            }),
          );
        }

        let completed = 0;
        let errors = 0;

        const checkDone = () => {
          completed++;
          if (completed === requests.length) {
            this.isSubmitting.set(false);
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
      error: (err) => {
        this.isSubmitting.set(false);
        this.toastService.error('Error al obtener permisos actuales');
      },
    });
  }

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search) {
      return 'No hay roles que coincidan';
    }
    return 'No hay roles';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search) {
      return 'Intenta ajustar los filtros de búsqueda';
    }
    return 'Comienza creando tu primer rol personalizado.';
  }

  formatDate(dateString: string): string {
    if (!dateString) return '-';
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
