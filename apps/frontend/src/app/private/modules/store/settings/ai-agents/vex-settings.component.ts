import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  CardComponent,
  SettingToggleComponent,
} from '../../../../../shared/components/index';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { SubscriptionAccessService } from '../../../../../core/services/subscription-access.service';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { AgentStatusService, AgentStatusView } from './agent-status.service';
import { AgentUsageMetersComponent } from './agent-usage-meters.component';

type VexSwitch = 'enabled' | 'floating_avatar';

/**
 * Vex section of "Agentes IA" (`/admin/settings/ai-agents`): the store's main
 * agent, shown first (agentes-admin S1).
 *
 * Two store switches, both owner/admin only (same `aiAgentsSettingsGuard` as
 * the page, re-checked by the backend):
 * - «Usar Vex» (`vex.enabled`), which also needs the `vex_agent` plan feature —
 *   enforced server-side, explained here with the plan state and the usage
 *   bars so the switch is never flipped blind.
 * - «Avatar flotante de Vex» (`vex.floating_avatar`, S3), off by default. It
 *   is not a chat: the avatar only takes you to `/admin/vex`.
 */
@Component({
  selector: 'app-vex-settings',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    CardComponent,
    SettingToggleComponent,
    IconComponent,
    AgentUsageMetersComponent,
  ],
  template: `
    <app-card
      [responsive]="true"
      [showHeader]="true"
      data-testid="vex-settings-section"
    >
      <div slot="header" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-start gap-3 min-w-0">
          <img
            src="assets/vex/vexicon-96.webp"
            alt=""
            class="h-10 w-10 shrink-0 object-contain"
          />
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
              Vex · tu agente principal
            </h2>
            <p class="text-sm text-[var(--color-text-secondary)] mt-1">
              Te ayuda con el trabajo de la tienda: responde sobre tu negocio,
              arma reportes y hace cambios cuando tú los apruebas.
            </p>
          </div>
        </div>
        @if (enabled() && canUseVex()) {
          <a
            routerLink="/admin/vex"
            class="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-[var(--color-text-on-primary)] hover:bg-primary-700"
          >
            <app-icon name="sparkles" [size]="16" />
            Abrir Vex
          </a>
        }
      </div>

      <div class="space-y-4">
        <div
          class="rounded-lg border border-[var(--color-border)] p-4"
          role="group"
          aria-label="Usar Vex"
          [attr.aria-describedby]="reason() ? 'vex-reason' : null"
        >
          <app-setting-toggle
            label="Usar Vex"
            [description]="toggleDescription()"
            [disabled]="saving() !== null || toggleLocked()"
            [ngModel]="enabled()"
            (ngModelChange)="onToggle('enabled', $event)"
          />
          @if (reason()) {
            <p
              id="vex-reason"
              class="mt-3 text-sm text-[var(--color-text-secondary)]"
              role="status"
            >
              {{ reason() }}
            </p>
          }
        </div>

        <div
          class="rounded-lg border border-[var(--color-border)] p-4"
          role="group"
          aria-label="Avatar flotante de Vex"
          data-testid="vex-floating-avatar-setting"
        >
          <app-setting-toggle
            label="Avatar flotante de Vex"
            [description]="avatarDescription()"
            [disabled]="saving() !== null || avatarLocked()"
            [ngModel]="floatingAvatar()"
            (ngModelChange)="onToggle('floating_avatar', $event)"
          />
        </div>

        @if (!enabled()) {
          <div
            class="rounded-lg border border-[var(--color-warning)] bg-[rgba(var(--color-warning-rgb),0.08)] p-4 text-sm text-[var(--color-text-primary)]"
          >
            <p class="font-semibold mb-1">Vex está apagado</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Nadie en la tienda ve el botón ni el avatar de Vex.</li>
              <li>Si alguien abre la página de Vex, vuelve a esta configuración.</li>
              <li>Los cambios que Vex tenía pendientes de aprobar se descartan.</li>
            </ul>
          </div>
        }

        <!-- Estado del plan. El gate real vive en el backend (feature
             'vex_agent'); esto solo lo explica para que el interruptor no se
             lea como averiado cuando el plan no incluye a Vex. -->
        <div class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] p-4">
          <app-icon
            [name]="canUseVex() ? 'check-circle' : 'alert-circle'"
            [size]="20"
            [class]="
              canUseVex()
                ? 'text-[var(--color-success)] mt-0.5 shrink-0'
                : 'text-[var(--color-warning)] mt-0.5 shrink-0'
            "
          />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
              Tu plan
            </h3>
            @if (canUseVex()) {
              <p class="text-sm text-[var(--color-text-secondary)] mt-1">
                Tu plan incluye a Vex.
              </p>
            } @else {
              <p class="text-sm text-[var(--color-text-secondary)] mt-1">
                Tu plan actual no incluye a Vex.
                @if (vexBlockReason()) {
                  <span>({{ vexBlockReason() }})</span>
                }
              </p>
              <a
                routerLink="/admin/subscription"
                class="text-sm text-primary-600 hover:underline mt-1 inline-block"
              >
                Ver planes y ampliar mi suscripción
              </a>
            }
          </div>
        </div>
      </div>

      <app-agent-usage-meters agent="vex" />
    </app-card>
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class VexSettingsComponent {
  private readonly settingsService = inject(StoreSettingsService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly subscriptionAccess = inject(SubscriptionAccessService);
  private readonly toast = inject(ToastService);
  private readonly statusService = inject(AgentStatusService);

  /** Plan gate, read-only here. Fails closed until the matrix hydrates. */
  readonly canUseVex = this.subscriptionAccess.canUseAI('vex_agent');
  readonly vexBlockReason = this.subscriptionAccess.aiBlockReason('vex_agent');

  /** `null` until `GET /store/ai-agents/status` answers, or if it fails. */
  readonly status = signal<AgentStatusView | null>(null);
  readonly blockedByPlan = computed(() => this.status()?.plan_includes === false);
  readonly reason = computed(() => this.status()?.reason ?? null);

  constructor() {
    void this.statusService.loadFor('vex').then((s) => this.status.set(s));
  }

  /**
   * Optimistic local values. The facade signals only flip once the PATCH
   * response is republished into NgRx; without a local override the toggle
   * would snap back for the duration of the round trip and read as a failure.
   */
  private readonly enabledOverride = signal<boolean | null>(null);
  private readonly avatarOverride = signal<boolean | null>(null);

  /** Which switch is being saved, if any. One save at a time. */
  readonly saving = signal<VexSwitch | null>(null);

  readonly enabled = computed(
    () => this.enabledOverride() ?? this.settingsFacade.vexEnabled(),
  );

  /** The stored flag, independent from `vex.enabled` (the facade's
   * `vexFloatingAvatar` also requires Vex on: that is what the layout shows). */
  readonly floatingAvatar = computed(
    () =>
      this.avatarOverride() ??
      this.settingsFacade.settings()?.vex?.floating_avatar === true,
  );

  /**
   * The plan only blocks turning Vex ON: a Vex left on after the plan dropped
   * it must still be switchable off (the backend accepts it).
   */
  readonly toggleLocked = computed(() => this.blockedByPlan() && !this.enabled());

  /** The avatar only makes sense with Vex on; it can always be turned off. */
  readonly avatarLocked = computed(() => !this.enabled() && !this.floatingAvatar());

  readonly toggleDescription = computed(() =>
    this.enabled()
      ? 'Vex está disponible para el propietario y los administradores de la tienda.'
      : 'Vex no aparece en el panel y su página no se abre.',
  );

  readonly avatarDescription = computed(() => {
    if (!this.enabled()) {
      return 'Activa Vex primero. El avatar es un acceso rápido a Vex: al tocarlo te lleva a su página.';
    }
    return this.floatingAvatar()
      ? 'Se ve un avatar de Vex en la esquina del panel. Al tocarlo te lleva a la página de Vex; no abre un chat.'
      : 'Muestra un avatar de Vex en la esquina del panel. Al tocarlo te lleva a la página de Vex; no abre un chat.';
  });

  async onToggle(key: VexSwitch, next: boolean): Promise<void> {
    const current = key === 'enabled' ? this.enabled() : this.floatingAvatar();
    if (
      this.saving() !== null ||
      next === current ||
      (key === 'enabled' && next && this.blockedByPlan()) ||
      (key === 'floating_avatar' && next && !this.enabled())
    ) {
      return;
    }

    const override = key === 'enabled' ? this.enabledOverride : this.avatarOverride;
    override.set(next);
    this.saving.set(key);

    try {
      // Only the moved key travels. The backend merges `vex` by key, so this
      // never overwrites the other switch.
      const payload: Partial<StoreSettings> = {
        vex: key === 'enabled' ? { enabled: next } : { floating_avatar: next },
      };
      await firstValueFrom(this.settingsService.saveSettingsNow(payload));
      // Drop the override so the facade is the single source of truth again.
      override.set(null);
      this.toast.success(this.successMessage(key, next));
      if (key === 'enabled') {
        // The reason depends on the switch, so it is re-read.
        void this.statusService.loadFor('vex').then((s) => this.status.set(s));
      }
    } catch (error) {
      override.set(current);
      this.toast.error(
        parseApiError(error).userMessage ??
          'No se pudo guardar la configuración de Vex.',
      );
    } finally {
      this.saving.set(null);
    }
  }

  private successMessage(key: VexSwitch, next: boolean): string {
    if (key === 'enabled') {
      return next ? 'Vex quedó activo en esta tienda.' : 'Vex quedó desactivado.';
    }
    return next
      ? 'Listo: el avatar de Vex aparece en el panel.'
      : 'El avatar de Vex ya no aparece en el panel.';
  }
}
