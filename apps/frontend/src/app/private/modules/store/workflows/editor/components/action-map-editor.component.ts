import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../shared/components/index';
import {
  WORKFLOW_ACTION_CATALOG,
  WorkflowActionInputSpec,
  WorkflowActionMapValue,
  WorkflowAssigneeDef,
  WorkflowFieldDef,
  WorkflowVendixActionName,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { actionTokenOptions } from '../workflow-editor-triggers.utils';
import { AssigneeEditorComponent } from './assignee-editor.component';
import { HttpActionEditorComponent } from './http-action/http-action-editor.component';

const LITERAL = '__literal__';
const NONE = '__none__';

const TYPE_HINT: Partial<Record<WorkflowActionInputSpec['type'], string>> = {
  id: 'Identificador numérico del registro',
  int: 'Número entero',
  number: 'Número',
  money: 'Monto',
  date: 'Fecha AAAA-MM-DD',
  boolean: 'Verdadero o falso',
};

interface MapKey {
  name: string;
  spec: WorkflowActionInputSpec;
}

/** `map` editor of a Vendix action: each key takes a token, a fixed text or nothing. */
@Component({
  selector: 'app-action-map-editor',
  standalone: true,
  imports: [FormsModule, ButtonComponent, InputComponent, SelectorComponent, AssigneeEditorComponent, HttpActionEditorComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="action-map">
      @if (action() === 'vendix.http.request') {
        <app-http-action-editor
          [map]="map()"
          [outputMap]="outputMap()"
          [fields]="fields()"
          (mapChange)="mapChange.emit($event)"
          (outputMapChange)="outputMapChange.emit($event)"
        />
      } @else {
      @for (key of keys(); track key.name) {
        @if (key.spec.type === 'assignee') {
          <div class="flex flex-col gap-2">
            <app-assignee-editor
              [label]="label(key)"
              [value]="assigneeOf(key.name)"
              [fields]="fields()"
              (valueChange)="setValue(key.name, $event)"
            />
            @if (assigneeOf(key.name)) {
              <div>
                <app-button variant="outline" size="xsm" (clicked)="setValue(key.name, undefined)">Quitar responsable</app-button>
              </div>
            }
          </div>
        } @else if (key.spec.type === 'enum') {
          <app-selector
            size="sm"
            [label]="label(key)"
            [options]="enumOptions(key)"
            [value]="enumValue(key.name)"
            (valueChange)="setEnum(key.name, $event)"
          />
        } @else {
          <div class="flex flex-col gap-2">
            <app-selector
              size="sm"
              [label]="label(key)"
              [options]="optionsFor(key.spec.required === true)"
              [value]="modeOf(key.name)"
              (valueChange)="setMode(key.name, $event)"
            />
            @if (hint(key); as text) {
              <p class="text-xs text-text-secondary">{{ text }}</p>
            }
            @if (modeOf(key.name) === literal) {
              <app-input
                size="sm"
                label="Texto fijo"
                [ngModel]="literalText(key.name)"
                (ngModelChange)="setValue(key.name, $event)"
              />
            }
          </div>
        }
      }
      }
    </div>
  `,
})
export class ActionMapEditorComponent {
  readonly action = input.required<WorkflowVendixActionName>();
  readonly map = input<Record<string, WorkflowActionMapValue>>({});
  readonly fields = input<WorkflowFieldDef[]>([]);
  /** P3.2: response mapping of `vendix.http.request` (field ← path). */
  readonly outputMap = input<Record<string, string> | undefined>(undefined);
  readonly mapChange = output<Record<string, WorkflowActionMapValue>>();
  readonly outputMapChange = output<Record<string, string> | undefined>();

  readonly literal = LITERAL;
  /** Keys the user switched to "Texto fijo" but has not typed yet. */
  private readonly pendingLiteral = signal<ReadonlySet<string>>(new Set());

  /** Every input of the registry entry: required first, then optional. */
  readonly keys = computed<MapKey[]>(() => {
    const inputs = WORKFLOW_ACTION_CATALOG[this.action()].inputs as Record<string, WorkflowActionInputSpec>;
    const all = Object.entries(inputs).map(([name, spec]) => ({ name, spec }));
    return [...all.filter((k) => k.spec.required === true), ...all.filter((k) => k.spec.required !== true)];
  });
  private readonly tokens = computed(() => actionTokenOptions(this.fields()));

  assigneeOf(name: string): WorkflowAssigneeDef | undefined {
    const value = this.map()[name];
    return typeof value === 'object' ? (value as WorkflowAssigneeDef) : undefined;
  }

  label(key: MapKey): string {
    return `${key.spec.label}${key.spec.required === true ? ' *' : ''}`;
  }

  hint(key: MapKey): string {
    return TYPE_HINT[key.spec.type] ?? '';
  }

  enumOptions(key: MapKey): { value: string; label: string }[] {
    return [
      { value: NONE, label: key.spec.required === true ? 'Elige un valor' : 'Sin valor' },
      ...(key.spec.values ?? []).map((v) => ({ value: v, label: v })),
    ];
  }

  enumValue(name: string): string {
    const value = this.map()[name];
    return typeof value === 'string' ? value : NONE;
  }

  setEnum(name: string, value: string | number | null): void {
    const next = String(value ?? NONE);
    this.setValue(name, next === NONE ? undefined : next);
  }

  optionsFor(required: boolean): { value: string; label: string }[] {
    return [
      { value: NONE, label: required ? 'Elige un valor' : 'Sin valor' },
      { value: LITERAL, label: 'Texto fijo' },
      ...this.tokens(),
    ];
  }

  modeOf(name: string): string {
    const value = this.map()[name];
    if (value === undefined) return this.pendingLiteral().has(name) ? LITERAL : NONE;
    if (typeof value === 'string' && this.tokens().some((t) => t.value === value)) return value;
    return LITERAL;
  }

  literalText(name: string): string {
    const value = this.map()[name];
    return value === undefined || typeof value === 'object' ? '' : String(value);
  }

  setMode(name: string, mode: string | number | null): void {
    const next = String(mode ?? NONE);
    this.pendingLiteral.update((current) => {
      const copy = new Set(current);
      if (next === LITERAL) copy.add(name);
      else copy.delete(name);
      return copy;
    });
    if (next === LITERAL) {
      const current = this.map()[name];
      if (typeof current === 'string' && this.tokens().some((t) => t.value === current)) {
        this.setValue(name, '');
      }
      return;
    }
    this.setValue(name, next === NONE ? undefined : next);
  }

  setValue(name: string, value: WorkflowActionMapValue | undefined): void {
    const { [name]: _old, ...rest } = this.map();
    this.mapChange.emit(value === undefined ? rest : { ...rest, [name]: value });
  }
}
