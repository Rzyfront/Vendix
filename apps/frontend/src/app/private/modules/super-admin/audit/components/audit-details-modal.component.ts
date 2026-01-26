import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuditLog } from '../interfaces/audit.interface';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-audit-details-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  styles: [
    `
      .audit-details-container {
        display: flex;
        flex-direction: column;
        gap: var(--radius-lg);
        padding: var(--control-padding);
      }

      .audit-section {
        background-color: var(--color-background);
        border: var(--border-width) solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
        box-shadow: var(--shadow-sm);
        transition: all var(--transition-fast) ease;
      }

      .audit-section:hover {
        box-shadow: var(--shadow-md);
        transform: translateY(-1px);
      }

      .audit-section-header {
        display: flex;
        align-items: center;
        gap: var(--radius-sm);
        padding: var(--control-padding);
        background-color: var(--color-muted);
        border-bottom: var(--border-width) solid var(--color-border);
      }

      .audit-section-icon {
        color: var(--color-primary);
        flex-shrink: 0;
      }

      .audit-section-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .audit-section-content {
        padding: var(--control-padding);
      }

      .audit-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--radius-md);
      }

      .audit-field {
        display: flex;
        flex-direction: column;
        gap: calc(var(--radius-sm) / 2);
      }

      .audit-field-label {
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
        margin: 0;
      }

      .audit-field-value {
        font-size: var(--fs-sm);
        color: var(--color-text-primary);
        font-family: var(--font-primary);
        line-height: 1.5;
        word-break: break-word;
      }

      .audit-field-code {
        font-family:
          'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Source Code Pro',
          monospace;
        background-color: var(--color-muted);
        padding: calc(var(--radius-sm) / 2) var(--radius-sm);
        border-radius: var(--radius-sm);
        border: var(--border-width) solid var(--color-border);
        font-size: var(--fs-xs);
      }

      .audit-field-small {
        font-size: var(--fs-xs);
        line-height: 1.4;
        word-break: break-all;
      }

      .audit-action-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: calc(var(--radius-sm) / 2) var(--radius-md);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        border-radius: var(--radius-pill);
        border: var(--border-width) solid;
        transition: all var(--transition-fast) ease;
        min-width: 80px;
        text-align: center;
      }

      .audit-action-badge:hover {
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm);
      }

      .audit-action-badge.create {
        background-color: rgba(34, 197, 94, 0.1);
        color: #15803d;
        border-color: rgba(34, 197, 94, 0.3);
      }

      .audit-action-badge.update {
        background-color: rgba(59, 130, 246, 0.1);
        color: #1e40af;
        border-color: rgba(59, 130, 246, 0.3);
      }

      .audit-action-badge.delete {
        background-color: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
        border-color: rgba(239, 68, 68, 0.3);
      }

      .audit-action-badge.login {
        background-color: rgba(16, 185, 129, 0.1);
        color: #047857;
        border-color: rgba(16, 185, 129, 0.3);
      }

      .audit-action-badge.logout {
        background-color: rgba(107, 114, 128, 0.1);
        color: #374151;
        border-color: rgba(107, 114, 128, 0.3);
      }

      .audit-action-badge.read {
        background-color: rgba(245, 158, 11, 0.1);
        color: #b45309;
        border-color: rgba(245, 158, 11, 0.3);
      }

      .audit-action-badge.permission_change {
        background-color: rgba(139, 92, 246, 0.1);
        color: #6d28d9;
        border-color: rgba(139, 92, 246, 0.3);
      }

      .audit-data-change {
        margin-bottom: var(--radius-md);
      }

      .audit-data-change:last-child {
        margin-bottom: 0;
      }

      .audit-data-title {
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
        margin: 0 0 var(--radius-sm) 0;
      }

      .audit-data-content {
        background-color: var(--color-muted);
        border: var(--border-width) solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--control-padding);
        font-family:
          'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Source Code Pro',
          monospace;
        font-size: var(--fs-xs);
        line-height: 1.5;
        color: var(--color-text-primary);
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        max-height: 200px;
        overflow-y: auto;
      }

      .audit-data-content::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }

      .audit-data-content::-webkit-scrollbar-track {
        background: var(--color-background);
        border-radius: var(--radius-sm);
      }

      .audit-data-content::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: var(--radius-sm);
      }

      .audit-data-content::-webkit-scrollbar-thumb:hover {
        background: var(--color-text-secondary);
      }

      .audit-modal-footer {
        display: flex;
        justify-content: flex-end;
        padding: var(--control-padding);
        background-color: var(--color-background);
        border-top: var(--border-width) solid var(--color-border);
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .audit-details-container {
          padding: calc(var(--control-padding) / 2);
          gap: var(--radius-md);
        }

        .audit-grid {
          grid-template-columns: 1fr;
          gap: calc(var(--radius-sm) / 2);
        }

        .audit-section-header {
          padding: calc(var(--control-padding) / 2);
        }

        .audit-section-content {
          padding: calc(var(--control-padding) / 2);
        }

        .audit-field {
          gap: calc(var(--radius-sm) / 4);
        }

        .audit-data-content {
          max-height: 150px;
          font-size: 10px;
        }
      }

      /* Dark theme adjustments */
      [data-theme='dark'] .audit-action-badge.create {
        background-color: rgba(34, 197, 94, 0.15);
        color: #4ade80;
        border-color: rgba(34, 197, 94, 0.3);
      }

      [data-theme='dark'] .audit-action-badge.update {
        background-color: rgba(59, 130, 246, 0.15);
        color: #60a5fa;
        border-color: rgba(59, 130, 246, 0.3);
      }

      [data-theme='dark'] .audit-action-badge.delete {
        background-color: rgba(239, 68, 68, 0.15);
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.3);
      }

      [data-theme='dark'] .audit-action-badge.login {
        background-color: rgba(16, 185, 129, 0.15);
        color: #34d399;
        border-color: rgba(16, 185, 129, 0.3);
      }

      [data-theme='dark'] .audit-action-badge.logout {
        background-color: rgba(107, 114, 128, 0.15);
        color: #9ca3af;
        border-color: rgba(107, 114, 128, 0.3);
      }

      [data-theme='dark'] .audit-action-badge.read {
        background-color: rgba(245, 158, 11, 0.15);
        color: #fbbf24;
        border-color: rgba(245, 158, 11, 0.3);
      }

      [data-theme='dark'] .audit-action-badge.permission_change {
        background-color: rgba(139, 92, 246, 0.15);
        color: #a78bfa;
        border-color: rgba(139, 92, 246, 0.3);
      }
    `,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Detalles del Log de Auditoría"
      subtitle="Visualiza la información completa del registro de auditoría"
    >
      <div class="audit-details-container" *ngIf="log">
        <!-- Información General -->
        <div class="audit-section">
          <div class="audit-section-header">
            <app-icon
              name="info"
              [size]="18"
              class="audit-section-icon"
            ></app-icon>
            <h4 class="audit-section-title">Información General</h4>
          </div>
          <div class="audit-section-content">
            <div class="audit-grid">
              <div class="audit-field">
                <label class="audit-field-label">Usuario</label>
                <div class="audit-field-value">
                  {{
                    log.users
                      ? log.users.first_name + ' ' + log.users.last_name
                      : 'N/A'
                  }}
                </div>
              </div>
              <div class="audit-field">
                <label class="audit-field-label">Email</label>
                <div class="audit-field-value">
                  {{ log.users?.email || 'N/A' }}
                </div>
              </div>
              <div class="audit-field">
                <label class="audit-field-label">Acción</label>
                <div class="audit-field-value">
                  <span
                    class="audit-action-badge"
                    [ngClass]="getActionBadgeClass(log.action)"
                  >
                    {{ getActionDisplay(log.action).text }}
                  </span>
                </div>
              </div>
              <div class="audit-field">
                <label class="audit-field-label">Recurso</label>
                <div class="audit-field-value">
                  {{ getResourceDisplay(log.resource) }}
                </div>
              </div>
              <div class="audit-field">
                <label class="audit-field-label">ID Recurso</label>
                <div class="audit-field-value">
                  {{ log.resource_id || 'N/A' }}
                </div>
              </div>
              <div class="audit-field">
                <label class="audit-field-label">Fecha</label>
                <div class="audit-field-value">
                  {{ formatDate(log.created_at) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Información de Organización y Tienda -->
        <div class="audit-section">
          <div class="audit-section-header">
            <app-icon
              name="building"
              [size]="18"
              class="audit-section-icon"
            ></app-icon>
            <h4 class="audit-section-title">Organización y Tienda</h4>
          </div>
          <div class="audit-section-content">
            <div class="audit-grid">
              <div class="audit-field">
                <label class="audit-field-label">Organización</label>
                <div class="audit-field-value">
                  {{
                    log.users && log.users.organization_id
                      ? 'Org ' + log.users.organization_id
                      : 'N/A'
                  }}
                </div>
              </div>
              <div class="audit-field">
                <label class="audit-field-label">Tienda</label>
                <div class="audit-field-value">
                  {{ log.stores?.name || 'N/A' }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Información Técnica -->
        <div class="audit-section">
          <div class="audit-section-header">
            <app-icon
              name="server"
              [size]="18"
              class="audit-section-icon"
            ></app-icon>
            <h4 class="audit-section-title">Información Técnica</h4>
          </div>
          <div class="audit-section-content">
            <div class="audit-grid">
              <div class="audit-field">
                <label class="audit-field-label">Dirección IP</label>
                <div class="audit-field-value audit-field-code">
                  {{ log.ip_address || 'N/A' }}
                </div>
              </div>
              <div class="audit-field">
                <label class="audit-field-label">User Agent</label>
                <div class="audit-field-value audit-field-small">
                  {{ log.user_agent || 'N/A' }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Cambios de Datos -->
        <div *ngIf="log.old_values || log.new_values" class="audit-section">
          <div class="audit-section-header">
            <app-icon
              name="git-branch"
              [size]="18"
              class="audit-section-icon"
            ></app-icon>
            <h4 class="audit-section-title">Cambios de Datos</h4>
          </div>
          <div class="audit-section-content">
            <!-- Valores Anteriores -->
            <div *ngIf="log.old_values" class="audit-data-change">
              <h5 class="audit-data-title">Valores Anteriores</h5>
              <pre class="audit-data-content">{{ log.old_values | json }}</pre>
            </div>

            <!-- Valores Nuevos -->
            <div *ngIf="log.new_values" class="audit-data-change">
              <h5 class="audit-data-title">Valores Nuevos</h5>
              <pre class="audit-data-content">{{ log.new_values | json }}</pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer" class="audit-modal-footer">
        <app-button variant="primary" (clicked)="onCancel()">
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class AuditDetailsModalComponent {
  @Input() isOpen = false;
  @Input() log: AuditLog | null = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() cancel = new EventEmitter<void>();

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  getActionDisplay(action: string): { text: string; class: string } {
    const actionMap: Record<string, string> = {
      CREATE: 'Crear',
      UPDATE: 'Actualizar',
      DELETE: 'Eliminar',
      LOGIN: 'Login',
      LOGOUT: 'Logout',
      READ: 'Lectura',
      PERMISSION_CHANGE: 'Cambio Permisos',
    };
    return {
      text: actionMap[action] || action,
      class: '',
    };
  }

  getActionBadgeClass(action: string): string {
    const actionClassMap: Record<string, string> = {
      CREATE: 'create',
      UPDATE: 'update',
      DELETE: 'delete',
      LOGIN: 'login',
      LOGOUT: 'logout',
      READ: 'read',
      PERMISSION_CHANGE: 'permission_change',
    };
    return actionClassMap[action] || '';
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
      second: '2-digit',
    });
  }
}
