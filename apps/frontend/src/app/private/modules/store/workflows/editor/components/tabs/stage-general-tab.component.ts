import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import {
  STAGE_OUTCOMES,
  WORKFLOW_END_OUTCOMES,
  WORKFLOW_KEY_PATTERN,
  WORKFLOW_STAGE_TYPES,
  WorkflowEndOutcome,
  WorkflowStageDef,
  WorkflowStageType,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { END_OUTCOME_LABEL, STAGE_TYPE_LABEL } from '../../workflow-editor.utils';

const TYPE_OPTIONS = WORKFLOW_STAGE_TYPES.map((t) => ({ value: t, label: STAGE_TYPE_LABEL[t] }));
const END_OPTIONS = WORKFLOW_END_OUTCOMES.map((o) => ({ value: o, label: END_OUTCOME_LABEL[o] }));

/** General tab: name, key, type, description, start flag and end outcome. */
@Component({
  selector: 'app-stage-general-tab',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent, TextareaComponent, ToggleComponent],
  template: `
    <div class="flex flex-col gap-4">
      <app-input
        label="Nombre de la etapa"
        [required]="true"
        [ngModel]="stage().name"
        (ngModelChange)="patch({ name: $event })"
      />
      <app-input
        label="Clave interna"
        [readonly]="store.isPublished()"
        [ngModel]="keyDraft()"
        [error]="keyError()"
        [helperText]="store.isPublished() ? 'La clave no se puede cambiar una vez publicado el flujo.' : ''"
        (ngModelChange)="keyDraft.set($event)"
        (inputBlur)="commitKey()"
      />
      <app-selector
        label="Tipo de etapa"
        [options]="typeOptions"
        [value]="stage().type"
        (valueChange)="changeType($event)"
      />
      <app-textarea
        label="Descripción"
        [rows]="3"
        [ngModel]="stage().description ?? ''"
        (ngModelChange)="patch({ description: $event || undefined })"
      />
      <div class="flex flex-col gap-1">
        <app-toggle
          label="Etapa inicial"
          [checked]="stage().start === true"
          [disabled]="stage().start === true"
          (toggled)="setStart($event)"
        />
        <span class="text-xs text-text-secondary">
          @if (stage().start) {
            Es donde empieza cada solicitud. Para cambiarla, marca otra etapa como inicial.
          } @else {
            Marcarla como inicial quita la marca a la etapa actual.
          }
        </span>
      </div>
      @if (stage().type === 'end') {
        <app-selector
          label="Resultado final"
          [options]="endOptions"
          [value]="stage().outcome ?? null"
          (valueChange)="patch({ outcome: $event })"
        />
      }
    </div>
  `,
})
export class StageGeneralTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly typeOptions = TYPE_OPTIONS;
  readonly endOptions = END_OPTIONS;
  readonly keyDraft = signal('');
  readonly keyError = computed(() => {
    const draft = this.keyDraft();
    if (draft === this.stage().key) return undefined;
    if (!WORKFLOW_KEY_PATTERN.test(draft)) {
      return 'Usa minúsculas, números, guion o guion bajo; empieza con letra.';
    }
    const taken = this.store.draft()?.stages.some((s) => s.key === draft);
    return taken ? 'Ya existe una etapa con esta clave.' : undefined;
  });

  constructor() {
    effect(() => {
      const key = this.stage().key;
      untracked(() => this.keyDraft.set(key));
    });
  }

  patch(change: Record<string, unknown>): void {
    const key = this.stage().key;
    this.store.updateStage(key, (s) => {
      const next = { ...s, ...change } as WorkflowStageDef;
      for (const k of Object.keys(next) as (keyof WorkflowStageDef)[]) {
        if (next[k] === undefined) delete next[k];
      }
      return next;
    });
  }

  commitKey(): void {
    const draft = this.keyDraft();
    if (this.store.isPublished() || this.keyError() || draft === this.stage().key) {
      if (this.keyError()) this.keyDraft.set(this.stage().key);
      return;
    }
    this.store.renameStageKey(this.stage().key, draft);
  }

  setStart(on: boolean): void {
    if (on) this.store.setStart(this.stage().key);
  }

  /** Changing the type drops what the new type cannot hold (transitions of other outcomes, assignee). */
  changeType(value: string | number | null): void {
    const type = value as WorkflowStageType;
    this.store.updateStage(this.stage().key, (s) => {
      const outcomes = STAGE_OUTCOMES[type];
      const { outcome: _outcome, assignee, quorum, due, ...rest } = s;
      const human = type === 'form' || type === 'approval' || type === 'review';
      return {
        ...rest,
        type,
        transitions: (s.transitions ?? []).filter((t) => outcomes.includes(t.on)),
        ...(type === 'end' ? { outcome: (s.outcome ?? 'completed') as WorkflowEndOutcome } : {}),
        ...(human ? { assignee: assignee ?? { kind: 'initiator' as const }, ...(due ? { due } : {}) } : {}),
        ...(type === 'approval' && quorum ? { quorum } : {}),
      };
    });
  }
}
