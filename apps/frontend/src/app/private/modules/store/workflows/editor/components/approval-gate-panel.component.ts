import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  WORKFLOW_GATE_OPERATIONS,
  WORKFLOW_GATE_OPERATION_KEYS,
  WorkflowGateOperation,
  WorkflowGovernsDef,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { gateTokenOptions, groupOptionsByModule } from '../workflow-editor-triggers.utils';

/** "Candado de aprobación": the operation this flow governs (`governs`). */
@Component({
  selector: 'app-approval-gate-panel',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent, ToggleComponent],
  template: `
    <section class="flex flex-col gap-4" aria-label="Candado de aprobación">
      <div>
        <h2 class="text-sm font-bold text-text-primary">Candado de aprobación</h2>
        <p class="text-xs text-text-secondary">
          Una operación sensible queda pendiente hasta que una solicitud de este flujo la apruebe. Nadie puede saltársela desde otra pantalla.
        </p>
      </div>

      <app-toggle
        label="Este flujo gobierna una operación"
        [checked]="governs() !== null"
        (toggled)="setEnabled($event)"
      />

      @if (governs(); as g) {
        <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="gate-config">
          <app-selector
            label="Operación"
            size="sm"
            [options]="operationOptions"
            [value]="g.operation"
            (valueChange)="setOperation($event)"
          />
          <p class="text-xs text-text-secondary" data-testid="gate-mode">
            @if (spec()?.mode === 'hold') {
              La operación espera la decisión; si se rechaza, queda anulada.
            } @else {
              No se crea nada hasta que se apruebe; al aprobar se ejecuta como quien la pidió.
            }
          </p>
          <app-input
            size="sm"
            [currency]="true"
            [label]="(spec()?.amount_label ?? 'Monto') + ' desde'"
            helperText="Por debajo de este monto la operación no se retiene. Vacío retiene todas."
            [ngModel]="g.min_amount ?? null"
            (ngModelChange)="setMinAmount($event)"
          />
          @if (mappableFields().length === 0) {
            <p class="text-xs text-text-secondary">Declara campos en el formulario para llenarlos con datos de la operación.</p>
          } @else {
            <p class="text-xs font-semibold text-text-primary">Llenar campos con datos de la operación</p>
            @for (field of mappableFields(); track field.key) {
              <app-selector
                size="sm"
                [label]="field.label"
                [options]="tokenOptions()"
                [value]="g.map?.[field.key] ?? ''"
                (valueChange)="setMap(field.key, $event)"
              />
            }
          }
        </div>
      }
    </section>
  `,
})
export class ApprovalGatePanelComponent {
  protected readonly store = inject(WorkflowEditorStore);

  readonly operationOptions = groupOptionsByModule(
    WORKFLOW_GATE_OPERATION_KEYS,
    (op) => WORKFLOW_GATE_OPERATIONS[op].module,
    (op) => WORKFLOW_GATE_OPERATIONS[op].label,
  );

  readonly governs = computed<WorkflowGovernsDef | null>(() => this.store.draft()?.governs ?? null);
  readonly spec = computed(() => {
    const g = this.governs();
    return g ? WORKFLOW_GATE_OPERATIONS[g.operation] : null;
  });
  /** File and multiselect fields cannot be filled by a token (validator rule). */
  readonly mappableFields = computed(() =>
    (this.store.draft()?.fields ?? []).filter((f) => f.type !== 'file' && f.type !== 'multiselect'),
  );
  readonly tokenOptions = computed(() => {
    const g = this.governs();
    return [{ value: '', label: 'Sin llenar' }, ...(g ? gateTokenOptions(g.operation) : [])];
  });

  private commit(next: WorkflowGovernsDef | undefined): void {
    this.store.patchDefinition({ governs: next });
  }

  setEnabled(on: boolean): void {
    this.commit(on ? { operation: WORKFLOW_GATE_OPERATION_KEYS[0] } : undefined);
  }

  setOperation(value: string | number | null): void {
    const operation = WORKFLOW_GATE_OPERATION_KEYS.find((op: WorkflowGateOperation) => op === value);
    const current = this.governs();
    if (!operation || !current) return;
    // Tokens of the previous operation do not exist in the new one: drop the map.
    this.commit({
      operation,
      ...(current.min_amount !== undefined ? { min_amount: current.min_amount } : {}),
    });
  }

  setMinAmount(raw: unknown): void {
    const current = this.governs();
    if (!current) return;
    const { min_amount: _old, ...rest } = current;
    const parsed = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
    this.commit(Number.isFinite(parsed) && parsed >= 0 ? { ...rest, min_amount: parsed } : rest);
  }

  setMap(field: string, token: string | number | null): void {
    const current = this.governs();
    if (!current) return;
    const { [field]: _old, ...others } = current.map ?? {};
    const map = token ? { ...others, [field]: String(token) } : others;
    const { map: _m, ...base } = current;
    this.commit(Object.keys(map).length > 0 ? { ...base, map } : base);
  }
}
