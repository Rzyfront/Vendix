import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';

import { RolesService } from './services/roles.service';
import { PaginatedRolesResponse, Role } from './interfaces/role.interface';

// Import new components
import {
  RoleStatsComponent,
  RoleEmptyStateComponent,
  EditRoleModalComponent,
  DeleteRoleModalComponent,
  RolePermissionsModalComponent
} from './components/index';

// Import shared components
import {
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent
} from '../../../../shared/components/index';

// Import styles (CSS instead of SCSS to avoid loader issues)
import './roles.component.css';

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RoleStatsComponent,
    RoleEmptyStateComponent,
    EditRoleModalComponent,
    DeleteRoleModalComponent,
    RolePermissionsModalComponent,
    InputsearchComponent,
    IconComponent,
    TableComponent
  ],
  providers: [RolesService],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <app-role-stats [roles]="roles"></app-role-stats>

      <!-- Roles List -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                All Roles ({{ pagination.total }})
              </h2>
            </div>
            
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <!-- Input de búsqueda compacto -->
              <app-inputsearch
                class="w-full sm:w-64"
                size="sm"
                placeholder="Search roles..."
                [debounceTime]="1000"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>
              
              <div class="flex gap-2">
                <button
                  class="px-3 py-2 rounded-button font-medium border border-border text-text-primary hover:bg-muted/20 disabled:opacity-50 text-sm"
                  (click)="refreshRoles()"
                  [disabled]="isLoading"
                  title="Refresh"
                >
                  <app-icon name="refresh" [size]="16"></app-icon>
                </button>
                <button
                  class="px-3 py-2 rounded-button text-white font-medium bg-primary hover:bg-primary/90 text-sm flex items-center gap-2"
                  (click)="createRole()"
                  title="New Role"
                >
                  <app-icon name="plus" [size]="16"></app-icon>
                  <span class="hidden sm:inline">New Role</span>
                </button>
              </div>
            </div>
            
            <!-- Paginación info -->
            <div class="flex items-center gap-2 mt-2 sm:mt-0">
              <span class="text-sm text-text-secondary">
                Page {{ pagination.page }} of {{ pagination.totalPages }}
              </span>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Loading roles...</p>
        </div>

        <!-- Empty State -->
        <app-role-empty-state
          *ngIf="!isLoading && roles.length === 0"
          [title]="getEmptyStateTitle()"
          [description]="getEmptyStateDescription()"
          (actionClick)="createRole()">
        </app-role-empty-state>

        <!-- Roles Table -->
        <div *ngIf="!isLoading && roles.length > 0" class="p-6">
          <app-table
            [data]="paginatedRoles"
            [columns]="tableColumns"
            [actions]="tableActions"
            [loading]="isLoading"
            [sortable]="true"
            [hoverable]="true"
            [striped]="true"
            size="md"
            (sort)="onTableSort($event)"
            (rowClick)="viewRole($event)">
          </app-table>

          <!-- Pagination -->
          <div *ngIf="totalPages > 1" class="mt-6 flex justify-center">
            <div class="flex items-center justify-between">
              <div class="text-sm text-text-secondary">
                Showing {{ ((currentPage - 1) * pageSize) + 1 }} - {{ Math.min(currentPage * pageSize, totalItems) }} of {{ totalItems }} roles
              </div>
              <div class="flex items-center space-x-2">
                <!-- Botón anterior -->
                <button
                  (click)="onPageChange(currentPage - 1)"
                  [disabled]="currentPage === 1"
                  class="px-3 py-1 text-sm border border-border rounded-md hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed">
                  <app-icon name="chevron-left" class="w-4 h-4"></app-icon>
                </button>
                
                <!-- Números de página -->
                <div class="flex space-x-1">
                  <button
                    *ngFor="let page of getPageNumbers()"
                    (click)="onPageChange(page)"
                    [class]="currentPage === page ? 'px-3 py-1 text-sm bg-primary text-white rounded-md' : 'px-3 py-1 text-sm border border-border rounded-md hover:bg-surface'">
                    {{ page }}
                  </button>
                </div>
                
                <!-- Botón siguiente -->
                <button
                  (click)="onPageChange(currentPage + 1)"
                  [disabled]="currentPage === totalPages"
                  class="px-3 py-1 text-sm border border-border rounded-md hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed">
                  <app-icon name="chevron-right" class="w-4 h-4"></app-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Create Role Modal -->
      <app-edit-role-modal
        *ngIf="showCreateModal"
        [role]="null"
        (close)="onCloseModals()"
        (roleUpdated)="onRoleCreated()"></app-edit-role-modal>

      <!-- Edit Role Modal -->
      <app-edit-role-modal
        *ngIf="showEditModal"
        [role]="currentRole"
        (close)="onCloseModals()"
        (roleUpdated)="onRoleUpdated()"></app-edit-role-modal>

      <!-- Delete Role Modal -->
      <app-delete-role-modal
        *ngIf="showDeleteModal"
        [role]="roleToDelete"
        (close)="onCloseModals()"
        (roleDeleted)="onRoleDeleted()"></app-delete-role-modal>

      <!-- Role Permissions Modal -->
      <app-role-permissions-modal
        *ngIf="showPermissionsModal"
        [role]="currentRole"
        (close)="onCloseModals()"
        (permissionsUpdated)="onPermissionsUpdated()"></app-role-permissions-modal>
    </div>
  `
})
export class RolesComponent implements OnInit, OnDestroy {
  roles: Role[] = [];
  filteredRoles: Role[] = [];
  isLoading = false;
  showEditModal = false;
  showDeleteModal = false;
  showCreateModal = false;
  showPermissionsModal = false;
  currentRole: any;
  roleToDelete: any;
  searchTerm = '';
  
  // Table configuration
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, width: '200px' },
    { key: 'description', label: 'Descripción', sortable: false, width: '300px' },
    { key: 'is_system_role', label: 'Rol del Sistema', sortable: false, width: '150px', align: 'center' },
    { key: '_count.user_roles', label: 'Usuarios', sortable: true, width: '100px', align: 'center' }
  ];

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (role: any) => this.editRole(role),
      variant: 'primary',
      show: (role: any) => !role.is_system_role
    },
    {
      label: 'Permisos',
      icon: 'shield',
      action: (role: any) => this.managePermissions(role),
      variant: 'secondary'
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (role: any) => this.deleteRole(role),
      variant: 'danger',
      show: (role: any) => !role.is_system_role && role._count?.user_roles === 0
    }
  ];

  // Pagination
  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  };

  // Paginación y filtrado
  currentPage = 1;
  pageSize = 10;
  totalItems = 0;
  totalPages = 0;
  sortBy = 'name';
  sortDirection = 'asc';
  
  // Para acceder a Math en el template
  Math = Math;

  private subscriptions: Subscription[] = [];

  constructor(
    private rolesService: RolesService,
    private fb: FormBuilder
  ) {}

  ngOnInit(): void {
    this.loadRoles();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  get paginatedRoles(): Role[] {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredRoles.slice(start, end);
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.pagination.page = 1;
    this.filterRoles();
  }

  onTableSort(sortEvent: { column: string; direction: 'asc' | 'desc' | null }): void {
    this.sortBy = sortEvent.column;
    this.sortDirection = sortEvent.direction || 'asc';
    this.filterRoles();
  }

  onPageChange(page: number): void {
    this.currentPage = page;
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 1;
    this.updatePagination();
  }

  private filterRoles(): void {
    let filtered = [...this.roles];

    // Aplicar filtro de búsqueda
    if (this.searchTerm) {
      const searchLower = this.searchTerm.toLowerCase();
      filtered = filtered.filter(role =>
        role.name.toLowerCase().includes(searchLower) ||
        (role.description && role.description.toLowerCase().includes(searchLower))
      );
    }

    // Aplicar ordenamiento
    filtered.sort((a, b) => {
      let aValue: any = a[this.sortBy as keyof Role];
      let bValue: any = b[this.sortBy as keyof Role];

      // Manejar ordenamiento por campos anidados
      if (this.sortBy === '_count.user_roles') {
        aValue = a._count?.user_roles || 0;
        bValue = b._count?.user_roles || 0;
      }

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = (bValue as string).toLowerCase();
      }

      if (this.sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    this.filteredRoles = filtered;
    this.updatePagination();
  }

  private updatePagination(): void {
    this.totalItems = this.filteredRoles.length;
    this.totalPages = Math.ceil(this.totalItems / this.pageSize);
    
    // Asegurar que la página actual sea válida
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 5;
    const halfVisible = Math.floor(maxVisiblePages / 2);
    
    let start = Math.max(1, this.currentPage - halfVisible);
    let end = Math.min(this.totalPages, start + maxVisiblePages - 1);
    
    // Ajustar el inicio si estamos cerca del final
    if (end - start + 1 < maxVisiblePages) {
      start = Math.max(1, end - maxVisiblePages + 1);
    }
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    return pages;
  }

  loadRoles(): void {
    this.isLoading = true;
    this.rolesService.getRoles().subscribe({
      next: (response: PaginatedRolesResponse) => {
        this.roles = response.data;
        this.filterRoles();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading roles:', error);
        this.isLoading = false;
      }
    });
  }

  createRole(): void {
    this.currentRole = null;
    this.showCreateModal = true;
  }

  editRole(role: any): void {
    this.currentRole = role;
    this.showEditModal = true;
  }

  onRoleUpdated(): void {
    this.showEditModal = false;
    this.loadRoles();
  }

  onRoleCreated(): void {
    this.showCreateModal = false;
    this.loadRoles();
  }

  async deleteRole(role: any): Promise<void> {
    this.roleToDelete = role;
    this.showDeleteModal = true;
  }

  onRoleDeleted(): void {
    this.showDeleteModal = false;
    this.roleToDelete = null;
    this.loadRoles();
  }

  managePermissions(role: any): void {
    this.currentRole = role;
    this.showPermissionsModal = true;
  }

  onPermissionsUpdated(): void {
    this.showPermissionsModal = false;
    this.currentRole = null;
    this.loadRoles();
  }

  refreshRoles(): void {
    this.loadRoles();
  }

  viewRole(role: Role): void {
    // Navigate to role details
    // TODO: Implement navigation when details page is created
    console.log('View role:', role);
  }

  getEmptyStateTitle(): string {
    if (this.searchTerm) {
      return 'No roles match your search';
    }
    return 'No roles found';
  }

  getEmptyStateDescription(): string {
    if (this.searchTerm) {
      return 'Try adjusting your search terms';
    }
    return 'Get started by creating your first role.';
  }

  onCloseModals(): void {
    this.showEditModal = false;
    this.showDeleteModal = false;
    this.showCreateModal = false;
    this.showPermissionsModal = false;
    this.currentRole = null;
    this.roleToDelete = null;
  }
}
