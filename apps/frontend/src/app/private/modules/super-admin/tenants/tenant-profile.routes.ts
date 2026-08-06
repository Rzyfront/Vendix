import { Component, computed, inject } from '@angular/core';
import { RouterLink, type Routes } from '@angular/router';

import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
} from '../../../../shared/components';
import { seedTenantContextGuard } from './guards/seed-tenant-context.guard';
import type { TenantScopeSegment } from './interfaces/tenant-profile.interface';
import { SuperadminTenantApiService } from './services/superadmin-tenant-api.service';
import {
  TENANT_PROFILE_SCOPE,
  TenantContextStore,
  createTenantProfileScopeConfig,
} from './state/tenant-context.store';

// ---------------------------------------------------------------------------
// Páginas ligeras de este árbol
//
// Viven aquí, y no en `pages/`, porque son costuras de ruta: se pintan con
// datos que el perfil ya trae y no justifican un archivo propio. General,
// Actividad y Configuración sí lo tienen — en cuanto una de estas crezca, se
// muda a `pages/` sin tocar el árbol de rutas.
// ---------------------------------------------------------------------------

/**
 * Pestaña Suscripción — estado de la suscripción SaaS del tenant.
 *
 * Se pinta con `profile.subscription`, que ya viaja en el perfil, así que no
 * hay razón para dejarla vacía. Sólo existe para tiendas: la suscripción se
 * factura por tienda, no por organización.
 */
@Component({
  selector: 'app-tenant-subscription',
  standalone: true,
  imports: [CardComponent, IconComponent, BadgeComponent],
  template: `
    <app-card [responsive]="true">
      @if (subscription(); as sub) {
        <div class="space-y-4">
          <header class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-text-primary">
                {{ sub.plan?.name ?? 'Sin plan asignado' }}
              </h2>
              @if (sub.plan?.code) {
                <p class="mt-0.5 text-xs text-text-secondary">
                  {{ sub.plan?.code }}
                </p>
              }
            </div>
            <app-badge variant="primary" size="sm">{{ sub.state }}</app-badge>
          </header>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            @for (row of facts(); track row.label) {
              <div class="rounded-lg border border-border bg-background p-3">
                <p class="text-xs font-medium text-text-secondary">
                  {{ row.label }}
                </p>
                <p class="mt-1 text-sm font-semibold text-text-primary">
                  {{ row.value }}
                </p>
              </div>
            }
          </div>

          @if (sub.lock_reason) {
            <div
              class="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3"
            >
              <app-icon
                name="alert-triangle"
                [size]="16"
                class="mt-0.5 flex-shrink-0 text-red-600"
              ></app-icon>
              <p class="text-xs text-red-900">
                Bloqueo activo: {{ sub.lock_reason }}
              </p>
            </div>
          }
        </div>
      } @else {
        <div class="flex flex-col items-center gap-3 py-10 text-center">
          <div
            class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100"
          >
            <app-icon
              name="credit-card"
              [size]="22"
              class="text-gray-500"
            ></app-icon>
          </div>
          <h2 class="text-base font-semibold text-text-primary">
            Sin suscripción
          </h2>
          <p class="max-w-md text-sm text-text-secondary">
            {{ emptyReason() }}
          </p>
        </div>
      }
    </app-card>
  `,
})
export class TenantSubscriptionComponent {
  private readonly store = inject(TenantContextStore);
  protected readonly subscription = this.store.subscription;

  protected readonly emptyReason = computed(() =>
    this.store.isOrganization()
      ? 'La suscripción se factura por tienda: abre la ficha de una de sus tiendas para verla.'
      : 'Esta tienda no tiene una suscripción registrada.',
  );

  protected readonly facts = computed(() => {
    const sub = this.subscription();
    if (!sub) return [];

    return [
      { label: 'Inicio', value: this.date(sub.started_at) },
      { label: 'Fin de prueba', value: this.date(sub.trial_ends_at) },
      { label: 'Fin del periodo', value: this.date(sub.current_period_end) },
      { label: 'Próximo cobro', value: this.date(sub.next_billing_at) },
      { label: 'Gracia blanda', value: this.date(sub.grace_soft_until) },
      { label: 'Gracia dura', value: this.date(sub.grace_hard_until) },
      {
        label: 'Precio efectivo',
        value:
          sub.effective_price === null || sub.effective_price === undefined
            ? '—'
            : `${sub.effective_price} ${sub.currency ?? ''}`.trim(),
      },
      {
        label: 'Renovación automática',
        value: sub.auto_renew === null ? '—' : sub.auto_renew ? 'Sí' : 'No',
      },
    ];
  });

  private date(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('es-CO');
  }
}

/**
 * Pestaña Tiendas — sólo para fichas de organización.
 *
 * El rail de tenants no expone hoy un listado de las tiendas de una
 * organización: `getProfile` sólo devuelve `scope.stores_count`. Hasta que ese
 * endpoint exista, la pestaña reporta el conteo y remite al directorio.
 */
@Component({
  selector: 'app-tenant-stores-pending',
  standalone: true,
  imports: [CardComponent, IconComponent, ButtonComponent, RouterLink],
  template: `
    <app-card [responsive]="true">
      <div class="flex flex-col items-center gap-3 py-10 text-center">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50"
        >
          <app-icon name="store" [size]="22" class="text-emerald-600"></app-icon>
        </div>
        <h2 class="text-base font-semibold text-text-primary">
          {{ storesCount() }} tienda(s) activa(s)
        </h2>
        <p class="max-w-md text-sm text-text-secondary">
          El listado por organización todavía no lo expone la consola de
          tenants: el perfil sólo devuelve el conteo. Mientras tanto, el
          directorio general permite buscarlas por el nombre de la organización.
        </p>
        <app-button variant="outline" size="sm" routerLink="/super-admin/stores">
          <app-icon name="store" [size]="16" slot="icon"></app-icon>
          Ir al directorio de tiendas
        </app-button>
      </div>
    </app-card>
  `,
})
export class TenantStoresPendingComponent {
  private readonly store = inject(TenantContextStore);
  protected readonly storesCount = computed(
    () => this.store.profile()?.scope.stores_count ?? 0,
  );
}

// ---------------------------------------------------------------------------
// Árbol de rutas
// ---------------------------------------------------------------------------

/**
 * Rutas del perfil de tenant, parametrizadas por alcance.
 *
 * Se llama desde `loadChildren` de la ruta que porta el id
 * (`stores/:storeId`, `organizations/:organizationId`). Cada punto de llamada
 * produce su propio array de rutas y, por tanto, su propio
 * `EnvironmentInjector`: la ficha de tiendas y la de organizaciones jamás
 * comparten `TenantContextStore`.
 *
 * **Los providers van aquí, nunca en raíz.** No porque el router los destruya
 * —no lo hace: `routeConfig._injector` se cachea y sobrevive a la navegación—
 * sino porque así ninguna otra pantalla del panel puede inyectar el cliente ni
 * el estado del tenant. La garantía de que no se filtren datos entre tenants la
 * da `TenantContextStore.seed()`, que limpia antes de pedir y descarta las
 * respuestas rezagadas por token de secuencia.
 */
export function tenantProfileRoutes(
  scope: TenantScopeSegment,
  idParam: string,
): Routes {
  return [
    {
      path: '',
      loadComponent: () =>
        import('./tenant-profile-shell.component').then(
          (c) => c.TenantProfileShellComponent,
        ),
      providers: [
        {
          provide: TENANT_PROFILE_SCOPE,
          useValue: createTenantProfileScopeConfig(scope, idParam),
        },
        SuperadminTenantApiService,
        TenantContextStore,
      ],
      // El guard siembra el contexto leyendo `:storeId` del snapshot ya
      // resuelto. Un factory en `providers` no podría: su injector se crea
      // antes de que exista el `ActivatedRoute`.
      canActivate: [seedTenantContextGuard],
      children: [
        {
          path: '',
          pathMatch: 'full',
          redirectTo: 'general',
        },
        {
          path: 'general',
          loadComponent: () =>
            import('./pages/general/tenant-general.component').then(
              (c) => c.TenantGeneralComponent,
            ),
        },
        {
          path: 'activity',
          loadComponent: () =>
            import('./pages/activity/tenant-activity.component').then(
              (c) => c.TenantActivityComponent,
            ),
        },
        {
          // Configuración es una sección con sub-navegación propia (Ajustes ·
          // Módulos · Identidad fiscal · Documentos electrónicos · Dominios),
          // así que entra por `loadChildren` y no por `loadComponent`: su shell
          // necesita su propio `router-outlet` y sus providers de rama para el
          // contexto DIAN tenant-scoped.
          path: 'configuration',
          loadChildren: () =>
            import('./config/tenant-config.routes').then(
              (m) => m.TENANT_CONFIG_ROUTES,
            ),
        },
        {
          path: 'subscription',
          loadComponent: () => Promise.resolve(TenantSubscriptionComponent),
        },
        // Sólo las organizaciones agrupan tiendas. En una ficha de tienda la
        // ruta ni se registra: mejor un 404 honesto que una pestaña vacía a la
        // que se puede llegar por deep-link.
        ...(scope === 'organizations'
          ? [
              {
                path: 'stores',
                loadComponent: () =>
                  Promise.resolve(TenantStoresPendingComponent),
              },
            ]
          : []),
        {
          path: '**',
          redirectTo: 'general',
        },
      ],
    },
  ];
}
