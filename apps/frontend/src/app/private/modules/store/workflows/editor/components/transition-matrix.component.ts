import { Component, computed, inject } from '@angular/core';
import { ButtonComponent, SelectorComponent } from '../../../../../../shared/components/index';
import { WorkflowStageDef } from '../../../../../../shared/workflows/contract/workflow-contract';
import { stageOutcomes } from '../../../../../../shared/workflows/contract/workflow-runtime';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { describeCondition, outcomeText } from '../workflow-editor.utils';

const COLUMNS = ['submit', 'approve', 'reject', 'return', 'auto'];

/** Stages x outcomes. Editable default destination; branches shown as text. */
@Component({
  selector: 'app-transition-matrix',
  standalone: true,
  imports: [ButtonComponent, SelectorComponent],
  template: `
    <div class="overflow-auto rounded-xl border border-border bg-surface" data-testid="transition-matrix">
      <table class="w-full min-w-max border-collapse text-sm">
        <caption class="sr-only">Matriz de transiciones: etapas por resultado</caption>
        <thead>
          <tr class="border-b border-border text-left text-xs font-semibold text-text-secondary">
            <th scope="col" class="p-2">Etapa</th>
            @for (col of columns; track col) {
              <th scope="col" class="p-2">{{ text(col) }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (stage of stages(); track stage.key) {
            <tr class="border-b border-border last:border-b-0">
              <th scope="row" class="p-2 text-left font-semibold text-text-primary">{{ stage.name }}</th>
              @for (col of columns; track col) {
                <td class="min-w-44 p-2 align-top">
                  @if (applies(stage, col)) {
                    <app-selector
                      size="sm"
                      placeholder="Sin destino"
                      [options]="options()"
                      [value]="defaultOf(stage, col)"
                      (valueChange)="setDefault(stage, col, $event)"
                    />
                    @for (branch of branches(stage, col); track $index) {
                      <p class="mt-1 text-xs text-text-secondary">{{ branch }}</p>
                    }
                    @if (branches(stage, col).length > 0) {
                      <app-button variant="ghost" size="xsm" (clicked)="store.selectStage(stage.key, 'transitions')">
                        Editar en Transiciones
                      </app-button>
                    }
                  } @else {
                    <span class="text-xs text-text-secondary">No aplica</span>
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class TransitionMatrixComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly columns = COLUMNS;
  readonly stages = computed(() => this.store.draft()?.stages ?? []);
  readonly options = computed(() => this.stages().map((s) => ({ value: s.key, label: s.name })));

  text(outcome: string): string {
    return outcomeText(outcome);
  }

  applies(stage: WorkflowStageDef, outcome: string): boolean {
    return stageOutcomes(stage).includes(outcome);
  }

  defaultOf(stage: WorkflowStageDef, outcome: string): string | null {
    const defaults = (stage.transitions ?? []).filter((t) => t.on === outcome && !t.when);
    return defaults[defaults.length - 1]?.to ?? null;
  }

  branches(stage: WorkflowStageDef, outcome: string): string[] {
    const fields = this.store.draft()?.fields ?? [];
    return (stage.transitions ?? [])
      .filter((t) => t.on === outcome && t.when)
      .map((t) => {
        const target = this.stages().find((s) => s.key === t.to)?.name ?? t.to;
        return `Si ${describeCondition(t.when, fields)} → ${target}`;
      });
  }

  setDefault(stage: WorkflowStageDef, outcome: string, to: string | number | null): void {
    if (to === null) return;
    const target = String(to);
    this.store.updateStage(stage.key, (s) => {
      const list = s.transitions ?? [];
      let lastDefault = -1;
      list.forEach((t, i) => {
        if (t.on === outcome && !t.when) lastDefault = i;
      });
      if (lastDefault >= 0) {
        return { ...s, transitions: list.map((t, i) => (i === lastDefault ? { ...t, to: target } : t)) };
      }
      return { ...s, transitions: [...list, { on: outcome, to: target }] };
    });
  }
}
