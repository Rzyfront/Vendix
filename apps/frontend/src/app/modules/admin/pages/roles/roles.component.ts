import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { RoleService, Role, CreateRoleDto, UpdateRoleDto } from '../../../../core/services/role.service';

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div class="p-6 max-w-7xl mx-auto">
      <!-- Header -->
      <div class="mb-8">
        <div class="flex justify-between items-center">
          <div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">Gestión de Roles</h1>
            <p class="text-gray-600">Administra los roles del sistema</p>
          </div>
          <button
            (click)="openCreateModal()"
            class="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
          >
            <span class="flex items-center space-x-2">
              <span>+</span>
              <span>Nuevo Rol</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Roles Table -->
      <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-gray-50/80">
              <tr>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Nombre</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Descripción</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Tipo</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Permisos</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr *ngIf="loading" class="animate-pulse">
                <td colspan="5" class="px-6 py-12 text-center">
                  <div class="flex items-center justify-center space-x-2">
                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    <span class="text-gray-500">Cargando roles...</span>
                  </div>
                </td>
              </tr>
              <tr *ngIf="!loading && roles.length === 0" class="text-center">
                <td colspan="5" class="px-6 py-12">
                  <div class="flex flex-col items-center">
                    <svg class="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <h3 class="text-lg font-medium text-gray-900 mb-1">No hay roles</h3>
                    <p class="text-gray-500">No se encontraron roles en el sistema.</p>
                  </div>
                </td>
              </tr>
              <tr *ngFor="let role of roles" class="hover:bg-gray-50/50 transition-colors duration-200">
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-medium text-gray-900">{{ role.name }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm text-gray-900">{{ role.description || 'Sin descripción' }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span
                    class="inline-flex px-2 py-1 text-xs font-semibold rounded-full"
                    [ngClass]="role.is_system_role ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'"
                  >
                    {{ role.is_system_role ? 'Sistema' : 'Personalizado' }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {{ role.role_permissions.length || 0 }} permisos
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div class="flex items-center space-x-2">
                    <button
                      (click)="viewRole(role)"
                      class="text-primary hover:text-secondary transition-colors duration-200"
                      title="Ver detalles"
                    >
                      👁️
                    </button>
                    <button
                      (click)="editRole(role)"
                      class="text-blue-600 hover:text-blue-900 transition-colors duration-200"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      (click)="managePermissions(role)"
                      class="text-purple-600 hover:text-purple-900 transition-colors duration-200"
                      title="Gestionar permisos"
                    >
                      🔐
                    </button>
                    <button
                      *ngIf="!role.is_system_role"
                      (click)="deleteRole(role)"
                      class="text-red-600 hover:text-red-900 transition-colors duration-200"
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create/Edit Role Modal -->
      <div *ngIf="showModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
          <div class="p-6">
            <div class="flex justify-between items-center mb-6">
              <h3 class="text-xl font-bold text-gray-900">
                {{ isEditing ? 'Editar Rol' : 'Crear Nuevo Rol' }}
              </h3>
              <button
                (click)="closeModal()"
                class="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            <form [formGroup]="roleForm" (ngSubmit)="saveRole()" class="space-y-4">
              <!-- Name -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Nombre *</label>
                <input
                  type="text"
                  formControlName="name"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Ej: Administrador"
                />
                <div *ngIf="roleForm.get('name')?.invalid && roleForm.get('name')?.touched" class="mt-1 text-sm text-red-600">
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
                  placeholder="Descripción del rol..."
                ></textarea>
              </div>

              <!-- System Role (only for create) -->
              <div *ngIf="!isEditing">
                <label class="flex items-center">
                  <input
                    type="checkbox"
                    formControlName="is_system_role"
                    class="rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span class="ml-2 text-sm text-gray-700">Rol del sistema</span>
                </label>
                <p class="text-xs text-gray-500 mt-1">Los roles del sistema no pueden ser eliminados</p>
              </div>

              <!-- Actions -->
              <div class="flex space-x-3 pt-4">
                <button
                  type="button"
                  (click)="closeModal()"
                  class="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  [disabled]="roleForm.invalid || modalLoading"
                  class="flex-1 px-4 py-2 bg-gradient-to-r from-primary to-secondary text-white rounded-lg hover:shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span *ngIf="modalLoading" class="animate-spin">⏳</span>
                  <span *ngIf="!modalLoading">{{ isEditing ? 'Actualizar' : 'Crear' }}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- View Role Modal -->
      <div *ngIf="showViewModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div class="p-6" *ngIf="selectedRole">
            <div class="flex justify-between items-center mb-6">
              <h3 class="text-xl font-bold text-gray-900">Detalles del Rol</h3>
              <button
                (click)="closeViewModal()"
                class="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            <div class="space-y-6">
              <!-- Role Header -->
              <div class="flex items-center space-x-4">
                <div class="h-16 w-16 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center">
                  <span class="text-white font-bold text-xl">
                    {{ getRoleInitials(selectedRole.name) }}
                  </span>
                </div>
                <div>
                  <h4 class="text-lg font-semibold text-gray-900">
                    {{ selectedRole.name }}
                  </h4>
                  <p class="text-gray-600">{{ selectedRole.description || 'Sin descripción' }}</p>
                  <span
                    class="inline-flex px-2 py-1 text-xs font-semibold rounded-full mt-1"
                    [ngClass]="selectedRole.is_system_role ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'"
                  >
                    {{ selectedRole.is_system_role ? 'Sistema' : 'Personalizado' }}
                  </span>
                </div>
              </div>

              <!-- Permissions -->
              <div>
                <h5 class="font-semibold text-gray-900 mb-3">Permisos Asignados</h5>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2" *ngIf="selectedRole.role_permissions && selectedRole.role_permissions.length > 0">
                  <span
                    *ngFor="let permission of selectedRole.role_permissions"
                    class="px-3 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium"
                  >
                    {{ permission.permissions.name }}
                  </span>
                </div>
                <p *ngIf="!selectedRole.role_permissions || selectedRole.role_permissions.length === 0" class="text-gray-500">
                  No hay permisos asignados
                </p>
              </div>

              <!-- Dates -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <span class="font-medium">Creado:</span>
                  <div class="text-gray-600">{{ formatDate(selectedRole.created_at) }}</div>
                </div>
                <div>
                  <span class="font-medium">Actualizado:</span>
                  <div class="text-gray-600">{{ formatDate(selectedRole.updated_at) }}</div>
                </div>
              </div>
            </div>

            <div class="flex justify-end space-x-3 mt-6">
              <button
                (click)="editRole(selectedRole)"
                class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Editar
              </button>
              <button
                (click)="closeViewModal()"
                class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Cerrar
              </button>
            </div>
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
export class RolesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Data
  roles: Role[] = [];
  loading = false;

  // Forms
  roleForm: FormGroup;

  // Modal states
  showModal = false;
  showViewModal = false;
  isEditing = false;
  modalLoading = false;
  selectedRole: Role | null = null;

  constructor(
    private roleService: RoleService,
    private fb: FormBuilder
  ) {
    this.roleForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      is_system_role: [false]
    });
  }

  ngOnInit(): void {
    this.loadRoles();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load roles
  loadRoles(): void {
    this.loading = true;
    this.roleService.getRoles().subscribe({
      next: (response) => {
        this.roles = response.data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading roles:', error);
        this.loading = false;
      }
    });
  }

  // Modal operations
  openCreateModal(): void {
    this.isEditing = false;
    this.roleForm.reset({
      name: '',
      description: '',
      is_system_role: false
    });
    this.showModal = true;
  }

  editRole(role: Role): void {
    this.isEditing = true;
    this.selectedRole = role;
    this.roleForm.patchValue({
      name: role.name,
      description: role.description,
      is_system_role: role.is_system_role
    });
    this.showModal = true;
    this.showViewModal = false;
  }

  viewRole(role: Role): void {
    this.selectedRole = role;
    this.showViewModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.isEditing = false;
    this.selectedRole = null;
    this.modalLoading = false;
  }

  closeViewModal(): void {
    this.showViewModal = false;
    this.selectedRole = null;
  }

  // CRUD operations
  saveRole(): void {
    if (this.roleForm.invalid) {
      Object.keys(this.roleForm.controls).forEach(key => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.modalLoading = true;
    const formData = this.roleForm.value;

    if (this.isEditing && this.selectedRole) {
      // Update role
      const updateData: UpdateRoleDto = {
        name: formData.name,
        description: formData.description
      };

      this.roleService.updateRole(this.selectedRole.id, updateData).subscribe({
        next: () => {
          this.loadRoles();
          this.closeModal();
        },
        error: (error) => {
          console.error('Error updating role:', error);
          this.modalLoading = false;
        }
      });
    } else {
      // Create role
      const createData: CreateRoleDto = {
        name: formData.name,
        description: formData.description,
        is_system_role: formData.is_system_role
      };

      this.roleService.createRole(createData).subscribe({
        next: () => {
          this.loadRoles();
          this.closeModal();
        },
        error: (error) => {
          console.error('Error creating role:', error);
          this.modalLoading = false;
        }
      });
    }
  }

  deleteRole(role: Role): void {
    if (confirm(`¿Estás seguro de que quieres eliminar el rol "${role.name}"?`)) {
      this.roleService.deleteRole(role.id).subscribe({
        next: () => this.loadRoles(),
        error: (error) => console.error('Error deleting role:', error)
      });
    }
  }

  managePermissions(role: Role): void {
    // Navigate to permissions management for this role
    window.location.href = `/admin/settings/roles/${role.id}/permissions`;
  }

  // Helper methods
  getRoleInitials(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}