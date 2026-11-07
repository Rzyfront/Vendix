import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import {
  CardComponent,
  ScrollableTabsComponent,
  StickyHeaderComponent,
} from '../../../../../../../shared/components/index';
import { ScrollableTab } from '../../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { ApiKeysPanelComponent } from '../../components/api-keys-panel.component';
import { WebhooksPanelComponent } from '../../components/webhooks-panel.component';

type IntegrationsTab = 'api_keys' | 'webhooks';

/** `/admin/workflows/integrations`: API keys and outgoing webhooks. */
@Component({
  selector: 'app-integrations-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    ScrollableTabsComponent,
    ApiKeysPanelComponent,
    WebhooksPanelComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Integraciones"
        subtitle="Conecta tus flujos con otros sistemas: API keys y webhooks firmados"
        icon="plug"
        variant="glass"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />
      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="border-b border-border px-2 py-1.5 md:px-6 md:py-4">
          <app-scrollable-tabs
            [tabs]="tabs"
            [activeTab]="activeTab()"
            size="sm"
            ariaLabel="Secciones de integraciones"
            (tabChange)="onTabChange($event)"
          />
        </div>
        <div class="p-2 md:p-4">
          @if (activeTab() === 'api_keys') {
            <app-api-keys-panel />
          } @else {
            <app-webhooks-panel />
          }
        </div>
      </app-card>
    </div>
  `,
})
export class IntegrationsPageComponent {
  private readonly router = inject(Router);

  readonly tabs: ScrollableTab[] = [
    { id: 'api_keys', label: 'API keys', icon: 'key' },
    { id: 'webhooks', label: 'Webhooks', icon: 'webhook' },
  ];
  readonly headerActions = [
    { id: 'back', label: 'Flujos', icon: 'git-branch', variant: 'outline' as const },
  ];
  readonly activeTab = signal<IntegrationsTab>('api_keys');

  onTabChange(tab: string): void {
    if (tab === 'api_keys' || tab === 'webhooks') this.activeTab.set(tab);
  }

  onHeaderAction(id: string): void {
    if (id === 'back') this.router.navigate(['/admin/workflows']);
  }
}
