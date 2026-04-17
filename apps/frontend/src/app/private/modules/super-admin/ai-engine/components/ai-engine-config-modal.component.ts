import {Component, input, output, OnChanges, inject, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  AIEngineConfig,
  CreateAIConfigDto,
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
    SelectorComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [title]="config() ? 'Editar Configuracion' : 'Nueva Configuracion AI'"
      [subtitle]="config() ? 'Editando: ' + config()!.label : 'Configura un proveedor de inteligencia artificial'"
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
              OpenAI Compatible cubre OpenAI, Ollama, Groq, Mistral, etc. Anthropic Compatible cubre Claude.
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

          <!-- Toggles -->
          <div class="flex items-center gap-6 pt-2 flex-wrap">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                formControlName="is_default"
                class="rounded border-gray-300 text-primary focus:ring-primary"
                [disabled]="isSubmitting()"
              />
              <span class="text-sm text-text-primary">Proveedor por defecto</span>
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
          @if (form.get('thinking')?.value) {
            <p class="text-xs text-amber-600 mt-1">
              Modelos como DeepSeek R1 generan bloques de razonamiento interno. Con esta opcion activa, se preservaran en la respuesta.
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

  form: FormGroup = this.fb.group({
    provider: ['', [Validators.required]],
    sdk_type: ['openai_compatible', [Validators.required]],
    label: ['', [Validators.required, Validators.maxLength(255)]],
    model_id: ['', [Validators.required, Validators.maxLength(100)]],
    base_url: [''],
    api_key_ref: [''],
    temperature: [null],
    max_tokens: [null],
    is_default: [false],
    is_active: [true],
    thinking: [false],
  });

  constructor() {
    // Watch provider changes to auto-fill sdk_type and models
    this.form.get('provider')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((providerName: string) => {
      const preset = KNOWN_PROVIDERS.find((p) => p.name === providerName);
      if (preset) {
        this.selectedProvider.set(preset);
        this.form.patchValue({ sdk_type: preset.sdkType }, { emitEvent: false });
        if (preset.defaultUrl && !this.form.get('base_url')?.value) {
          this.form.patchValue({ base_url: preset.defaultUrl }, { emitEvent: false });
        }
        this.suggestedModels.set(preset.models);
        this.modelOptions.set(
          preset.models.map((m) => ({ value: m, label: m })),
        );
        // Reset model_id if current value not in new models list
        const currentModel = this.form.get('model_id')?.value;
        if (preset.models.length > 0 && !preset.models.includes(currentModel)) {
          this.form.patchValue({ model_id: preset.models[0] }, { emitEvent: false });
        }
      } else {
        this.selectedProvider.set(null);
        this.suggestedModels.set([]);
        this.modelOptions.set([]);
      }
    });
  }

  ngOnChanges(): void {
    if (this.isOpen() && this.config()) {
      const c = this.config()!;
      this.form.patchValue({
        provider: c.provider,
        sdk_type: c.sdk_type,
        label: c.label,
        model_id: c.model_id,
        base_url: c.base_url || '',
        api_key_ref: '',
        temperature: c.settings?.temperature ?? null,
        max_tokens: c.settings?.maxTokens ?? null,
        is_default: c.is_default,
        is_active: c.is_active,
        thinking: c.settings?.thinking ?? false,
      });
    } else if (this.isOpen() && !this.config()) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    const raw = this.form.value;
    const settings: Record<string, any> = {};
    if (raw.temperature != null) settings['temperature'] = Number(raw.temperature);
    if (raw.max_tokens != null) settings['maxTokens'] = Number(raw.max_tokens);
    settings['thinking'] = !!raw.thinking;

    const data: any = {
      provider: raw.provider,
      sdk_type: raw.sdk_type,
      label: raw.label,
      model_id: raw.model_id,
      is_default: raw.is_default,
      is_active: raw.is_active,
      settings: Object.keys(settings).length > 0 ? settings : undefined,
    };

    if (raw.base_url) data.base_url = raw.base_url;
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
      api_key_ref: '',
      temperature: null,
      max_tokens: null,
      is_default: false,
      is_active: true,
      thinking: false,
    });
    this.suggestedModels.set([]);
    this.modelOptions.set([]);
  }
}
