import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  WORKFLOW_LIMITS,
  WORKFLOW_TRIGGER_EVENTS,
  WorkflowTriggerDef,
  WorkflowTriggerEvent,
  describeCron,
  parseCron,
} from '../../../../../../shared/workflows/contract';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { removeAt, replaceAt } from '../workflow-editor.utils';
import {
  emailTokenOptions,
  eventOptions,
  eventTokenOptions,
  recordDateFieldOptions,
  recordTokenOptions,
} from '../workflow-editor-triggers.utils';
import { CollectionView } from '../../records/interfaces/records.interfaces';
import { RecordsApiService } from '../../records/services/records-api.service';

type EventTrigger = Extract<WorkflowTriggerDef, { kind: 'event' }>;
type ScheduleTrigger = Extract<WorkflowTriggerDef, { kind: 'schedule' }>;
type EmailTrigger = Extract<WorkflowTriggerDef, { kind: 'email' }>;
type RecordDateTrigger = Extract<WorkflowTriggerDef, { kind: 'record_date' }>;

/** Kinds `commit` rebuilds itself; any other trigger is kept as it is. */
const COMMIT_KINDS: readonly string[] = ['manual', 'public_form', 'schedule', 'event'];

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

      <div class="flex flex-col gap-3">
        <p class="text-sm font-semibold text-text-primary">Desde otros sistemas</p>
        @if ((hasWebhook() || email()) && startsWithInitiator()) {
          <app-alert-banner variant="warning" icon="alert-triangle" data-testid="trigger-external-initiator-hint">
            Estos disparadores no tienen a nadie que inicie la solicitud: asigna la etapa inicial a un rol, un grupo, una persona o un campo (pestaña Responsable).
          </app-alert-banner>
        }
        <div class="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3" data-testid="webhook-trigger">
          <app-toggle label="Webhook de entrada" [checked]="hasWebhook()" (toggled)="setWebhook($event)" />
          <p class="text-xs text-text-secondary">
            Otro sistema (tu web, un CRM) inicia la solicitud con una llamada firmada; los datos llegan en los campos del formulario.
            Tras publicar, activa la URL y el secreto en "Conexiones del flujo".
          </p>
        </div>
        <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="email-trigger">
          <app-toggle label="Correo entrante" [checked]="!!email()" (toggled)="setEmail($event)" />
          <p class="text-xs text-text-secondary">
            Un correo enviado al buzón del flujo inicia la solicitud; los adjuntos van al expediente.
            Tras publicar, activa el buzón en "Conexiones del flujo".
          </p>
          @if (email(); as trigger) {
            @if (mappableFields().length === 0) {
              <p class="text-xs text-text-secondary">Declara campos en el formulario para llenarlos con datos del correo.</p>
            } @else {
              <p class="text-xs font-semibold text-text-primary">Llenar campos con datos del correo</p>
              @for (field of mappableFields(); track field.key) {
                <app-selector
                  size="sm"
                  [label]="field.label"
                  [options]="emailOptions"
                  [value]="trigger.map?.[field.key] ?? ''"
                  (valueChange)="setEmailMap(field.key, $event)"
                />
              }
            }
          }
        </div>
      </div>

      <div class="flex flex-col gap-3" data-testid="record-section">
        <p class="text-sm font-semibold text-text-primary">Sobre un registro personalizado</p>
        @if (otherSubject(); as other) {
          <p class="text-xs text-text-secondary">Este flujo trabaja sobre «{{ other }}»; los registros personalizados se eligen en flujos sin otro sujeto.</p>
        } @else {
          <app-selector
            label="Colección del registro"
            size="sm"
            helpText="Los registros de esta colección son el sujeto de cada solicitud."
            [options]="collectionOptions()"
            [value]="collectionKey()"
            (valueChange)="setCollection($event)"
          />
          @if (collectionKey() && !collection()) {
            <p class="text-xs text-error">La colección «{{ collectionKey() }}» no existe o está archivada.</p>
          }
          @if (collection(); as c) {
            @if (recordDates().length > 0 && startsWithInitiator()) {
              <app-alert-banner variant="warning" icon="alert-triangle" data-testid="trigger-record-initiator-hint">
                Este disparador no tiene a nadie que inicie la solicitud: asigna la etapa inicial a un rol, un grupo, una persona o un campo (pestaña Responsable).
              </app-alert-banner>
            }
            @for (trigger of recordDates(); track $index; let i = $index) {
              <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="record-date-trigger">
                <div class="flex items-end gap-2">
                  <div class="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                    <app-selector
                      label="Fecha del registro"
                      size="sm"
                      [options]="dateFieldOptions()"
                      [value]="trigger.field"
                      (valueChange)="setRecordField(i, $event)"
                    />
                    <app-input
                      label="Días antes"
                      type="number"
                      min="0"
                      [max]="maxDaysBefore"
                      helperText="0 = el mismo día de la fecha."
                      [ngModel]="'' + trigger.days_before"
                      (ngModelChange)="setRecordDays(i, $event)"
                    />
                  </div>
                  <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar disparador por fecha" (clicked)="removeRecordDate(i)">
                    <app-icon name="trash-2" [size]="12" slot="icon" />
                  </app-button>
                </div>
                @if (mappableFields().length === 0) {
                  <p class="text-xs text-text-secondary">Declara campos en el formulario para llenarlos con datos del registro.</p>
                } @else {
                  <p class="text-xs font-semibold text-text-primary">Llenar campos con datos del registro</p>
                  @for (field of mappableFields(); track field.key) {
                    <app-selector
                      size="sm"
                      [label]="field.label"
                      [options]="recordTokens()"
                      [value]="trigger.map?.[field.key] ?? ''"
                      (valueChange)="setRecordMap(i, field.key, $event)"
                    />
                  }
                }
              </div>
            } @empty {
              <p class="text-sm text-text-secondary">Sin disparador por fecha: las solicitudes sobre {{ c.name }} se inician a mano.</p>
            }
            <div>
              <app-button variant="outline" size="sm" [disabled]="dateFieldOptions().length === 0" (clicked)="addRecordDate()">
                <app-icon name="plus" [size]="14" slot="icon" />
                Agregar disparador por fecha del registro
              </app-button>
              @if (dateFieldOptions().length === 0) {
                <p class="mt-1 text-xs text-text-secondary">«{{ c.name }}» no tiene campos de tipo fecha.</p>
              }
            </div>
          }
        }
      </div>
    </section>
  `,
})
export class TriggersPanelComponent {
  protected readonly store = inject(WorkflowEditorStore);
  private readonly records = inject(RecordsApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Custom collections of the store (P3.6); empty until loaded or when the person cannot read them. */
  readonly collections = signal<CollectionView[]>([]);
  readonly maxDaysBefore = WORKFLOW_LIMITS.maxRecordDateDaysBefore;

  readonly triggers = computed<WorkflowTriggerDef[]>(() => this.store.draft()?.triggers ?? [{ kind: 'manual' }]);
  readonly events = computed(() => this.triggers().filter((t): t is EventTrigger => t.kind === 'event'));
  readonly schedules = computed(() => this.triggers().filter((t): t is ScheduleTrigger => t.kind === 'schedule'));
  readonly presets = CRON_PRESETS;
  /** Validator limit of schedule triggers per flow. */
  readonly maxSchedules = WORKFLOW_LIMITS.maxSchedules;
  readonly hasPublicForm = computed(() => this.triggers().some((t) => t.kind === 'public_form'));
  readonly hasWebhook = computed(() => this.triggers().some((t) => t.kind === 'webhook'));
  readonly email = computed(() => this.triggers().find((t): t is EmailTrigger => t.kind === 'email') ?? null);
  readonly emailOptions = [{ value: '', label: 'Sin llenar' }, ...emailTokenOptions()];
  readonly subject = computed(() => this.store.draft()?.subject);
  readonly collectionKey = computed(() => {
    const subject = this.subject();
    return subject?.type === 'custom_record' ? (subject.collection ?? '') : '';
  });
  /** Subject type of a flow that is not about a custom record (those are edited elsewhere). */
  readonly otherSubject = computed(() => {
    const subject = this.subject();
    return subject && subject.type !== 'none' && subject.type !== 'custom_record' ? subject.type : null;
  });
  readonly collection = computed(() => this.collections().find((c) => c.key === this.collectionKey()) ?? null);
  readonly collectionOptions = computed(() => {
    const key = this.collectionKey();
    const known = this.collections().map((c) => ({ value: c.key, label: c.name }));
    return [
      { value: '', label: 'Ninguno' },
      ...known,
      ...(key && !known.some((o) => o.value === key) ? [{ value: key, label: key }] : []),
    ];
  });
  readonly recordDates = computed(() =>
    this.triggers().filter((t): t is RecordDateTrigger => t.kind === 'record_date'),
  );
  readonly dateFieldOptions = computed(() => recordDateFieldOptions(this.collection()?.fields ?? []));
  readonly recordTokens = computed(() => [
    { value: '', label: 'Sin llenar' },
    ...recordTokenOptions(this.collection()?.fields ?? []),
  ]);
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

  constructor() {
    this.records
      .listCollections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.collections.set(rows),
        // Only the collection choices depend on it: the rest of the panel keeps working.
        error: () => this.collections.set([]),
      });
  }

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
      ...this.triggers().filter((t) => !COMMIT_KINDS.includes(t.kind)),
    ];
    this.store.patchDefinition({ triggers: next });
  }

  /** Replaces the triggers outside `COMMIT_KINDS` that this panel owns (webhook, email). */
  private commitExternal(owned: WorkflowTriggerDef[], ownedKinds: readonly string[]): void {
    const rest = this.triggers().filter((t) => !ownedKinds.includes(t.kind));
    this.store.patchDefinition({ triggers: [...rest, ...owned] });
  }

  setWebhook(on: boolean): void {
    this.commitExternal(on ? [{ kind: 'webhook' }] : [], ['webhook']);
  }

  setEmail(on: boolean): void {
    const keep: WorkflowTriggerDef = this.email() ?? { kind: 'email' };
    this.commitExternal(on ? [keep] : [], ['email']);
  }

  setEmailMap(field: string, token: string | number | null): void {
    const current = this.email();
    if (!current) return;
    const { [field]: _old, ...rest } = current.map ?? {};
    const map = token ? { ...rest, [field]: String(token) } : rest;
    this.commitExternal([Object.keys(map).length > 0 ? { kind: 'email', map } : { kind: 'email' }], ['email']);
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
  /** Subject `custom_record` + collection; its record-date triggers belong to the previous collection, so they go. */
  setCollection(value: string | number | null): void {
    const key = value ? String(value) : '';
    const rest = this.triggers().filter((t) => t.kind !== 'record_date');
    this.store.patchDefinition({
      subject: key ? { type: 'custom_record', collection: key } : undefined,
      triggers: rest,
    });
  }

  addRecordDate(): void {
    const field = this.dateFieldOptions()[0]?.value;
    if (!field) return;
    this.commitExternal([...this.recordDates(), { kind: 'record_date', field, days_before: 30 }], ['record_date']);
  }

  removeRecordDate(index: number): void {
    this.commitExternal(removeAt(this.recordDates(), index), ['record_date']);
  }

  setRecordField(index: number, value: string | number | null): void {
    if (!value) return;
    const current = this.recordDates()[index];
    this.commitExternal(replaceAt(this.recordDates(), index, { ...current, field: String(value) }), ['record_date']);
  }

  setRecordDays(index: number, value: string | number | null): void {
    const days = Math.trunc(Number(value));
    if (!Number.isFinite(days)) return;
    const current = this.recordDates()[index];
    const days_before = Math.min(this.maxDaysBefore, Math.max(0, days));
    this.commitExternal(replaceAt(this.recordDates(), index, { ...current, days_before }), ['record_date']);
  }

  setRecordMap(index: number, field: string, token: string | number | null): void {
    const current = this.recordDates()[index];
    const { [field]: _old, ...rest } = current.map ?? {};
    const map = token ? { ...rest, [field]: String(token) } : rest;
    const { map: _m, ...base } = current;
    this.commitExternal(
      replaceAt(this.recordDates(), index, Object.keys(map).length > 0 ? { ...base, map } : base),
      ['record_date'],
    );
  }
}
