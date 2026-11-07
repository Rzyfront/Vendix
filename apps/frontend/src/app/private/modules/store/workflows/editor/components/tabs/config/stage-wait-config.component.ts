import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent, SelectorComponent } from '../../../../../../../../shared/components/index';
import {
  WORKFLOW_WAIT_KINDS,
  WorkflowStageDef,
  WorkflowWaitDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../../workflow-editor.store';
import { WAIT_KIND_LABEL, describeWait, toWholeNumber } from '../../../workflow-editor.utils';

type WaitKind = WorkflowWaitDef['kind'];

const KIND_OPTIONS = WORKFLOW_WAIT_KINDS.map((k) => ({ value: k, label: WAIT_KIND_LABEL[k] }));

const DEFAULTS: Record<WaitKind, WorkflowWaitDef> = {
  duration: { kind: 'duration', days: 1 },
  date: { kind: 'date', date: '' },
  field: { kind: 'field', field: '' },
  business_days: { kind: 'business_days', days: 1 },
  day_of_month: { kind: 'day_of_month', day: 1 },
};

/** Configuración of an Espera stage: when the request resumes by itself. */
@Component({
  selector: 'app-stage-wait-config',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent],
  template: `
    <div class="flex flex-col gap-4">
      <p class="text-xs text-text-secondary">
        La solicitud se detiene aquí y sigue sola cuando se cumple la espera. Las horas son de la zona horaria de la tienda.
      </p>
      <app-selector label="Esperar hasta" [options]="kindOptions" [value]="wait().kind" (valueChange)="setKind($event)" />

      @switch (wait().kind) {
        @case ('duration') {
          <div class="grid grid-cols-3 gap-3">
            <app-input label="Días" type="number" min="0" [ngModel]="durationPart('days')" (ngModelChange)="setNumber('days', $event)" />
            <app-input label="Horas" type="number" min="0" [ngModel]="durationPart('hours')" (ngModelChange)="setNumber('hours', $event)" />
            <app-input label="Minutos" type="number" min="0" [ngModel]="durationPart('minutes')" (ngModelChange)="setNumber('minutes', $event)" />
          </div>
        }
        @case ('date') {
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <app-input label="Fecha" type="date" [ngModel]="dateValue()" (ngModelChange)="patch({ date: $event || '' })" />
            <app-input label="Hora (HH:mm)" type="time" [ngModel]="timeValue()" (ngModelChange)="setTime($event)" />
          </div>
        }
        @case ('field') {
          <app-selector
            label="Campo de fecha"
            placeholder="Elige un campo de tipo fecha"
            [options]="dateFieldOptions()"
            [value]="fieldValue()"
            helpText="Solo se listan los campos de tipo «Fecha»."
            (valueChange)="patch({ field: str($event) })"
          />
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <app-input label="Desplazamiento en días" type="number" helperText="Positivo espera después de la fecha; negativo, antes." [ngModel]="offsetValue()" (ngModelChange)="setOffset($event)" />
            <app-input label="Hora (HH:mm)" type="time" [ngModel]="timeValue()" (ngModelChange)="setTime($event)" />
          </div>
        }
        @case ('business_days') {
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <app-input label="Días hábiles" type="number" min="1" helperText="Lunes a viernes, sin festivos de Colombia." [ngModel]="daysValue()" (ngModelChange)="setDays($event)" />
            <app-input label="Hora (HH:mm)" type="time" [ngModel]="timeValue()" (ngModelChange)="setTime($event)" />
          </div>
        }
        @case ('day_of_month') {
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <app-input label="Día del mes" type="number" min="1" [max]="maxDay" [helperText]="'De 1 a ' + maxDay + '.'" [ngModel]="dayValue()" (ngModelChange)="setDay($event)" />
            <app-input label="Hora (HH:mm)" type="time" [ngModel]="timeValue()" (ngModelChange)="setTime($event)" />
          </div>
        }
      }

      <p class="rounded-xl bg-primary/5 p-3 text-sm text-text-primary" data-testid="wait-summary">{{ summary() }}</p>
    </div>
  `,
})
export class StageWaitConfigComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly kindOptions = KIND_OPTIONS;
  readonly maxDay = 28;
  readonly wait = computed<WorkflowWaitDef>(() => this.stage().wait ?? DEFAULTS.duration);
  readonly dateFieldOptions = computed(() =>
    (this.store.draft()?.fields ?? [])
      .filter((f) => f.type === 'date')
      .map((f) => ({ value: f.key, label: f.label })),
  );
  readonly summary = computed(() => describeWait(this.wait(), this.store.draft()?.fields ?? []));

  str(v: string | number | null): string {
    return v === null ? '' : String(v);
  }

  durationPart(part: 'days' | 'hours' | 'minutes'): number | null {
    const w = this.wait();
    return w.kind === 'duration' ? (w[part] ?? null) : null;
  }
  dateValue(): string {
    const w = this.wait();
    return w.kind === 'date' ? w.date : '';
  }
  fieldValue(): string | null {
    const w = this.wait();
    return w.kind === 'field' && w.field ? w.field : null;
  }
  offsetValue(): number | null {
    const w = this.wait();
    return w.kind === 'field' ? (w.offset_days ?? null) : null;
  }
  daysValue(): number | null {
    const w = this.wait();
    return w.kind === 'business_days' ? w.days : null;
  }
  dayValue(): number | null {
    const w = this.wait();
    return w.kind === 'day_of_month' ? w.day : null;
  }
  timeValue(): string {
    const w = this.wait();
    return w.kind !== 'duration' ? (w.time ?? '') : '';
  }

  private set(next: WorkflowWaitDef): void {
    this.store.updateStage(this.stage().key, (s) => ({ ...s, wait: next }));
  }

  setKind(value: string | number | null): void {
    this.set(DEFAULTS[value as WaitKind] ?? DEFAULTS.duration);
  }

  /** Merges `change` into the current wait; undefined values are dropped. */
  patch(change: Record<string, unknown>): void {
    const merged: Record<string, unknown> = { ...this.wait(), ...change };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    this.set(merged as unknown as WorkflowWaitDef);
  }

  setNumber(part: 'days' | 'hours' | 'minutes', raw: unknown): void {
    this.patch({ [part]: toWholeNumber(raw) });
  }
  setOffset(raw: unknown): void {
    this.patch({ offset_days: toWholeNumber(raw) });
  }
  setDays(raw: unknown): void {
    this.patch({ days: toWholeNumber(raw) ?? 0 });
  }
  setDay(raw: unknown): void {
    this.patch({ day: toWholeNumber(raw) ?? 0 });
  }
  setTime(raw: unknown): void {
    this.patch({ time: typeof raw === 'string' && raw ? raw : undefined });
  }
}
