import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import {
  Role,
  Permission,
  PermissionQueryDto,
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
      [isOpen]="isOpen"
      (openChange)="onOpenChange($event)"
      title="Configurar Permisos"
      [subtitle]="role ? 'Gestionar permisos del rol: ' + role.name : ''"
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
          [disabled]="isSubmitting"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSave()"
          [disabled]="isSubmitting || selectedPermissions.length === 0"
          [loading]="isSubmitting"
        >
          <span *ngIf="!isSubmitting">Guardar Cambios</span>
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .permissions-table-container {
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid var(--color-border);
        border-radius: 8px;
      }

      .permission-checkbox {
        @apply h-4 w-4 text-primary border-border rounded focus:ring-primary;
      }

      .method-badge {
        @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium;
      }

      .method-get {
        @apply bg-green-100 text-green-800;
      }

      .method-post {
        @apply bg-blue-100 text-blue-800;
      }

      .method-put {
        @apply bg-yellow-100 text-yellow-800;
      }

      .method-patch {
        @apply bg-orange-100 text-orange-800;
      }

      .method-delete {
        @apply bg-red-100 text-red-800;
      }

      .method-options {
        @apply bg-purple-100 text-purple-800;
      }

      .method-head {
        @apply bg-gray-100 text-gray-800;
      }

      .status-badge {
        @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium;
      }

      .status-active {
        @apply bg-green-100 text-green-800;
      }

      .status-inactive {
        @apply bg-gray-100 text-gray-800;
      }

      .status-deprecated {
        @apply bg-red-100 text-red-800;
      }

      .selected-summary {
        @apply p-4 bg-muted/10 rounded-md border border-border;
      }

      .modal-footer {
        @apply flex justify-end gap-3;
      }

      .btn {
        @apply inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
      }

      .btn-primary {
        background-color: var(--color-primary);
        color: var(--color-text-on-primary);
        border: 1px solid var(--color-primary);

        &:hover:not(:disabled) {
          background-color: var(--color-secondary);
          border-color: var(--color-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }

        &:focus {
          focus-ring-color: rgba(var(--color-primary), 0.5);
        }

        &:disabled {
          @apply opacity-50 cursor-not-allowed;
          transform: none;
        }
      }

      .btn-secondary {
        background-color: var(--color-surface);
        color: var(--color-text-primary);
        border: var(--border-width) solid var(--color-border);

        &:hover:not(:disabled) {
          background-color: var(--color-background);
          border-color: var(--color-text-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }

        &:focus {
          focus-ring-color: rgba(var(--color-muted), 0.5);
        }

        &:disabled {
          @apply opacity-50 cursor-not-allowed;
          transform: none;
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .animate-spin {
        animation: spin 1s linear infinite;
      }

      /* Indeterminate checkbox styling */
      input[type='checkbox']:indeterminate {
        background-color: var(--color-primary);
        border-color: var(--color-primary);
      }

      input[type='checkbox']:indeterminate::after {
        content: '';
        display: block;
        width: 4px;
        height: 4px;
        background-color: white;
        margin: 6px auto;
      }
    `,
  ],
})
export class RolePermissionsModalComponent
  implements OnInit, OnChanges, OnDestroy
{
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() role: Role | null = null;
  @Output() openChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<AssignPermissionsDto>();
  @Output() cancel = new EventEmitter<void>();

  permissions: Permission[] = [];
  filteredPermissions: Permission[] = [];
  selectedPermissions: number[] = [];
  isLoading = false;
  searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

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

  constructor(private rolesService: RolesService) {}

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

  onOpenChange(isOpen: any): void {
    if (!isOpen) {
      this.onCancel();
    }
    this.openChange.emit(isOpen);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue && this.role) {
      this.loadPermissions();
    }
  }

  loadPermissions(): void {
    if (!this.role) return;

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
    if (!this.role) return;

    // Get role permissions using the dedicated method
    this.rolesService.getRolePermissions(this.role.id).subscribe({
      next: (permissionIds) => {
        this.selectedPermissions = permissionIds || [];
        this.isLoading = false;
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
    if (!this.role) return;

    const permissionData: AssignPermissionsDto = {
      permissionIds: this.selectedPermissions,
    };

    this.submit.emit(permissionData);
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
