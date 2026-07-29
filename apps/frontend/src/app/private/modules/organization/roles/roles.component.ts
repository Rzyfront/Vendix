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
  CreateRoleDto,
  Role,
  RoleQueryDto,
  PaginatedRolesResponse,
} from './interfaces/role.interface';
import { OrgRolesService } from './services/org-roles.service';
import { extractRoleErrorMessage } from './services/org-role-errors';
import {
  canEditRoleScope,
  getRoleReadOnlyReason,
} from '../../../../shared/constants/role-scope.constant';
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
  /** '' | 'system' | 'organization' | 'store' — QUI-72. */
  readonly scopeFilter = signal('');
  readonly filteredRoles = computed(() => {
    const scope = this.scopeFilter();
    const roles = this.roles();

    if (!scope) return roles;
    return roles.filter((role) => role.scope === scope);
  });
  /**
   * QUI-72 — las tarjetas pasan de "Sistema / Personalizado" a los TRES
   * alcances y se derivan del listado ya cargado. `GET /organization/roles/stats`
   * exige rol `super_admin`, así que para un admin de organización siempre
   * respondía 403 y las tarjetas quedaban en cero.
   */
  readonly statsItems = computed<StatItem[]>(() => {
    const roles = this.roles();
    const countBy = (scope: string) =>
      roles.filter((role) => role.scope === scope).length;

    return [
      {
        title: 'Total Roles',
        value: roles.length,
        smallText: 'visibles en la organización',
        iconName: 'shield',
        iconBgColor: 'bg-primary/10',
        iconColor: 'text-primary',
      },
      {
        title: 'Roles de Sistema',
        value: countBy('system'),
        smallText: 'sólo lectura',
        iconName: 'shield-check',
        iconBgColor: 'bg-purple-100',
        iconColor: 'text-purple-600',
      },
      {
        title: 'Roles de Organización',
        value: countBy('organization'),
        smallText: 'editables',
        iconName: 'building-2',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-600',
      },
      {
        title: 'Roles de Tienda',
        value: countBy('store'),
        smallText: 'de tus tiendas',
        iconName: 'store',
        iconBgColor: 'bg-green-100',
        iconColor: 'text-green-600',
      },
    ];
  });
  readonly isLoading = signal(false);
  readonly currentRole = signal<Role | null>(null);
  readonly showCreateModal = model<boolean>(false);
  readonly showEditModal = model<boolean>(false);
  readonly showPermissionsModal = model<boolean>(false);
  readonly isSubmitting = signal(false);

  ngOnInit(): void {
    this.loadRoles();
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
          this.toastService.error(
            extractRoleErrorMessage(error, 'Error al cargar roles'),
          );
        },
      })
      .add(() => {
        this.isLoading.set(false);
      });
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm.set(searchTerm);
    this.loadRoles();
  }

  onFilterChange(filters: Record<string, string>): void {
    this.scopeFilter.set(filters['scope'] || '');
  }

  refreshRoles(): void {
    this.loadRoles();
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
    // Espejo de la matriz del backend: un rol no editable en este nivel
    // tampoco es borrable, y el motivo lo da el contrato compartido.
    if (!canEditRoleScope(role.scope, 'organization')) {
      this.toastService.warning(
        getRoleReadOnlyReason(role.scope, 'organization') ??
          'No puedes eliminar este rol desde la organización.',
      );
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
    this.rolesService
      .deleteRole(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadRoles();
          this.toastService.success('Rol eliminado exitosamente');
        },
        error: (error) => {
          console.error('Error deleting role:', error);
          this.toastService.error(
            extractRoleErrorMessage(error, 'Error al eliminar el rol'),
          );
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

  onRoleCreated(roleData: CreateRoleDto): void {
    this.rolesService
      .createRole(roleData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showCreateModal.set(false);
          this.loadRoles();
          this.toastService.success('Rol creado exitosamente');
        },
        error: (error) => {
          console.error('Error creating role:', error);
          this.toastService.error(
            extractRoleErrorMessage(error, 'Error al crear el rol'),
          );
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
        this.toastService.success('Rol actualizado exitosamente');
      },
      error: (error) => {
        console.error('Error updating role:', error);
        // El backend ya NO degrada el 403 a `200 { success:false }`: sin este
        // manejo, editar un rol de sistema mostraba "actualizado" sin guardar.
        this.toastService.error(
          extractRoleErrorMessage(error, 'Error al actualizar el rol'),
        );
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
        let firstError: unknown = null;

        const checkDone = () => {
          completed++;
          if (completed === requests.length) {
            this.isSubmitting.set(false);
            this.showPermissionsModal.set(false);
            this.currentRole.set(null);
            this.loadRoles();
            if (!firstError) {
              this.toastService.success('Permisos actualizados exitosamente');
            } else {
              // Un 403 `ROLE_SCOPE_001` aquí significa que el rol es de sólo
              // lectura: mostrar el motivo real en vez de "algunos permisos".
              this.toastService.error(
                extractRoleErrorMessage(
                  firstError,
                  'Algunos permisos no se pudieron actualizar',
                ),
              );
            }
          }
        };

        requests.forEach((req) => {
          req.subscribe({
            next: () => checkDone(),
            error: (e: unknown) => {
              console.error(e);
              firstError = firstError ?? e;
              checkDone();
            },
          });
        });
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.toastService.error(
          extractRoleErrorMessage(error, 'Error al obtener permisos actuales'),
        );
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
