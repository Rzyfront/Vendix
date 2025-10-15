import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SidebarComponent, MenuItem } from '../../../shared/components/sidebar/sidebar.component';
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
        subtitle="Super Admin"
        [vlink]="currentVlink"
        [collapsed]="sidebarCollapsed">
      </app-sidebar>
      
      <!-- Main Content -->
      <div class="flex-1 flex flex-col overflow-hidden ml-64 transition-all duration-300"
           [class.ml-16]="sidebarCollapsed">
        <!-- Header -->
        <app-header 
          [title]="currentPageTitle"
          [breadcrumb]="breadcrumb"
          [user]="user"
          (toggleSidebar)="toggleSidebar()">
        </app-header>
        
        <!-- Page Content -->
        <main class="flex-1 overflow-y-auto p-6" style="background-color: var(--background);">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
  styleUrls: ['./super-admin-layout.component.scss']
})
export class SuperAdminLayoutComponent {
  sidebarCollapsed = false;
  currentPageTitle = 'Super Admin Dashboard';
  currentVlink = 'super-admin';
  
  breadcrumb = {
    parent: 'Super Admin',
    current: 'Dashboard'
  };

  user = {
    name: 'Admin User',
    role: 'Super Administrator',
    initials: 'AU'
  };

  menuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'fas fa-home',
      route: '/super-admin/dashboard'
    },
    {
      label: 'Organizations',
      icon: 'fas fa-building',
      children: [
        { label: 'All Organizations', icon: 'fas fa-circle', route: '/super-admin/organizations' },
        { label: 'Create Organization', icon: 'fas fa-circle', route: '/super-admin/organizations/create' },
        { label: 'Organization Settings', icon: 'fas fa-circle', route: '/super-admin/organizations/settings' }
      ]
    },
    {
      label: 'Users',
      icon: 'fas fa-users',
      children: [
        { label: 'All Users', icon: 'fas fa-circle', route: '/super-admin/users' },
        { label: 'User Roles', icon: 'fas fa-circle', route: '/super-admin/users/roles' },
        { label: 'Permissions', icon: 'fas fa-circle', route: '/super-admin/users/permissions' }
      ]
    },
    {
      label: 'System',
      icon: 'fas fa-cog',
      children: [
        { label: 'System Settings', icon: 'fas fa-circle', route: '/super-admin/system/settings' },
        { label: 'Logs', icon: 'fas fa-circle', route: '/super-admin/system/logs' },
        { label: 'Backups', icon: 'fas fa-circle', route: '/super-admin/system/backups' }
      ]
    },
    {
      label: 'Analytics',
      icon: 'fas fa-chart-line',
      children: [
        { label: 'Platform Analytics', icon: 'fas fa-circle', route: '/super-admin/analytics/platform' },
        { label: 'User Analytics', icon: 'fas fa-circle', route: '/super-admin/analytics/users' },
        { label: 'Performance', icon: 'fas fa-circle', route: '/super-admin/analytics/performance' }
      ]
    },
    {
      label: 'Billing',
      icon: 'fas fa-credit-card',
      route: '/super-admin/billing'
    },
    {
      label: 'Support',
      icon: 'fas fa-headset',
      route: '/super-admin/support',
      badge: '3'
    }
  ];

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}