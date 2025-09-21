import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { RoleService, Role, Permission } from '../../../../core/services/role.service';

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div class="p-6 max-w-7xl mx-auto">
      <!-- Header -->
      <div class="mb-8">
        <div class="flex justify-between items-center">
          <div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">Gestión de Permisos</h1>
            <p class="text-gray-600" *ngIf="selectedRole">
              Administrando permisos para el rol: <span class="font-semibold text-primary">{{ selectedRole.name }}</span>
            </p>
          </div>
          <button
            (click)="goBack()"
            class="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-all duration-300"
          >
            ← Volver
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="flex items-center justify-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <span class="ml-3 text-gray-500">Cargando...</span>
      </div>

      <!-- Role not found -->
      <div *ngIf="!loading && !selectedRole" class="text-center py-12">
        <div class="flex flex-col items-center">
          <svg class="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>
          </svg>
          <h3 class="text-xl font-medium text-gray-900 mb-2">Rol no encontrado</h3>
          <p class="text-gray-500 mb-4">El rol especificado no existe o no tienes permisos para acceder.</p>
          <button
            (click)="goBack()"
            class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
          >
            Volver a Roles
          </button>
        </div>
      </div>

      <!-- Permissions Management -->
      <div *ngIf="!loading && selectedRole" class="space-y-6">
        <!-- Available Permissions -->
        <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
          <h3 class="text-xl font-semibold text-gray-900 mb-4">Permisos Disponibles</h3>
          <p class="text-gray-600 mb-6">Selecciona los permisos que deseas asignar al rol "{{ selectedRole.name }}"</p>

          <!-- Search -->
          <div class="mb-6">
            <input
              type="text"
              placeholder="Buscar permisos..."
              [formControl]="searchCtrl"
              class="w-full px-4 py-3 pl-10 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300"
            />
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </div>
          </div>

          <!-- Permissions List -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              *ngFor="let permission of filteredPermissions"
              class="relative"
            >
              <label class="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="isPermissionAssigned(permission.id)"
                  (change)="togglePermission(permission.id, $event)"
                  class="mt-1 h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-gray-900">{{ permission.name }}</div>
                  <div class="text-sm text-gray-500" *ngIf="permission.description">{{ permission.description }}</div>
                  <div class="flex items-center space-x-2 mt-1">
                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {{ permission.resource }}
                    </span>
                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                      {{ permission.action }}
                    </span>
                  </div>
                </div>
              </label>
            </div>
          </div>

          <!-- No permissions found -->
          <div *ngIf="filteredPermissions.length === 0" class="text-center py-8">
            <svg class="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <h3 class="text-lg font-medium text-gray-900 mb-1">No hay permisos</h3>
            <p class="text-gray-500">No se encontraron permisos que coincidan con tu búsqueda.</p>
          </div>
        </div>

        <!-- Assigned Permissions Summary -->
        <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6">
          <h3 class="text-xl font-semibold text-gray-900 mb-4">Permisos Asignados</h3>
          <div class="flex flex-wrap gap-2">
            <span
              *ngFor="let permission of selectedRole.role_permissions"
              class="inline-flex items-center px-3 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium"
            >
              {{ permission.permissions.name }}
              <button
                (click)="removePermission(permission.permissions.id)"
                class="ml-2 text-primary hover:text-red-600 transition-colors"
                title="Remover permiso"
              >
                ×
              </button>
            </span>
          </div>
          <p *ngIf="!selectedRole.role_permissions || selectedRole.role_permissions.length === 0" class="text-gray-500 italic">
            No hay permisos asignados a este rol
          </p>
        </div>

        <!-- Actions -->
        <div class="flex justify-end space-x-4">
          <button
            (click)="goBack()"
            class="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
          >
            Cancelar
          </button>
          <button
            (click)="saveChanges()"
            [disabled]="saving"
            class="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span *ngIf="saving" class="animate-spin">⏳</span>
            <span *ngIf="!saving">Guardar Cambios</span>
          </button>
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
export class PermissionsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Data
  selectedRole: Role | null = null;
  allPermissions: Permission[] = [];
  filteredPermissions: Permission[] = [];
  loading = false;
  saving = false;

  // Forms
  searchCtrl: any;

  // Track changes
  permissionsToAdd: number[] = [];
  permissionsToRemove: number[] = [];

  constructor(
    private roleService: RoleService,
    private route: ActivatedRoute,
    private fb: FormBuilder
  ) {
    this.searchCtrl = this.fb.control('');
  }

  ngOnInit(): void {
    const roleId = this.route.snapshot.params['id'];
    if (roleId) {
      this.loadRole(+roleId);
      this.loadPermissions();
    }

    // Setup search
    this.searchCtrl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((search: string | null) => {
        this.filterPermissions(search || '');
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load data
  loadRole(roleId: number): void {
    this.loading = true;
    this.roleService.getRole(roleId).subscribe({
      next: (role) => {
        this.selectedRole = role;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading role:', error);
        this.loading = false;
      }
    });
  }

  loadPermissions(): void {
    this.roleService.getPermissions().subscribe({
      next: (response) => {
        this.allPermissions = response.data;
        this.filteredPermissions = [...this.allPermissions];
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
      }
    });
  }

  // Permission management
  isPermissionAssigned(permissionId: number): boolean {
    if (!this.selectedRole?.role_permissions) return false;
    return this.selectedRole.role_permissions.some(rp => rp.permissions.id === permissionId);
  }

  togglePermission(permissionId: number, event: any): void {
    const isChecked = event.target.checked;

    if (isChecked) {
      // Add to permissions to add, remove from permissions to remove
      if (!this.permissionsToAdd.includes(permissionId)) {
        this.permissionsToAdd.push(permissionId);
      }
      this.permissionsToRemove = this.permissionsToRemove.filter(id => id !== permissionId);
    } else {
      // Add to permissions to remove, remove from permissions to add
      if (!this.permissionsToRemove.includes(permissionId)) {
        this.permissionsToRemove.push(permissionId);
      }
      this.permissionsToAdd = this.permissionsToAdd.filter(id => id !== permissionId);
    }
  }

  removePermission(permissionId: number): void {
    if (!this.permissionsToRemove.includes(permissionId)) {
      this.permissionsToRemove.push(permissionId);
    }
    this.permissionsToAdd = this.permissionsToAdd.filter(id => id !== permissionId);
  }

  saveChanges(): void {
    if (!this.selectedRole) return;

    this.saving = true;

    // Add permissions
    if (this.permissionsToAdd.length > 0) {
      this.roleService.assignPermissionsToRole(this.selectedRole.id, { permissionIds: this.permissionsToAdd }).subscribe({
        next: () => {
          this.permissionsToAdd = [];
          this.checkSaveComplete();
        },
        error: (error) => {
          console.error('Error assigning permissions:', error);
          this.saving = false;
        }
      });
    }

    // Remove permissions
    if (this.permissionsToRemove.length > 0) {
      this.roleService.removePermissionsFromRole(this.selectedRole.id, { permissionIds: this.permissionsToRemove }).subscribe({
        next: () => {
          this.permissionsToRemove = [];
          this.checkSaveComplete();
        },
        error: (error) => {
          console.error('Error removing permissions:', error);
          this.saving = false;
        }
      });
    }

    // If no changes, just reload
    if (this.permissionsToAdd.length === 0 && this.permissionsToRemove.length === 0) {
      this.reloadRole();
    }
  }

  private checkSaveComplete(): void {
    if (this.permissionsToAdd.length === 0 && this.permissionsToRemove.length === 0) {
      this.saving = false;
      this.reloadRole();
    }
  }

  private reloadRole(): void {
    if (this.selectedRole) {
      this.loadRole(this.selectedRole.id);
    }
  }

  // Search and filter
  filterPermissions(search: string): void {
    if (!search.trim()) {
      this.filteredPermissions = [...this.allPermissions];
    } else {
      const searchLower = search.toLowerCase();
      this.filteredPermissions = this.allPermissions.filter(permission =>
        permission.name.toLowerCase().includes(searchLower) ||
        permission.description?.toLowerCase().includes(searchLower) ||
        permission.resource.toLowerCase().includes(searchLower) ||
        permission.action.toLowerCase().includes(searchLower)
      );
    }
  }

  // Navigation
  goBack(): void {
    window.history.back();
  }
}