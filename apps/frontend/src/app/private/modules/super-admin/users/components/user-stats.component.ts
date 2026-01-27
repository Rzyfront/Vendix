import { Component, input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsComponent } from '../../../../../shared/components/index';
import { UserStats } from '../interfaces/user.interface';

@Component({
  selector: 'app-user-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <app-stats
        title="Total Usuarios"
        [value]="stats()?.total_usuarios || 0"
        iconName="users"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>

      <app-stats
        title="Activos"
        [value]="stats()?.activos || 0"
        [smallText]="
          calculatePercentage(stats()?.activos || 0, stats()?.total_usuarios || 0) +
          '% del total'
        "
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Pendientes"
        [value]="stats()?.pendientes || 0"
        [smallText]="
          calculatePercentage(
            stats()?.pendientes || 0,
            stats()?.total_usuarios || 0
          ) + '% del total'
        "
        iconName="clock"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Con 2FA"
        [value]="stats()?.con_2fa || 0"
        [smallText]="
          calculatePercentage(stats()?.con_2fa || 0, stats()?.total_usuarios || 0) +
          '% del total'
        "
        iconName="shield"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
      ></app-stats>

      <app-stats
        title="Inactivos"
        [value]="stats()?.inactivos || 0"
        [smallText]="
          calculatePercentage(
            stats()?.inactivos || 0,
            stats()?.total_usuarios || 0
          ) + '% del total'
        "
        iconName="user-x"
        iconBgColor="bg-gray-100"
        iconColor="text-gray-600"
      ></app-stats>

      <app-stats
        title="Suspendidos"
        [value]="stats()?.suspendidos || 0"
        [smallText]="
          calculatePercentage(
            stats()?.suspendidos || 0,
            stats()?.total_usuarios || 0
          ) + '% del total'
        "
        iconName="alert-triangle"
        iconBgColor="bg-red-100"
        iconColor="text-red-600"
      ></app-stats>

      <app-stats
        title="Email Verificado"
        [value]="stats()?.email_verificado || 0"
        [smallText]="
          calculatePercentage(
            stats()?.email_verificado || 0,
            stats()?.total_usuarios || 0
          ) + '% del total'
        "
        iconName="mail-check"
        iconBgColor="bg-emerald-100"
        iconColor="text-emerald-600"
      ></app-stats>

      <app-stats
        title="Archivados"
        [value]="stats()?.archivados || 0"
        [smallText]="
          calculatePercentage(
            stats()?.archivados || 0,
            stats()?.total_usuarios || 0
          ) + '% del total'
        "
        iconName="archive"
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
export class UserStatsComponent implements OnInit {
  stats = input<UserStats | null>(null);

  constructor() { }

  ngOnInit(): void { }

  calculatePercentage(part: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
  }
}
