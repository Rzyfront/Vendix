import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { ScrollableTabsComponent, ScrollableTab } from '../../../../shared/components/scrollable-tabs/scrollable-tabs.component';

@Component({
  selector: 'app-data-collection-layout',
  standalone: true,
  imports: [RouterModule, ScrollableTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <!-- Sticky Tabs Navigation -->
      <div class="sticky top-0 z-30 backdrop-blur-md shadow-sm" style="background: color-mix(in srgb, var(--color-surface) 85%, transparent); border-bottom: 1px solid var(--color-border)">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTabId()"
          size="sm"
          ariaLabel="Módulo de Recolección de Datos"
          (tabChange)="onTabChange($event)"
        />
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

  onTabChange(tabId: string): void {
    this.router.navigate(['/admin/data-collection/' + tabId]);
  }
}
