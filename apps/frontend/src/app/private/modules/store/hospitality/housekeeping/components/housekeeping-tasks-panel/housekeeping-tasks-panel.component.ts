import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  ItemListCardConfig,
  ModalComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  TableAction,
  TableColumn,
  ToastService,
  SpinnerComponent,
} from '../../../../../../../shared/components/index';
import { HOUSEKEEPING_STATUS_LABELS } from '../../../rooms/interfaces/unit.interface';
import {
  HOUSEKEEPING_TASK_TYPE_LABELS,
  HousekeepingTask,
  HousekeepingTaskStatus,
  HousekeepingTasksDay,
} from '../../interfaces/housekeeping.interface';
import { LodgingHousekeepingService } from '../../services/housekeeping.service';
import {
  statusBadgeConfig,
  TASK_STATUS_CHIPS,
  TASK_STATUS_LABELS,
} from '../../../shared/hospitality-status';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';

/** `0` stands for "Sin asignar" in the selector (options need a value). */
const UNASSIGNED = 0;

interface TaskRow extends HousekeepingTask {
  room: string;
  type_label: string;
  room_status_label: string;
  assignee_label: string;
}

const TASK_STATUS_BADGE = statusBadgeConfig(TASK_STATUS_CHIPS);

const taskStatusLabel = (value: HousekeepingTaskStatus): string =>
  TASK_STATUS_LABELS[value] ?? value;

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

/**
 * Hospitality Suite — tasks of the day (H5.2). In `assign` mode the head
 * housekeeper sees every task and picks the housekeeper of each room; in
 * `mine` mode the housekeeper sees only hers and marks them "Terminada",
 * which leaves a dirty room clean, waiting for inspection.
 *
 * Renders the body of the housekeeping card: the page owns the sticky search
 * and the dropdown filters and passes them in; the rows go through the
 * standard responsive data view and the assignment opens a modal.
 */
@Component({
  selector: 'app-housekeeping-tasks-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HospitalityLoadErrorComponent,
    SpinnerComponent,
    AlertBannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  template: `
    @if (loadError() !== null) {
      <app-hospitality-load-error
        what="las tareas de limpieza"
        [message]="loadError()"
        (retry)="load()"
      />
    } @else if (day() === null) {
      <div class="p-4 md:p-6">
        <app-spinner [center]="true" text="Cargando tareas…" />
      </div>
    } @else {
      @if (mode() === 'assign' && (day()?.staff ?? []).length === 0 && day()!.tasks.length > 0) {
        <app-alert-banner variant="info" icon="info" class="mb-3 block">
          No hay usuarios con el rol Camarera en esta tienda. Créalos en Usuarios para asignarles
          habitaciones.
        </app-alert-banner>
      }
      @if (rows().length === 0 && hasFilters()) {
        <app-empty-state
          icon="search"
          title="Sin resultados"
          description="Ninguna tarea coincide con la búsqueda o los filtros."
          actionButtonText="Limpiar filtros"
          [showActionButton]="true"
          (actionClick)="clearFilters.emit()"
        />
      } @else if (rows().length === 0) {
        <app-empty-state
          icon="clipboard-check"
          [title]="mode() === 'assign' ? 'Sin tareas hoy' : 'Sin tareas asignadas'"
          [description]="
            mode() === 'assign'
              ? 'Hoy no hay salidas ni huéspedes en casa que limpiar.'
              : 'No tienes habitaciones asignadas hoy.'
          "
          [showActionButton]="false"
        />
      } @else {
        <app-responsive-data-view
          [data]="rows()"
          [columns]="columns()"
          [cardConfig]="cardConfig"
          [actions]="actions"
          [mobileActions]="actions"
          [striped]="true"
          [hoverable]="true"
          emptyMessage="No hay tareas con ese criterio"
          emptyIcon="search"
          data-testid="hk-tasks"
        />
      }
    }

    <app-modal
      [isOpen]="assigning() !== null"
      (isOpenChange)="!$event && assigning.set(null)"
      (cancel)="assigning.set(null)"
      size="sm"
      [title]="'Asignar habitación ' + (assigning()?.room ?? '')"
      [subtitle]="assigning()?.type_label ?? ''"
    >
      <app-selector
        label="Camarera"
        [options]="staffOptions()"
        [value]="assignTo()"
        (valueChange)="assignTo.set($event === null ? UNASSIGNED : Number($event))"
      />
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="assigning.set(null)">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="saving() !== null"
          [disabled]="saving() !== null"
          (clicked)="assign()"
        >
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class HousekeepingTasksPanelComponent implements OnInit {
  private readonly housekeepingService = inject(LodgingHousekeepingService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly UNASSIGNED = UNASSIGNED;
  protected readonly Number = Number;

  readonly mode = input.required<'assign' | 'mine'>();
  readonly search = input('');
  /** `pending` | `done` | '' */
  readonly statusFilter = input('');
  /** `assigned` | `unassigned` | '' (assign mode only). */
  readonly assignmentFilter = input('');
  /** A finished task may have changed a room's status on the board. */
  readonly roomChanged = output<void>();
  readonly clearFilters = output<void>();

  readonly day = signal<HousekeepingTasksDay | null>(null);
  /** R-FB-02 — reason of the last failed load; null = loaded or loading. */
  readonly loadError = signal<string | null>(null);
  readonly saving = signal<number | null>(null);
  readonly assigning = signal<TaskRow | null>(null);
  readonly assignTo = signal<number>(UNASSIGNED);

  readonly staffOptions = computed<SelectorOption[]>(() => [
    { value: UNASSIGNED, label: 'Sin asignar' },
    ...(this.day()?.staff ?? []).map((member) => ({ value: member.id, label: member.name })),
  ]);

  private readonly staffNames = computed(
    () => new Map((this.day()?.staff ?? []).map((member) => [member.id, member.name])),
  );

  readonly total = computed(() => this.day()?.tasks.length ?? 0);
  readonly pendingCount = computed(
    () => (this.day()?.tasks ?? []).filter((t) => t.status === 'pending').length,
  );

  readonly hasFilters = computed(
    () => !!(this.search() || this.statusFilter() || this.assignmentFilter()),
  );

  readonly rows = computed<TaskRow[]>(() => {
    const status = this.statusFilter();
    const assignment = this.mode() === 'assign' ? this.assignmentFilter() : '';
    return (this.day()?.tasks ?? [])
      .map((task) => this.toRow(task))
      .filter(
        (row) =>
          matches(this.search(), row.room, row.type_label, row.unit.unit_type.name, row.assignee_label) &&
          (!status || row.status === status) &&
          (!assignment ||
            (assignment === 'assigned') === (row.assigned_user_id !== null)),
      );
  });

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'room', label: 'Habitación' },
    { key: 'type_label', label: 'Tarea' },
    { key: 'room_status_label', label: 'Estado habitación' },
    ...(this.mode() === 'assign' ? [{ key: 'assignee_label', label: 'Camarera' }] : []),
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: TASK_STATUS_BADGE,
      transform: taskStatusLabel,
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'room',
    subtitleKey: 'type_label',
    badgeKey: 'status',
    badgeConfig: TASK_STATUS_BADGE,
    badgeTransform: taskStatusLabel,
    detailKeys: [
      { key: 'room_status_label', label: 'Habitación' },
      { key: 'assignee_label', label: 'Camarera' },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Asignar',
      icon: 'user-plus',
      variant: 'primary',
      show: (row: TaskRow) => this.mode() === 'assign' && row.status === 'pending',
      disabled: () => this.saving() !== null,
      action: (row: TaskRow) => this.openAssign(row),
    },
    {
      label: 'Terminada',
      icon: 'check',
      variant: 'success',
      show: (row: TaskRow) => this.mode() === 'mine' && row.status === 'pending',
      disabled: () => this.saving() !== null,
      action: (row: TaskRow) => this.complete(row),
    },
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const request =
      this.mode() === 'assign' ? this.housekeepingService.tasks() : this.housekeepingService.myTasks();
    this.loadError.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (day) => this.day.set(day),
      // R-FB-02: a failed load shows the error block, never "no tasks".
      error: (message: unknown) => {
        this.day.set(null);
        this.loadError.set(
          typeof message === 'string' ? message : 'Revisa tu conexión e inténtalo de nuevo.',
        );
      },
    });
  }

  openAssign(row: TaskRow): void {
    this.assignTo.set(row.assigned_user_id ?? UNASSIGNED);
    this.assigning.set(row);
  }

  assign(): void {
    const task = this.assigning();
    if (!task || this.saving() !== null) return;
    const userId = this.assignTo() === UNASSIGNED ? null : this.assignTo();
    if (userId === task.assigned_user_id) {
      this.assigning.set(null);
      return;
    }
    this.saving.set(task.id);
    this.housekeepingService
      .assignTask(task.id, userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(null);
          this.assigning.set(null);
          this.replace(updated);
          this.toastService.success(`Habitación ${updated.unit.code} asignada`);
        },
        error: (message: unknown) => {
          this.saving.set(null);
          this.assigning.set(null);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo asignar la tarea');
          this.load();
        },
      });
  }

  complete(task: HousekeepingTask): void {
    if (this.saving() !== null) return;
    this.saving.set(task.id);
    this.housekeepingService
      .completeTask(task.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(null);
          this.replace(updated);
          const status = updated.unit.housekeeping_status === 'clean'
            ? 'limpia, por inspeccionar'
            : HOUSEKEEPING_STATUS_LABELS[updated.unit.housekeeping_status].toLowerCase();
          this.toastService.success(`La ${updated.unit.code} quedó ${status}`);
          this.roomChanged.emit();
        },
        error: (message: unknown) => {
          this.saving.set(null);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo terminar la tarea');
          this.load();
        },
      });
  }

  private toRow(task: HousekeepingTask): TaskRow {
    const floor = task.unit.floor ? ` · Piso ${task.unit.floor}` : '';
    return {
      ...task,
      room: `${task.unit.code}${floor}`,
      type_label: HOUSEKEEPING_TASK_TYPE_LABELS[task.type],
      room_status_label: `${task.unit.unit_type.name} · ${HOUSEKEEPING_STATUS_LABELS[task.unit.housekeeping_status]}`,
      assignee_label:
        task.assigned_user_id === null
          ? 'Sin asignar'
          : this.mode() === 'mine'
            ? 'Tú'
            : (this.staffNames().get(task.assigned_user_id) ?? 'Asignada'),
    };
  }

  private replace(updated: HousekeepingTask): void {
    this.day.update(
      (day) => day && { ...day, tasks: day.tasks.map((t) => (t.id === updated.id ? updated : t)) },
    );
  }
}
