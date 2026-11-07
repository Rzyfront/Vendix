import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import {
  HUMAN_STAGE_TYPES,
  WORKFLOW_LIMITS,
  WorkflowFieldDef,
  WorkflowFormStepDef,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { FIELD_TYPE_TEXT, moveItem, uniqueKey } from '../../workflow-editor.utils';
import { FieldBuilderComponent } from '../field-builder.component';

// ---- steps of a multi-step form (P3.4): pure helpers ----------------------

/** The form's field keys are always the steps' keys in order. */
export function stepsToFields(steps: readonly WorkflowFormStepDef[]): string[] {
  return steps.flatMap((s) => s.fields);
}

/** Puts `key` at the end of step `target` (removing it from wherever it was). */
export function assignToStep(
  steps: readonly WorkflowFormStepDef[],
  key: string,
  target: number,
): WorkflowFormStepDef[] {
  return steps.map((s, i) => {
    const rest = s.fields.filter((k) => k !== key);
    return { ...s, fields: i === target ? [...rest, key] : rest };
  });
}

export function removeKeyFromSteps(
  steps: readonly WorkflowFormStepDef[],
  key: string,
): WorkflowFormStepDef[] {
  return steps.map((s) => ({ ...s, fields: s.fields.filter((k) => k !== key) }));
}

/** Drops step `index`; its fields go to the previous step (or the next one for the first). */
export function removeStepAt(
  steps: readonly WorkflowFormStepDef[],
  index: number,
): WorkflowFormStepDef[] {
  if (steps.length <= 1) return [...steps];
  const heir = index > 0 ? index - 1 : 1;
  return steps
    .map((s, i) => {
      if (i !== heir) return s;
      const orphan = steps[index].fields;
      return { ...s, fields: index > 0 ? [...s.fields, ...orphan] : [...orphan, ...s.fields] };
    })
    .filter((_, i) => i !== index);
}

/** Formulario tab: stage fields (ordered) and the field builder. */
@Component({
  selector: 'app-stage-form-tab',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    FieldBuilderComponent,
  ],
  template: `
    @if (isHuman()) {
      <div class="flex flex-col gap-3">
        <p class="text-xs text-text-secondary">
          Campos que se piden en esta etapa. Los campos se definen una vez para todo el flujo y cada etapa elige cuáles muestra.
        </p>
        @if (isStart()) {
          <div class="flex flex-col gap-1 rounded-xl border border-border p-3" data-testid="steps-toggle">
            <app-toggle
              label="Dividir el formulario en pasos"
              [checked]="steps() !== null"
              (toggled)="toggleSteps($event)"
            />
            <span class="text-xs text-text-secondary">
              En el formulario público la persona ve "Paso X de N". El servidor valida todo el formulario al enviar.
            </span>
          </div>
        }
        @if (steps(); as groups) {
          <div class="flex flex-col gap-4" data-testid="steps">
            @for (step of groups; track $index; let si = $index) {
              <section class="flex flex-col gap-2 rounded-xl border border-border p-3" [attr.aria-label]="'Paso ' + (si + 1)">
                <div class="flex items-end gap-2">
                  <div class="min-w-0 flex-1">
                    <app-input
                      [label]="'Título del paso ' + (si + 1)"
                      size="sm"
                      [ngModel]="step.title"
                      [ngModelOptions]="{ standalone: true }"
                      (ngModelChange)="renameStep(si, $event ?? '')"
                    />
                  </div>
                  <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar paso"
                    [disabled]="groups.length <= 1" (clicked)="removeStep(si)">
                    <app-icon name="trash-2" [size]="12" slot="icon" />
                  </app-button>
                </div>
                @if (step.fields.length === 0) {
                  <p class="text-xs text-error" role="alert">Un paso necesita al menos un campo.</p>
                }
                <ul class="flex flex-col gap-2" [attr.aria-label]="'Campos del paso ' + (si + 1)">
                  @for (key of step.fields; track key; let fi = $index) {
                    @if (fieldOf(key); as field) {
                      <ng-container *ngTemplateOutlet="row; context: { field: field, i: fi, step: si }" />
                    }
                  }
                </ul>
              </section>
            }
            <app-button variant="outline" size="sm" [disabled]="groups.length >= maxSteps" (clicked)="addStep()">
              <app-icon name="plus" [size]="14" slot="icon" />
              Agregar paso
            </app-button>
          </div>
        } @else {
          <ul class="flex flex-col gap-2" aria-label="Campos de la etapa">
            @for (field of stageFields(); track field.key; let i = $index) {
              <ng-container *ngTemplateOutlet="row; context: { field: field, i: i, step: -1 }" />
            } @empty {
              <li class="text-sm text-text-secondary">Esta etapa aún no pide campos.</li>
            }
          </ul>
        }

        <ng-template #row let-field="field" let-i="i" let-step="step">
            <li class="flex flex-col gap-2">
              <div class="flex items-center gap-2 rounded-xl border border-border bg-surface p-2">
                <app-icon [name]="field.type === 'file' ? 'paperclip' : 'file-text'" [size]="14" class="text-text-secondary" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-text-primary">
                    {{ field.label }}@if (field.required) { <span aria-label="obligatorio"> *</span> }
                  </p>
                  <p class="truncate text-xs text-text-secondary">{{ typeText(field) }} · {{ field.key }}</p>
                </div>
                <app-button variant="ghost" size="xsm" ariaLabel="Subir campo" [disabled]="i === 0" (clicked)="moveField(step, i, -1)">
                  <app-icon name="arrow-up" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="ghost" size="xsm" ariaLabel="Bajar campo" [disabled]="isLastIn(step, i)" (clicked)="moveField(step, i, 1)">
                  <app-icon name="arrow-down" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="outline" size="xsm" [ariaPressed]="editing() === field.key" (clicked)="toggleEdit(field.key)">
                  {{ editing() === field.key ? 'Cerrar' : 'Editar' }}
                </app-button>
                <app-button variant="ghost" size="xsm" ariaLabel="Quitar de esta etapa" (clicked)="detach(field.key)">
                  <app-icon name="x" [size]="12" slot="icon" />
                </app-button>
              </div>
              @if (step >= 0) {
                <app-selector
                  label="Paso"
                  size="sm"
                  [options]="stepOptions()"
                  [value]="step"
                  (valueChange)="moveToStep(field.key, $event)"
                />
              }
              @if (editing() === field.key) {
                <app-field-builder
                  [field]="field"
                  [allFields]="allFields()"
                  (fieldChange)="onFieldChange($event)"
                  (remove)="removeFromFlow(field.key)"
                />
              }
            </li>
        </ng-template>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
          @if (available().length > 0) {
            <div class="min-w-0 flex-1">
              <app-selector
                label="Agregar un campo existente"
                placeholder="Elige un campo"
                size="sm"
                [options]="available()"
                [value]="null"
                (valueChange)="attach($event)"
              />
            </div>
          }
          <app-button variant="outline" size="sm" [disabled]="atLimit()" (clicked)="createField()">
            <app-icon name="plus" [size]="14" slot="icon" />
            Crear campo nuevo
          </app-button>
        </div>
      </div>
    } @else {
      <p class="text-sm text-text-secondary">Esta etapa no tiene formulario.</p>
    }
  `,
})
export class StageFormTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly editing = signal<string | null>(null);
  readonly isHuman = computed(() => HUMAN_STAGE_TYPES.includes(this.stage().type));
  readonly allFields = computed(() => this.store.draft()?.fields ?? []);
  readonly stageFields = computed<WorkflowFieldDef[]>(() =>
    (this.stage().form?.fields ?? [])
      .map((key) => this.allFields().find((f) => f.key === key))
      .filter((f): f is WorkflowFieldDef => !!f),
  );
  readonly available = computed(() => {
    const used = new Set(this.stage().form?.fields ?? []);
    return this.allFields()
      .filter((f) => !used.has(f.key))
      .map((f) => ({ value: f.key, label: f.label }));
  });
  readonly atLimit = computed(() => this.allFields().length >= WORKFLOW_LIMITS.maxFields);
  readonly maxSteps = WORKFLOW_LIMITS.maxFormSteps;
  /** Only the start stage of a flow can be a public form, so only it gets steps. */
  readonly isStart = computed(() => this.stage().start === true);
  /** Steps of the form, or `null` while it is a single page. */
  readonly steps = computed<WorkflowFormStepDef[] | null>(() => this.stage().form?.steps ?? null);
  readonly stepOptions = computed(() =>
    (this.steps() ?? []).map((s, i) => ({ value: i, label: `${i + 1}. ${s.title || 'Sin título'}` })),
  );

  fieldOf(key: string): WorkflowFieldDef | undefined {
    return this.allFields().find((f) => f.key === key);
  }

  typeText(field: WorkflowFieldDef): string {
    return FIELD_TYPE_TEXT[field.type] ?? field.type;
  }

  /** Writes the form; with steps the field order is always the steps' order. */
  private setForm(keys: string[], steps: WorkflowFormStepDef[] | null = this.steps()): void {
    this.store.updateStage(this.stage().key, (s) => ({
      ...s,
      form: steps ? { fields: stepsToFields(steps), steps } : { fields: keys },
    }));
  }

  private setKeys(keys: string[]): void {
    this.setForm(keys, null);
  }

  private setSteps(steps: WorkflowFormStepDef[]): void {
    this.setForm([], steps);
  }

  toggleSteps(on: boolean): void {
    const keys = this.stage().form?.fields ?? [];
    if (on) this.setSteps([{ title: 'Paso 1', fields: [...keys] }]);
    else this.setKeys(keys);
  }

  addStep(): void {
    const steps = this.steps();
    if (!steps || steps.length >= this.maxSteps) return;
    this.setSteps([...steps, { title: `Paso ${steps.length + 1}`, fields: [] }]);
  }

  renameStep(index: number, title: string): void {
    const steps = this.steps();
    if (!steps) return;
    this.setSteps(steps.map((s, i) => (i === index ? { ...s, title } : s)));
  }

  removeStep(index: number): void {
    const steps = this.steps();
    if (steps) this.setSteps(removeStepAt(steps, index));
  }

  moveToStep(key: string, target: string | number | null): void {
    const steps = this.steps();
    if (!steps || target === null || Number(target) >= steps.length) return;
    this.setSteps(assignToStep(steps, key, Number(target)));
  }

  isLastIn(step: number, index: number): boolean {
    const steps = this.steps();
    const size = step >= 0 && steps ? steps[step].fields.length : this.stageFields().length;
    return index === size - 1;
  }

  /** Moves a field one place up/down inside its page (or the flat list). */
  moveField(step: number, index: number, delta: -1 | 1): void {
    const steps = this.steps();
    if (step < 0 || !steps) {
      this.move(index, index + delta);
      return;
    }
    this.setSteps(
      steps.map((s, i) => (i === step ? { ...s, fields: moveItem(s.fields, index, index + delta) } : s)),
    );
  }

  toggleEdit(key: string): void {
    this.editing.update((current) => (current === key ? null : key));
  }

  move(from: number, to: number): void {
    this.setKeys(moveItem(this.stage().form?.fields ?? [], from, to));
  }

  detach(key: string): void {
    const steps = this.steps();
    if (steps) this.setSteps(removeKeyFromSteps(steps, key));
    else this.setKeys((this.stage().form?.fields ?? []).filter((k) => k !== key));
    if (this.editing() === key) this.editing.set(null);
  }

  attach(key: string | number | null): void {
    if (key === null) return;
    this.addKey(String(key));
  }

  /** A new field goes to the end of the form (the last page when there are steps). */
  private addKey(key: string): void {
    const steps = this.steps();
    if (steps?.length) this.setSteps(assignToStep(steps, key, steps.length - 1));
    else this.setKeys([...(this.stage().form?.fields ?? []), key]);
  }

  createField(): void {
    const taken = this.allFields().map((f) => f.key);
    const label = 'Nuevo campo';
    const key = uniqueKey(label, taken, 'campo');
    this.store.upsertField({ key, label, type: 'text' });
    this.addKey(key);
    this.editing.set(key);
  }

  onFieldChange(event: { field: WorkflowFieldDef; previousKey: string }): void {
    const steps = this.steps();
    this.store.upsertField(event.field, event.previousKey);
    if (steps && event.previousKey !== event.field.key) {
      // The store renames keys in `form.fields`; keep the steps in step with it.
      this.setSteps(
        steps.map((s) => ({
          ...s,
          fields: s.fields.map((k) => (k === event.previousKey ? event.field.key : k)),
        })),
      );
    }
    if (this.editing() === event.previousKey) this.editing.set(event.field.key);
  }

  removeFromFlow(key: string): void {
    // The store drops the key from every form and its steps (a step left empty
    // goes too); rewriting the steps read before the change would bring it back.
    this.store.removeField(key);
    this.editing.set(null);
  }
}
