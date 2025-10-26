import { Component, Input, OnInit } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/index';
import {
  AuditStats,
  AuditAction,
  AuditResource,
} from '../interfaces/audit.interface';

@Component({
  selector: 'app-audit-stats',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total Logs -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Logs</p>
            <p class="text-2xl font-bold mt-1 text-text-primary">
              {{ stats?.total_logs || 0 }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10"
          >
            <app-icon
              name="file-text"
              [size]="24"
              class="text-primary"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Create Actions -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Creaciones</p>
            <p class="text-2xl font-bold mt-1 text-green-600">
              {{ getActionCount('CREATE') }}
            </p>
            <p class="text-xs text-text-secondary mt-1">
              {{
                calculatePercentage(
                  getActionCount('CREATE'),
                  stats?.total_logs || 0
                )
              }}% del total
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
          >
            <app-icon
              name="plus-circle"
              [size]="24"
              class="text-green-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Update Actions -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">
              Actualizaciones
            </p>
            <p class="text-2xl font-bold mt-1 text-blue-600">
              {{ getActionCount('UPDATE') }}
            </p>
            <p class="text-xs text-text-secondary mt-1">
              {{
                calculatePercentage(
                  getActionCount('UPDATE'),
                  stats?.total_logs || 0
                )
              }}% del total
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-100"
          >
            <app-icon name="edit" [size]="24" class="text-blue-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Delete Actions -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Eliminaciones</p>
            <p class="text-2xl font-bold mt-1 text-red-600">
              {{ getActionCount('DELETE') }}
            </p>
            <p class="text-xs text-text-secondary mt-1">
              {{
                calculatePercentage(
                  getActionCount('DELETE'),
                  stats?.total_logs || 0
                )
              }}% del total
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-red-100"
          >
            <app-icon
              name="trash-2"
              [size]="24"
              class="text-red-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Login Actions -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Logins</p>
            <p class="text-2xl font-bold mt-1 text-purple-600">
              {{ getActionCount('LOGIN') }}
            </p>
            <p class="text-xs text-text-secondary mt-1">
              {{
                calculatePercentage(
                  getActionCount('LOGIN'),
                  stats?.total_logs || 0
                )
              }}% del total
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-100"
          >
            <app-icon
              name="log-in"
              [size]="24"
              class="text-purple-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Logout Actions -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Logouts</p>
            <p class="text-2xl font-bold mt-1 text-gray-600">
              {{ getActionCount('LOGOUT') }}
            </p>
            <p class="text-xs text-text-secondary mt-1">
              {{
                calculatePercentage(
                  getActionCount('LOGOUT'),
                  stats?.total_logs || 0
                )
              }}% del total
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-gray-100"
          >
            <app-icon
              name="log-out"
              [size]="24"
              class="text-gray-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Read Actions -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Lecturas</p>
            <p class="text-2xl font-bold mt-1 text-yellow-600">
              {{ getActionCount('READ') }}
            </p>
            <p class="text-xs text-text-secondary mt-1">
              {{
                calculatePercentage(
                  getActionCount('READ'),
                  stats?.total_logs || 0
                )
              }}% del total
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100"
          >
            <app-icon name="eye" [size]="24" class="text-yellow-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Top Resource -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">
              Recurso Más Activo
            </p>
            <p class="text-lg font-bold mt-1 text-text-primary truncate">
              {{ getTopResource()?.name || 'N/A' }}
            </p>
            <p class="text-xs text-text-secondary mt-1">
              {{ getTopResource()?.count || 0 }} acciones
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-indigo-100"
          >
            <app-icon
              name="database"
              [size]="24"
              class="text-indigo-600"
            ></app-icon>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class AuditStatsComponent implements OnInit {
  @Input() stats: AuditStats | null = null;

  constructor() {}

  ngOnInit(): void {}

  getActionCount(action: string): number {
    return this.stats?.logs_by_action?.[action as AuditAction] || 0;
  }

  getTopResource(): { name: string; count: number } | null {
    if (!this.stats?.logs_by_resource) return null;

    const resources = Object.entries(this.stats.logs_by_resource);
    if (resources.length === 0) return null;

    const [resource, count] = resources.reduce((max, current) =>
      current[1] > max[1] ? current : max,
    );

    return {
      name: this.getResourceDisplay(resource as AuditResource),
      count: count,
    };
  }

  getResourceDisplay(resource: AuditResource): string {
    const resourceMap: Record<AuditResource, string> = {
      [AuditResource.USERS]: 'Usuarios',
      [AuditResource.ORGANIZATIONS]: 'Organizaciones',
      [AuditResource.STORES]: 'Tiendas',
      [AuditResource.ROLES]: 'Roles',
      [AuditResource.PERMISSIONS]: 'Permisos',
      [AuditResource.PRODUCTS]: 'Productos',
      [AuditResource.ORDERS]: 'Órdenes',
      [AuditResource.CATEGORIES]: 'Categorías',
    };
    return resourceMap[resource] || resource;
  }

  calculatePercentage(part: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
  }
}
