import {
  Component,
  ViewChild,
  inject,
  signal,
  computed,
  DestroyRef,
  afterNextRender,
  effect,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  toSignal,
  toObservable,
  takeUntilDestroyed,
} from '@angular/core/rxjs-interop';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { ConfigFacade } from '../../../core/store/config';
import { OnboardingModalComponent } from '../../../shared/components/onboarding-modal';
import { TourModalComponent } from '../../../shared/components/tour/tour-modal/tour-modal.component';
import { TourService } from '../../../shared/components/tour/services/tour.service';
import { POS_TOUR_CONFIG } from '../../../shared/components/tour/configs/pos-tour.config';
import { MenuFilterService } from '../../../core/services/menu-filter.service';
import { SubscriptionBannerComponent } from '../../../shared/components/subscription-banner/subscription-banner.component';
import { FiscalObligationBannerComponent } from '../../../shared/components/fiscal-obligation-banner/fiscal-obligation-banner.component';
import { PaywallOutletComponent } from '../../../shared/components/ai-paywall-modal/paywall-outlet.component';
import { WeeklyReportBannerComponent } from '../../modules/store/weekly-report/components/weekly-report-banner/weekly-report-banner.component';
import { WeeklyReportStoriesComponent } from '../../modules/store/weekly-report/components/weekly-report-stories/weekly-report-stories.component';
import { WeeklyReportSnapshot } from '../../modules/store/weekly-report/interfaces/weekly-report.interface';
import { WeeklyReportService } from '../../modules/store/weekly-report/services/weekly-report.service';
import { SubscriptionFacade } from '../../../core/store/subscription/subscription.facade';
import { combineLatest } from 'rxjs';
import { map, distinctUntilChanged, skip, switchMap } from 'rxjs/operators';

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
    SubscriptionBannerComponent,
    FiscalObligationBannerComponent,
    PaywallOutletComponent,
    WeeklyReportBannerComponent,
    WeeklyReportStoriesComponent,
  ],
  template: `
    <div class="admin-layout-shell flex">
      <!-- Sidebar -->
      <app-sidebar
        #sidebarRef
        [menuItems]="filteredMenuItems()"
        [title]="storeName() || 'Cargando...'"
        [logoUrl]="storeLogo()"
        subtitle="Administrador de Tienda"
        [vlink]="storeSlug() || 'slug'"
        [domainHostname]="storeDomainHostname()"
        [collapsed]="sidebarCollapsed()"
        [showFooter]="true"
        [shimmer]="sidebarShimmer()"
        (expandSidebar)="toggleSidebar()"
      >
        <!-- Footer Content -->
        <div slot="footer" class="sidebar-footer-content">
          @if (canManageSubscription()) {
          <a
            class="footer-info-item footer-info-item--clickable"
            routerLink="/admin/subscription"
            role="button"
            [attr.aria-label]="
              'Ir al módulo de suscripción · ' + planDisplayName()
            "
          >
            <div class="footer-info-row">
              <div class="footer-info-block footer-block-gradient-primary">
                <div class="footer-plan-content">
                  @if (cyclePercent() !== null) {
                    <div
                      class="footer-progress-ring"
                      role="img"
                      [attr.aria-label]="
                        'Consumo del ciclo: ' + cyclePercent() + ' por ciento'
                      "
                    >
                      <svg
                        viewBox="0 0 36 36"
                        class="ring-svg"
                        aria-hidden="true"
                      >
                        <circle
                          class="ring-bg"
                          cx="18"
                          cy="18"
                          r="15.915"
                        ></circle>
                        <circle
                          class="ring-fg"
                          cx="18"
                          cy="18"
                          r="15.915"
                          [attr.stroke-dasharray]="cyclePercent() + ', 100'"
                        ></circle>
                      </svg>
                      <span class="ring-percent">{{ cyclePercent() }}%</span>
                    </div>
                  }
                  <div class="footer-plan-info">
                    <div class="footer-info-header">
                      <app-icon name="tag" [size]="9"></app-icon>
                      <span class="footer-info-label">Plan</span>
                      @if (hasPendingChange()) {
                        <span
                          class="pending-plan-badge"
                          title="Cambio de plan pendiente de pago"
                        >
                          <app-icon name="clock" [size]="9"></app-icon>
                        </span>
                      }
                    </div>
                    <span class="footer-info-value">{{
                      planDisplayName()
                    }}</span>
                    @if (hasPendingChange()) {
                      <span class="pending-plan-label">Cambio pendiente</span>
                    }
                  </div>
                </div>
              </div>
            </div>
          </a>
          }
        </div>
      </app-sidebar>

      <!-- Main Content -->
      <div
        class="main-content flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out"
        [class.margin-desktop]="sidebarReady() && !sidebarRef?.isMobile()"
        [style.margin-left]="
          sidebarReady() && !sidebarRef?.isMobile()
            ? sidebarCollapsed()
              ? '3.5rem'
              : '12.5rem'
            : '0'
        "
        [style.--sidebar-width-current]="
          sidebarCollapsed() ? '3.5rem' : '12.5rem'
        "
      >
        <!-- Header -->
        <app-header (toggleSidebar)="toggleSidebar()"> </app-header>

        <app-subscription-banner />
        <app-fiscal-obligation-banner />

        <!-- Weekly Report banner (Tu Semana en Vendix) -->
        @if (currentStoreId()) {
          <app-weekly-report-banner
            (openTakeover)="onOpenWeeklyReport($event)"
          ></app-weekly-report-banner>
        }

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

    <!-- Onboarding Modal - Only render if onboarding is needed -->
    @if (needsOnboarding()) {
      <app-onboarding-modal
        [(isOpen)]="showOnboardingModal"
        (completed)="onOnboardingCompleted($event)"
      ></app-onboarding-modal>
    }

    <!-- Weekly Report Takeover (Tu Semana en Vendix) -->
    @if (showWeeklyReportTakeover() && weeklyReportSnapshot(); as wr) {
      <app-weekly-report-stories
        [report]="wr"
        (closed)="onCloseWeeklyReport()"
        (viewed)="onCloseWeeklyReport()"
      ></app-weekly-report-stories>
    }

    <!-- Tour Modal -->
    <app-tour-modal [(isOpen)]="showTourModal" [tourConfig]="posTourConfig">
    </app-tour-modal>

    <!-- Subscription paywall (driven by interceptor + access service) -->
    <app-paywall-outlet />
  `,
  styleUrls: ['./store-admin-layout.component.scss'],
})
export class StoreAdminLayoutComponent {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  private authFacade = inject(AuthFacade);
  private configFacade = inject(ConfigFacade);
  private tourService = inject(TourService);
  private menuFilterService = inject(MenuFilterService);
  private subscriptionFacade = inject(SubscriptionFacade);
  private destroyRef = inject(DestroyRef);

  // --- UI state signals ---
  readonly sidebarCollapsed = signal(false);
  readonly sidebarReady = signal(false);
  readonly showOnboardingModal = signal(false);
  readonly needsOnboarding = signal(false);
  readonly showTourModal = signal(false);
  readonly sidebarShimmer = signal(false);

  // ─── Weekly Report (Tu Semana en Vendix) ───────────────────────────────
  private readonly weeklyReportService = inject(WeeklyReportService);
  /** Store actual para condicionar la inyección al contexto STORE_ADMIN. */
  readonly currentStoreId = computed<number | null>(
    () => (this.storeSignal() as any)?.id ?? null,
  );


  /** Snapshot visible actualmente en el takeover (signal). */
  readonly weeklyReportSnapshot = signal<WeeklyReportSnapshot | null>(null);
  /** Toggle del modal takeover. */
  readonly showWeeklyReportTakeover = signal<boolean>(false);

  /** Abre el takeover con el snapshot emitido por el banner. */
  onOpenWeeklyReport(snapshot: WeeklyReportSnapshot): void {
    this.weeklyReportSnapshot.set(snapshot);
    this.showWeeklyReportTakeover.set(true);
  }

  /** Cierra el takeover. */
  onCloseWeeklyReport(): void {
    this.showWeeklyReportTakeover.set(false);
    // Refresca para reflejar el nuevo viewed_at.
    this.weeklyReportService
      .refresh()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  // --- Facade data as signals ---
  readonly storeName = toSignal(this.authFacade.userStoreName$, {
    initialValue: null,
  });
  readonly storeSlug = toSignal(this.authFacade.userStoreSlug$, {
    initialValue: null,
  });
  readonly storeDomainHostname = toSignal(this.authFacade.userDomainHostname$, {
    initialValue: null,
  });

  // --- storeLogo: computed from store$ + domainConfig ---
  private readonly storeSignal = toSignal(this.authFacade.userStore$, {
    initialValue: null,
  });

  readonly storeLogo = computed(() => {
    const store = this.storeSignal();
    const domainConfig = this.configFacade.getCurrentConfig()?.domainConfig;
    if (domainConfig?.isMainVendixDomain) return 'vlogo.png';
    return store?.logo_url || null;
  });

  readonly planDisplayName = computed(() => {
    const sub: any = this.subscriptionFacade.current();
    // RNC-39 — `no_plan` stores must NOT show the placeholder plan name in
    // the sidebar footer. Backend strips `plan` from the `current` payload
    // when state='no_plan' so this fallback is the canonical render.
    if (!sub || sub.state === 'no_plan') return 'Sin plan activo';
    // Trial subscriptions are granted by `plan_id`; `paid_plan_id` is null by
    // design until a real payment clears. Show the trial plan instead of the
    // paid-plan fallback.
    if (sub.state === 'trial' || sub.state === 'trialing') {
      return sub.plan?.name ?? sub.paid_plan?.name ?? 'Plan de prueba';
    }
    if (
      sub.state === 'active' &&
      sub.plan_id != null &&
      sub.paid_plan_id == null
    ) {
      return sub.plan?.name ?? 'Plan activo';
    }
    // RNC-PaidPlan — Always reflect the PAID plan; never the pending one.
    // `paid_plan_id == null` means the user is mid initial-purchase, so
    // there is no plan to display.
    if (sub.paid_plan_id == null) return 'Sin plan activo';
    return sub.paid_plan?.name ?? sub.plan?.name ?? 'Sin plan activo';
  });

  /**
   * RNC-PaidPlan — Drives the "CAMBIO PENDIENTE" sidebar badge. Reads from
   * the unified subscription selector so it stays in lockstep with the
   * banners on the subscription page.
   */
  readonly hasPendingChange = computed(() => {
    const kind = this.subscriptionFacade.subscriptionUiState().kind;
    return (
      kind === 'pending_initial_payment' || kind === 'pending_change_abandoned'
    );
  });

  /**
   * Cycle consumption % for the sidebar footer ring. Returns `null` when no
   * meaningful cycle exists (no plan / mid-purchase) so the template can hide
   * the ring entirely. Logic mirrors `MySubscriptionComponent.cycleProgress`
   * (current_period_end-driven) so the sidebar and the page never disagree.
   */
  readonly cyclePercent = computed<number | null>(() => {
    const sub: any = this.subscriptionFacade.current();
    if (!sub || sub.state === 'no_plan') return null;

    const DAY_MS = 1000 * 60 * 60 * 24;
    const state = sub.state;

    if (state === 'trialing' || state === 'trial') {
      const start = sub.current_period_start;
      const trialEnd = sub.trial_ends_at;
      if (!start || !trialEnd) return null;
      const total = new Date(trialEnd).getTime() - new Date(start).getTime();
      if (total <= 0) return 0;
      const elapsed = Date.now() - new Date(start).getTime();
      return Math.round(Math.min(100, Math.max(0, (elapsed / total) * 100)));
    }

    if (sub.paid_plan_id == null && sub.plan_id == null) return null;

    const start = sub.current_period_start;
    const end = sub.current_period_end;
    if (!start || !end) return null;
    const totalMs = new Date(end).getTime() - new Date(start).getTime();
    if (totalMs <= 0) return 0;
    const elapsedMs = Date.now() - new Date(start).getTime();
    return Math.round(Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)));
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
      label: 'Despacho',
      icon: 'truck',
      children: [
        {
          label: 'Remisiones',
          icon: 'circle',
          route: '/admin/orders/dispatch-notes',
        },
        {
          label: 'Planillas de Ruta',
          icon: 'truck',
          route: '/admin/orders/planillas',
        },
        {
          label: 'Métodos de Envío',
          icon: 'circle',
          route: '/admin/settings/shipping',
        },
        {
          label: 'Flota',
          icon: 'circle',
          route: '/admin/orders/fleet',
        },
      ],
    },
    {
      label: 'Productos',
      icon: 'package',
      children: [
        { label: 'Lista', icon: 'list', route: '/admin/products' },
        {
          label: 'Categorías',
          icon: 'layers',
          route: '/admin/products/categories',
        },
        { label: 'Marcas', icon: 'tag', route: '/admin/products/brands' },
      ],
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
        {
          label: 'Anuncios',
          icon: 'image',
          route: '/admin/marketing/anuncios',
        },
        {
          label: 'Social Sales',
          icon: 'message-circle',
          route: '/admin/marketing/social-sales',
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
          alwaysVisible: true,
        },
        {
          label: 'Ventas',
          icon: 'circle',
          route: '/admin/analytics/sales',
          alwaysVisible: true,
        },
        {
          label: 'Inventario',
          icon: 'circle',
          route: '/admin/analytics/inventory',
          alwaysVisible: true,
        },
        {
          label: 'Productos',
          icon: 'circle',
          route: '/admin/analytics/products',
          alwaysVisible: true,
        },
        {
          label: 'Clientes',
          icon: 'circle',
          route: '/admin/analytics/customers',
          alwaysVisible: true,
        },
        {
          label: 'Compras',
          icon: 'circle',
          route: '/admin/analytics/purchases',
          alwaysVisible: true,
        },
        {
          label: 'Reseñas',
          icon: 'circle',
          route: '/admin/analytics/reviews',
          alwaysVisible: true,
        },
        {
          label: 'Financiero',
          icon: 'circle',
          route: '/admin/analytics/financial',
          alwaysVisible: true,
        },
      ],
    },
    {
      label: 'Reportes',
      icon: 'file-bar-chart',
      children: [
        {
          label: 'Resumen',
          icon: 'circle',
          route: '/admin/reports/overview',
          alwaysVisible: true,
        },
        {
          label: 'Ventas',
          icon: 'circle',
          route: '/admin/reports/sales',
          alwaysVisible: true,
        },
        {
          label: 'Inventario',
          icon: 'circle',
          route: '/admin/reports/inventory',
          alwaysVisible: true,
        },
        {
          label: 'Productos',
          icon: 'circle',
          route: '/admin/reports/products',
          alwaysVisible: true,
        },
        {
          label: 'Clientes',
          icon: 'circle',
          route: '/admin/reports/customers',
          alwaysVisible: true,
        },
        {
          label: 'Compras',
          icon: 'circle',
          route: '/admin/reports/purchases',
          alwaysVisible: true,
        },
        {
          label: 'Reseñas',
          icon: 'circle',
          route: '/admin/reports/reviews',
          alwaysVisible: true,
        },
        {
          label: 'Financiero',
          icon: 'circle',
          route: '/admin/reports/financial',
          alwaysVisible: true,
        },
        {
          label: 'Contabilidad',
          icon: 'circle',
          route: '/admin/reports/accounting',
          alwaysVisible: true,
        },
      ],
    },
    {
      label: 'Gastos',
      icon: 'wallet',
      route: '/admin/expenses',
    },
    {
      // Restaurant Operations (Restaurant Suite — Fase I). The whole group
      // is hidden by INDUSTRY_HIDDEN_MODULES for retail/manufacturing/service
      // stores; visible only when the store's industry includes `restaurant`.
      // Industry gating runs upstream in MenuFilterService.getModulesHiddenByIndustries.
      label: 'Operaciones de Restaurante',
      icon: 'utensils-crossed',
      children: [
        {
          label: 'Recetas',
          icon: 'book-open',
          route: '/admin/restaurant-ops/recipes',
        },
        {
          label: 'Producción',
          icon: 'chef-hat',
          route: '/admin/restaurant-ops/production',
        },
        {
          label: 'Comandas',
          icon: 'flame',
          route: '/admin/restaurant-ops/kds',
        },
        {
          label: 'Mesas',
          icon: 'square-stack',
          route: '/admin/restaurant-ops/tables',
        },
        {
          label: 'Cartas',
          icon: 'menu-square',
          route: '/admin/restaurant-ops/menus',
        },
      ],
    },
    {
      // Fiscal umbrella — one sidebar group consolidating every fiscal surface
      // for stores that OWN their fiscal scope. Each child is a leaf whose
      // module renders its own sub-sections as internal sticky-header tabs
      // (invoicing/accounting/payroll shells + the fiscal compliance hub).
      // The whole group hides when the ORGANIZATION owns fiscal
      // (requiredFiscalScope: 'STORE'). When fiscal is NOT yet activated, only
      // "Operación fiscal" stays visible (no requiresFiscalArea) so the owner
      // can always reach the activation wizard; the operational modules appear
      // once their area reaches ACTIVE/LOCKED.
      label: 'Fiscal',
      icon: 'landmark',
      requiredFiscalScope: 'STORE',
      children: [
        {
          label: 'Operación fiscal',
          icon: 'clipboard-list',
          route: '/admin/fiscal',
          requiredFiscalScope: 'STORE',
        },
        {
          label: 'Facturación',
          icon: 'file-text',
          route: '/admin/invoicing',
          requiredFiscalScope: 'STORE',
          requiresFiscalArea: 'invoicing',
        },
        {
          label: 'Contabilidad',
          icon: 'book-open',
          route: '/admin/accounting',
          requiredFiscalScope: 'STORE',
          requiresFiscalArea: 'accounting',
        },
        {
          label: 'Nómina',
          icon: 'banknote',
          route: '/admin/payroll',
          requiredFiscalScope: 'STORE',
          requiresFiscalArea: 'payroll',
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
          label: 'Precios y Tarifas',
          icon: 'circle',
          route: '/admin/price-tiers',
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

  /**
   * Authorization of the LOGGED-IN user to manage store users. Drives both
   * the "Usuarios" menu-entry visibility here and gates the settings/users
   * route (`manageUsersGuard`). Prefers the named permission
   * `store:users:update`, falling back to owner/admin role. Backed by
   * AuthFacade signals so it stays reactive (zoneless-safe).
   *
   * Note: this is authorization, not panel_ui visibility — the "Usuarios"
   * entry has no dedicated panel_ui key, so it is gated here by removing the
   * menu item before the panel_ui/scope/fiscal `filterMenuItems` pass.
   */
  readonly canManageUsers = computed<boolean>(
    () =>
      this.authFacade.hasPermission('store:users:update') ||
      this.authFacade.isOwner() ||
      this.authFacade.isAdmin(),
  );

  /**
   * Authorization of the LOGGED-IN user to manage the store subscription.
   * Drives the sidebar footer subscription card visibility here and mirrors
   * the `subscriptionManagementGuard` that gates the `/admin/subscription`
   * route. Owner-only (owner + super_admin). Backed by AuthFacade signals so
   * it stays reactive (zoneless-safe).
   */
  readonly canManageSubscription = computed<boolean>(
    () =>
      this.authFacade.isOwner() ||
      this.authFacade.hasAnyRole([
        'owner',
        'OWNER',
        'super_admin',
        'STORE_OWNER',
        'ORG_OWNER',
      ]),
  );

  // Reactive menu items as signal via toSignal.
  // Reacts to `canManageUsers`: the "Usuarios" entry is stripped from the
  // base tree for users who cannot manage users, then the resulting tree is
  // passed through the existing panel_ui/scope/fiscal filter pipeline.
  readonly filteredMenuItems = toSignal(
    toObservable(this.canManageUsers).pipe(
      switchMap((canManageUsers) =>
        this.menuFilterService.filterMenuItems(
          this.getBaseMenuItems(canManageUsers),
        ),
      ),
    ),
    { initialValue: [] as MenuItem[] },
  );

  /**
   * Returns the base menu tree, removing the "Usuarios" entry from the
   * "Configuración" group when the logged-in user cannot manage users.
   * Visibility-only defense in depth — the route guard is the real boundary.
   */
  private getBaseMenuItems(canManageUsers: boolean): MenuItem[] {
    if (canManageUsers) return this.allMenuItems;
    return this.allMenuItems.map((item) =>
      item.children
        ? {
            ...item,
            children: item.children.filter(
              (child) => child.route !== '/admin/settings/users',
            ),
          }
        : item,
    );
  }

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
    // ─── Weekly Report: fetch inicial cuando el store está disponible ───
    // Se ejecuta desde el layout (no desde el banner) para garantizar que
    // el reporte se cargue apenas el usuario llega al dashboard, sin
    // depender del ciclo de vida del banner (que puede no montarse si
    // currentStoreId() es null en algún edge case). El banner re-usa el
    // signal del servicio y se renderiza reactivamente cuando _latest
    // cambia.
    effect(() => {
      const storeId = this.currentStoreId();
      const report = this.weeklyReportService.latestReport();
      // Si no hay reporte todavía, cargarlo.
      if (storeId && !report) {
        this.weeklyReportService
          .getLatest()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();
        return;
      }
      // Si hay un reporte no visto y el takeover no está abierto, abrirlo
      // automáticamente la primera vez.
      if (
        report &&
        !report.viewed_at &&
        !this.showWeeklyReportTakeover() &&
        !this.weeklyReportSnapshot()
      ) {
        this.weeklyReportSnapshot.set(report);
        this.showWeeklyReportTakeover.set(true);
      }
    });

    // Mark sidebar as ready after first render
    afterNextRender(() => {
      this.sidebarReady.set(true);
    });

    // Shimmer on store_type change (skip initial emission)
    combineLatest([
      this.authFacade.userStoreType$,
      this.authFacade.storeSettings$,
    ])
      .pipe(
        map(
          ([loginType, settings]) => settings?.general?.store_type || loginType,
        ),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.sidebarShimmer.set(true);
        setTimeout(() => {
          this.sidebarShimmer.set(false);
        }, 950);
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

    // S1.2 — Notify the subscription feature about store-context changes
    // (including initial). This wipes any stale data from the previous
    // store and triggers a fresh `loadCurrent()` via the effect — so the
    // sidebar plan name and banner cannot show the previous store's data.
    this.authFacade.userStore$
      .pipe(
        map((s: any) => (s?.id ?? null) as number | null),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((storeId) => {
        this.subscriptionFacade.contextChanged(storeId);
      });
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

    this.showOnboardingModal.set(
      actuallyNeedsOnboarding && this.needsOnboarding(),
    );
  }

  toggleSidebar() {
    if (this.sidebarRef?.isMobile()) {
      this.sidebarRef.toggleSidebarState();
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }

  onOnboardingCompleted(event: any): void {
    this.authFacade.setOnboardingCompleted(true);
    this.authFacade.loadUser();
  }
}
