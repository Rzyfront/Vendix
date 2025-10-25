import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { Role } from '../../interfaces/role.interface';

@Component({
  selector: 'app-role-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total Roles -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Roles</p>
            <p class="text-2xl font-bold mt-1 text-text-primary">{{ totalRoles }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10">
            <app-icon name="shield" [size]="24" class="text-primary"></app-icon>
          </div>
        </div>
      </div>

      <!-- System Roles -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">System Roles</p>
            <p class="text-2xl font-bold mt-1 text-blue-600">{{ systemRoles }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(systemRoles, totalRoles) }}% of total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-100">
            <app-icon name="shield-check" [size]="24" class="text-blue-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Custom Roles -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Custom Roles</p>
            <p class="text-2xl font-bold mt-1 text-green-600">{{ customRoles }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(customRoles, totalRoles) }}% of total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100">
            <app-icon name="users" [size]="24" class="text-green-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Average Users per Role -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Avg Users/Role</p>
            <p class="text-2xl font-bold mt-1 text-purple-600">{{ averageUsersPerRole }}</p>
            <p class="text-xs text-text-secondary mt-1">
              Total: {{ totalUsers }} users
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-100">
            <app-icon name="users-2" [size]="24" class="text-purple-600"></app-icon>
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
export class RoleStatsComponent implements OnChanges {
  @Input() roles: Role[] = [];

  totalRoles = 0;
  systemRoles = 0;
  customRoles = 0;
  totalUsers = 0;
  averageUsersPerRole = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roles']) {
      this.calculateStats();
    }
  }

  private calculateStats(): void {
    this.totalRoles = this.roles.length;
    this.systemRoles = this.roles.filter(role => role.is_system_role).length;
    this.customRoles = this.roles.filter(role => !role.is_system_role).length;
    
    // Calcular total de usuarios (sumando todos los usuarios de todos los roles)
    this.totalUsers = this.roles.reduce((total, role) => {
      return total + (role._count?.user_roles || 0);
    }, 0);
    
    // Calcular promedio de usuarios por rol
    this.averageUsersPerRole = this.totalRoles > 0 ? Math.round(this.totalUsers / this.totalRoles) : 0;
  }

  getRoleDistribution(): { name: string; value: number; percentage: number }[] {
    const distribution = [
      { name: 'Roles del Sistema', value: this.systemRoles, percentage: 0 },
      { name: 'Roles Personalizados', value: this.customRoles, percentage: 0 }
    ];

    if (this.totalRoles > 0) {
      distribution[0].percentage = Math.round((this.systemRoles / this.totalRoles) * 100);
      distribution[1].percentage = Math.round((this.customRoles / this.totalRoles) * 100);
    }

    return distribution;
  }

  getMostUsedRoles(): { name: string; users: number }[] {
    return this.roles
      .filter(role => (role._count?.user_roles || 0) > 0)
      .sort((a, b) => (b._count?.user_roles || 0) - (a._count?.user_roles || 0))
      .slice(0, 5)
      .map(role => ({
        name: role.name,
        users: role._count?.user_roles || 0
      }));
  }

  getUnusedRoles(): Role[] {
    return this.roles.filter(role => (role._count?.user_roles || 0) === 0);
  }

  calculatePercentage(part: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
  }
}