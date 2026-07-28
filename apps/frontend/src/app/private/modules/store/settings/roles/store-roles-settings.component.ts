import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


import { StoreRole, StoreRoleStats } from './interfaces/store-role.interface';
import { StoreRolesService } from './services/store-roles.service';
import { storeRoleErrorMessage } from './utils/store-role-errors';
import {
  RoleScope,
  canEditRoleScope,
} from '../../../../../shared/constants/role-scope.constant';

import {
  StoreRoleCreateModalComponent,
  StoreRoleEditModalComponent,
  StoreRoleDetailTab,
  StoreRolePermissionsModalComponent,
  StoreRolesListComponent} from './components/index';

import {
  DialogService,
  ToastService,
  StatsComponent} from '../../../../../shared/components/index';

@Component({
  selector: 'app-store-roles-settings',
  standalone: true,
  imports: [
    StoreRoleCreateModalComponent,
    StoreRoleEditModalComponent,
    StoreRolePermissionsModalComponent,
    StoreRolesListComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Roles"
          [value]="roleStats()?.total_roles ?? 0"
          smallText="visibles en la tienda"
          iconName="shield"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
          [loading]="statsLoading()"
        ></app-stats>

        <app-stats
          title="Sistema"
          [value]="roleStats()?.system_roles ?? 0"
          smallText="roles del sistema"
          iconName="shield-check"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
          [loading]="statsLoading()"
        ></app-stats>

        <app-stats
          title="Organizacion"
          [value]="roleStats()?.organization_roles ?? 0"
          smallText="heredados (solo lectura)"
          iconName="building-2"
          iconBgColor="bg-sky-100"
          iconColor="text-sky-600"
          [loading]="statsLoading()"
        ></app-stats>

        <app-stats
          title="Tienda"
          [value]="roleStats()?.store_roles ?? 0"
          smallText="propios de esta tienda"
          iconName="store"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
          [loading]="statsLoading()"
        ></app-stats>

        <app-stats
          title="Permisos Store"
          [value]="roleStats()?.total_store_permissions ?? 0"
          smallText="permisos disponibles"
          iconName="key"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
          [loading]="statsLoading()"
        ></app-stats>
      </div>

      <!-- List -->
      <app-store-roles-list
        [roles]="filteredRoles()"
        [loading]="isLoading()"
        [totalCount]="roles().length"
        (create)="openCreateModal()"
        (edit)="openDetailModal($event, 'general')"
        (manageUsers)="openDetailModal($event, 'users')"
        (managePermissions)="openPermissionsModal($event)"
        (delete)="deleteRole($event)"
        (searchChange)="onSearchChange($event)"
        (filterChange)="onFilterChange($event)"
        (sort)="onSortChange($event)"
      ></app-store-roles-list>

      @defer (when showCreateModal()) {
        <app-store-role-create-modal
          [isOpen]="showCreateModal()"
          (isOpenChange)="showCreateModal.set($event)"
          (onRoleCreated)="onRoleCreated()"
        />
      }

      @defer (when showDetailModal() && !!currentRole()) {
        <app-store-role-edit-modal
          [role]="currentRole()"
          [initialTab]="detailTab()"
          [isOpen]="showDetailModal()"
          (isOpenChange)="onDetailOpenChange($event)"
          (onRoleUpdated)="onRoleUpdated()"
        />
      }

      @defer (when showPermissionsModal() && !!permissionsRole()) {
        <app-store-role-permissions-modal
          [role]="permissionsRole()"
          [isOpen]="showPermissionsModal()"
          (isOpenChange)="showPermissionsModal.set($event)"
          (onPermissionsUpdated)="onPermissionsUpdated()"
        />
      }
    </div>
  `})
export class StoreRolesSettingsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private storeRolesService = inject(StoreRolesService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
// State
  readonly roles = signal<StoreRole[]>([]);
  readonly filteredRoles = signal<StoreRole[]>([]);
  readonly roleStats = signal<StoreRoleStats | null>(null);
  readonly isLoading = signal(false);
  readonly statsLoading = signal(false);

  // Filters
  private searchTerm = '';
  /** QUI-72: filtro por alcance ('' = todos). */
  private scopeFilter: RoleScope | '' = '';

  // Modals — signals: la plantilla los lee y estamos en zoneless.
  readonly currentRole = signal<StoreRole | null>(null);
  readonly permissionsRole = signal<StoreRole | null>(null);
  readonly detailTab = signal<StoreRoleDetailTab>('general');
  readonly showCreateModal = signal(false);
  readonly showDetailModal = signal(false);
  readonly showPermissionsModal = signal(false);

  ngOnInit(): void {
    this.loadRoles();
    this.loadStats();
  }
loadRoles(): void {
    this.isLoading.set(true);

    this.storeRolesService
      .getRoles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (roles) => {
          this.roles.set(roles);
          this.applyFilters();
        },
        error: (error) => {
          console.error('Error loading store roles:', error);
          this.roles.set([]);
          this.filteredRoles.set([]);
        }})
      .add(() => {
        this.isLoading.set(false);
      });
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.storeRolesService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.roleStats.set(stats);
          this.statsLoading.set(false);
        },
        error: (err) => {
          console.error('Error loading store role stats', err);
          this.statsLoading.set(false);
        }});
  }

  // ── Filters ──────────────────────────────────────────────────────────

  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.applyFilters();
  }

  onFilterChange(filters: Record<string, string>): void {
    if (filters['scope'] !== undefined) {
      this.scopeFilter = (filters['scope'] as RoleScope | '') || '';
    }
    this.applyFilters();
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    if (!event.direction) return;
    this.filteredRoles.set([...this.filteredRoles()].sort((a: any, b: any) => {
      const valA = a[event.column];
      const valB = b[event.column];
      if (valA < valB) return event.direction === 'asc' ? -1 : 1;
      if (valA > valB) return event.direction === 'asc' ? 1 : -1;
      return 0;
    }));
  }

  private applyFilters(): void {
    let filtered = [...this.roles()];

    if (this.scopeFilter) {
      filtered = filtered.filter((r) => r.scope === this.scopeFilter);
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          (r.description && r.description.toLowerCase().includes(term)),
      );
    }

    this.filteredRoles.set(filtered);
  }

  // ── Modals ───────────────────────────────────────────────────────────

  openCreateModal(): void {
    this.showCreateModal.set(true);
  }

  onRoleCreated(): void {
    this.showCreateModal.set(false);
    this.refreshData();
  }

  /**
   * Abre el detalle del rol. `tab` decide si entra por General (Editar) o por
   * Usuarios: la pestaña Usuarios se abre para CUALQUIER alcance porque leer
   * quién tiene el rol es legítimo aunque el rol sea heredado.
   */
  openDetailModal(role: StoreRole, tab: StoreRoleDetailTab): void {
    if (tab === 'general' && !canEditRoleScope(role.scope, 'store')) return;
    this.currentRole.set(role);
    this.detailTab.set(tab);
    this.showDetailModal.set(true);
  }

  onDetailOpenChange(open: boolean): void {
    this.showDetailModal.set(open);
    if (!open) {
      this.currentRole.set(null);
    }
  }

  onRoleUpdated(): void {
    this.refreshData();
  }

  openPermissionsModal(role: StoreRole): void {
    this.permissionsRole.set(role);
    this.showPermissionsModal.set(true);
  }

  onPermissionsUpdated(): void {
    this.showPermissionsModal.set(false);
    this.permissionsRole.set(null);
    this.refreshData();
  }

  deleteRole(role: StoreRole): void {
    if (!canEditRoleScope(role.scope, 'store')) {
      this.toastService.error(
        'Este rol es de solo lectura en la tienda y no se puede eliminar.',
      );
      return;
    }

    this.dialogService
      .confirm({
        title: 'Eliminar Rol',
        message: `Estas seguro de que deseas eliminar el rol "${role.name}"? Esta accion no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger'})
      .then((confirmed) => {
        if (confirmed) {
          this.storeRolesService
            .deleteRole(role.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.toastService.success('Rol eliminado exitosamente');
                this.refreshData();
              },
              error: (error) => {
                console.error('Error deleting role:', error);
                this.toastService.error(
                  storeRoleErrorMessage(error, 'Error al eliminar el rol'),
                );
              }});
        }
      });
  }

  private refreshData(): void {
    this.storeRolesService.invalidateCache();
    this.loadRoles();
    this.loadStats();
  }
}
