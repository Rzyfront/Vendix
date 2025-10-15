import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SidebarComponent, MenuItem } from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';

@Component({
  selector: 'app-organization-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, HeaderComponent],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        [menuItems]="menuItems"
        subtitle="Organization Admin"
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
  styleUrls: ['./organization-admin-layout.component.scss']
})
export class OrganizationAdminLayoutComponent {
  sidebarCollapsed = false;
  currentPageTitle = 'Organization Dashboard';
  currentVlink = 'organization-admin';
  
  breadcrumb = {
    parent: 'Organization',
    current: 'Dashboard'
  };

  user = {
    name: 'John Doe',
    role: 'Organization Admin',
    initials: 'JD'
  };

  menuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'fas fa-home',
      route: '/organization/dashboard'
    },
    {
      label: 'Analytics',
      icon: 'fas fa-chart-line',
      children: [
        { label: 'Reports', icon: 'fas fa-circle', route: '/organization/analytics/reports' },
        { label: 'Statistics', icon: 'fas fa-circle', route: '/organization/analytics/statistics' },
        { label: 'Insights', icon: 'fas fa-circle', route: '/organization/analytics/insights' }
      ]
    },
    {
      label: 'Users',
      icon: 'fas fa-users',
      children: [
        { label: 'All Users', icon: 'fas fa-circle', route: '/organization/users/all' },
        { label: 'Roles', icon: 'fas fa-circle', route: '/organization/users/roles' },
        { label: 'Permissions', icon: 'fas fa-circle', route: '/organization/users/permissions' }
      ]
    },
    {
      label: 'Products',
      icon: 'fas fa-box',
      children: [
        { label: 'All Products', icon: 'fas fa-circle', route: '/organization/products/all' },
        { label: 'Categories', icon: 'fas fa-circle', route: '/organization/products/categories' },
        { label: 'Inventory', icon: 'fas fa-circle', route: '/organization/products/inventory' }
      ]
    },
    {
      label: 'Orders',
      icon: 'fas fa-shopping-cart',
      route: '/organization/orders',
      badge: '12'
    },
    {
      label: 'Settings',
      icon: 'fas fa-cog',
      children: [
        { label: 'General', icon: 'fas fa-circle', route: '/organization/settings/general' },
        { label: 'Security', icon: 'fas fa-circle', route: '/organization/settings/security' },
        { label: 'Notifications', icon: 'fas fa-circle', route: '/organization/settings/notifications' }
      ]
    }
  ];

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}