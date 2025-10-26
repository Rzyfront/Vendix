import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';

@Component({
  selector: 'app-super-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, HeaderComponent],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        [menuItems]="menuItems"
        [title]="platformTitle"
        subtitle="Super Admin"
        [vlink]="currentVlink"
        [collapsed]="sidebarCollapsed"
      >
      </app-sidebar>

      <!-- Main Content -->
      <div
        class="flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out"
        [style.margin-left]="sidebarCollapsed ? '4rem' : '15rem'"
      >
        <!-- Header -->
        <app-header
          [breadcrumb]="breadcrumb"
          [user]="user"
          (toggleSidebar)="toggleSidebar()"
        >
        </app-header>

        <!-- Page Content -->
        <main
          class="flex-1 overflow-y-auto px-4 py-2 transition-all duration-300 ease-in-out"
          style="background-color: var(--background);"
        >
          <div class="w-full h-full">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>
    </div>
  `,
  styleUrls: ['./super-admin-layout.component.scss'],
})
export class SuperAdminLayoutComponent implements OnInit {
  sidebarCollapsed = false;
  currentPageTitle = 'Super Admin Dashboard';
  currentVlink = 'super-admin';
  platformTitle = 'Vendix Platform';

  constructor() {
    console.log('[DEBUG] SuperAdminLayoutComponent has been constructed!');
    console.log('[DEBUG] Menu items:', this.menuItems);
  }

  ngOnInit(): void {
    console.log('[DEBUG] SuperAdminLayoutComponent initialized');
    // Ensure menu items are properly set
    console.log('[DEBUG] Menu items on init:', this.menuItems);
  }

  breadcrumb = {
    parent: 'Super Admin',
    current: 'Dashboard',
  };

  user = {
    name: 'Admin User',
    role: 'Super Administrator',
    initials: 'AU',
  };

  menuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'home',
      route: '/super-admin/dashboard',
    },
    {
      label: 'Organizations',
      icon: 'building',
      route: '/super-admin/organizations',
    },
    {
      label: 'Stores',
      icon: 'store',
      route: '/super-admin/stores',
    },
    {
      label: 'Users',
      icon: 'users',
      route: '/super-admin/users',
    },
    {
      label: 'Roles',
      icon: 'shield',
      route: '/super-admin/roles',
    },
    {
      label: 'Auditoría',
      icon: 'eye',
      route: '/super-admin/audit',
    },
    {
      label: 'Billing',
      icon: 'credit-card',
      route: '/super-admin/billing',
    },
    {
      label: 'Support',
      icon: 'headset',
      route: '/super-admin/support',
      badge: '3',
    },
       {
      label: 'Analytics',
      icon: 'chart-line',
      children: [
        {
          label: 'Platform Analytics',
          icon: 'circle',
          route: '/super-admin/analytics/platform',
        },
        {
          label: 'User Analytics',
          icon: 'circle',
          route: '/super-admin/analytics/users',
        },
        {
          label: 'Performance',
          icon: 'circle',
          route: '/super-admin/analytics/performance',
        },
      ],
    },
      {
      label: 'System',
      icon: 'settings',
      children: [
        {
          label: 'System Settings',
          icon: 'circle',
          route: '/super-admin/system/settings',
        },
        { label: 'Logs', icon: 'circle', route: '/super-admin/system/logs' },
        {
          label: 'Backups',
          icon: 'circle',
          route: '/super-admin/system/backups',
        },
      ],
    }
  ];

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}
