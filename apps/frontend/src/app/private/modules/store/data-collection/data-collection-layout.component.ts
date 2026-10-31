import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { ScrollableTabsComponent, ScrollableTab } from '../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-data-collection-layout',
  standalone: true,
  imports: [RouterModule, ScrollableTabsComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <!-- Sticky Tabs Navigation -->
      <div class="sticky top-0 z-30 backdrop-blur-md shadow-sm flex items-center gap-1" style="background: color-mix(in srgb, var(--color-surface) 85%, transparent); border-bottom: 1px solid var(--color-border)">
        <!-- El editor de plantillas ya trae su propia flecha de volver -->
        @if (!isEditor()) {
          <button
            type="button"
            class="ml-2 shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-background)] transition-colors"
            aria-label="Volver"
            title="Volver"
            (click)="goBack()"
          >
            <app-icon name="arrow-left" [size]="18" />
          </button>
        }
        <div class="flex-1 min-w-0">
          <app-scrollable-tabs
            [tabs]="tabs"
            [activeTab]="activeTabId()"
            size="sm"
            ariaLabel="Módulo de Recolección de Datos"
            (tabChange)="onTabChange($event)"
          />
        </div>
      </div>
      <!-- Page Content -->
      <router-outlet />
    </div>
  `,
})
export class DataCollectionLayoutComponent {
  private readonly router = inject(Router);

  tabs: ScrollableTab[] = [
    { id: 'fields', label: 'Campos', icon: 'database' },
    { id: 'templates', label: 'Plantillas', icon: 'layout-template' },
    { id: 'submissions', label: 'Formularios', icon: 'inbox' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly activeTabId = computed(() => {
    const url = this.url();
    if (url.includes('templates')) return 'templates';
    if (url.includes('submissions')) return 'submissions';
    return 'fields';
  });

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

  goBack(): void {
    this.router.navigateByUrl(this.exitUrl ?? '/admin');
  }

  onTabChange(tabId: string): void {
    this.router.navigate(['/admin/data-collection/' + tabId]);
  }
}
