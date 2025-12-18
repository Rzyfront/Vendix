import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { IconComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-organization-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <!-- Total Organizations -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">
              Total Organizations
            </p>
            <p class="text-2xl font-bold mt-1 text-text-primary">
              {{ stats.total }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10"
          >
            <app-icon
              name="building"
              [size]="24"
              class="text-primary"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Active Organizations -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Active</p>
            <p class="text-2xl font-bold mt-1 text-green-600">
              {{ stats.active }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
          >
            <app-icon
              name="check"
              [size]="24"
              class="text-green-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Inactive Organizations -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Inactive</p>
            <p class="text-2xl font-bold mt-1 text-yellow-600">
              {{ stats.inactive }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100"
          >
            <app-icon
              name="warning"
              [size]="24"
              class="text-yellow-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Suspended Organizations -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Suspended</p>
            <p class="text-2xl font-bold mt-1 text-red-600">
              {{ stats.suspended }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-red-100"
          >
            <app-icon name="close" [size]="24" class="text-red-600"></app-icon>
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
export class OrganizationStatsComponent {
  @Input() stats = {
    total: 0,
    active: 0,
    inactive: 0,
    suspended: 0,
  };
}
