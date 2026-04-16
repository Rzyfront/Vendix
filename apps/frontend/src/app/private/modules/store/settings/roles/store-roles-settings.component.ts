import { Component, OnInit, OnDestroy, inject } from '@angular/core';

import { Subject, takeUntil } from 'rxjs';
import { StoreRole, StoreRoleStats } from './interfaces/store-role.interface';
import { StoreRolesService } from './services/store-roles.service';

import {
  StoreRoleCreateModalComponent,
  StoreRoleEditModalComponent,
  StoreRolePermissionsModalComponent,
  StoreRolesListComponent,
} from './components/index';

import {
  DialogService,
  ToastService,
  StatsComponent,
} from '../../../../../shared/components/index';

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
          [value]="roleStats?.total_roles ?? 0"
          smallText="en la tienda"
          iconName="shield"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
          [loading]="statsLoading"
        ></app-stats>

        <app-stats
          title="Sistema"
          [value]="roleStats?.system_roles ?? 0"
          smallText="roles del sistema"
          iconName="lock"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [loading]="statsLoading"
        ></app-stats>

        <app-stats
          title="Personalizados"
          [value]="roleStats?.custom_roles ?? 0"
          smallText="roles personalizados"
          iconName="edit"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
          [loading]="statsLoading"
        ></app-stats>

        <app-stats
          title="Permisos Store"
          [value]="roleStats?.total_store_permissions ?? 0"
          smallText="permisos disponibles"
          iconName="key"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
          [loading]="statsLoading"
        ></app-stats>
      </div>

      <!-- List -->
      <app-store-roles-list
        [roles]="filteredRoles"
        [loading]="isLoading"
        [totalCount]="roles.length"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (managePermissions)="openPermissionsModal($event)"
        (delete)="deleteRole($event)"
        (searchChange)="onSearchChange($event)"
        (filterChange)="onFilterChange($event)"
        (sort)="onSortChange($event)"
      ></app-store-roles-list>

      @defer (when showCreateModal) {
        <app-store-role-create-modal
          [(isOpen)]="showCreateModal"
          (onRoleCreated)="onRoleCreated()"
        />
      }

      @defer (when showEditModal && currentRole) {
        <app-store-role-edit-modal
          [role]="currentRole"
          [(isOpen)]="showEditModal"
          (onRoleUpdated)="onRoleUpdated()"
        />
      }

      @defer (when showPermissionsModal && permissionsRole) {
        <app-store-role-permissions-modal
          [role]="permissionsRole"
          [(isOpen)]="showPermissionsModal"
          (onPermissionsUpdated)="onPermissionsUpdated()"
        />
      }
    </div>
  `,
})
export class StoreRolesSettingsComponent implements OnInit, OnDestroy {
  private storeRolesService = inject(StoreRolesService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  // State
  roles: StoreRole[] = [];
  filteredRoles: StoreRole[] = [];
  roleStats: StoreRoleStats | null = null;
  isLoading = false;
  statsLoading = false;

  // Filters
  searchTerm = '';
  typeFilter = '';

  // Modals
  currentRole: StoreRole | null = null;
  permissionsRole: StoreRole | null = null;
  showCreateModal = false;
  showEditModal = false;
  showPermissionsModal = false;

  ngOnInit(): void {
    this.loadRoles();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadRoles(): void {
    this.isLoading = true;

    this.storeRolesService
      .getRoles()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.roles = response.data || [];
          this.applyFilters();
        },
        error: (error) => {
          console.error('Error loading store roles:', error);
          this.roles = [];
          this.filteredRoles = [];
        },
      })
      .add(() => {
        this.isLoading = false;
      });
  }

  loadStats(): void {
    this.statsLoading = true;
    this.storeRolesService
      .getStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => {
          this.roleStats = stats;
          this.statsLoading = false;
        },
        error: (err) => {
          console.error('Error loading store role stats', err);
          this.statsLoading = false;
        },
      });
  }

  // ── Filters ──────────────────────────────────────────────────────────

  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.applyFilters();
  }

  onFilterChange(filters: Record<string, string>): void {
    if (filters['type'] !== undefined) {
      this.typeFilter = filters['type'];
    }
    this.applyFilters();
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    if (!event.direction) return;
    this.filteredRoles = [...this.filteredRoles].sort((a: any, b: any) => {
      const valA = a[event.column];
      const valB = b[event.column];
      if (valA < valB) return event.direction === 'asc' ? -1 : 1;
      if (valA > valB) return event.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  private applyFilters(): void {
    let filtered = [...this.roles];

    if (this.typeFilter === 'system') {
      filtered = filtered.filter((r) => r.system_role);
    } else if (this.typeFilter === 'custom') {
      filtered = filtered.filter((r) => !r.system_role);
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          (r.description && r.description.toLowerCase().includes(term)),
      );
    }

    this.filteredRoles = filtered;
  }

  // ── Modals ───────────────────────────────────────────────────────────

  openCreateModal(): void {
    this.showCreateModal = true;
  }

  onRoleCreated(): void {
    this.showCreateModal = false;
    this.refreshData();
  }

  openEditModal(role: StoreRole): void {
    this.currentRole = role;
    this.showEditModal = true;
  }

  onRoleUpdated(): void {
    this.showEditModal = false;
    this.currentRole = null;
    this.refreshData();
  }

  openPermissionsModal(role: StoreRole): void {
    this.permissionsRole = role;
    this.showPermissionsModal = true;
  }

  onPermissionsUpdated(): void {
    this.showPermissionsModal = false;
    this.permissionsRole = null;
    this.refreshData();
  }

  deleteRole(role: StoreRole): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Rol',
        message: `Estas seguro de que deseas eliminar el rol "${role.name}"? Esta accion no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.storeRolesService.deleteRole(role.id).subscribe({
            next: () => {
              this.toastService.success('Rol eliminado exitosamente');
              this.refreshData();
            },
            error: (error) => {
              console.error('Error deleting role:', error);
              const message =
                error?.error?.message || 'Error al eliminar el rol';
              this.toastService.error(message);
            },
          });
        }
      });
  }

  private refreshData(): void {
    this.storeRolesService.invalidateCache();
    this.loadRoles();
    this.loadStats();
  }
}
