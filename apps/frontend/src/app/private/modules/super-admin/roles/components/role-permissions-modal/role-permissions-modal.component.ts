import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RolesService } from '../../services/roles.service';
import { ModalComponent, IconComponent } from '../../../../../../shared/components/index';

@Component({
  selector: 'app-role-permissions-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ModalComponent, IconComponent],
  templateUrl: './role-permissions-modal.component.html',
})
export class RolePermissionsModalComponent implements OnInit {
  @Input() role: any;
  @Output() close = new EventEmitter<void>();
  @Output() permissionsUpdated = new EventEmitter<void>();

  permissionsForm: FormGroup;
  availablePermissions: any[] = [];
  assignedPermissions: any[] = [];
  isLoading = false;
  isSaving = false;

  constructor(
    private fb: FormBuilder,
    private rolesService: RolesService
  ) {
    this.permissionsForm = this.fb.group({
      selectedPermissions: [[]],
    });
  }

  ngOnInit(): void {
    if (this.role) {
      this.loadPermissions();
    }
  }

  loadPermissions(): void {
    this.isLoading = true;
    
    // Cargar todos los permisos disponibles
    this.loadAvailablePermissions();
    
    // Cargar permisos asignados al rol
    this.loadAssignedPermissions();
  }

  loadAvailablePermissions(): void {
    // TODO: Implementar endpoint para obtener todos los permisos
    // Por ahora usamos datos de ejemplo
    this.availablePermissions = [
      { id: 1, name: 'users.create', description: 'Crear usuarios', path: '/api/users', method: 'POST' },
      { id: 2, name: 'users.read', description: 'Ver usuarios', path: '/api/users', method: 'GET' },
      { id: 3, name: 'users.update', description: 'Actualizar usuarios', path: '/api/users', method: 'PATCH' },
      { id: 4, name: 'users.delete', description: 'Eliminar usuarios', path: '/api/users', method: 'DELETE' },
      { id: 5, name: 'roles.create', description: 'Crear roles', path: '/api/roles', method: 'POST' },
      { id: 6, name: 'roles.read', description: 'Ver roles', path: '/api/roles', method: 'GET' },
      { id: 7, name: 'roles.update', description: 'Actualizar roles', path: '/api/roles', method: 'PATCH' },
      { id: 8, name: 'roles.delete', description: 'Eliminar roles', path: '/api/roles', method: 'DELETE' },
      { id: 9, name: 'permissions.create', description: 'Crear permisos', path: '/api/permissions', method: 'POST' },
      { id: 10, name: 'permissions.read', description: 'Ver permisos', path: '/api/permissions', method: 'GET' },
    ];
    
    this.isLoading = false;
  }

  loadAssignedPermissions(): void {
    if (this.role && this.role.role_permissions) {
      this.assignedPermissions = this.role.role_permissions.map((rp: any) => rp.permissions);
      this.permissionsForm.patchValue({
        selectedPermissions: this.assignedPermissions.map((p: any) => p.id),
      });
    }
  }

  togglePermission(permissionId: number, event: any): void {
    const selectedPermissions = this.permissionsForm.get('selectedPermissions')?.value || [];
    
    if (event.target.checked) {
      selectedPermissions.push(permissionId);
    } else {
      const index = selectedPermissions.indexOf(permissionId);
      if (index > -1) {
        selectedPermissions.splice(index, 1);
      }
    }
    
    this.permissionsForm.patchValue({
      selectedPermissions: selectedPermissions,
    });
  }

  isPermissionSelected(permissionId: number): boolean {
    const selectedPermissions = this.permissionsForm.get('selectedPermissions')?.value || [];
    return selectedPermissions.includes(permissionId);
  }

  savePermissions(): void {
    if (this.permissionsForm.valid) {
      this.isSaving = true;
      
      const selectedPermissions = this.permissionsForm.get('selectedPermissions')?.value || [];
      const currentPermissionIds = this.assignedPermissions.map((p: any) => p.id);
      
      // Calcular permisos a agregar y a remover
      const toAdd = selectedPermissions.filter((id: number) => !currentPermissionIds.includes(id));
      const toRemove = currentPermissionIds.filter((id: number) => !selectedPermissions.includes(id));
      
      const promises: Promise<any>[] = [];
      
      if (toAdd.length > 0) {
        promises.push(
          this.rolesService.assignPermissionsToRole(this.role.id, toAdd).toPromise()
        );
      }
      
      if (toRemove.length > 0) {
        promises.push(
          this.rolesService.removePermissionsFromRole(this.role.id, toRemove).toPromise()
        );
      }
      
      Promise.all(promises)
        .then(() => {
          this.isSaving = false;
          this.permissionsUpdated.emit();
          this.close.emit();
        })
        .catch((error) => {
          this.isSaving = false;
          console.error('Error updating permissions:', error);
        });
    }
  }

  onCancel(): void {
    this.close.emit();
  }

  getPermissionGroup(permissions: any[]): { [key: string]: any[] } {
    const groups: { [key: string]: any[] } = {};
    
    permissions.forEach(permission => {
      const resource = permission.name.split('.')[0];
      if (!groups[resource]) {
        groups[resource] = [];
      }
      groups[resource].push(permission);
    });
    
    return groups;
  }

  getResourceDisplayName(resource: string): string {
    const displayNames: { [key: string]: string } = {
      users: 'Usuarios',
      roles: 'Roles',
      permissions: 'Permisos',
      organizations: 'Organizaciones',
      stores: 'Tiendas',
      products: 'Productos',
      orders: 'Pedidos',
      payments: 'Pagos',
    };
    
    return displayNames[resource] || resource;
  }

  getMethodBadgeClass(method: string): string {
    const classes: { [key: string]: string } = {
      GET: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      POST: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      PATCH: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      DELETE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    
    return classes[method] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}