import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuditLog } from '../interfaces/audit.interface';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-audit-details-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Detalles del Log de Auditoría"
      subtitle="Visualiza la información completa del registro de auditoría"
    >
      @if (log(); as auditLog) {
        <div class="flex flex-col gap-6 p-1">
          <!-- Información General -->
          <div class="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
            <div class="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
              <app-icon name="info" [size]="18" class="text-primary"></app-icon>
              <h4 class="text-sm font-semibold text-text-primary">Información General</h4>
            </div>
            <div class="p-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-text-secondary">Usuario</span>
                  <span class="text-sm text-text-primary">{{ auditLog.users ? auditLog.users.first_name + ' ' + auditLog.users.last_name : 'Sistema' }}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-text-secondary">Email</span>
                  <span class="text-sm text-text-primary truncate" [title]="auditLog.users?.email">{{ auditLog.users?.email || 'N/A' }}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-text-secondary">Acción</span>
                  <div>
                    <span [class]="'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ' + getBadgeClasses(auditLog.action)">
                      {{ getActionDisplay(auditLog.action) }}
                    </span>
                  </div>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-text-secondary">Recurso</span>
                  <span class="text-sm text-text-primary">{{ getResourceDisplay(auditLog.resource) }}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-text-secondary">ID Recurso</span>
                  <span class="text-sm font-mono text-text-primary">{{ auditLog.resource_id || 'N/A' }}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-text-secondary">Fecha</span>
                  <span class="text-sm text-text-primary">{{ formatDate(auditLog.created_at) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Información Técnica -->
          <div class="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
            <div class="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
              <app-icon name="server" [size]="18" class="text-primary"></app-icon>
              <h4 class="text-sm font-semibold text-text-primary">Información Técnica</h4>
            </div>
            <div class="p-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-text-secondary">Dirección IP</span>
                  <span class="text-sm font-mono text-text-primary">{{ auditLog.ip_address || 'N/A' }}</span>
                </div>
                <div class="flex flex-col gap-1 truncate">
                  <span class="text-xs font-medium text-text-secondary">User Agent</span>
                  <span class="text-xs text-text-secondary italic" [title]="auditLog.user_agent">{{ auditLog.user_agent || 'N/A' }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Cambios de Datos -->
          @if (auditLog.old_values || auditLog.new_values) {
            <div class="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
              <div class="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
                <app-icon name="git-branch" [size]="18" class="text-primary"></app-icon>
                <h4 class="text-sm font-semibold text-text-primary">Cambios de Datos</h4>
              </div>
              <div class="p-4 flex flex-col gap-4">
                @if (auditLog.old_values) {
                  <div>
                    <h5 class="text-xs font-medium text-red-600 mb-2 uppercase tracking-wider">Valores Anteriores</h5>
                    <pre class="text-[10px] font-mono bg-red-50/50 border border-red-100 p-3 rounded-lg overflow-auto max-h-[150px] text-text-primary">{{ auditLog.old_values | json }}</pre>
                  </div>
                }
                @if (auditLog.new_values) {
                  <div>
                    <h5 class="text-xs font-medium text-green-600 mb-2 uppercase tracking-wider">Valores Nuevos</h5>
                    <pre class="text-[10px] font-mono bg-green-50/50 border border-green-100 p-3 rounded-lg overflow-auto max-h-[150px] text-text-primary">{{ auditLog.new_values | json }}</pre>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- Footer -->
      <div slot="footer" class="flex justify-end p-4 bg-surface border-t border-border">
        <app-button variant="primary" (clicked)="onCancel()">
          Cerrar
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
export class AuditDetailsModalComponent {
  isOpen = input<boolean>(false);
  log = input<AuditLog | null>(null);

  isOpenChange = output<boolean>();
  cancel = output<void>();

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  getBadgeClasses(action: string): string {
    const base = '';
    switch (action) {
      case 'CREATE': return 'bg-green-50 text-green-700 border-green-200';
      case 'UPDATE': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'DELETE': return 'bg-red-50 text-red-700 border-red-200';
      case 'LOGIN': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'LOGOUT': return 'bg-gray-50 text-gray-700 border-gray-200';
      case 'READ': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'PERMISSION_CHANGE': return 'bg-purple-50 text-purple-700 border-purple-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  }

  getActionDisplay(action: string): string {
    const actionMap: Record<string, string> = {
      CREATE: 'Crear',
      UPDATE: 'Actualizar',
      DELETE: 'Eliminar',
      LOGIN: 'Login',
      LOGOUT: 'Logout',
      READ: 'Lectura',
      PERMISSION_CHANGE: 'Cambio Permisos',
    };
    return actionMap[action] || action;
  }

  getResourceDisplay(resource: string): string {
    const resourceMap: Record<string, string> = {
      users: 'Usuarios',
      organizations: 'Organizaciones',
      stores: 'Tiendas',
      roles: 'Roles',
      permissions: 'Permisos',
      products: 'Productos',
      orders: 'Órdenes',
      categories: 'Categorías',
    };
    return resourceMap[resource] || resource;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
