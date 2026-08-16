import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  ScrollableTab,
  ScrollableTabsComponent,
} from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { AiuSettingsSection } from './aiu-settings.section';
import { PosInvoicingSettingsSection } from './pos-invoicing-settings.section';

type FiscalTab = 'aiu' | 'pos';

/**
 * Página de configuración FISCAL — agrupa las dos secciones que viven fuera del
 * shell de Configuración General porque su hogar natural es la carpeta fiscal.
 *
 * ## Por qué hay tabs y no dos rutas
 *
 * Las dos secciones son CONFIGURACIÓN FISCAL y la pestaña del shell que las hace
 * alcanzables es «Facturación». Una segunda ruta al mismo shell obliga al
 * usuario a saber dónde está cada cosa y a navegar dos veces para lo que
 * conceptualmente es la misma pantalla. Tabs dentro de la misma ruta
 * `/settings/general/facturacion` lo mantienen en un solo lugar.
 *
 * El tab activo se codifica en la URL como query (`?tab=pos`) para que el
 * bookmarkable sobreviva a recargas y al deep-link desde un correo o un chat.
 * Default AIU: es la sección histórica y la primera que un usuario existente
 * espera ver al llegar.
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [
    IconComponent,
    ScrollableTabsComponent,
    AiuSettingsSection,
    PosInvoicingSettingsSection,
  ],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="receipt" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Configuración fiscal de la tienda.</span>
          El régimen AIU y el comportamiento del POS son cosas distintas pero
          viven en la misma pantalla porque ambas afectan lo que el emisor
          electrónico declara cuando firma un documento.
        </p>
      </div>

      <app-scrollable-tabs
        [tabs]="tabs"
        [activeTab]="active()"
        size="md"
        ariaLabel="Configuración fiscal"
        (tabChange)="onTabChange($event)">
      </app-scrollable-tabs>

      <div class="fiscal-tab-panel">
        @switch (active()) {
          @case ('aiu') {
            <app-aiu-settings-section></app-aiu-settings-section>
          }
          @case ('pos') {
            <app-pos-invoicing-settings-section></app-pos-invoicing-settings-section>
          }
        }
      </div>
    </div>
  `,
  styleUrls: ['../general/pages/_settings-page.scss'],
  styles: [
    `
      .fiscal-tab-panel {
        margin-top: 16px;
      }
    `,
  ],
})
export class FiscalSettingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly active = signal<FiscalTab>('aiu');

  readonly tabs: ScrollableTab[] = [
    { id: 'aiu', label: 'Régimen AIU', icon: 'scale' },
    { id: 'pos', label: 'Caja', icon: 'monitor' },
  ];

  /**
   * EL TAB SE LEE Y SE ESCRIBE POR EL ROUTER, NO POR `window`.
   *
   * La versión anterior leía `window.location.search` en `ngOnInit` y escribía
   * con `window.history.replaceState`. Las dos mitades se saltan el Router de
   * Angular, y eso rompe dos cosas concretas:
   *
   * 1. `replaceState` a pelo NO actualiza `ActivatedRoute.queryParams`. La URL
   *    de la barra decía `?tab=pos` y el árbol de rutas seguía creyendo que no
   *    había query: cualquier guard, resolver o hermano que leyera la ruta veía
   *    el estado viejo, y un `router.navigate` posterior con `queryParamsHandling`
   *    resucitaba el tab anterior.
   * 2. Leer una sola vez en `ngOnInit` ignora los cambios de query posteriores,
   *    así que llegar por deep-link desde otra pantalla del panel —navegación
   *    interna, sin recarga— aterrizaba siempre en AIU.
   *
   * La suscripción cubre además la carga inicial: `queryParams` emite el valor
   * vigente al suscribirse.
   */
  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const tab = params.get('tab');
        this.active.set(tab === 'pos' ? 'pos' : 'aiu');
      });
  }

  onTabChange(id: string): void {
    if (id !== 'aiu' && id !== 'pos') return;
    // `active` no se fija acá: lo hace la suscripción de arriba cuando el Router
    // confirma la navegación. Fijarlo también en este punto abriría la puerta a
    // que la pantalla muestre un tab que la URL no llegó a tomar.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
