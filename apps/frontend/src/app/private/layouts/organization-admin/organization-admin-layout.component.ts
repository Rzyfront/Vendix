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
  selector: 'app-organization-admin-layout',
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
        [title]="(organizationName$ | async) || organizationName"
        subtitle="Organization Admin"
        [vlink]="(organizationSlug$ | async) || organizationSlug"
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
  `,
  styleUrls: ['./organization-admin-layout.component.scss'],
})
export class OrganizationAdminLayoutComponent implements OnInit, OnDestroy {
  sidebarCollapsed = false;
  currentVlink = 'organization-admin';
  organizationName = 'Acme Corporation';
  organizationSlug = 'acme-corp';

  // Dynamic user data
  organizationName$: Observable<string | null>;
  organizationSlug$: Observable<string | null>;

  // Onboarding
  showOnboardingModal = false;
  private destroy$ = new Subject<void>();

  constructor(
    private authFacade: AuthFacade,
    private onboardingService: OnboardingService,
  ) {
    this.organizationName$ = this.authFacade.userOrganizationName$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
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
    parent: { label: 'Organización', url: '/organization' },
    current: { label: 'Dashboard' },
  };

  user = {
    name: 'Admin User',
    role: 'Organization Admin',
    initials: 'AU',
  };

  menuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'fas fa-home',
      route: '/organization/dashboard',
    },
    {
      label: 'Analytics',
      icon: 'fas fa-chart-line',
      children: [
        {
          label: 'Reports',
          icon: 'fas fa-circle',
          route: '/organization/analytics/reports',
        },
        {
          label: 'Statistics',
          icon: 'fas fa-circle',
          route: '/organization/analytics/statistics',
        },
        {
          label: 'Insights',
          icon: 'fas fa-circle',
          route: '/organization/analytics/insights',
        },
      ],
    },
    {
      label: 'Users',
      icon: 'fas fa-users',
      children: [
        {
          label: 'All Users',
          icon: 'fas fa-circle',
          route: '/organization/users/all',
        },
        {
          label: 'Roles',
          icon: 'fas fa-circle',
          route: '/organization/users/roles',
        },
        {
          label: 'Permissions',
          icon: 'fas fa-circle',
          route: '/organization/users/permissions',
        },
      ],
    },
    {
      label: 'Products',
      icon: 'fas fa-box',
      children: [
        {
          label: 'All Products',
          icon: 'fas fa-circle',
          route: '/organization/products/all',
        },
        {
          label: 'Categories',
          icon: 'fas fa-circle',
          route: '/organization/products/categories',
        },
        {
          label: 'Inventory',
          icon: 'fas fa-circle',
          route: '/organization/products/inventory',
        },
      ],
    },
    {
      label: 'Orders',
      icon: 'fas fa-shopping-cart',
      route: '/organization/orders',
      badge: '12',
    },
    {
      label: 'Settings',
      icon: 'fas fa-cog',
      children: [
        {
          label: 'General',
          icon: 'fas fa-circle',
          route: '/organization/settings/general',
        },
        {
          label: 'Security',
          icon: 'fas fa-circle',
          route: '/organization/settings/security',
        },
        {
          label: 'Notifications',
          icon: 'fas fa-circle',
          route: '/organization/settings/notifications',
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
