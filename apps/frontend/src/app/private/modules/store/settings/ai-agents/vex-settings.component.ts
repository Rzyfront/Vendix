import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { SettingToggleComponent } from '../../../../../shared/components/index';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  AiUsageEntry,
  SubscriptionAccessService,
} from '../../../../../core/services/subscription-access.service';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { formatStoreDate } from '../../../../../shared/utils/date.util';
import { parseApiError } from '../../../../../core/utils/parse-api-error';

/**
 * Vex tab inside "Agentes IA" (`/admin/settings/ai-agents?tab=vex`).
 *
 * Store-wide master switch for the Vex agent: only owner/admin reach this tab
 * (same `aiAgentsSettingsGuard` as the whole page), and Vex itself additionally
 * requires the `vex_agent` plan feature — enforced server-side, surfaced here
 * as plan state + monthly usage so the toggle is never flipped blind.
 *
 * Vex ships OFF per store, independent from `vexi.enabled`: enabling one agent
 * never enables the other.
 */
@Component({
  selector: 'app-vex-settings',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    RouterModule,
    SettingToggleComponent,
    IconComponent,
  ],
  template: `
    <div class="w-full max-w-3xl">
      <div class="bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-6">
        <app-setting-toggle
          label="Activar a Vex en esta tienda"
          [description]="toggleDescription()"
          [disabled]="saving()"
          [ngModel]="enabled()"
          (ngModelChange)="onToggle($event)"
        />

        @if (!enabled()) {
          <div
            class="mt-4 rounded-lg border border-[var(--color-warning)] bg-[rgba(var(--color-warning-rgb),0.08)] p-4 text-sm text-[var(--color-text-primary)]"
          >
            <p class="font-semibold mb-1">Vex está apagado</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Nadie en la tienda verá el botón de Vex.</li>
              <li>La ruta /admin/vex redirige a esta página.</li>
              <li>
                Los planes que Vex tuviera pendientes de aprobación se
                descartan.
              </li>
            </ul>
            <p class="mt-2">Puedes activarlo desde aquí cuando quieras.</p>
          </div>
        }

        @if (enabled() && canUseVex()) {
          <div class="mt-4">
            <a
              routerLink="/admin/vex"
              class="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-[var(--color-text-on-primary)] hover:bg-primary-700"
            >
              <app-icon name="sparkles" [size]="16" />
              Abrir Vex
            </a>
          </div>
        }
      </div>

      <!-- Estado del plan. El gate real vive en el backend (AiAccessGuard +
           feature 'vex_agent'); esto solo lo explica para que el interruptor
           no se lea como averiado cuando el plan no incluye a Vex. -->
      <div class="bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-6 mt-6">
        <div class="flex items-start gap-3">
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
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
              Estado del plan
            </h2>
            @if (canUseVex()) {
              <p class="text-sm text-[var(--color-text-secondary)] mt-1">
                Tu plan incluye al agente Vex.
              </p>
            } @else {
              <p class="text-sm text-[var(--color-text-secondary)] mt-1">
                Tu plan actual no incluye al agente Vex.
                @if (vexBlockReason()) {
                  <span class="text-[var(--color-text-secondary)]"
                    >({{ vexBlockReason() }})</span
                  >
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

      <!-- Uso del periodo (día o mes). getAiUsage nunca lanza: ante error retorna un objeto
           vacio, asi que un snapshot ausente se lee como "sin datos", no
           como cero. -->
      <div class="bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-6 mt-6">
        <div class="flex items-start justify-between gap-4 mb-2">
          <div>
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
              {{ usageTitle() }}
            </h2>
            <p class="text-sm text-[var(--color-text-secondary)]">
              Consumo de Vex en el periodo vigente.
            </p>
          </div>
          <button
            type="button"
            class="text-sm text-primary-600 hover:underline shrink-0"
            [disabled]="loadingUsage()"
            (click)="loadUsage()"
          >
            {{ loadingUsage() ? 'Cargando…' : 'Actualizar' }}
          </button>
        </div>

        @if (loadingUsage() && !vexUsage()) {
          <p class="text-sm text-[var(--color-text-secondary)]">Midiendo el consumo reciente…</p>
        } @else if (!vexUsage()) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Todavía no hay consumo de Vex registrado en este periodo.
          </p>
        } @else {
          @if (vexUsage(); as usage) {
            <div class="mt-2">
              <div class="flex items-baseline justify-between text-sm">
                <span class="text-[var(--color-text-primary)] font-semibold">
                  {{ usage.used | number }}
                  @if (usage.cap !== null) {
                    <span class="font-normal text-[var(--color-text-secondary)]">
                      / {{ usage.cap | number }}
                    </span>
                  }
                </span>
                <span class="text-[var(--color-text-secondary)]">
                  @if (usage.cap === null) {
                    ilimitado
                  } @else {
                    {{ usagePercent() }}% del plan
                  }
                  · {{ usage.period === 'daily' ? 'diario' : 'mensual' }} ·
                  {{ usagePeriodLabel() }}
                </span>
              </div>
              @if (usage.cap !== null) {
                <div
                  class="mt-2 h-2 rounded-full bg-[var(--color-border)] overflow-hidden"
                  role="progressbar"
                  [attr.aria-valuenow]="usagePercent()"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-label="Uso de Vex en el periodo"
                >
                  <div
                    class="h-full rounded-full bg-primary-600 transition-all"
                    [style.width.%]="usagePercent()"
                  ></div>
                </div>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class VexSettingsComponent {
  private readonly settingsService = inject(StoreSettingsService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly subscriptionAccess = inject(SubscriptionAccessService);
  private readonly toast = inject(ToastService);

  /** Plan gate, read-only here. Fails closed until the matrix hydrates. */
  readonly canUseVex = this.subscriptionAccess.canUseAI('vex_agent');
  readonly vexBlockReason =
    this.subscriptionAccess.aiBlockReason('vex_agent');

  readonly vexUsage = signal<AiUsageEntry | null>(null);
  readonly loadingUsage = signal(false);

  readonly usagePercent = computed(() => {
    const usage = this.vexUsage();
    if (!usage || usage.cap === null || usage.cap <= 0) return 0;
    return Math.min(100, Math.round((usage.used / usage.cap) * 100));
  });

  /** "Uso del día" for a daily counter, "Uso del mes" for a monthly one. */
  readonly usageTitle = computed(() =>
    this.vexUsage()?.period === 'daily' ? 'Uso del día' : 'Uso del mes',
  );

  /**
   * Concrete quota period behind "Uso del mes" (`octubre de 2026` for a
   * monthly cap, `01/10/2026` for a daily one), computed on the STORE clock:
   * timezone and language come from store settings, never the browser.
   */
  readonly usagePeriodLabel = computed(() => {
    const period = this.vexUsage()?.period ?? 'monthly';
    const general = this.settingsFacade.settings()?.general;
    const tz = general?.timezone || 'America/Bogota';
    const locale = general?.language === 'en' ? 'en-US' : 'es-CO';
    if (period === 'daily') return formatStoreDate(new Date(), tz);
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      month: 'long',
      year: 'numeric',
    }).format(new Date());
  });

  constructor() {
    void this.loadUsage();
  }

  async loadUsage(): Promise<void> {
    if (this.loadingUsage()) return;

    this.loadingUsage.set(true);

    try {
      const snapshot = await this.subscriptionAccess.getAiUsage();
      this.vexUsage.set(snapshot['vex_agent'] ?? null);
    } finally {
      this.loadingUsage.set(false);
    }
  }

  /**
   * Optimistic local value. The facade signal only flips once the PATCH
   * response is republished into NgRx; without a local override the toggle
   * would snap back for the duration of the round trip and read as a failure.
   */
  private readonly override = signal<boolean | null>(null);

  readonly saving = signal(false);

  readonly enabled = computed(
    () => this.override() ?? this.settingsFacade.vexEnabled(),
  );

  readonly toggleDescription = computed(() =>
    this.enabled()
      ? 'Vex aparece para el propietario y los administradores de la tienda.'
      : 'El botón de Vex no se muestra y /admin/vex redirige aquí.',
  );

  async onToggle(next: boolean): Promise<void> {
    if (this.saving() || next === this.enabled()) {
      return;
    }

    const previous = this.enabled();
    this.override.set(next);
    this.saving.set(true);

    try {
      // Sólo viaja `vex.enabled`. El backend mezcla la sección por clave, como
      // `vexi`, así que esto no pisa el resto de la configuración.
      const payload: Partial<StoreSettings> = { vex: { enabled: next } };
      await firstValueFrom(this.settingsService.saveSettingsNow(payload));
      // Drop the override so the facade becomes the single source of truth
      // again — leaving it set would mask a later change made elsewhere.
      this.override.set(null);
      this.toast.success(
        next ? 'Vex quedó activo en esta tienda.' : 'Vex quedó desactivado.',
      );
    } catch (error) {
      this.override.set(previous);
      this.toast.error(
        parseApiError(error).userMessage ??
          'No se pudo guardar la configuración de Vex.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
