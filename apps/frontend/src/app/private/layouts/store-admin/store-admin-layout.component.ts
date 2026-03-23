import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { ConfigFacade } from '../../../core/store/config';
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { OnboardingModalComponent } from '../../../shared/components/onboarding-modal';
import { TourModalComponent } from '../../../shared/components/tour/tour-modal/tour-modal.component';
import { TourService } from '../../../shared/components/tour/services/tour.service';
import { POS_TOUR_CONFIG } from '../../../shared/components/tour/configs/pos-tour.config';
import { MenuFilterService } from '../../../core/services/menu-filter.service';
import { Observable, Subject, combineLatest } from 'rxjs';
import { takeUntil, map, distinctUntilChanged, skip, pairwise } from 'rxjs/operators';

@Component({
  selector: 'app-store-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SidebarComponent,
    HeaderComponent,
    IconComponent,
    OnboardingModalComponent,
    TourModalComponent,
  ],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        #sidebarRef
        [menuItems]="filteredMenuItems"
        [title]="(storeName$ | async) || 'Cargando...'"
        [logoUrl]="storeLogo$ | async"
        subtitle="Administrador de Tienda"
        [vlink]="(organizationSlug$ | async) || 'slug'"
        [domainHostname]="storeDomainHostname"
        [isVendixDomain]="isVendixDomain"
        [collapsed]="sidebarCollapsed"
        [showFooter]="true"
        [shimmer]="sidebarShimmer"
        (expandSidebar)="toggleSidebar()"
      >
        <!-- Footer Content -->
        <div slot="footer" class="sidebar-footer-content">
          <div class="footer-info-item">
            <div class="footer-info-row">
              <div class="footer-info-block footer-block-gradient-primary">
                <div class="footer-info-content">
                  <div class="footer-info-header">
                    <app-icon name="store" [size]="9"></app-icon>
                    <span class="footer-info-label">Type</span>
                  </div>
                  <span class="footer-info-value">{{
                    formatStoreType(storeType$ | async)
                  }}</span>
                </div>
              </div>
              <div class="footer-divider"></div>
              <div class="footer-info-block footer-block-gradient-secondary">
                <div class="footer-info-content">
                  <div class="footer-info-header">
                    <app-icon name="tag" [size]="9"></app-icon>
                    <span class="footer-info-label">Plan</span>
                  </div>
                  <span class="footer-info-value">Early Access Free Plan</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </app-sidebar>

      <!-- Main Content -->
      <div
        class="main-content flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out"
        [class.margin-desktop]="!sidebarRef?.isMobile"
        [style.margin-left]="
          !sidebarRef?.isMobile ? (sidebarCollapsed ? '3.5rem' : '12.5rem') : '0'
        "
        [style.--sidebar-width-current]="sidebarCollapsed ? '3.5rem' : '12.5rem'"
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
          class="flex-1 flex flex-col overflow-y-auto overflow-x-hidden px-1 md:px-4 transition-all duration-300 ease-in-out"
          style="background-color: var(--background);"
        >
          <div class="w-full grow shrink-0">
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

    <!-- Tour Modal -->
    <app-tour-modal [(isOpen)]="showTourModal" [tourConfig]="posTourConfig">
    </app-tour-modal>
  `,
  styleUrls: ['./store-admin-layout.component.scss'],
})
export class StoreAdminLayoutComponent implements OnInit, OnDestroy {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  sidebarCollapsed = false;
  currentPageTitle = 'Store Dashboard';
  currentVlink = 'store-admin';

  // Dynamic user data
  storeName$: Observable<string | null>;
  storeSlug$: Observable<string | null>;
  organizationSlug$: Observable<string | null>;
  storeDomainHostname$: Observable<string | null>;
  storeDomainHostname: string | null = null;
  storeType$: Observable<string | null>;
  storeLogo$: Observable<string | null>;
  isVendixDomain = false;

  // Onboarding
  showOnboardingModal = false; // Will be set in ngOnInit based on actual status
  needsOnboarding = false;
  private destroy$ = new Subject<void>();

  // Tour
  showTourModal = false;
  private tourService = inject(TourService);
  readonly posTourConfig = POS_TOUR_CONFIG;

  // Sidebar shimmer effect on store type change
  sidebarShimmer = false;

  // Panel UI menu filtering
  private menuFilterService = inject(MenuFilterService);
  private configFacade = inject(ConfigFacade);

  // ALL possible menu items (constant)
  private allMenuItems: MenuItem[] = [
    {
      label: 'Panel Principal',
      icon: 'home',
      route: '/admin/dashboard',
    },
    {
      label: 'Punto de Venta',
      icon: 'store',
      route: '/admin/pos',
    },
    {
      label: 'Órdenes',
      icon: 'cart',
      children: [
        {
          label: 'Ordenes de Venta',
          icon: 'circle',
          route: '/admin/orders/sales',
        },
        {
          label: 'Ordenes de Compra',
          icon: 'circle',
          route: '/admin/orders/purchase-orders',
        },
        {
          label: 'Cotizaciones',
          icon: 'circle',
          route: '/admin/orders/quotations',
        },
        {
          label: 'Plan Separe',
          icon: 'circle',
          route: '/admin/orders/layaway',
        },
        {
          label: 'Ventas a Crédito',
          icon: 'circle',
          route: '/admin/orders/credits',
        },
      ],
    },
    {
      label: 'Productos',
      icon: 'package',
      route: '/admin/products',
    },
    {
      label: 'Inventario',
      icon: 'warehouse',
      children: [
        {
          label: 'Punto de Compra',
          icon: 'circle',
          route: '/admin/inventory/pop',
        },
        {
          label: 'Ajustes de Stock',
          icon: 'circle',
          route: '/admin/inventory/adjustments',
        },
        {
          label: 'Transferencias',
          icon: 'circle',
          route: '/admin/inventory/transfers',
        },
        {
          label: 'Movimientos',
          icon: 'circle',
          route: '/admin/inventory/movements',
        },
        {
          label: 'Ubicaciones',
          icon: 'circle',
          route: '/admin/inventory/locations',
        },
        {
          label: 'Proveedores',
          icon: 'circle',
          route: '/admin/inventory/suppliers',
        },
      ],
    },
    {
      label: 'Clientes',
      icon: 'users',
      children: [
        {
          label: 'Todos los Clientes',
          icon: 'circle',
          route: '/admin/customers/all',
        },
        {
          label: 'Reseñas',
          icon: 'circle',
          route: '/admin/customers/reviews',
        },
      ],
    },
    {
      label: 'Tienda en línea',
      icon: 'shopping-bag',
      route: '/admin/ecommerce',
    },
    {
      label: 'Marketing',
      icon: 'megaphone',
      children: [
        {
          label: 'Promociones',
          icon: 'circle',
          route: '/admin/marketing/promotions',
        },
        {
          label: 'Cupones',
          icon: 'circle',
          route: '/admin/marketing/coupons',
        },
      ],
    },
    {
      label: 'Analíticas',
      icon: 'chart-line',
      children: [
        {
          label: 'Resumen',
          icon: 'circle',
          route: '/admin/analytics/overview',
        },
        {
          label: 'Centro de Analíticas',
          icon: 'circle',
          route: '/admin/analytics',
        },
        {
          label: 'Ventas',
          icon: 'circle',
          route: '/admin/analytics/sales/summary',
        },
        {
          label: 'Inventario',
          icon: 'circle',
          route: '/admin/analytics/inventory/overview',
        },
        {
          label: 'Productos',
          icon: 'circle',
          route: '/admin/analytics/products/performance',
        },
        {
          label: 'Clientes',
          icon: 'circle',
          route: '/admin/analytics/customers/summary',
        },
        {
          label: 'Financiero',
          icon: 'circle',
          route: '/admin/analytics/financial/profit-loss',
        },
      ],
    },
    {
      label: 'Gastos',
      icon: 'wallet',
      route: '/admin/expenses',
    },
    {
      label: 'Facturación',
      icon: 'file-text',
      route: '/admin/invoicing',
    },
    {
      label: 'Contabilidad',
      icon: 'book-open',
      children: [
        {
          label: 'Asientos Contables',
          icon: 'circle',
          route: '/admin/accounting/journal-entries',
        },
        {
          label: 'Periodos Fiscales',
          icon: 'circle',
          route: '/admin/accounting/fiscal-periods',
        },
        {
          label: 'Plan de Cuentas',
          icon: 'circle',
          route: '/admin/accounting/chart-of-accounts',
        },
        {
          label: 'Reportes',
          icon: 'circle',
          route: '/admin/accounting/reports',
        },
        {
          label: 'Retenciones',
          icon: 'circle',
          route: '/admin/accounting/withholding-tax',
        },
        {
          label: 'Info Exógena',
          icon: 'circle',
          route: '/admin/accounting/exogenous',
        },
        {
          label: 'ICA Municipal',
          icon: 'circle',
          route: '/admin/taxes/ica',
        },
      ],
    },
    {
      label: 'Datos Personales',
      icon: 'shield-check',
      route: '/admin/habeas-data',
    },
    {
      label: 'Nómina',
      icon: 'banknote',
      children: [
        {
          label: 'Empleados',
          icon: 'circle',
          route: '/admin/payroll/employees',
        },
        {
          label: 'Períodos de Nómina',
          icon: 'circle',
          route: '/admin/payroll/runs',
        },
        {
          label: 'Liquidaciones',
          icon: 'circle',
          route: '/admin/payroll/settlements',
        },
        {
          label: 'Adelantos',
          icon: 'circle',
          route: '/admin/payroll/advances',
        },
        {
          label: 'Configuración Nómina',
          icon: 'circle',
          route: '/admin/payroll/settings',
        },
      ],
    },
    {
      label: 'Ayuda',
      icon: 'help-circle',
      children: [
        {
          label: 'Soporte',
          icon: 'circle',
          route: '/admin/help/support',
        },
        {
          label: 'Centro de Ayuda',
          icon: 'circle',
          route: '/admin/help/center',
        },
      ],
    },
    {
      label: 'Configuración',
      icon: 'settings',
      children: [
        {
          label: 'General',
          icon: 'circle',
          route: '/admin/settings/general',
        },
        {
          label: 'Usuarios',
          icon: 'circle',
          route: '/admin/settings/users',
        },
        {
          label: 'Roles',
          icon: 'circle',
          route: '/admin/settings/roles',
        },
        {
          label: 'Caja Registradora',
          icon: 'circle',
          route: '/admin/cash-registers',
        },
        {
          label: 'Métodos de Pago',
          icon: 'circle',
          route: '/admin/settings/payments',
        },
        {
          label: 'Apariencia',
          icon: 'circle',
          route: '/admin/settings/appearance',
        },
        {
          label: 'Seguridad',
          icon: 'circle',
          route: '/admin/settings/security',
        },
        {
          label: 'Dominios',
          icon: 'circle',
          route: '/admin/settings/domains',
        },
        {
          label: 'Envíos',
          icon: 'circle',
          route: '/admin/settings/shipping',
        },
        {
          label: 'Documentos Legales',
          icon: 'circle',
          route: '/admin/settings/legal-documents',
        },
      ],
    },
  ];

  // Reactive menu items
  menuItems$: Observable<MenuItem[]> = this.menuFilterService.filterMenuItems(
    this.allMenuItems,
  );
  filteredMenuItems: MenuItem[] = [];

  constructor(
    private authFacade: AuthFacade,
    private onboardingWizardService: OnboardingWizardService,
  ) {
    this.storeName$ = this.authFacade.userStoreName$;
    this.storeSlug$ = this.authFacade.userStoreSlug$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
    this.storeDomainHostname$ = this.authFacade.userDomainHostname$;
    this.storeType$ = this.authFacade.userStoreType$;
    this.storeLogo$ = this.authFacade.userStore$.pipe(
      map((store) => {
        const domainConfig = this.configFacade.getCurrentConfig()?.domainConfig;
        if (domainConfig?.isMainVendixDomain) return 'vlogo.png';
        return store?.logo_url || null;
      }),
    );
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

    // Subscribe to filtered menu items based on panel_ui configuration
    this.menuItems$.pipe(takeUntil(this.destroy$)).subscribe((items) => {
      this.filteredMenuItems = items;
    });

    // Trigger shimmer animation when store_type changes (skip initial emission)
    combineLatest([
      this.authFacade.userStoreType$,
      this.authFacade.storeSettings$,
    ]).pipe(
      map(([loginType, settings]) => settings?.general?.store_type || loginType),
      distinctUntilChanged(),
      skip(1), // Skip initial value — only react to actual changes
      takeUntil(this.destroy$),
    ).subscribe(() => {
      this.sidebarShimmer = true;
      setTimeout(() => { this.sidebarShimmer = false; }, 950);
    });

    // Subscribe to domain hostname for sidebar vlink
    this.storeDomainHostname$
      .pipe(takeUntil(this.destroy$))
      .subscribe((hostname) => {
        this.storeDomainHostname = hostname;
      });

    // Resolve isVendixDomain for promotional tooltip
    this.isVendixDomain =
      !!this.configFacade.getCurrentConfig()?.domainConfig?.isVendixDomain;

    // Check if should show POS first sale tour
    this.checkAndStartPosTour();
  }

  /**
   * Check and start POS first sale tour for new users
   */
  private checkAndStartPosTour(): void {
    const tourId = 'pos-first-sale';
    if (this.tourService.canShowTour(tourId)) {
      setTimeout(() => {
        this.showTourModal = true;
      }, 1500);
    }
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

  formatStoreType(type: string | null): string {
    if (!type) return 'N/A';

    const typeMap: Record<string, string> = {
      physical: 'Física',
      online: 'Online',
      hybrid: 'Híbrida',
    };

    return typeMap[type] || type;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  breadcrumb = {
    parent: 'Tienda',
    current: 'Panel Principal',
  };

  user = {
    name: 'Jane Smith',
    role: 'Administrador de Tienda',
    initials: 'JS',
  };

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
    // Update auth state to reflect onboarding completion
    this.authFacade.setOnboardingCompleted(true);
    // Reload user data to get updated organization/store info
    this.authFacade.loadUser();
  }
}
