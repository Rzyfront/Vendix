import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
} from '../../../../../../../../shared/components/index';
import {
  WORKFLOW_LIMITS,
  WorkflowBranchDef,
  WorkflowJoinRule,
  WorkflowParallelDef,
  WorkflowStageDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../../workflow-editor.store';
import { removeAt, replaceAt, toWholeNumber, uniqueKey } from '../../../workflow-editor.utils';
import { AssigneeEditorComponent } from '../../assignee-editor.component';

const JOIN_OPTIONS: { value: WorkflowJoinRule; label: string }[] = [
  { value: 'all', label: 'Todas las ramas' },
  { value: 'any', label: 'Cualquiera (la primera que termine)' },
  { value: 'n_of_m', label: 'N de M ramas' },
];

/** Configuración of a Paralelo stage: branches (one task each) and the join rule. */
@Component({
  selector: 'app-stage-parallel-config',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    MultiSelectorComponent,
    SelectorComponent,
    AssigneeEditorComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <p class="text-xs text-text-secondary">
        Cada rama es una tarea con su responsable; todas se abren a la vez. La unión decide cuándo sigue la solicitud.
      </p>
      @for (branch of branches(); track $index; let i = $index) {
        <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="branch">
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <app-input label="Nombre de la rama" [required]="true" [ngModel]="branch.name" (ngModelChange)="rename(i, $event)" />
            </div>
            <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar rama" [disabled]="branches().length <= minBranches" (clicked)="remove(i)">
              <app-icon name="trash-2" [size]="12" slot="icon" />
            </app-button>
          </div>
          <app-input label="Clave de la rama" [ngModel]="branch.key" (ngModelChange)="patch(i, { key: $event })" />
          <app-assignee-editor
            [value]="branch.assignee"
            [fields]="fields()"
            (valueChange)="patch(i, { assignee: $event })"
          />
          <app-multi-selector
            label="Campos que llena esta rama"
            placeholder="Sin formulario"
            [options]="fieldOptions()"
            [ngModel]="branch.form?.fields ?? []"
            (ngModelChange)="setForm(i, $event)"
          />
        </div>
      }
      <div>
        <app-button variant="outline" size="sm" [disabled]="branches().length >= maxBranches" (clicked)="add()">
          <app-icon name="plus" [size]="14" slot="icon" />
          Agregar rama
        </app-button>
      </div>

      <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
        <app-selector label="Unión: la solicitud sigue cuando terminan" [options]="joinOptions" [value]="parallel().join" (valueChange)="setJoin($event)" />
        @if (parallel().join === 'n_of_m') {
          <app-input
            label="Ramas necesarias (N)"
            type="number"
            min="1"
            [max]="branches().length"
            [helperText]="'Entre 1 y ' + branches().length + '.'"
            [ngModel]="parallel().required ?? null"
            (ngModelChange)="setRequired($event)"
          />
        }
      </div>
    </div>
  `,
})
export class StageParallelConfigComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly joinOptions = JOIN_OPTIONS;
  readonly minBranches = 2;
  readonly maxBranches = WORKFLOW_LIMITS.maxBranches;
  readonly parallel = computed<WorkflowParallelDef>(
    () => this.stage().parallel ?? { branches: [], join: 'all' },
  );
  readonly branches = computed(() => this.parallel().branches);
  readonly fields = computed(() => this.store.draft()?.fields ?? []);
  readonly fieldOptions = computed(() => this.fields().map((f) => ({ value: f.key, label: f.label })));

  private set(next: WorkflowParallelDef): void {
    this.store.updateStage(this.stage().key, (s) => ({ ...s, parallel: next }));
  }

  /** `required` only makes sense for N de M and never exceeds the branch count. */
  private normalize(next: WorkflowParallelDef): WorkflowParallelDef {
    const { required, ...rest } = next;
    if (next.join !== 'n_of_m') return rest;
    return { ...rest, required: Math.min(Math.max(required ?? 1, 1), next.branches.length) };
  }

  add(): void {
    const taken = this.branches().map((b) => b.key);
    const name = `Rama ${this.branches().length + 1}`;
    const branch: WorkflowBranchDef = {
      key: uniqueKey(name, taken, 'rama'),
      name,
      assignee: { kind: 'initiator' },
    };
    this.set(this.normalize({ ...this.parallel(), branches: [...this.branches(), branch] }));
  }

  remove(index: number): void {
    this.set(this.normalize({ ...this.parallel(), branches: removeAt(this.branches(), index) }));
  }

  patch(index: number, change: Partial<WorkflowBranchDef>): void {
    const current = this.branches()[index];
    this.set({ ...this.parallel(), branches: replaceAt(this.branches(), index, { ...current, ...change }) });
  }

  /** The key follows the name while it is still the derived one. */
  rename(index: number, name: string): void {
    const current = this.branches()[index];
    const others = this.branches().filter((_, i) => i !== index).map((b) => b.key);
    const derived = current.key === uniqueKey(current.name, others, 'rama') || /^rama_\d+$/.test(current.key);
    this.patch(index, derived ? { name, key: uniqueKey(name, others, 'rama') } : { name });
  }

  setForm(index: number, keys: (string | number)[] | null): void {
    const fields = (keys ?? []).map(String);
    const current = this.branches()[index];
    const { form: _form, ...rest } = current;
    this.set({
      ...this.parallel(),
      branches: replaceAt(this.branches(), index, fields.length > 0 ? { ...rest, form: { fields } } : rest),
    });
  }

  setJoin(value: string | number | null): void {
    this.set(this.normalize({ ...this.parallel(), join: value as WorkflowJoinRule }));
  }

  setRequired(raw: unknown): void {
    const required = toWholeNumber(raw);
    this.set({ ...this.parallel(), ...(required !== undefined ? { required } : {}) });
  }
}
