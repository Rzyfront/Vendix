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
        #sidebarRef
        [menuItems]="menuItems"
        [title]="(organizationName$ | async) || organizationName"
        subtitle="Administrador de Organización"
        [vlink]="(organizationSlug$ | async) || organizationSlug"
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

    <!-- Onboarding Modal - Only render if onboarding is needed -->
    <app-onboarding-modal
      *ngIf="needsOnboarding"
      [(isOpen)]="showOnboardingModal"
      (completed)="onOnboardingCompleted($event)"
    ></app-onboarding-modal>
  `,
  styleUrls: ['./organization-admin-layout.component.scss'],
})
export class OrganizationAdminLayoutComponent implements OnInit, OnDestroy {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  sidebarCollapsed = false;
  currentVlink = 'organization-admin';
  organizationName = 'Acme Corporation';
  organizationSlug = 'acme-corp';

  // Dynamic user data
  organizationName$: Observable<string | null>;
  organizationSlug$: Observable<string | null>;

  // Onboarding Modal
  showOnboardingModal = false;
  needsOnboarding = false;
  private destroy$ = new Subject<void>();

  constructor(
    private authFacade: AuthFacade,
    private onboardingWizardService: OnboardingWizardService,
  ) {
    this.organizationName$ = this.authFacade.userOrganizationName$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
  }

  ngOnInit(): void {
    // Check onboarding status considering both organization state and user role
    this.checkOnboardingWithRoleValidation();

    // Subscribe to organization onboarding status from user data (no API call)
    this.authFacade.needsOrganizationOnboarding$
      .pipe(takeUntil(this.destroy$))
      .subscribe((needsOnboarding: boolean) => {
        this.needsOnboarding = needsOnboarding;
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
    const organizationOnboarding = currentUser?.organizations?.onboarding;

    this.needsOnboarding = !organizationOnboarding;
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
    const organizationOnboarding = currentUser?.organizations?.onboarding;
    const actuallyNeedsOnboarding = !organizationOnboarding;

    this.showOnboardingModal = actuallyNeedsOnboarding && this.needsOnboarding;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  breadcrumb = {
    parent: { label: 'Panel Administrativo', url: '/admin' },
    current: { label: 'Panel Principal' },
  };

  user = {
    name: 'Usuario Administrador',
    role: 'Administrador de Organización',
    initials: 'UA',
  };

  menuItems: MenuItem[] = [
    {
      label: 'Panel Principal',
      icon: 'home',
      route: '/admin/dashboard',
    },
    {
      label: 'Tiendas',
      icon: 'store',
      route: '/admin/stores-management',
    },
    {
      label: 'Usuarios',
      icon: 'users',
      children: [
        {
          label: 'Usuarios Globales',
          icon: 'user',
          route: '/admin/users/global-users',
        },
        {
          label: 'Roles y Permisos',
          icon: 'shield',
          route: '/admin/users/roles-permissions',
        },
        {
          label: 'Asignaciones de Tienda',
          icon: 'building',
          route: '/admin/users/store-assignments',
        }
      ],
    },
    {
      label: 'Finanzas',
      icon: 'dollar-sign',
      children: [
        {
          label: 'Reportes',
          icon: 'file-text',
          route: '/admin/financial/reports',
        },
        {
          label: 'Facturación y Suscripciones',
          icon: 'credit-card',
          route: '/admin/financial/billing',
        },
        {
          label: 'Análisis de Costos',
          icon: 'bar-chart',
          route: '/admin/financial/cost-analysis',
        },
        {
          label: 'Flujo de Caja',
          icon: 'trending-up',
          route: '/admin/financial/cash-flow',
        },
      ],
    },
    {
      label: 'Analíticas e Inteligencia',
      icon: 'chart-line',
      children: [
        {
          label: 'Análisis Predictivo',
          icon: 'bar-chart',
          route: '/admin/analytics/predictive',
        },
        {
          label: 'Análisis Multi-Tienda',
          icon: 'store',
          route: '/admin/analytics/cross-store',
        },
      ],
    },
    {
      label: 'Inventario',
      icon: 'warehouse',
      children: [
        {
          label: 'Gestión de Stock',
          icon: 'package',
          route: '/admin/inventory/stock',
        },
        {
          label: 'Transferencias de Stock',
          icon: 'refresh-ccw',
          route: '/admin/inventory/transfers',
        },
        {
          label: 'Proveedores',
          icon: 'truck',
          route: '/admin/inventory/suppliers',
        },
        {
          label: 'Pronóstico de Demanda',
          icon: 'trending-up',
          route: '/admin/inventory/demand-forecast',
        },
      ],
    },
    {
      label: 'Operaciones',
      icon: 'truck',
      children: [
        {
          label: 'Gestión de Envíos',
          icon: 'truck',
          route: '/admin/operations/shipping',
        },
        {
          label: 'Compras',
          icon: 'cart',
          route: '/admin/operations/procurement',
        },
        {
          label: 'Gestión de Devoluciones',
          icon: 'rotate-ccw',
          route: '/admin/operations/returns',
        },
        {
          label: 'Optimización de Rutas',
          icon: 'globe-2',
          route: '/admin/operations/route-optimization',
        },
      ],
    },
    {
      label: 'Auditoría y Cumplimiento',
      icon: 'shield',
      children: [
        {
          label: 'Registros de Auditoría',
          icon: 'file-text',
          route: '/admin/audit/logs',
        },
        {
          label: 'Reportes de Cumplimiento',
          icon: 'file-check',
          route: '/admin/audit/compliance',
        },
        {
          label: 'Documentos Legales',
          icon: 'file-text',
          route: '/admin/audit/legal-docs',
        },
        {
          label: 'Copia de Seguridad y Recuperación',
          icon: 'backup',
          route: '/admin/audit/backup',
        },
      ],
    },
    {
      label: 'Configuración',
      icon: 'settings',
      children: [
        {
          label: 'Configuración de Aplicación',
          icon: 'sliders',
          route: '/admin/config/application',
        },
        {
          label: 'Políticas',
          icon: 'file-text',
          route: '/admin/config/policies',
        },
        {
          label: 'Integraciones',
          icon: 'link-2',
          route: '/admin/config/integrations',
        },
        {
          label: 'Impuestos',
          icon: 'credit-card',
          route: '/admin/config/taxes',
        },
        {
          label: 'Dominios',
          icon: 'globe-2',
          route: '/admin/config/domains',
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
