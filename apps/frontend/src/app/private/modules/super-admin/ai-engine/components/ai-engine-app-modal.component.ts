import {
  Component,
  input,
  output,
  OnChanges,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  AIEngineApp,
  AIEngineConfig,
  AIModelType,
  CreateAIAppDto,
  MODEL_TYPES,
  MODEL_TYPE_LABELS,
  UpdateAIAppDto,
  OutputFormat,
} from '../interfaces';
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-ai-engine-app-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [title]="app() ? 'Editar Aplicacion IA' : 'Nueva Aplicacion IA'"
      [subtitle]="
        app()
          ? 'Editando: ' + app()!.name
          : 'Configura un caso de uso de IA con prompts y parametros'
      "
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <!-- Key + Name row -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              formControlName="key"
              label="Key (unico)"
              placeholder="product_description_generator"
              [required]="true"
              [control]="form.get('key')"
              [disabled]="isSubmitting() || !!app()"
              helpText="Identificador unico, no se puede cambiar"
            ></app-input>

            <app-input
              formControlName="name"
              label="Nombre"
              placeholder="Generador de descripciones"
              [required]="true"
              [control]="form.get('name')"
              [disabled]="isSubmitting()"
            ></app-input>
          </div>

          <!-- Description -->
          <app-input
            formControlName="description"
            label="Descripcion"
            placeholder="Describe el proposito de esta aplicacion"
            [control]="form.get('description')"
            [disabled]="isSubmitting()"
          ></app-input>

          <!-- Config selector -->
          <app-selector
            label="Configuracion de IA"
            placeholder="Usar configuracion por defecto"
            [options]="configOptions()"
            [formControl]="$any(form.get('config_id'))"
            [disabled]="isSubmitting()"
          ></app-selector>
          <p class="text-xs text-text-secondary -mt-2">
            Si no seleccionas una, se usara la configuracion marcada como
            default.
          </p>

          <!-- Model Type -->
          <div class="space-y-1">
            <app-selector
              label="Tipo de modelo"
              [options]="modelTypeOptions"
              [formControl]="$any(form.get('model_type'))"
              [disabled]="isSubmitting()"
            ></app-selector>
            <p class="text-xs text-text-secondary">
              Define el tipo de modelo requerido por esta aplicacion. Debe
              coincidir con el tipo de la configuracion seleccionada.
            </p>
            @if (modelTypeMismatch()) {
              <p
                class="text-xs text-red-600 mt-1 flex items-start gap-1"
                role="alert"
              >
                <span class="font-medium">
                  Tipo incompatible:
                </span>
                <span>
                  La configuracion seleccionada es de tipo
                  <strong>{{ modelTypeLabel(selectedConfigModelType()!) }}</strong>
                  pero esta aplicacion requiere
                  <strong>{{ modelTypeLabel(currentModelType()!) }}</strong
                  >.
                </span>
              </p>
            }
          </div>

          <!-- Voice parameters — only meaningful for a speech application.
               metadata.speech is what VexiSpeechService.resolveParams reads at
               runtime; before this section existed the backend read a field no
               UI could write, so a voice could only be changed by SQL. -->
          @if (isSpeechApp()) {
            <div class="space-y-3 rounded-lg border border-border p-3">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-medium text-text-primary">Voz</h4>
                @if (selectedProviderName()) {
                  <span class="text-xs text-text-secondary">
                    {{ selectedProviderName() }}
                  </span>
                }
              </div>

              <div
                formGroupName="speech"
                class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              >
                <app-input
                  formControlName="voice"
                  label="Voz"
                  [placeholder]="voiceSuggestions()[0] || 'shimmer'"
                  [control]="form.get('speech.voice')"
                  [disabled]="isSubmitting()"
                ></app-input>

                <app-selector
                  label="Formato"
                  [options]="speechFormatOptions"
                  [formControl]="$any(form.get('speech.response_format'))"
                  [disabled]="isSubmitting()"
                ></app-selector>

                <app-input
                  formControlName="speed"
                  label="Velocidad"
                  type="number"
                  [placeholder]="'1'"
                  [control]="form.get('speech.speed')"
                  [disabled]="isSubmitting()"
                ></app-input>

                <!-- Sólo para MiniMax: el TTS de OpenAI no tiene parámetro de
                     ganancia, y ofrecer un campo que el proveedor ignora en
                     silencio es peor que no ofrecerlo. -->
                @if (supportsVol()) {
                  <app-input
                    formControlName="vol"
                    label="Volumen"
                    type="number"
                    [placeholder]="'1'"
                    [control]="form.get('speech.vol')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                }
              </div>

              <p class="text-xs text-text-secondary">
                La voz es el identificador exacto del proveedor. Velocidad: 1 =
                normal, rango admitido de {{ speedRange()[0] }} a
                {{ speedRange()[1] }}.
                @if (supportsVol()) {
                  Volumen: 1 = sin cambio, multiplicador de {{ volRange[0] }} a
                  {{ volRange[1] }} (1.5 sube un 50%).
                }
              </p>

              @if (voiceSuggestions().length) {
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs text-text-secondary">Sugeridas:</span>
                  @for (suggestion of voiceSuggestions(); track suggestion) {
                    <button
                      type="button"
                      class="rounded-full border border-border px-2 py-0.5 text-xs
                             text-text-secondary hover:border-primary hover:text-primary
                             disabled:opacity-50"
                      [disabled]="isSubmitting()"
                      (click)="applyVoiceSuggestion(suggestion)"
                    >
                      {{ suggestion }}
                    </button>
                  }
                </div>
              }

              @if (speedOutOfRange()) {
                <p
                  class="text-xs text-red-600 flex items-start gap-1"
                  role="alert"
                >
                  <span class="font-medium">Velocidad fuera de rango:</span>
                  <span>
                    {{ selectedProviderName() || 'Este proveedor' }} solo admite
                    entre <strong>{{ speedRange()[0] }}</strong> y
                    <strong>{{ speedRange()[1] }}</strong>.
                  </span>
                </p>
              }

              @if (volOutOfRange()) {
                <p
                  class="text-xs text-red-600 flex items-start gap-1"
                  role="alert"
                >
                  <span class="font-medium">Volumen fuera de rango:</span>
                  <span>
                    {{ selectedProviderName() || 'Este proveedor' }} solo admite
                    entre <strong>{{ volRange[0] }}</strong> y
                    <strong>{{ volRange[1] }}</strong>. MiniMax rechaza la
                    petición en vez de acotar el valor, así que el turno se
                    perdería al sintetizar.
                  </span>
                </p>
              }
            </div>
          }

          <!-- System Prompt -->
          <div class="space-y-1">
            <label class="block text-sm font-medium text-text-primary">
              System Prompt
            </label>
            <textarea
              formControlName="system_prompt"
              rows="3"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
                     placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20
                     focus:border-primary disabled:opacity-50 resize-y"
              placeholder="Eres un asistente especializado en..."
              [attr.disabled]="isSubmitting() ? '' : null"
            ></textarea>
          </div>

          <!-- Prompt Template -->
          <div class="space-y-1">
            <label class="block text-sm font-medium text-text-primary">
              Prompt Template
            </label>
            <textarea
              formControlName="prompt_template"
              rows="4"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
                     placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20
                     focus:border-primary disabled:opacity-50 resize-y font-mono"
              placeholder="Genera una descripcion para: [nombre]. Contexto: [contexto]"
              [attr.disabled]="isSubmitting() ? '' : null"
            ></textarea>
            <p class="text-xs text-text-secondary">
              Usa {{'{{variable}}'}} para variables dinamicas. Ej:
              {{'{{name}}'}}, {{'{{context}}'}}
            </p>
          </div>

          <!-- Settings Row: Temperature + Max Tokens + Output Format -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <app-input
              formControlName="temperature"
              label="Temperatura"
              type="number"
              placeholder="0.7"
              [control]="form.get('temperature')"
              [disabled]="isSubmitting()"
              helpText="0 = preciso, 2 = creativo"
            ></app-input>

            <app-input
              formControlName="max_tokens"
              label="Max Tokens"
              type="number"
              placeholder="1024"
              [control]="form.get('max_tokens')"
              [disabled]="isSubmitting()"
            ></app-input>

            <app-selector
              label="Formato de Salida"
              [options]="outputFormatOptions"
              [formControl]="$any(form.get('output_format'))"
              [disabled]="isSubmitting()"
            ></app-selector>
          </div>

          <!-- Rate Limit Row -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              formControlName="rate_limit_max"
              label="Rate Limit (max requests)"
              type="number"
              placeholder="100"
              [control]="form.get('rate_limit_max')"
              [disabled]="isSubmitting()"
              helpText="Maximo de peticiones por ventana"
            ></app-input>

            <app-input
              formControlName="rate_limit_window"
              label="Ventana (segundos)"
              type="number"
              placeholder="60"
              [control]="form.get('rate_limit_window')"
              [disabled]="isSubmitting()"
            ></app-input>
          </div>

          <!-- Retry Config Row -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              formControlName="retry_max"
              label="Reintentos Maximos"
              type="number"
              placeholder="3"
              [control]="form.get('retry_max')"
              [disabled]="isSubmitting()"
            ></app-input>

            <app-input
              formControlName="retry_delay"
              label="Delay Reintentos (ms)"
              type="number"
              placeholder="1000"
              [control]="form.get('retry_delay')"
              [disabled]="isSubmitting()"
            ></app-input>
          </div>

          <!-- Active Toggle -->
          <div class="flex items-center gap-6 pt-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                formControlName="is_active"
                class="rounded border-gray-300 text-primary focus:ring-primary"
                [disabled]="isSubmitting()"
              />
              <span class="text-sm text-text-primary">Activa</span>
            </label>
          </div>
        </div>
      </form>

      <ng-container slot="footer">
        <div class="flex justify-end gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="
              form.invalid ||
              isSubmitting() ||
              modelTypeMismatch() ||
              speedOutOfRange() ||
              volOutOfRange()
            "
            [loading]="isSubmitting()"
          >
            {{ app() ? 'Actualizar' : 'Crear Aplicacion' }}
          </app-button>
        </div>
      </ng-container>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class AIEngineAppModalComponent implements OnChanges {
  private destroyRef = inject(DestroyRef);
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  app = input<AIEngineApp | null>(null);
  configs = input<AIEngineConfig[]>([]);
  isOpenChange = output<boolean>();
  submit = output<CreateAIAppDto | UpdateAIAppDto>();

  private fb = inject(FormBuilder);

  configOptions = signal<SelectorOption[]>([]);

  // Reactive state for the type-mismatch check between app.model_type and
  // selected config.model_type. We mirror form values into signals so the
  // template can use a `computed` without zone-driven change detection.
  private currentConfigId = signal<string | null>(null);
  currentModelType = signal<AIModelType | null>('text');
  private currentSpeed = signal<number | null>(null);
  private currentVol = signal<number | null>(null);

  selectedConfigModelType = computed<AIModelType | null>(() => {
    const id = this.currentConfigId();
    if (!id) return null;
    const found = this.configs().find((c) => c.id.toString() === id);
    if (!found) return null;
    return this.resolveConfigModelType(found);
  });

  modelTypeMismatch = computed<boolean>(() => {
    const appType = this.currentModelType();
    const configType = this.selectedConfigModelType();
    if (!appType || !configType) return false;
    return appType !== configType;
  });

  /**
   * Voice parameters are only shown for a speech application, because that is the
   * only `model_type` whose runtime reads `metadata.speech`.
   */
  isSpeechApp = computed<boolean>(() => this.currentModelType() === 'speech');

  private selectedConfig = computed(() => {
    const id = this.currentConfigId();
    if (!id) return null;
    return this.configs().find((c) => c.id.toString() === id) ?? null;
  });

  selectedProviderName = computed<string | null>(
    () => this.selectedConfig()?.provider ?? null,
  );

  /**
   * Speed windows differ per provider, and both ends matter: MiniMax rejects
   * anything outside 0.5–2 with a validation error rather than clamping, so a
   * value the operator typed for OpenAI's wider range would fail at synthesis
   * time — one turn too late to be diagnosed here.
   */
  speedRange = computed<[number, number]>(() =>
    this.isMinimax() ? [0.5, 2] : [0.25, 4],
  );

  /**
   * Suggestions, not a closed list. MiniMax publishes hundreds of voices and
   * keeps adding them; a `select` would make every voice released after this
   * build unreachable.
   */
  voiceSuggestions = computed<string[]>(() =>
    this.isMinimax()
      ? [
          'Spanish_MaturePartner',
          'Spanish_Kind-heartedGirl',
          'Spanish_ReliableMan',
        ]
      : ['shimmer', 'alloy', 'nova', 'echo', 'fable', 'onyx'],
  );

  speedOutOfRange = computed<boolean>(() => {
    if (!this.isSpeechApp()) return false;
    const speed = this.currentSpeed();
    if (speed === null) return false;
    const [min, max] = this.speedRange();
    return speed < min || speed > max;
  });

  /**
   * Ventana de volumen. Sólo MiniMax lo admite: el TTS de OpenAI no tiene
   * parámetro de ganancia, así que el campo se oculta en vez de ofrecer algo que
   * el proveedor va a ignorar en silencio.
   *
   * El mínimo es 0.1 y no 0 a propósito: `vol: 0` sintetiza audio mudo y lo
   * devuelve con éxito, o sea que Vexi dejaría de hablar sin ningún error que lo
   * explique.
   */
  volRange: readonly [number, number] = [0.1, 10];

  supportsVol = computed<boolean>(() => this.isSpeechApp() && this.isMinimax());

  volOutOfRange = computed<boolean>(() => {
    if (!this.supportsVol()) return false;
    const vol = this.currentVol();
    if (vol === null) return false;
    const [min, max] = this.volRange;
    return vol < min || vol > max;
  });

  private isMinimax = computed<boolean>(() =>
    (this.selectedProviderName() || '').toLowerCase().includes('minimax'),
  );

  modelTypeOptions: SelectorOption[] = MODEL_TYPES.map((value) => ({
    value,
    label: MODEL_TYPE_LABELS[value],
  }));

  outputFormatOptions: SelectorOption[] = [
    { value: 'text', label: 'Texto' },
    { value: 'json', label: 'JSON' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'html', label: 'HTML' },
    { value: 'image', label: 'Imagen' },
    { value: 'embedding', label: 'Embeddings' },
    { value: 'audio', label: 'Audio' },
    { value: 'video', label: 'Video' },
    { value: 'rerank', label: 'Rerank' },
    { value: 'speech', label: 'Speech' },
    { value: 'transcription', label: 'Transcripcion' },
  ];

  speechFormatOptions: SelectorOption[] = [
    { value: 'mp3', label: 'MP3' },
    { value: 'wav', label: 'WAV' },
    { value: 'pcm', label: 'PCM' },
    { value: 'flac', label: 'FLAC' },
    { value: 'opus', label: 'Opus' },
  ];

  form: FormGroup = this.fb.group({
    key: ['', [Validators.required, Validators.maxLength(100)]],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
    config_id: [null],
    model_type: ['text' as AIModelType, [Validators.required]],
    system_prompt: [''],
    prompt_template: [''],
    temperature: [null],
    max_tokens: [null],
    output_format: ['text'],
    rate_limit_max: [null],
    rate_limit_window: [null],
    retry_max: [null],
    retry_delay: [null],
    is_active: [true],
    speech: this.fb.group({
      voice: [''],
      response_format: ['mp3'],
      speed: [null as number | null],
      vol: [null as number | null],
    }),
  });

  constructor() {
    this.form
      .get('config_id')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configId: string | null) => {
        this.currentConfigId.set(configId ? configId.toString() : null);
        this.syncOutputFormatWithConfig(configId);
      });

    this.form
      .get('model_type')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((modelType: AIModelType | null) => {
        this.currentModelType.set(modelType);
      });

    this.form
      .get('speech.speed')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((speed: unknown) => {
        this.currentSpeed.set(this.toFiniteNumber(speed));
      });

    // Un `computed()` no reacciona a un FormControl, así que el valor se espeja
    // en una señal como ya se hace con la velocidad.
    this.form
      .get('speech.vol')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((vol: unknown) => {
        this.currentVol.set(this.toFiniteNumber(vol));
      });
  }

  applyVoiceSuggestion(voice: string): void {
    this.form.get('speech.voice')?.setValue(voice);
  }

  private toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  ngOnChanges(): void {
    // Build config options from input — include model_type in label so
    // super-admins can pick the matching config at a glance.
    const cfgs = this.configs();
    this.configOptions.set([
      { value: '', label: 'Usar configuracion por defecto' },
      ...cfgs.map((c) => ({
        value: c.id.toString(),
        label: `${c.label} (${c.provider} - ${MODEL_TYPE_LABELS[this.resolveConfigModelType(c)]})`,
      })),
    ]);

    if (this.isOpen() && this.app()) {
      const a = this.app()!;
      const modelType: AIModelType = a.model_type || 'text';
      const speech = (a.metadata?.['speech'] as Record<string, any>) || {};
      this.form.patchValue({
        speech: {
          voice: speech['voice'] ?? '',
          response_format: speech['response_format'] ?? 'mp3',
          speed: speech['speed'] ?? null,
          vol: speech['vol'] ?? null,
        },
        key: a.key,
        name: a.name,
        description: a.description || '',
        config_id: a.config_id?.toString() || '',
        model_type: modelType,
        system_prompt: a.system_prompt || '',
        prompt_template: a.prompt_template || '',
        temperature: a.temperature ?? null,
        max_tokens: a.max_tokens ?? null,
        output_format: a.output_format || 'text',
        rate_limit_max: a.rate_limit?.maxRequests ?? null,
        rate_limit_window: a.rate_limit?.windowSeconds ?? null,
        retry_max: a.retry_config?.maxRetries ?? null,
        retry_delay: a.retry_config?.delayMs ?? null,
        is_active: a.is_active,
      });
      this.currentModelType.set(modelType);
      this.currentConfigId.set(a.config_id?.toString() || null);
      this.currentSpeed.set(this.toFiniteNumber(speech['speed']));
      this.currentVol.set(this.toFiniteNumber(speech['vol']));
      // Disable key editing on existing apps
      this.form.get('key')?.disable();
    } else if (this.isOpen() && !this.app()) {
      this.resetForm();
      this.form.get('key')?.enable();
    }
  }

  onSubmit(): void {
    if (this.form.invalid || this.speedOutOfRange() || this.volOutOfRange()) {
      return;
    }

    const raw = this.form.getRawValue();
    const data: any = {
      key: raw.key,
      name: raw.name,
      description: raw.description || undefined,
      config_id: raw.config_id ? Number(raw.config_id) : null,
      model_type: (raw.model_type || 'text') as AIModelType,
      system_prompt: raw.system_prompt || undefined,
      prompt_template: raw.prompt_template || undefined,
      temperature:
        raw.temperature != null ? Number(raw.temperature) : undefined,
      max_tokens: raw.max_tokens != null ? Number(raw.max_tokens) : undefined,
      output_format: raw.output_format as OutputFormat,
      is_active: raw.is_active,
    };

    // Build rate_limit object if any value provided
    if (raw.rate_limit_max != null || raw.rate_limit_window != null) {
      data.rate_limit = {
        maxRequests: Number(raw.rate_limit_max) || 100,
        windowSeconds: Number(raw.rate_limit_window) || 60,
      };
    }

    // Build retry_config object if any value provided
    if (raw.retry_max != null || raw.retry_delay != null) {
      data.retry_config = {
        maxRetries: Number(raw.retry_max) || 3,
        delayMs: Number(raw.retry_delay) || 1000,
      };
    }

    const metadata = this.buildMetadata(raw);
    if (metadata) {
      data.metadata = metadata;
    }

    this.submit.emit(data);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  /**
   * Merges the voice block into whatever `metadata` the row already carries.
   *
   * The backend update spreads the DTO straight onto the Prisma `data`, so
   * sending `metadata` replaces the whole JSON column. Anything this form does
   * not know about — keys another surface wrote — has to be carried through here
   * or it is silently dropped on the first save.
   *
   * Returns `undefined` when there is nothing to write, so a text application is
   * never handed an empty `metadata` it did not ask for.
   */
  private buildMetadata(raw: any): Record<string, any> | undefined {
    const existing = { ...(this.app()?.metadata || {}) };

    if (!this.isSpeechApp()) {
      return Object.keys(existing).length ? existing : undefined;
    }

    const speech: Record<string, any> = {
      ...((existing['speech'] as Record<string, any>) || {}),
    };

    const voice = (raw.speech?.voice || '').trim();
    const format = raw.speech?.response_format || undefined;
    const speed = this.toFiniteNumber(raw.speech?.speed);
    const vol = this.toFiniteNumber(raw.speech?.vol);

    if (voice) speech['voice'] = voice;
    else delete speech['voice'];

    if (format) speech['response_format'] = format;
    else delete speech['response_format'];

    if (speed !== null) speech['speed'] = speed;
    else delete speech['speed'];

    // El campo está oculto para proveedores sin ganancia, pero el valor que ya
    // estuviera guardado NO se borra: ocultar un control no es lo mismo que
    // pedir que su dato desaparezca, y el operador podría estar cambiando de
    // config temporalmente. Sólo se escribe o se limpia cuando el campo se ve.
    if (this.supportsVol()) {
      if (vol !== null) speech['vol'] = vol;
      else delete speech['vol'];
    }

    if (Object.keys(speech).length) existing['speech'] = speech;
    else delete existing['speech'];

    return Object.keys(existing).length ? existing : undefined;
  }

  private resetForm(): void {
    this.form.reset({
      key: '',
      name: '',
      description: '',
      config_id: '',
      model_type: 'text' as AIModelType,
      system_prompt: '',
      prompt_template: '',
      temperature: null,
      max_tokens: null,
      output_format: 'text',
      rate_limit_max: null,
      rate_limit_window: null,
      retry_max: null,
      retry_delay: null,
      is_active: true,
      speech: { voice: '', response_format: 'mp3', speed: null, vol: null },
    });
    this.currentModelType.set('text');
    this.currentConfigId.set(null);
    this.currentSpeed.set(null);
    this.currentVol.set(null);
  }

  private syncOutputFormatWithConfig(configId: string | null): void {
    const selected = this.configs().find((config) => {
      return config.id.toString() === configId;
    });

    if (!selected) return;

    const modelType = this.resolveConfigModelType(selected);
    const current = this.form.get('output_format')?.value as OutputFormat;

    // Auto-align the app's model_type with the config's model_type when the
    // user picks an explicit non-text config. The user can still override.
    if (modelType !== 'text') {
      this.form.patchValue(
        {
          output_format: this.modelTypeToOutputFormat(modelType),
          model_type: modelType,
        },
        { emitEvent: false },
      );
      this.currentModelType.set(modelType);
      return;
    }

    if (
      [
        'image',
        'embedding',
        'audio',
        'video',
        'rerank',
        'speech',
        'transcription',
      ].includes(current)
    ) {
      this.form.patchValue({ output_format: 'text' }, { emitEvent: false });
    }
  }

  /**
   * Resolves a config's model_type. Prefers the top-level field added in
   * Phase A; falls back to legacy `settings.model_type` and finally to a
   * heuristic over model_id. This keeps the UI useful even if the backend
   * (Phase B1) hasn't shipped the field on the wire yet.
   */
  private resolveConfigModelType(config: AIEngineConfig): AIModelType {
    if (config.model_type) return config.model_type;

    const settings = config.settings || {};
    if (settings.model_type) return settings.model_type;

    const modelId = (config.model_id || '').toLowerCase();
    if (
      settings.image_generation_mode ||
      settings.image_endpoint ||
      settings.image_model ||
      settings.modalities?.includes('image') ||
      modelId.includes('image') ||
      modelId.includes('imagine') ||
      modelId.includes('seedream') ||
      modelId.includes('dall-e')
    ) {
      return 'image';
    }

    return 'text';
  }

  private modelTypeToOutputFormat(modelType: AIModelType): OutputFormat {
    return modelType === 'text' ? 'text' : modelType;
  }

  modelTypeLabel(modelType: AIModelType): string {
    return MODEL_TYPE_LABELS[modelType] ?? modelType;
  }
}
