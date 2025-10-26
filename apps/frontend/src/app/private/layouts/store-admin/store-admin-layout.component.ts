import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { OnboardingService } from '../../../shared/components/onboarding/services/onboarding.service';
import { OnboardingModalComponent } from '../../../shared/components/onboarding/onboarding-modal.component';
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

      <!-- Onboarding Modal -->
      <app-onboarding-modal
        *ngIf="showOnboardingModal"
        [isOpen]="showOnboardingModal"
        (isOpenChange)="onOnboardingModalChange($event)"
        (completed)="onOnboardingCompleted($event)"
      ></app-onboarding-modal>
      </div>
    </div>
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
  showOnboardingModal = false;
  private destroy$ = new Subject<void>();

  constructor(
    private authFacade: AuthFacade,
    private onboardingService: OnboardingService,
  ) {
    this.storeName$ = this.authFacade.userStoreName$;
    this.storeSlug$ = this.authFacade.userStoreSlug$;
  }

  ngOnInit(): void {
    // Check onboarding status when component initializes
    this.authFacade.needsOnboarding$
      .pipe(takeUntil(this.destroy$))
      .subscribe((needsOnboarding) => {
        if (needsOnboarding) {
          this.showOnboardingModal = true;
          this.onboardingService.openOnboarding();
        }
      });

    // Escuchar estado del onboarding
    this.onboardingService.onboardingState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.showOnboardingModal = state.isOpen;
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
      route: '/store/dashboard',
    },
    {
      label: 'Products',
      icon: 'fas fa-box',
      children: [
        {
          label: 'All Products',
          icon: 'fas fa-circle',
          route: '/store/products/all',
        },
        {
          label: 'Categories',
          icon: 'fas fa-circle',
          route: '/store/products/categories',
        },
        {
          label: 'Inventory',
          icon: 'fas fa-circle',
          route: '/store/products/inventory',
        },
      ],
    },
    {
      label: 'Orders',
      icon: 'fas fa-shopping-cart',
      route: '/store/orders',
      badge: '8',
    },
    {
      label: 'Customers',
      icon: 'fas fa-users',
      children: [
        {
          label: 'All Customers',
          icon: 'fas fa-circle',
          route: '/store/customers/all',
        },
        {
          label: 'Reviews',
          icon: 'fas fa-circle',
          route: '/store/customers/reviews',
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
          route: '/store/marketing/promotions',
        },
        {
          label: 'Coupons',
          icon: 'fas fa-circle',
          route: '/store/marketing/coupons',
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
          route: '/store/analytics/sales',
        },
        {
          label: 'Traffic',
          icon: 'fas fa-circle',
          route: '/store/analytics/traffic',
        },
        {
          label: 'Performance',
          icon: 'fas fa-circle',
          route: '/store/analytics/performance',
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
          route: '/store/settings/general',
        },
        {
          label: 'Appearance',
          icon: 'fas fa-circle',
          route: '/store/settings/appearance',
        },
        {
          label: 'Security',
          icon: 'fas fa-circle',
          route: '/store/settings/security',
        },
      ],
    },
  ];

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  onOnboardingModalChange(isOpen: boolean): void {
    if (!isOpen) {
      this.onboardingService.closeOnboarding();
    }
  }

  onOnboardingCompleted(event: any): void {
    console.log('Onboarding completed:', event);
    // Update auth state to reflect onboarding completion
    this.authFacade.setOnboardingCompleted(true);
    this.onboardingService.setCompleted(true);
    // Reload user data to get updated organization/store info
    this.authFacade.loadUser();
  }
}
