import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';

import {
  AlertBannerComponent,
  ScrollableTabsComponent,
  type ScrollableTab,
} from '../../../../../../shared/components';
import { fiscalOwnerNotice } from '../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../state/tenant-context.store';
import { TenantDianConsoleStore } from './dian/tenant-dian-console.store';

/**
 * Sub-secciones de Documentos electrónicos, en el orden en que se recorren:
 * primero el mapa de las cuatro habilitaciones, después lo que hay que tener
 * (certificado y numeración), luego lo que hay que probar, y al final lo que
 * sólo se consulta.
 *
 * Viven en el shell —que es quien pinta las pestañas— y las importa el archivo
 * de rutas, no al revés: la dependencia va en un solo sentido y no hay ciclo.
 */
export const DIAN_TABS = [
  {
    id: 'habilitaciones',
    path: 'habilitaciones',
    label: 'Habilitaciones',
    icon: 'shield-check',
  },
  {
    id: 'certificado',
    path: 'certificado',
    label: 'Certificado',
    icon: 'key-round',
  },
  { id: 'numeracion', path: 'numeracion', label: 'Numeración', icon: 'file-text' },
  { id: 'pruebas', path: 'pruebas', label: 'Set de pruebas', icon: 'file-check' },
  { id: 'bitacora', path: 'bitacora', label: 'Bitácora', icon: 'history' },
] as const satisfies readonly (ScrollableTab & { readonly path: string })[];

export const DIAN_DEFAULT_TAB = DIAN_TABS[0].path;

/**
 * Shell de Documentos electrónicos del tenant: una fila de sub-pestañas y el
 * outlet de las cinco vistas.
 *
 * ## Qué era esto antes
 *
 * Un componente de ~2.400 líneas que apilaba, en un solo `template`, el panel de
 * emisión, la ficha del certificado, el set de pruebas y el paso a producción —
 * más el módulo compartido de configuraciones al final. Para soporte, «ver si
 * este cliente tiene certificado» significaba desplazarse por toda la pantalla
 * hasta un badge, y la numeración directamente no se podía editar.
 *
 * Ahora cada cosa tiene RUTA y esta clase sólo navega. El archivo se conserva —y
 * conserva su nombre exportado— porque es el punto de montaje que
 * `tenant-config.routes.ts` conoce.
 *
 * ## Por qué rutas y no `[hidden]`
 *
 * `app-table` envuelve su cuerpo en `@defer (on viewport)`
 * (`table.component.html:83`) y el `IntersectionObserver` jamás dispara bajo un
 * ancestro con `display:none`: una sección oculta que contenga una tabla se
 * queda con el skeleton para siempre. Numeración y Bitácora son tablas.
 *
 * ## La carga del agregado se dispara AQUÍ
 *
 * En el shell y no en cada hoja: las cinco vistas leen el mismo estado, y pedir
 * las configuraciones una vez por pestaña convertiría cada clic en cuatro
 * consultas de checklist contra el rail de otro contribuyente.
 */
@Component({
  selector: 'app-tenant-dian-host',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    AlertBannerComponent,
    ScrollableTabsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full space-y-3">
      @if (ownerNotice(); as notice) {
        <app-alert-banner variant="warning" icon="alert-triangle">
          {{ notice.message }}
          <a
            [routerLink]="notice.route"
            class="ml-1 font-semibold underline underline-offset-2"
          >
            Abrir {{ notice.organizationName }}
          </a>
        </app-alert-banner>
      }

      <div class="border-b border-border">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTabId()"
          size="sm"
          ariaLabel="Sub-secciones de documentos electrónicos del tenant"
          (tabChange)="onTabChange($event)"
        ></app-scrollable-tabs>
      </div>

      <router-outlet />
    </div>
  `,
})
export class TenantDianHostComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tenant = inject(TenantContextStore);
  private readonly console = inject(TenantDianConsoleStore);

  protected readonly tabs: ScrollableTab[] = DIAN_TABS.map(
    ({ id, label, icon }) => ({ id, label, icon }),
  );

  /**
   * Aviso de titularidad del NIT: vive en el shell y no en cada hoja porque
   * aplica a las cinco. Si la identidad fiscal la lleva la organización, TODO lo
   * que se edite desde la ficha de la tienda queda anclado al nivel equivocado y
   * el comerciante no lo verá en su panel.
   */
  protected readonly ownerNotice = computed(() => fiscalOwnerNotice(this.tenant));

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Todas las sub-rutas son hojas de UN segmento, así que el último segmento de
   * la URL identifica la vista. Se compara contra la lista en vez de pintar el
   * segmento crudo: una URL desconocida cae en la primera pestaña y no deja el
   * tablist sin selección.
   */
  protected readonly activeTabId = computed<string>(() => {
    const path = this.currentUrl().split('?')[0].split('#')[0];
    const segments = path.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    return DIAN_TABS.find((tab) => tab.path === last)?.id ?? DIAN_TABS[0].id;
  });

  constructor() {
    this.console.reload();
  }

  protected onTabChange(tabId: string): void {
    const target = DIAN_TABS.find((tab) => tab.id === tabId);
    if (!target) return;
    void this.router.navigate([target.path], { relativeTo: this.route });
  }
}
