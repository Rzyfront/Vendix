import { Injectable } from '@angular/core';
import { User, UserState, UserStats } from '../interfaces/user.interface';

@Injectable({
  providedIn: 'root',
})
export class UserStatsService {
  /**
   * Calculate user statistics from user list
   */
  calculateStats(users: User[]): UserStats {
    const total = users.length;

    if (total === 0) {
      return {
        total_usuarios: 0,
        activos: 0,
        pendientes: 0,
        con_2fa: 0,
        inactivos: 0,
        suspendidos: 0,
        email_verificado: 0,
        archivados: 0,
      };
    }

    const stats = {
      total_usuarios: total,
      activos: 0,
      pendientes: 0,
      con_2fa: 0,
      inactivos: 0,
      suspendidos: 0,
      email_verificado: 0,
      archivados: 0,
    };

    users.forEach((user) => {
      // Count by state
      switch (user.state) {
        case UserState.ACTIVE:
          stats.activos++;
          break;
        case UserState.INACTIVE:
          stats.inactivos++;
          break;
        case UserState.PENDING_VERIFICATION:
          stats.pendientes++;
          break;
        case UserState.SUSPENDED:
          stats.suspendidos++;
          break;
        case UserState.ARCHIVED:
          stats.archivados++;
          break;
      }

      // Count 2FA enabled
      if (user.two_factor_enabled) {
        stats.con_2fa++;
      }

      // Count email verified
      if (user.email_verified) {
        stats.email_verificado++;
      }
    });

    return stats;
  }

  /**
   * Calculate percentage
   */
  calculatePercentage(value: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  /**
   * Get stats with percentages
   */
  getStatsWithPercentages(users: User[]): UserStats & { percentages: any } {
    const stats = this.calculateStats(users);
    const total = stats.total_usuarios;

    return {
      ...stats,
      percentages: {
        activos: this.calculatePercentage(stats.activos, total),
        pendientes: this.calculatePercentage(stats.pendientes, total),
        con_2fa: this.calculatePercentage(stats.con_2fa, total),
        inactivos: this.calculatePercentage(stats.inactivos, total),
        suspendidos: this.calculatePercentage(stats.suspendidos, total),
        email_verificado: this.calculatePercentage(
          stats.email_verificado,
          total,
        ),
        archivados: this.calculatePercentage(stats.archivados, total),
      },
    };
  }
}
