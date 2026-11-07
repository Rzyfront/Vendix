import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import {
  ScrollableTab,
  ScrollableTabsComponent,
} from '../../../../../shared/components/index';

export type DocumentsTabId =
  | 'dossiers'
  | 'search'
  | 'folders'
  | 'expiring'
  | 'retention'
  | 'templates';

/** Route (under `/admin/documents`) of each tab. */
const TAB_ROUTE: Record<DocumentsTabId, string[]> = {
  dossiers: [],
  search: ['search'],
  folders: ['folders'],
  expiring: ['expiring'],
  retention: ['retention'],
  templates: ['templates'],
};

const TABS: ScrollableTab[] = [
  { id: 'dossiers', label: 'Expedientes', icon: 'folder-open' },
  { id: 'search', label: 'Buscar', icon: 'search' },
  { id: 'folders', label: 'Carpetas', icon: 'folder' },
  { id: 'expiring', label: 'Por vencer', icon: 'calendar-clock' },
  { id: 'retention', label: 'Retención', icon: 'archive' },
  { id: 'templates', label: 'Plantillas', icon: 'file-text' },
];

/** Tabs of the Documents module; every page of the module renders it on top. */
@Component({
  selector: 'app-documents-tabs',
  standalone: true,
  imports: [ScrollableTabsComponent],
  template: `
    <div class="px-2 pb-2 md:px-0" data-testid="documents-tabs">
      <app-scrollable-tabs
        [tabs]="tabs"
        [activeTab]="active()"
        size="md"
        ariaLabel="Secciones de Documentos"
        (tabChange)="onTab($event)"
      />
    </div>
  `,
})
export class DocumentsTabsComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthFacade);

  readonly active = input.required<DocumentsTabId>();
  /** Every retention endpoint needs `store:workflows:design`: without it the tab is hidden. */
  readonly tabs = TABS.filter(
    (t) => t.id !== 'retention' || this.auth.isOwner() || this.auth.hasPermission('store:workflows:design'),
  );

  onTab(id: string): void {
    const route = TAB_ROUTE[id as DocumentsTabId];
    if (!route || id === this.active()) return;
    this.router.navigate(['/admin/documents', ...route]);
  }
}
