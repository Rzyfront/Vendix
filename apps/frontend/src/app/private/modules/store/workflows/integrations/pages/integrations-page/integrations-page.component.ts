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
import { SecretsPanelComponent } from '../../../secrets/secrets-panel.component';

type IntegrationsTab = 'api_keys' | 'webhooks' | 'secrets';

/** `/admin/workflows/integrations`: API keys, outgoing webhooks and secrets for HTTP calls. */
@Component({
  selector: 'app-integrations-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    ScrollableTabsComponent,
    ApiKeysPanelComponent,
    WebhooksPanelComponent,
    SecretsPanelComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Integraciones"
        subtitle="Conecta tus flujos con otros sistemas: API keys, webhooks firmados y secretos para llamadas HTTP"
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
          } @else if (activeTab() === 'secrets') {
            <app-secrets-panel />
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
    { id: 'secrets', label: 'Secretos', icon: 'key-round' },
  ];
  readonly headerActions = [
    { id: 'back', label: 'Flujos', icon: 'git-branch', variant: 'outline' as const },
  ];
  readonly activeTab = signal<IntegrationsTab>('api_keys');

  onTabChange(tab: string): void {
    if (tab === 'api_keys' || tab === 'webhooks' || tab === 'secrets') this.activeTab.set(tab);
  }

  onHeaderAction(id: string): void {
    if (id === 'back') this.router.navigate(['/admin/workflows']);
  }
}
