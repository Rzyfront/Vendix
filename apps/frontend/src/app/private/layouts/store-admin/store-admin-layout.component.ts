import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SidebarComponent, MenuItem } from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';

@Component({
  selector: 'app-store-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, HeaderComponent],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        [menuItems]="menuItems"
        [title]="storeName"
        subtitle="Store Admin"
        [vlink]="storeSlug"
        [collapsed]="sidebarCollapsed">
      </app-sidebar>
      
      <!-- Main Content -->
      <div class="flex-1 flex flex-col overflow-hidden ml-64 transition-all duration-300"
           [class.ml-16]="sidebarCollapsed">
        <!-- Header -->
        <app-header
          [breadcrumb]="breadcrumb"
          [user]="user"
          (toggleSidebar)="toggleSidebar()">
        </app-header>
        
        <!-- Page Content -->
        <main class="flex-1 overflow-y-auto px-4 py-2" style="background-color: var(--background);">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
  styleUrls: ['./store-admin-layout.component.scss']
})
export class StoreAdminLayoutComponent {
  sidebarCollapsed = false;
  currentPageTitle = 'Store Dashboard';
  currentVlink = 'store-admin';
  storeName = 'Main Street Store';
  storeSlug = 'main-street-store';
  
  breadcrumb = {
    parent: 'Store',
    current: 'Dashboard'
  };

  user = {
    name: 'Jane Smith',
    role: 'Store Manager',
    initials: 'JS'
  };

  menuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'fas fa-home',
      route: '/store/dashboard'
    },
    {
      label: 'Products',
      icon: 'fas fa-box',
      children: [
        { label: 'All Products', icon: 'fas fa-circle', route: '/store/products/all' },
        { label: 'Categories', icon: 'fas fa-circle', route: '/store/products/categories' },
        { label: 'Inventory', icon: 'fas fa-circle', route: '/store/products/inventory' }
      ]
    },
    {
      label: 'Orders',
      icon: 'fas fa-shopping-cart',
      route: '/store/orders',
      badge: '8'
    },
    {
      label: 'Customers',
      icon: 'fas fa-users',
      children: [
        { label: 'All Customers', icon: 'fas fa-circle', route: '/store/customers/all' },
        { label: 'Reviews', icon: 'fas fa-circle', route: '/store/customers/reviews' }
      ]
    },
    {
      label: 'Marketing',
      icon: 'fas fa-bullhorn',
      children: [
        { label: 'Promotions', icon: 'fas fa-circle', route: '/store/marketing/promotions' },
        { label: 'Coupons', icon: 'fas fa-circle', route: '/store/marketing/coupons' }
      ]
    },
    {
      label: 'Analytics',
      icon: 'fas fa-chart-line',
      children: [
        { label: 'Sales', icon: 'fas fa-circle', route: '/store/analytics/sales' },
        { label: 'Traffic', icon: 'fas fa-circle', route: '/store/analytics/traffic' },
        { label: 'Performance', icon: 'fas fa-circle', route: '/store/analytics/performance' }
      ]
    },
    {
      label: 'Settings',
      icon: 'fas fa-cog',
      children: [
        { label: 'General', icon: 'fas fa-circle', route: '/store/settings/general' },
        { label: 'Appearance', icon: 'fas fa-circle', route: '/store/settings/appearance' },
        { label: 'Security', icon: 'fas fa-circle', route: '/store/settings/security' }
      ]
    }
  ];

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}