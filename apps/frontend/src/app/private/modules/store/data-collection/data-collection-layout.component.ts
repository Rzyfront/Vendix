import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../shared/components/sticky-header/sticky-header.component';

/**
 * Recolección de datos: the module header (layer 3) with Campos · Plantillas ·
 * Formularios as route tabs. The per-type / per-status rows inside Campos and
 * Formularios are its layer 4. The template editor is a detail screen with its
 * own header and back button, so the module header steps aside there.
 */
@Component({
  selector: 'app-data-collection-layout',
  standalone: true,
  imports: [RouterModule, StickyHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      @if (!isEditor()) {
        <app-sticky-header
          title="Recolección de datos"
          subtitle="Campos, plantillas y formularios que llenan tus clientes"
          icon="clipboard-list"
          [showBackButton]="true"
          [backRoute]="backRoute()"
          [backQueryParams]="backQueryParams()"
          [tabs]="tabs"
          tabsAriaLabel="Módulo de Recolección de Datos"
        />
      }
      <router-outlet />
    </div>
  `,
})
export class DataCollectionLayoutComponent {
  private readonly router = inject(Router);

  readonly tabs: StickyHeaderTab[] = [
    {
      id: 'fields',
      label: 'Campos',
      icon: 'database',
      route: '/admin/data-collection/fields',
    },
    {
      id: 'templates',
      label: 'Plantillas',
      icon: 'layout-template',
      route: '/admin/data-collection/templates',
    },
    {
      id: 'submissions',
      label: 'Formularios',
      icon: 'inbox',
      route: '/admin/data-collection/submissions',
    },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly isEditor = computed(() => /\/templates\/\d+\/edit/.test(this.url()));

  /**
   * Pantalla desde la que se entró a Recolección de datos (p. ej. Estaciones o el
   * producto). Cambiar de pestaña no la pisa: el layout vive mientras se navega adentro.
   */
  private readonly exitUrl = (() => {
    // Al crearse el layout la navegación hacia acá aún no termina: la última
    // navegación exitosa ES la pantalla de origen.
    const previous = this.router.lastSuccessfulNavigation?.finalUrl?.toString() ?? '';
    return previous && !previous.startsWith('/admin/data-collection') ? previous : null;
  })();

  /** Back goes to the screen we came from, query params included. */
  private readonly exitTree = this.router.parseUrl(this.exitUrl ?? '/admin');

  readonly backRoute = computed(() => {
    const segments =
      this.exitTree.root.children['primary']?.segments.map((s) => s.path) ?? [];
    return '/' + segments.join('/');
  });

  readonly backQueryParams = computed(() => this.exitTree.queryParams);
}
