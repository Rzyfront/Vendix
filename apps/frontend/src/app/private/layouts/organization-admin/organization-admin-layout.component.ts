import {
  Component,
  ViewChild,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { OnboardingWizardService } from '../../../core/services/onboarding-wizard.service';
import { OnboardingModalComponent } from '../../../shared/components/onboarding-modal';
// S1.2 — SubscriptionBannerComponent removed from ORG_ADMIN. The banner is
// store-scoped only; org-level renders would either flash stale data or show
// the wrong tienda's status.
import { PaywallOutletComponent } from '../../../shared/components/ai-paywall-modal/paywall-outlet.component';
import { MenuFilterService } from '../../../core/services/menu-filter.service';

import { map } from 'rxjs/operators';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ConfigFacade } from '../../../core/store/config';

// Store related imports
import { OrganizationStoresService } from '../../../private/modules/organization/stores/services/organization-stores.service';
import {
  StoreListItem,
  StoreType,
} from '../../../private/modules/organization/stores/interfaces/store.interface';
import { EnvironmentSwitchService } from '../../../core/services/environment-switch.service';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-organization-admin-layout',
  standalone: true,
  imports: [
    RouterModule,
    SidebarComponent,
    HeaderComponent,
    OnboardingModalComponent,
    PaywallOutletComponent,
  ],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        #sidebarRef
        [menuItems]="filteredMenuItems()"
        [title]="organizationName() || 'Cargando...'"
        [logoUrl]="logoUrl()"
        subtitle="Administrador de Organización"
        [vlink]="organizationSlug() || 'slug'"
        [domainHostname]="organizationDomainHostname()"
        [collapsed]="sidebarCollapsed()"
        (expandSidebar)="toggleSidebar()"
      >
      </app-sidebar>

      <!-- Main Content -->
      <div
        class="main-content flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out"
        [class.margin-desktop]="!sidebarRef?.isMobile()"
        [style.margin-left]="
          !sidebarRef?.isMobile() ? (sidebarCollapsed() ? '3.5rem' : '12.5rem') : '0'
        "
      >
        <!-- Header (Fixed) -->
        <app-header
          (toggleSidebar)="toggleSidebar()"
        >
        </app-header>

        <!-- S1.2 — No subscription banner here: banner is store-scoped. -->

        <!-- Page Content (Scrollable) -->
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

    <!-- Onboarding Modal - Only render if onboarding is needed -->
    @if (needsOnboarding()) {
      <app-onboarding-modal
        [isOpen]="showOnboardingModal()"
        (isOpenChange)="showOnboardingModal.set($event)"
        (completed)="onOnboardingCompleted($event)"
      ></app-onboarding-modal>
    }

    <!-- Subscription paywall (driven by interceptor + access service) -->
    <app-paywall-outlet />
  `,
  styleUrls: ['./organization-admin-layout.component.scss'],
})
export class OrganizationAdminLayoutComponent {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);
  private readonly onboardingWizardService = inject(OnboardingWizardService);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly environmentSwitchService = inject(EnvironmentSwitchService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly menuFilterService = inject(MenuFilterService);
  private readonly configFacade = inject(ConfigFacade);

  // --- Signals from facade observables ---
  readonly organizationName = toSignal(this.authFacade.userOrganizationName$, {
    initialValue: null as string | null,
  });
  readonly organizationSlug = toSignal(this.authFacade.userOrganizationSlug$, {
    initialValue: null as string | null,
  });
  readonly organizationDomainHostname = toSignal(
    this.authFacade.userDomainHostname$,
    { initialValue: null as string | null },
  );
  readonly logoUrl = toSignal(
    this.authFacade.userOrganization$.pipe(
      map((org) => {
        const domainConfig = this.configFacade.getCurrentConfig()?.domainConfig;
        if (domainConfig?.isMainVendixDomain) return 'vlogo.png';
        return org?.logo_url || null;
      }),
    ),
    { initialValue: null as string | null },
  );
  readonly needsOrganizationOnboarding = toSignal(
    this.authFacade.needsOrganizationOnboarding$,
    { initialValue: false },
  );

  // --- Local state signals ---
  readonly sidebarCollapsed = signal(false);
  readonly showOnboardingModal = signal(false);
  readonly needsOnboarding = signal(false);
  readonly stores = signal<StoreListItem[]>([]);
  readonly isLoadingStores = signal(false);

  // --- ALL possible menu items (constant) ---
  private readonly allMenuItems: MenuItem[] = [
    {
      label: 'Panel Principal',
      icon: 'home',
      route: '/admin/dashboard',
    },
    {
      label: 'Tiendas',
      icon: 'store',
      children: [
        {
          label: 'Ver Todas las Tiendas',
          icon: '',
          route: '/admin/stores',
          alwaysVisible: true,
        },
      ],
    },
    {
      label: 'Usuarios',
      icon: 'users',
      route: '/admin/users',
    },
    {
      label: 'Inventario',
      icon: 'warehouse',
      children: [
        {
          label: 'Compras',
          icon: 'shopping-bag',
          route: '/admin/purchase-orders',
          alwaysVisible: true,
        },
        {
          label: 'Niveles de Stock',
          icon: '',
          route: '/admin/inventory/stock-levels',
          alwaysVisible: true,
        },
        {
          label: 'Ubicaciones',
          icon: '',
          route: '/admin/inventory/locations',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip: 'Disponible en modo ORGANIZATION',
        },
        {
          label: 'Movimientos',
          icon: '',
          route: '/admin/inventory/movements',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip: 'Disponible en modo ORGANIZATION',
        },
        {
          label: 'Proveedores',
          icon: '',
          route: '/admin/inventory/suppliers',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip: 'Disponible en modo ORGANIZATION',
        },
        {
          label: 'Transferencias',
          icon: '',
          route: '/admin/inventory/transfers',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip: 'Disponible en modo ORGANIZATION',
        },
        {
          label: 'Ajustes de Stock',
          icon: '',
          route: '/admin/inventory/adjustments',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip: 'Disponible en modo ORGANIZATION',
        },
        {
          label: 'Números de Serie',
          icon: '',
          route: '/admin/inventory/serial-numbers',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip: 'Disponible en modo ORGANIZATION',
        },
        {
          label: 'Lotes',
          icon: 'layers',
          route: '/admin/inventory/batches',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip: 'Disponible en modo ORGANIZATION',
        },
      ],
    },
    {
      label: 'Dominios',
      icon: 'globe',
      route: '/admin/domains',
    },
    {
      label: 'Roles',
      icon: 'shield',
      route: '/admin/roles',
    },
    {
      label: 'Auditoría y Cumplimiento',
      icon: 'eye',
      route: '/admin/audit/logs',
    },
    {
      label: 'Reportes',
      icon: 'bar-chart',
      children: [
        {
          label: 'Ventas',
          icon: '',
          route: '/admin/reports/sales',
          alwaysVisible: true,
        },
        {
          label: 'Inventario',
          icon: '',
          route: '/admin/reports/inventory',
          alwaysVisible: true,
        },
        {
          label: 'Financiero',
          icon: '',
          route: '/admin/reports/financial',
          alwaysVisible: true,
        },
      ],
    },
    {
      label: 'Contabilidad',
      icon: 'book-open',
      children: [
        {
          label: 'Plan de Cuentas',
          icon: '',
          route: '/admin/accounting/chart-of-accounts',
        },
        {
          label: 'Asientos Contables',
          icon: '',
          route: '/admin/accounting/journal-entries',
        },
        {
          label: 'Periodos Fiscales',
          icon: '',
          route: '/admin/accounting/fiscal-periods',
        },
        {
          label: 'Mapeo de Cuentas',
          icon: '',
          route: '/admin/accounting/account-mappings',
        },
      ],
    },
    {
      label: 'Nómina',
      icon: 'banknote',
      route: '/admin/payroll',
    },
    {
      label: 'Configuración',
      icon: 'settings',
      children: [
        {
          label: 'General',
          icon: 'sliders',
          route: '/admin/config/application',
        },
        {
          label: 'Modo operativo',
          icon: 'building',
          route: '/admin/settings/operating-scope',
        },
        {
          label: 'Métodos de Pago',
          icon: 'credit-card',
          route: '/admin/config/payment-methods',
        },
      ],
    },
  ];

  // --- Reactive filtered menu (base, without stores) ---
  private readonly baseFilteredMenuItems = toSignal(
    this.menuFilterService.filterMenuItems(this.allMenuItems),
    { initialValue: [] as MenuItem[] },
  );

  // --- Computed menu: base filtered + dynamic stores ---
  readonly filteredMenuItems = computed(() =>
    this.addDynamicStoresToMenu(this.baseFilteredMenuItems()),
  );

  constructor() {
    // Check onboarding status considering both organization state and user role
    this.checkOnboardingWithRoleValidation();

    // Subscribe to organization onboarding status from user data
    this.authFacade.needsOrganizationOnboarding$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((needsOnboarding: boolean) => {
        this.needsOnboarding.set(needsOnboarding);
        this.updateOnboardingModal();
      });

    // Load stores for sidebar
    this.loadStores();
  }

  private checkOnboardingWithRoleValidation(): void {
    const isOwner = this.authFacade.isOwner();
    if (!isOwner) {
      this.needsOnboarding.set(false);
      this.showOnboardingModal.set(false);
      return;
    }

    const currentUser = this.authFacade.getCurrentUser();
    const organizationOnboarding = currentUser?.organizations?.onboarding;

    this.needsOnboarding.set(!organizationOnboarding);
    this.updateOnboardingModal();
  }

  private updateOnboardingModal(): void {
    const isOwner = this.authFacade.isOwner();
    if (!isOwner) {
      this.showOnboardingModal.set(false);
      return;
    }

    const currentUser = this.authFacade.getCurrentUser();
    const organizationOnboarding = currentUser?.organizations?.onboarding;
    const actuallyNeedsOnboarding = !organizationOnboarding;

    this.showOnboardingModal.set(actuallyNeedsOnboarding && this.needsOnboarding());
  }

  loadStores(): void {
    this.isLoadingStores.set(true);

    this.storesService.getStores().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.stores.set(
            response.data.map((store: any) => ({
              id: store.id,
              name: store.name,
              slug: store.slug,
              store_code: store.store_code || '',
              store_type: store.store_type || StoreType.PHYSICAL,
              timezone: store.timezone || 'America/Bogota',
              is_active: store.is_active !== undefined ? store.is_active : true,
              manager_user_id: store.manager_user_id,
              organization_id: store.organization_id,
              created_at: store.created_at || new Date().toISOString(),
              updated_at: store.updated_at || new Date().toISOString(),
              onboarding: store.onboarding || false,
              organizations: store.organizations || {
                id: store.organization_id,
                name: 'Unknown',
                slug: 'unknown',
              },
              addresses: store.addresses || [],
              _count: store._count || { products: 0, orders: 0, store_users: 0 },
            })),
          );
        } else {
          this.stores.set([]);
        }
        this.isLoadingStores.set(false);
      },
      error: (error) => {
        console.error('Error loading stores:', error);
        this.stores.set([]);
        this.isLoadingStores.set(false);
      },
    });
  }

  /**
   * Adds dynamic stores to the already-filtered menu.
   * Only modifies the "Tiendas" item if it's visible.
   */
  private addDynamicStoresToMenu(filteredItems: MenuItem[]): MenuItem[] {
    return filteredItems.map((item: MenuItem) => {
      if (item.label === 'Tiendas' && item.children) {
        const staticChildren = item.children || [];
        return {
          ...item,
          children: [
            ...staticChildren,
            ...this.stores().map((store) => ({
              label: store.name,
              icon: '',
              action: () => this.switchToStoreEnvironment(store),
              alwaysVisible: true,
            })),
          ],
        };
      }
      return item;
    });
  }

  async switchToStoreEnvironment(store: StoreListItem): Promise<void> {
    try {
      const confirmed = await this.dialogService.confirm(
        {
          title: 'Cambiar al entorno de la tienda',
          message: `¿Deseas cambiar al entorno de administración de la tienda <strong class="text-lg font-semibold text-[var(--color-primary)]">${store.name}</strong>?<br><br>Serás redirigido al panel de administración de STORE_ADMIN para esta tienda específica.`,
          confirmText: 'Cambiar de entorno',
          cancelText: 'Cancelar',
          confirmVariant: 'primary',
        },
        {
          size: 'md',
          customClasses: 'store-switch-modal',
        },
      );

      if (confirmed) {
        const success =
          await this.environmentSwitchService.performEnvironmentSwitch(
            'STORE_ADMIN',
            store.slug,
          );

        if (success) {
          this.toastService.success(
            `Cambiado al entorno de la tienda "${store.name}"`,
          );
        } else {
          this.toastService.error('No se pudo cambiar al entorno de la tienda');
        }
      }
    } catch (error) {
      console.error('Error switching to store environment:', error);
      this.toastService.error('Error al cambiar al entorno de la tienda');
    }
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
