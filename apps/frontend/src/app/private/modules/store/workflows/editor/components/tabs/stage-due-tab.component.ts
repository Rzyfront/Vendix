import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent, ToggleComponent } from '../../../../../../../shared/components/index';
import {
  HUMAN_STAGE_TYPES,
  WorkflowAssigneeDef,
  WorkflowDueDef,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { AssigneeEditorComponent } from '../assignee-editor.component';

/** Plazos tab: due hours, reminder cadence and escalation. */
@Component({
  selector: 'app-stage-due-tab',
  standalone: true,
  imports: [FormsModule, InputComponent, ToggleComponent, AssigneeEditorComponent],
  template: `
    @if (isHuman()) {
      <div class="flex flex-col gap-4">
        <app-toggle label="Esta etapa tiene plazo" [checked]="!!stage().due" (toggled)="toggle($event)" />
        @if (stage().due; as due) {
          <app-input
            label="Plazo (horas)"
            type="number"
            min="1"
            [ngModel]="due.hours"
            (ngModelChange)="setHours($event)"
          />
          <app-input
            label="Recordar cada (horas)"
            type="number"
            min="1"
            helperText="Opcional. Se envía un recordatorio mientras la tarea esté vencida."
            [ngModel]="due.on_overdue?.remind_every_hours ?? null"
            (ngModelChange)="setRemind($event)"
          />
          <div class="flex flex-col gap-2">
            <app-toggle label="Escalar si vence" [checked]="!!due.on_overdue?.escalate_to" (toggled)="toggleEscalate($event)" />
            @if (due.on_overdue?.escalate_to; as target) {
              <span class="text-xs text-text-secondary">
                @if (due.on_overdue?.remind_every_hours) {
                  Primero se avisa al responsable y, si pasan esas horas sin atenderla, la tarea sube.
                } @else {
                  La tarea sube apenas vence.
                }
              </span>
              <app-assignee-editor
                label="Escalar a"
                [value]="target"
                [fields]="store.draft()?.fields ?? []"
                (valueChange)="setEscalate($event)"
              />
            }
          </div>
        }
      </div>
    } @else {
      <p class="text-sm text-text-secondary">Las etapas automáticas y de fin no tienen plazo.</p>
    }
  `,
})
export class StageDueTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();
  readonly isHuman = computed(() => HUMAN_STAGE_TYPES.includes(this.stage().type));

  private setDue(due: WorkflowDueDef | undefined): void {
    this.store.updateStage(this.stage().key, (s) => {
      const { due: _due, ...rest } = s;
      return due ? { ...rest, due } : rest;
    });
  }

  private positive(raw: unknown): number | undefined {
    const n = Math.floor(Number(raw));
    return raw !== '' && raw !== null && Number.isFinite(n) && n >= 1 ? n : undefined;
  }

  toggle(on: boolean): void {
    this.setDue(on ? { hours: 24 } : undefined);
  }

  setHours(raw: unknown): void {
    const due = this.stage().due;
    if (due) this.setDue({ ...due, hours: this.positive(raw) ?? due.hours });
  }

  private overdue(change: NonNullable<WorkflowDueDef['on_overdue']>, drop: 'remind_every_hours' | 'escalate_to' | null): void {
    const due = this.stage().due;
    if (!due) return;
    const merged = { ...(due.on_overdue ?? {}), ...change };
    if (drop) delete merged[drop];
    const { on_overdue: _o, ...rest } = due;
    this.setDue(Object.keys(merged).length > 0 ? { ...rest, on_overdue: merged } : rest);
  }

  setRemind(raw: unknown): void {
    const hours = this.positive(raw);
    this.overdue(hours ? { remind_every_hours: hours } : {}, hours ? null : 'remind_every_hours');
  }

  toggleEscalate(on: boolean): void {
    this.overdue(on ? { escalate_to: { kind: 'initiator' } } : {}, on ? null : 'escalate_to');
  }

  setEscalate(target: WorkflowAssigneeDef): void {
    this.overdue({ escalate_to: target }, null);
  }
}
