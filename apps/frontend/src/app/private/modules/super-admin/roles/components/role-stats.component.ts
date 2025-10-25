import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoleStats } from '../interfaces/role.interface';
import { IconComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-role-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <!-- Total Roles -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Roles</p>
            <p class="text-2xl font-bold mt-1 text-text-primary">{{ stats.total_roles }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10">
            <app-icon name="users" [size]="24" class="text-primary"></app-icon>
          </div>
        </div>
      </div>

      <!-- System Roles -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">System Roles</p>
            <p class="text-2xl font-bold mt-1 text-purple-600">{{ stats.system_roles }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-100">
            <app-icon name="shield" [size]="24" class="text-purple-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Custom Roles -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Custom Roles</p>
            <p class="text-2xl font-bold mt-1 text-green-600">{{ stats.custom_roles }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100">
            <app-icon name="settings" [size]="24" class="text-green-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Total Permissions -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Permissions</p>
            <p class="text-2xl font-bold mt-1 text-yellow-600">{{ stats.total_permissions }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100">
            <app-icon name="key" [size]="24" class="text-yellow-600"></app-icon>
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
export class RoleStatsComponent {
  @Input() stats: RoleStats = {
    total_roles: 0,
    system_roles: 0,
    custom_roles: 0,
    total_permissions: 0
  };
}