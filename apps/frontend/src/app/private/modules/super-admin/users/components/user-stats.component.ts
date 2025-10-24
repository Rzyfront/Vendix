import { Component, Input, OnInit } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/index';
import { UserStats } from '../interfaces/user.interface';

@Component({
  selector: 'app-user-stats',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total Users -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Usuarios</p>
            <p class="text-2xl font-bold mt-1 text-text-primary">{{ stats?.total || 0 }}</p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10">
            <app-icon name="users" [size]="24" class="text-primary"></app-icon>
          </div>
        </div>
      </div>

      <!-- Active Users -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Activos</p>
            <p class="text-2xl font-bold mt-1 text-green-600">{{ stats?.active || 0 }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(stats?.active || 0, stats?.total || 0) }}% del total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100">
            <app-icon name="check-circle" [size]="24" class="text-green-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Pending Verification -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Pendientes</p>
            <p class="text-2xl font-bold mt-1 text-yellow-600">{{ stats?.pending_verification || 0 }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(stats?.pending_verification || 0, stats?.total || 0) }}% del total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100">
            <app-icon name="clock" [size]="24" class="text-yellow-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- With 2FA -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Con 2FA</p>
            <p class="text-2xl font-bold mt-1 text-purple-600">{{ stats?.with_2fa || 0 }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(stats?.with_2fa || 0, stats?.total || 0) }}% del total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-100">
            <app-icon name="shield" [size]="24" class="text-purple-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Inactive -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Inactivos</p>
            <p class="text-2xl font-bold mt-1 text-gray-600">{{ stats?.inactive || 0 }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(stats?.inactive || 0, stats?.total || 0) }}% del total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-gray-100">
            <app-icon name="user-x" [size]="24" class="text-gray-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Suspended -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Suspendidos</p>
            <p class="text-2xl font-bold mt-1 text-red-600">{{ stats?.suspended || 0 }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(stats?.suspended || 0, stats?.total || 0) }}% del total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-red-100">
            <app-icon name="alert-triangle" [size]="24" class="text-red-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Verified Emails -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Email Verificado</p>
            <p class="text-2xl font-bold mt-1 text-emerald-600">{{ stats?.verified || 0 }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculatePercentage(stats?.verified || 0, stats?.total || 0) }}% del total
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-emerald-100">
            <app-icon name="mail-check" [size]="24" class="text-emerald-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Organizations -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Organizaciones</p>
            <p class="text-2xl font-bold mt-1 text-indigo-600">{{ stats?.organizations || 0 }}</p>
            <p class="text-xs text-text-secondary mt-1">
              {{ calculateAverageUsersPerOrg(stats?.total || 0, stats?.organizations || 0) }} usuarios por org
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center bg-indigo-100">
            <app-icon name="building" [size]="24" class="text-indigo-600"></app-icon>
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
export class UserStatsComponent implements OnInit {
  @Input() stats: UserStats | null = null;

  constructor() {}

  ngOnInit(): void {}

  calculatePercentage(part: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
  }

  calculateAverageUsersPerOrg(totalUsers: number, totalOrgs: number): string {
    if (totalOrgs === 0) return '0';
    const average = totalUsers / totalOrgs;
    return average.toFixed(1);
  }
}