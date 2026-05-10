import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  model,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Role,
  RoleQueryDto,
  RoleStats,
  PaginatedRolesResponse,
} from './interfaces/role.interface';
import { OrgRolesService } from './services/org-roles.service';
import {
  OrgRolesListComponent,
  RoleCreateModalComponent,
  RoleEditModalComponent,
  PermissionTreeSelectorComponent,
} from './components/index';

import {
  DialogService,
  ToastService,
  StatsComponent,
} from '../../../../shared/components/index';

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
    RoleCreateModalComponent,
    RoleEditModalComponent,
    PermissionTreeSelectorComponent,
    StatsComponent,
    OrgRolesListComponent,
  ],
  templateUrl: './roles.component.html',
  styleUrls: ['./roles.component.css'],
})
export class RolesComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private rolesService = inject(OrgRolesService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  readonly roles = signal<Role[]>([]);
  readonly searchTerm = signal('');
  readonly typeFilter = signal('');
  readonly filteredRoles = computed(() => {
    const type = this.typeFilter();
    const roles = this.roles();

    if (type === 'system') {
      return roles.filter((role) => role.system_role);
    }

    if (type === 'custom') {
      return roles.filter((role) => !role.system_role);
    }

    return roles;
  });
  readonly roleStats = signal<RoleStats | null>(null);
  readonly statsItems = signal<StatItem[]>([]);
  readonly isLoading = signal(false);
  readonly currentRole = signal<Role | null>(null);
  readonly showCreateModal = model<boolean>(false);
  readonly showEditModal = model<boolean>(false);
  readonly showPermissionsModal = model<boolean>(false);
  readonly isSubmitting = signal(false);

  ngOnInit(): void {
    this.loadRoles();
    this.loadRoleStats();
  }

  loadRoles(): void {
    this.isLoading.set(true);
    const query: RoleQueryDto = {
      search: this.searchTerm() || undefined,
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
    this.searchTerm.set(searchTerm);
    this.loadRoles();
  }

  onFilterChange(filters: Record<string, string>): void {
    this.typeFilter.set(filters['type'] || '');
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

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    if (!event.direction) return;

    const sorted = [...this.roles()].sort((a, b) => {
      const valueA = this.getSortValue(a, event.column);
      const valueB = this.getSortValue(b, event.column);

      if (valueA < valueB) return event.direction === 'asc' ? -1 : 1;
      if (valueA > valueB) return event.direction === 'asc' ? 1 : -1;
      return 0;
    });

    this.roles.set(sorted);
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

  private getSortValue(role: Role, path: string): string | number {
    const value = path
      .split('.')
      .reduce<unknown>(
        (current, key) =>
          current && typeof current === 'object'
            ? (current as Record<string, unknown>)[key]
            : undefined,
        role,
      );

    if (Array.isArray(value)) return value.length;
    if (typeof value === 'string') return value.toLowerCase();
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;

    return '';
  }
}
