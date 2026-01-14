import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
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

import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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
        [menuItems]="menuItems"
        [title]="(organizationName$ | async) || organizationName"
        subtitle="Administrador de Organización"
        [vlink]="(organizationSlug$ | async) || organizationSlug"
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
          class="flex-1 overflow-y-auto overflow-x-hidden px-1 md:px-4 py-2 transition-all duration-300 ease-in-out"
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
  organizationName = 'Acme Corporation';
  organizationSlug = 'acme-corp';

  // Dynamic user data
  organizationName$: Observable<string | null>;
  organizationSlug$: Observable<string | null>;

  // Onboarding Modal
  showOnboardingModal = false;
  needsOnboarding = false;
  private destroy$ = new Subject<void>();

  // Stores
  stores: StoreListItem[] = [];
  isLoadingStores = false;
  menuItems: MenuItem[] = [];

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
  }

  ngOnInit(): void {
    // Initialize menu items
    this.initializeMenuItems();

    // Check onboarding status considering both organization state and user role
    this.checkOnboardingWithRoleValidation();

    // Subscribe to organization onboarding status from user data (no API call)
    this.authFacade.needsOrganizationOnboarding$
      .pipe(takeUntil(this.destroy$))
      .subscribe((needsOnboarding: boolean) => {
        this.needsOnboarding = needsOnboarding;
        this.updateOnboardingModal();
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
        this.updateMenuItems();
      },
      error: (error) => {
        console.error('Error loading stores:', error);
        this.stores = [];
        this.isLoadingStores = false;
        this.updateMenuItems();
      },
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

  initializeMenuItems(): void {
    this.menuItems = [
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
        route: '/admin/audit/logs'
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
  }

  updateMenuItems(): void {
    const storesMenu = this.menuItems.find(item => item.label === 'Tiendas');
    if (storesMenu && storesMenu.children) {
      storesMenu.children = [
        {
          label: 'Ver Todas las Tiendas',
          icon: '',
          route: '/admin/stores',
        },
        ...this.stores.map(store => ({
          label: store.name,
          icon: '',
          action: () => this.switchToStoreEnvironment(store),
        })),
      ];
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
