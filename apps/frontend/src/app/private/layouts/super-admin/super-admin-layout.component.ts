import {
  Component,
  ViewChild,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { SubscriptionBannerComponent } from '../../../shared/components/subscription-banner/subscription-banner.component';
import { PaywallOutletComponent } from '../../../shared/components/ai-paywall-modal/paywall-outlet.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { SupportService } from '../../modules/super-admin/support/services/support.service';
import { timer } from 'rxjs';
import { switchMap, filter } from 'rxjs/operators';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-super-admin-layout',
  standalone: true,
  imports: [
    RouterModule,
    SidebarComponent,
    HeaderComponent,
    SubscriptionBannerComponent,
    PaywallOutletComponent,
  ],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        #sidebarRef
        [menuItems]="menuItems()"
        [title]="organizationName() || platformTitle"
        subtitle="Super Administrador"
        [vlink]="organizationSlug() || currentVlink"
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

        <app-subscription-banner />

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
  styleUrls: ['./super-admin-layout.component.scss'],
})
export class SuperAdminLayoutComponent {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);
  private readonly supportService = inject(SupportService);
  private readonly router = inject(Router);

  readonly currentVlink = 'super-admin';
  readonly platformTitle = 'Vendix Platform';

  // --- Signals from facade observables ---
  readonly organizationName = toSignal(this.authFacade.userOrganizationName$, {
    initialValue: null as string | null,
  });
  readonly organizationSlug = toSignal(this.authFacade.userOrganizationSlug$, {
    initialValue: null as string | null,
  });

  // --- Local state signals ---
  readonly sidebarCollapsed = signal(false);

  // --- Support tickets open count ---
  private readonly openTicketsCount = signal(0);

  // --- Dynamic menu items with support badge ---
  readonly menuItems = computed<MenuItem[]>(() => {
    const openCount = this.openTicketsCount();
    const badge = openCount > 0 ? openCount.toString() : undefined;
    return this.baseMenuItems.map((item) => {
      if (item.label === 'Soporte' && item.children) {
        return {
          ...item,
          badge,
          children: item.children.map((child) =>
            child.label === 'Tickets' ? { ...child, badge } : child,
          ),
        };
      }
      return item;
    });
  });

  // --- Breadcrumb signal ---
  readonly breadcrumb = signal({
    parent: 'Super Administrador',
    current: 'Panel Principal',
  });

  private readonly routeTitles: Record<string, string> = {
    '/super-admin/dashboard': 'Panel Principal',
    '/super-admin/monitoring': 'Monitoreo del Servidor',
    '/super-admin/organizations': 'Organizaciones',
    '/super-admin/stores': 'Tiendas',
    '/super-admin/users': 'Usuarios',
    '/super-admin/roles': 'Roles',
    '/super-admin/payment-methods': 'Métodos de Pago',
    '/super-admin/domains': 'Dominios',
    '/super-admin/legal-documents': 'Documentos Legales',
    '/super-admin/help-center': 'Centro de Ayuda',
    '/super-admin/currencies': 'Monedas',
    '/super-admin/settings/shipping': 'Envíos del Sistema',
    '/super-admin/audit': 'Auditoría',
    '/super-admin/billing': 'Facturación',
    '/super-admin/subscriptions': 'Suscripciones',
    '/super-admin/subscriptions/plans': 'Planes',
    '/super-admin/subscriptions/active': 'Suscripciones',
    '/super-admin/support': 'Tickets',
    '/super-admin/system/ai-engine': 'AI Engine',
    '/super-admin/system/templates': 'Plantillas',
    '/super-admin/system/backups': 'Copias de Seguridad',
    '/super-admin/system/payroll-defaults': 'Parámetros de Nómina',
  };

  user = {
    name: 'Usuario Administrador',
    role: 'Super Administrador',
    initials: 'UA',
  };

  // Base menu items (without badge)
  private get baseMenuItems(): MenuItem[] {
    return [
      {
        label: 'Panel Principal',
        icon: 'home',
        route: '/super-admin/dashboard',
      },
      {
        label: 'Observabilidad',
        icon: 'chart-line',
        children: [
          {
            label: 'Monitoreo',
            icon: 'circle',
            route: '/super-admin/monitoring',
          },
          {
            label: 'Auditoría',
            icon: 'circle',
            route: '/super-admin/audit',
          },
          {
            label: 'Copias de Seguridad',
            icon: 'circle',
            route: '/super-admin/system/backups',
          },
        ],
      },
      {
        label: 'Cuentas',
        icon: 'building-2',
        children: [
          {
            label: 'Organizaciones',
            icon: 'circle',
            route: '/super-admin/organizations',
          },
          {
            label: 'Tiendas',
            icon: 'circle',
            route: '/super-admin/stores',
          },
        ],
      },
      {
        label: 'Acceso',
        icon: 'shield-check',
        children: [
          {
            label: 'Usuarios',
            icon: 'circle',
            route: '/super-admin/users',
          },
          {
            label: 'Roles',
            icon: 'circle',
            route: '/super-admin/roles',
          },
        ],
      },
      {
        label: 'Facturación',
        icon: 'credit-card',
        children: [
          {
            label: 'Planes',
            icon: 'circle',
            route: '/super-admin/subscriptions/plans',
          },
          {
            label: 'Suscripciones',
            icon: 'circle',
            route: '/super-admin/subscriptions/active',
          },
          {
            label: 'Métodos de Pago',
            icon: 'circle',
            route: '/super-admin/payment-methods',
          },
          {
            label: 'Monedas',
            icon: 'circle',
            route: '/super-admin/currencies',
          },
        ],
      },
      {
        label: 'AI Engine',
        icon: 'cpu',
        route: '/super-admin/system/ai-engine',
        requiresFeature: 'ai_engine',
      },
      {
        label: 'Soporte',
        icon: 'headset',
        children: [
          {
            label: 'Tickets',
            icon: 'circle',
            route: '/super-admin/support',
          },
          {
            label: 'Centro de Ayuda',
            icon: 'circle',
            route: '/super-admin/help-center',
          },
        ],
      },
      {
        label: 'Sistema',
        icon: 'settings',
        children: [
          {
            label: 'Dominios',
            icon: 'circle',
            route: '/super-admin/domains',
          },
          {
            label: 'Documentos Legales',
            icon: 'circle',
            route: '/super-admin/legal-documents',
          },
          {
            label: 'Envíos del Sistema',
            icon: 'circle',
            route: '/super-admin/settings/shipping',
          },
          {
            label: 'Plantillas',
            icon: 'circle',
            route: '/super-admin/system/templates',
          },
          {
            label: 'Parámetros de Nómina',
            icon: 'circle',
            route: '/super-admin/system/payroll-defaults',
          },
        ],
      },
    ];
  }

  constructor() {
    // Dynamic breadcrumb based on route
    this.updateBreadcrumb(this.router.url);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => this.updateBreadcrumb(e.urlAfterRedirects));

    // Load support tickets stats — refresh every 60 seconds
    timer(0, 60000)
      .pipe(
        switchMap(() => this.supportService.getTicketStats()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (stats: any) => {
          const openCount =
            (stats.by_status?.['NEW'] || 0) +
            (stats.by_status?.['OPEN'] || 0) +
            (stats.by_status?.['IN_PROGRESS'] || 0) +
            (stats.by_status?.['WAITING_RESPONSE'] || 0);
          this.openTicketsCount.set(openCount);
        },
        error: (err) => {
          console.error('Error loading support stats:', err);
        },
      });
  }

  toggleSidebar() {
    if (this.sidebarRef?.isMobile()) {
      this.sidebarRef.toggleSidebarState();
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }

  private updateBreadcrumb(url: string): void {
    const path = url.split('?')[0];
    const title = this.routeTitles[path];
    if (title) {
      this.breadcrumb.set({ parent: 'Super Administrador', current: title });
    }
  }
}
