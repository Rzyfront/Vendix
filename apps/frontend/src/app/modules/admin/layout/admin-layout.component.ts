import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { filter, map, combineLatest } from 'rxjs/operators';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.scss']
})
export class AdminLayoutComponent implements OnInit, OnDestroy {
  sidebarCollapsed = false;
  currentUser: any = null;
  pageTitle = 'Dashboard';
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (initialized with neutral defaults)
  brandingColors = {
    primary: '#3B82F6', // Default blue
    secondary: '#1E40AF', // Default dark blue
    accent: '#FFFFFF', // White
    background: '#F8FAFC', // Light gray
    text: '#1E293B', // Dark gray
    border: '#E2E8F0' // Light border
  };

  private pageTitles: { [key: string]: string } = {
    '/admin/dashboard': 'Dashboard',
    '/admin/organizations': 'Organizaciones',
    '/admin/stores': 'Tiendas',
    '/admin/users': 'Usuarios',
    '/admin/analytics': 'Análisis',
    '/admin/settings': 'Configuración'
  };

  constructor(
    private authService: AuthService,
    private router: Router,
    private tenantFacade: TenantFacade,
    private authFacade: AuthFacade
  ) {}

  ngOnInit(): void {
    // Subscribe to reactive auth state
    this.authFacade.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.currentUser = user;
    });

    // Subscribe to tenant branding colors
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig?.branding?.colors) {
        const colors = tenantConfig.branding.colors;
        this.brandingColors = {
          primary: colors.primary || this.brandingColors.primary,
          secondary: colors.secondary || this.brandingColors.secondary,
          accent: colors.accent || this.brandingColors.accent,
          background: colors.background || this.brandingColors.background,
          text: colors.text.primary || this.brandingColors.text,
          border: colors.surface || this.brandingColors.border
        };
        this.setBrandingCSSVariables();
      }
    });

    // Update page title based on current route
    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd),
        map(() => this.router.url),
        takeUntil(this.destroy$)
      )
      .subscribe(url => {
        this.pageTitle = this.pageTitles[url] || 'Dashboard';
      });

    // Set initial page title
    this.pageTitle = this.pageTitles[this.router.url] || 'Dashboard';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setBrandingCSSVariables(): void {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--primary-color', this.brandingColors.primary);
      root.style.setProperty('--secondary-color', this.brandingColors.secondary);
      root.style.setProperty('--accent-color', this.brandingColors.accent);
      root.style.setProperty('--background-color', this.brandingColors.background);
      root.style.setProperty('--text-color', this.brandingColors.text);
      root.style.setProperty('--border-color', this.brandingColors.border);
    }
  }


  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
  logout(): void {
    this.authFacade.logout();
  }
  getRoleDisplayName(role?: string): string {
    const userRole = role || this.authFacade.getCurrentUserRole();
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
    return roleMap[userRole || ''] || userRole || 'Usuario';
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
