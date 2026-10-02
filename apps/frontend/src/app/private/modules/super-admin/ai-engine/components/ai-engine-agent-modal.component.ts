import {
  Component,
  computed,
  inject,
  input,
  OnChanges,
  output,
  SimpleChanges,
} from '@angular/core';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  AIEngineApp,
  AIToolCatalogEntry,
  AIAgent,
  CreateAIAgentDto,
  UpdateAIAgentDto,
} from '../interfaces';
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../shared/components/index';

const AGENT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

@Component({
  selector: 'app-ai-engine-agent-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    SelectorComponent,
    MultiSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [title]="agent() ? 'Editar Agente IA' : 'Nuevo Agente IA'"
      [subtitle]="
        agent()
          ? 'Editando: ' + agent()!.name
          : 'Configura un agente reutilizable sin desplegar codigo'
      "
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              formControlName="key"
              label="Key (unico)"
              placeholder="soporte-menu"
              [required]="true"
              [control]="keyControl"
              [disabled]="isSubmitting() || !!agent()"
              helpText="Slug kebab-case, no se puede cambiar"
            ></app-input>

            <app-input
              formControlName="name"
              label="Nombre"
              placeholder="Soporte de menu"
              [required]="true"
              [control]="nameControl"
              [disabled]="isSubmitting()"
            ></app-input>
          </div>

          <app-input
            formControlName="description"
            label="Descripcion"
            placeholder="Que hace este agente"
            [control]="descriptionControl"
            [disabled]="isSubmitting()"
          ></app-input>

          <div class="space-y-1">
            <app-selector
              label="Aplicacion IA"
              placeholder="Sin app (usa config por defecto)"
              [options]="appOptions"
              [formControl]="appKeyControl"
              [disabled]="isSubmitting()"
            ></app-selector>
            <p class="text-xs text-text-secondary">
              La app aporta el modelo y el prompt base del turno. Sin app, el
              loop usa el system prompt del agente con la configuracion por
              defecto.
            </p>
          </div>

          <div class="space-y-1">
            <label class="block text-sm font-medium text-text-primary">
              System Prompt
            </label>
            <textarea
              formControlName="system_prompt"
              rows="4"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
                     placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20
                     focus:border-primary disabled:opacity-50 resize-y"
              placeholder="Eres un agente especializado en..."
              [attr.disabled]="isSubmitting() ? '' : null"
            ></textarea>
          </div>

          <div class="space-y-1">
            <app-multi-selector
              formControlName="allowed_tools"
              label="Herramientas permitidas"
              placeholder="Sin filtro adicional"
              [options]="toolOptions()"
              [disabled]="isSubmitting()"
              helpText="Busca por nombre, dominio o descripción. Vacío = sin filtro adicional. Máximo 100 herramientas explícitas."
              [errorText]="
                allowedToolsControl.hasError('maxlength')
                  ? 'Selecciona máximo 100 herramientas o deja el campo vacío para no aplicar un filtro adicional.'
                  : ''
              "
            ></app-multi-selector>
            <p class="text-xs text-text-secondary">
              Los nombres guardados que ya no figuren en el catálogo se conservan hasta que los retires.
            </p>
          </div>

          <div class="space-y-1">
            <app-multi-selector
              formControlName="denied_tools"
              label="Herramientas denegadas"
              placeholder="Sin exclusiones"
              [options]="toolOptions()"
              [disabled]="isSubmitting()"
              helpText="Se restan del catálogo después de todos los filtros: lo que esté aquí nunca se ofrece. Vacío = sin exclusiones. Máximo 100 herramientas."
              [errorText]="
                deniedToolsControl.hasError('maxlength')
                  ? 'Selecciona máximo 100 herramientas o deja el campo vacío para no excluir ninguna.'
                  : ''
              "
            ></app-multi-selector>
            <p class="text-xs text-text-secondary">
              Vex lo usa para excluir las herramientas de interfaz (ui_*); Vexi lo deja vacío.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              formControlName="max_iterations"
              label="Max iteraciones"
              type="number"
              placeholder="10"
              [control]="maxIterationsControl"
              [disabled]="isSubmitting()"
              helpText="Entre 1 y 50. Vacio = default del loop"
            ></app-input>
            <app-input
              formControlName="timeout_seconds"
              label="Timeout por turno (s)"
              type="number"
              placeholder="120"
              [control]="timeoutSecondsControl"
              [disabled]="isSubmitting()"
              helpText="Entre 30 y 600. Vacio = default del loop"
            ></app-input>
          </div>
          <p class="text-xs text-text-secondary">
            Esta selección solo restringe las herramientas disponibles por permisos y por el plan de la tienda; no concede acceso nuevo.
          </p>

          <div class="flex items-center gap-6 pt-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                formControlName="requires_confirmation_default"
                class="rounded border-gray-300 text-primary focus:ring-primary"
                [disabled]="isSubmitting()"
              />
              <span class="text-sm text-text-primary">
                Confirmar escrituras por defecto
              </span>
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
            {{ agent() ? 'Actualizar' : 'Crear Agente' }}
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
export class AIEngineAgentModalComponent implements OnChanges {
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  agent = input<AIAgent | null>(null);
  apps = input<AIEngineApp[]>([]);
  tools = input<AIToolCatalogEntry[]>([]);
  isOpenChange = output<boolean>();
  submit = output<CreateAIAgentDto | UpdateAIAgentDto>();

  private fb = inject(FormBuilder);

  appOptions: SelectorOption[] = [];
  toolOptions = computed<MultiSelectorOption[]>(() =>
    this.tools().map((tool) => ({
      value: tool.name,
      label: tool.name,
      description: `${tool.domain} · ${tool.description}`,
    })),
  );

  form: FormGroup = this.fb.group({
    key: [
      '',
      [
        Validators.required,
        Validators.maxLength(80),
        Validators.pattern(AGENT_KEY_PATTERN),
      ],
    ],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
    app_key: [''],
    system_prompt: [''],
    allowed_tools: [[] as string[], [Validators.maxLength(100)]],
    denied_tools: [[] as string[], [Validators.maxLength(100)]],
    max_iterations: [null as number | null, [Validators.min(1), Validators.max(50)]],
    timeout_seconds: [null as number | null, [Validators.min(30), Validators.max(600)]],
    requires_confirmation_default: [false],
    is_active: [true],
  });

  get keyControl(): FormControl<string> {
    return this.form.get('key') as FormControl<string>;
  }

  get nameControl(): FormControl<string> {
    return this.form.get('name') as FormControl<string>;
  }

  get descriptionControl(): FormControl<string> {
    return this.form.get('description') as FormControl<string>;
  }

  get appKeyControl(): FormControl<string> {
    return this.form.get('app_key') as FormControl<string>;
  }

  get allowedToolsControl(): FormControl<string[]> {
    return this.form.get('allowed_tools') as FormControl<string[]>;
  }

  get deniedToolsControl(): FormControl<string[]> {
    return this.form.get('denied_tools') as FormControl<string[]>;
  }

  get maxIterationsControl(): FormControl<number | null> {
    return this.form.get('max_iterations') as FormControl<number | null>;
  }

  get timeoutSecondsControl(): FormControl<number | null> {
    return this.form.get('timeout_seconds') as FormControl<number | null>;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['apps']) {
      this.appOptions = [
        { value: '', label: 'Sin app (usa config por defecto)' },
        ...this.apps().map((a) => ({
          value: a.key,
          label: a.name + ' (' + a.key + ')',
        })),
      ];
    }

    if (!this.isOpen() || (!changes['isOpen'] && !changes['agent'])) return;

    if (this.isOpen() && this.agent()) {
      const a = this.agent()!;
      this.form.patchValue({
        key: a.key,
        name: a.name,
        description: a.description || '',
        app_key: a.app_key || '',
        system_prompt: a.system_prompt || '',
        allowed_tools: [...(a.allowed_tools || [])],
        denied_tools: [...(a.denied_tools || [])],
        max_iterations: a.max_iterations ?? null,
        timeout_seconds: a.timeout_seconds ?? null,
        requires_confirmation_default:
          a.requires_confirmation_default ?? false,
        is_active: a.is_active,
      });
      this.form.get('key')?.disable();
    } else if (this.isOpen() && !this.agent()) {
      this.resetForm();
      this.form.get('key')?.enable();
    }
  }

  onSubmit(): void {
    if (this.form.invalid) {
      return;
    }

    const raw = this.form.getRawValue();
    const allowedTools = (raw.allowed_tools as string[] | null) ?? [];
    const deniedTools = (raw.denied_tools as string[] | null) ?? [];
    const maxIterations = this.toFiniteInt(raw.max_iterations);
    const timeoutSeconds = this.toFiniteInt(raw.timeout_seconds);

    const data: CreateAIAgentDto | UpdateAIAgentDto = {
      key: raw.key,
      name: raw.name.trim(),
      description: raw.description?.trim() || undefined,
      app_key: raw.app_key?.trim() ? raw.app_key.trim() : null,
      system_prompt: raw.system_prompt?.trim() ? raw.system_prompt : null,
      allowed_tools: allowedTools,
      denied_tools: deniedTools,
      max_iterations: maxIterations,
      timeout_seconds: timeoutSeconds,
      requires_confirmation_default: !!raw.requires_confirmation_default,
      is_active: !!raw.is_active,
    };

    this.submit.emit(data);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  private toFiniteInt(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return null;
    return parsed;
  }

  private resetForm(): void {
    this.form.reset({
      key: '',
      name: '',
      description: '',
      app_key: '',
      system_prompt: '',
      allowed_tools: [],
      denied_tools: [],
      max_iterations: null,
      timeout_seconds: null,
      requires_confirmation_default: false,
      is_active: true,
    });
  }
}
