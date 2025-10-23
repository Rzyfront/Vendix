import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-organization-stats',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <!-- Total Organizations -->
      <div class="bg-white p-4 rounded-lg border border-border">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Organizations</p>
            <p class="text-2xl font-bold mt-1 text-text-primary">{{ stats.total }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10">
            <i class="fas fa-building text-primary text-xl"></i>
          </div>
        </div>
      </div>

      <!-- Active Organizations -->
      <div class="bg-white p-4 rounded-lg border border-border">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Active</p>
            <p class="text-2xl font-bold mt-1 text-green-600">{{ stats.active }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100">
            <i class="fas fa-check-circle text-green-600 text-xl"></i>
          </div>
        </div>
      </div>

      <!-- Inactive Organizations -->
      <div class="bg-white p-4 rounded-lg border border-border">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Inactive</p>
            <p class="text-2xl font-bold mt-1 text-yellow-600">{{ stats.inactive }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100">
            <i class="fas fa-pause-circle text-yellow-600 text-xl"></i>
          </div>
        </div>
      </div>

      <!-- Suspended Organizations -->
      <div class="bg-white p-4 rounded-lg border border-border">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Suspended</p>
            <p class="text-2xl font-bold mt-1 text-red-600">{{ stats.suspended }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-red-100">
            <i class="fas fa-ban text-red-600 text-xl"></i>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class OrganizationStatsComponent {
  @Input() stats = {
    total: 0,
    active: 0,
    inactive: 0,
    suspended: 0
  };
}