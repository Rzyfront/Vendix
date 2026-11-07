import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  WORKFLOW_FIELD_TYPES,
  WorkflowConditionGroup,
  WorkflowFieldDef,
  WorkflowFieldType,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { FIELD_TYPE_TEXT, uniqueKey } from '../workflow-editor.utils';
import { ConditionBuilderComponent } from './condition-builder.component';
import { FileLimits, FileLimitsComponent } from './file-limits.component';

const TYPE_OPTIONS = WORKFLOW_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_TEXT[t] }));

/**
 * Editor of one field definition: key, label, type, required, help, options
 * (select), file limits and "Mostrar si". Follows the data-collection field
 * modal pattern (label, key, type, required, options one per line).
 */
@Component({
  selector: 'app-field-builder',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
    ConditionBuilderComponent,
    FileLimitsComponent,
  ],
  template: `
    <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="field-builder">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <app-input label="Etiqueta" [required]="true" [ngModel]="field().label" (ngModelChange)="patch({ label: $event })" />
        <app-input
          label="Clave interna"
          [ngModel]="field().key"
          [error]="keyError()"
          (ngModelChange)="onKey($event)"
        />
        <app-selector
          label="Tipo de campo"
          [options]="typeOptions"
          [value]="field().type"
          (valueChange)="onType($event)"
        />
        <div class="flex items-end pb-1">
          <app-toggle
            label="Obligatorio"
            [checked]="field().required === true"
            (toggled)="patch({ required: $event })"
          />
        </div>
      </div>
      <app-input label="Texto de ayuda" [ngModel]="field().help ?? ''" (ngModelChange)="patch({ help: $event || undefined })" />

      @if (hasOptions()) {
        <app-textarea
          label="Opciones (una por línea)"
          [rows]="4"
          [ngModel]="optionsText()"
          (ngModelChange)="onOptions($event)"
        />
      }
      @if (field().type === 'file') {
        <app-file-limits [accept]="field().accept" [maxSize]="field().max_size_mb" (changed)="onLimits($event)" />
      }

      <div class="flex flex-col gap-1">
        <span class="text-xs font-semibold text-text-primary">Mostrar si</span>
        <app-condition-builder
          [value]="field().visible_when"
          [fields]="otherFields()"
          addLabel="Mostrar solo si…"
          prefix="Se muestra si"
          (valueChange)="onVisible($event)"
        />
      </div>

      <div class="flex justify-end">
        <app-button variant="outline-danger" size="sm" (clicked)="remove.emit()">
          <app-icon name="trash-2" [size]="14" slot="icon" />
          Quitar campo
        </app-button>
      </div>
    </div>
  `,
})
export class FieldBuilderComponent {
  readonly field = input.required<WorkflowFieldDef>();
  /** All definition fields (to avoid duplicate keys and for "Mostrar si"). */
  readonly allFields = input<WorkflowFieldDef[]>([]);
  /** Emits the new field and the key it had before this change. */
  readonly fieldChange = output<{ field: WorkflowFieldDef; previousKey: string }>();
  readonly remove = output<void>();

  readonly typeOptions = TYPE_OPTIONS;
  readonly optionsText = signal('');
  readonly otherFields = computed(() => this.allFields().filter((f) => f.key !== this.field().key));
  readonly hasOptions = computed(() => ['select', 'multiselect'].includes(this.field().type));
  readonly keyError = computed(() => {
    const key = this.field().key;
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(key)) {
      return 'Usa minúsculas, números, guion o guion bajo; empieza con letra.';
    }
    const dup = this.allFields().filter((f) => f.key === key).length > 1;
    return dup ? 'Ya existe otro campo con esta clave.' : undefined;
  });

  private seededFor = '';

  constructor() {
    effect(() => {
      const field = this.field();
      untracked(() => {
        // Re-seed only when switching to another field, not on every keystroke.
        if (this.seededFor !== field.key + field.type) {
          this.optionsText.set((field.options ?? []).map((o) => o.label).join('\n'));
          this.seededFor = field.key + field.type;
        }
      });
    });
  }

  patch(change: Partial<WorkflowFieldDef>): void {
    const next = { ...this.field(), ...change } as WorkflowFieldDef;
    for (const k of Object.keys(next) as (keyof WorkflowFieldDef)[]) {
      if (next[k] === undefined) delete next[k];
    }
    this.fieldChange.emit({ field: next, previousKey: this.field().key });
  }

  onKey(raw: string): void {
    this.seededFor = '';
    this.patch({ key: raw.trim() });
    this.seededFor = raw.trim() + this.field().type;
  }

  onType(value: string | number | null): void {
    const type = value as WorkflowFieldType;
    const { options: _o, accept: _a, max_size_mb: _m, ...rest } = this.field();
    this.seededFor = '';
    this.fieldChange.emit({
      field: { ...rest, type, ...(type === 'select' || type === 'multiselect' ? { options: [] } : {}) },
      previousKey: this.field().key,
    });
  }

  onOptions(text: string): void {
    this.optionsText.set(text);
    const existing = this.field().options ?? [];
    const taken: string[] = [];
    const options = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((label) => {
        const found = existing.find((o) => o.label === label && !taken.includes(o.value));
        const value = found ? found.value : uniqueKey(label, taken, 'opcion');
        taken.push(value);
        return { value, label };
      });
    this.patch({ options });
  }

  onLimits(limits: FileLimits): void {
    const { accept: _a, max_size_mb: _m, ...rest } = this.field();
    this.fieldChange.emit({ field: { ...rest, ...limits }, previousKey: this.field().key });
  }

  onVisible(group: WorkflowConditionGroup | undefined): void {
    this.patch({ visible_when: group });
  }
}
