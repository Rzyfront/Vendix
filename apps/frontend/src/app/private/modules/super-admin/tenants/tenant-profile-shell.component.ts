import { Component, DestroyRef, computed, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
} from '../../../../shared/components';
import {
  StickyHeaderComponent,
  type StickyHeaderTab,
} from '../../../../shared/components/sticky-header/sticky-header.component';
import {
  DIAN_ENABLEMENT_LABELS,
  TENANT_SCOPE_LABELS,
} from './interfaces/tenant-profile.interface';
import { TenantContextStore } from './state/tenant-context.store';

/**
 * Shell del perfil de tenant.
 *
 * **No reutiliza `ModuleTabsShellComponent` a propósito.** El compartido lee sus
 * pestañas de `Route.data` como rutas ABSOLUTAS estáticas y navega con
 * `navigateByUrl`; no sabe expresar un `:storeId`. Adaptarlo obligaría a tocar
 * un componente con tres consumidores en producción para servir a un cuarto con
 * necesidades distintas. Lo que sí se reutiliza es `app-sticky-header`, que ya
 * resuelve `visible`, `shortLabel`, el desbordamiento con flechas y la
 * navegación por teclado del tablist.
 *
 * Las rutas de las pestañas son RELATIVAS (`general`, `activity`, ...). El
 * `routerLink` del sticky-header las resuelve contra el `ActivatedRoute` de este
 * componente, que es el hijo vacío de `:storeId` — así el id viaja solo.
 */
@Component({
  selector: 'app-tenant-profile-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterOutlet,
    StickyHeaderComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
  ],
  template: `
    <section class="tenant-profile w-full">
      <app-sticky-header
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        [icon]="headerIcon()"
        variant="glass"
        [showBackButton]="true"
        [backRoute]="store.exitRoute"
        [badgeText]="headerBadgeText()"
        [badgeColor]="headerBadgeColor()"
        [tabs]="tabs()"
        tabsAriaLabel="Secciones del tenant"
      ></app-sticky-header>

      <div class="tenant-profile__body">
        @if (store.loading()) {
          <app-card [responsive]="true">
            <div
              class="flex flex-col items-center justify-center gap-3 py-12 text-center"
            >
              <div
                class="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"
              ></div>
              <p class="text-sm text-text-secondary">
                Cargando la configuración del tenant…
              </p>
            </div>
          </app-card>
        } @else if (store.error()) {
          <app-card [responsive]="true">
            <div
              class="flex flex-col items-center justify-center gap-4 py-10 text-center"
            >
              <div
                class="flex h-12 w-12 items-center justify-center rounded-full bg-red-100"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="24"
                  class="text-red-600"
                ></app-icon>
              </div>
              <div class="space-y-1">
                <h2 class="text-base font-semibold text-text-primary">
                  No se pudo abrir la ficha del tenant
                </h2>
                <p class="mx-auto max-w-md text-sm text-text-secondary">
                  {{ store.error() }}
                </p>
              </div>
              <div class="flex flex-wrap items-center justify-center gap-2">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="store.reload()"
                >
                  <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
                  Reintentar
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  [routerLink]="store.exitRoute"
                >
                  <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
                  Volver al directorio
                </app-button>
              </div>
              <app-badge variant="neutral" size="sm">
                Sin tenant activo
              </app-badge>
            </div>
          </app-card>
        } @else {
          <router-outlet />
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .tenant-profile {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .tenant-profile__body {
        width: 100%;
      }
    `,
  ],
})
export class TenantProfileShellComponent {
  protected readonly store = inject(TenantContextStore);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // El banner de tenant activo vive en el layout, fuera de este subárbol.
    // El componente sí se destruye al navegar fuera del perfil, así que este
    // es el único punto fiable para apagarlo (el injector de la ruta, no).
    this.destroyRef.onDestroy(() => this.store.release());
  }

  protected readonly headerTitle = computed(() => this.store.tenantName());

  protected readonly headerSubtitle = computed(() => {
    const profile = this.store.profile();
    if (!profile) {
      return this.store.error()
        ? 'Ficha no disponible'
        : 'Consola de tenants · configuración';
    }

    const parts: string[] = [];
    const organization = this.store.organizationName();
    if (organization) parts.push(organization);
    parts.push(
      `Facturación: ${TENANT_SCOPE_LABELS[profile.scope.fiscal_scope]}`,
    );
    parts.push(
      `Operación: ${TENANT_SCOPE_LABELS[profile.scope.operating_scope]}`,
    );
    return parts.join(' · ');
  });

  protected readonly headerIcon = computed(() =>
    this.store.isOrganization() ? 'building-2' : 'store',
  );

  /**
   * El badge del encabezado reporta la habilitación DIAN de la configuración
   * de facturación por defecto: es el dato por el que se abre esta ficha.
   */
  private readonly defaultInvoicingConfig = computed(() => {
    const configs = this.store.dianConfigs();
    return (
      configs.find(
        (config) =>
          config.is_default && config.configuration_type === 'invoicing',
      ) ??
      configs.find((config) => config.configuration_type === 'invoicing') ??
      configs[0] ??
      null
    );
  });

  protected readonly headerBadgeText = computed(() => {
    const config = this.defaultInvoicingConfig();
    if (!config) return '';
    return DIAN_ENABLEMENT_LABELS[config.enablement_status] ?? '';
  });

  protected readonly headerBadgeColor = computed<
    'green' | 'blue' | 'yellow' | 'gray' | 'red'
  >(() => {
    const status = this.defaultInvoicingConfig()?.enablement_status;
    switch (status) {
      case 'enabled':
        return 'green';
      case 'test_set_passed':
        return 'blue';
      case 'testing':
        return 'yellow';
      case 'suspended':
      case 'expired':
        return 'red';
      default:
        return 'gray';
    }
  });

  protected readonly tabs = computed<StickyHeaderTab[]>(() => {
    const hasProfile = this.store.profile() !== null;
    return [
      {
        id: 'general',
        route: 'general',
        label: 'General',
        icon: 'layout-dashboard',
      },
      {
        id: 'activity',
        route: 'activity',
        label: 'Actividad',
        icon: 'activity',
        disabled: !hasProfile,
      },
      {
        id: 'configuration',
        route: 'configuration',
        label: 'Configuración',
        shortLabel: 'Config.',
        icon: 'settings',
        disabled: !hasProfile,
      },
      {
        id: 'subscription',
        route: 'subscription',
        label: 'Suscripción',
        shortLabel: 'Plan',
        icon: 'credit-card',
        disabled: !hasProfile,
      },
      {
        id: 'stores',
        route: 'stores',
        label: 'Tiendas',
        icon: 'store',
        // Sólo una organización agrupa tiendas. En una ficha de tienda la
        // pestaña no se oculta por estética: no existe nada que listar.
        visible: this.store.isOrganization(),
        disabled: !hasProfile,
      },
    ];
  });
}
