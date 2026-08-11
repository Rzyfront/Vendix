import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';

import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../../shared/components/sticky-header/sticky-header.component';
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
} from './general-settings.routes';
import { GeneralSettingsStore } from './services/general-settings.store';

/**
 * Shell de Configuración General: cabecera sticky con pestañas + outlet.
 *
 * **Los grupos son RUTAS, no paneles apilados con `[hidden]`.** Además de dar
 * deep-link a cada grupo, es la única forma de que un grupo inactivo no exista:
 * los componentes que envuelven su cuerpo en `@defer (on viewport)` nunca
 * disparan el `IntersectionObserver` bajo un ancestro con `display:none` y se
 * quedan con el skeleton para siempre.
 *
 * El estado NO vive acá: vive en `GeneralSettingsStore`, provisto en la ruta
 * padre, porque cambiar de pestaña ahora desmonta la página y el borrador sin
 * guardar tiene que sobrevivir.
 */
@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [RouterOutlet, StickyHeaderComponent],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss'],
})
export class GeneralSettingsComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly store = inject(GeneralSettingsStore);

  /**
   * Pestañas para el sticky-header. Sin `route`: se renderizan como botones y
   * la navegación se hace relativa al `ActivatedRoute` del shell, así el prefijo
   * (`/admin/settings/general`) no queda escrito a mano en ningún lado.
   */
  protected readonly tabs = computed<StickyHeaderTab[]>(() =>
    SETTINGS_TABS.map((tab) => ({
      id: tab.id,
      label: tab.label,
      shortLabel: tab.shortLabel,
      icon: tab.icon,
      visible:
        tab.requiresIndustry === 'restaurant' ? this.store.isRestaurant() : true,
    })),
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
   * Todas las sub-rutas son hojas de UN segmento, así que el último segmento de
   * la URL identifica la pestaña. Se compara contra la lista en vez de pintar el
   * segmento crudo: una URL desconocida —o `settings/general` a secas, antes de
   * que el redirect corra— cae en la pestaña por defecto y no deja el tablist
   * sin selección.
   */
  protected readonly activeTabId = computed<string>(() => {
    const path = this.currentUrl().split('?')[0].split('#')[0];
    const segments = path.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    return (
      SETTINGS_TABS.find((tab) => tab.path === last)?.id ?? SETTINGS_TABS[0].id
    );
  });

  constructor() {
    this.store.init();

    // El store no puede navegar por sí mismo (se provee en la ruta, así que su
    // inyector no ve este `ActivatedRoute`). Cuando el guardado encuentra el
    // formulario de Identidad inválido incrementa el contador y el shell trae al
    // usuario a la pestaña donde vive el error. Este effect LEE la señal y no
    // escribe ninguna: no hay ciclo.
    effect(() => {
      const request = this.store.focusBusinessTabRequest();
      if (request === 0) return;
      void this.router.navigate([DEFAULT_SETTINGS_TAB], {
        relativeTo: this.route,
      });
    });
  }

  protected onTabChanged(tabId: string): void {
    const target = SETTINGS_TABS.find((tab) => tab.id === tabId);
    if (!target) return;
    void this.router.navigate([target.path], { relativeTo: this.route });
  }

  protected onHeaderAction(actionId: string): void {
    if (actionId === 'reset') this.store.resetToDefaults();
    else if (actionId === 'save') void this.store.saveAllSettings();
  }
}
