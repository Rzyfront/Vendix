import {
  Component,
  ViewChild,
  inject,
  signal,
  computed,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
// S1.2 — SubscriptionBannerComponent removed from ORG_ADMIN. The banner is
// store-scoped only; org-level renders would either flash stale data or show
// the wrong tienda's status.
import { PaywallOutletComponent } from '../../../shared/components/ai-paywall-modal/paywall-outlet.component';
import { FiscalObligationBannerComponent } from '../../../shared/components/fiscal-obligation-banner/fiscal-obligation-banner.component';
import { MenuFilterService } from '../../../core/services/menu-filter.service';

import { map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

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
    PaywallOutletComponent,
    FiscalObligationBannerComponent,
  ],
  template: `
    <div class="admin-layout-shell flex">
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
          !sidebarRef?.isMobile()
            ? sidebarCollapsed()
              ? '3.5rem'
              : '12.5rem'
            : '0'
        "
        [style.--sidebar-width-current]="
          sidebarCollapsed() ? '3.5rem' : '12.5rem'
        "
      >
        <!-- Header (Fixed) -->
        <app-header (toggleSidebar)="toggleSidebar()"> </app-header>

        <!-- S1.2 — No subscription banner here: banner is store-scoped. -->
        <app-fiscal-obligation-banner />

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

    <!-- Subscription paywall (driven by interceptor + access service) -->
    <app-paywall-outlet />
  `,
  styleUrls: ['./organization-admin-layout.component.scss'],
})
export class OrganizationAdminLayoutComponent {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  private readonly authFacade = inject(AuthFacade);
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

  // --- Local state signals ---
  readonly sidebarCollapsed = signal(false);
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
      // Aggregated PQR oversight across all stores in the requesting
      // org. Read-only at the org-admin level — response work happens
      // per-store. Group with a single child ("PQRs") so the entry
      // matches the super-admin sidebar shape: click the group to
      // expand, click the child to navigate.
      //
      // No `alwaysVisible` here: the filter (Case 2) keys this item
      // through `Soporte` which already includes `help_pqrs`, so the
      // group shows up when the org has the help_pqrs module enabled.
      label: 'Soporte',
      icon: 'headset',
      // Both the parent and the PQRs child use `alwaysVisible: true`
      // as a pragmatic workaround. The MenuFilterService keys the
      // Soporte group through `Soporte: ['help_support',
      // 'settings_support', 'help_pqrs']`, but the org's `panel_ui`
      // doesn't always carry those flags — when the org has its own
      // user_settings override that drops `help_pqrs`, the entire
      // group disappears. Marking both as alwaysVisible decouples
      // them from that mismatch until the panel_ui contract is
      // cleaned up at the data layer.
      alwaysVisible: true,
      children: [
        {
          label: 'PQRS',
          icon: 'message-square',
          route: '/admin/support/pqrs',
          alwaysVisible: true,
        },
      ],
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
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip:
            'Disponible solo en modo ORGANIZATION. Selecciona una tienda.',
        },
        {
          label: 'Niveles de Stock',
          icon: '',
          route: '/admin/inventory/stock-levels',
          alwaysVisible: true,
          requiredOperatingScope: 'ORGANIZATION',
          showLocked: true,
          lockedBadge: 'ORG',
          lockedTooltip:
            'Disponible solo en modo ORGANIZATION. Selecciona una tienda.',
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
      // Fiscal umbrella (ORG) — one sidebar group consolidating every fiscal
      // surface for organizations that OWN their fiscal scope
      // (fiscal_scope=ORGANIZATION). Each child is a leaf whose module renders
      // its sub-sections as internal sticky-header tabs (org invoicing/payroll
      // shells, the org accounting shell, the fiscal compliance hub). The whole
      // group hides when STORES own fiscal. When fiscal is NOT yet activated,
      // only "Operación fiscal" stays visible (no requiresFiscalArea) so the
      // owner can always reach the activation wizard.
      label: 'Fiscal',
      icon: 'landmark',
      alwaysVisible: true,
      requiredFiscalScope: 'ORGANIZATION',
      children: [
        {
          label: 'Operación fiscal',
          icon: 'clipboard-list',
          route: '/admin/fiscal',
          alwaysVisible: true,
          requiredFiscalScope: 'ORGANIZATION',
        },
        {
          label: 'Facturación',
          icon: 'receipt',
          route: '/admin/invoicing',
          alwaysVisible: true,
          requiredFiscalScope: 'ORGANIZATION',
          requiresFiscalArea: 'invoicing',
        },
        {
          label: 'Contabilidad',
          icon: 'book-open',
          route: '/admin/accounting',
          alwaysVisible: true,
          requiredFiscalScope: 'ORGANIZATION',
          requiresFiscalArea: 'accounting',
        },
        {
          label: 'Nómina',
          icon: 'banknote',
          route: '/admin/payroll',
          alwaysVisible: true,
          requiredFiscalScope: 'ORGANIZATION',
          requiresFiscalArea: 'payroll',
        },
      ],
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
          label: 'Modo fiscal',
          icon: 'receipt',
          route: '/admin/settings/fiscal-scope',
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
    // Load stores for sidebar
    this.loadStores();
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
              _count: store._count || {
                products: 0,
                orders: 0,
                store_users: 0,
              },
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
}
