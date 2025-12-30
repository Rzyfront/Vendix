import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { StatsComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-organization-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6">
      <app-stats
        title="Total Organizations"
        [value]="stats.total"
        iconName="building"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>

      <app-stats
        title="Active"
        [value]="stats.active"
        iconName="check"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Inactive"
        [value]="stats.inactive"
        iconName="warning"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Suspended"
        [value]="stats.suspended"
        iconName="close"
        iconBgColor="bg-red-100"
        iconColor="text-red-600"
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
export class OrganizationStatsComponent {
  @Input() stats = {
    total: 0,
    active: 0,
    inactive: 0,
    suspended: 0,
  };
}
