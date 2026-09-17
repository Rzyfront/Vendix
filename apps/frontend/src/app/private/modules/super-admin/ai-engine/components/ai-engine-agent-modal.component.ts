import { Component, input, output, OnChanges, inject } from '@angular/core';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  AIEngineApp,
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

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              formControlName="allowed_tools"
              label="Tools permitidas"
              placeholder="search_products, get_order"
              [control]="allowedToolsControl"
              [disabled]="isSubmitting()"
              helpText="Separadas por comas. Vacio = sin filtro adicional"
            ></app-input>

            <app-input
              formControlName="max_iterations"
              label="Max iteraciones"
              type="number"
              placeholder="10"
              [control]="maxIterationsControl"
              [disabled]="isSubmitting()"
              helpText="Entre 1 y 50. Vacio = default del loop"
            ></app-input>
          </div>
          <p class="text-xs text-text-secondary -mt-2">
            Solo filtra sobre la interseccion permisos del caller y
            tools_allowed del plan. Nombres desconocidos se aceptan con un
            aviso en el log del backend.
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
  isOpenChange = output<boolean>();
  submit = output<CreateAIAgentDto | UpdateAIAgentDto>();

  private fb = inject(FormBuilder);

  appOptions: SelectorOption[] = [];

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
    allowed_tools: [''],
    max_iterations: [null as number | null, [Validators.min(1), Validators.max(50)]],
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

  get allowedToolsControl(): FormControl<string> {
    return this.form.get('allowed_tools') as FormControl<string>;
  }

  get maxIterationsControl(): FormControl<number | null> {
    return this.form.get('max_iterations') as FormControl<number | null>;
  }

  ngOnChanges(): void {
    this.appOptions = [
      { value: '', label: 'Sin app (usa config por defecto)' },
      ...this.apps().map((a) => ({
        value: a.key,
        label: a.name + ' (' + a.key + ')',
      })),
    ];

    if (this.isOpen() && this.agent()) {
      const a = this.agent()!;
      this.form.patchValue({
        key: a.key,
        name: a.name,
        description: a.description || '',
        app_key: a.app_key || '',
        system_prompt: a.system_prompt || '',
        allowed_tools: (a.allowed_tools || []).join(', '),
        max_iterations: a.max_iterations ?? null,
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
    const allowedTools = (raw.allowed_tools || '')
      .split(',')
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0);
    const maxIterations = this.toFiniteInt(raw.max_iterations);

    const data: CreateAIAgentDto | UpdateAIAgentDto = {
      key: raw.key,
      name: raw.name.trim(),
      description: raw.description?.trim() || undefined,
      app_key: raw.app_key?.trim() ? raw.app_key.trim() : null,
      system_prompt: raw.system_prompt?.trim() ? raw.system_prompt : null,
      allowed_tools: allowedTools,
      max_iterations: maxIterations,
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
      allowed_tools: '',
      max_iterations: null,
      requires_confirmation_default: false,
      is_active: true,
    });
  }
}
