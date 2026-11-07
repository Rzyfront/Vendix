import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent } from '../../../../../../../../shared/components/index';
import {
  WORKFLOW_LIMITS,
  WorkflowConditionGroup,
  WorkflowStageDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../../workflow-editor.store';
import { toWholeNumber } from '../../../workflow-editor.utils';
import { ConditionBuilderComponent } from '../../condition-builder.component';

/** Configuración of a Bucle stage: "mientras" condition and the hard lap limit. */
@Component({
  selector: 'app-stage-loop-config',
  standalone: true,
  imports: [FormsModule, InputComponent, ConditionBuilderComponent],
  template: `
    <div class="flex flex-col gap-4">
      <p class="text-xs text-text-secondary">
        Sale por «Otra vuelta» mientras se cumpla la condición y por «Terminado» cuando deje de cumplirse o llegue al máximo de vueltas.
      </p>
      <div class="flex flex-col gap-1">
        <span class="text-xs font-semibold text-text-primary">Repetir mientras</span>
        <app-condition-builder
          [value]="stage().loop?.while"
          [fields]="fields()"
          addLabel="Definir la condición…"
          prefix="Repite mientras"
          (valueChange)="setWhile($event)"
        />
      </div>
      <app-input
        label="Máximo de vueltas"
        type="number"
        min="1"
        [max]="maxLimit"
        [required]="true"
        [helperText]="'Obligatorio, de 1 a ' + maxLimit + '. Evita bucles infinitos.'"
        [ngModel]="stage().loop?.max_iterations ?? null"
        (ngModelChange)="setMax($event)"
      />
    </div>
  `,
})
export class StageLoopConfigComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly maxLimit = WORKFLOW_LIMITS.maxLoopIterations;
  readonly fields = computed(() => this.store.draft()?.fields ?? []);

  setWhile(group: WorkflowConditionGroup | undefined): void {
    this.store.updateStage(this.stage().key, (s) => ({
      ...s,
      loop: { while: group ?? { all: [] }, max_iterations: s.loop?.max_iterations ?? 0 },
    }));
  }

  setMax(raw: unknown): void {
    const max = toWholeNumber(raw);
    this.store.updateStage(this.stage().key, (s) => ({
      ...s,
      loop: { while: s.loop?.while ?? { all: [] }, max_iterations: max ?? 0 },
    }));
  }
}
