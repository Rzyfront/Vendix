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
        class="flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out"
        [style.margin-left]="sidebarCollapsed ? '4rem' : '15rem'"
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

    <!-- Onboarding Modal -->
    <app-onboarding-modal
      [(isOpen)]="showOnboardingModal"
      (completed)="onOnboardingCompleted($event)"
    ></app-onboarding-modal>
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

  // Onboarding Modal
  showOnboardingModal = false;
  private destroy$ = new Subject<void>();

  constructor(
    private authFacade: AuthFacade,
    private onboardingWizardService: OnboardingWizardService,
  ) {
    this.organizationName$ = this.authFacade.userOrganizationName$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
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
    parent: { label: 'Panel Administrativo', url: '/admin' },
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
      icon: 'home',
      route: '/admin/dashboard',
    },
    {
      label: 'Financial',
      icon: 'dollar-sign',
      children: [
        {
          label: 'Reports',
          icon: 'file-text',
          route: '/admin/financial/reports',
        },
        {
          label: 'Billing & Subscriptions',
          icon: 'credit-card',
          route: '/admin/financial/billing',
        },
        {
          label: 'Cost Analysis',
          icon: 'bar-chart',
          route: '/admin/financial/cost-analysis',
        },
        {
          label: 'Cash Flow',
          icon: 'trending-up',
          route: '/admin/financial/cash-flow',
        },
      ],
    },
    {
      label: 'Analytics & BI',
      icon: 'chart-line',
      children: [
        {
          label: 'Predictive Analysis',
          icon: 'bar-chart',
          route: '/admin/analytics/predictive',
        },
        {
          label: 'Cross-Store Analysis',
          icon: 'store',
          route: '/admin/analytics/cross-store',
        },
      ],
    },
    {
      label: 'Stores',
      icon: 'store',
      route: '/admin/stores-management',
    },
    {
      label: 'Users',
      icon: 'users',
      children: [
        {
          label: 'Global Users',
          icon: 'user',
          route: '/admin/users/global-users',
        },
        {
          label: 'Roles & Permissions',
          icon: 'shield',
          route: '/admin/users/roles-permissions',
        },
        {
          label: 'Store Assignments',
          icon: 'building',
          route: '/admin/users/store-assignments',
        },
        {
          label: 'Access Audit',
          icon: 'eye',
          route: '/admin/users/access-audit',
        },
      ],
    },
    {
      label: 'Inventory',
      icon: 'warehouse',
      children: [
        {
          label: 'Stock Management',
          icon: 'package',
          route: '/admin/inventory/stock',
        },
        {
          label: 'Stock Transfers',
          icon: 'refresh-ccw',
          route: '/admin/inventory/transfers',
        },
        {
          label: 'Suppliers',
          icon: 'truck',
          route: '/admin/inventory/suppliers',
        },
        {
          label: 'Demand Forecast',
          icon: 'trending-up',
          route: '/admin/inventory/demand-forecast',
        },
      ],
    },
    {
      label: 'Operations',
      icon: 'truck',
      children: [
        {
          label: 'Shipping Management',
          icon: 'truck',
          route: '/admin/operations/shipping',
        },
        {
          label: 'Procurement',
          icon: 'cart',
          route: '/admin/operations/procurement',
        },
        {
          label: 'Returns Management',
          icon: 'rotate-ccw',
          route: '/admin/operations/returns',
        },
        {
          label: 'Route Optimization',
          icon: 'globe-2',
          route: '/admin/operations/route-optimization',
        },
      ],
    },
    {
      label: 'Audit & Compliance',
      icon: 'shield',
      children: [
        {
          label: 'Audit Logs',
          icon: 'file-text',
          route: '/admin/audit/logs',
        },
        {
          label: 'Compliance Reports',
          icon: 'file-check',
          route: '/admin/audit/compliance',
        },
        {
          label: 'Legal Documents',
          icon: 'file-text',
          route: '/admin/audit/legal-docs',
        },
        {
          label: 'Backup & Recovery',
          icon: 'backup',
          route: '/admin/audit/backup',
        },
      ],
    },
    {
      label: 'Configuration',
      icon: 'settings',
      children: [
        {
          label: 'Application Settings',
          icon: 'sliders',
          route: '/admin/config/application',
        },
        {
          label: 'Policies',
          icon: 'file-text',
          route: '/admin/config/policies',
        },
        {
          label: 'Integrations',
          icon: 'link-2',
          route: '/admin/config/integrations',
        },
        {
          label: 'Taxes',
          icon: 'credit-card',
          route: '/admin/config/taxes',
        },
        {
          label: 'Domains',
          icon: 'globe-2',
          route: '/admin/config/domains',
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
