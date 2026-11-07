import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  WORKFLOW_TRIGGER_EVENTS,
  WorkflowTriggerDef,
  WorkflowTriggerEvent,
  describeCron,
  parseCron,
} from '../../../../../../shared/workflows/contract';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { removeAt, replaceAt } from '../workflow-editor.utils';
import { eventOptions, eventTokenOptions } from '../workflow-editor-triggers.utils';

type EventTrigger = Extract<WorkflowTriggerDef, { kind: 'event' }>;
type ScheduleTrigger = Extract<WorkflowTriggerDef, { kind: 'schedule' }>;

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Cada lunes 8 a. m.', cron: '0 8 * * 1' },
  { label: 'Todos los días 8 a. m.', cron: '0 8 * * *' },
  { label: 'Día 1 de cada mes', cron: '0 8 1 * *' },
];

/** "Disparadores": how a request of this flow can start (manual, public form, events). */
@Component({
  selector: 'app-triggers-panel',
  standalone: true,
  imports: [FormsModule, AlertBannerComponent, ButtonComponent, IconComponent, InputComponent, SelectorComponent, ToggleComponent],
  template: `
    <section class="flex flex-col gap-4" aria-label="Disparadores">
      <div>
        <h2 class="text-sm font-bold text-text-primary">Disparadores</h2>
        <p class="text-xs text-text-secondary">Define cómo puede empezar una solicitud de este flujo.</p>
      </div>

      <div class="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
        <p class="text-sm font-semibold text-text-primary">Manual</p>
        <p class="text-xs text-text-secondary">Siempre disponible: una persona inicia la solicitud desde Flujos.</p>
      </div>

      <div class="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
        <app-toggle label="Formulario público" [checked]="hasPublicForm()" (toggled)="setPublicForm($event)" />
        <p class="text-xs text-text-secondary">El enlace público se crea y se administra desde la lista de flujos (acción "Enlace público").</p>
      </div>

      <div class="flex flex-col gap-3">
        <p class="text-sm font-semibold text-text-primary">Programado</p>
        @for (trigger of schedules(); track $index; let i = $index) {
          <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="schedule-trigger">
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <app-input
                  label="Expresión cron (minuto hora día mes día-semana)"
                  [error]="cronError(trigger.cron)"
                  [ngModel]="trigger.cron"
                  (ngModelChange)="setCron(i, $event)"
                />
              </div>
              <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar programación" (clicked)="removeSchedule(i)">
                <app-icon name="trash-2" [size]="12" slot="icon" />
              </app-button>
            </div>
            <div class="flex flex-wrap gap-2" role="group" aria-label="Programaciones frecuentes">
              @for (preset of presets; track preset.cron) {
                <app-button variant="outline" size="xsm" (clicked)="setCron(i, preset.cron)">{{ preset.label }}</app-button>
              }
            </div>
            @if (!cronError(trigger.cron)) {
              <p class="text-xs text-text-secondary" data-testid="cron-preview">
                <app-icon name="clock" [size]="12" class="mr-1 inline" />{{ describe(trigger.cron) }}
              </p>
            }
          </div>
        } @empty {
          <p class="text-sm text-text-secondary">Sin programación: la solicitud no se crea sola.</p>
        }
        <div>
          <app-button variant="outline" size="sm" [disabled]="schedules().length >= maxSchedules" (clicked)="addSchedule()">
            <app-icon name="plus" [size]="14" slot="icon" />
            Agregar programación
          </app-button>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <p class="text-sm font-semibold text-text-primary">Por eventos del negocio</p>
        @if (events().length > 0 && startsWithInitiator()) {
          <app-alert-banner variant="warning" icon="alert-triangle" data-testid="trigger-initiator-hint">
            Un disparador por evento no tiene a nadie que inicie la solicitud: asigna la etapa inicial a un rol, un grupo, una persona o un campo (pestaña Responsable).
          </app-alert-banner>
        }
        @for (trigger of events(); track trigger.event; let i = $index) {
          <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="event-trigger">
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <app-selector
                  label="Cuando"
                  size="sm"
                  [options]="eventOptionsFor(trigger.event)"
                  [value]="trigger.event"
                  (valueChange)="setEvent(i, $event)"
                />
              </div>
              <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar disparador" (clicked)="remove(i)">
                <app-icon name="trash-2" [size]="12" slot="icon" />
              </app-button>
            </div>
            @if (mappableFields().length === 0) {
              <p class="text-xs text-text-secondary">Declara campos en el formulario para llenarlos con datos del evento.</p>
            } @else {
              <p class="text-xs font-semibold text-text-primary">Llenar campos con datos del evento</p>
              @for (field of mappableFields(); track field.key) {
                <app-selector
                  size="sm"
                  [label]="field.label"
                  [options]="tokenOptions(trigger.event)"
                  [value]="trigger.map?.[field.key] ?? ''"
                  (valueChange)="setMap(i, field.key, $event)"
                />
              }
            }
          </div>
        } @empty {
          <p class="text-sm text-text-secondary">Sin disparadores por evento.</p>
        }
        <div>
          <app-button variant="outline" size="sm" [disabled]="available().length === 0" (clicked)="add()">
            <app-icon name="plus" [size]="14" slot="icon" />
            Agregar disparador por evento
          </app-button>
        </div>
      </div>
    </section>
  `,
})
export class TriggersPanelComponent {
  protected readonly store = inject(WorkflowEditorStore);

  readonly triggers = computed<WorkflowTriggerDef[]>(() => this.store.draft()?.triggers ?? [{ kind: 'manual' }]);
  readonly events = computed(() => this.triggers().filter((t): t is EventTrigger => t.kind === 'event'));
  readonly schedules = computed(() => this.triggers().filter((t): t is ScheduleTrigger => t.kind === 'schedule'));
  readonly presets = CRON_PRESETS;
  /** Validator limit of schedule triggers per flow. */
  readonly maxSchedules = 5;
  readonly hasPublicForm = computed(() => this.triggers().some((t) => t.kind === 'public_form'));
  readonly available = computed(() => {
    const used = new Set(this.events().map((t) => t.event));
    return WORKFLOW_TRIGGER_EVENTS.filter((e) => !used.has(e));
  });
  /** File and multiselect fields cannot be filled by an event (validator rule). */
  readonly mappableFields = computed(() =>
    (this.store.draft()?.fields ?? []).filter((f) => f.type !== 'file' && f.type !== 'multiselect'),
  );
  readonly startsWithInitiator = computed(() => {
    const start = this.store.draft()?.stages.find((s) => s.start);
    return start?.assignee?.kind === 'initiator';
  });

  eventOptionsFor(current: WorkflowTriggerEvent): { value: string; label: string }[] {
    return eventOptions(WORKFLOW_TRIGGER_EVENTS.filter((e) => e === current || this.available().includes(e)));
  }

  tokenOptions(event: WorkflowTriggerEvent): { value: string; label: string }[] {
    return [{ value: '', label: 'Sin llenar' }, ...eventTokenOptions(event)];
  }

  describe(cron: string): string {
    return describeCron(cron);
  }

  cronError(cron: string): string | undefined {
    const parsed = parseCron(cron);
    return parsed.ok ? undefined : parsed.error;
  }

  private commit(
    events: EventTrigger[],
    publicForm = this.hasPublicForm(),
    schedules: ScheduleTrigger[] = this.schedules(),
  ): void {
    const existing = this.triggers().find((t) => t.kind === 'public_form');
    const next: WorkflowTriggerDef[] = [
      { kind: 'manual' },
      ...(publicForm ? [existing ?? ({ kind: 'public_form' } as WorkflowTriggerDef)] : []),
      ...schedules,
      ...events,
    ];
    this.store.patchDefinition({ triggers: next });
  }

  setPublicForm(on: boolean): void {
    this.commit(this.events(), on);
  }

  addSchedule(): void {
    this.commit(this.events(), this.hasPublicForm(), [...this.schedules(), { kind: 'schedule', cron: CRON_PRESETS[0].cron }]);
  }

  removeSchedule(index: number): void {
    this.commit(this.events(), this.hasPublicForm(), removeAt(this.schedules(), index));
  }

  setCron(index: number, cron: string): void {
    this.commit(this.events(), this.hasPublicForm(), replaceAt(this.schedules(), index, { kind: 'schedule', cron }));
  }

  add(): void {
    const event = this.available()[0];
    if (!event) return;
    this.commit([...this.events(), { kind: 'event', event }]);
  }

  remove(index: number): void {
    this.commit(removeAt(this.events(), index));
  }

  setEvent(index: number, value: string | number | null): void {
    const event = WORKFLOW_TRIGGER_EVENTS.find((e) => e === value);
    if (!event) return;
    // Tokens of the previous event do not exist in the new one: drop the map.
    this.commit(replaceAt(this.events(), index, { kind: 'event', event }));
  }

  setMap(index: number, field: string, token: string | number | null): void {
    const current = this.events()[index];
    const { [field]: _old, ...rest } = current.map ?? {};
    const map = token ? { ...rest, [field]: String(token) } : rest;
    const { map: _m, ...base } = current;
    this.commit(replaceAt(this.events(), index, Object.keys(map).length > 0 ? { ...base, map } : base));
  }
}
