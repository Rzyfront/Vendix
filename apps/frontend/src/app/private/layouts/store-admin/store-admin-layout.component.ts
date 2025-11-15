import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { OnboardingModalComponent } from '../../../shared/components/onboarding-modal';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-store-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SidebarComponent,
    HeaderComponent,
    OnboardingModalComponent,
  ],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        [menuItems]="menuItems"
        [title]="(storeName$ | async) || storeName"
        subtitle="Store Admin"
        [vlink]="(storeSlug$ | async) || storeSlug"
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

    <!-- Onboarding Modal -->
    <app-onboarding-modal
      [(isOpen)]="showOnboardingModal"
      (completed)="onOnboardingCompleted($event)"
    ></app-onboarding-modal>
  `,
  styleUrls: ['./store-admin-layout.component.scss'],
})
export class StoreAdminLayoutComponent implements OnInit, OnDestroy {
  sidebarCollapsed = false;
  currentPageTitle = 'Store Dashboard';
  currentVlink = 'store-admin';
  storeName = 'Main Street Store';
  storeSlug = 'main-street-store';

  // Dynamic user data
  storeName$: Observable<string | null>;
  storeSlug$: Observable<string | null>;

  // Onboarding
  showOnboardingModal = false; // Will be set in ngOnInit based on actual status
  private destroy$ = new Subject<void>();

  constructor(
    private authFacade: AuthFacade,
    private onboardingWizardService: OnboardingWizardService,
  ) {
    this.storeName$ = this.authFacade.userStoreName$;
    this.storeSlug$ = this.authFacade.userStoreSlug$;
  }

  ngOnInit(): void {
    // Check onboarding status when component initializes
    this.authFacade.checkOnboardingStatus();

    // Set initial state immediately based on current needs
    this.showOnboardingModal = this.authFacade.needsOnboarding();

    // Subscribe to onboarding needs and show modal instead of redirecting
    this.authFacade.needsOnboarding$
      .pipe(takeUntil(this.destroy$))
      .subscribe((needsOnboarding: any) => {
        if (needsOnboarding) {
          // Show onboarding modal instead of redirecting
          this.showOnboardingModal = true;
        } else {
          // Close modal if it's open
          this.showOnboardingModal = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  breadcrumb = {
    parent: 'Store',
    current: 'Dashboard',
  };

  user = {
    name: 'Jane Smith',
    role: 'Store Manager',
    initials: 'JS',
  };

  menuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'fas fa-home',
      route: '/admin/dashboard',
    },
    {
      label: 'Products',
      icon: 'fas fa-box',
      children: [
        {
          label: 'All Products',
          icon: 'fas fa-circle',
          route: '/admin/products/all',
        },
        {
          label: 'Categories',
          icon: 'fas fa-circle',
          route: '/admin/products/categories',
        },
        {
          label: 'Inventory',
          icon: 'fas fa-circle',
          route: '/admin/products/inventory',
        },
      ],
    },
    {
      label: 'Orders',
      icon: 'fas fa-shopping-cart',
      route: '/admin/orders',
      badge: '8',
    },
    {
      label: 'Customers',
      icon: 'fas fa-users',
      children: [
        {
          label: 'All Customers',
          icon: 'fas fa-circle',
          route: '/admin/customers/all',
        },
        {
          label: 'Reviews',
          icon: 'fas fa-circle',
          route: '/admin/customers/reviews',
        },
      ],
    },
    {
      label: 'Marketing',
      icon: 'fas fa-bullhorn',
      children: [
        {
          label: 'Promotions',
          icon: 'fas fa-circle',
          route: '/admin/marketing/promotions',
        },
        {
          label: 'Coupons',
          icon: 'fas fa-circle',
          route: '/admin/marketing/coupons',
        },
      ],
    },
    {
      label: 'Analytics',
      icon: 'fas fa-chart-line',
      children: [
        {
          label: 'Sales',
          icon: 'fas fa-circle',
          route: '/admin/analytics/sales',
        },
        {
          label: 'Traffic',
          icon: 'fas fa-circle',
          route: '/admin/analytics/traffic',
        },
        {
          label: 'Performance',
          icon: 'fas fa-circle',
          route: '/admin/analytics/performance',
        },
      ],
    },
    {
      label: 'Settings',
      icon: 'fas fa-cog',
      children: [
        {
          label: 'General',
          icon: 'fas fa-circle',
          route: '/admin/settings/general',
        },
        {
          label: 'Appearance',
          icon: 'fas fa-circle',
          route: '/admin/settings/appearance',
        },
        {
          label: 'Security',
          icon: 'fas fa-circle',
          route: '/admin/settings/security',
        },
      ],
    },
  ];

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  onOnboardingCompleted(event: any): void {
    console.log('Onboarding completed:', event);
    // Update auth state to reflect onboarding completion
    this.authFacade.setOnboardingCompleted(true);
    // Reload user data to get updated organization/store info
    this.authFacade.loadUser();
  }
}
