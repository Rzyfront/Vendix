import { Component, input } from '@angular/core';
import { WorkflowStageDef } from '../../../../../../../shared/workflows/contract/workflow-contract';
import { StageLoopConfigComponent } from './config/stage-loop-config.component';
import { StageParallelConfigComponent } from './config/stage-parallel-config.component';
import { StageSubflowConfigComponent } from './config/stage-subflow-config.component';
import { StageWaitConfigComponent } from './config/stage-wait-config.component';

/** Configuración tab: the engine config of Paralelo, Subflujo, Espera and Bucle stages. */
@Component({
  selector: 'app-stage-config-tab',
  standalone: true,
  imports: [
    StageParallelConfigComponent,
    StageSubflowConfigComponent,
    StageWaitConfigComponent,
    StageLoopConfigComponent,
  ],
  template: `
    @switch (stage().type) {
      @case ('parallel') { <app-stage-parallel-config [stage]="stage()" /> }
      @case ('subflow') { <app-stage-subflow-config [stage]="stage()" /> }
      @case ('wait') { <app-stage-wait-config [stage]="stage()" /> }
      @case ('loop') { <app-stage-loop-config [stage]="stage()" /> }
      @default {
        <p class="text-sm text-text-secondary">Este tipo de etapa no tiene configuración adicional.</p>
      }
    }
  `,
})
export class StageConfigTabComponent {
  readonly stage = input.required<WorkflowStageDef>();
}
