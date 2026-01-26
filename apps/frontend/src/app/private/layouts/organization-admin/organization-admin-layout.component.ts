import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
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
import { MenuFilterService } from '../../../core/services/menu-filter.service';

import { Observable, Subject } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';

// Store related imports
import { OrganizationStoresService } from '../../../private/modules/organization/stores/services/organization-stores.service';
import { StoreListItem, StoreType } from '../../../private/modules/organization/stores/interfaces/store.interface';
import { EnvironmentSwitchService } from '../../../core/services/environment-switch.service';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../shared/components/toast/toast.service';

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
        [menuItems]="filteredMenuItems"
        [title]="(organizationName$ | async) || 'Cargando...'"
        subtitle="Administrador de Organización"
        [vlink]="(organizationSlug$ | async) || 'slug'"
        [domainHostname]="organizationDomainHostname"
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

  // Dynamic user data
  organizationName$: Observable<string | null>;
  organizationSlug$: Observable<string | null>;
  organizationDomainHostname$: Observable<string | null>;
  organizationDomainHostname: string | null = null;

  // Onboarding Modal
  showOnboardingModal = false;
  needsOnboarding = false;
  private destroy$ = new Subject<void>();

  // Panel UI menu filtering
  private menuFilterService = inject(MenuFilterService);

  // Stores
  stores: StoreListItem[] = [];
  isLoadingStores = false;

  // ALL possible menu items (constant) with alwaysVisible on "Tiendas" children
  private allMenuItems: MenuItem[] = [
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
          alwaysVisible: true, // Always visible if parent is visible
        },
      ],
    },
    {
      label: 'Usuarios',
      icon: 'users',
      route: '/admin/users',
    },
    {
      label: 'Auditoría y Cumplimiento',
      icon: 'shield',
      route: '/admin/audit/logs',
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
          label: 'Metodos de pago',
          icon: 'credit-card',
          route: '/admin/config/payments-methods',
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
    private storesService: OrganizationStoresService,
    private environmentSwitchService: EnvironmentSwitchService,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    this.organizationName$ = this.authFacade.userOrganizationName$;
    this.organizationSlug$ = this.authFacade.userOrganizationSlug$;
    this.organizationDomainHostname$ = this.authFacade.userDomainHostname$;
  }

  ngOnInit(): void {
    // Subscribe to filtered menu items based on panel_ui configuration
    this.menuItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe((items) => {
        // Add dynamic stores AFTER filtering
        this.filteredMenuItems = this.addDynamicStoresToMenu(items);
      });

    // Check onboarding status considering both organization state and user role
    this.checkOnboardingWithRoleValidation();

    // Subscribe to organization onboarding status from user data (no API call)
    this.authFacade.needsOrganizationOnboarding$
      .pipe(takeUntil(this.destroy$))
      .subscribe((needsOnboarding: boolean) => {
        this.needsOnboarding = needsOnboarding;
        this.updateOnboardingModal();
      });

    // Subscribe to domain hostname for sidebar vlink
    this.organizationDomainHostname$
      .pipe(takeUntil(this.destroy$))
      .subscribe((hostname) => {
        this.organizationDomainHostname = hostname;
      });

    // Load stores for sidebar
    this.loadStores();
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

  loadStores(): void {
    this.isLoadingStores = true;

    this.storesService.getStores().subscribe({
      next: (response) => {
        console.log('Stores response:', response);
        if (response.success && response.data) {
          this.stores = response.data.map((store: any) => ({
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
          }));

        } else {
          console.warn('Invalid response structure:', response);
          this.stores = [];
        }
        this.isLoadingStores = false;

        // Update menu items with loaded stores
        this.refreshMenuWithStores();
      },
      error: (error) => {
        console.error('Error loading stores:', error);
        this.stores = [];
        this.isLoadingStores = false;
        this.refreshMenuWithStores();
      },
    });
  }

  /**
   * Adds dynamic stores to the already-filtered menu
   * Only modifies the "Tiendas" item if it's visible
   */
  private addDynamicStoresToMenu(filteredItems: MenuItem[]): MenuItem[] {
    return filteredItems.map((item: MenuItem) => {
      if (item.label === 'Tiendas' && item.children) {
        // Keep "Ver Todas las Tiendas" and add dynamic stores
        const staticChildren = item.children || [];

        return {
          ...item,
          children: [
            ...staticChildren,
            ...this.stores.map((store) => ({
              label: store.name,
              icon: '',
              action: () => this.switchToStoreEnvironment(store),
              alwaysVisible: true, // Dynamic stores are always visible
            })),
          ],
        };
      }
      return item;
    });
  }

  /**
   * Refreshes the menu when new stores are loaded
   */
  private refreshMenuWithStores(): void {
    // Get current filtered items and add stores
    this.menuItems$
      .pipe(take(1))
      .subscribe((items) => {
        this.filteredMenuItems = this.addDynamicStoresToMenu(items);
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
