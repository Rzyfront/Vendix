import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoleStats } from '../interfaces/role.interface';
import { StatsComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-role-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-6">
      <app-stats
        title="Total Roles"
        [value]="stats.total_roles"
        iconName="users"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>

      <app-stats
        title="System Roles"
        [value]="stats.system_roles"
        iconName="shield"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
      ></app-stats>

      <app-stats
        title="Custom Roles"
        [value]="stats.custom_roles"
        iconName="settings"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Total Permissions"
        [value]="stats.total_permissions"
        iconName="key"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
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
export class RoleStatsComponent {
  @Input() stats: RoleStats = {
    total_roles: 0,
    system_roles: 0,
    custom_roles: 0,
    total_permissions: 0,
  };
}
