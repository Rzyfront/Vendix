import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { OnboardingModalComponent } from '../../../shared/components/onboarding-modal';
import { MenuFilterService } from '../../../core/services/menu-filter.service';
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
    IconComponent,
    OnboardingModalComponent,
  ],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        #sidebarRef
        [menuItems]="filteredMenuItems"
        [title]="(storeName$ | async) || 'Cargando...'"
        subtitle="Administrador de Tienda"
        [vlink]="(organizationSlug$ | async) || 'slug'"
        [domainHostname]="storeDomainHostname"
        [collapsed]="sidebarCollapsed"
        [showFooter]="true"
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
                  <span class="footer-info-value">{{ formatStoreType((storeType$ | async)) }}</span>
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
          !sidebarRef?.isMobile ? (sidebarCollapsed ? '4rem' : '15rem') : '0'
        "
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
          class="flex-1 overflow-y-auto overflow-x-hidden px-1 md:px-4 transition-all duration-300 ease-in-out"
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

  // Onboarding
  showOnboardingModal = false; // Will be set in ngOnInit based on actual status
  needsOnboarding = false;
  private destroy$ = new Subject<void>();

  // Panel UI menu filtering
  private menuFilterService = inject(MenuFilterService);

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
      label: 'E-commerce',
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
          route: '/admin/analytics/inventory/stock-levels',
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
      label: 'Configuración',
      icon: 'settings',
      children: [
        {
          label: 'General',
          icon: 'circle',
          route: '/admin/settings/general',
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
    private router: Router,
  ) {
    this.storeName$ = this.authFacade.userStoreName$;
    this.storeSlug$ = this.authFacade.userStoreSlug$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
    this.storeDomainHostname$ = this.authFacade.userDomainHostname$;
    this.storeType$ = this.authFacade.userStoreType$;
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

    // Subscribe to domain hostname for sidebar vlink
    this.storeDomainHostname$
      .pipe(takeUntil(this.destroy$))
      .subscribe((hostname) => {
        this.storeDomainHostname = hostname;
      });

    // Auto-colapsar sidebar en rutas específicas
    this.router.events.pipe(takeUntil(this.destroy$)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.sidebarCollapsed = this.COLLAPSE_SIDEBAR_ROUTES.some((route) =>
          event.urlAfterRedirects.startsWith(route),
        );
      }
    });

    // Check initial state
    const currentUrl = this.router.url;
    if (this.COLLAPSE_SIDEBAR_ROUTES.some(route => currentUrl.startsWith(route))) {
      this.sidebarCollapsed = true;
    }
  }

  // Rutas que deben colapsar la sidebar
  private readonly COLLAPSE_SIDEBAR_ROUTES = [
    '/admin/pos',
    '/admin/inventory/pop',
  ];

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
      'physical': 'Física',
      'online': 'Online',
      'hybrid': 'Híbrida',
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
    console.log('Onboarding completed:', event);
    // Update auth state to reflect onboarding completion
    this.authFacade.setOnboardingCompleted(true);
    // Reload user data to get updated organization/store info
    this.authFacade.loadUser();
  }
}
