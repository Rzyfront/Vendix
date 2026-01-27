import {
  Component,
  input,
  output,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  Role,
  Permission,
  AssignPermissionsDto,
} from '../interfaces/role.interface';
import { RolesService } from '../services/roles.service';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-role-permissions-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
    InputsearchComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Configurar Permisos"
      [subtitle]="role() ? 'Gestionar permisos del rol: ' + role()?.name : ''"
      size="lg"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <div class="space-y-6">
        <!-- Search and filter permissions -->
        <div
          class="flex flex-col lg:flex-row gap-4 items-start lg:items-center"
        >
          <div class="flex-1 min-w-0">
            <app-inputsearch
              placeholder="Buscar permisos..."
              [debounceTime]="300"
              size="sm"
              (searchChange)="onSearchChange($event)"
            ></app-inputsearch>
          </div>
          <div class="w-full lg:w-48 flex-shrink-0">
            <app-selector
              placeholder="Seleccionar módulo"
              [options]="availableModules"
              [(ngModel)]="selectedModule"
              (valueChange)="onModuleChange($event)"
              size="sm"
              variant="outline"
            ></app-selector>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <app-button
              variant="outline"
              size="sm"
              (clicked)="selectAllPermissions()"
              [disabled]="isLoading"
            >
              Seleccionar todos
            </app-button>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="deselectAllPermissions()"
              [disabled]="isLoading"
            >
              Deseleccionar todos
            </app-button>
          </div>
        </div>

        <!-- Loading state -->
        <div *ngIf="isLoading" class="flex justify-center py-8">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
        </div>

        <!-- Permissions table -->
        <div *ngIf="!isLoading" class="permissions-table-container">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-border">
              <thead class="bg-muted/20">
                <tr>
                  <th class="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      class="permission-checkbox"
                      [checked]="allPermissionsSelected"
                      [indeterminate]="somePermissionsSelected"
                      (change)="toggleAllPermissions($event)"
                    />
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium text-text-primary uppercase tracking-wider"
                  >
                    Nombre
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium text-text-primary uppercase tracking-wider"
                  >
                    Descripción
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium text-text-primary uppercase tracking-wider"
                  >
                    Ruta
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium text-text-primary uppercase tracking-wider"
                  >
                    Método
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium text-text-primary uppercase tracking-wider"
                  >
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody class="bg-surface divide-y divide-border">
                <tr
                  *ngFor="
                    let permission of filteredPermissions;
                    trackBy: trackByPermissionId
                  "
                  class="hover:bg-muted/10 transition-colors"
                >
                  <td class="px-4 py-3">
                    <input
                      type="checkbox"
                      class="permission-checkbox"
                      [checked]="isPermissionSelected(permission.id)"
                      (change)="togglePermission(permission.id, $event)"
                    />
                  </td>
                  <td class="px-4 py-3 text-sm font-medium text-text-primary">
                    {{ permission.name }}
                  </td>
                  <td class="px-4 py-3 text-sm text-text-secondary">
                    {{ permission.description }}
                  </td>
                  <td class="px-4 py-3 text-sm text-text-secondary font-mono">
                    {{ permission.path }}
                  </td>
                  <td class="px-4 py-3">
                    <span
                      class="method-badge method-{{
                        permission.method.toLowerCase()
                      }}"
                    >
                      {{ permission.method }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span class="status-badge status-{{ permission.status }}">
                      {{ getStatusLabel(permission.status) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Empty state -->
          <div
            *ngIf="filteredPermissions.length === 0"
            class="text-center py-8"
          >
            <app-icon
              name="search"
              size="48"
              class="mx-auto text-text-muted mb-4"
            ></app-icon>
            <p class="text-text-secondary">No se encontraron permisos</p>
          </div>
        </div>

        <!-- Selected permissions summary -->
        <div class="selected-summary">
          <p class="text-sm text-text-secondary">
            <span class="font-medium">{{ selectedPermissions.length }}</span>
            de
            <span class="font-medium">{{ filteredPermissions.length }}</span>
            permisos seleccionados
          </p>
        </div>
      </div>

      <div slot="footer" class="modal-footer">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isSubmitting()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSave()"
          [disabled]="isSubmitting() || selectedPermissions.length === 0"
          [loading]="isSubmitting()"
        >
          <span *ngIf="!isSubmitting()">Guardar Cambios</span>
        </app-button>
      </div>
    </app-modal>
  `,
  styleUrls: ['./role-permissions-modal.component.scss'],
})
export class RolePermissionsModalComponent
  implements OnInit, OnChanges, OnDestroy {
  // Signals
  readonly isOpen = input<boolean>(false);
  readonly isSubmitting = input<boolean>(false);
  readonly role = input<Role | null>(null);

  // Outputs
  readonly isOpenChange = output<boolean>();
  readonly submit = output<AssignPermissionsDto>();
  readonly cancel = output<void>();

  permissions: Permission[] = [];
  filteredPermissions: Permission[] = [];
  selectedPermissions: number[] = [];
  isLoading = false;
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();
  private rolesService = inject(RolesService);

  // Module filter
  availableModules: SelectorOption[] = [
    { value: '', label: 'Todos los módulos' },
    { value: 'addresses', label: 'Direcciones' },
    { value: 'audit', label: 'Auditoría' },
    { value: 'auth', label: 'Autenticación' },
    { value: 'brands', label: 'Marcas' },
    { value: 'categories', label: 'Categorías' },
    { value: 'domains', label: 'Dominios' },
    { value: 'orders', label: 'Pedidos' },
    { value: 'organizations', label: 'Organizaciones' },
    { value: 'payments', label: 'Pagos' },
    { value: 'products', label: 'Productos' },
    { value: 'refunds', label: 'Reembolsos' },
    { value: 'roles', label: 'Roles' },
    { value: 'stores', label: 'Tiendas' },
    { value: 'users', label: 'Usuarios' },
  ];
  selectedModule = '';
  searchTerm = '';

  constructor() { }

  ngOnInit(): void {
    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((searchTerm: string) => {
        this.filterPermissions(searchTerm);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      this.onCancel();
    }
    this.isOpenChange.emit(isOpen);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Using current values from signals or change object
    const currentRole = this.role();
    if (changes['isOpen'] && changes['isOpen'].currentValue && currentRole) {
      this.loadPermissions();
    }
  }

  loadPermissions(): void {
    const currentRole = this.role();
    if (!currentRole) return;

    this.isLoading = true;

    // Load all permissions
    this.rolesService.getPermissions().subscribe({
      next: (response) => {
        this.permissions = response.data || [];
        this.filteredPermissions = [...this.permissions];

        // Load role permissions to pre-select them
        this.loadRolePermissions();
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.isLoading = false;
      },
    });
  }

  loadRolePermissions(): void {
    const currentRole = this.role();
    if (!currentRole) return;

    // Get role permissions using the dedicated method
    this.rolesService.getRolePermissions(currentRole.id).subscribe({
      next: (permissionIds) => {
        this.selectedPermissions = permissionIds || [];
        this.isLoading = false;
        // Re-filter to ensure everything is in sync if needed, though usually not strictly necessary for checks
      },
      error: (error) => {
        console.error('Error loading role permissions:', error);
        this.selectedPermissions = [];
        this.isLoading = false;
      },
    });
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onModuleChange(value: string | number | null): void {
    this.selectedModule = value as string;
    this.filterPermissions(this.searchTerm);
  }

  filterPermissions(searchTerm: string): void {
    this.searchTerm = searchTerm;

    let filtered = this.permissions;

    // Apply module filter first
    if (this.selectedModule) {
      filtered = filtered.filter((permission) => {
        // Extract module from path (e.g., /api/auth/login -> auth)
        const pathParts = permission.path.split('/').filter((part) => part);
        const moduleFromPath = pathParts.length > 1 ? pathParts[1] : '';

        return moduleFromPath === this.selectedModule;
      });
    }

    // Apply search filter if exists
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (permission) =>
          permission.name.toLowerCase().includes(term) ||
          permission.description.toLowerCase().includes(term) ||
          permission.path.toLowerCase().includes(term) ||
          permission.method.toLowerCase().includes(term),
      );
    }

    this.filteredPermissions = filtered;
  }

  isPermissionSelected(permissionId: number): boolean {
    return this.selectedPermissions.includes(permissionId);
  }

  togglePermission(permissionId: number, event: any): void {
    if (event.target.checked) {
      if (!this.selectedPermissions.includes(permissionId)) {
        this.selectedPermissions.push(permissionId);
      }
    } else {
      const index = this.selectedPermissions.indexOf(permissionId);
      if (index > -1) {
        this.selectedPermissions.splice(index, 1);
      }
    }
  }

  toggleAllPermissions(event: any): void {
    if (event.target.checked) {
      this.selectedPermissions = this.filteredPermissions.map((p) => p.id);
    } else {
      this.selectedPermissions = [];
    }
  }

  selectAllPermissions(): void {
    this.selectedPermissions = this.filteredPermissions.map((p) => p.id);
  }

  deselectAllPermissions(): void {
    this.selectedPermissions = [];
  }

  get allPermissionsSelected(): boolean {
    return (
      this.filteredPermissions.length > 0 &&
      this.filteredPermissions.every((p) =>
        this.selectedPermissions.includes(p.id),
      )
    );
  }

  get somePermissionsSelected(): boolean {
    return (
      this.filteredPermissions.some((p) =>
        this.selectedPermissions.includes(p.id),
      ) && !this.allPermissionsSelected
    );
  }

  trackByPermissionId(index: number, permission: Permission): number {
    return permission.id;
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'active':
        return 'Activo';
      case 'inactive':
        return 'Inactivo';
      case 'deprecated':
        return 'Obsoleto';
      default:
        return status;
    }
  }

  onSave(): void {
    const currentRole = this.role();
    if (!currentRole) return;

    const permissionData: AssignPermissionsDto = {
      permission_ids: this.selectedPermissions,
    };

    this.submit.emit(permissionData);
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
