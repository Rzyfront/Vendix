import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
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
        #sidebarRef
        [menuItems]="menuItems"
        [title]="(storeName$ | async) || storeName"
        subtitle="Store Admin"
        [vlink]="(storeSlug$ | async) || storeSlug"
        [collapsed]="sidebarCollapsed"
      >
      </app-sidebar>

      <!-- Main Content -->
      <div
        class="main-content flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out"
        [class.margin-desktop]="!sidebarRef?.isMobile"
        [style.margin-left]="!sidebarRef?.isMobile ? (sidebarCollapsed ? '4rem' : '15rem') : '0'"
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
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

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
  needsOnboarding = false;
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
      this.checkOnboardingWithRoleValidation();

      // Subscribe to onboarding needs and show modal instead of redirecting
      this.authFacade.needsOnboarding$
        .pipe(takeUntil(this.destroy$))
        .subscribe((needsOnboarding: any) => {
          // this.needsOnboarding = needsOnboarding;
           this.needsOnboarding = false; // Temporalmente deshabilitado hasta desarrollar workflow
          this.updateOnboardingModal();
        });
    }

  private checkOnboardingWithRoleValidation(): void {
    // Only proceed with onboarding logic if user is owner
    const isOwner = this.authFacade.isOwner();
    if (!isOwner) {
      this.needsOnboarding = false;
      this.showOnboardingModal = false;
      return;
    }

    // Check actual onboarding status from persistent data
    const currentUser = this.authFacade.getCurrentUser();
    const storeOnboarding = currentUser?.stores?.onboarding;

    // this.needsOnboarding = !storeOnboarding;
    this.needsOnboarding = false; // Temporalmente deshabilitado hasta desarrollar workflow
    this.updateOnboardingModal();
  }   

  private updateOnboardingModal(): void {
    // Double-check owner role before showing modal
    const isOwner = this.authFacade.isOwner();
    if (!isOwner) {
      this.showOnboardingModal = false;
      return;
    }

    // Verify onboarding status from current user data
    const currentUser = this.authFacade.getCurrentUser();
    const storeOnboarding = currentUser?.stores?.onboarding;
    const actuallyNeedsOnboarding = !storeOnboarding;

    this.showOnboardingModal = actuallyNeedsOnboarding && this.needsOnboarding;
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
      icon: 'home',
      route: '/admin/dashboard',
    },
    {
      label: 'POS',
      icon: 'store',
      route: '/admin/pos',
    },
    {
      label: 'Products',
      icon: 'package',
      children: [
        {
          label: 'All Products',
          icon: 'circle',
          route: '/admin/products/all',
        },
        {
          label: 'Categories',
          icon: 'circle',
          route: '/admin/products/categories',
        },
        {
          label: 'Inventory',
          icon: 'circle',
          route: '/admin/products/inventory',
        },
      ],
    },
    {
      label: 'Orders',
      icon: 'cart',
      route: '/admin/orders',
      badge: '8',
    },
    {
      label: 'Customers',
      icon: 'users',
      children: [
        {
          label: 'All Customers',
          icon: 'circle',
          route: '/admin/customers/all',
        },
        {
          label: 'Reviews',
          icon: 'circle',
          route: '/admin/customers/reviews',
        },
      ],
    },
    {
      label: 'Marketing',
      icon: 'megaphone',
      children: [
        {
          label: 'Promotions',
          icon: 'circle',
          route: '/admin/marketing/promotions',
        },
        {
          label: 'Coupons',
          icon: 'circle',
          route: '/admin/marketing/coupons',
        },
      ],
    },
    {
      label: 'Analytics',
      icon: 'chart-line',
      children: [
        {
          label: 'Sales',
          icon: 'circle',
          route: '/admin/analytics/sales',
        },
        {
          label: 'Traffic',
          icon: 'circle',
          route: '/admin/analytics/traffic',
        },
        {
          label: 'Performance',
          icon: 'circle',
          route: '/admin/analytics/performance',
        },
      ],
    },
    {
      label: 'Settings',
      icon: 'settings',
      children: [
        {
          label: 'General',
          icon: 'circle',
          route: '/admin/settings/general',
        },
        {
          label: 'Appearance',
          icon: 'circle',
          route: '/admin/settings/appearance',
        },
        {
          label: 'Security',
          icon: 'circle',
          route: '/admin/settings/security',
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

  onOnboardingCompleted(event: any): void {
    console.log('Onboarding completed:', event);
    // Update auth state to reflect onboarding completion
    this.authFacade.setOnboardingCompleted(true);
    // Reload user data to get updated organization/store info
    this.authFacade.loadUser();
  }
}
