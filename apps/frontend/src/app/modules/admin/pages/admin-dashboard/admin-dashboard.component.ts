import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

interface DashboardStats {
  totalUsers: number;
  activeStores: number;
  monthlyRevenue: number;
  transactions: number;
}

interface ActivityItem {
  title: string;
  description: string;
  time: string;
  color: string;
  icon: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  currentUser: any = null;
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (no defaults)
  brandingColors: any = {};

  stats: DashboardStats = {
    totalUsers: 1234,
    activeStores: 567,
    monthlyRevenue: 45678000,
    transactions: 12345
  };

  recentActivity: ActivityItem[] = [
    {
      title: 'Nueva tienda registrada',
      description: 'SuperMercado El Dorado se unió a la plataforma',
      time: 'Hace 2 horas',
      color: 'bg-green-500',
      icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
    },
    {
      title: 'Usuario premium activado',
      description: 'Plan Premium activado para Tiendas Modernas SAS',
      time: 'Hace 4 horas',
      color: 'bg-blue-500',
      icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
    },
    {
      title: 'Mantenimiento completado',
      description: 'Actualización del sistema de pagos finalizada',
      time: 'Hace 6 horas',
      color: 'bg-yellow-500',
      icon: 'M8 4a4 4 0 100 8 4 4 0 000-8zM6 8a2 2 0 11-4 0 2 2 0 014 0zm2 6a6 6 0 006 6H6a6 6 0 006-6v-1.5a4.5 4.5 0 119 0V14a6 6 0 006 6z'
    },
    {
      title: 'Nuevo reporte generado',
      description: 'Reporte mensual de ventas disponible',
      time: 'Hace 8 horas',
      color: 'bg-purple-500',
      icon: 'M9 2a1 1 0 000 2h2a1 1 0 100-2H9z M4 5a2 2 0 012-2v1a1 1 0 001 1h6a1 1 0 001-1V3a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V5z'
    }
  ];

  constructor(
    private authService: AuthService,
    private tenantFacade: TenantFacade
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();

    // Subscribe to tenant branding colors
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig?.branding?.colors) {
        const colors = tenantConfig.branding.colors;
        this.brandingColors = {
          primary: colors.primary,
          secondary: colors.secondary,
          accent: colors.accent,
          background: colors.background,
          text: colors.text?.primary || colors.text,
          border: colors.surface
        };
        this.setBrandingCSSVariables();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setBrandingCSSVariables(): void {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--primary-color', this.primaryColor);
      root.style.setProperty('--secondary-color', this.secondaryColor);
      root.style.setProperty('--accent-color', this.accentColor);
      root.style.setProperty('--background-color', this.backgroundColor);
      root.style.setProperty('--text-color', this.textColor);
      root.style.setProperty('--border-color', this.borderColor);
    }
  }

  // Helper methods for template colors with defaults
  get primaryColor(): string {
    return this.brandingColors?.primary || '#7ED7A5';
  }

  get secondaryColor(): string {
    return this.brandingColors?.secondary || '#2F6F4E';
  }

  get accentColor(): string {
    return this.brandingColors?.accent || '#FFFFFF';
  }

  get backgroundColor(): string {
    return this.brandingColors?.background || '#F4F4F4';
  }

  get textColor(): string {
    return this.brandingColors?.text || '#222222';
  }

  get borderColor(): string {
    return this.brandingColors?.border || '#B0B0B0';
  }

  logout(): void {
    this.authService.logout();
  }
  getRoleDisplayName(role: string): string {
    const roleMap: { [key: string]: string } = {
      'SUPER_ADMIN': 'Super Admin',
      'ADMIN': 'Administrador',
      'OWNER': 'Propietario',
      'MANAGER': 'Gerente',
      'SUPERVISOR': 'Supervisor',
      'EMPLOYEE': 'Empleado',
      'CASHIER': 'Cajero',
      'CUSTOMER': 'Cliente',
      'VIEWER': 'Visor'
    };
    return roleMap[role] || role || 'Usuario';
  }

  getRoleBadgeClass(role: string): string {
    const baseClasses = 'px-2 py-1 rounded-full text-xs font-medium';
    const roleClasses: { [key: string]: string } = {
      'SUPER_ADMIN': 'bg-purple-100 text-purple-800',
      'ADMIN': 'bg-blue-100 text-blue-800',
      'OWNER': 'bg-green-100 text-green-800',
      'MANAGER': 'bg-yellow-100 text-yellow-800',
      'SUPERVISOR': 'bg-indigo-100 text-indigo-800',
      'EMPLOYEE': 'bg-orange-100 text-orange-800',
      'CASHIER': 'bg-teal-100 text-teal-800',
      'CUSTOMER': 'bg-gray-100 text-gray-800',
      'VIEWER': 'bg-slate-100 text-slate-800'
    };
    return `${baseClasses} ${roleClasses[role] || 'bg-gray-100 text-gray-800'}`;
  }
}
