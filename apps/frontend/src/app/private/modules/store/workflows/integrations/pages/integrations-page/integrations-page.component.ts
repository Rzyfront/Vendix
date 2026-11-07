import { Component, inject, signal } from '@angular/core';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
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

/** Permission each tab's API demands (mirrors the backend `@Permissions`). */
const TAB_PERMISSIONS: Record<IntegrationsTab, string> = {
  api_keys: 'store:integrations:api_keys',
  webhooks: 'store:integrations:api_keys',
  secrets: 'store:workflows:manage',
};

const ALL_TABS: (ScrollableTab & { id: IntegrationsTab })[] = [
  { id: 'api_keys', label: 'API keys', icon: 'key' },
  { id: 'webhooks', label: 'Webhooks', icon: 'webhook' },
  { id: 'secrets', label: 'Secretos', icon: 'key-round' },
];

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
          @switch (activeTab()) {
            @case ('api_keys') {
              <app-api-keys-panel />
            }
            @case ('webhooks') {
              <app-webhooks-panel />
            }
            @case ('secrets') {
              <app-secrets-panel />
            }
          }
        </div>
      </app-card>
    </div>
  `,
})
export class IntegrationsPageComponent {
  private readonly auth = inject(AuthFacade);

  /**
   * Only the tabs whose API the user may call: the route admits
   * `integrations:api_keys` OR `workflows:manage`, so a role with just one of
   * them must not land on a tab that answers 403.
   */
  readonly tabs: ScrollableTab[] = ALL_TABS.filter(
    (tab) => this.auth.isOwner() || this.auth.hasPermission(TAB_PERMISSIONS[tab.id]),
  );
  readonly activeTab = signal<IntegrationsTab | null>(
    (this.tabs[0]?.id as IntegrationsTab | undefined) ?? null,
  );

  onTabChange(tab: string): void {
    const allowed = this.tabs.find((candidate) => candidate.id === tab);
    if (allowed) this.activeTab.set(allowed.id as IntegrationsTab);
  }
}
