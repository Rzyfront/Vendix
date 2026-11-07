import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import {
  WORKFLOW_LIMITS,
  WORKFLOW_VENDIX_ACTIONS,
  WorkflowActionDef,
  WorkflowAssigneeDef,
  WorkflowFieldDef,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { removeAt, replaceAt } from '../../workflow-editor.utils';
import { vendixActionOptions } from '../../workflow-editor-triggers.utils';
import { ActionMapEditorComponent } from '../action-map-editor.component';
import { AssigneeEditorComponent } from '../assignee-editor.component';

type Hook = 'on_enter' | 'on_exit';

const HOOKS: { id: Hook; title: string; hint: string }[] = [
  { id: 'on_enter', title: 'Al entrar a la etapa', hint: 'Se ejecutan cuando la solicitud llega aquí.' },
  { id: 'on_exit', title: 'Al salir de la etapa', hint: 'Se ejecutan cuando la solicitud avanza.' },
];

/** Acciones tab: notify, set_field and Vendix actions for on_enter / on_exit. */
@Component({
  selector: 'app-stage-actions-tab',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
    AssigneeEditorComponent,
    ActionMapEditorComponent,
  ],
  template: `
    <div class="flex flex-col gap-6">
      @for (hook of hooks; track hook.id) {
        <section class="flex flex-col gap-3" [attr.aria-label]="hook.title">
          <div>
            <h3 class="text-sm font-bold text-text-primary">{{ hook.title }}</h3>
            <p class="text-xs text-text-secondary">{{ hook.hint }}</p>
          </div>
          @for (action of list(hook.id); track $index; let i = $index) {
            <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="action">
              <div class="flex items-end gap-2">
                <div class="min-w-0 flex-1">
                  <app-selector
                    label="Acción"
                    size="sm"
                    [options]="actionOptions"
                    [value]="action.action"
                    (valueChange)="setKind(hook.id, i, $event)"
                  />
                </div>
                <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar acción" (clicked)="remove(hook.id, i)">
                  <app-icon name="trash-2" [size]="12" slot="icon" />
                </app-button>
              </div>
              @if (action.action === 'notify') {
                <app-assignee-editor
                  label="Avisar a"
                  [value]="action.to"
                  [fields]="fields()"
                  (valueChange)="patch(hook.id, i, { to: $event })"
                />
                <app-textarea label="Mensaje" [rows]="2" [ngModel]="action.message" (ngModelChange)="patch(hook.id, i, { message: $event })" />
              } @else if (action.action === 'set_field') {
                <app-selector
                  label="Campo a cambiar"
                  size="sm"
                  [options]="fieldOptions()"
                  [value]="action.field"
                  (valueChange)="patch(hook.id, i, { field: $event, value: null })"
                />
                @switch (fieldType(action.field)) {
                  @case ('boolean') {
                    <app-toggle label="Valor" [checked]="action.value === true" (toggled)="patch(hook.id, i, { value: $event })" />
                  }
                  @case ('number') {
                    <app-input label="Valor" type="number" [ngModel]="action.value" (ngModelChange)="setNumber(hook.id, i, $event)" />
                  }
                  @case ('money') {
                    <app-input label="Valor" type="number" [ngModel]="action.value" (ngModelChange)="setNumber(hook.id, i, $event)" />
                  }
                  @default {
                    <app-input label="Valor" [ngModel]="action.value" (ngModelChange)="patch(hook.id, i, { value: $event })" />
                  }
                }
              } @else {
                <p class="text-xs text-text-secondary">Se ejecuta en segundo plano al publicar el cambio de etapa; no bloquea la solicitud.</p>
                <app-action-map-editor
                  [action]="action.action"
                  [map]="action.map"
                  [fields]="fields()"
                  (mapChange)="patch(hook.id, i, { map: $event })"
                />
              }
            </div>
          } @empty {
            <p class="text-sm text-text-secondary">Sin acciones.</p>
          }
          <div>
            <app-button variant="outline" size="sm" [disabled]="list(hook.id).length >= maxActions" (clicked)="add(hook.id)">
              <app-icon name="plus" [size]="14" slot="icon" />
              Agregar acción
            </app-button>
          </div>
        </section>
      }
    </div>
  `,
})
export class StageActionsTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly hooks = HOOKS;
  readonly maxActions = WORKFLOW_LIMITS.maxActionsPerHook;
  readonly actionOptions = [
    { value: 'notify', label: 'Enviar aviso' },
    { value: 'set_field', label: 'Cambiar un campo' },
    ...vendixActionOptions(),
  ];
  readonly fields = computed<WorkflowFieldDef[]>(() => this.store.draft()?.fields ?? []);
  readonly fieldOptions = computed(() => this.fields().map((f) => ({ value: f.key, label: f.label })));

  list(hook: Hook): WorkflowActionDef[] {
    return this.stage()[hook] ?? [];
  }

  fieldType(key: string): string | undefined {
    return this.fields().find((f) => f.key === key)?.type;
  }

  private set(hook: Hook, next: WorkflowActionDef[]): void {
    this.store.updateStage(this.stage().key, (s) => {
      const { [hook]: _h, ...rest } = s;
      return next.length > 0 ? { ...rest, [hook]: next } : rest;
    });
  }

  add(hook: Hook): void {
    this.set(hook, [...this.list(hook), { action: 'notify', to: { kind: 'initiator' }, message: '' }]);
  }

  remove(hook: Hook, index: number): void {
    this.set(hook, removeAt(this.list(hook), index));
  }

  setKind(hook: Hook, index: number, kind: string | number | null): void {
    const vendix = WORKFLOW_VENDIX_ACTIONS.find((a) => a === kind);
    const next: WorkflowActionDef = vendix
      ? { action: vendix, map: {} }
      : kind === 'set_field'
        ? { action: 'set_field', field: this.fields()[0]?.key ?? '', value: null }
        : { action: 'notify', to: { kind: 'initiator' }, message: '' };
    this.set(hook, replaceAt(this.list(hook), index, next));
  }

  patch(hook: Hook, index: number, change: Record<string, unknown>): void {
    const current = this.list(hook)[index];
    this.set(hook, replaceAt(this.list(hook), index, { ...current, ...change } as WorkflowActionDef));
  }

  setNumber(hook: Hook, index: number, raw: unknown): void {
    const parsed = Number(String(raw).replace(',', '.'));
    this.patch(hook, index, { value: raw === '' || raw === null || !Number.isFinite(parsed) ? null : parsed });
  }
}
