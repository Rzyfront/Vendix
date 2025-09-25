import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { RoleService, Role } from '../../../../core/services/role.service';
import { PermissionService, Permission, CreatePermissionDto, UpdatePermissionDto } from '../../../../core/services/permission.service';
import { IconComponent } from '../../../../shared/components';

@Component({
  selector: 'app-permissions-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
        <div class="flex justify-between items-center">
          <div>
            <h2 class="text-2xl font-bold text-gray-900 mb-2">Gestión de Permisos</h2>
            <p class="text-gray-600">Administra todos los permisos del sistema y asígnalos a roles</p>
          </div>
          <button
            (click)="openCreatePermissionModal()"
            class="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
          >
            <span class="flex items-center space-x-2">
              <app-icon name="plus" [size]="16"></app-icon>
              <span>Nuevo Permiso</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Permissions Overview -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Total Permissions -->
        <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
          <div class="flex items-center">
            <div class="p-3 rounded-full bg-blue-100">
              <app-icon name="shield-check" class="text-blue-600" [size]="24"></app-icon>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Total Permisos</p>
              <p class="text-2xl font-bold text-gray-900">{{ allPermissions.length }}</p>
            </div>
          </div>
        </div>

        <!-- Active Roles -->
        <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
          <div class="flex items-center">
            <div class="p-3 rounded-full bg-green-100">
              <app-icon name="user-shield" class="text-green-600" [size]="24"></app-icon>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Roles Activos</p>
              <p class="text-2xl font-bold text-gray-900">{{ roles.length }}</p>
            </div>
          </div>
        </div>

        <!-- Permission Categories -->
        <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
          <div class="flex items-center">
            <div class="p-3 rounded-full bg-purple-100">
              <app-icon name="folder" class="text-purple-600" [size]="24"></app-icon>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Categorías</p>
              <p class="text-2xl font-bold text-gray-900">{{ getUniqueResources().length }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Permissions List -->
        <div class="lg:col-span-2 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-xl font-semibold text-gray-900">Lista de Permisos</h3>
            
            <!-- Search and Filter -->
            <div class="flex space-x-3">
              <input
                type="text"
                placeholder="Buscar permisos..."
                [formControl]="searchCtrl"
                class="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
              <select
                [formControl]="resourceFilterCtrl"
                class="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">Todas las categorías</option>
                <option *ngFor="let resource of getUniqueResources()" [value]="resource">
                  {{ resource | titlecase }}
                </option>
              </select>
            </div>
          </div>

          <!-- Loading State -->
          <div *ngIf="loading" class="flex items-center justify-center py-12">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <span class="ml-3 text-gray-500">Cargando permisos...</span>
          </div>

          <!-- Permissions Grid -->
          <div *ngIf="!loading" class="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
            <div
              *ngFor="let permission of filteredPermissions"
              class="p-4 border border-gray-200 rounded-lg hover:border-primary transition-colors cursor-pointer"
              [class.border-primary]="selectedPermission?.id === permission.id"
              (click)="selectPermission(permission)"
            >
              <div class="flex justify-between items-start">
                <div class="flex-1">
                  <h4 class="font-medium text-gray-900">{{ permission.name }}</h4>
                  <p class="text-sm text-gray-600 mt-1" *ngIf="permission.description">
                    {{ permission.description }}
                  </p>
                  <div class="flex items-center space-x-2 mt-2">
                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {{ permission.resource }}
                    </span>
                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                      {{ permission.action }}
                    </span>
                  </div>
                </div>
                <button
                  (click)="editPermission(permission); $event.stopPropagation()"
                  class="text-gray-400 hover:text-primary transition-colors"
                  title="Editar permiso"
                >
                  <app-icon name="edit" [size]="16"></app-icon>
                </button>
              </div>
            </div>
          </div>

          <!-- No permissions found -->
          <div *ngIf="!loading && filteredPermissions.length === 0" class="text-center py-8">
            <app-icon name="search" class="text-gray-400 mx-auto mb-4" [size]="48"></app-icon>
            <h3 class="text-lg font-medium text-gray-900 mb-1">No se encontraron permisos</h3>
            <p class="text-gray-500">No hay permisos que coincidan con tu búsqueda.</p>
          </div>
        </div>

        <!-- Role Assignment Panel -->
        <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
          <h3 class="text-xl font-semibold text-gray-900 mb-6">Asignación de Roles</h3>
          
          <!-- Selected Permission Info -->
          <div *ngIf="selectedPermission" class="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 class="font-medium text-gray-900 mb-2">{{ selectedPermission.name }}</h4>
            <p class="text-sm text-gray-600" *ngIf="selectedPermission.description">
              {{ selectedPermission.description }}
            </p>
            <div class="flex items-center space-x-2 mt-2">
              <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                {{ selectedPermission.resource }}
              </span>
              <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                {{ selectedPermission.action }}
              </span>
            </div>
          </div>

          <!-- Role Selection -->
          <div *ngIf="selectedPermission" class="space-y-4">
            <h5 class="font-medium text-gray-900">Roles con este permiso:</h5>
            
            <!-- Roles with permission -->
            <div class="space-y-2 max-h-48 overflow-y-auto">
              <div
                *ngFor="let role of getRolesWithPermission(selectedPermission.id)"
                class="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg"
              >
                <div>
                  <span class="font-medium text-green-800">{{ role.name }}</span>
                  <p class="text-sm text-green-600" *ngIf="role.description">{{ role.description }}</p>
                </div>
                <button
                  (click)="removePermissionFromRole(role.id, selectedPermission!.id)"
                  class="text-red-600 hover:text-red-800 transition-colors"
                  title="Remover permiso"
                >
                  <app-icon name="x" [size]="16"></app-icon>
                </button>
              </div>
            </div>

            <!-- Available roles -->
            <div class="mt-6">
              <h5 class="font-medium text-gray-900 mb-3">Asignar a rol:</h5>
              <div class="space-y-2">
                <div
                  *ngFor="let role of getRolesWithoutPermission(selectedPermission.id)"
                  class="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div>
                    <span class="font-medium text-gray-800">{{ role.name }}</span>
                    <p class="text-sm text-gray-600" *ngIf="role.description">{{ role.description }}</p>
                  </div>
                  <button
                    (click)="assignPermissionToRole(role.id, selectedPermission!.id)"
                    class="text-primary hover:text-secondary transition-colors"
                    title="Asignar permiso"
                  >
                    <app-icon name="plus" [size]="16"></app-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- No permission selected -->
          <div *ngIf="!selectedPermission" class="text-center py-8">
            <app-icon name="cursor-click" class="text-gray-400 mx-auto mb-4" [size]="48"></app-icon>
            <h4 class="font-medium text-gray-900 mb-2">Selecciona un permiso</h4>
            <p class="text-sm text-gray-500">Haz clic en un permiso para gestionar sus asignaciones de roles</p>
          </div>
        </div>
      </div>

      <!-- Create/Edit Permission Modal -->
      <div *ngIf="showPermissionModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
          <div class="p-6">
            <div class="flex justify-between items-center mb-6">
              <h3 class="text-xl font-bold text-gray-900">
                {{ isEditingPermission ? 'Editar Permiso' : 'Crear Nuevo Permiso' }}
              </h3>
              <button
                (click)="closePermissionModal()"
                class="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <app-icon name="x" [size]="20"></app-icon>
              </button>
            </div>

            <form [formGroup]="permissionForm" (ngSubmit)="savePermission()" class="space-y-4">
              <!-- Name -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Nombre *</label>
                <input
                  type="text"
                  formControlName="name"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Ej: users:create"
                />
                <div *ngIf="permissionForm.get('name')?.invalid && permissionForm.get('name')?.touched" class="mt-1 text-sm text-red-600">
                  El nombre es requerido
                </div>
              </div>

              <!-- Description -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
                <textarea
                  formControlName="description"
                  rows="3"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Descripción del permiso..."
                ></textarea>
              </div>

              <!-- Resource -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Recurso *</label>
                <input
                  type="text"
                  formControlName="resource"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Ej: users, products, orders"
                />
                <div *ngIf="permissionForm.get('resource')?.invalid && permissionForm.get('resource')?.touched" class="mt-1 text-sm text-red-600">
                  El recurso es requerido
                </div>
              </div>

              <!-- Action -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Acción *</label>
                <select
                  formControlName="action"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                >
                  <option value="">Seleccionar acción</option>
                  <option value="create">Create (Crear)</option>
                  <option value="read">Read (Leer)</option>
                  <option value="update">Update (Actualizar)</option>
                  <option value="delete">Delete (Eliminar)</option>
                  <option value="manage">Manage (Gestionar)</option>
                </select>
                <div *ngIf="permissionForm.get('action')?.invalid && permissionForm.get('action')?.touched" class="mt-1 text-sm text-red-600">
                  La acción es requerida
                </div>
              </div>

              <!-- Actions -->
              <div class="flex space-x-3 pt-4">
                <button
                  type="button"
                  (click)="closePermissionModal()"
                  class="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  [disabled]="permissionForm.invalid || modalLoading"
                  class="flex-1 px-4 py-2 bg-gradient-to-r from-primary to-secondary text-white rounded-lg hover:shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span *ngIf="modalLoading" class="animate-spin">⏳</span>
                  <span *ngIf="!modalLoading">{{ isEditingPermission ? 'Actualizar' : 'Crear' }}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .animate-pulse {
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: .5;
      }
    }
  `]
})
export class PermissionsManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Data
  allPermissions: Permission[] = [];
  filteredPermissions: Permission[] = [];
  roles: Role[] = [];
  selectedPermission: Permission | null = null;
  loading = false;
  modalLoading = false;

  // Forms
  searchCtrl: any;
  resourceFilterCtrl: any;
  permissionForm: FormGroup;

  // Modal states
  showPermissionModal = false;
  isEditingPermission = false;

  constructor(
    private roleService: RoleService,
    private permissionService: PermissionService,
    private fb: FormBuilder
  ) {
    this.searchCtrl = this.fb.control('');
    this.resourceFilterCtrl = this.fb.control('');
    this.permissionForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      resource: ['', Validators.required],
      action: ['', Validators.required]
    });
  }

  ngOnInit(): void {
    this.loadPermissions();
    this.loadRoles();
    this.setupFilters();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Data loading
  loadPermissions(): void {
    this.loading = true;
    this.permissionService.getPermissions().subscribe({
      next: (response) => {
        this.allPermissions = response.data;
        this.filteredPermissions = [...this.allPermissions];
        this.loading = false;
      },
      error: (error: any) => {
        console.error('Error loading permissions:', error);
        this.loading = false;
      }
    });
  }

  loadRoles(): void {
    this.roleService.getRoles().subscribe({
      next: (response) => {
        this.roles = response.data;
      },
      error: (error) => {
        console.error('Error loading roles:', error);
      }
    });
  }

  // Filtering
  setupFilters(): void {
    this.searchCtrl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.applyFilters());

    this.resourceFilterCtrl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.applyFilters());
  }

  applyFilters(): void {
    let filtered = [...this.allPermissions];

    // Search filter
    const search = this.searchCtrl.value?.toLowerCase() || '';
    if (search) {
      filtered = filtered.filter(permission =>
        permission.name.toLowerCase().includes(search) ||
        permission.description?.toLowerCase().includes(search) ||
        permission.resource.toLowerCase().includes(search) ||
        permission.action.toLowerCase().includes(search)
      );
    }

    // Resource filter
    const resource = this.resourceFilterCtrl.value;
    if (resource) {
      filtered = filtered.filter(permission => permission.resource === resource);
    }

    this.filteredPermissions = filtered;
  }

  // Permission selection
  selectPermission(permission: Permission): void {
    this.selectedPermission = permission;
  }

  // Helper methods
  getUniqueResources(): string[] {
    const resources = this.allPermissions.map(p => p.resource);
    return [...new Set(resources)].sort();
  }

  getRolesWithPermission(permissionId: number): Role[] {
    return this.roles.filter(role =>
      role.role_permissions.some(rp => rp.permissions.id === permissionId)
    );
  }

  getRolesWithoutPermission(permissionId: number): Role[] {
    return this.roles.filter(role =>
      !role.role_permissions.some(rp => rp.permissions.id === permissionId)
    );
  }

  // Role-Permission assignment
  assignPermissionToRole(roleId: number, permissionId: number): void {
    this.roleService.assignPermissionsToRole(roleId, { permissionIds: [permissionId] }).subscribe({
      next: () => {
        this.loadRoles(); // Refresh roles to update permissions
      },
      error: (error) => {
        console.error('Error assigning permission to role:', error);
      }
    });
  }

  removePermissionFromRole(roleId: number, permissionId: number): void {
    this.roleService.removePermissionsFromRole(roleId, { permissionIds: [permissionId] }).subscribe({
      next: () => {
        this.loadRoles(); // Refresh roles to update permissions
      },
      error: (error) => {
        console.error('Error removing permission from role:', error);
      }
    });
  }

  // Permission CRUD (Note: These would need backend endpoints)
  openCreatePermissionModal(): void {
    this.isEditingPermission = false;
    this.permissionForm.reset();
    this.showPermissionModal = true;
  }

  editPermission(permission: Permission): void {
    this.isEditingPermission = true;
    this.selectedPermission = permission;
    this.permissionForm.patchValue({
      name: permission.name,
      description: permission.description,
      resource: permission.resource,
      action: permission.action
    });
    this.showPermissionModal = true;
  }

  savePermission(): void {
    if (this.permissionForm.invalid) {
      Object.keys(this.permissionForm.controls).forEach(key => {
        this.permissionForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.modalLoading = true;
    const formData = this.permissionForm.value;

    if (this.isEditingPermission && this.selectedPermission) {
      // Update permission
      const updateData: UpdatePermissionDto = {
        name: formData.name,
        description: formData.description,
        resource: formData.resource,
        action: formData.action
      };

      this.permissionService.updatePermission(this.selectedPermission.id, updateData).subscribe({
        next: () => {
          this.loadPermissions();
          this.closePermissionModal();
        },
        error: (error: any) => {
          console.error('Error updating permission:', error);
          this.modalLoading = false;
        }
      });
    } else {
      // Create permission
      const createData: CreatePermissionDto = {
        name: formData.name,
        description: formData.description,
        resource: formData.resource,
        action: formData.action
      };

      this.permissionService.createPermission(createData).subscribe({
        next: () => {
          this.loadPermissions();
          this.closePermissionModal();
        },
        error: (error: any) => {
          console.error('Error creating permission:', error);
          this.modalLoading = false;
        }
      });
    }
  }

  closePermissionModal(): void {
    this.showPermissionModal = false;
    this.isEditingPermission = false;
    this.modalLoading = false;
  }
}