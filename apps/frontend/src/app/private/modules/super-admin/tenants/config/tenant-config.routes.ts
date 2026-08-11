import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
  type Routes,
} from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';

import {
  ScrollableTabsComponent,
  type ScrollableTab,
} from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { provideSuperadminDianApi } from '../services/superadmin-dian-context.factory';

/**
 * Sub-secciones de la pestaña Configuración, en el orden en que se recorren:
 * primero lo que gobierna el panel del comerciante, después lo fiscal, y al
 * final lo que sólo se consulta.
 */
const CONFIG_TABS: readonly (ScrollableTab & { readonly path: string })[] = [
  {
    id: 'settings',
    path: 'settings',
    label: 'Ajustes',
    icon: 'sliders-horizontal',
  },
  { id: 'modules', path: 'modules', label: 'Módulos', icon: 'layout-grid' },
  {
    id: 'fiscal',
    path: 'fiscal',
    label: 'Identidad fiscal',
    icon: 'file-check',
  },
  {
    id: 'dian',
    path: 'dian',
    label: 'Documentos electrónicos',
    icon: 'shield',
  },
  { id: 'domains', path: 'domains', label: 'Dominios', icon: 'globe' },
];

const DEFAULT_TAB = CONFIG_TABS[0].path;

/**
 * Shell de la sección Configuración: una fila de sub-pestañas y el outlet.
 *
 * **Las sub-secciones son RUTAS, no un `[hidden]` sobre paneles apilados.** No
 * es preferencia estética: `app-table` envuelve su cuerpo en
 * `@defer (on viewport)` (`table.component.html:83`) y el `IntersectionObserver`
 * jamás dispara bajo un ancestro con `display:none`, así que una sección oculta
 * que contenga una tabla se queda con el skeleton para siempre. Con rutas, el
 * componente inactivo ni existe.
 *
 * No reutiliza `AccountingSubTabsShellComponent`: aquél navega con rutas
 * ABSOLUTAS leídas de `Route.data` y no sabe expresar el `:storeId` que porta
 * esta rama. Aquí la navegación es relativa al `ActivatedRoute` del shell, así
 * que el id del tenant viaja solo.
 */
@Component({
  selector: 'app-tenant-config-shell',
  standalone: true,
  imports: [RouterOutlet, ScrollableTabsComponent],
  template: `
    <div class="w-full">
      <div class="mb-3 border-b border-border md:mb-4">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTabId()"
          size="sm"
          ariaLabel="Sub-secciones de configuración del tenant"
          (tabChange)="onTabChange($event)"
        ></app-scrollable-tabs>
      </div>
      <router-outlet />
    </div>
  `,
})
export class TenantConfigShellComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly tabs: ScrollableTab[] = CONFIG_TABS.map(
    ({ id, label, icon }) => ({ id, label, icon }),
  );

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Qué pestaña está activa, leída de la URL.
   *
   * Se busca el ÚLTIMO segmento que coincida con una pestaña, no el último
   * segmento a secas: «Documentos electrónicos» tiene sub-rutas propias
   * (`…/configuration/dian/numeracion`), así que mirar sólo la cola devolvería
   * `numeracion` —que no es ninguna pestaña de este nivel— y el tablist marcaría
   * «Ajustes» mientras el operador edita la numeración del tenant.
   *
   * Una URL sin ningún segmento reconocible cae en la primera pestaña, para no
   * dejar el tablist sin selección.
   */
  protected readonly activeTabId = computed<string>(() => {
    const path = this.currentUrl().split('?')[0].split('#')[0];
    const segments = path.split('/').filter(Boolean);
    for (let index = segments.length - 1; index >= 0; index--) {
      const match = CONFIG_TABS.find((tab) => tab.path === segments[index]);
      if (match) return match.id;
    }
    return CONFIG_TABS[0].id;
  });

  protected onTabChange(tabId: string): void {
    const target = CONFIG_TABS.find((tab) => tab.id === tabId);
    if (!target) return;
    void this.router.navigate([target.path], { relativeTo: this.route });
  }
}

/**
 * Rutas de la pestaña Configuración del perfil de tenant.
 *
 * Se enchufan desde `tenant-profile.routes.ts` con
 * `loadChildren: () => import('./config/tenant-config.routes').then(m => m.TENANT_CONFIG_ROUTES)`.
 *
 * **Los providers de DIAN viven en el shell y no en la raíz.** Reapuntan el
 * `DIAN_API_CONTEXT` compartido al rail `/superadmin/tenants/:scope/:id/invoicing`
 * y crean una instancia propia de `DianConfigApiService` para esta rama, de modo
 * que el panel de facturación del comerciante —que inyecta el singleton de
 * raíz— sigue apuntando a `/api/store/invoicing/*` sin enterarse.
 *
 * OJO: el router NO destruye estos providers al salir. `provideSuperadminDianApi()`
 * está escrito para eso: resuelve el tenant en cada llamada, nunca al construirse.
 */
export const TENANT_CONFIG_ROUTES: Routes = [
  {
    path: '',
    component: TenantConfigShellComponent,
    providers: [...provideSuperadminDianApi()],
    // Cada hoja declara su propio `title` (formato «Sección - Ámbito», el mismo
    // de `users.routes.ts`). Sin él, `BreadcrumbService` no encuentra entrada
    // para una URL de cinco segmentos, su efecto de título se abstiene y la
    // pestaña del navegador se queda con el rótulo de la pantalla anterior
    // —«General»— sin importar en qué sub-sección esté soporte.
    children: [
      { path: '', pathMatch: 'full', redirectTo: DEFAULT_TAB },
      {
        path: 'settings',
        title: 'Ajustes - Configuración del tenant',
        loadComponent: () =>
          import('./pages/tenant-settings.component').then(
            (c) => c.TenantSettingsComponent,
          ),
      },
      {
        path: 'modules',
        title: 'Módulos - Configuración del tenant',
        loadComponent: () =>
          import('./pages/tenant-modules.component').then(
            (c) => c.TenantModulesComponent,
          ),
      },
      {
        path: 'fiscal',
        title: 'Identidad fiscal - Configuración del tenant',
        loadComponent: () =>
          import('./pages/tenant-fiscal.component').then(
            (c) => c.TenantFiscalComponent,
          ),
      },
      {
        // Documentos electrónicos es, a su vez, una sección con cinco vistas
        // propias (Habilitaciones · Certificado · Numeración · Set de pruebas ·
        // Bitácora), así que entra por `loadChildren` y no por `loadComponent`:
        // su shell necesita su propio `router-outlet` y su propio store de rama.
        // El título lo declara cada hoja, no este nodo, porque el nodo nunca es
        // la URL final.
        path: 'dian',
        loadChildren: () =>
          import('./pages/dian/tenant-dian.routes').then(
            (m) => m.TENANT_DIAN_ROUTES,
          ),
      },
      {
        path: 'domains',
        title: 'Dominios - Configuración del tenant',
        loadComponent: () =>
          import('./pages/tenant-domains.component').then(
            (c) => c.TenantDomainsComponent,
          ),
      },
      { path: '**', redirectTo: DEFAULT_TAB },
    ],
  },
];
