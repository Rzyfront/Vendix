import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsComponent } from '../../../../../shared/components/index';
import {
  AuditStats,
  AuditAction,
  AuditResource,
} from '../interfaces/audit.interface';

@Component({
  selector: 'app-audit-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6">
      <app-stats
        title="Total Logs"
        [value]="stats?.total_logs || 0"
        iconName="list"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>

      <app-stats
        title="Creaciones"
        [value]="getActionCount('CREATE')"
        [smallText]="
          calculatePercentage(
            getActionCount('CREATE'),
            stats?.total_logs || 0
          ) + '% del total'
        "
        iconName="plus"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Actualizaciones"
        [value]="getActionCount('UPDATE')"
        [smallText]="
          calculatePercentage(
            getActionCount('UPDATE'),
            stats?.total_logs || 0
          ) + '% del total'
        "
        iconName="edit"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Eliminaciones"
        [value]="getActionCount('DELETE')"
        [smallText]="
          calculatePercentage(
            getActionCount('DELETE'),
            stats?.total_logs || 0
          ) + '% del total'
        "
        iconName="trash-2"
        iconBgColor="bg-red-100"
        iconColor="text-red-600"
      ></app-stats>

      <app-stats
        title="Logins"
        [value]="getActionCount('LOGIN')"
        [smallText]="
          calculatePercentage(getActionCount('LOGIN'), stats?.total_logs || 0) +
          '% del total'
        "
        iconName="log-in"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
      ></app-stats>

      <app-stats
        title="Logouts"
        [value]="getActionCount('LOGOUT')"
        [smallText]="
          calculatePercentage(
            getActionCount('LOGOUT'),
            stats?.total_logs || 0
          ) + '% del total'
        "
        iconName="log-out"
        iconBgColor="bg-gray-100"
        iconColor="text-gray-600"
      ></app-stats>

      <app-stats
        title="Lecturas"
        [value]="getActionCount('READ')"
        [smallText]="
          calculatePercentage(getActionCount('READ'), stats?.total_logs || 0) +
          '% del total'
        "
        iconName="eye"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Recurso Más Activo"
        [value]="getTopResource()?.name || 'N/A'"
        [smallText]="(getTopResource()?.count || 0) + ' acciones'"
        iconName="database"
        iconBgColor="bg-indigo-100"
        iconColor="text-indigo-600"
      ></app-stats>
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

  constructor() { }

  ngOnInit(): void { }

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
