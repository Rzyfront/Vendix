import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
} from '../../../../../../shared/components/index';
import {
  OPS_BY_FIELD_TYPE,
  VALUELESS_OPS,
  WORKFLOW_LIMITS,
  WorkflowConditionGroup,
  WorkflowConditionNode,
  WorkflowConditionOp,
  WorkflowConditionRule,
  WorkflowFieldDef,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { OP_TEXT, groupChildren, groupMode } from '../workflow-editor.utils';

type RuleValue = WorkflowConditionRule['value'];

const MODE_OPTIONS = [
  { value: 'all', label: 'Todas (se cumplen todas)' },
  { value: 'any', label: 'Alguna (basta con una)' },
];

/** One level of the condition tree; renders nested groups with itself. */
@Component({
  selector: 'app-condition-group',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, InputComponent, MultiSelectorComponent, SelectorComponent],
  template: `
    <div class="flex flex-col gap-3 rounded-xl border p-3" [class]="depth() > 1 ? 'border-primary/25 bg-primary/5' : 'border-border bg-surface'">
      <div class="flex items-end gap-2">
        <div class="min-w-0 flex-1">
          <app-selector
            label="Se cumplen"
            size="sm"
            [options]="modeOptions"
            [value]="mode()"
            (valueChange)="setMode($event)"
          />
        </div>
        @if (removable()) {
          <app-button variant="outline-danger" size="sm" ariaLabel="Quitar grupo" (clicked)="removed.emit()">
            <app-icon name="trash-2" [size]="14" slot="icon" />
          </app-button>
        }
      </div>

      @for (node of children(); track $index) {
        @if (isGroup(node)) {
          <app-condition-group
            [group]="asGroup(node)"
            [depth]="depth() + 1"
            [fields]="fields()"
            [removable]="true"
            (groupChange)="setChild($index, $event)"
            (removed)="removeChild($index)"
          />
        } @else {
          <div class="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" data-testid="condition-row">
            <app-selector
              label="Campo"
              size="sm"
              [options]="fieldOptions()"
              [value]="asRule(node).field"
              (valueChange)="setField($index, $event)"
            />
            <app-selector
              label="Operador"
              size="sm"
              [options]="opOptions(asRule(node))"
              [value]="asRule(node).op"
              (valueChange)="setOp($index, $event)"
            />
            <div class="min-w-0">
              @if (needsValue(asRule(node))) {
                @switch (valueKind(asRule(node))) {
                  @case ('multi') {
                    <app-multi-selector
                      label="Valor"
                      size="sm"
                      [options]="optionsOf(asRule(node))"
                      [ngModel]="asArray(asRule(node).value)"
                      (ngModelChange)="setValue($index, $event)"
                    />
                  }
                  @case ('single') {
                    <app-selector
                      label="Valor"
                      size="sm"
                      [options]="optionsOf(asRule(node))"
                      [value]="asScalar(asRule(node).value)"
                      (valueChange)="setValue($index, $event)"
                    />
                  }
                  @case ('number') {
                    <app-input
                      label="Valor"
                      type="number"
                      size="sm"
                      [ngModel]="asScalar(asRule(node).value)"
                      (ngModelChange)="setNumber($index, $event)"
                    />
                  }
                  @case ('date') {
                    <app-input
                      label="Valor"
                      type="date"
                      size="sm"
                      [ngModel]="asScalar(asRule(node).value)"
                      (ngModelChange)="setValue($index, $event)"
                    />
                  }
                  @case ('list') {
                    <app-input
                      label="Valores (separados por coma)"
                      size="sm"
                      [ngModel]="asArray(asRule(node).value).join(', ')"
                      (ngModelChange)="setList($index, $event)"
                    />
                  }
                  @default {
                    <app-input
                      label="Valor"
                      size="sm"
                      [ngModel]="asScalar(asRule(node).value)"
                      (ngModelChange)="setValue($index, $event)"
                    />
                  }
                }
              }
            </div>
            <app-button variant="outline-danger" size="sm" ariaLabel="Quitar regla" (clicked)="removeChild($index)">
              <app-icon name="trash-2" [size]="14" slot="icon" />
            </app-button>
          </div>
        }
      }

      <div class="flex flex-wrap gap-2">
        <app-button variant="outline" size="sm" (clicked)="addRule()">
          <app-icon name="plus" [size]="14" slot="icon" />
          Agregar regla
        </app-button>
        @if (depth() < maxDepth) {
          <app-button variant="outline" size="sm" (clicked)="addGroup()">
            <app-icon name="layers" [size]="14" slot="icon" />
            Agregar grupo
          </app-button>
        }
      </div>
    </div>
  `,
})
export class ConditionGroupComponent {
  readonly group = input.required<WorkflowConditionGroup>();
  readonly fields = input.required<WorkflowFieldDef[]>();
  readonly depth = input(1);
  readonly removable = input(false);
  readonly groupChange = output<WorkflowConditionGroup>();
  readonly removed = output<void>();

  readonly modeOptions = MODE_OPTIONS;
  readonly maxDepth = WORKFLOW_LIMITS.maxConditionDepth;
  readonly mode = computed(() => groupMode(this.group()));
  readonly children = computed(() => groupChildren(this.group()));
  readonly fieldOptions = computed(() =>
    this.fields().map((f) => ({ value: f.key, label: f.label || f.key })),
  );

  isGroup(node: WorkflowConditionNode): boolean {
    return 'all' in node || 'any' in node;
  }
  asGroup(node: WorkflowConditionNode): WorkflowConditionGroup {
    return node as WorkflowConditionGroup;
  }
  asRule(node: WorkflowConditionNode): WorkflowConditionRule {
    return node as WorkflowConditionRule;
  }
  asArray(value: RuleValue): (string | number)[] {
    return Array.isArray(value) ? value : [];
  }
  asScalar(value: RuleValue): string | number | null {
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  }

  private fieldOf(rule: WorkflowConditionRule): WorkflowFieldDef | undefined {
    return this.fields().find((f) => f.key === rule.field);
  }

  opsOf(rule: WorkflowConditionRule): readonly WorkflowConditionOp[] {
    const field = this.fieldOf(rule);
    return field ? OPS_BY_FIELD_TYPE[field.type] : [];
  }

  opOptions(rule: WorkflowConditionRule): { value: string; label: string }[] {
    return this.opsOf(rule).map((op) => ({ value: op, label: OP_TEXT[op] }));
  }

  optionsOf(rule: WorkflowConditionRule): { value: string; label: string }[] {
    return this.fieldOf(rule)?.options ?? [];
  }

  needsValue(rule: WorkflowConditionRule): boolean {
    return !VALUELESS_OPS.includes(rule.op);
  }

  valueKind(rule: WorkflowConditionRule): 'multi' | 'single' | 'number' | 'date' | 'list' | 'text' {
    const type = this.fieldOf(rule)?.type;
    const isList = rule.op === 'in' || rule.op === 'not_in';
    if (type === 'select' || type === 'multiselect') return isList ? 'multi' : 'single';
    if (type === 'number' || type === 'money' || type === 'user') return 'number';
    if (type === 'date') return 'date';
    return isList ? 'list' : 'text';
  }

  // ─── Edits (immutable) ────────────────────────────────────────────

  private emit(mode: 'all' | 'any', children: WorkflowConditionNode[]): void {
    this.groupChange.emit(mode === 'all' ? { all: children } : { any: children });
  }

  private patchChild(index: number, node: WorkflowConditionNode): void {
    this.emit(
      this.mode(),
      this.children().map((c, i) => (i === index ? node : c)),
    );
  }

  setMode(value: string | number | null): void {
    this.emit(value === 'any' ? 'any' : 'all', this.children());
  }

  addRule(): void {
    const first = this.fields()[0];
    if (!first) return;
    const op = OPS_BY_FIELD_TYPE[first.type][0];
    this.emit(this.mode(), [...this.children(), { field: first.key, op }]);
  }

  addGroup(): void {
    this.emit(this.mode(), [...this.children(), { all: [] }]);
  }

  setChild(index: number, group: WorkflowConditionGroup): void {
    this.patchChild(index, group);
  }

  removeChild(index: number): void {
    this.emit(
      this.mode(),
      this.children().filter((_, i) => i !== index),
    );
  }

  setField(index: number, key: string | number | null): void {
    const field = this.fields().find((f) => f.key === key);
    if (!field) return;
    this.patchChild(index, { field: field.key, op: OPS_BY_FIELD_TYPE[field.type][0] });
  }

  setOp(index: number, op: string | number | null): void {
    const rule = this.children()[index] as WorkflowConditionRule;
    const next: WorkflowConditionRule = { field: rule.field, op: op as WorkflowConditionOp };
    const listBefore = rule.op === 'in' || rule.op === 'not_in';
    const listAfter = op === 'in' || op === 'not_in';
    if (!VALUELESS_OPS.includes(next.op) && listBefore === listAfter && rule.value !== undefined) {
      next.value = rule.value;
    }
    this.patchChild(index, next);
  }

  setValue(index: number, value: unknown): void {
    const rule = this.children()[index] as WorkflowConditionRule;
    this.patchChild(index, { ...rule, value: value as RuleValue });
  }

  setNumber(index: number, raw: unknown): void {
    const parsed = Number(String(raw).replace(',', '.'));
    const rule = this.children()[index] as WorkflowConditionRule;
    if (raw === '' || raw === null || !Number.isFinite(parsed)) {
      const { value: _value, ...rest } = rule;
      this.patchChild(index, rest);
      return;
    }
    this.patchChild(index, { ...rule, value: parsed });
  }

  setList(index: number, raw: string): void {
    const items = raw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    this.setValue(index, items);
  }
}
