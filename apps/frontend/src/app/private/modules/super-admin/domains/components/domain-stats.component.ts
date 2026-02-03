import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomainStats } from '../interfaces/domain.interface';
import { StatsComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-domain-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="space-y-6">
      <!-- Primary Stats - Total and Status -->
      <div class="stats-container">
        <app-stats
          title="Total Domains"
          [value]="stats.totalDomains || 0"
          iconName="globe-2"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>

        <app-stats
          title="Active"
          [value]="stats.activeDomains || 0"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Pending"
          [value]="stats.pendingDomains || 0"
          iconName="clock"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>

        <app-stats
          title="Verified"
          [value]="stats.verifiedDomains || 0"
          iconName="shield-check"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <!-- Ownership Stats -->
      <div class="stats-container">
        <app-stats
          title="Platform Subdomains"
          [value]="stats.vendixSubdomains || stats.primaryDomains || 0"
          iconName="globe-2"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>

        <app-stats
          title="Custom Domains"
          [value]="stats.customerCustomDomains || stats.customerDomains || 0"
          iconName="link-2"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Client Subdomains"
          [value]="stats.customerSubdomains || stats.aliasDomains || 0"
          iconName="database"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
        ></app-stats>

        <app-stats
          title="Alias Domains"
          [value]="stats.aliasDomains || 0"
          iconName="link-2"
          iconBgColor="bg-orange-100"
          iconColor="text-orange-600"
        ></app-stats>
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
export class DomainStatsComponent {
  @Input({ required: true }) stats!: DomainStats;
}
