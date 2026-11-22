import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { AIToolCatalogEntry } from '../interfaces';
import {
  AgentRuntimeSheet,
  AgentVoiceProfileSummary,
  RuntimeAgentKey,
  UpdateAgentRuntimeDto,
} from '../interfaces/agent-runtime.interface';
import { AIEngineService } from '../services/ai-engine.service';
import { AiToolPickerComponent } from './ai-tool-picker/ai-tool-picker.component';

/**
 * Ficha única del agente (Vex o Vexi): una pantalla con modelo, proveedor,
 * voz, prompt, herramientas, iteraciones y tiempo. Edita las mismas tablas
 * que el resto del motor, y el cambio aplica a todas las tiendas sin deploy.
 * No existe «modo de voz»: la voz es por respuesta (TTS).
 */
@Component({
  selector: 'app-ai-engine-agent-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    SpinnerComponent,
    AiToolPickerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="isOpenChange.emit(false)"
      size="lg"
      [title]="'Ficha de ' + (sheet()?.agent?.name ?? agentKey())"
      subtitle="Aplica a todas las tiendas, sin deploy"
    >
      @if (loading()) {
        <div
          class="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary"
          role="status"
          aria-live="polite"
        >
          <app-spinner size="sm"></app-spinner>
          Cargando ficha…
        </div>
      } @else if (sheet(); as data) {
        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="space-y-6"
          aria-label="Ficha del agente"
        >
          <section class="space-y-3" aria-labelledby="sheet-model">
            <h3 id="sheet-model" class="text-sm font-semibold text-text-primary">
              Modelo y proveedor
            </h3>
            <app-selector
              label="Configuración de modelo"
              placeholder="Selecciona un modelo"
              [options]="configOptions()"
              [formControl]="configControl"
              [disabled]="saving() || !data.application"
              [helpText]="
                data.application
                  ? 'Aplicación: ' + data.application.name + ' (' + data.application.key + ')'
                  : 'Este agente no tiene una aplicación de IA asociada.'
              "
            ></app-selector>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-lg border border-border bg-background p-3">
                <p class="text-xs font-medium text-text-secondary">
                  Temperatura
                </p>
                <p class="mt-1 text-sm text-text-primary">
                  {{ data.unused_by_agents.temperature.value ?? '—' }}
                </p>
                <p class="mt-1 text-[11px] text-text-secondary">
                  No usado por agentes
                </p>
              </div>
              <div class="rounded-lg border border-border bg-background p-3">
                <p class="text-xs font-medium text-text-secondary">
                  Tope de tokens
                </p>
                <p class="mt-1 text-sm text-text-primary">
                  {{ data.unused_by_agents.max_tokens.value ?? '—' }}
                </p>
                <p class="mt-1 text-[11px] text-text-secondary">
                  No usado por agentes
                </p>
              </div>
            </div>
          </section>

          <section class="space-y-3" aria-labelledby="sheet-voice">
            <h3 id="sheet-voice" class="text-sm font-semibold text-text-primary">
              Voz
            </h3>
            <app-selector
              label="Voz del catálogo"
              placeholder="Sin voz asignada (usa la voz base)"
              [options]="voiceProfileOptions()"
              [formControl]="voiceProfileControl"
              [disabled]="saving()"
              helpText="Se administra en la pestaña Voces."
            ></app-selector>
            @if (hasProfileSelected()) {
              <p
                class="rounded-lg border border-border bg-background p-3 text-xs text-text-secondary"
                role="status"
              >
                La voz del catálogo manda. Los campos de voz base y ajuste propio
                solo se usan como respaldo.
              </p>
            }
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <app-input
                formControlName="voice"
                label="Voz"
                placeholder="Perfil de voz del proveedor"
                [control]="voiceControl"
                [disabled]="saving()"
                helpText="Vacío = voz base"
              ></app-input>
              <app-input
                formControlName="speed"
                label="Velocidad"
                type="number"
                step="0.1"
                min="0.5"
                [control]="speedControl"
                [disabled]="saving()"
                helpText="0,5 a 2"
              ></app-input>
              <app-input
                formControlName="vol"
                label="Volumen"
                type="number"
                step="0.1"
                min="0.1"
                [control]="volControl"
                [disabled]="saving()"
                helpText="0,1 a 10"
              ></app-input>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="preview()"
                [disabled]="previewing() || saving()"
                [loading]="previewing()"
              >
                <app-icon name="volume-2" [size]="16" slot="icon"></app-icon>
                Escuchar
              </app-button>
              @if (data.voice.has_override || voiceReset()) {
                <app-button
                  variant="ghost"
                  size="sm"
                  (clicked)="resetVoice()"
                  [disabled]="saving()"
                >
                  Usar voz base
                </app-button>
              }
              <span class="text-xs text-text-secondary" aria-live="polite">
                @if (voiceReset()) {
                  Se quitará el ajuste propio al guardar.
                } @else if (data.voice.has_override) {
                  Este agente tiene voz propia.
                } @else {
                  Usa la voz base.
                }
              </span>
            </div>
            <p class="text-xs text-text-secondary">
              «Escuchar» reproduce lo guardado; guarda antes para oír cambios.
            </p>
          </section>

          <section class="space-y-3" aria-labelledby="sheet-prompt">
            <h3
              id="sheet-prompt"
              class="text-sm font-semibold text-text-primary"
            >
              Prompt y herramientas
            </h3>
            <div class="space-y-1">
              <label
                for="agent-sheet-prompt"
                class="block text-sm font-medium text-text-primary"
              >
                System prompt
              </label>
              <textarea
                id="agent-sheet-prompt"
                formControlName="system_prompt"
                rows="4"
                class="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              ></textarea>
            </div>
            <app-ai-tool-picker
              formControlName="allowed_tools"
              label="Herramientas permitidas"
              mode="allow"
              allValue="empty"
              [tools]="tools()"
              helpText="Sin selección = todas las herramientas del catálogo."
            ></app-ai-tool-picker>
            <app-ai-tool-picker
              formControlName="denied_tools"
              label="Herramientas denegadas"
              mode="deny"
              [tools]="tools()"
              helpText="Se restan del catálogo después de todos los filtros."
            ></app-ai-tool-picker>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <app-input
                formControlName="max_iterations"
                label="Máx. iteraciones"
                type="number"
                [control]="maxIterationsControl"
                [disabled]="saving()"
                helpText="Entre 1 y 60. Vacío = valor por defecto"
              ></app-input>
              <app-input
                formControlName="timeout_seconds"
                label="Tiempo por turno (s)"
                type="number"
                [control]="timeoutControl"
                [disabled]="saving()"
                helpText="Entre 30 y 600. Vacío = valor por defecto"
              ></app-input>
            </div>
          </section>
        </form>
      } @else {
        <p class="py-6 text-sm text-text-secondary" role="alert">
          No se pudo cargar la ficha del agente.
        </p>
      }

      <ng-container slot="footer">
        <div class="flex justify-end gap-3">
          <app-button
            variant="outline"
            (clicked)="isOpenChange.emit(false)"
            [disabled]="saving()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="save()"
            [disabled]="form.invalid || saving() || !sheet()"
            [loading]="saving()"
          >
            Guardar
          </app-button>
        </div>
      </ng-container>
    </app-modal>
  `,
})
export class AIEngineAgentSheetComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AIEngineService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input<boolean>(false);
  readonly agentKey = input<RuntimeAgentKey>('vex');
  readonly tools = input<AIToolCatalogEntry[]>([]);
  readonly isOpenChange = output<boolean>();
  readonly saved = output<void>();

  protected readonly sheet = signal<AgentRuntimeSheet | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly previewing = signal(false);
  protected readonly voiceReset = signal(false);

  protected readonly configOptions = computed<SelectorOption[]>(() =>
    (this.sheet()?.available_configs ?? []).map((c) => ({
      value: String(c.id),
      label: `${c.provider} · ${c.model_id} (${c.label})`,
    })),
  );

  protected readonly voiceProfileOptions = computed<SelectorOption[]>(() => {
    const data = this.sheet();
    const profiles: AgentVoiceProfileSummary[] = [
      ...(data?.available_voice_profiles ?? []),
    ];
    const assigned = data?.voice.profile;
    // Keep the assigned voice selectable even if the catalog no longer lists it.
    if (assigned && !profiles.some((p) => p.id === assigned.id)) {
      profiles.push(assigned);
    }
    return [
      { value: '', label: 'Sin voz asignada (usa la voz base)' },
      ...profiles.map((p) => ({
        value: String(p.id),
        label: `${p.name} · ${p.provider} (${p.language})`,
      })),
    ];
  });

  protected readonly form = this.fb.group({
    config_id: [''],
    voice_profile_id: [''],
    voice: [''],
    speed: [null as number | null, [Validators.min(0.5), Validators.max(2)]],
    vol: [null as number | null, [Validators.min(0.1), Validators.max(10)]],
    system_prompt: [''],
    allowed_tools: [[] as string[], [Validators.maxLength(500)]],
    denied_tools: [[] as string[], [Validators.maxLength(500)]],
    max_iterations: [
      null as number | null,
      [Validators.min(1), Validators.max(60)],
    ],
    timeout_seconds: [
      null as number | null,
      [Validators.min(30), Validators.max(600)],
    ],
  });

  protected get configControl(): FormControl<string> {
    return this.form.controls.config_id as FormControl<string>;
  }
  protected get voiceProfileControl(): FormControl<string> {
    return this.form.controls.voice_profile_id as FormControl<string>;
  }
  protected get voiceControl(): FormControl<string> {
    return this.form.controls.voice as FormControl<string>;
  }
  protected get speedControl(): FormControl<number | null> {
    return this.form.controls.speed;
  }
  protected get volControl(): FormControl<number | null> {
    return this.form.controls.vol;
  }
  protected get maxIterationsControl(): FormControl<number | null> {
    return this.form.controls.max_iterations;
  }
  protected get timeoutControl(): FormControl<number | null> {
    return this.form.controls.timeout_seconds;
  }

  private readonly voiceProfileValue = toSignal(
    this.form.controls.voice_profile_id.valueChanges,
    { initialValue: '' },
  );
  protected readonly hasProfileSelected = computed(
    () => !!this.voiceProfileValue(),
  );

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const key = this.agentKey();
      if (open) untracked(() => this.load(key));
    });
  }

  private load(key: RuntimeAgentKey): void {
    this.loading.set(true);
    this.sheet.set(null);
    this.voiceReset.set(false);
    this.api
      .getAgentSheet(key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.sheet.set(data);
          this.patch(data);
          this.loading.set(false);
        },
        error: (error) => {
          this.toast.error(extractApiErrorMessage(error));
          this.loading.set(false);
        },
      });
  }

  private patch(data: AgentRuntimeSheet): void {
    this.form.reset({
      config_id:
        data.application?.config_id != null
          ? String(data.application.config_id)
          : '',
      voice_profile_id:
        data.voice.profile?.id != null ? String(data.voice.profile.id) : '',
      voice: data.voice.effective.voice ?? '',
      speed: data.voice.effective.speed ?? null,
      vol: data.voice.effective.vol ?? null,
      system_prompt: data.agent.system_prompt ?? '',
      allowed_tools: [...data.agent.allowed_tools],
      denied_tools: [...data.agent.denied_tools],
      max_iterations: data.agent.max_iterations,
      timeout_seconds: data.agent.timeout_seconds,
    });
  }

  protected resetVoice(): void {
    const base = this.sheet()?.voice.base;
    this.form.patchValue({
      voice: base?.voice ?? '',
      speed: base?.speed ?? null,
      vol: base?.vol ?? null,
    });
    this.voiceReset.set(true);
  }

  protected preview(): void {
    this.previewing.set(true);
    this.api
      .previewAgentVoice(this.agentKey())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (audio) => {
          this.previewing.set(false);
          void new Audio(
            `data:${audio.contentType};base64,${audio.audioBase64}`,
          )
            .play()
            .catch(() => this.toast.error('No se pudo reproducir la muestra'));
        },
        error: (error) => {
          this.previewing.set(false);
          this.toast.error(extractApiErrorMessage(error));
        },
      });
  }

  protected save(): void {
    const data = this.sheet();
    if (!data || this.form.invalid || this.saving()) return;
    const raw = this.form.getRawValue();

    const dto: UpdateAgentRuntimeDto = {
      system_prompt: raw.system_prompt?.trim() ? raw.system_prompt : null,
      allowed_tools: raw.allowed_tools ?? [],
      denied_tools: raw.denied_tools ?? [],
      max_iterations: this.toInt(raw.max_iterations),
      timeout_seconds: this.toInt(raw.timeout_seconds),
    };

    const profileId = Number(raw.voice_profile_id);
    dto.voice_profile_id =
      Number.isInteger(profileId) && profileId > 0 ? profileId : null;

    const configId = Number(raw.config_id);
    if (data.application && Number.isInteger(configId) && configId > 0) {
      dto.config_id = configId;
    }

    if (this.voiceReset()) {
      dto.voice = null;
    } else {
      const voice: NonNullable<UpdateAgentRuntimeDto['voice']> = {};
      if (raw.voice?.trim()) voice.voice = raw.voice.trim();
      if (raw.speed !== null && raw.speed !== undefined && `${raw.speed}` !== '')
        voice.speed = Number(raw.speed);
      if (raw.vol !== null && raw.vol !== undefined && `${raw.vol}` !== '')
        voice.vol = Number(raw.vol);
      if (Object.keys(voice).length > 0) dto.voice = voice;
    }

    this.saving.set(true);
    this.api
      .updateAgentSheet(this.agentKey(), dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.sheet.set(updated);
          this.patch(updated);
          this.voiceReset.set(false);
          this.saving.set(false);
          this.toast.success('Ficha guardada. Aplica a todas las tiendas.');
          this.saved.emit();
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.error(extractApiErrorMessage(error));
        },
      });
  }

  private toInt(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }
}
