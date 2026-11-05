import { Component, computed, inject, input, signal } from '@angular/core';
import {
  ButtonComponent,
  IconComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';
import {
  HUMAN_STAGE_TYPES,
  WORKFLOW_LIMITS,
  WorkflowFieldDef,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { FIELD_TYPE_TEXT, moveItem, uniqueKey } from '../../workflow-editor.utils';
import { FieldBuilderComponent } from '../field-builder.component';

/** Formulario tab: stage fields (ordered) and the field builder. */
@Component({
  selector: 'app-stage-form-tab',
  standalone: true,
  imports: [ButtonComponent, IconComponent, SelectorComponent, FieldBuilderComponent],
  template: `
    @if (isHuman()) {
      <div class="flex flex-col gap-3">
        <p class="text-xs text-text-secondary">
          Campos que se piden en esta etapa. Los campos se definen una vez para todo el flujo y cada etapa elige cuáles muestra.
        </p>
        <ul class="flex flex-col gap-2" aria-label="Campos de la etapa">
          @for (field of stageFields(); track field.key; let i = $index) {
            <li class="flex flex-col gap-2">
              <div class="flex items-center gap-2 rounded-xl border border-border bg-surface p-2">
                <app-icon [name]="field.type === 'file' ? 'paperclip' : 'file-text'" [size]="14" class="text-text-secondary" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-text-primary">
                    {{ field.label }}@if (field.required) { <span aria-label="obligatorio"> *</span> }
                  </p>
                  <p class="truncate text-xs text-text-secondary">{{ typeText(field) }} · {{ field.key }}</p>
                </div>
                <app-button variant="ghost" size="xsm" ariaLabel="Subir campo" [disabled]="i === 0" (clicked)="move(i, i - 1)">
                  <app-icon name="arrow-up" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="ghost" size="xsm" ariaLabel="Bajar campo" [disabled]="i === stageFields().length - 1" (clicked)="move(i, i + 1)">
                  <app-icon name="arrow-down" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="outline" size="xsm" [ariaPressed]="editing() === field.key" (clicked)="toggleEdit(field.key)">
                  {{ editing() === field.key ? 'Cerrar' : 'Editar' }}
                </app-button>
                <app-button variant="ghost" size="xsm" ariaLabel="Quitar de esta etapa" (clicked)="detach(field.key)">
                  <app-icon name="x" [size]="12" slot="icon" />
                </app-button>
              </div>
              @if (editing() === field.key) {
                <app-field-builder
                  [field]="field"
                  [allFields]="allFields()"
                  (fieldChange)="onFieldChange($event)"
                  (remove)="removeFromFlow(field.key)"
                />
              }
            </li>
          } @empty {
            <li class="text-sm text-text-secondary">Esta etapa aún no pide campos.</li>
          }
        </ul>

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

  typeText(field: WorkflowFieldDef): string {
    return FIELD_TYPE_TEXT[field.type] ?? field.type;
  }

  private setKeys(keys: string[]): void {
    this.store.updateStage(this.stage().key, (s) => ({ ...s, form: { fields: keys } }));
  }

  toggleEdit(key: string): void {
    this.editing.update((current) => (current === key ? null : key));
  }

  move(from: number, to: number): void {
    this.setKeys(moveItem(this.stage().form?.fields ?? [], from, to));
  }

  detach(key: string): void {
    this.setKeys((this.stage().form?.fields ?? []).filter((k) => k !== key));
    if (this.editing() === key) this.editing.set(null);
  }

  attach(key: string | number | null): void {
    if (key === null) return;
    this.setKeys([...(this.stage().form?.fields ?? []), String(key)]);
  }

  createField(): void {
    const taken = this.allFields().map((f) => f.key);
    const label = 'Nuevo campo';
    const key = uniqueKey(label, taken, 'campo');
    this.store.upsertField({ key, label, type: 'text' });
    this.setKeys([...(this.stage().form?.fields ?? []), key]);
    this.editing.set(key);
  }

  onFieldChange(event: { field: WorkflowFieldDef; previousKey: string }): void {
    this.store.upsertField(event.field, event.previousKey);
    if (this.editing() === event.previousKey) this.editing.set(event.field.key);
  }

  removeFromFlow(key: string): void {
    this.store.removeField(key);
    this.editing.set(null);
  }
}
