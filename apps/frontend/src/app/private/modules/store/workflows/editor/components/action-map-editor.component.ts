import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../shared/components/index';
import {
  WORKFLOW_VENDIX_ACTION_MAP_KEYS,
  WorkflowActionMapValue,
  WorkflowAssigneeDef,
  WorkflowFieldDef,
  WorkflowVendixActionName,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { ACTION_MAP_KEY_LABEL, actionTokenOptions } from '../workflow-editor-triggers.utils';
import { AssigneeEditorComponent } from './assignee-editor.component';

const LITERAL = '__literal__';
const NONE = '__none__';

/** `map` editor of a Vendix action: each key takes a token, a fixed text or nothing. */
@Component({
  selector: 'app-action-map-editor',
  standalone: true,
  imports: [FormsModule, ButtonComponent, InputComponent, SelectorComponent, AssigneeEditorComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="action-map">
      @for (key of keys(); track key.name) {
        @if (key.name === 'assignee') {
          <div class="flex flex-col gap-2">
            <app-assignee-editor
              label="Responsable (opcional)"
              [value]="assignee()"
              [fields]="fields()"
              (valueChange)="setValue('assignee', $event)"
            />
            @if (assignee()) {
              <div>
                <app-button variant="outline" size="xsm" (clicked)="setValue('assignee', undefined)">Quitar responsable</app-button>
              </div>
            }
          </div>
        } @else {
          <div class="flex flex-col gap-2">
            <app-selector
              size="sm"
              [label]="label(key.name, key.required)"
              [options]="optionsFor(key.required)"
              [value]="modeOf(key.name)"
              (valueChange)="setMode(key.name, $event)"
            />
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
    </div>
  `,
})
export class ActionMapEditorComponent {
  readonly action = input.required<WorkflowVendixActionName>();
  readonly map = input<Record<string, WorkflowActionMapValue>>({});
  readonly fields = input<WorkflowFieldDef[]>([]);
  readonly mapChange = output<Record<string, WorkflowActionMapValue>>();

  readonly literal = LITERAL;
  /** Keys the user switched to "Texto fijo" but has not typed yet. */
  private readonly pendingLiteral = signal<ReadonlySet<string>>(new Set());

  readonly keys = computed(() => {
    const def = WORKFLOW_VENDIX_ACTION_MAP_KEYS[this.action()];
    return [
      ...def.required.map((name) => ({ name, required: true })),
      ...def.optional.map((name) => ({ name, required: false })),
    ];
  });
  private readonly tokens = computed(() => actionTokenOptions(this.fields()));
  readonly assignee = computed(() => {
    const value = this.map()['assignee'];
    return typeof value === 'object' ? (value as WorkflowAssigneeDef) : undefined;
  });

  label(name: string, required: boolean): string {
    return `${ACTION_MAP_KEY_LABEL[name] ?? name}${required ? ' *' : ''}`;
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
