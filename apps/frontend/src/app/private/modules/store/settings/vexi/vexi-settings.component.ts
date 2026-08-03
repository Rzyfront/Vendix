import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { SettingToggleComponent } from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';

/**
 * Store-wide master switch for the Vexi assistant.
 *
 * Lives on its own settings page instead of as one more row inside
 * "General" because turning Vexi off is not a preference — it withdraws a
 * capability from every user of the store, and the page has to say what is
 * lost. The route is gated by `vexiSettingsGuard` (owner/admin) and the
 * backend re-checks with `VexiEnabledGuard`, so hiding this page is never the
 * only thing standing between a disabled store and the Vexi endpoints.
 */
@Component({
  selector: 'app-vexi-settings',
  standalone: true,
  imports: [FormsModule, SettingToggleComponent],
  template: `
    <div class="w-full max-w-3xl">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Vexi</h1>
        <p class="text-gray-600">
          El asistente de Vendix. Responde preguntas sobre tu negocio, te lleva
          al módulo que necesitas y puede ejecutar acciones por ti previa
          confirmación.
        </p>
      </div>

      <div class="bg-surface rounded-lg shadow-sm border p-6">
        <app-setting-toggle
          label="Activar a Vexi en esta tienda"
          [description]="toggleDescription()"
          [disabled]="saving()"
          [ngModel]="enabled()"
          (ngModelChange)="onToggle($event)"
        />

        @if (!enabled()) {
          <div
            class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <p class="font-semibold mb-1">Vexi está apagado</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Nadie en la tienda verá el asistente flotante.</li>
              <li>El modo voz y el chat quedan fuera de servicio.</li>
              <li>
                Las acciones que Vexi tuviera pendientes de confirmación se
                descartan.
              </li>
            </ul>
            <p class="mt-2">
              Puedes volver a activarlo desde aquí en cualquier momento.
            </p>
          </div>
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
export class VexiSettingsComponent {
  private readonly settingsService = inject(StoreSettingsService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);

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

  readonly toggleDescription = computed(() =>
    this.enabled()
      ? 'Vexi aparece para todos los usuarios de la tienda.'
      : 'El asistente no se carga y sus endpoints responden módulo deshabilitado.',
  );

  async onToggle(next: boolean): Promise<void> {
    if (this.saving() || next === this.enabled()) {
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
        next ? 'Vexi está activo de nuevo.' : 'Vexi quedó desactivado.',
      );
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
