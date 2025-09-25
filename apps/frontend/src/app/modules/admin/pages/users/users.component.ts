import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormControl } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { UserService, User, CreateUserDto, UpdateUserDto } from '../../../../core/services/user.service';
import { RoleService, Role } from '../../../../core/services/role.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';

interface UserFilters {
  search: string;
  state: string;
  page: number;
  limit: number;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, FormsModule],
  template: `
    <div class="p-6 max-w-7xl mx-auto">
      <!-- Header -->
      <div class="mb-8">
        <div class="flex justify-between items-center">
          <div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">Gestión de Usuarios</h1>
            <p class="text-gray-600">Administra todos los usuarios del sistema</p>
          </div>
          <button
            (click)="openCreateModal()"
            class="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
          >
            <span class="flex items-center space-x-2">
              <span>+</span>
              <span>Nuevo Usuario</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Filters and Search -->
      <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-6 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <!-- Search -->
          <div class="relative">
            <input
              type="text"
              placeholder="Buscar usuarios..."
              [formControl]="searchCtrl"
              class="w-full px-4 py-3 pl-10 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300"
            />
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </div>
          </div>

          <!-- State Filter -->
          <div>
            <select
              [formControl]="stateCtrl"
              class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300"
            >
              <option value="">Todos los estados</option>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
              <option value="suspended">Suspendido</option>
              <option value="archived">Archivado</option>
            </select>
          </div>

          <!-- Page Size -->
          <div>
            <select
              [formControl]="limitCtrl"
              class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300"
            >
              <option [ngValue]="10">10 por página</option>
              <option [ngValue]="25">25 por página</option>
              <option [ngValue]="50">50 por página</option>
              <option [ngValue]="100">100 por página</option>
            </select>
          </div>

          <!-- Clear Filters -->
          <div class="flex items-center">
            <button
              (click)="clearFilters()"
              class="w-full px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors duration-300"
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      <!-- Users Table -->
      <div class="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-gray-50/80">
              <tr>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Usuario</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Estado</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Rol</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Último Login</th>
                <th class="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr *ngIf="loading" class="animate-pulse">
                <td colspan="6" class="px-6 py-12 text-center">
                  <div class="flex items-center justify-center space-x-2">
                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    <span class="text-gray-500">Cargando usuarios...</span>
                  </div>
                </td>
              </tr>
              <tr *ngIf="!loading && users.length === 0" class="text-center">
                <td colspan="6" class="px-6 py-12">
                  <div class="flex flex-col items-center">
                    <svg class="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>
                    </svg>
                    <h3 class="text-lg font-medium text-gray-900 mb-1">No hay usuarios</h3>
                    <p class="text-gray-500">No se encontraron usuarios con los filtros aplicados.</p>
                  </div>
                </td>
              </tr>
              <tr *ngFor="let user of users" class="hover:bg-gray-50/50 transition-colors duration-200">
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex items-center">
                    <div class="flex-shrink-0 h-10 w-10">
                      <div class="h-10 w-10 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center">
                        <span class="text-white font-semibold text-sm">
                          {{ getInitials(user.first_name, user.last_name) }}
                        </span>
                      </div>
                    </div>
                    <div class="ml-4">
                      <div class="text-sm font-medium text-gray-900">
                        {{ user.first_name }} {{ user.last_name }}
                      </div>
                      <div class="text-sm text-gray-500">&#64;{{ user.username }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm text-gray-900">{{ user.email }}</div>
                  <div class="text-sm text-gray-500" *ngIf="user.email_verified">✓ Verificado</div>
                  <div class="text-sm text-red-500" *ngIf="!user.email_verified">✗ No verificado</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span
                    class="inline-flex px-2 py-1 text-xs font-semibold rounded-full"
                    [ngClass]="getStatusBadgeClass(user.state)"
                  >
                    {{ getStatusText(user.state) }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <div *ngIf="user.user_roles && user.user_roles.length > 0">
                    <span *ngFor="let role of user.user_roles; let i = index">
                      {{ role.roles.name }}{{ i < user.user_roles.length - 1 ? ', ' : '' }}
                    </span>
                  </div>
                  <div *ngIf="!user.user_roles || user.user_roles.length === 0" class="text-gray-500">
                    Sin rol asignado
                  </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {{ user.last_login ? formatDate(user.last_login) : 'Nunca' }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div class="flex items-center space-x-2">
                    <button
                      (click)="viewUser(user)"
                      class="text-primary hover:text-secondary transition-colors duration-200"
                      title="Ver detalles"
                    >
                      👁️
                    </button>
                    <button
                      (click)="editUser(user)"
                      class="text-blue-600 hover:text-blue-900 transition-colors duration-200"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      (click)="toggleUserStatus(user)"
                      class="transition-colors duration-200"
                      [title]="user.state === 'active' ? 'Suspender' : 'Reactivar'"
                      [ngClass]="user.state === 'active' ? 'text-yellow-600 hover:text-yellow-900' : 'text-green-600 hover:text-green-900'"
                    >
                      {{ user.state === 'active' ? '🚫' : '✅' }}
                    </button>
                    <button
                      (click)="assignRole(user)"
                      class="text-purple-600 hover:text-purple-900 transition-colors duration-200"
                      title="Asignar Rol"
                    >
                      👤
                    </button>
                    <button
                      (click)="archiveUser(user)"
                      class="text-red-600 hover:text-red-900 transition-colors duration-200"
                      title="Archivar"
                    >
                      🗂️
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div *ngIf="totalPages > 1" class="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
          <div class="flex-1 flex justify-between sm:hidden">
            <button
              (click)="changePage(currentPage - 1)"
              [disabled]="currentPage === 1"
              class="relative inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <button
              (click)="changePage(currentPage + 1)"
              [disabled]="currentPage === totalPages"
              class="ml-3 relative inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
          <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p class="text-sm text-gray-700">
                Mostrando
                <span class="font-medium">{{ (currentPage - 1) * pageSize + 1 }}</span>
                a
                <span class="font-medium">{{ math.min(currentPage * pageSize, totalItems) }}</span>
                de
                <span class="font-medium">{{ totalItems }}</span>
                resultados
              </p>
            </div>
            <div>
              <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                <button
                  (click)="changePage(currentPage - 1)"
                  [disabled]="currentPage === 1"
                  class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/>
                  </svg>
                </button>
                <span
                  *ngFor="let page of getVisiblePages()"
                  class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium"
                  [ngClass]="page === currentPage ? 'text-primary bg-primary/10 border-primary' : 'text-gray-700 hover:bg-gray-50'"
                >
                  <button
                    *ngIf="page !== '...'"
                    (click)="changePage(page)"
                    class="w-full h-full"
                  >
                    {{ page }}
                  </button>
                  <span *ngIf="page === '...'">{{ page }}</span>
                </span>
                <button
                  (click)="changePage(currentPage + 1)"
                  [disabled]="currentPage === totalPages"
                  class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
                  </svg>
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>

      <!-- Create/Edit User Modal -->
      <div *ngIf="showModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
          <div class="p-6">
            <div class="flex justify-between items-center mb-6">
              <h3 class="text-xl font-bold text-gray-900">
                {{ isEditing ? 'Editar Usuario' : 'Crear Nuevo Usuario' }}
              </h3>
              <button
                (click)="closeModal()"
                class="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            <form [formGroup]="userForm" (ngSubmit)="saveUser()" class="space-y-4">
              <!-- Organization ID (hidden for now, will be set from current org) -->
              <input type="hidden" formControlName="organization_id">

              <!-- First Name -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Nombre *</label>
                <input
                  type="text"
                  formControlName="first_name"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Juan"
                />
                <div *ngIf="userForm.get('first_name')?.invalid && userForm.get('first_name')?.touched" class="mt-1 text-sm text-red-600">
                  El nombre es requerido
                </div>
              </div>

              <!-- Last Name -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Apellido *</label>
                <input
                  type="text"
                  formControlName="last_name"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Pérez"
                />
                <div *ngIf="userForm.get('last_name')?.invalid && userForm.get('last_name')?.touched" class="mt-1 text-sm text-red-600">
                  El apellido es requerido
                </div>
              </div>

              <!-- Username -->
              <div *ngIf="!isEditing">
                <label class="block text-sm font-medium text-gray-700 mb-2">Nombre de Usuario *</label>
                <input
                  type="text"
                  formControlName="username"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="juanperez"
                />
                <div *ngIf="userForm.get('username')?.invalid && userForm.get('username')?.touched" class="mt-1 text-sm text-red-600">
                  El nombre de usuario es requerido
                </div>
              </div>

              <!-- Email -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input
                  type="email"
                  formControlName="email"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="juan@email.com"
                />
                <div *ngIf="userForm.get('email')?.invalid && userForm.get('email')?.touched" class="mt-1 text-sm text-red-600">
                  Email válido requerido
                </div>
              </div>

              <!-- Password (only for create) -->
              <div *ngIf="!isEditing">
                <label class="block text-sm font-medium text-gray-700 mb-2">Contraseña *</label>
                <input
                  type="password"
                  formControlName="password"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="••••••••"
                />
                <div *ngIf="userForm.get('password')?.invalid && userForm.get('password')?.touched" class="mt-1 text-sm text-red-600">
                  La contraseña debe tener al menos 6 caracteres
                </div>
              </div>

              <!-- State -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Estado</label>
                <select
                  formControlName="state"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                >
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </select>
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
                  [disabled]="userForm.invalid || modalLoading"
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

      <!-- View User Modal -->
      <div *ngIf="showViewModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div class="p-6" *ngIf="selectedUser">
            <div class="flex justify-between items-center mb-6">
              <h3 class="text-xl font-bold text-gray-900">Detalles del Usuario</h3>
              <button
                (click)="closeViewModal()"
                class="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            <div class="space-y-6">
              <!-- User Header -->
              <div class="flex items-center space-x-4">
                <div class="h-16 w-16 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center">
                  <span class="text-white font-bold text-xl">
                    {{ getInitials(selectedUser.first_name, selectedUser.last_name) }}
                  </span>
                </div>
                <div>
                  <h4 class="text-lg font-semibold text-gray-900">
                    {{ selectedUser.first_name }} {{ selectedUser.last_name }}
                  </h4>
                  <p class="text-gray-600">&#64;{{ selectedUser.username }}</p>
                  <span
                    class="inline-flex px-2 py-1 text-xs font-semibold rounded-full mt-1"
                    [ngClass]="getStatusBadgeClass(selectedUser.state)"
                  >
                    {{ getStatusText(selectedUser.state) }}
                  </span>
                </div>
              </div>

              <!-- User Details -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h5 class="font-semibold text-gray-900 mb-3">Información Personal</h5>
                  <div class="space-y-2">
                    <div><span class="font-medium">Email:</span> {{ selectedUser.email }}</div>
                    <div><span class="font-medium">Email Verificado:</span> {{ selectedUser.email_verified ? 'Sí' : 'No' }}</div>
                    <div><span class="font-medium">2FA Habilitado:</span> {{ selectedUser.two_factor_enabled ? 'Sí' : 'No' }}</div>
                    <div><span class="font-medium">Onboarding Completado:</span> {{ selectedUser.onboarding_completed ? 'Sí' : 'No' }}</div>
                  </div>
                </div>

                <div>
                  <h5 class="font-semibold text-gray-900 mb-3">Información del Sistema</h5>
                  <div class="space-y-2">
                    <div><span class="font-medium">ID:</span> {{ selectedUser.id }}</div>
                    <div><span class="font-medium">Organización:</span> {{ selectedUser.organization_id }}</div>
                    <div><span class="font-medium">Intentos Fallidos:</span> {{ selectedUser.failed_login_attempts }}</div>
                    <div><span class="font-medium">Último Login:</span> {{ selectedUser.last_login ? formatDate(selectedUser.last_login) : 'Nunca' }}</div>
                  </div>
                </div>
              </div>

              <!-- Roles -->
              <div>
                <h5 class="font-semibold text-gray-900 mb-3">Roles Asignados</h5>
                <div class="flex flex-wrap gap-2" *ngIf="selectedUser.user_roles && selectedUser.user_roles.length > 0">
                  <span
                    *ngFor="let role of selectedUser.user_roles"
                    class="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium"
                  >
                    {{ role.roles.name }}
                  </span>
                </div>
                <p *ngIf="!selectedUser.user_roles || selectedUser.user_roles.length === 0" class="text-gray-500">
                  No hay roles asignados
                </p>
              </div>

              <!-- Dates -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <span class="font-medium">Creado:</span>
                  <div class="text-gray-600">{{ formatDate(selectedUser.created_at) }}</div>
                </div>
                <div>
                  <span class="font-medium">Actualizado:</span>
                  <div class="text-gray-600">{{ formatDate(selectedUser.updated_at) }}</div>
                </div>
              </div>
            </div>

            <div class="flex justify-end space-x-3 mt-6">
              <button
                (click)="editUser(selectedUser)"
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

      <!-- Role Assignment Modal -->
      <div *ngIf="showRoleModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
          <div class="p-6" *ngIf="selectedUser">
            <div class="flex justify-between items-center mb-6">
              <h3 class="text-xl font-bold text-gray-900">Asignar Rol</h3>
              <button
                (click)="closeRoleModal()"
                class="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            <div class="mb-6">
              <p class="text-gray-600">
                Asignando rol al usuario: <span class="font-semibold">{{ selectedUser.first_name }} {{ selectedUser.last_name }}</span>
              </p>
            </div>

            <!-- Current Roles -->
            <div class="mb-6" *ngIf="selectedUser.user_roles && selectedUser.user_roles.length > 0">
              <h4 class="font-semibold text-gray-900 mb-3">Roles Actuales</h4>
              <div class="flex flex-wrap gap-2">
                <span
                  *ngFor="let role of selectedUser.user_roles"
                  class="inline-flex items-center px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium"
                >
                  {{ role.roles.name }}
                  <button
                    (click)="removeUserRole(selectedUser, role.roles.id)"
                    class="ml-2 text-primary hover:text-red-600 transition-colors"
                    title="Remover rol"
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>

            <!-- Assign New Role -->
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Seleccionar Rol</label>
                <select
                  [(ngModel)]="selectedRoleId"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                >
                  <option [ngValue]="null">Seleccionar rol...</option>
                  <option *ngFor="let role of availableRoles" [ngValue]="role.id">
                    {{ role.name }}
                  </option>
                </select>
              </div>

              <!-- Actions -->
              <div class="flex space-x-3 pt-4">
                <button
                  type="button"
                  (click)="closeRoleModal()"
                  class="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  (click)="saveRoleAssignment()"
                  [disabled]="!selectedRoleId || modalLoading"
                  class="flex-1 px-4 py-2 bg-gradient-to-r from-primary to-secondary text-white rounded-lg hover:shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span *ngIf="modalLoading" class="animate-spin">⏳</span>
                  <span *ngIf="!modalLoading">Asignar Rol</span>
                </button>
              </div>
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
export class UsersComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Expose Math to template via instance property
  math = Math;

  // Data
  users: User[] = [];
  loading = false;
  totalItems = 0;
  totalPages = 0;
  currentPage = 1;
  pageSize = 10;

  // Forms
  filtersForm: FormGroup;
  userForm: FormGroup;

  // Typed control getters for template binding
  get searchCtrl(): FormControl<string> {
    return this.filtersForm.get('search') as FormControl<string>;
  }
  get stateCtrl(): FormControl<string> {
    return this.filtersForm.get('state') as FormControl<string>;
  }
  get limitCtrl(): FormControl<number> {
    return this.filtersForm.get('limit') as FormControl<number>;
  }

  // Modal states
  showModal = false;
  showViewModal = false;
  showRoleModal = false;
  isEditing = false;
  modalLoading = false;
  selectedUser: User | null = null;

  // Role assignment
  availableRoles: Role[] = [];
  selectedRoleId: number | null = null;

  constructor(
    private userService: UserService,
    private roleService: RoleService,
    private tenantFacade: TenantFacade,
    private fb: FormBuilder
  ) {
    this.filtersForm = this.fb.group({
      search: [''],
      state: [''],
      limit: [10]
    });

    this.userForm = this.fb.group({
      organization_id: [1], // Will be set from current organization
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      username: ['', !this.isEditing ? Validators.required : null],
      email: ['', [Validators.required, Validators.email]],
      password: ['', !this.isEditing ? [Validators.required, Validators.minLength(6)] : null],
      state: ['active']
    });
  }

  ngOnInit(): void {
    this.loadUsers();

    // Subscribe to filter changes
    this.filtersForm.valueChanges
      .pipe(
        takeUntil(this.destroy$),
        debounceTime(300),
        distinctUntilChanged()
      )
      .subscribe(() => {
        this.currentPage = 1;
        // keep pageSize in sync with limit control
        const newLimit = Number(this.limitCtrl.value ?? 10);
        this.pageSize = newLimit;
        this.loadUsers();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load users
  loadUsers(): void {
    this.loading = true;
    const filters = this.filtersForm.value as { search: string; state: string; limit: number };
    // coerce limit to number to satisfy API typing and template math
    const limit = Number(filters.limit ?? this.pageSize);
    this.pageSize = limit;

    const state = (filters.state || undefined) as 'active' | 'inactive' | 'suspended' | 'archived' | undefined;
    const organizationId = this.tenantFacade.getCurrentOrganization()?.id;
    const organization_id = organizationId ? Number(organizationId) : undefined;

    this.userService.getUsers({
      page: this.currentPage,
      limit,
      search: filters.search || undefined,
      state,
      organization_id
    }).subscribe({
      next: (response) => {
        this.users = response.data;
        this.totalItems = response.meta.total;
        this.totalPages = response.meta.totalPages;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading users:', error);
        this.loading = false;
      }
    });
  }

  // Pagination
  changePage(page: number | string): void {
    if (typeof page !== 'number') return;
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.loadUsers();
    }
  }

  getVisiblePages(): (number | string)[] {
    const pages: (number | string)[] = [];
    const total = this.totalPages;
    const current = this.currentPage;

    if (total <= 7) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      if (current <= 4) {
        for (let i = 1; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(total);
      } else if (current >= total - 3) {
        pages.push(1);
        pages.push('...');
        for (let i = total - 4; i <= total; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = current - 1; i <= current + 1; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(total);
      }
    }

    return pages;
  }

  // Filters
  clearFilters(): void {
    this.filtersForm.reset({
      search: '',
      state: '',
      limit: 10
    });
    this.currentPage = 1;
  }

  // Modal operations
  openCreateModal(): void {
    this.isEditing = false;
    this.userForm.reset({
      organization_id: 1, // Will be set from current organization
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      password: '',
      state: 'active'
    });
    this.showModal = true;
  }

  editUser(user: User): void {
    this.isEditing = true;
    this.selectedUser = user;
    this.userForm.patchValue({
      organization_id: user.organization_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      state: user.state
    });
    this.showModal = true;
    this.showViewModal = false;
  }

  viewUser(user: User): void {
    this.selectedUser = user;
    this.showViewModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.isEditing = false;
    this.selectedUser = null;
    this.modalLoading = false;
  }

  closeViewModal(): void {
    this.showViewModal = false;
    this.selectedUser = null;
  }

  // CRUD operations
  saveUser(): void {
    if (this.userForm.invalid) {
      this.markFormGroupTouched();
      return;
    }

    this.modalLoading = true;
    const formData = this.userForm.value;

    if (this.isEditing && this.selectedUser) {
      // Update user
      const updateData: UpdateUserDto = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        state: formData.state
      };

      this.userService.updateUser(this.selectedUser.id, updateData).subscribe({
        next: () => {
          this.loadUsers();
          this.closeModal();
        },
        error: (error) => {
          console.error('Error updating user:', error);
          this.modalLoading = false;
        }
      });
    } else {
      // Create user
      const createData: CreateUserDto = {
        organization_id: formData.organization_id,
        first_name: formData.first_name,
        last_name: formData.last_name,
        username: formData.username,
        email: formData.email,
        password: formData.password,
        state: formData.state
      };

      this.userService.createUser(createData).subscribe({
        next: () => {
          this.loadUsers();
          this.closeModal();
        },
        error: (error) => {
          console.error('Error creating user:', error);
          this.modalLoading = false;
        }
      });
    }
  }

  toggleUserStatus(user: User): void {
    const newState = user.state === 'active' ? 'suspended' : 'active';
    const action = newState === 'suspended' ? 'suspender' : 'reactivar';

    if (confirm(`¿Estás seguro de que quieres ${action} al usuario ${user.first_name} ${user.last_name}?`)) {
      if (newState === 'suspended') {
        this.userService.suspendUser(user.id).subscribe({
          next: () => this.loadUsers(),
          error: (error) => console.error('Error suspending user:', error)
        });
      } else {
        this.userService.reactivateUser(user.id).subscribe({
          next: () => this.loadUsers(),
          error: (error) => console.error('Error reactivating user:', error)
        });
      }
    }
  }

  archiveUser(user: User): void {
    if (confirm(`¿Estás seguro de que quieres archivar al usuario ${user.first_name} ${user.last_name}? Esta acción no se puede deshacer.`)) {
      this.userService.archiveUser(user.id).subscribe({
        next: () => this.loadUsers(),
        error: (error) => console.error('Error archiving user:', error)
      });
    }
  }

  assignRole(user: User): void {
    this.selectedUser = user;
    this.selectedRoleId = null;
    this.loadAvailableRoles();
    this.showRoleModal = true;
  }

  loadAvailableRoles(): void {
    this.roleService.getRoles().subscribe({
      next: (response) => {
        this.availableRoles = response.data;
      },
      error: (error) => {
        console.error('Error loading roles:', error);
      }
    });
  }

  saveRoleAssignment(): void {
    if (!this.selectedUser || !this.selectedRoleId) return;

    this.modalLoading = true;
    this.roleService.assignRoleToUser({
      userId: this.selectedUser.id,
      roleId: this.selectedRoleId
    }).subscribe({
      next: () => {
        this.loadUsers();
        this.closeRoleModal();
      },
      error: (error) => {
        console.error('Error assigning role:', error);
        this.modalLoading = false;
      }
    });
  }

  removeUserRole(user: User, roleId: number): void {
    if (confirm('¿Estás seguro de que quieres remover este rol del usuario?')) {
      this.roleService.removeRoleFromUser({
        userId: user.id,
        roleId: roleId
      }).subscribe({
        next: () => this.loadUsers(),
        error: (error) => console.error('Error removing role:', error)
      });
    }
  }

  closeRoleModal(): void {
    this.showRoleModal = false;
    this.selectedUser = null;
    this.selectedRoleId = null;
    this.modalLoading = false;
  }

  // Helper methods
  getInitials(firstName: string, lastName: string): string {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }

  getStatusBadgeClass(state: string): string {
    switch (state) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      case 'suspended':
        return 'bg-yellow-100 text-yellow-800';
      case 'archived':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  getStatusText(state: string): string {
    switch (state) {
      case 'active':
        return 'Activo';
      case 'inactive':
        return 'Inactivo';
      case 'suspended':
        return 'Suspendido';
      case 'archived':
        return 'Archivado';
      default:
        return state;
    }
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

  private markFormGroupTouched(): void {
    Object.keys(this.userForm.controls).forEach(key => {
      this.userForm.get(key)?.markAsTouched();
    });
  }
}
