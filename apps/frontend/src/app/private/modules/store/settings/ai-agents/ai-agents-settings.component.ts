import { Component, inject } from '@angular/core';

import { StatsComponent } from '../../../../../shared/components/index';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { SubscriptionAccessService } from '../../../../../core/services/subscription-access.service';
import { VexiSettingsComponent } from '../vexi/vexi-settings.component';
import { VexSettingsComponent } from './vex-settings.component';
import { AgentHistoryComponent } from './history/agent-history.component';
import { StoreMemoryComponent } from './memory/store-memory.component';

/**
 * "Agentes IA" settings page (`/admin/settings/ai-agents`), agentes-admin S1.
 *
 * A standard full-width store module, like the other settings screens: the
 * stats row on top (sticky on mobile) and one card per section below — no
 * tabs, side panel, modal or floating element. Vex, the store's main agent,
 * comes first with all its settings; Vexi, now only the public agent of the
 * store's apps, comes below; then the store memory and the history.
 *
 * Old deep links (`?tab=vex`, `?tab=history`, the `/admin/settings/vexi`
 * redirect) still land here: everything is on one page now.
 *
 * Gated by `aiAgentsSettingsGuard` (owner/admin): every switch here is
 * store-wide, and the backend re-checks the role.
 */
@Component({
  selector: 'app-ai-agents-settings',
  standalone: true,
  imports: [
    StatsComponent,
    VexiSettingsComponent,
    VexSettingsComponent,
    AgentHistoryComponent,
    StoreMemoryComponent,
  ],
  template: `
    <div class="w-full space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
        data-testid="ai-agents-stats"
      >
        <app-stats
          title="Vex"
          [value]="vexEnabled() ? 'Activo' : 'Apagado'"
          smallText="Tu agente principal"
          iconName="sparkles"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        <app-stats
          title="Avatar de Vex"
          [value]="floatingAvatarVisible() ? 'Visible' : 'Oculto'"
          smallText="Acceso rápido en el panel"
          iconName="user"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Vexi público"
          [value]="vexiPublicEnabled() ? 'Publicado' : 'Apagado'"
          smallText="En tus apps públicas"
          iconName="message-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Plan"
          [value]="planIncludesVex() ? 'Incluye a Vex' : 'Sin Vex'"
          smallText="Según tu suscripción"
          iconName="credit-card"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <section aria-label="Configuración de Vex">
        <app-vex-settings />
      </section>

      <section aria-label="Configuración de Vexi">
        <app-vexi-settings />
      </section>

      <app-store-memory />

      <section aria-labelledby="ai-agents-history-title" class="space-y-2">
        <div class="px-1">
          <h2
            id="ai-agents-history-title"
            class="text-lg font-semibold text-[var(--color-text-primary)]"
          >
            Historial
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)]">
            Lo que hicieron tus agentes y las conversaciones con tus clientes.
          </p>
        </div>
        <app-agent-history />
      </section>
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class AiAgentsSettingsComponent {
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly subscriptionAccess = inject(SubscriptionAccessService);

  readonly vexEnabled = this.settingsFacade.vexEnabled;
  /** What the layout really shows: the flag AND Vex on. */
  readonly floatingAvatarVisible = this.settingsFacade.vexFloatingAvatar;
  readonly vexiPublicEnabled = this.settingsFacade.vexiPublicEnabled;
  /** Plan gate, read-only. Fails closed until the matrix hydrates. */
  readonly planIncludesVex = this.subscriptionAccess.canUseAI('vex_agent');
}
