import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { SettingToggleComponent } from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  AgentStatusService,
  AgentStatusView,
} from '../ai-agents/agent-status.service';
import { AgentUsageMetersComponent } from '../ai-agents/agent-usage-meters.component';

/**
 * Vexi tab of "Agentes IA": the «Usar Vexi» switch with the reason it cannot
 * be turned on, and the read-only consumption bars. Nothing technical lives
 * here (T16/N1): the voice engine, model and provider are set in superadmin.
 * What Vexi did is in «Historial».
 *
 * The page is gated by `aiAgentsSettingsGuard` (owner/admin) and the backend
 * re-checks the role and the switch.
 */
@Component({
  selector: 'app-vexi-settings',
  standalone: true,
  imports: [FormsModule, SettingToggleComponent, AgentUsageMetersComponent],
  template: `
    <div class="w-full max-w-3xl">
      <p class="text-[var(--color-text-secondary)] mb-6">
        El asistente de Vendix. Responde preguntas sobre tu negocio, te lleva
        al módulo que necesitas y puede ejecutar acciones por ti previa
        confirmación.
      </p>

      <div
        class="bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-4 sm:p-6"
        role="group"
        aria-label="Usar Vexi"
        [attr.aria-describedby]="reason() ? 'vexi-reason' : null"
      >
        <app-setting-toggle
          label="Usar Vexi"
          [description]="toggleDescription()"
          [disabled]="saving() || toggleLocked()"
          [ngModel]="enabled()"
          (ngModelChange)="onToggle($event)"
        />

        @if (reason()) {
          <p
            id="vexi-reason"
            class="mt-3 text-sm text-[var(--color-text-secondary)]"
            role="status"
          >
            {{ reason() }}
          </p>
        }
      </div>

      <div
        class="bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-4 sm:p-6 mt-4"
        role="group"
        aria-label="Vexi en tus apps públicas"
        data-testid="vexi-public-setting"
      >
        <app-setting-toggle
          label="Vexi en tus apps públicas"
          [description]="publicDescription()"
          [disabled]="savingPublic() || publicLocked()"
          [ngModel]="publicEnabled()"
          (ngModelChange)="onPublicToggle($event)"
        />
      </div>

      <app-agent-usage-meters agent="vexi" />
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class VexiSettingsComponent {
  private readonly settingsService = inject(StoreSettingsService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly statusService = inject(AgentStatusService);

  /** `null` until `GET /store/ai-agents/status` answers, or if it fails. */
  readonly status = signal<AgentStatusView | null>(null);
  readonly blockedByPlan = computed(() => this.status()?.plan_includes === false);
  readonly reason = computed(() => this.status()?.reason ?? null);

  constructor() {
    void this.statusService.loadFor('vexi').then((s) => this.status.set(s));
  }

  /**
   * Optimistic local value. The facade signal only flips once the PATCH
   * response is republished into NgRx; without a local override the toggle
   * would snap back for the duration of the round trip and read as a failure.
   */
  private readonly override = signal<boolean | null>(null);

  readonly saving = signal(false);

  readonly enabled = computed(
    () => this.override() ?? this.settingsFacade.vexiEnabled(),
  );

  /**
   * The plan only blocks turning the agent ON: an agent left on after the plan
   * dropped it must still be switchable off (the backend accepts it).
   */
  readonly toggleLocked = computed(() => this.blockedByPlan() && !this.enabled());

  readonly toggleDescription = computed(() =>
    this.enabled()
      ? 'Vexi aparece para todos los usuarios de la tienda.'
      : 'El asistente no se carga y sus endpoints responden módulo deshabilitado.',
  );

  // ── Vexi público (F2) ──────────────────────────────────────────────────

  private readonly publicOverride = signal<boolean | null>(null);
  readonly savingPublic = signal(false);
  readonly publicEnabled = computed(
    () => this.publicOverride() ?? this.settingsFacade.vexiPublicEnabled(),
  );
  /** Same plan rule: blocked only for turning it on. */
  readonly publicLocked = computed(
    () => this.blockedByPlan() && !this.publicEnabled(),
  );
  readonly publicDescription = computed(() =>
    this.publicEnabled()
      ? 'Tus clientes ven a Vexi en la tienda en línea, la página de producto y la de servicios: arma pedidos, agenda citas y registra peticiones. Solo responde por escrito y usa los tokens de IA de tu plan.'
      : 'Vexi no aparece en tus apps públicas.',
  );

  async onPublicToggle(next: boolean): Promise<void> {
    if (
      this.savingPublic() ||
      next === this.publicEnabled() ||
      (next && this.blockedByPlan())
    ) {
      return;
    }
    const previous = this.publicEnabled();
    this.publicOverride.set(next);
    this.savingPublic.set(true);
    try {
      await firstValueFrom(
        this.settingsService.saveSettingsNow({ vexi_public: { enabled: next } }),
      );
      this.publicOverride.set(null);
      this.toast.success(
        next
          ? 'Vexi quedó publicado en tus apps públicas.'
          : 'Vexi ya no aparece en tus apps públicas.',
      );
    } catch (error) {
      this.publicOverride.set(previous);
      this.toast.error(
        parseApiError(error).userMessage ??
          'No se pudo guardar la configuración de Vexi.',
      );
    } finally {
      this.savingPublic.set(false);
    }
  }

  async onToggle(next: boolean): Promise<void> {
    if (
      this.saving() ||
      next === this.enabled() ||
      (next && this.blockedByPlan())
    ) {
      return;
    }

    const previous = this.enabled();
    this.override.set(next);
    this.saving.set(true);

    try {
      await firstValueFrom(
        this.settingsService.saveSettingsNow({ vexi: { enabled: next } }),
      );
      // Drop the override so the facade becomes the single source of truth
      // again — leaving it set would mask a later change made elsewhere.
      this.override.set(null);
      this.toast.success(
        next
          ? 'Vexi quedó activo en esta tienda.'
          : 'Vexi quedó desactivado.',
      );
      void this.statusService.loadFor('vexi').then((s) => this.status.set(s));
    } catch (error) {
      this.override.set(previous);
      this.toast.error(
        parseApiError(error).userMessage ??
          'No se pudo guardar la configuración de Vexi.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
