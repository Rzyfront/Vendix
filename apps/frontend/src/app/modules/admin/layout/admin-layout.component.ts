import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { filter, map } from 'rxjs/operators';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.scss']
})
export class AdminLayoutComponent implements OnInit {
  sidebarCollapsed = false;
  currentUser: any = null;
  pageTitle = 'Dashboard';

  // Branding colors from domain config
  brandingColors = {
    primary: '#7ED7A5',
    secondary: '#2F6F4E',
    accent: '#FFFFFF',
    background: '#F4F4F4',
    text: '#222222',
    border: '#B0B0B0'
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
    private router: Router
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadBrandingColors();
    this.setBrandingCSSVariables();
    
    // Update page title based on current route
    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd),
        map(() => this.router.url)
      )
      .subscribe(url => {
        this.pageTitle = this.pageTitles[url] || 'Dashboard';
      });

    // Set initial page title
    this.pageTitle = this.pageTitles[this.router.url] || 'Dashboard';
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

  private loadBrandingColors(): void {
    try {
      const currentStore = localStorage.getItem('vendix_current_store');
      if (currentStore) {
        const storeData = JSON.parse(currentStore);

        if (storeData.domainConfig?.config?.branding) {
          const branding = storeData.domainConfig.config.branding;

          this.brandingColors = {
            primary: branding.primary_color || this.brandingColors.primary,
            secondary: branding.secondary_color || this.brandingColors.secondary,
            accent: branding.accent_color || this.brandingColors.accent,
            background: branding.background_color || this.brandingColors.background,
            text: branding.text_color || this.brandingColors.text,
            border: branding.border_color || this.brandingColors.border
          };
          
          // Update CSS variables after loading colors
          this.setBrandingCSSVariables();
        }
      }
    } catch (error) {
      console.warn('Error loading branding colors:', error);
      // Keep default colors
    }
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
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
