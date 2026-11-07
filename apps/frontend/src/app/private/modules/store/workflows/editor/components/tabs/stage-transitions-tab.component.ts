import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import {
  STAGE_OUTCOMES,
  WORKFLOW_LIMITS,
  WorkflowConditionGroup,
  WorkflowStageDef,
  WorkflowTransitionDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { outcomeText, removeAt } from '../../workflow-editor.utils';
import { ConditionBuilderComponent } from '../condition-builder.component';

interface Entry {
  t: WorkflowTransitionDef;
  index: number;
}
interface OutcomeGroup {
  outcome: string;
  entries: Entry[];
  needsDefault: boolean;
}

/** Transiciones tab: ordered branches per outcome; the last one must be the default. */
@Component({
  selector: 'app-stage-transitions-tab',
  standalone: true,
  imports: [
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    ConditionBuilderComponent,
  ],
  template: `
    @if (groups().length === 0) {
      <p class="text-sm text-text-secondary">Las etapas de fin no tienen transiciones.</p>
    }
    <div class="flex flex-col gap-5">
      @for (group of groups(); track group.outcome) {
        <section class="flex flex-col gap-3" [attr.aria-label]="'Transiciones de ' + text(group.outcome)">
          <h3 class="text-sm font-bold text-text-primary">{{ text(group.outcome) }}</h3>
          @if (group.needsDefault) {
            <app-alert-banner variant="warning" icon="alert-triangle">
              La última transición de «{{ text(group.outcome) }}» debe ser la predeterminada (sin condición); así siempre hay un destino.
            </app-alert-banner>
          }
          @for (entry of group.entries; track entry.index; let pos = $index) {
            <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="transition">
              <div class="flex items-end gap-2">
                <div class="min-w-0 flex-1">
                  <app-selector
                    label="Pasa a"
                    [options]="destinations()"
                    [value]="entry.t.to"
                    (valueChange)="patch(entry.index, { to: $event })"
                  />
                </div>
                <app-button variant="ghost" size="xsm" ariaLabel="Subir prioridad" [disabled]="pos === 0" (clicked)="swap(group, pos, pos - 1)">
                  <app-icon name="arrow-up" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="ghost" size="xsm" ariaLabel="Bajar prioridad" [disabled]="pos === group.entries.length - 1" (clicked)="swap(group, pos, pos + 1)">
                  <app-icon name="arrow-down" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar transición" (clicked)="remove(entry.index)">
                  <app-icon name="trash-2" [size]="12" slot="icon" />
                </app-button>
              </div>
              <app-input label="Texto del botón (opcional)" [ngModel]="entry.t.label ?? ''" (ngModelChange)="patch(entry.index, { label: $event || undefined })" />
              @if (group.outcome === 'reject' || group.outcome === 'return') {
                <app-toggle label="Pedir comentario" [checked]="entry.t.require_comment === true" (toggled)="patch(entry.index, { require_comment: $event || undefined })" />
              }
              <app-condition-builder
                [value]="entry.t.when"
                [fields]="fields()"
                addLabel="Solo si se cumple una condición…"
                (valueChange)="setWhen(entry.index, $event)"
              />
            </div>
          }
          <div>
            <app-button variant="outline" size="sm" [disabled]="atLimit()" (clicked)="add(group.outcome)">
              <app-icon name="plus" [size]="14" slot="icon" />
              Agregar transición
            </app-button>
          </div>
        </section>
      }
    </div>
  `,
})
export class StageTransitionsTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly fields = computed(() => this.store.draft()?.fields ?? []);
  readonly destinations = computed(() =>
    (this.store.draft()?.stages ?? []).map((s) => ({ value: s.key, label: s.name })),
  );
  readonly atLimit = computed(
    () => (this.stage().transitions ?? []).length >= WORKFLOW_LIMITS.maxTransitionsPerStage,
  );
  readonly groups = computed<OutcomeGroup[]>(() => {
    const transitions = this.stage().transitions ?? [];
    return (STAGE_OUTCOMES[this.stage().type] ?? []).map((outcome) => {
      const entries = transitions
        .map((t, index) => ({ t, index }))
        .filter((e) => e.t.on === outcome);
      const last = entries[entries.length - 1];
      return { outcome, entries, needsDefault: entries.length > 0 && !!last.t.when };
    });
  });

  text(outcome: string): string {
    return outcomeText(outcome);
  }

  private set(next: WorkflowTransitionDef[]): void {
    this.store.updateStage(this.stage().key, (s) => ({ ...s, transitions: next }));
  }

  add(outcome: string): void {
    const stages = this.store.draft()?.stages ?? [];
    const own = stages.findIndex((s) => s.key === this.stage().key);
    const next = stages[own + 1] ?? stages.find((s) => s.key !== this.stage().key) ?? stages[0];
    const current = this.stage().transitions ?? [];
    // New branch goes last; a previous default (no `when`) stays last only when the new one is the default too.
    this.set([...current, { on: outcome, to: next?.key ?? '' }]);
  }

  patch(index: number, change: Record<string, unknown>): void {
    const current = this.stage().transitions ?? [];
    this.set(
      current.map((t, i) => {
        if (i !== index) return t;
        const merged = { ...t, ...change } as WorkflowTransitionDef;
        for (const k of Object.keys(merged) as (keyof WorkflowTransitionDef)[]) {
          if (merged[k] === undefined) delete merged[k];
        }
        return merged;
      }),
    );
  }

  setWhen(index: number, when: WorkflowConditionGroup | undefined): void {
    this.patch(index, { when });
  }

  remove(index: number): void {
    this.set(removeAt(this.stage().transitions ?? [], index));
  }

  /** Swaps the global positions of two branches of the same outcome. */
  swap(group: OutcomeGroup, from: number, to: number): void {
    const a = group.entries[from].index;
    const b = group.entries[to].index;
    const copy = [...(this.stage().transitions ?? [])];
    [copy[a], copy[b]] = [copy[b], copy[a]];
    this.set(copy);
  }
}
