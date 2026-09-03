import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';

import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../sticky-header/sticky-header.component';
import { ModuleShellActionsService } from './module-shell-actions.service';

/**
 * Generic shell that renders a sticky-header with tabs + a `<router-outlet>`.
 *
 * Centralizes a module's sub-sections as internal tabs instead of deep sidebar
 * nesting (the sidebar only renders 2 levels). Configuration is fully
 * route-driven so the same shell powers any fiscal module (invoicing,
 * accounting, payroll, cartera) — mirrors `AnalyticsShellComponent`.
 *
 * Route `data` contract (set on the shell's parent route):
 * - `moduleTitle: string`   — sticky-header title (e.g. 'Facturación').
 * - `moduleSubtitle?: string` — second line. Sin él se usa la etiqueta de la
 *   pestaña activa, que es lo que orienta de verdad ('Facturación' /
 *   'Resoluciones'). Antes se pasaba `title()` a los dos, así que la cabecera
 *   de TODO módulo con este shell decía dos veces lo mismo, en una línea
 *   pensada para decir dónde estás dentro del módulo.
 * - `moduleIcon?: string`   — Lucide icon name (default 'box').
 * - `moduleTabs: StickyHeaderTab[]` — ordered tabs; each `route` is absolute.
 * - `moduleBackRoute?: string` — back button target (default '/admin/fiscal').
 */
@Component({
  selector: 'app-module-tabs-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, StickyHeaderComponent],
  template: `
    <section class="module-shell">
      <app-sticky-header
        [title]="title()"
        [subtitle]="subtitle()"
        [icon]="icon()"
        variant="glass"
        [showBackButton]="true"
        [backRoute]="backRoute()"
        [tabs]="tabs()"
        [activeTab]="activeTabId()"
        [actions]="shellActions.buttons()"
        tabsAriaLabel="Secciones del módulo"
        (tabChanged)="onTabChanged($event)"
        (actionClicked)="shellActions.run($event)"
      ></app-sticky-header>

      <div class="module-shell__body">
        <router-outlet />
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .module-shell {
        width: 100%;
        min-height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .module-shell__body {
        width: 100%;
      }
    `,
  ],
})
export class ModuleTabsShellComponent {
  /**
   * Canal por el que la página ruteada publica sus botones en esta cabecera.
   * Público porque el template lo lee directo; ver
   * `ModuleShellActionsService` para el contrato de set/clear.
   */
  readonly shellActions = inject(ModuleShellActionsService);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly data = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data,
  });

  readonly title = computed<string>(
    () => (this.data()?.['moduleTitle'] as string) ?? '',
  );
  readonly icon = computed<string>(
    () => (this.data()?.['moduleIcon'] as string) ?? 'box',
  );
  readonly backRoute = computed<string>(
    () => (this.data()?.['moduleBackRoute'] as string) ?? '/admin/fiscal',
  );
  readonly tabs = computed<StickyHeaderTab[]>(
    () => (this.data()?.['moduleTabs'] as StickyHeaderTab[]) ?? [],
  );

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly activeTabId = computed<string>(() => {
    const url = this.currentUrl().split('?')[0];
    const match = this.tabs().find((tab) => {
      const route = typeof tab.route === 'string' ? tab.route : '';
      return route && (url === route || url.startsWith(`${route}/`));
    });
    return match?.id ?? this.tabs()[0]?.id ?? '';
  });

  /**
   * Segunda línea de la cabecera: QUÉ se administra en la sección abierta.
   *
   * Precedencia: `moduleSubtitle` de la ruta → `description` de la pestaña
   * activa → su etiqueta.
   *
   * La etiqueta es el último recurso, no el primero, y la diferencia se ve en
   * pantalla: el nombre de la sección ya aparece en la migaja, en el título del
   * layout y en la pestaña seleccionada. Escribirlo una cuarta vez convertía
   * esta línea en decoración. Con `description` la cabecera dice algo que no
   * está en ningún otro sitio.
   *
   * Se declara después de `activeTabId` a propósito —la lambda de `computed`
   * es perezosa, pero leerla en este orden es lo que hace evidente de dónde
   * sale el valor.
   *
   * Cae a cadena vacía cuando el módulo no tiene pestañas: la plantilla del
   * sticky-header ya oculta la línea con `@if (subtitle())`, así que un módulo
   * de una sola sección queda con el título limpio en vez de repetirlo.
   */
  readonly subtitle = computed<string>(() => {
    const explicit = this.data()?.['moduleSubtitle'] as string | undefined;
    if (explicit) return explicit;

    const active = this.tabs().find((tab) => tab.id === this.activeTabId());
    return active?.description ?? active?.label ?? '';
  });

  onTabChanged(tabId: string): void {
    const target = this.tabs().find((tab) => tab.id === tabId);
    const route = typeof target?.route === 'string' ? target.route : null;
    if (route) {
      void this.router.navigateByUrl(route);
    }
  }
}
