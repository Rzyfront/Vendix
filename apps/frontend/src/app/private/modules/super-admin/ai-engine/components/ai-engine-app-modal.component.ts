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
  AI_FEATURE_CATEGORIES,
  AI_FEATURE_CATEGORY_LABELS,
  AIFeatureCategory,
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

/**
 * Apps whose backend service reads its own keys from `metadata`,
 * `retry_config` and `rate_limit` (instead of the engine's generic ones). The
 * modal edits those keys with typed fields and merges them into the row.
 */
const AGENT_SETTINGS_KINDS = [
  'vex_classifier',
  'agent_guardrail',
  'agent_guardrail_responder',
] as const;
type AgentSettingsKind = (typeof AGENT_SETTINGS_KINDS)[number];

const AGENT_SETTINGS_TITLES: Record<AgentSettingsKind, string> = {
  vex_classifier: 'Clasificador de Vex',
  agent_guardrail: 'Guardarraíl: cuándo cortar',
  agent_guardrail_responder: 'Guardarraíl: respuesta al infractor',
};

type JsonRecord = Record<string, unknown>;

/**
 * Ranges `AgentGuardrailService` accepts (it clamps anything outside). The
 * modal rejects out-of-range values so what super admin sees is what runs.
 */
interface AgentFieldRange {
  control: string;
  label: string;
  min: number;
  max: number;
  integer: boolean;
}
const AGENT_FIELD_RANGES: Partial<Record<AgentSettingsKind, AgentFieldRange[]>> = {
  agent_guardrail: [
    { control: 'min_confidence', label: 'Confianza mínima', min: 0, max: 1, integer: false },
    { control: 'strikes_before_cooldown', label: 'Infracciones antes de la pausa', min: 1, max: 20, integer: true },
    { control: 'cooldown_minutes', label: 'Minutos de pausa', min: 0, max: 1440, integer: false },
    { control: 'timeout_ms', label: 'Tiempo máximo', min: 200, max: 5000, integer: true },
    { control: 'context_messages', label: 'Mensajes de contexto', min: 0, max: 12, integer: true },
    { control: 'public_rate_penalty', label: 'Penalización en Vexi público', min: 0, max: 10, integer: true },
  ],
  agent_guardrail_responder: [
    { control: 'timeout_ms', label: 'Tiempo máximo', min: 200, max: 5000, integer: true },
    { control: 'max_chars', label: 'Largo máximo', min: 80, max: 1000, integer: true },
  ],
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as JsonRecord) }
    : {};
}

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
            [placeholder]="
              agentSettingsKind()
                ? 'Sin modelo (apagado)'
                : 'Usar configuracion por defecto'
            "
            [options]="configOptions()"
            [formControl]="$any(form.get('config_id'))"
            [disabled]="isSubmitting()"
          ></app-selector>
          <p class="text-xs text-text-secondary -mt-2">
            @if (agentSettingsKind()) {
              Elige la configuracion con el modelo y la clave (cualquier modelo
              de OpenRouter dado de alta en Configuraciones). Sin
              configuracion queda apagada: nunca usa la de por defecto.
            } @else {
              Si no seleccionas una, se usara la configuracion marcada como
              default.
            }
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

          <!-- Feature category (F1): required. Drives the subscription gate
               and quota metering; an app without a valid category is
               skipped by the gate, so the backend rejects null. -->
          <div class="space-y-1">
            <app-selector
              label="Categoria de feature IA"
              placeholder="Selecciona una categoria"
              [options]="aiFeatureCategoryOptions"
              [formControl]="$any(form.get('ai_feature_category'))"
              [disabled]="isSubmitting()"
              [required]="true"
            ></app-selector>
            <p class="text-xs text-text-secondary">
              Determina el gate de suscripcion y la cuota que consume cada
              uso. Escaneres y OCR van en cola asincrona; texto puntual en
              generacion de texto; Vexi chat en conversaciones; voz en tiempo
              real.
            </p>
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

                <app-input
                  formControlName="max_concurrency"
                  label="Llamadas simultáneas"
                  type="number"
                  [placeholder]="'1'"
                  [control]="form.get('speech.max_concurrency')"
                  [disabled]="isSubmitting()"
                ></app-input>
              </div>

              <p class="text-xs text-text-secondary">
                La voz es el identificador exacto del proveedor. Velocidad: 1 =
                normal, rango admitido de {{ speedRange()[0] }} a
                {{ speedRange()[1] }}.
                @if (supportsVol()) {
                  Volumen: 1 = sin cambio, multiplicador de {{ volRange[0] }} a
                  {{ volRange[1] }} (1.5 sube un 50%).
                }
                Llamadas simultáneas: cuántos fragmentos de una misma respuesta
                se sintetizan a la vez (1 a 8, vacío = 1). Súbelo solo si el
                proveedor de voz no limita las peticiones en paralelo.
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

          <!-- Agent settings: typed fields for apps whose service reads its
               own keys in metadata / retry_config / rate_limit (no JSON). -->
          @if (agentSettingsKind(); as kind) {
            <div
              formGroupName="agent"
              class="space-y-3 rounded-lg border border-border p-3"
            >
              <h4 class="text-sm font-medium text-text-primary">
                {{ agentSettingsTitle() }}
              </h4>

              @if (kind === 'vex_classifier') {
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <app-selector
                    label="Adaptador"
                    [options]="classifierAdapterOptions"
                    [formControl]="$any(form.get('agent.adapter'))"
                    [disabled]="isSubmitting()"
                  ></app-selector>
                  <app-input
                    formControlName="min_confidence"
                    label="Confianza mínima (0 a 1)"
                    type="number"
                    placeholder="0"
                    [control]="form.get('agent.min_confidence')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="max_calls_per_turn"
                    label="Llamadas máximas por turno"
                    type="number"
                    placeholder="3"
                    [control]="form.get('agent.max_calls_per_turn')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="timeout_ms"
                    label="Tiempo máximo por llamada (ms)"
                    type="number"
                    placeholder="800"
                    [control]="form.get('agent.timeout_ms')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="total_timeout_ms"
                    label="Tiempo máximo total (ms)"
                    type="number"
                    placeholder="1200"
                    [control]="form.get('agent.total_timeout_ms')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                </div>
                <p class="text-xs text-text-secondary">
                  Automático usa la API de decisiones solo con modelos que la
                  admiten y chat con cualquier otro. Con modelos de chat deja
                  la confianza mínima en 0 (no la reportan). Vacío = valor por
                  defecto.
                </p>
              }

              @if (kind === 'agent_guardrail') {
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <app-input
                    formControlName="min_confidence"
                    label="Confianza mínima para cortar (0 a 1)"
                    type="number"
                    placeholder="0.6"
                    [control]="form.get('agent.min_confidence')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="strikes_before_cooldown"
                    label="Infracciones seguidas antes de la pausa (1 a 20)"
                    type="number"
                    placeholder="3"
                    [control]="form.get('agent.strikes_before_cooldown')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="cooldown_minutes"
                    label="Minutos de pausa (0 a 1440; 0 = sin pausa)"
                    type="number"
                    placeholder="2"
                    [control]="form.get('agent.cooldown_minutes')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="timeout_ms"
                    label="Tiempo máximo de la clasificación (200 a 5000 ms)"
                    type="number"
                    placeholder="1500"
                    [control]="form.get('agent.timeout_ms')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="context_messages"
                    label="Mensajes previos de contexto (0 a 12)"
                    type="number"
                    placeholder="4"
                    [control]="form.get('agent.context_messages')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="public_rate_penalty"
                    label="Penalización extra en Vexi público (0 a 10)"
                    type="number"
                    placeholder="1"
                    [control]="form.get('agent.public_rate_penalty')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                </div>
                @for (agent of guardrailAgents; track agent.key) {
                  <div class="space-y-1">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        [formControlName]="agent.key + '_enabled'"
                        class="rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <span class="text-sm text-text-primary">
                        Revisar los mensajes de {{ agent.label }}
                      </span>
                    </label>
                    <textarea
                      [formControlName]="agent.key + '_scope'"
                      rows="3"
                      [placeholder]="agent.scopePlaceholder"
                      class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
                             placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20
                             focus:border-primary disabled:opacity-50 resize-y"
                    ></textarea>
                  </div>
                }
                <p class="text-xs text-text-secondary">
                  El alcance describe lo que cada agente sí atiende (vacío = el
                  texto por defecto). Si el modelo duda, falla o tarda más del
                  tiempo máximo, el mensaje sigue normal. Un mensaje en tema
                  reinicia la racha. Cada mensaje espera esta revisión antes de
                  que responda el agente. Para levantar las pausas activas, pon
                  0 minutos (aplica en menos de un minuto).
                </p>
              }

              @if (agentRangeErrors().length) {
                <ul class="text-xs text-red-600 space-y-0.5" role="alert">
                  @for (error of agentRangeErrors(); track error) {
                    <li>{{ error }}</li>
                  }
                </ul>
              }

              @if (kind === 'agent_guardrail_responder') {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <app-input
                    formControlName="timeout_ms"
                    label="Tiempo máximo de la respuesta (200 a 5000 ms)"
                    type="number"
                    placeholder="1500"
                    [control]="form.get('agent.timeout_ms')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                  <app-input
                    formControlName="max_chars"
                    label="Largo máximo de la respuesta (80 a 1000 caracteres)"
                    type="number"
                    placeholder="400"
                    [control]="form.get('agent.max_chars')"
                    [disabled]="isSubmitting()"
                  ></app-input>
                </div>
                @for (field of responderTemplateFields; track field.control) {
                  <div class="space-y-1">
                    <label class="block text-sm font-medium text-text-primary">
                      {{ field.label }}
                    </label>
                    <textarea
                      [formControlName]="field.control"
                      rows="2"
                      [placeholder]="field.placeholder"
                      class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
                             placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20
                             focus:border-primary disabled:opacity-50 resize-y"
                    ></textarea>
                  </div>
                }
                <p class="text-xs text-text-secondary">
                  Textos fijos que se usan cuando este modelo está apagado,
                  falla o se pasa del largo máximo (vacío = texto por defecto).
                  El aviso de pausa siempre es texto fijo.
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
              volOutOfRange() ||
              agentRangeErrors().length > 0
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

  /** Key of the app being edited/created, mirrored for `computed`. */
  private currentKey = signal<string>('');

  agentSettingsKind = computed<AgentSettingsKind | null>(() => {
    const key = this.currentKey();
    return (AGENT_SETTINGS_KINDS as readonly string[]).includes(key)
      ? (key as AgentSettingsKind)
      : null;
  });

  agentSettingsTitle = computed<string>(() => {
    const kind = this.agentSettingsKind();
    return kind ? AGENT_SETTINGS_TITLES[kind] : '';
  });

  classifierAdapterOptions: SelectorOption[] = [
    { value: 'auto', label: 'Automático' },
    { value: 'decisions', label: 'API de decisiones' },
    { value: 'chat', label: 'Chat' },
  ];

  guardrailAgents = [
    {
      key: 'vex',
      label: 'Vex (administración de la tienda)',
      scopePlaceholder: 'Alcance de Vex. Vacío = operación y administración de la tienda en Vendix.',
    },
    {
      key: 'vexi',
      label: 'Vexi (clientes en las apps públicas)',
      scopePlaceholder: 'Alcance de Vexi. Vacío = atención y venta de la tienda: catálogo, pedidos, reservas, peticiones.',
    },
  ] as const;

  responderTemplateFields = [
    { control: 'vex_off_topic', label: 'Vex · fuera de tema', placeholder: 'Vacío = texto por defecto' },
    { control: 'vex_abuse', label: 'Vex · uso inadecuado', placeholder: 'Vacío = texto por defecto' },
    { control: 'vex_cooldown', label: 'Vex · aviso de pausa', placeholder: 'Vacío = texto por defecto' },
    { control: 'vexi_off_topic', label: 'Vexi · fuera de tema', placeholder: 'Vacío = texto por defecto' },
    { control: 'vexi_abuse', label: 'Vexi · uso inadecuado', placeholder: 'Vacío = texto por defecto' },
    { control: 'vexi_cooldown', label: 'Vexi · aviso de pausa', placeholder: 'Vacío = texto por defecto' },
  ] as const;

  // Reactive state for the type-mismatch check between app.model_type and
  // selected config.model_type. We mirror form values into signals so the
  // template can use a `computed` without zone-driven change detection.
  private currentConfigId = signal<string | null>(null);
  currentModelType = signal<AIModelType | null>('text');
  private currentSpeed = signal<number | null>(null);
  private currentVol = signal<number | null>(null);
  /** Mirror of the `agent` group (a `computed` cannot read a FormGroup). */
  private agentValues = signal<JsonRecord>({});

  /** One message per typed agent field outside the range its service accepts. */
  agentRangeErrors = computed<string[]>(() => {
    const kind = this.agentSettingsKind();
    const ranges = kind ? AGENT_FIELD_RANGES[kind] : undefined;
    if (!ranges) return [];
    const values = this.agentValues();
    const errors: string[] = [];
    for (const r of ranges) {
      const n = this.toFiniteNumber(values[r.control]);
      if (n === null) continue;
      if (n < r.min || n > r.max || (r.integer && !Number.isInteger(n)))
        errors.push(
          `${r.label}: debe ser ${r.integer ? 'un entero ' : ''}entre ${r.min} y ${r.max}.`,
        );
    }
    return errors;
  });

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

  aiFeatureCategoryOptions: SelectorOption[] = AI_FEATURE_CATEGORIES.map(
    (value) => ({
      value,
      label: AI_FEATURE_CATEGORY_LABELS[value],
    }),
  );

  form: FormGroup = this.fb.group({
    key: ['', [Validators.required, Validators.maxLength(100)]],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
    config_id: [null],
    model_type: ['text' as AIModelType, [Validators.required]],
    ai_feature_category: ['', [Validators.required]],
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
      max_concurrency: [null as number | null],
    }),
    agent: this.fb.group({
      adapter: ['auto'],
      min_confidence: [null as number | null],
      timeout_ms: [null as number | null],
      total_timeout_ms: [null as number | null],
      max_calls_per_turn: [null as number | null],
      strikes_before_cooldown: [null as number | null],
      cooldown_minutes: [null as number | null],
      context_messages: [null as number | null],
      public_rate_penalty: [null as number | null],
      vex_enabled: [true],
      vex_scope: [''],
      vexi_enabled: [true],
      vexi_scope: [''],
      max_chars: [null as number | null],
      vex_off_topic: [''],
      vex_abuse: [''],
      vex_cooldown: [''],
      vexi_off_topic: [''],
      vexi_abuse: [''],
      vexi_cooldown: [''],
    }),
  });

  constructor() {
    this.form
      .get('key')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((key: string | null) => this.currentKey.set(key ?? ''));

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

    this.form
      .get('agent')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((values: JsonRecord) => this.agentValues.set(values ?? {}));

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
          max_concurrency: speech['max_concurrency'] ?? null,
        },
        key: a.key,
        name: a.name,
        description: a.description || '',
        config_id: a.config_id?.toString() || '',
        model_type: modelType,
        ai_feature_category: a.ai_feature_category || '',
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
      this.currentKey.set(a.key);
      this.patchAgentSettings(a);
      // Disable key editing on existing apps
      this.form.get('key')?.disable();
    } else if (this.isOpen() && !this.app()) {
      this.resetForm();
      this.form.get('key')?.enable();
    }
  }

  onSubmit(): void {
    if (
      this.form.invalid ||
      this.speedOutOfRange() ||
      this.volOutOfRange() ||
      this.agentRangeErrors().length > 0
    ) {
      return;
    }

    const raw = this.form.getRawValue();
    const data: any = {
      key: raw.key,
      name: raw.name,
      description: raw.description || undefined,
      config_id: raw.config_id ? Number(raw.config_id) : null,
      model_type: (raw.model_type || 'text') as AIModelType,
      ai_feature_category: raw.ai_feature_category as AIFeatureCategory,
      system_prompt: raw.system_prompt || undefined,
      prompt_template: raw.prompt_template || undefined,
      temperature:
        raw.temperature != null ? Number(raw.temperature) : undefined,
      max_tokens: raw.max_tokens != null ? Number(raw.max_tokens) : undefined,
      output_format: raw.output_format as OutputFormat,
      is_active: raw.is_active,
    };

    // Build rate_limit object if any value provided. The column is replaced
    // whole on save, so keys other services read (e.g. `max_calls_per_turn`)
    // are carried through.
    if (raw.rate_limit_max != null || raw.rate_limit_window != null) {
      data.rate_limit = {
        ...asRecord(this.app()?.rate_limit),
        maxRequests: Number(raw.rate_limit_max) || 100,
        windowSeconds: Number(raw.rate_limit_window) || 60,
      };
    }

    // Build retry_config object if any value provided (same carry-through,
    // e.g. the classifier's `timeout_ms`).
    if (raw.retry_max != null || raw.retry_delay != null) {
      data.retry_config = {
        ...asRecord(this.app()?.retry_config),
        // 0 is a valid value (no retries); only empty means the default.
        maxRetries:
          this.toFiniteNumber(raw.retry_max) ?? 3,
        delayMs: Number(raw.retry_delay) || 1000,
      };
    }

    const metadata = this.buildMetadata(raw);
    if (metadata) {
      data.metadata = metadata;
    }

    this.applyAgentSettings(data, raw.agent);

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

    // Integer 1–8 or nothing (the server then uses 1). Anything else is not
    // saved, so a typo can never leave one answer firing parallel requests.
    const concurrency = this.toFiniteNumber(raw.speech?.max_concurrency);
    if (
      concurrency !== null &&
      Number.isInteger(concurrency) &&
      concurrency >= 1 &&
      concurrency <= 8
    ) {
      speech['max_concurrency'] = concurrency;
    } else {
      delete speech['max_concurrency'];
    }

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

  /** Loads the typed fields of an agent-settings app from its JSON columns. */
  private patchAgentSettings(a: AIEngineApp): void {
    const meta = asRecord(a.metadata);
    const retry = asRecord(a.retry_config);
    const rate = asRecord(a.rate_limit);
    const agents = asRecord(meta['agents']);
    const vex = asRecord(agents['vex']);
    const vexi = asRecord(agents['vexi']);
    const templates = asRecord(meta['templates']);
    const tVex = asRecord(templates['vex']);
    const tVexi = asRecord(templates['vexi']);
    const num = (v: unknown) => this.toFiniteNumber(v);
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    const cooldown = num(meta['cooldown_seconds']);
    this.form.get('agent')?.reset({
      adapter: text(meta['adapter']) || 'auto',
      min_confidence: num(meta['min_confidence']),
      timeout_ms: num(retry['timeout_ms']),
      total_timeout_ms: num(retry['total_timeout_ms']),
      max_calls_per_turn: num(rate['max_calls_per_turn']),
      strikes_before_cooldown: num(meta['strikes_before_cooldown']),
      cooldown_minutes: cooldown === null ? null : cooldown / 60,
      context_messages: num(meta['context_messages']),
      public_rate_penalty: num(meta['public_rate_penalty']),
      vex_enabled: vex['enabled'] !== false,
      vex_scope: text(vex['scope']),
      vexi_enabled: vexi['enabled'] !== false,
      vexi_scope: text(vexi['scope']),
      max_chars: num(meta['max_chars']),
      vex_off_topic: text(tVex['off_topic']),
      vex_abuse: text(tVex['abuse']),
      vex_cooldown: text(tVex['cooldown']),
      vexi_off_topic: text(tVexi['off_topic']),
      vexi_abuse: text(tVexi['abuse']),
      vexi_cooldown: text(tVexi['cooldown']),
    });
  }

  /**
   * Writes the typed fields of an agent-settings app into `metadata`,
   * `retry_config` and `rate_limit`, merged over what the row (or the generic
   * fields above) already hold. An empty field removes its key, so the
   * service applies its default; keys this form does not know survive.
   */
  private applyAgentSettings(data: any, agent: any): void {
    const kind = this.agentSettingsKind();
    if (!kind || !agent) return;
    const metadata = asRecord(data.metadata ?? this.app()?.metadata);
    const retry = asRecord(data.retry_config ?? this.app()?.retry_config);
    const rate = asRecord(data.rate_limit ?? this.app()?.rate_limit);
    const setNum = (target: JsonRecord, key: string, value: unknown) => {
      const n = this.toFiniteNumber(value);
      if (n === null) delete target[key];
      else target[key] = n;
    };
    const setText = (target: JsonRecord, key: string, value: unknown) => {
      const t = typeof value === 'string' ? value.trim() : '';
      if (t) target[key] = t;
      else delete target[key];
    };

    if (kind === 'vex_classifier') {
      metadata['adapter'] = agent.adapter || 'auto';
      setNum(metadata, 'min_confidence', agent.min_confidence);
      setNum(retry, 'timeout_ms', agent.timeout_ms);
      setNum(retry, 'total_timeout_ms', agent.total_timeout_ms);
      setNum(rate, 'max_calls_per_turn', agent.max_calls_per_turn);
      data.rate_limit = rate;
    } else if (kind === 'agent_guardrail') {
      setNum(metadata, 'min_confidence', agent.min_confidence);
      setNum(metadata, 'strikes_before_cooldown', agent.strikes_before_cooldown);
      const minutes = this.toFiniteNumber(agent.cooldown_minutes);
      if (minutes === null) delete metadata['cooldown_seconds'];
      else metadata['cooldown_seconds'] = Math.round(minutes * 60);
      setNum(metadata, 'context_messages', agent.context_messages);
      setNum(metadata, 'public_rate_penalty', agent.public_rate_penalty);
      setNum(retry, 'timeout_ms', agent.timeout_ms);
      const agents = asRecord(metadata['agents']);
      for (const key of ['vex', 'vexi']) {
        const entry = asRecord(agents[key]);
        entry['enabled'] = agent[`${key}_enabled`] !== false;
        setText(entry, 'scope', agent[`${key}_scope`]);
        agents[key] = entry;
      }
      metadata['agents'] = agents;
    } else {
      setNum(retry, 'timeout_ms', agent.timeout_ms);
      setNum(metadata, 'max_chars', agent.max_chars);
      const templates = asRecord(metadata['templates']);
      for (const key of ['vex', 'vexi']) {
        const entry = asRecord(templates[key]);
        for (const kindKey of ['off_topic', 'abuse', 'cooldown'])
          setText(entry, kindKey, agent[`${key}_${kindKey}`]);
        templates[key] = entry;
      }
      metadata['templates'] = templates;
    }
    data.metadata = metadata;
    data.retry_config = retry;
  }

  private resetForm(): void {
    this.form.reset({
      key: '',
      name: '',
      description: '',
      config_id: '',
      model_type: 'text' as AIModelType,
      ai_feature_category: '',
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
      speech: {
        voice: '',
        response_format: 'mp3',
        speed: null,
        vol: null,
        max_concurrency: null,
      },
    });
    this.form.get('agent')?.reset({ adapter: 'auto', vex_enabled: true, vexi_enabled: true });
    this.currentKey.set('');
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
