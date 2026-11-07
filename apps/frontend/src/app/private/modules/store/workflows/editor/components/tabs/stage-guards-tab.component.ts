import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../../../../shared/components/index';
import {
  OPS_BY_FIELD_TYPE,
  WORKFLOW_LIMITS,
  WorkflowConditionGroup,
  WorkflowGuardDef,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { removeAt, replaceAt } from '../../workflow-editor.utils';
import { ConditionBuilderComponent } from '../condition-builder.component';

const NO_REDIRECT = '__none__';
const HUMAN_STAGE_TYPES: ReadonlySet<string> = new Set(['form', 'approval', 'review']);

/** Guardas tab: rules checked before the stage advances; they block with a message or redirect. */
@Component({
  selector: 'app-stage-guards-tab',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, SelectorComponent, TextareaComponent, ConditionBuilderComponent],
  template: `
    <div class="flex flex-col gap-4">
      <p class="text-xs text-text-secondary">
        Antes de avanzar se revisan en orden. Si la condición se cumple, la guarda bloquea con su mensaje o, si eliges una etapa, redirige a ella.
      </p>
      @for (guard of guards(); track $index; let i = $index) {
        <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="guard">
          <div class="flex items-start justify-between gap-2">
            <span class="text-xs font-semibold text-text-primary">Guarda {{ i + 1 }}</span>
            <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar guarda" (clicked)="remove(i)">
              <app-icon name="trash-2" [size]="12" slot="icon" />
            </app-button>
          </div>
          <app-condition-builder
            [value]="guard.when"
            [fields]="fields()"
            addLabel="Definir cuándo se activa…"
            prefix="Se activa si"
            (valueChange)="patch(i, { when: $event ?? { all: [] } })"
          />
          <app-textarea
            label="Mensaje que se muestra"
            [rows]="2"
            [required]="true"
            [ngModel]="guard.message"
            (ngModelChange)="patch(i, { message: $event })"
          />
          <app-selector
            label="Redirigir a"
            size="sm"
            [options]="redirectOptions()"
            [value]="guard.redirect_to ?? noRedirect"
            [helpText]="humanStage() ? 'Sin redirección, la guarda solo bloquea y la tarea sigue abierta.' : 'Nadie envía esta etapa: la guarda debe redirigir a otra etapa.'"
            (valueChange)="setRedirect(i, $event)"
          />
        </div>
      } @empty {
        <p class="text-sm text-text-secondary">Sin guardas.</p>
      }
      <div>
        <app-button variant="outline" size="sm" [disabled]="guards().length >= maxGuards || fields().length === 0" (clicked)="add()">
          <app-icon name="plus" [size]="14" slot="icon" />
          Agregar guarda
        </app-button>
        @if (fields().length === 0) {
          <p class="mt-1 text-xs text-text-secondary">Declara campos en el flujo para poder definir condiciones.</p>
        }
      </div>
    </div>
  `,
})
export class StageGuardsTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly noRedirect = NO_REDIRECT;
  readonly maxGuards = WORKFLOW_LIMITS.maxGuards;
  readonly guards = computed(() => this.stage().guards ?? []);
  readonly fields = computed(() => this.store.draft()?.fields ?? []);
  /** Only a stage a person submits may have a guard that just blocks. */
  readonly humanStage = computed(() => HUMAN_STAGE_TYPES.has(this.stage().type));
  readonly redirectOptions = computed(() => [
    ...(this.humanStage() ? [{ value: NO_REDIRECT, label: 'No redirigir (solo bloquear)' }] : []),
    ...(this.store.draft()?.stages ?? [])
      .filter((s) => s.key !== this.stage().key)
      .map((s) => ({ value: s.key, label: s.name })),
  ]);

  private set(next: WorkflowGuardDef[]): void {
    this.store.updateStage(this.stage().key, (s) => {
      const { guards: _guards, ...rest } = s;
      return next.length > 0 ? { ...rest, guards: next } : rest;
    });
  }

  add(): void {
    const first = this.fields()[0];
    if (!first) return;
    const when: WorkflowConditionGroup = { all: [{ field: first.key, op: OPS_BY_FIELD_TYPE[first.type][0] }] };
    this.set([...this.guards(), { when, message: '' }]);
  }

  remove(index: number): void {
    this.set(removeAt(this.guards(), index));
  }

  patch(index: number, change: Partial<WorkflowGuardDef>): void {
    this.set(replaceAt(this.guards(), index, { ...this.guards()[index], ...change }));
  }

  setRedirect(index: number, value: string | number | null): void {
    const { redirect_to: _redirect, ...rest } = this.guards()[index];
    const key = value === null || value === NO_REDIRECT ? null : String(value);
    this.set(replaceAt(this.guards(), index, key ? { ...rest, redirect_to: key } : rest));
  }
}
