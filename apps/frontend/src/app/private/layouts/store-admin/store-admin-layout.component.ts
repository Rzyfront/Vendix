import {
  Component,
  ViewChild,
  inject,
  signal,
  computed,
  DestroyRef,
  afterNextRender,
  effect,
  untracked,
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
import { TourModalComponent } from '../../../shared/components/tour/tour-modal/tour-modal.component';
import { TourService } from '../../../shared/components/tour/services/tour.service';
import { POS_TOUR_CONFIG } from '../../../shared/components/tour/configs/pos-tour.config';
import { MenuFilterService } from '../../../core/services/menu-filter.service';
import { SubscriptionBannerComponent } from '../../../shared/components/subscription-banner/subscription-banner.component';
import { FiscalObligationBannerComponent } from '../../../shared/components/fiscal-obligation-banner/fiscal-obligation-banner.component';
import { PaywallOutletComponent } from '../../../shared/components/ai-paywall-modal/paywall-outlet.component';
import { FiscalGateOutletComponent } from '../../../core/components/fiscal-gate-outlet.component';
import { WeeklyReportBannerComponent } from '../../modules/store/weekly-report/components/weekly-report-banner/weekly-report-banner.component';
import { WeeklyReportStoriesComponent } from '../../modules/store/weekly-report/components/weekly-report-stories/weekly-report-stories.component';
import { WeeklyReportSnapshot } from '../../modules/store/weekly-report/interfaces/weekly-report.interface';
import { WeeklyReportService } from '../../modules/store/weekly-report/services/weekly-report.service';
import { PqrAdminService } from '../../modules/store/pqr/services/pqr-admin.service';
import { ArrivalBannerComponent } from '../components/arrival-banner/arrival-banner.component';
import { SubscriptionFacade } from '../../../core/store/subscription/subscription.facade';
import { MembershipAmbientAccessService } from '../../../core/services/membership-ambient-access.service';
import type { StoreSettings } from '../../../core/models/store-settings.interface';
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
    TourModalComponent,
    SubscriptionBannerComponent,
    FiscalObligationBannerComponent,
    PaywallOutletComponent,
    FiscalGateOutletComponent,
    WeeklyReportBannerComponent,
    WeeklyReportStoriesComponent,
    ArrivalBannerComponent,
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

        <!-- Customer arrival banner (booking check-in alerts) -->
        <app-arrival-banner />

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

    <!-- F4 — Gate "no responsable de IVA" (driven by interceptor + form gate) -->
    <app-fiscal-gate-outlet />
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
  private ambientAccess = inject(MembershipAmbientAccessService);
  private destroyRef = inject(DestroyRef);

  /**
   * W4 — Ambient membership-access validation. Reads the store setting
   * `membership.ambient_access_enabled` from the auth-facade store-settings
   * signal. Combined with `authFacade.isGym()` it gates the background SSE
   * connection that pops a toast per gym access (see the effect in the
   * constructor).
   */
  readonly ambientAccessEnabled = computed<boolean>(
    () =>
      (this.authFacade.storeSettings() as StoreSettings | null)?.membership
        ?.ambient_access_enabled === true,
  );

  // --- UI state signals ---
  readonly sidebarCollapsed = signal(false);
  readonly sidebarReady = signal(false);
  readonly showTourModal = signal(false);
  readonly sidebarShimmer = signal(false);

  // ─── Weekly Report (Tu Semana en Vendix) ───────────────────────────────
  private readonly weeklyReportService = inject(WeeklyReportService);
  private readonly pqrAdminService = inject(PqrAdminService);
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
    return store?.logo_url || 'vlogomono.png';
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
      // Restaurant Operations (Restaurant Suite — Fase I). The whole group
      // is hidden by INDUSTRY_HIDDEN_MODULES for retail/manufacturing/service
      // stores; visible only when the store's industry includes `restaurant`.
      // Industry gating runs upstream in MenuFilterService.getModulesHiddenByIndustries.
      label: 'Operaciones de Restaurante',
      icon: 'utensils-crossed',
      children: [
        {
          label: 'Mesas',
          icon: 'square-stack',
          route: '/admin/restaurant-ops/tables',
        },
        {
          label: 'Comandas',
          icon: 'flame',
          route: '/admin/restaurant-ops/kds',
        },
        {
          label: 'Producción',
          icon: 'chef-hat',
          route: '/admin/restaurant-ops/production',
        },
        {
          label: 'Recetas',
          icon: 'book-open',
          route: '/admin/restaurant-ops/recipes',
        },
        {
          label: 'Cartas',
          icon: 'menu-square',
          route: '/admin/restaurant-ops/menus',
        },
      ],
    },
    {
      // Memberships (Membership Suite). Hidden by INDUSTRY_HIDDEN_MODULES for
      // every industry except `gym` and `service`; visible only when the
      // store's industry includes `gym` or `service`. Labels map to panel_ui
      // keys via MenuFilterService ('Zona Fit' → memberships, Accesos →
      // memberships_access, Miembros → memberships_members, Planes →
      // memberships_plans).
      label: 'Zona Fit',
      icon: 'dumbbell',
      children: [
        {
          label: 'Accesos',
          icon: 'door-open',
          route: '/admin/memberships/access',
        },
        {
          label: 'Miembros',
          icon: 'users',
          route: '/admin/memberships/members',
        },
        {
          label: 'Planes',
          icon: 'tag',
          route: '/admin/memberships/plans',
        },
      ],
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
        {
          label: 'Precios y Tarifas',
          icon: 'circle',
          route: '/admin/price-tiers',
        },
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
        {
          label: 'Números de Serie',
          icon: 'fingerprint',
          route: '/admin/inventory/serials',
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
          icon: 'star',
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
          icon: 'shopping-cart',
          route: '/admin/analytics/purchases',
          alwaysVisible: true,
        },
        {
          label: 'Reseñas',
          icon: 'star',
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
        {
          label: 'Nómina',
          icon: 'circle',
          route: '/admin/reports/payroll',
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
          label: 'PQRS',
          icon: 'message-square',
          route: '/admin/pqrs',
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

  /**
   * True when the current store has at least one PQR. Drives the
   * visibility of the "PQRS" sidebar entry — we hide it for stores with
   * zero PQRs (and re-show it as soon as the count goes above zero). Fed
   * by an HTTP fetch on store-context activation. Safe default `false`
   * so the entry stays hidden until we know otherwise; better to hide
   * than to flash a brand-new store with an empty mailbox.
   */
  readonly hasStorePqrs = signal<boolean>(false);

  // Reactive menu items as signal via toSignal.
  // Reacts to BOTH `canManageUsers` (Usuarios gate) and `hasStorePqrs`
  // (PQRS gate) — combineLatest emits only after both signals have
  // produced at least one value, so the menu tree stabilizes immediately
  // and updates on either condition flip.
  readonly filteredMenuItems = toSignal(
    combineLatest([
      toObservable(this.canManageUsers),
      toObservable(this.hasStorePqrs),
    ]).pipe(
      switchMap(([canManageUsers, hasStorePqrs]) =>
        this.menuFilterService.filterMenuItems(
          this.getBaseMenuItems(canManageUsers, hasStorePqrs),
        ),
      ),
    ),
    { initialValue: [] as MenuItem[] },
  );

  /**
   * Returns the base menu tree with two authorizacion-driven entry
   * removals applied:
   *   - "Usuarios" hidden when the logged-in user cannot manage users.
   *   - "PQRS" hidden when the store has no PQRs.
   *
   * Both checks are visibility-only — the route guards
   * (`manageUsersGuard`, the PQR list's own existence) are the real
   * security boundary. Filters run BEFORE panel_ui/scope/fiscal so they
   * stay scoped to this layout.
   */
  private getBaseMenuItems(
    canManageUsers: boolean,
    hasStorePqrs: boolean,
  ): MenuItem[] {
    let items = this.allMenuItems;
    if (!canManageUsers) {
      items = items.map((item) =>
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
    if (!hasStorePqrs) {
      items = items.map((item) =>
        item.children
          ? {
              ...item,
              children: item.children.filter(
                (child) => child.route !== '/admin/pqrs',
              ),
            }
          : item,
      );
    }
    return items;
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
    // ─── W4: Ambient membership-access validation ──────────────────────────
    // Connect the background SSE stream ONLY when the gym industry is active
    // AND the store setting `membership.ambient_access_enabled` is on;
    // disconnect otherwise. The effect tracks both signals; the connect/
    // disconnect side-effects run under `untracked` so we don't re-run on the
    // service's own connection-state signals (same pattern as KdsSseService).
    effect(() => {
      const shouldConnect =
        this.authFacade.isGym() && this.ambientAccessEnabled();
      untracked(() => {
        if (shouldConnect) {
          this.ambientAccess.connect();
        } else {
          this.ambientAccess.disconnect();
        }
      });
    });
    // Tear down the EventSource explicitly when the shell is destroyed.
    this.destroyRef.onDestroy(() => this.ambientAccess.disconnect());

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

    // ── PQR stats: hidratar `hasStorePqrs` cuando hay store context ──
    // The fetch fires when `currentStoreId` becomes non-null. We don't
    // re-fetch on store-type changes — env switches go through a fresh
    // layout mount which re-runs this effect.
    effect(() => {
      const storeId = this.currentStoreId();
      if (!storeId) return;
      // Guard against re-entry while an in-flight request is still pending
      // so we don't kick off duplicate fetches if the signal changes more
      // than once before the response lands.
      this.pqrAdminService
        .getStats()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            const total = res?.data?.total ?? 0;
            this.hasStorePqrs.set(total > 0);
          },
          error: () => {
            // Safe default: leave the entry hidden. Better to require
            // an explicit refresh than to show a broken inbox.
            this.hasStorePqrs.set(false);
          },
        });
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

    // Gate: the welcome/POS tour is an OWNER-only, post-onboarding flow.
    // - It must NEVER overlay the onboarding wizard. An owner with pending
    //   onboarding is held on /admin/onboarding by onboardingGuard, but this
    //   STORE_ADMIN layout still mounts underneath the overlay and would
    //   otherwise fire the tour on top of it.
    // - It must NEVER reach a non-owner (store staff share this layout).
    // Mirrors onboardingGuard exactly: owner = hasAnyRole(['owner','OWNER']),
    // done = organizations.onboarding === true (fail-closed when the flag is
    // absent, so an unknown state never leaks the tour).
    const isOwner = this.authFacade.hasAnyRole(['owner', 'OWNER']);
    const onboardingDone =
      this.authFacade.getCurrentUser()?.organizations?.onboarding === true;
    if (!isOwner || !onboardingDone) {
      return;
    }

    if (this.tourService.canShowTour(tourId)) {
      setTimeout(() => {
        this.showTourModal.set(true);
      }, 1500);
    }
  }

  toggleSidebar() {
    if (this.sidebarRef?.isMobile()) {
      this.sidebarRef.toggleSidebarState();
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }
}
