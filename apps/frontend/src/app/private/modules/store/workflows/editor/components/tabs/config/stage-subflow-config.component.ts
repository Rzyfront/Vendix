import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../../../shared/components/index';
import {
  WORKFLOW_LIMITS,
  WorkflowStageDef,
  WorkflowSubflowChildDef,
  WorkflowSubflowDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../../workflow-editor.store';
import { WorkflowEditorLookups } from '../../../workflow-editor-lookups.service';
import { actionTokenOptions } from '../../../workflow-editor-triggers.utils';
import { removeAt, replaceAt } from '../../../workflow-editor.utils';

interface MapRow {
  child: string;
  template: string;
}

/** First `campo_N` no row uses yet. */
export function freeKey(rows: MapRow[]): string {
  const used = new Set(rows.map((r) => r.child));
  let n = rows.length + 1;
  while (used.has(`campo_${n}`)) n++;
  return `campo_${n}`;
}

/** Configuración of a Subflujo stage: child flows, their inputs and the values brought back. */
@Component({
  selector: 'app-stage-subflow-config',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, InputComponent, SelectorComponent, ToggleComponent],
  template: `
    <div class="flex flex-col gap-4">
      <p class="text-xs text-text-secondary">
        Lanza una o varias solicitudes hijas de otros flujos de la tienda. Pásales datos y, si esperas a que terminen, trae sus resultados.
      </p>

      @for (child of flows(); track $index; let i = $index) {
        <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="subflow-child">
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <app-selector
                label="Flujo hijo"
                placeholder="Elige un flujo"
                [searchable]="true"
                [options]="flowOptions()"
                [value]="child.flow_key || null"
                (valueChange)="setFlow(i, $event)"
              />
            </div>
            <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar flujo hijo" [disabled]="flows().length <= 1" (clicked)="removeFlow(i)">
              <app-icon name="trash-2" [size]="12" slot="icon" />
            </app-button>
          </div>

          <p class="text-xs font-semibold text-text-primary">Datos que recibe el hijo</p>
          @for (row of mapRows(child); track $index; let r = $index) {
            <div class="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-end">
              <div class="sm:w-1/3">
                <app-input
                  label="Campo del hijo"
                  [ngModel]="row.child"
                  [error]="keyError()?.flow === i && keyError()?.row === r ? keyError()!.message : undefined"
                  (ngModelChange)="setMapRow(i, r, { child: $event })"
                />
              </div>
              <div class="min-w-0 flex-1">
                <app-input label="Valor (puedes usar datos de esta solicitud)" [ngModel]="row.template" (ngModelChange)="setMapRow(i, r, { template: $event })" />
              </div>
              <div class="sm:w-48">
                <app-selector
                  label="Insertar dato"
                  size="sm"
                  placeholder="Elige"
                  [options]="tokens()"
                  [value]="null"
                  (valueChange)="insertToken(i, r, $event)"
                />
              </div>
              <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar dato" (clicked)="removeMapRow(i, r)">
                <app-icon name="x" [size]="12" slot="icon" />
              </app-button>
            </div>
          }
          <div>
            <app-button variant="outline" size="sm" (clicked)="addMapRow(i)">
              <app-icon name="plus" [size]="14" slot="icon" />
              Pasar un dato
            </app-button>
          </div>
        </div>
      }
      <div>
        <app-button variant="outline" size="sm" [disabled]="flows().length >= maxFlows" (clicked)="addFlow()">
          <app-icon name="plus" [size]="14" slot="icon" />
          Agregar otro flujo hijo
        </app-button>
      </div>

      <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
        <app-toggle label="Esperar a que terminen" [checked]="waits()" (toggled)="setWait($event)" />
        @if (waits()) {
          <p class="text-xs text-text-secondary">
            Sale por «Completada» cuando todos los hijos se completan y por «Rechazada» si alguno se rechaza, cancela o falla.
          </p>
          <p class="text-xs font-semibold text-text-primary">Datos que trae de vuelta</p>
          @for (row of outputRows(); track $index; let o = $index) {
            <div class="flex flex-col gap-2 rounded-lg border border-border p-2 sm:flex-row sm:items-end">
              <div class="sm:w-1/2">
                <app-selector
                  label="Campo de esta solicitud"
                  size="sm"
                  placeholder="Elige un campo"
                  [options]="fieldOptions()"
                  [value]="row.child || null"
                  [errorText]="outputError()?.row === o ? outputError()!.message : ''"
                  (valueChange)="setOutputRow(o, { child: str($event) })"
                />
              </div>
              <div class="min-w-0 flex-1">
                <app-input
                  label="Viene de (flujo.campo)"
                  [ngModel]="row.template"
                  helperText="Ejemplo: alta-proveedor.nit"
                  (ngModelChange)="setOutputRow(o, { template: $event })"
                />
              </div>
              <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar dato de vuelta" (clicked)="removeOutputRow(o)">
                <app-icon name="x" [size]="12" slot="icon" />
              </app-button>
            </div>
          }
          <div>
            <app-button variant="outline" size="sm" [disabled]="fieldOptions().length === 0" (clicked)="addOutputRow()">
              <app-icon name="plus" [size]="14" slot="icon" />
              Traer un dato
            </app-button>
          </div>
        } @else {
          <p class="text-xs text-text-secondary">La solicitud sigue de inmediato, sin esperar a los hijos.</p>
        }
      </div>
    </div>
  `,
})
export class StageSubflowConfigComponent {
  protected readonly store = inject(WorkflowEditorStore);
  private readonly lookups = inject(WorkflowEditorLookups);
  readonly stage = input.required<WorkflowStageDef>();

  readonly maxFlows = WORKFLOW_LIMITS.maxSubflows;
  readonly subflow = computed<WorkflowSubflowDef>(() => this.stage().subflow ?? { flows: [] });
  readonly flows = computed(() => this.subflow().flows);
  readonly waits = computed(() => this.subflow().wait !== false);
  readonly flowOptions = computed(() => {
    const own = this.store.draft()?.key;
    return this.lookups.flows().filter((f) => f.value !== own);
  });
  readonly fields = computed(() => this.store.draft()?.fields ?? []);
  /** Rename refused because the key is taken (the row keeps its previous key). */
  readonly keyError = signal<{ flow: number; row: number; message: string } | null>(null);
  readonly outputError = signal<{ row: number; message: string } | null>(null);
  readonly fieldOptions = computed(() => this.fields().map((f) => ({ value: f.key, label: f.label })));
  readonly tokens = computed(() => actionTokenOptions(this.fields()));
  /** Rows of `output`: parent field ← "flujo.campo" (reusing MapRow: child = parent field). */
  readonly outputRows = computed<MapRow[]>(() =>
    Object.entries(this.subflow().output ?? {}).map(([child, template]) => ({ child, template })),
  );

  str(v: string | number | null): string {
    return v === null ? '' : String(v);
  }

  mapRows(child: WorkflowSubflowChildDef): MapRow[] {
    return Object.entries(child.map ?? {}).map(([c, template]) => ({ child: c, template }));
  }

  private set(next: WorkflowSubflowDef): void {
    this.store.updateStage(this.stage().key, (s) => ({ ...s, subflow: next }));
  }

  private rowsToMap(rows: MapRow[]): Record<string, string> {
    return Object.fromEntries(rows.map((r) => [r.child, r.template]));
  }

  private setChild(index: number, child: WorkflowSubflowChildDef): void {
    this.set({ ...this.subflow(), flows: replaceAt(this.flows(), index, child) });
  }

  private setChildRows(index: number, rows: MapRow[]): void {
    const { map: _map, ...base } = this.flows()[index];
    this.setChild(index, rows.length > 0 ? { ...base, map: this.rowsToMap(rows) } : base);
  }

  addFlow(): void {
    this.set({ ...this.subflow(), flows: [...this.flows(), { flow_key: '' }] });
  }

  removeFlow(index: number): void {
    this.set({ ...this.subflow(), flows: removeAt(this.flows(), index) });
  }

  setFlow(index: number, key: string | number | null): void {
    this.setChild(index, { ...this.flows()[index], flow_key: this.str(key) });
  }

  addMapRow(index: number): void {
    const rows = this.mapRows(this.flows()[index]);
    this.setChildRows(index, [...rows, { child: freeKey(rows), template: '' }]);
  }

  /** A child field name already used by another row is refused with a message (a map has unique keys). */
  setMapRow(index: number, row: number, change: Partial<MapRow>): void {
    const rows = this.mapRows(this.flows()[index]);
    if (change.child !== undefined && rows.some((r, j) => j !== row && r.child === change.child)) {
      this.keyError.set({ flow: index, row, message: `El campo "${change.child}" ya recibe un dato.` });
      return;
    }
    this.keyError.set(null);
    this.setChildRows(index, replaceAt(rows, row, { ...rows[row], ...change }));
  }

  removeMapRow(index: number, row: number): void {
    this.keyError.set(null);
    this.setChildRows(index, removeAt(this.mapRows(this.flows()[index]), row));
  }

  insertToken(index: number, row: number, token: string | number | null): void {
    if (token === null) return;
    const rows = this.mapRows(this.flows()[index]);
    this.setChildRows(index, replaceAt(rows, row, { ...rows[row], template: `${rows[row].template}${token}` }));
  }

  setWait(wait: boolean): void {
    const { output: _output, wait: _wait, ...rest } = this.subflow();
    this.set(wait ? { ...rest, wait: true, ...(this.subflow().output ? { output: this.subflow().output } : {}) } : { ...rest, wait: false });
  }

  private setOutput(rows: MapRow[]): void {
    const { output: _output, ...rest } = this.subflow();
    this.set(rows.length > 0 ? { ...rest, output: this.rowsToMap(rows) } : rest);
  }

  addOutputRow(): void {
    const used = new Set(this.outputRows().map((r) => r.child));
    const field = this.fields().find((f) => !used.has(f.key));
    if (!field) return;
    this.setOutput([...this.outputRows(), { child: field.key, template: '' }]);
  }

  setOutputRow(index: number, change: Partial<MapRow>): void {
    const rows = this.outputRows();
    if (change.child !== undefined && rows.some((r, j) => j !== index && r.child === change.child)) {
      this.outputError.set({ row: index, message: 'Ese campo ya trae un dato de vuelta.' });
      return;
    }
    this.outputError.set(null);
    this.setOutput(replaceAt(this.outputRows(), index, { ...this.outputRows()[index], ...change }));
  }

  removeOutputRow(index: number): void {
    this.outputError.set(null);
    this.setOutput(removeAt(this.outputRows(), index));
  }
}
