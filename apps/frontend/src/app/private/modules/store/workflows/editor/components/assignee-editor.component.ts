import { Component, computed, inject, input, output } from '@angular/core';
import { SelectorComponent, StoreUserSelectComponent } from '../../../../../../shared/components/index';
import {
  WorkflowAssigneeDef,
  WorkflowFieldDef,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorLookups } from '../workflow-editor-lookups.service';

type Kind = WorkflowAssigneeDef['kind'];
type Strategy = 'any' | 'round_robin' | 'least_load';

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'initiator', label: 'Quien inició la solicitud' },
  { value: 'role', label: 'Un rol' },
  { value: 'group', label: 'Un grupo de trabajo' },
  { value: 'user', label: 'Una persona' },
  { value: 'field', label: 'Persona de un campo del formulario' },
];

const STRATEGY_OPTIONS: { value: Strategy; label: string }[] = [
  { value: 'any', label: 'Cualquier miembro puede tomarla' },
  { value: 'round_robin', label: 'Por turnos' },
  { value: 'least_load', label: 'A quien tenga menos tareas' },
];

/** Picks who is responsible: initiator, role, group (+strategy), person or form field. */
@Component({
  selector: 'app-assignee-editor',
  standalone: true,
  imports: [SelectorComponent, StoreUserSelectComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="assignee-editor">
      <app-selector
        [label]="label()"
        placeholder="Elige quién responde"
        [options]="kindOptions"
        [value]="value()?.kind ?? null"
        (valueChange)="onKind($event)"
      />
      @switch (value()?.kind) {
        @case ('role') {
          <app-selector
            label="Rol"
            placeholder="Elige un rol"
            [searchable]="true"
            [options]="lookups.roles()"
            [value]="roleKey()"
            (valueChange)="set({ kind: 'role', role_key: str($event) })"
          />
        }
        @case ('group') {
          <app-selector
            label="Grupo de trabajo"
            placeholder="Elige un grupo"
            [options]="lookups.groups()"
            [value]="groupKey()"
            (valueChange)="onGroup($event)"
          />
          <app-selector
            label="Cómo se reparte"
            [options]="strategyOptions"
            [value]="strategy()"
            (valueChange)="onStrategy($event)"
          />
        }
        @case ('user') {
          <div class="flex flex-col gap-1">
            <span class="text-xs font-semibold text-text-primary">Persona</span>
            <app-store-user-select [value]="userId()" (valueChange)="onUser($event)" />
          </div>
        }
        @case ('field') {
          <app-selector
            label="Campo con la persona"
            placeholder="Elige un campo de tipo persona"
            [options]="userFieldOptions()"
            [value]="fieldKey()"
            helpText="Solo se listan campos de tipo «Persona del equipo»."
            (valueChange)="set({ kind: 'field', field: str($event) })"
          />
        }
      }
    </div>
  `,
})
export class AssigneeEditorComponent {
  protected readonly lookups = inject(WorkflowEditorLookups);

  readonly value = input<WorkflowAssigneeDef | undefined>(undefined);
  readonly fields = input<WorkflowFieldDef[]>([]);
  readonly label = input('Responsable');
  readonly valueChange = output<WorkflowAssigneeDef>();

  readonly kindOptions = KIND_OPTIONS;
  readonly strategyOptions = STRATEGY_OPTIONS;

  readonly roleKey = computed(() => {
    const v = this.value();
    return v?.kind === 'role' ? v.role_key : null;
  });
  readonly groupKey = computed(() => {
    const v = this.value();
    return v?.kind === 'group' ? v.group_key : null;
  });
  readonly strategy = computed<Strategy>(() => {
    const v = this.value();
    return v?.kind === 'group' ? (v.strategy ?? 'any') : 'any';
  });
  readonly userId = computed(() => {
    const v = this.value();
    return v?.kind === 'user' ? v.user_id : null;
  });
  readonly fieldKey = computed(() => {
    const v = this.value();
    return v?.kind === 'field' ? v.field : null;
  });
  readonly userFieldOptions = computed(() =>
    this.fields()
      .filter((f) => f.type === 'user')
      .map((f) => ({ value: f.key, label: f.label })),
  );

  str(v: string | number | null): string {
    return v === null ? '' : String(v);
  }

  set(next: WorkflowAssigneeDef): void {
    this.valueChange.emit(next);
  }

  onKind(kind: string | number | null): void {
    switch (kind as Kind) {
      case 'role':
        return this.set({ kind: 'role', role_key: '' });
      case 'group':
        return this.set({ kind: 'group', group_key: '', strategy: 'any' });
      case 'user':
        return this.set({ kind: 'user', user_id: 0 });
      case 'field':
        return this.set({ kind: 'field', field: '' });
      default:
        return this.set({ kind: 'initiator' });
    }
  }

  onGroup(key: string | number | null): void {
    this.set({ kind: 'group', group_key: this.str(key), strategy: this.strategy() });
  }

  onStrategy(strategy: string | number | null): void {
    this.set({ kind: 'group', group_key: this.groupKey() ?? '', strategy: strategy as Strategy });
  }

  onUser(id: number | null): void {
    this.set({ kind: 'user', user_id: id ?? 0 });
  }
}
