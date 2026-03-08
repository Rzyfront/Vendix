import {
  Component,
  input,
  output,
  OnChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  AIEngineApp,
  AIEngineConfig,
  CreateAIAppDto,
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
    CommonModule,
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
      [subtitle]="app() ? 'Editando: ' + app()!.name : 'Configura un caso de uso de IA con prompts y parametros'"
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
            Si no seleccionas una, se usara la configuracion marcada como default.
          </p>

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
              Usa {{'{{variable}}'}} para variables dinamicas. Ej: {{'{{name}}'}}, {{'{{context}}'}}
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
            [disabled]="form.invalid || isSubmitting()"
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
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  app = input<AIEngineApp | null>(null);
  configs = input<AIEngineConfig[]>([]);
  isOpenChange = output<boolean>();
  submit = output<CreateAIAppDto | UpdateAIAppDto>();

  private fb = inject(FormBuilder);

  configOptions = signal<SelectorOption[]>([]);

  outputFormatOptions: SelectorOption[] = [
    { value: 'text', label: 'Texto' },
    { value: 'json', label: 'JSON' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'html', label: 'HTML' },
  ];

  form: FormGroup = this.fb.group({
    key: ['', [Validators.required, Validators.maxLength(100)]],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
    config_id: [null],
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
  });

  ngOnChanges(): void {
    // Build config options from input
    const cfgs = this.configs();
    this.configOptions.set([
      { value: '', label: 'Usar configuracion por defecto' },
      ...cfgs.map((c) => ({
        value: c.id.toString(),
        label: `${c.label} (${c.provider} - ${c.model_id})`,
      })),
    ]);

    if (this.isOpen() && this.app()) {
      const a = this.app()!;
      this.form.patchValue({
        key: a.key,
        name: a.name,
        description: a.description || '',
        config_id: a.config_id?.toString() || '',
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
      // Disable key editing on existing apps
      this.form.get('key')?.disable();
    } else if (this.isOpen() && !this.app()) {
      this.resetForm();
      this.form.get('key')?.enable();
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    const raw = this.form.getRawValue();
    const data: any = {
      key: raw.key,
      name: raw.name,
      description: raw.description || undefined,
      config_id: raw.config_id ? Number(raw.config_id) : undefined,
      system_prompt: raw.system_prompt || undefined,
      prompt_template: raw.prompt_template || undefined,
      temperature: raw.temperature != null ? Number(raw.temperature) : undefined,
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

    this.submit.emit(data);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  private resetForm(): void {
    this.form.reset({
      key: '',
      name: '',
      description: '',
      config_id: '',
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
    });
  }
}
