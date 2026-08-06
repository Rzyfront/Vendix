import {
  Component,
  input,
  output,
  OnChanges,
  SimpleChanges,
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
  AIEngineConfig,
  AIModelType,
  CreateAIConfigDto,
  MODEL_TYPES,
  MODEL_TYPE_LABELS,
  NOISE_REDUCTION_LABELS,
  NoiseReductionSetting,
  REALTIME_VOICES,
  TURN_DETECTION_LABELS,
  TurnDetectionSetting,
  UpdateAIConfigDto,
  KNOWN_PROVIDERS,
  KnownProvider,
} from '../interfaces';
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-ai-engine-config-modal',
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
      [title]="config() ? 'Editar Configuracion' : 'Nueva Configuracion AI'"
      [subtitle]="
        config()
          ? 'Editando: ' + config()!.label
          : 'Configura un proveedor de inteligencia artificial'
      "
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <!-- Provider Preset -->
          <div class="space-y-2">
            <app-selector
              label="Proveedor"
              placeholder="Seleccionar proveedor"
              [options]="providerOptions"
              [formControl]="$any(form.get('provider'))"
              [disabled]="isSubmitting()"
            ></app-selector>
          </div>

          <!-- SDK Type -->
          <div class="space-y-2">
            <app-selector
              label="Tipo de SDK"
              [options]="sdkTypeOptions"
              [formControl]="$any(form.get('sdk_type'))"
              [disabled]="isSubmitting()"
            ></app-selector>
            <p class="text-xs text-text-secondary">
              OpenAI Compatible cubre OpenAI, Ollama, Groq, Mistral, etc.
              Anthropic Compatible cubre Claude.
            </p>
          </div>

          <!-- Label -->
          <app-input
            formControlName="label"
            label="Nombre Descriptivo"
            placeholder="Ej: GPT-4o Production"
            [required]="true"
            [control]="form.get('label')"
            [disabled]="isSubmitting()"
            helpText="Nombre para identificar esta configuracion en el panel"
          ></app-input>

          <!-- Model ID -->
          <div class="space-y-2">
            @if (suggestedModels().length > 0) {
              <app-selector
                label="Modelo"
                placeholder="Seleccionar modelo"
                [options]="modelOptions()"
                [formControl]="$any(form.get('model_id'))"
                [disabled]="isSubmitting()"
              ></app-selector>
            } @else {
              <app-input
                formControlName="model_id"
                label="ID del Modelo"
                placeholder="Ej: gpt-4o, claude-sonnet-4-20250514"
                [required]="true"
                [control]="form.get('model_id')"
                [disabled]="isSubmitting()"
                helpText="Identificador exacto del modelo del proveedor"
              ></app-input>
            }
          </div>

          <!-- Base URL -->
          <app-input
            formControlName="base_url"
            label="URL Base (opcional)"
            placeholder="https://api.example.com/v1"
            [control]="form.get('base_url')"
            [disabled]="isSubmitting()"
            helpText="Dejar vacio para usar la URL oficial del SDK"
          ></app-input>

          <!-- Model Type -->
          <div class="space-y-1">
            <app-selector
              label="Tipo de modelo"
              [options]="modelTypeOptions"
              [formControl]="$any(form.get('model_type'))"
              [disabled]="isSubmitting()"
            ></app-selector>
            <p class="text-xs text-text-secondary">
              Define la capacidad principal del modelo (texto, imagen,
              embeddings, etc.). Se valida contra el tipo de cada aplicacion.
            </p>
          </div>

          <!-- API Key -->
          <app-input
            formControlName="api_key_ref"
            label="API Key (opcional)"
            type="password"
            placeholder="sk-..."
            [control]="form.get('api_key_ref')"
            [disabled]="isSubmitting()"
            helpText="Se puede omitir si se define via variable de entorno AI_PROVIDER_API_KEY"
          ></app-input>

          <!-- Settings Row -->
          <div class="grid grid-cols-2 gap-4">
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
          </div>

          <!-- Audio / voz en tiempo real -->
          @if (isAudio()) {
            <div
              class="space-y-4 rounded-lg border border-border p-4 bg-background-secondary"
            >
              <div>
                <h4 class="text-sm font-medium text-text-primary">
                  Voz en tiempo real
                </h4>
                <p class="text-xs text-text-secondary mt-1">
                  Transporte de la sesion de voz. La persona hablada (el prompt)
                  se edita en la aplicacion
                  <code>vexi_realtime_voice</code>, no aqui.
                </p>
              </div>

              <div class="space-y-1">
                <app-selector
                  label="Voz"
                  placeholder="Seleccionar voz"
                  [options]="voiceOptions"
                  [formControl]="$any(form.get('voice'))"
                  [disabled]="isSubmitting()"
                ></app-selector>
                <p class="text-xs text-text-secondary">
                  Solo voces del Realtime API. Las de TTS
                  (<code>nova</code>, <code>onyx</code>, <code>fable</code>) no
                  aplican aqui.
                </p>
              </div>

              <div class="space-y-1">
                <app-selector
                  label="Deteccion de turno"
                  [options]="turnDetectionOptions"
                  [formControl]="$any(form.get('turn_detection_type'))"
                  [disabled]="isSubmitting()"
                ></app-selector>
                <p class="text-xs text-text-secondary">
                  Define cuando el modelo considera que terminaste de hablar.
                  «Default del proveedor» no envia el parametro.
                </p>
              </div>

              @if (hasTurnDetection()) {
                <div class="grid grid-cols-2 gap-4">
                  <app-input
                    formControlName="turn_detection_silence_ms"
                    label="Silencio (ms)"
                    type="number"
                    placeholder="500"
                    [control]="form.get('turn_detection_silence_ms')"
                    [disabled]="isSubmitting()"
                    helpText="Pausa antes de cerrar el turno"
                  ></app-input>

                  @if (isServerVad()) {
                    <app-input
                      formControlName="turn_detection_threshold"
                      label="Umbral (0 a 1)"
                      type="number"
                      placeholder="0.5"
                      [control]="form.get('turn_detection_threshold')"
                      [disabled]="isSubmitting()"
                      helpText="Volumen minimo para contar como voz"
                    ></app-input>
                  }
                </div>
              }

              <app-selector
                label="Reduccion de ruido"
                [options]="noiseReductionOptions"
                [formControl]="$any(form.get('noise_reduction'))"
                [disabled]="isSubmitting()"
              ></app-selector>

              <div class="grid grid-cols-2 gap-4">
                <app-input
                  formControlName="transcription_model"
                  label="Modelo de transcripcion"
                  placeholder="gpt-4o-mini-transcribe"
                  [control]="form.get('transcription_model')"
                  [disabled]="isSubmitting()"
                  helpText="Opcional: transcribe lo que dice el usuario"
                ></app-input>

                <app-input
                  formControlName="client_secret_ttl_seconds"
                  label="TTL del client secret (s)"
                  type="number"
                  placeholder="60"
                  [control]="form.get('client_secret_ttl_seconds')"
                  [disabled]="isSubmitting()"
                  helpText="Acotado a 10-300 en el servidor"
                ></app-input>
              </div>
            </div>
          }

          <!-- Toggles -->
          <div class="flex items-center gap-6 pt-2 flex-wrap">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                formControlName="is_default"
                class="rounded border-gray-300 text-primary focus:ring-primary"
                [disabled]="isSubmitting() || isAudio()"
              />
              <span class="text-sm text-text-primary"
                >Proveedor por defecto</span
              >
            </label>

            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                formControlName="is_active"
                class="rounded border-gray-300 text-primary focus:ring-primary"
                [disabled]="isSubmitting()"
              />
              <span class="text-sm text-text-primary">Activo</span>
            </label>

            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                formControlName="thinking"
                class="rounded border-gray-300 text-primary focus:ring-primary"
                [disabled]="isSubmitting()"
              />
              <span class="text-sm text-text-primary">Thinking Mode</span>
            </label>
          </div>
          @if (isAudio()) {
            <p class="text-xs text-amber-600 mt-1">
              Una config de audio no puede ser proveedor por defecto: el default
              es global y no distingue por tipo de modelo, asi que todas las
              aplicaciones sin config propia resolverian al proveedor de voz.
            </p>
          }
          @if (form.get('thinking')?.value) {
            <p class="text-xs text-amber-600 mt-1">
              Modelos como DeepSeek R1 generan bloques de razonamiento interno.
              Con esta opcion activa, se preservaran en la respuesta.
              Desactivalo si solo necesitas la respuesta final.
            </p>
          }
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
            [disabled]="form.invalid || isSubmitting()"
            [loading]="isSubmitting()"
          >
            {{ config() ? 'Actualizar' : 'Crear Configuracion' }}
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
export class AIEngineConfigModalComponent implements OnChanges {
  private destroyRef = inject(DestroyRef);
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  config = input<AIEngineConfig | null>(null);
  prefill = input<AIEngineConfig | null>(null);
  isOpenChange = output<boolean>();
  submit = output<CreateAIConfigDto | UpdateAIConfigDto>();

  private fb = inject(FormBuilder);
  private selectedProvider = signal<KnownProvider | null>(null);

  suggestedModels = signal<string[]>([]);
  modelOptions = signal<SelectorOption[]>([]);

  providerOptions: SelectorOption[] = KNOWN_PROVIDERS.map((p) => ({
    value: p.name,
    label: p.name,
  }));

  sdkTypeOptions: SelectorOption[] = [
    { value: 'openai_compatible', label: 'OpenAI Compatible' },
    { value: 'anthropic_compatible', label: 'Anthropic Compatible' },
  ];

  modelTypeOptions: SelectorOption[] = MODEL_TYPES.map((value) => ({
    value,
    label: MODEL_TYPE_LABELS[value],
  }));

  voiceOptions: SelectorOption[] = REALTIME_VOICES.map((value) => ({
    value,
    label: value,
  }));

  // La opcion vacia no es "ninguno": significa no enviar el parametro y dejar
  // el default del proveedor, que es distinto de enviarlo desactivado ('off').
  turnDetectionOptions: SelectorOption[] = [
    { value: '', label: 'Default del proveedor' },
    ...(
      ['semantic_vad', 'server_vad', 'off'] as TurnDetectionSetting[]
    ).map((value) => ({ value, label: TURN_DETECTION_LABELS[value] })),
  ];

  noiseReductionOptions: SelectorOption[] = [
    { value: '', label: 'Default del proveedor' },
    ...(
      ['near_field', 'far_field', 'off'] as NoiseReductionSetting[]
    ).map((value) => ({ value, label: NOISE_REDUCTION_LABELS[value] })),
  ];

  // Espejo de los controles en signals: un `computed` que lea
  // `form.get(...)?.value` NO es reactivo — el FormControl no notifica al grafo
  // de signals — asi que el panel condicional nunca se re-evaluaria bajo
  // Zoneless. Mismo patron que `ai-engine-app-modal`.
  private currentModelType = signal<AIModelType>('text');
  private currentTurnDetection = signal<string>('');

  isAudio = computed(() => this.currentModelType() === 'audio');
  isServerVad = computed(() => this.currentTurnDetection() === 'server_vad');
  hasTurnDetection = computed(() => {
    const value = this.currentTurnDetection();
    return value === 'server_vad' || value === 'semantic_vad';
  });

  form: FormGroup = this.fb.group({
    provider: ['', [Validators.required]],
    sdk_type: ['openai_compatible', [Validators.required]],
    label: ['', [Validators.required, Validators.maxLength(255)]],
    model_id: ['', [Validators.required, Validators.maxLength(100)]],
    base_url: [''],
    model_type: ['text' as AIModelType, [Validators.required]],
    api_key_ref: [''],
    temperature: [null],
    max_tokens: [null],
    is_default: [false],
    is_active: [true],
    thinking: [false],
    voice: [''],
    turn_detection_type: [''],
    turn_detection_silence_ms: [null],
    turn_detection_threshold: [null],
    noise_reduction: [''],
    transcription_model: [''],
    client_secret_ttl_seconds: [null],
  });

  constructor() {
    // Watch provider changes to auto-fill sdk_type and models
    this.form
      .get('provider')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((providerName: string) => {
        const preset = KNOWN_PROVIDERS.find((p) => p.name === providerName);
        if (preset) {
          this.selectedProvider.set(preset);
          this.form.patchValue(
            { sdk_type: preset.sdkType },
            { emitEvent: false },
          );
          if (preset.defaultUrl && !this.form.get('base_url')?.value) {
            this.form.patchValue(
              { base_url: preset.defaultUrl },
              { emitEvent: false },
            );
          }
          this.suggestedModels.set(preset.models);
          this.modelOptions.set(
            preset.models.map((m) => ({ value: m, label: m })),
          );
          // Reset model_id if current value not in new models list
          const currentModel = this.form.get('model_id')?.value;
          if (
            preset.models.length > 0 &&
            !preset.models.includes(currentModel)
          ) {
            this.form.patchValue(
              { model_id: preset.models[0] },
              { emitEvent: false },
            );
          }
        } else {
          this.selectedProvider.set(null);
          this.suggestedModels.set([]);
          this.modelOptions.set([]);
        }
      });

    this.form
      .get('model_type')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((modelType: AIModelType | null) => {
        this.currentModelType.set(modelType || 'text');

        // Una config de audio no puede ser el default global: el backend lo
        // rechaza con AI_CONFIG_003. Se limpia aqui para que el operador no
        // descubra el conflicto recien al guardar.
        if (modelType === 'audio' && this.form.get('is_default')?.value) {
          this.form.patchValue({ is_default: false }, { emitEvent: false });
        }
      });

    this.form
      .get('turn_detection_type')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: string | null) => {
        this.currentTurnDetection.set(value || '');
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['isOpen']) return;
    if (!this.isOpen()) return;
    if (this.isOpen() && this.config()) {
      const c = this.config()!;
      this.form.patchValue({
        provider: c.provider,
        sdk_type: c.sdk_type,
        label: c.label,
        model_id: c.model_id,
        base_url: c.base_url || '',
        model_type: c.model_type || c.settings?.model_type || this.inferModelType(c),
        api_key_ref: '',
        temperature: c.settings?.temperature ?? null,
        max_tokens: c.settings?.maxTokens ?? null,
        is_default: c.is_default,
        is_active: c.is_active,
        thinking: c.settings?.thinking ?? false,
        ...this.audioFormValues(c),
      });
      this.syncAudioSignals();
    } else if (this.isOpen() && this.prefill()) {
      const p = this.prefill()!;
      this.form.patchValue({
        provider: p.provider,
        sdk_type: p.sdk_type,
        label: p.label,
        model_id: p.model_id,
        base_url: p.base_url || '',
        model_type: p.model_type || p.settings?.model_type || this.inferModelType(p),
        api_key_ref: '',
        temperature: p.settings?.temperature ?? null,
        max_tokens: p.settings?.maxTokens ?? null,
        is_default: false,
        is_active: p.is_active,
        thinking: p.settings?.thinking ?? false,
        ...this.audioFormValues(p),
      });
      this.syncAudioSignals();
    } else if (this.isOpen() && !this.config()) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    const raw = this.form.value;
    const settings: Record<string, any> = {
      ...(this.config()?.settings ?? {}),
    };
    if (raw.temperature != null) {
      settings['temperature'] = Number(raw.temperature);
    } else {
      delete settings['temperature'];
    }
    if (raw.max_tokens != null) {
      settings['maxTokens'] = Number(raw.max_tokens);
    } else {
      delete settings['maxTokens'];
    }
    settings['thinking'] = !!raw.thinking;
    const modelType = (raw.model_type || 'text') as AIModelType;
    settings['model_type'] = modelType;

    const data: any = {
      provider: raw.provider,
      sdk_type: raw.sdk_type,
      label: raw.label,
      model_id: raw.model_id,
      model_type: modelType,
      is_default: raw.is_default,
      is_active: raw.is_active,
      settings: Object.keys(settings).length > 0 ? settings : undefined,
    };

    const baseUrl = typeof raw.base_url === 'string' ? raw.base_url.trim() : '';
    this.applyModelTypeSettings(settings, settings['model_type'], baseUrl, raw);

    if (baseUrl) {
      data.base_url = baseUrl;
    } else if (this.config()) {
      data.base_url = null;
    }
    if (raw.api_key_ref) data.api_key_ref = raw.api_key_ref;

    this.submit.emit(data);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  private resetForm(): void {
    this.form.reset({
      provider: '',
      sdk_type: 'openai_compatible',
      label: '',
      model_id: '',
      base_url: '',
      model_type: 'text',
      api_key_ref: '',
      temperature: null,
      max_tokens: null,
      is_default: false,
      is_active: true,
      thinking: false,
      voice: '',
      turn_detection_type: '',
      turn_detection_silence_ms: null,
      turn_detection_threshold: null,
      noise_reduction: '',
      transcription_model: '',
      client_secret_ttl_seconds: null,
    });
    this.suggestedModels.set([]);
    this.modelOptions.set([]);
    this.syncAudioSignals();
  }

  /**
   * Valores planos de audio desde `settings`. Todo queda vacio cuando la config
   * no es de audio, de modo que abrir una config de texto no arrastra los
   * valores de la de audio que se edito antes (el formulario es una instancia
   * reutilizada, no una nueva por apertura).
   */
  private audioFormValues(config: AIEngineConfig): Record<string, unknown> {
    const s = config.settings ?? {};

    return {
      voice: s.voice ?? '',
      turn_detection_type: s.turn_detection_type ?? '',
      turn_detection_silence_ms: s.turn_detection_silence_ms ?? null,
      turn_detection_threshold: s.turn_detection_threshold ?? null,
      noise_reduction: s.noise_reduction ?? '',
      transcription_model: s.transcription_model ?? '',
      client_secret_ttl_seconds: s.client_secret_ttl_seconds ?? null,
    };
  }

  /**
   * Realinea los signals espejo con el estado del formulario.
   *
   * `patchValue` y `reset` emiten `valueChanges`, asi que las suscripciones ya
   * corren; esto cubre el caso en que un cambio futuro pase `emitEvent: false`
   * y deje el panel condicional desincronizado del control que lo gobierna.
   */
  private syncAudioSignals(): void {
    this.currentModelType.set(
      (this.form.get('model_type')?.value as AIModelType) || 'text',
    );
    this.currentTurnDetection.set(
      (this.form.get('turn_detection_type')?.value as string) || '',
    );
  }

  private inferModelType(config: AIEngineConfig): AIModelType {
    const settings = config.settings || {};
    const modelId = config.model_id.toLowerCase();

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

  private applyModelTypeSettings(
    settings: Record<string, any>,
    modelType: AIModelType,
    baseUrl: string,
    raw: Record<string, any>,
  ): void {
    this.applyAudioSettings(settings, modelType, raw);

    if (modelType !== 'image') {
      delete settings['image_generation_mode'];
      delete settings['image_endpoint'];
      delete settings['image_model'];
      delete settings['modalities'];
      if (modelType === 'embedding' && baseUrl.includes('openrouter.ai')) {
        settings['encoding_format'] = settings['encoding_format'] || 'float';
      } else if (modelType !== 'embedding') {
        delete settings['encoding_format'];
      }
      return;
    }

    if (baseUrl.includes('openrouter.ai')) {
      settings['image_generation_mode'] = 'chat_completions';
      settings['modalities'] = ['image'];
    }
    delete settings['encoding_format'];
  }

  /**
   * Escribe o limpia las claves de transporte de audio.
   *
   * Se limpian al salir de `audio` por la misma razon que las de imagen: una
   * config que dejo de ser de audio no debe arrastrar una voz ni un TTL que ya
   * nadie lee, porque reaparecerian si alguien la vuelve a marcar como audio.
   *
   * Los vacios se borran en vez de guardarse como cadena vacia: el backend
   * distingue «clave ausente» (usar el default del proveedor) de un valor
   * explicito, y `''` no es ninguno de los dos.
   */
  private applyAudioSettings(
    settings: Record<string, any>,
    modelType: AIModelType,
    raw: Record<string, any>,
  ): void {
    const AUDIO_KEYS = [
      'voice',
      'turn_detection_type',
      'turn_detection_silence_ms',
      'turn_detection_threshold',
      'noise_reduction',
      'transcription_model',
      'client_secret_ttl_seconds',
    ];

    if (modelType !== 'audio') {
      for (const key of AUDIO_KEYS) delete settings[key];
      return;
    }

    this.setOrDelete(settings, 'voice', this.trimmed(raw['voice']));
    this.setOrDelete(
      settings,
      'turn_detection_type',
      this.trimmed(raw['turn_detection_type']),
    );
    this.setOrDelete(
      settings,
      'noise_reduction',
      this.trimmed(raw['noise_reduction']),
    );
    this.setOrDelete(
      settings,
      'transcription_model',
      this.trimmed(raw['transcription_model']),
    );
    this.setOrDelete(
      settings,
      'turn_detection_silence_ms',
      this.numeric(raw['turn_detection_silence_ms']),
    );
    this.setOrDelete(
      settings,
      'turn_detection_threshold',
      this.numeric(raw['turn_detection_threshold']),
    );
    this.setOrDelete(
      settings,
      'client_secret_ttl_seconds',
      this.numeric(raw['client_secret_ttl_seconds']),
    );
  }

  private setOrDelete(
    settings: Record<string, any>,
    key: string,
    value: string | number | null,
  ): void {
    if (value === null || value === '') {
      delete settings[key];
      return;
    }
    settings[key] = value;
  }

  private trimmed(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private numeric(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
