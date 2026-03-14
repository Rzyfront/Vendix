import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  OnChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreRolesService } from '../services/store-roles.service';
import { StoreRole, StorePermission } from '../interfaces/store-role.interface';
import { Subject, takeUntil, forkJoin } from 'rxjs';

interface PermissionGroup {
  module: string;
  permissions: StorePermission[];
}

@Component({
  selector: 'app-store-role-permissions-modal',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'xl'"
      [title]="'Permisos: ' + (role?.name || '')"
      subtitle="Selecciona los permisos que deseas asignar a este rol"
    >
      <div *ngIf="isLoadingPermissions" class="p-6 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p class="mt-2 text-text-secondary">Cargando permisos...</p>
      </div>

      <div *ngIf="!isLoadingPermissions" class="space-y-4 max-h-[60vh] overflow-y-auto">
        <div *ngFor="let group of permissionGroups" class="border border-border rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h4 class="font-medium text-text-primary capitalize">{{ group.module }}</h4>
            <label class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input type="checkbox" [checked]="isGroupFullySelected(group)"
                     (change)="toggleGroup(group, $event)" class="rounded border-border">
              Todos
            </label>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label *ngFor="let perm of group.permissions"
                   class="flex items-center gap-2 p-2 rounded hover:bg-surface-hover cursor-pointer text-sm">
              <input type="checkbox" [checked]="selectedPermissionIds.has(perm.id)"
                     (change)="togglePermission(perm.id)" class="rounded border-border">
              <span>{{ perm.description || perm.name }}</span>
            </label>
          </div>
        </div>

        <div *ngIf="permissionGroups.length === 0" class="p-8 text-center">
          <p class="text-text-secondary">No hay permisos disponibles</p>
        </div>
      </div>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" (clicked)="onCancel()" [disabled]="isSaving">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSave()" [disabled]="isSaving" [loading]="isSaving">
          Guardar Permisos
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
  ],
})
export class StoreRolePermissionsModalComponent implements OnDestroy, OnChanges {
  @Input() isOpen: boolean = false;
  @Input() role: StoreRole | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onPermissionsUpdated = new EventEmitter<void>();

  permissionGroups: PermissionGroup[] = [];
  selectedPermissionIds = new Set<number>();
  originalPermissionIds = new Set<number>();
  allPermissions: StorePermission[] = [];

  isLoadingPermissions: boolean = false;
  isSaving: boolean = false;
  private destroy$ = new Subject<void>();

  private storeRolesService = inject(StoreRolesService);
  private toastService = inject(ToastService);

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(): void {
    if (this.isOpen && this.role) {
      this.loadPermissions();
    }
  }

  private loadPermissions(): void {
    if (!this.role) return;

    this.isLoadingPermissions = true;

    forkJoin({
      available: this.storeRolesService.getAvailablePermissions(),
      current: this.storeRolesService.getRolePermissions(this.role.id),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ available, current }) => {
          this.allPermissions = available;
          this.permissionGroups = this.groupPermissions(available);

          // Set current permissions
          this.selectedPermissionIds = new Set(current.permission_ids || []);
          this.originalPermissionIds = new Set(current.permission_ids || []);

          this.isLoadingPermissions = false;
        },
        error: (error) => {
          console.error('Error loading permissions:', error);
          this.isLoadingPermissions = false;
          this.toastService.error('Error al cargar los permisos');
        },
      });
  }

  private groupPermissions(permissions: StorePermission[]): PermissionGroup[] {
    const groups = new Map<string, StorePermission[]>();

    for (const perm of permissions) {
      // Extract module from permission name: "store:products:create" -> "products"
      const parts = perm.name.split(':');
      const module = parts.length >= 2 ? parts[1] : (perm.module || 'general');

      if (!groups.has(module)) {
        groups.set(module, []);
      }
      groups.get(module)!.push(perm);
    }

    return Array.from(groups.entries())
      .map(([module, perms]) => ({ module, permissions: perms }))
      .sort((a, b) => a.module.localeCompare(b.module));
  }

  isGroupFullySelected(group: PermissionGroup): boolean {
    return group.permissions.every((p) => this.selectedPermissionIds.has(p.id));
  }

  toggleGroup(group: PermissionGroup, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    for (const perm of group.permissions) {
      if (checked) {
        this.selectedPermissionIds.add(perm.id);
      } else {
        this.selectedPermissionIds.delete(perm.id);
      }
    }
    // Force reference change for change detection
    this.selectedPermissionIds = new Set(this.selectedPermissionIds);
  }

  togglePermission(permissionId: number): void {
    if (this.selectedPermissionIds.has(permissionId)) {
      this.selectedPermissionIds.delete(permissionId);
    } else {
      this.selectedPermissionIds.add(permissionId);
    }
    // Force reference change for change detection
    this.selectedPermissionIds = new Set(this.selectedPermissionIds);
  }

  onSave(): void {
    if (!this.role || this.isSaving) return;

    // Calculate diff
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

    // Nothing changed
    if (toAdd.length === 0 && toRemove.length === 0) {
      this.toastService.success('No hay cambios en los permisos');
      this.isOpenChange.emit(false);
      return;
    }

    this.isSaving = true;
    const operations: any[] = [];

    if (toAdd.length > 0) {
      operations.push(this.storeRolesService.assignPermissions(this.role.id, toAdd));
    }
    if (toRemove.length > 0) {
      operations.push(this.storeRolesService.removePermissions(this.role.id, toRemove));
    }

    forkJoin(operations)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.toastService.success('Permisos actualizados exitosamente');
          this.onPermissionsUpdated.emit();
          this.isOpenChange.emit(false);
        },
        error: (error: any) => {
          this.isSaving = false;
          console.error('Error updating permissions:', error);
          const message =
            error?.error?.message || 'Error al actualizar los permisos';
          this.toastService.error(message);
        },
      });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }
}
