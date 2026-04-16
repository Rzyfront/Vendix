import { Component, ViewChild, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import {
  SidebarComponent,
  MenuItem,
} from '../../../shared/components/sidebar/sidebar.component';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { SupportService } from '../../modules/super-admin/support/services/support.service';
import { Observable, Subject, BehaviorSubject, timer, combineLatest, of } from 'rxjs';
import { takeUntil, map, switchMap, startWith, filter } from 'rxjs/operators';

@Component({
  selector: 'app-super-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, HeaderComponent],
  template: `
    <div class="flex">
      <!-- Sidebar -->
      <app-sidebar
        #sidebarRef
        [menuItems]="(menuItems$ | async) || []"
        [title]="(organizationName$ | async) || platformTitle"
        subtitle="Super Administrador"
        [vlink]="(organizationSlug$ | async) || currentVlink"
        [collapsed]="sidebarCollapsed"
        (expandSidebar)="toggleSidebar()"
      >
      </app-sidebar>

      <!-- Main Content -->
      <div
        class="main-content flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out"
        [class.margin-desktop]="!sidebarRef?.isMobile"
        [style.margin-left]="
          !sidebarRef?.isMobile ? (sidebarCollapsed ? '3.5rem' : '12.5rem') : '0'
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
          class="flex-1 overflow-y-auto overflow-x-hidden px-1 md:px-4 transition-all duration-300 ease-in-out"
          style="background-color: var(--background);"
        >
          <div class="w-full">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>
    </div>
  `,
  styleUrls: ['./super-admin-layout.component.scss'],
})
export class SuperAdminLayoutComponent implements OnInit, OnDestroy {
  @ViewChild('sidebarRef') sidebarRef!: SidebarComponent;

  sidebarCollapsed = false;
  currentVlink = 'super-admin';
  platformTitle = 'Vendix Platform';

  // Dynamic user data
  organizationName$: Observable<string | null>;
  organizationSlug$: Observable<string | null>;

  // Support tickets open count
  openTicketsCount$ = new BehaviorSubject<number>(0);
  private destroy$ = new Subject<void>();
  private supportService = inject(SupportService);
  private router = inject(Router);

  constructor(private authFacade: AuthFacade) {
    this.organizationName$ = this.authFacade.userOrganizationName$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
  }

  ngOnInit(): void {
    // Dynamic breadcrumb based on route
    this.updateBreadcrumb(this.router.url);
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntil(this.destroy$),
    ).subscribe((e) => this.updateBreadcrumb(e.urlAfterRedirects));

    // Load support tickets stats for badge - refresh every 60 seconds
    timer(0, 60000).pipe(
      switchMap(() => this.supportService.getTicketStats()),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (stats: any) => {
        // Calculate open tickets (NEW + OPEN + IN_PROGRESS)
        const openCount = (stats.by_status?.['NEW'] || 0) +
                         (stats.by_status?.['OPEN'] || 0) +
                         (stats.by_status?.['IN_PROGRESS'] || 0) +
                         (stats.by_status?.['WAITING_RESPONSE'] || 0);
        this.openTicketsCount$.next(openCount);
      },
      error: (err) => {
        console.error('Error loading support stats:', err);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  breadcrumb = {
    parent: 'Super Administrador',
    current: 'Panel Principal',
  };

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
    '/super-admin/support': 'Soporte',
    '/super-admin/system/ai-engine': 'AI Engine',
    '/super-admin/system/templates': 'Plantillas',
    '/super-admin/system/settings': 'Configuración del Sistema',
    '/super-admin/system/logs': 'Registros',
    '/super-admin/system/backups': 'Copias de Seguridad',
    '/super-admin/system/payroll-defaults': 'Parámetros de Nómina',
    '/super-admin/analytics/platform': 'Analíticas de Plataforma',
    '/super-admin/analytics/users': 'Analíticas de Usuarios',
    '/super-admin/analytics/performance': 'Rendimiento',
  };

  user = {
    name: 'Usuario Administrador',
    role: 'Super Administrador',
    initials: 'UA',
  };

  // Base menu items (without badge)
  private baseMenuItems: MenuItem[] = [
    {
      label: 'Panel Principal',
      icon: 'home',
      route: '/super-admin/dashboard',
    },
    {
      label: 'Monitoreo',
      icon: 'activity',
      route: '/super-admin/monitoring',
    },
    {
      label: 'AI Engine',
      icon: 'cpu',
      route: '/super-admin/system/ai-engine',
    },
    {
      label: 'Organizaciones',
      icon: 'building',
      route: '/super-admin/organizations',
    },
    {
      label: 'Tiendas',
      icon: 'store',
      route: '/super-admin/stores',
    },
    {
      label: 'Usuarios',
      icon: 'users',
      route: '/super-admin/users',
    },
    {
      label: 'Roles',
      icon: 'shield',
      route: '/super-admin/roles',
    },
    {
      label: 'Métodos de Pago',
      icon: 'credit-card',
      route: '/super-admin/payment-methods',
    },
    {
      label: 'Dominios',
      icon: 'globe-2',
      route: '/super-admin/domains',
    },
    {
      label: 'Documentos Legales',
      icon: 'file-text',
      route: '/super-admin/legal-documents',
    },
    {
      label: 'Centro de Ayuda',
      icon: 'book-open',
      route: '/super-admin/help-center',
    },
    {
      label: 'Monedas',
      icon: 'dollar-sign',
      route: '/super-admin/currencies',
    },
    {
      label: 'Envíos del Sistema',
      icon: 'truck',
      route: '/super-admin/settings/shipping',
    },
    {
      label: 'Auditoría',
      icon: 'eye',
      route: '/super-admin/audit',
    },
    {
      label: 'Facturación',
      icon: 'credit-card',
      route: '/super-admin/billing',
    },
    {
      label: 'Soporte',
      icon: 'headset',
      route: '/super-admin/support',
    },
    {
      label: 'Analíticas',
      icon: 'chart-line',
      children: [
        {
          label: 'Analíticas de Plataforma',
          icon: 'circle',
          route: '/super-admin/analytics/platform',
        },
        {
          label: 'Analíticas de Usuarios',
          icon: 'circle',
          route: '/super-admin/analytics/users',
        },
        {
          label: 'Rendimiento',
          icon: 'circle',
          route: '/super-admin/analytics/performance',
        },
      ],
    },
    {
      label: 'Sistema',
      icon: 'settings',
      children: [
        {
          label: 'Configuración del Sistema',
          icon: 'circle',
          route: '/super-admin/system/settings',
        },
        {
          label: 'Plantillas',
          icon: 'circle',
          route: '/super-admin/system/templates',
        },
        {
          label: 'Registros',
          icon: 'circle',
          route: '/super-admin/system/logs',
        },
        {
          label: 'Copias de Seguridad',
          icon: 'circle',
          route: '/super-admin/system/backups',
        },
        {
          label: 'Parámetros de Nómina',
          icon: 'circle',
          route: '/super-admin/system/payroll-defaults',
        },
      ],
    },
  ];

  // Dynamic menu items with support badge
  menuItems$: Observable<MenuItem[]> = combineLatest([
    of(this.baseMenuItems),
    this.openTicketsCount$
  ]).pipe(
    map(([items, openCount]) => {
      // Find and update the Support menu item badge
      return items.map(item => {
        if (item.label === 'Soporte') {
          return { ...item, badge: openCount > 0 ? openCount.toString() : undefined };
        }
        return item;
      });
    }),
    startWith(this.baseMenuItems)
  );

  toggleSidebar() {
    // If mobile, delegate to sidebar component
    if (this.sidebarRef?.isMobile) {
      this.sidebarRef.toggleSidebar();
    } else {
      // Desktop: toggle collapsed state
      this.sidebarCollapsed = !this.sidebarCollapsed;
    }
  }

  private updateBreadcrumb(url: string): void {
    const path = url.split('?')[0];
    const title = this.routeTitles[path];
    if (title) {
      this.breadcrumb = { parent: 'Super Administrador', current: title };
    }
  }
}
