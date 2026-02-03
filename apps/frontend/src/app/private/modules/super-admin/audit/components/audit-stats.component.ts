import { Component, input, computed } from '@angular/core';
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
    <div class="space-y-6">
      <div class="stats-container">
        <app-stats
          title="Total Registros"
          [value]="stats()?.total_logs || 0"
          iconName="list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Creaciones"
          [value]="getActionCount('CREATE')"
          [smallText]="calculatePercentage(getActionCount('CREATE')) + '% del total'"
          iconName="plus"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Actualizaciones"
          [value]="getActionCount('UPDATE')"
          [smallText]="calculatePercentage(getActionCount('UPDATE')) + '% del total'"
          iconName="edit"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
        ></app-stats>

        <app-stats
          title="Eliminaciones"
          [value]="getActionCount('DELETE')"
          [smallText]="calculatePercentage(getActionCount('DELETE')) + '% del total'"
          iconName="trash-2"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
      </div>

      @if (showExtendedStats()) {
        <div class="stats-container">
          <app-stats
            title="Sesiones (Login)"
            [value]="getActionCount('LOGIN')"
            iconName="log-in"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>

          <app-stats
            title="Lecturas"
            [value]="getActionCount('READ')"
            iconName="eye"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>

          <app-stats
            title="Recurso Top"
            [value]="topResourceName()"
            [smallText]="topResourceCount() + ' acciones'"
            iconName="database"
            iconBgColor="bg-gray-100"
            iconColor="text-gray-600"
          ></app-stats>

          <app-stats
            title="Fecha Logs"
            [value]="stats()?.logs_by_day?.length || 0"
            smallText="Días con actividad"
            iconName="calendar"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          ></app-stats>
        </div>
      }
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
export class AuditStatsComponent {
  stats = input<AuditStats | null>(null);
  showExtendedStats = input<boolean>(false);

  topResource = computed(() => {
    const s = this.stats();
    if (!s?.logs_by_resource) return null;

    const resources = Object.entries(s.logs_by_resource);
    if (resources.length === 0) return null;

    const [resource, count] = resources.reduce((max, current) =>
      current[1] > max[1] ? current : max,
    );

    return {
      name: this.getResourceDisplay(resource as AuditResource),
      count: count,
    };
  });

  topResourceName = computed(() => this.topResource()?.name || 'N/A');
  topResourceCount = computed(() => this.topResource()?.count || 0);

  getActionCount(action: string): number {
    return this.stats()?.logs_by_action?.[action as AuditAction] || 0;
  }

  calculatePercentage(part: number): number {
    const total = this.stats()?.total_logs || 0;
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
  }

  private getResourceDisplay(resource: AuditResource): string {
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
}
