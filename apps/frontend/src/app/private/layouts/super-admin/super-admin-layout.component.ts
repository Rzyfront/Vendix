import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-super-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, HeaderComponent],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        #sidebarRef
        [menuItems]="menuItems"
        [title]="(organizationName$ | async) || platformTitle"
        subtitle="Super Admin"
        [vlink]="(organizationSlug$ | async) || currentVlink"
        [collapsed]="sidebarCollapsed"
        (expandSidebar)="toggleSidebar()"
      >
      </app-sidebar>

      <!-- Main Content -->
      <div
        class="main-content flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out"
        [class.margin-desktop]="!sidebarRef?.isMobile"
        [style.margin-left]="
          !sidebarRef?.isMobile ? (sidebarCollapsed ? '4rem' : '15rem') : '0'
        "
      >
        <!-- Header (Fixed) -->
        <app-header
          [breadcrumb]="breadcrumb"
          [user]="user"
          (toggleSidebar)="toggleSidebar()"
        >
        </app-header>

        <!-- Page Content (Scrollable) -->
        <main
          class="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 transition-all duration-300 ease-in-out"
          style="background-color: var(--background);"
        >
          <div class="w-full">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>
    </div>
  `,
  styleUrls: ['./super-admin-layout.component.scss'],
})
export class SuperAdminLayoutComponent {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  sidebarCollapsed = false;
  currentVlink = 'super-admin';
  platformTitle = 'Vendix Platform';

  // Dynamic user data
  organizationName$: Observable<string | null>;
  organizationSlug$: Observable<string | null>;

  constructor(private authFacade: AuthFacade) {
    this.organizationName$ = this.authFacade.userOrganizationName$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
  }

  breadcrumb = {
    parent: 'Super Administrador',
    current: 'Panel Principal',
  };

  user = {
    name: 'Usuario Administrador',
    role: 'Super Administrador',
    initials: 'UA',
  };

  menuItems: MenuItem[] = [
    {
      label: 'Panel Principal',
      icon: 'home',
      route: '/super-admin/dashboard',
    },
    {
      label: 'Organizaciones',
      icon: 'building',
      route: '/super-admin/organizations',
    },
    {
      label: 'Tiendas',
      icon: 'store',
      route: '/super-admin/stores',
    },
    {
      label: 'Usuarios',
      icon: 'users',
      route: '/super-admin/users',
    },
    {
      label: 'Roles',
      icon: 'shield',
      route: '/super-admin/roles',
    },
    {
      label: 'Dominios',
      icon: 'globe-2',
      route: '/super-admin/domains',
    },
    {
      label: 'Auditoría',
      icon: 'eye',
      route: '/super-admin/audit',
    },
    {
      label: 'Facturación',
      icon: 'credit-card',
      route: '/super-admin/billing',
    },
    {
      label: 'Soporte',
      icon: 'headset',
      route: '/super-admin/support',
      badge: '3',
    },
    {
      label: 'Analíticas',
      icon: 'chart-line',
      children: [
        {
          label: 'Analíticas de Plataforma',
          icon: 'circle',
          route: '/super-admin/analytics/platform',
        },
        {
          label: 'Analíticas de Usuarios',
          icon: 'circle',
          route: '/super-admin/analytics/users',
        },
        {
          label: 'Rendimiento',
          icon: 'circle',
          route: '/super-admin/analytics/performance',
        },
      ],
    },
    {
      label: 'Sistema',
      icon: 'settings',
      children: [
        {
          label: 'Configuración del Sistema',
          icon: 'circle',
          route: '/super-admin/system/settings',
        },
        {
          label: 'Registros',
          icon: 'circle',
          route: '/super-admin/system/logs',
        },
        {
          label: 'Copias de Seguridad',
          icon: 'circle',
          route: '/super-admin/system/backups',
        },
      ],
    },
  ];

  toggleSidebar() {
    // If mobile, delegate to sidebar component
    if (this.sidebarRef?.isMobile) {
      this.sidebarRef.toggleSidebar();
    } else {
      // Desktop: toggle collapsed state
      this.sidebarCollapsed = !this.sidebarCollapsed;
    }
  }
}
