import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/index';
import {
  HUMAN_STAGE_TYPES,
  WorkflowAssigneeDef,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { AssigneeEditorComponent } from '../assignee-editor.component';

/** Responsable tab: assignee picker and quorum for approvals by role/group. */
@Component({
  selector: 'app-stage-assignee-tab',
  standalone: true,
  imports: [FormsModule, InputComponent, AssigneeEditorComponent],
  template: `
    @if (isHuman()) {
      <div class="flex flex-col gap-4">
        <app-assignee-editor
          [value]="stage().assignee"
          [fields]="store.draft()?.fields ?? []"
          (valueChange)="setAssignee($event)"
        />
        @if (quorumAllowed()) {
          <app-input
            label="Aprobaciones necesarias (quórum)"
            type="number"
            min="1"
            helperText="Cuántas personas deben aprobar. Déjalo vacío para que baste una."
            [ngModel]="stage().quorum?.required ?? null"
            (ngModelChange)="setQuorum($event)"
          />
        }
      </div>
    } @else {
      <p class="text-sm text-text-secondary">
        Las etapas automáticas y de fin no tienen responsable.
      </p>
    }
  `,
})
export class StageAssigneeTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly isHuman = computed(() => HUMAN_STAGE_TYPES.includes(this.stage().type));
  readonly quorumAllowed = computed(() => {
    const kind = this.stage().assignee?.kind;
    return this.stage().type === 'approval' && (kind === 'role' || kind === 'group');
  });

  setAssignee(assignee: WorkflowAssigneeDef): void {
    this.store.updateStage(this.stage().key, (s) => {
      const keepsQuorum = assignee.kind === 'role' || assignee.kind === 'group';
      const { quorum, ...rest } = s;
      return { ...rest, assignee, ...(keepsQuorum && quorum ? { quorum } : {}) };
    });
  }

  setQuorum(raw: unknown): void {
    const parsed = Math.floor(Number(raw));
    this.store.updateStage(this.stage().key, (s) => {
      const { quorum: _quorum, ...rest } = s;
      return raw === '' || raw === null || !Number.isFinite(parsed) || parsed < 1
        ? rest
        : { ...rest, quorum: { required: parsed } };
    });
  }
}
