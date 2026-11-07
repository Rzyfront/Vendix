import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent, IconComponent } from '../../../../../../shared/components/index';
import {
  OPS_BY_FIELD_TYPE,
  WorkflowConditionGroup,
  WorkflowFieldDef,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { describeCondition } from '../workflow-editor.utils';
import { ConditionGroupComponent } from './condition-group.component';

/**
 * Reusable condition editor (Campo · Operador · Valor, groups Todas/Alguna).
 * Emits `undefined` when the last rule is removed so the caller drops `when`.
 */
@Component({
  selector: 'app-condition-builder',
  standalone: true,
  imports: [ButtonComponent, IconComponent, ConditionGroupComponent],
  template: `
    <div class="flex flex-col gap-2" data-testid="condition-builder">
      @if (value(); as group) {
        <app-condition-group
          [group]="group"
          [fields]="fields()"
          (groupChange)="onChange($event)"
          (removed)="valueChange.emit(undefined)"
        />
        @if (preview()) {
          <p class="text-xs text-text-secondary" data-testid="condition-preview">
            <app-icon name="info" [size]="12" class="mr-1 inline" />
            {{ prefix() }} {{ preview() }}
          </p>
        }
        <div>
          <app-button variant="ghost" size="sm" (clicked)="valueChange.emit(undefined)">
            <app-icon name="x" [size]="14" slot="icon" />
            Quitar condición
          </app-button>
        </div>
      } @else if (fields().length === 0) {
        <p class="text-xs text-text-secondary">Agrega campos al flujo para poder definir condiciones.</p>
      } @else {
        <div>
          <app-button variant="outline" size="sm" (clicked)="start()">
            <app-icon name="plus" [size]="14" slot="icon" />
            {{ addLabel() }}
          </app-button>
        </div>
      }
    </div>
  `,
})
export class ConditionBuilderComponent {
  readonly value = input<WorkflowConditionGroup | undefined>(undefined);
  readonly fields = input.required<WorkflowFieldDef[]>();
  readonly addLabel = input('Agregar condición');
  readonly prefix = input('Si');
  readonly valueChange = output<WorkflowConditionGroup | undefined>();

  readonly preview = computed(() => describeCondition(this.value(), this.fields()));

  start(): void {
    const first = this.fields()[0];
    if (!first) return;
    this.valueChange.emit({
      all: [{ field: first.key, op: OPS_BY_FIELD_TYPE[first.type][0] }],
    });
  }

  onChange(group: WorkflowConditionGroup): void {
    this.valueChange.emit(group);
  }
}
