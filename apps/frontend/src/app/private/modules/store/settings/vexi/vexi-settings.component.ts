import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { SettingToggleComponent } from '../../../../../shared/components/index';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  VexiActivityEntry,
  VexiApiService,
} from '../../../../../core/services/vexi-api.service';

/**
 * Store-wide master switch for the Vexi assistant. Vexi ships OFF: this page is
 * where each store opts in.
 *
 * Lives on its own settings page instead of as one more row inside "General"
 * because flipping this switch is not a preference — it hands an agent that
 * writes to the store's own data (products, stock, customers, orders) to every
 * user of the store, so the page has to say what is being granted and show what
 * the agent has already done. The route is gated by `vexiSettingsGuard`
 * (owner/admin) and the backend re-checks with `VexiEnabledGuard`, so hiding
 * this page is never the only thing standing between a store that never enabled
 * Vexi and the Vexi endpoints.
 */
@Component({
  selector: 'app-vexi-settings',
  standalone: true,
  imports: [FormsModule, SettingToggleComponent, IconComponent, DatePipe],
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
              Puedes activarlo desde aquí cuando quieras.
            </p>
          </div>
        }
      </div>

      <!-- Motor de voz. Sólo cuando Vexi está encendido: elegir con qué motor
           responde una función que no se carga es una decisión sin efecto, y
           mostrarla apagada invita a creer que el modo voz quedó activo. -->
      @if (enabled()) {
        <div class="bg-surface rounded-lg shadow-sm border p-6 mt-6">
          <h2 class="text-lg font-semibold text-gray-900">Motor de voz</h2>
          <p class="text-sm text-gray-600 mt-1">
            Cómo responde Vexi cuando le hablas. Los dos escuchan y contestan en
            voz; se diferencian en qué puede hacer con lo que le pides.
          </p>

          <div class="mt-4 space-y-3" role="radiogroup" aria-label="Motor de voz">
            @for (option of engineOptions; track option.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="engine() === option.value"
                [disabled]="savingEngine()"
                (click)="onEngineChange(option.value)"
                class="w-full text-left rounded-lg border p-4 transition-colors hover:border-gray-300 disabled:opacity-60 disabled:cursor-not-allowed"
                [class.border-primary-500]="engine() === option.value"
                [class.bg-primary-50]="engine() === option.value"
                [class.border-gray-200]="engine() !== option.value"
                [class.bg-surface]="engine() !== option.value"
              >
                <div class="flex items-start gap-3">
                  <app-icon
                    [name]="
                      engine() === option.value ? 'check-circle' : 'circle'
                    "
                    [size]="18"
                    [class]="
                      engine() === option.value
                        ? 'text-primary-600 mt-0.5 shrink-0'
                        : 'text-gray-300 mt-0.5 shrink-0'
                    "
                  />
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-gray-900">
                      {{ option.label }}
                      @if (option.recommended) {
                        <span
                          class="ml-2 text-xs font-medium text-primary-700 bg-primary-100 rounded px-1.5 py-0.5"
                        >
                          Recomendado
                        </span>
                      }
                    </p>
                    <p class="text-sm text-gray-600 mt-1">
                      {{ option.description }}
                    </p>
                  </div>
                </div>
              </button>
            }
          </div>
        </div>
      }

      <!-- Actividad. Va debajo del interruptor y no en otra ruta porque la
           decisión de apagar a Vexi se toma mirando lo que hizo. -->
      <div class="bg-surface rounded-lg shadow-sm border p-6 mt-6">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-900">
              Lo que Vexi ha hecho
            </h2>
            <p class="text-sm text-gray-600">
              Cambios que se aplicaron tras tu aprobación, y el documento con el
              que se registraron cuando hubo uno.
            </p>
          </div>
          <button
            type="button"
            class="text-sm text-primary-600 hover:underline shrink-0"
            [disabled]="loadingActivity()"
            (click)="loadActivity()"
          >
            {{ loadingActivity() ? 'Cargando…' : 'Actualizar' }}
          </button>
        </div>

        @if (activityError()) {
          <p class="text-sm text-red-600">{{ activityError() }}</p>
        } @else if (loadingActivity() && !activity().length) {
          <p class="text-sm text-gray-500">Buscando la actividad reciente…</p>
        } @else if (!activity().length) {
          <p class="text-sm text-gray-500">
            Vexi todavía no ha cambiado nada en esta tienda.
          </p>
        } @else {
          <ul class="divide-y divide-gray-100">
            @for (entry of activity(); track $index) {
              <li class="py-3 flex items-start gap-3">
                <app-icon
                  [name]="entry.applied ? 'check-circle' : 'clock'"
                  [size]="16"
                  [class]="
                    entry.applied
                      ? 'text-green-600 mt-0.5 shrink-0'
                      : 'text-gray-400 mt-0.5 shrink-0'
                  "
                />
                <div class="min-w-0 flex-1">
                  <p class="text-sm text-gray-900">{{ entry.operation }}</p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    {{ entry.at | date: 'd MMM y, HH:mm' }}
                    @if (!entry.applied) {
                      · propuesta sin aplicar
                    }
                    @if (entry.linked_entity_type) {
                      · {{ entry.linked_entity_type }}
                      @if (entry.linked_entity_id) {
                        #{{ entry.linked_entity_id }}
                      }
                    }
                  </p>
                  @if (entry.document) {
                    <p
                      class="text-xs text-gray-600 mt-1 inline-flex items-center gap-1"
                    >
                      <app-icon name="file-text" [size]="12" />
                      {{ entry.document.original_name }}
                    </p>
                  }
                </div>
              </li>
            }
          </ul>
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
  private readonly vexiApi = inject(VexiApiService);

  readonly activity = signal<VexiActivityEntry[]>([]);
  readonly loadingActivity = signal(false);
  readonly activityError = signal<string | null>(null);

  constructor() {
    // Cargado en el constructor y no con un guard de ruta: la actividad es
    // informativa y su fallo no debe impedir entrar a apagar a Vexi, que es lo
    // urgente si algo salió mal.
    void this.loadActivity();
  }

  async loadActivity(): Promise<void> {
    if (this.loadingActivity()) return;

    this.loadingActivity.set(true);
    this.activityError.set(null);

    try {
      this.activity.set(await firstValueFrom(this.vexiApi.getActivity(50)));
    } catch (error) {
      this.activityError.set(
        parseApiError(error).userMessage ??
          'No se pudo cargar la actividad de Vexi.',
      );
    } finally {
      this.loadingActivity.set(false);
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
    () => this.override() ?? this.settingsFacade.vexiEnabled(),
  );

  readonly toggleDescription = computed(() =>
    this.enabled()
      ? 'Vexi aparece para todos los usuarios de la tienda.'
      : 'El asistente no se carga y sus endpoints responden módulo deshabilitado.',
  );

  // ------------------------------------------------------------------
  // Motor de voz
  // ------------------------------------------------------------------

  /**
   * Las dos opciones, con la diferencia que de verdad importa al elegir.
   *
   * No es latencia ni costo: es que sólo el pipeline pasa por la tarjeta de
   * confirmación del panel, así que sólo el pipeline puede ejecutar escrituras
   * (ajustar stock, crear un pedido). El realtime queda como camino de sólo
   * lectura. Un texto que hablara de WebRTC no ayudaría a decidir a un dueño de
   * tienda; esto sí.
   */
  readonly engineOptions: ReadonlyArray<{
    value: 'pipeline' | 'realtime';
    label: string;
    description: string;
    recommended?: boolean;
  }> = [
    {
      value: 'pipeline',
      label: 'Completo',
      description:
        'Vexi transcribe lo que dices, lo responde con el mismo cerebro del chat y te lo dicta. Es el único que puede ejecutar acciones por voz, siempre pidiéndote confirmación antes de aplicar nada.',
      recommended: true,
    },
    {
      value: 'realtime',
      label: 'Conversación directa',
      description:
        'Habla y escucha en tiempo real, con menos demora entre tu voz y la suya. Solo consulta: no puede aplicar cambios en la tienda. Requiere un proveedor de voz en tiempo real configurado en el motor de IA.',
    },
  ];

  private readonly engineOverride = signal<'pipeline' | 'realtime' | null>(null);

  readonly savingEngine = signal(false);

  readonly engine = computed(
    () => this.engineOverride() ?? this.settingsFacade.vexiVoiceEngine(),
  );

  async onEngineChange(next: 'pipeline' | 'realtime'): Promise<void> {
    if (this.savingEngine() || next === this.engine()) {
      return;
    }

    const previous = this.engine();
    this.engineOverride.set(next);
    this.savingEngine.set(true);

    try {
      // Sólo viaja `voice_engine`. El backend mezcla la sección `vexi` por
      // clave, así que esto no pisa `enabled` — antes de ese arreglo un PATCH
      // parcial reemplazaba la sección entera y cada control borraba al otro.
      await firstValueFrom(
        this.settingsService.saveSettingsNow({ vexi: { voice_engine: next } }),
      );
      this.engineOverride.set(null);
      this.toast.success(
        next === 'pipeline'
          ? 'El modo voz quedó en Completo: Vexi puede ejecutar acciones con tu confirmación.'
          : 'El modo voz quedó en Conversación directa: solo consultas.',
      );
    } catch (error) {
      this.engineOverride.set(previous);
      this.toast.error(
        parseApiError(error).userMessage ??
          'No se pudo cambiar el motor de voz.',
      );
    } finally {
      this.savingEngine.set(false);
    }
  }

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
        next
          ? 'Vexi quedó activo en esta tienda.'
          : 'Vexi quedó desactivado.',
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
