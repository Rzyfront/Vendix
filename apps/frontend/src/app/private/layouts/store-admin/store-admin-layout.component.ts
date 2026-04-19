import {
  Component,
  ViewChild,
  inject,
  signal,
  computed,
  DestroyRef,
  afterNextRender,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { combineLatest } from 'rxjs';
import { map, distinctUntilChanged, skip } from 'rxjs/operators';

@Component({
  selector: 'app-store-admin-layout',
  standalone: true,
  imports: [
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
        [menuItems]="filteredMenuItems()"
        [title]="storeName() || 'Cargando...'"
        [logoUrl]="storeLogo()"
        subtitle="Administrador de Tienda"
        [vlink]="storeSlug() || 'slug'"
        [domainHostname]="storeDomainHostname()"
        [isVendixDomain]="isVendixDomain()"
        [collapsed]="sidebarCollapsed()"
        [showFooter]="true"
        [shimmer]="sidebarShimmer()"
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
                    formatStoreType(storeType())
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
        [class.margin-desktop]="sidebarReady() && !sidebarRef?.isMobile()"
        [style.margin-left]="
          sidebarReady() && !sidebarRef?.isMobile() ? (sidebarCollapsed() ? '3.5rem' : '12.5rem') : '0'
        "
        [style.--sidebar-width-current]="sidebarCollapsed() ? '3.5rem' : '12.5rem'"
      >
        <!-- Header -->
        <app-header
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
export class StoreAdminLayoutComponent {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  private authFacade = inject(AuthFacade);
  private configFacade = inject(ConfigFacade);
  private onboardingWizardService = inject(OnboardingWizardService);
  private tourService = inject(TourService);
  private menuFilterService = inject(MenuFilterService);
  private destroyRef = inject(DestroyRef);

  // --- UI state signals ---
  readonly sidebarCollapsed = signal(false);
  readonly sidebarReady = signal(false);
  readonly showOnboardingModal = signal(false);
  readonly needsOnboarding = signal(false);
  readonly showTourModal = signal(false);
  readonly sidebarShimmer = signal(false);

  // --- Facade data as signals ---
  readonly storeName = toSignal(this.authFacade.userStoreName$, { initialValue: null });
  readonly storeSlug = toSignal(this.authFacade.userStoreSlug$, { initialValue: null });
  readonly storeType = toSignal(this.authFacade.userStoreType$, { initialValue: null });
  readonly storeDomainHostname = toSignal(this.authFacade.userDomainHostname$, { initialValue: null });

  // --- isVendixDomain: resolved once from config ---
  readonly isVendixDomain = signal(
    !!this.configFacade.getCurrentConfig()?.domainConfig?.isVendixDomain,
  );

  // --- storeLogo: computed from store$ + domainConfig ---
  private readonly storeSignal = toSignal(this.authFacade.userStore$, { initialValue: null });

  readonly storeLogo = computed(() => {
    const store = this.storeSignal();
    const domainConfig = this.configFacade.getCurrentConfig()?.domainConfig;
    if (domainConfig?.isMainVendixDomain) return 'vlogo.png';
    return store?.logo_url || null;
  });

  // --- Panel UI menu items ---
  // ALL possible menu items (constant)
  private readonly allMenuItems: MenuItem[] = [
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
          label: 'Remisiones',
          icon: 'circle',
          route: '/admin/orders/dispatch-notes',
        },
        {
          label: 'Plan Separe',
          icon: 'circle',
          route: '/admin/orders/layaway',
        },
        {
          label: 'Reservas',
          icon: 'calendar-clock',
          route: '/admin/reservations',
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
        {
          label: 'Recolección de Datos',
          icon: 'circle',
          route: '/admin/data-collection',
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
          label: 'Ventas',
          icon: 'circle',
          route: '/admin/analytics/sales/summary',
        },
        {
          label: 'Analíticas de Inventario',
          icon: 'circle',
          route: '/admin/analytics/inventory/overview',
        },
        {
          label: 'Analíticas de Productos',
          icon: 'circle',
          route: '/admin/analytics/products/performance',
        },
        {
          label: 'Analíticas de Clientes',
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
      label: 'Reportes',
      icon: 'file-bar-chart',
      route: '/admin/reports',
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
          route: '/admin/reports',
          queryParams: { category: 'accounting' },
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
        {
          label: 'Mapeo de Cuentas',
          icon: 'circle',
          route: '/admin/accounting/account-mappings',
        },
        {
          label: 'Flujos Contables',
          icon: 'circle',
          route: '/admin/accounting/flows',
        },
        {
          label: 'Cartera',
          icon: 'circle',
          route: '/admin/accounting/cartera',
        },
        {
          label: 'Cuentas por Cobrar',
          icon: 'circle',
          route: '/admin/accounting/receivables',
        },
        {
          label: 'Cuentas por Pagar',
          icon: 'circle',
          route: '/admin/accounting/payables',
        },
        {
          label: 'Cartera por Vencimiento',
          icon: 'circle',
          route: '/admin/accounting/aging',
        },
      ],
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
          label: 'Métodos de Envío',
          icon: 'circle',
          route: '/admin/settings/shipping',
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
          label: 'Documentos Legales',
          icon: 'circle',
          route: '/admin/settings/legal-documents',
        },
      ],
    },
  ];

  // Reactive menu items as signal via toSignal
  readonly filteredMenuItems = toSignal(
    this.menuFilterService.filterMenuItems(this.allMenuItems),
    { initialValue: [] as MenuItem[] },
  );

  readonly posTourConfig = POS_TOUR_CONFIG;

  breadcrumb = {
    parent: 'Tienda',
    current: 'Panel Principal',
  };

  user = {
    name: 'Jane Smith',
    role: 'Administrador de Tienda',
    initials: 'JS',
  };

  constructor() {
    // Mark sidebar as ready after first render
    afterNextRender(() => {
      this.sidebarReady.set(true);
    });

    // Shimmer on store_type change (skip initial emission)
    combineLatest([
      this.authFacade.userStoreType$,
      this.authFacade.storeSettings$,
    ]).pipe(
      map(([loginType, settings]) => settings?.general?.store_type || loginType),
      distinctUntilChanged(),
      skip(1),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      this.sidebarShimmer.set(true);
      setTimeout(() => { this.sidebarShimmer.set(false); }, 950);
    });

    // Onboarding needs subscription
    this.authFacade.needsOnboarding$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.needsOnboarding.set(false); // Temporalmente deshabilitado hasta desarrollar workflow
        this.updateOnboardingModal();
      });

    this.checkOnboardingWithRoleValidation();
    this.checkAndStartPosTour();
  }

  /**
   * Check and start POS first sale tour for new users
   */
  private checkAndStartPosTour(): void {
    const tourId = 'pos-first-sale';
    if (this.tourService.canShowTour(tourId)) {
      setTimeout(() => {
        this.showTourModal.set(true);
      }, 1500);
    }
  }

  private checkOnboardingWithRoleValidation(): void {
    const isOwner = this.authFacade.isOwner();
    if (!isOwner) {
      this.needsOnboarding.set(false);
      this.showOnboardingModal.set(false);
      return;
    }

    // this.needsOnboarding.set(!storeOnboarding);
    this.needsOnboarding.set(false); // Temporalmente deshabilitado hasta desarrollar workflow
    this.updateOnboardingModal();
  }

  private updateOnboardingModal(): void {
    const isOwner = this.authFacade.isOwner();
    if (!isOwner) {
      this.showOnboardingModal.set(false);
      return;
    }

    const currentUser = this.authFacade.getCurrentUser();
    const storeOnboarding = currentUser?.stores?.onboarding;
    const actuallyNeedsOnboarding = !storeOnboarding;

    this.showOnboardingModal.set(actuallyNeedsOnboarding && this.needsOnboarding());
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

  toggleSidebar() {
    if (this.sidebarRef?.isMobile()) {
      this.sidebarRef.toggleSidebarState();
    } else {
      this.sidebarCollapsed.update(v => !v);
    }
  }

  onOnboardingCompleted(event: any): void {
    this.authFacade.setOnboardingCompleted(true);
    this.authFacade.loadUser();
  }
}
