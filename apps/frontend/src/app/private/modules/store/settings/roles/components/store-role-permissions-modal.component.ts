import {Component,
  input,
  output,
  model,
  OnChanges,
  inject,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  ToastService} from '../../../../../../shared/components/index';
import { StoreRolesService } from '../services/store-roles.service';
import { StoreRole, StorePermission } from '../interfaces/store-role.interface';
import { forkJoin } from 'rxjs';

interface PermissionGroup {
  module: string;
  permissions: StorePermission[];
}

const MODULE_LABELS: Record<string, { label: string; icon: string }> = {
  accounting: { label: 'Contabilidad', icon: 'calculator' },
  addresses: { label: 'Direcciones', icon: 'map-pin' },
  analytics: { label: 'Analiticas', icon: 'bar-chart-3' },
  audit: { label: 'Auditoria', icon: 'file-search' },
  brands: { label: 'Marcas', icon: 'tag' },
  cash_registers: { label: 'Cajas Registradoras', icon: 'landmark' },
  categories: { label: 'Categorias', icon: 'folders' },
  coupons: { label: 'Cupones', icon: 'ticket' },
  customers: { label: 'Clientes', icon: 'users' },
  domains: { label: 'Dominios', icon: 'globe' },
  ecommerce: { label: 'E-commerce', icon: 'shopping-bag' },
  expenses: { label: 'Gastos', icon: 'receipt' },
  inventory: { label: 'Inventario', icon: 'package' },
  invoicing: { label: 'Facturacion', icon: 'file-text' },
  notifications: { label: 'Notificaciones', icon: 'bell' },
  orders: { label: 'Pedidos', icon: 'shopping-cart' },
  payroll: { label: 'Nomina', icon: 'wallet' },
  products: { label: 'Productos', icon: 'box' },
  promotions: { label: 'Promociones', icon: 'megaphone' },
  quotations: { label: 'Cotizaciones', icon: 'file-check' },
  roles: { label: 'Roles', icon: 'shield' },
  settings: { label: 'Configuracion', icon: 'settings' },
  stores: { label: 'Tiendas', icon: 'store' },
  suppliers: { label: 'Proveedores', icon: 'truck' },
  taxes: { label: 'Impuestos', icon: 'percent' },
  transfers: { label: 'Transferencias', icon: 'arrow-left-right' },
  users: { label: 'Usuarios', icon: 'user-cog' },
  general: { label: 'General', icon: 'layout-grid' }};

const ACTION_LABELS: Record<string, string> = {
  create: 'Crear',
  read: 'Leer',
  update: 'Actualizar',
  delete: 'Eliminar',
  manage: 'Gestionar',
  export: 'Exportar',
  import: 'Importar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  assign: 'Asignar',
  view: 'Ver',
  list: 'Listar',
  edit: 'Editar',
  close: 'Cerrar',
  open: 'Abrir',
  cancel: 'Cancelar',
  send: 'Enviar',
  receive: 'Recibir',
  transfer: 'Transferir',
  configure: 'Configurar'};

@Component({
  selector: 'app-store-role-permissions-modal',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'xl'"
      [title]="'Permisos: ' + (role()?.name || '')"
      subtitle="Configura los permisos de acceso para este rol"
    >
      @if (isLoadingPermissions) {
        <div class="p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando permisos...</p>
        </div>
      }

      @if (!isLoadingPermissions) {
        <div class="space-y-3">
          <!-- Search & Module Filter -->
          <div class="flex flex-col sm:flex-row gap-2">
            <app-inputsearch
              class="flex-1"
              size="sm"
              placeholder="Buscar permisos..."
              [debounceTime]="200"
              (search)="onSearchPermissions($event)"
            ></app-inputsearch>
            <select
              class="px-3 py-2 border border-border rounded-lg bg-surface text-text-primary text-sm min-w-[160px]
                   focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              [value]="moduleFilter"
              (change)="onModuleFilterChange($event)"
            >
              <option value="">Todos los modulos</option>
              @for (mod of availableModules; track mod) {
                <option [value]="mod">
                  {{ getModuleMeta(mod).label }}
                </option>
              }
            </select>
          </div>
          <!-- Summary bar -->
          <div
            class="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-medium text-text-secondary">
                  {{ selectedPermissionIds.size }} de
                  {{ allPermissions.length }} permisos seleccionados
                </span>
                <span class="text-xs font-semibold text-primary">
                  {{ getSelectionPercentage() }}%
                </span>
              </div>
              <div
                class="w-full h-1.5 rounded-full overflow-hidden"
                style="background: var(--color-border)"
              >
                <div
                  class="h-full rounded-full transition-all duration-300"
                  [style.width.%]="getSelectionPercentage()"
                  [style.background]="'var(--color-primary)'"
                ></div>
              </div>
            </div>
          </div>
          <!-- Module Cards -->
          <div class="max-h-[60vh] overflow-y-auto space-y-2.5 pr-0.5">
            @for (group of filteredPermissionGroups; track group) {
              <div
                class="rounded-xl border overflow-hidden transition-colors"
                [ngClass]="
                  isModuleComplete(group)
                    ? 'border-primary/25 bg-primary/[0.02]'
                    : 'border-border bg-surface'
                "
              >
                <!-- Card Header -->
                <div
                  class="px-4 py-2.5 bg-surface-hover/30 flex items-center justify-between"
                >
                  <div class="flex items-center gap-2.5 min-w-0">
                    <app-icon
                      [name]="getModuleMeta(group.module).icon"
                      [size]="16"
                      class="text-text-secondary shrink-0"
                    ></app-icon>
                    <span class="text-sm font-semibold text-text-primary">
                      {{ getModuleMeta(group.module).label }}
                    </span>
                    <span
                      class="px-1.5 py-px text-[10px] font-semibold rounded-full"
                      [ngClass]="
                        isModuleComplete(group)
                          ? 'bg-primary/10 text-primary'
                          : 'bg-surface text-text-secondary'
                      "
                    >
                      {{ getGroupSelectedCount(group) }}/{{
                        group.permissions.length
                      }}
                    </span>
                  </div>
                  <label
                    class="flex items-center gap-1.5 cursor-pointer text-xs text-text-secondary hover:text-text-primary select-none"
                  >
                    <span>Todos</span>
                    <input
                      type="checkbox"
                      [checked]="isGroupFullySelected(group)"
                      [indeterminate]="isGroupPartiallySelected(group)"
                      (change)="toggleGroup(group, $any($event.target).checked)"
                      class="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary accent-[var(--color-primary)]"
                    />
                  </label>
                </div>
                <!-- Mini progress bar -->
                <div class="h-[2px]" style="background: var(--color-border)">
                  <div
                    class="h-full transition-all duration-300"
                    [style.width.%]="getModuleProgress(group)"
                    [style.background]="'var(--color-primary)'"
                  ></div>
                </div>
                <!-- Permissions Grid -->
                <div class="p-2.5">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                    @for (perm of group.permissions; track perm) {
                      <label
                        class="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm transition-colors"
                        [ngClass]="
                          selectedPermissionIds.has(perm.id)
                            ? 'bg-primary/5 hover:bg-primary/10'
                            : 'hover:bg-surface-hover/50'
                        "
                      >
                        <input
                          type="checkbox"
                          [checked]="selectedPermissionIds.has(perm.id)"
                          (change)="togglePermission(perm.id)"
                          class="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary accent-[var(--color-primary)] shrink-0"
                        />
                        <span class="text-text-primary leading-tight truncate">
                          {{ getPermissionLabel(perm) }}
                        </span>
                      </label>
                    }
                  </div>
                </div>
              </div>
            }
            @if (filteredPermissionGroups.length === 0) {
              <div class="p-8 text-center">
                <app-icon
                  name="search-x"
                  [size]="32"
                  class="text-text-secondary/40 mx-auto mb-2"
                ></app-icon>
                <p class="text-text-secondary text-sm">
                  {{
                    searchTerm || moduleFilter
                      ? 'No se encontraron permisos con esos filtros'
                      : 'No hay permisos disponibles'
                  }}
                </p>
              </div>
            }
          </div>
        </div>
      }

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isSaving"
          >Cancelar</app-button
        >
        <app-button
          variant="primary"
          (clicked)="onSave()"
          [disabled]="isSaving"
          [loading]="isSaving"
        >
          {{
            getChangeCount() > 0
              ? 'Guardar (' + getChangeCount() + ' cambios)'
              : 'Guardar Permisos'
          }}
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ]})
export class StoreRolePermissionsModalComponent
  implements OnChanges
{
  private destroyRef = inject(DestroyRef);
  readonly isOpen = model<boolean>(false);
  readonly role = model<StoreRole | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly onPermissionsUpdated = output<void>();

  permissionGroups: PermissionGroup[] = [];
  selectedPermissionIds = new Set<number>();
  originalPermissionIds = new Set<number>();
  allPermissions: StorePermission[] = [];

  searchTerm = '';
  moduleFilter = '';
  availableModules: string[] = [];

  isLoadingPermissions: boolean = false;
  isSaving: boolean = false;
private storeRolesService = inject(StoreRolesService);
  private toastService = inject(ToastService);
ngOnChanges(): void {
    if (this.isOpen() && this.role()) {
      this.searchTerm = '';
      this.moduleFilter = '';
      this.loadPermissions();
    }
  }

  private loadPermissions(): void {
    const currentRole = this.role();
    if (!currentRole) return;

    this.isLoadingPermissions = true;

    forkJoin({
      available: this.storeRolesService.getAvailablePermissions(),
      current: this.storeRolesService.getRolePermissions(currentRole.id)})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ available, current }) => {
          this.allPermissions = available;
          this.permissionGroups = this.groupPermissions(available);
          this.availableModules = this.permissionGroups
            .map((g) => g.module)
            .sort();

          // Only keep permission IDs that exist in the available store permissions
          const availableIds = new Set(available.map((p) => p.id));
          const storePermissionIds = (current.permission_ids || []).filter(
            (id: number) => availableIds.has(id),
          );
          this.selectedPermissionIds = new Set(storePermissionIds);
          this.originalPermissionIds = new Set(storePermissionIds);

          this.isLoadingPermissions = false;
        },
        error: (error) => {
          console.error('Error loading permissions:', error);
          this.isLoadingPermissions = false;
          this.toastService.error('Error al cargar los permisos');
        }});
  }

  private groupPermissions(permissions: StorePermission[]): PermissionGroup[] {
    const groups = new Map<string, StorePermission[]>();

    for (const perm of permissions) {
      const parts = perm.name.split(':');
      const module = parts.length >= 2 ? parts[1] : perm.module || 'general';

      if (!groups.has(module)) {
        groups.set(module, []);
      }
      groups.get(module)!.push(perm);
    }

    return Array.from(groups.entries())
      .map(([module, perms]) => ({ module, permissions: perms }))
      .sort((a, b) => a.module.localeCompare(b.module));
  }

  // ── Search & Filter ────────────────────────────────────────────────

  onSearchPermissions(term: string): void {
    this.searchTerm = term;
  }

  onModuleFilterChange(event: Event): void {
    this.moduleFilter = (event.target as HTMLSelectElement).value;
  }

  get filteredPermissionGroups(): PermissionGroup[] {
    let groups = this.permissionGroups;

    if (this.moduleFilter) {
      groups = groups.filter((g) => g.module === this.moduleFilter);
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      groups = groups
        .map((g) => ({
          ...g,
          permissions: g.permissions.filter(
            (p) =>
              (p.description && p.description.toLowerCase().includes(term)) ||
              p.name.toLowerCase().includes(term),
          )}))
        .filter((g) => g.permissions.length > 0);
    }

    return groups;
  }

  // ── Module & Permission Display ────────────────────────────────────

  getModuleMeta(module: string): { label: string; icon: string } {
    return MODULE_LABELS[module] || { label: module, icon: 'layout-grid' };
  }

  getPermissionLabel(perm: StorePermission): string {
    if (perm.description) return perm.description;

    const parts = perm.name.split(':');
    const action = parts.length >= 3 ? parts.slice(2).join(' ') : perm.name;
    return ACTION_LABELS[action] || action.replace(/_/g, ' ');
  }

  getModuleProgress(group: PermissionGroup): number {
    if (group.permissions.length === 0) return 0;
    return (this.getGroupSelectedCount(group) / group.permissions.length) * 100;
  }

  isModuleComplete(group: PermissionGroup): boolean {
    return (
      group.permissions.length > 0 &&
      group.permissions.every((p) => this.selectedPermissionIds.has(p.id))
    );
  }

  getSelectionPercentage(): number {
    if (this.allPermissions.length === 0) return 0;
    return Math.round(
      (this.selectedPermissionIds.size / this.allPermissions.length) * 100,
    );
  }

  getChangeCount(): number {
    let count = 0;
    for (const id of this.selectedPermissionIds) {
      if (!this.originalPermissionIds.has(id)) count++;
    }
    for (const id of this.originalPermissionIds) {
      if (!this.selectedPermissionIds.has(id)) count++;
    }
    return count;
  }

  // ── Group & Permission Toggles ─────────────────────────────────────

  getGroupSelectedCount(group: PermissionGroup): number {
    return group.permissions.filter((p) => this.selectedPermissionIds.has(p.id))
      .length;
  }

  isGroupFullySelected(group: PermissionGroup): boolean {
    return group.permissions.every((p) => this.selectedPermissionIds.has(p.id));
  }

  isGroupPartiallySelected(group: PermissionGroup): boolean {
    const count = this.getGroupSelectedCount(group);
    return count > 0 && count < group.permissions.length;
  }

  toggleGroup(group: PermissionGroup, checked: boolean): void {
    for (const perm of group.permissions) {
      if (checked) {
        this.selectedPermissionIds.add(perm.id);
      } else {
        this.selectedPermissionIds.delete(perm.id);
      }
    }
    this.selectedPermissionIds = new Set(this.selectedPermissionIds);
  }

  togglePermission(permissionId: number): void {
    if (this.selectedPermissionIds.has(permissionId)) {
      this.selectedPermissionIds.delete(permissionId);
    } else {
      this.selectedPermissionIds.add(permissionId);
    }
    this.selectedPermissionIds = new Set(this.selectedPermissionIds);
  }

  // ── Save ──────────────────────────────────────────────────────────

  onSave(): void {
    const currentRole = this.role();
    if (!currentRole || this.isSaving) return;

    const toAdd: number[] = [];
    const toRemove: number[] = [];

    for (const id of this.selectedPermissionIds) {
      if (!this.originalPermissionIds.has(id)) {
        toAdd.push(id);
      }
    }

    for (const id of this.originalPermissionIds) {
      if (!this.selectedPermissionIds.has(id)) {
        toRemove.push(id);
      }
    }

    if (toAdd.length === 0 && toRemove.length === 0) {
      this.toastService.success('No hay cambios en los permisos');
      this.isOpenChange.emit(false);
      return;
    }

    this.isSaving = true;
    const operations: any[] = [];

    if (toAdd.length > 0) {
      operations.push(
        this.storeRolesService.assignPermissions(currentRole.id, toAdd),
      );
    }
    if (toRemove.length > 0) {
      operations.push(
        this.storeRolesService.removePermissions(currentRole.id, toRemove),
      );
    }

    forkJoin(operations)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.toastService.success('Permisos actualizados exitosamente');
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          this.onPermissionsUpdated.emit();
          this.isOpenChange.emit(false);
        },
        error: (error: any) => {
          this.isSaving = false;
          console.error('Error updating permissions:', error);
          const message =
            error?.error?.message || 'Error al actualizar los permisos';
          this.toastService.error(message);
        }});
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }
}
