import {
  Component,
  input,
  output,
  signal,
  computed,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Permission, PermissionGroupedByDomain, PermissionStatus } from '../interfaces/role.interface';
import { OrgRolesService } from '../services/org-roles.service';
import {
  ModalComponent,
  IconComponent,
  InputsearchComponent,
  ButtonComponent,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-permission-tree-selector',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    IconComponent,
    InputsearchComponent,
    ButtonComponent,
    ScrollingModule,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      [title]="modalTitle"
      [subtitle]="modalSubtitle"
      size="xl"
      [showCloseButton]="true"
    >
      <div class="space-y-4">
        <!-- Search and Actions -->
        <div class="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
          <div class="flex-1 min-w-0">
            <app-inputsearch
              placeholder="Buscar permisos..."
              [debounceTime]="300"
              size="sm"
              (searchChange)="onSearchChange($event)"
            ></app-inputsearch>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <app-button
              variant="outline"
              size="sm"
              (clicked)="selectAll()"
              [disabled]="isLoadingPermissions()"
            >
              Seleccionar Todo
            </app-button>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="deselectAll()"
              [disabled]="isLoadingPermissions()"
            >
              Deseleccionar Todo
            </app-button>
          </div>
        </div>

        <!-- Domain Selector -->
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="domain-chip"
            [class.active]="selectedDomain() === ''"
            (click)="selectDomain('')"
          >
            Todos
          </button>
          @for (group of permissionGroups(); track group.domain) {
            <button
              type="button"
              class="domain-chip"
              [class.active]="selectedDomain() === group.domain"
              (click)="selectDomain(group.domain)"
            >
              {{ group.label }}
              <span class="count">({{ group.permissions.length }})</span>
            </button>
          }
        </div>

        <!-- Loading state -->
        @if (isLoadingPermissions()) {
          <div class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        }

        <!-- Permission Groups with Virtual Scroll -->
        @if (!isLoadingPermissions()) {
          <cdk-virtual-scroll-viewport
            itemSize="48"
            class="permission-viewport"
          >
            <div
              *cdkVirtualFor="let group of filteredGroups(); let i = index"
              class="permission-group"
            >
              <div class="group-header">
                <div class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    class="permission-checkbox"
                    [checked]="isGroupFullySelected(group)"
                    [indeterminate]="isGroupPartiallySelected(group)"
                    (change)="toggleGroup(group, $event)"
                  />
                  <app-icon [name]="getDomainIcon(group.domain)" [size]="16"></app-icon>
                  <span class="font-medium text-text-primary">{{ group.label }}</span>
                </div>
                <span class="text-xs text-text-secondary">
                  {{ getSelectedCount(group) }}/{{ group.permissions.length }}
                </span>
              </div>

              <div class="group-permissions">
                @for (permission of group.permissions; track permission.id) {
                  <div class="permission-item">
                    <input
                      type="checkbox"
                      class="permission-checkbox"
                      [checked]="isPermissionSelected(permission.id)"
                      (change)="togglePermission(permission.id, $event)"
                    />
                    <div class="permission-info">
                      <span class="permission-name">{{ permission.name }}</span>
                      <span class="permission-desc">{{ permission.description }}</span>
                    </div>
                    <span class="method-badge method-{{ permission.method.toLowerCase() }}">
                      {{ permission.method }}
                    </span>
                    <span
                      class="status-badge status-{{ permission.status }}"
                      [class.inactive]="permission.status !== 'active'"
                    >
                      {{ getStatusLabel(permission.status) }}
                    </span>
                  </div>
                }
              </div>
            </div>

            @if (filteredGroups().length === 0) {
              <div class="text-center py-8">
                <app-icon
                  name="search"
                  size="48"
                  class="mx-auto text-text-muted mb-4"
                ></app-icon>
                <p class="text-text-secondary">No se encontraron permisos</p>
              </div>
            }
          </cdk-virtual-scroll-viewport>
        }

        <!-- Selected Summary -->
        <div class="selected-summary">
          <p class="text-sm text-text-secondary">
            <span class="font-medium">{{ selectedPermissions().length }}</span>
            permisos seleccionados de
            <span class="font-medium">{{ totalPermissions() }}</span>
          </p>
        </div>
      </div>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" (clicked)="onCancel()" [disabled]="isSubmitting()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSave()"
          [disabled]="isSubmitting() || selectedPermissions().length === 0"
          [loading]="isSubmitting()"
        >
          Guardar Permisos
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host {
      display: block;
    }

    .domain-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }

    .domain-chip:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .domain-chip.active {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: white;
    }

    .domain-chip .count {
      opacity: 0.7;
    }

    .permission-viewport {
      height: 400px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }

    .permission-group {
      border-bottom: 1px solid var(--color-border);
    }

    .permission-group:last-child {
      border-bottom: none;
    }

    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--color-muted);
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .group-permissions {
      padding: 8px 16px;
    }

    .permission-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--color-border);
    }

    .permission-item:last-child {
      border-bottom: none;
    }

    .permission-info {
      flex: 1;
      min-width: 0;
    }

    .permission-name {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .permission-desc {
      display: block;
      font-size: 11px;
      color: var(--color-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .method-badge {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      font-family: monospace;
    }

    .method-get { background: #dbeafe; color: #1d4ed8; }
    .method-post { background: #dcfce7; color: #15803d; }
    .method-put { background: #fef3c7; color: #b45309; }
    .method-delete { background: #fee2e2; color: #b91c1c; }
    .method-patch { background: #f3e8ff; color: #7c3aed; }
    .method-options { background: #f1f5f9; color: #64748b; }
    .method-head { background: #f1f5f9; color: #64748b; }

    .status-badge {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
    }

    .status-active { background: #dcfce7; color: #15803d; }
    .status-inactive { background: #fef3c7; color: #b45309; }
    .status-deprecated { background: #fee2e2; color: #b91c1c; }

    .permission-checkbox {
      width: 16px;
      height: 16px;
      accent-color: var(--color-primary);
    }

    .selected-summary {
      padding: 12px 16px;
      background: var(--color-surface);
      border-radius: 8px;
      text-align: center;
    }
  `],
})
export class PermissionTreeSelectorComponent {
  private destroyRef = inject(DestroyRef);
  private rolesService = inject(OrgRolesService);

  readonly isOpen = input<boolean>(false);
  readonly roleId = input<number | null>(null);
  readonly roleName = input<string>('');
  readonly isSubmitting = input<boolean>(false);

  readonly isOpenChange = output<boolean>();
  readonly permissionsChange = output<{ permission_ids: number[] }>();
  readonly cancel = output<void>();

  permissions = signal<Permission[]>([]);
  selectedPermissions = signal<number[]>([]);
  isLoadingPermissions = signal(false);
  searchTerm = signal('');
  selectedDomain = signal('');

  private searchSubject = new Subject<string>();

  private readonly domainConfig: Record<string, { label: string; icon: string }> = {
    addresses: { label: 'Direcciones', icon: 'map-pin' },
    audit: { label: 'Auditoría', icon: 'shield' },
    auth: { label: 'Autenticación', icon: 'lock' },
    brands: { label: 'Marcas', icon: 'tag' },
    categories: { label: 'Categorías', icon: 'folder' },
    domains: { label: 'Dominios', icon: 'globe' },
    orders: { label: 'Pedidos', icon: 'shopping-cart' },
    organizations: { label: 'Organizaciones', icon: 'building' },
    payments: { label: 'Pagos', icon: 'credit-card' },
    products: { label: 'Productos', icon: 'package' },
    refunds: { label: 'Reembolsos', icon: 'rotate-ccw' },
    roles: { label: 'Roles', icon: 'users' },
    stores: { label: 'Tiendas', icon: 'store' },
    users: { label: 'Usuarios', icon: 'user' },
    payroll: { label: 'Nómina', icon: 'banknote' },
    accounting: { label: 'Contabilidad', icon: 'book-open' },
    subscriptions: { label: 'Suscripciones', icon: 'refresh-cw' },
    integrations: { label: 'Integraciones', icon: 'plug' },
  };

  permissionGroups = computed<PermissionGroupedByDomain[]>(() => {
    const perms = this.permissions();
    const groups: Record<string, Permission[]> = {};

    for (const perm of perms) {
      const domain = this.extractDomain(perm.path);
      if (!groups[domain]) {
        groups[domain] = [];
      }
      groups[domain].push(perm);
    }

    return Object.entries(groups)
      .map(([domain, permissions]) => ({
        domain,
        label: this.domainConfig[domain]?.label || this.capitalizeDomain(domain),
        permissions: permissions.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  filteredGroups = computed(() => {
    let groups = this.permissionGroups();
    const domain = this.selectedDomain();
    const term = this.searchTerm().toLowerCase();

    if (domain) {
      groups = groups.filter((g) => g.domain === domain);
    }

    if (term) {
      groups = groups
        .map((g) => ({
          ...g,
          permissions: g.permissions.filter(
            (p) =>
              p.name.toLowerCase().includes(term) ||
              p.description?.toLowerCase().includes(term) ||
              p.path.toLowerCase().includes(term),
          ),
        }))
        .filter((g) => g.permissions.length > 0);
    }

    return groups;
  });

  totalPermissions = computed(() => this.permissions().length);

  get modalTitle(): string {
    return this.roleId() ? 'Configurar Permisos' : 'Seleccionar Permisos';
  }

  get modalSubtitle(): string {
    const name = this.roleName();
    return name ? `Gestionar permisos del rol: ${name}` : 'Seleccione los permisos a asignar';
  }

  constructor() {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((term) => {
        this.searchTerm.set(term);
      });
  }

  private extractDomain(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts.length > 1 ? parts[1] : 'other';
  }

  private capitalizeDomain(domain: string): string {
    return domain.charAt(0).toUpperCase() + domain.slice(1).replace(/-/g, ' ');
  }

  getDomainIcon(domain: string): string {
    return this.domainConfig[domain]?.icon || 'folder';
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case PermissionStatus.ACTIVE:
        return 'Activo';
      case PermissionStatus.INACTIVE:
        return 'Inactivo';
      case PermissionStatus.DEPRECATED:
        return 'Obsoleto';
      default:
        return status;
    }
  }

  onSearchChange(term: string): void {
    this.searchSubject.next(term);
  }

  selectDomain(domain: string): void {
    this.selectedDomain.set(domain);
  }

  isPermissionSelected(id: number): boolean {
    return this.selectedPermissions().includes(id);
  }

  isGroupFullySelected(group: PermissionGroupedByDomain): boolean {
    const selected = this.selectedPermissions();
    return group.permissions.every((p) => selected.includes(p.id));
  }

  isGroupPartiallySelected(group: PermissionGroupedByDomain): boolean {
    const selected = this.selectedPermissions();
    const selectedInGroup = group.permissions.filter((p) => selected.includes(p.id));
    return selectedInGroup.length > 0 && selectedInGroup.length < group.permissions.length;
  }

  getSelectedCount(group: PermissionGroupedByDomain): number {
    const selected = this.selectedPermissions();
    return group.permissions.filter((p) => selected.includes(p.id)).length;
  }

  togglePermission(id: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.selectedPermissions.update((arr) => (arr.includes(id) ? arr : [...arr, id]));
    } else {
      this.selectedPermissions.update((arr) => arr.filter((x) => x !== id));
    }
  }

  toggleGroup(group: PermissionGroupedByDomain, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const ids = group.permissions.map((p) => p.id);

    if (checked) {
      this.selectedPermissions.update((arr) => {
        const newArr = [...arr];
        for (const id of ids) {
          if (!newArr.includes(id)) newArr.push(id);
        }
        return newArr;
      });
    } else {
      this.selectedPermissions.update((arr) => arr.filter((id) => !ids.includes(id)));
    }
  }

  selectAll(): void {
    const allIds = this.filteredGroups().flatMap((g) => g.permissions.map((p) => p.id));
    this.selectedPermissions.set(allIds);
  }

  deselectAll(): void {
    this.selectedPermissions.set([]);
  }

  loadPermissions(): void {
    this.isLoadingPermissions.set(true);

    this.rolesService.getPermissions({ status: 'active' }).subscribe({
      next: (response) => {
        this.permissions.set(response.data || []);

        if (this.roleId()) {
          this.loadRolePermissions();
        } else {
          this.isLoadingPermissions.set(false);
        }
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.permissions.set([]);
        this.isLoadingPermissions.set(false);
      },
    });
  }

  private loadRolePermissions(): void {
    const roleId = this.roleId();
    if (!roleId) return;

    this.rolesService.getRolePermissions(roleId).subscribe({
      next: (permissionIds) => {
        this.selectedPermissions.set(permissionIds || []);
        this.isLoadingPermissions.set(false);
      },
      error: () => {
        this.selectedPermissions.set([]);
        this.isLoadingPermissions.set(false);
      },
    });
  }

  onOpenChange(isOpen: boolean): void {
    if (isOpen) {
      this.permissions.set([]);
      this.selectedPermissions.set([]);
      this.searchTerm.set('');
      this.selectedDomain.set('');
      this.loadPermissions();
    }
    this.isOpenChange.emit(isOpen);
  }

  onSave(): void {
    this.permissionsChange.emit({
      permission_ids: this.selectedPermissions(),
    });
  }

  onCancel(): void {
    this.cancel.emit();
    this.isOpenChange.emit(false);
  }
}
