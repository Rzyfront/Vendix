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
import { catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { RouterLink } from '@angular/router';
import {
  AlertBannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
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
    IconComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    RouterLink,
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
          <!-- R-EMPTY-03: the notice carries the button that solves it. -->
          <div bannerActions class="mt-2">
            <app-button
              variant="outline"
              size="sm"
              customClasses="!min-h-11"
              routerLink="/admin/settings/users"
              data-testid="hk-go-users"
            >
              Ir a Usuarios
            </app-button>
          </div>
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
      } @else if (rows().length === 0 && mode() === 'assign') {
        <!-- R-EMPTY-01/04: tasks are made on their own, and by hand too. -->
        <app-empty-state
          icon="clipboard-check"
          title="Sin tareas hoy"
          description="Las tareas de salidas y huéspedes en casa se crean solas cada día. Puedes crear otras con + Nueva tarea."
          actionButtonText="Nueva tarea"
          actionButtonIcon="plus"
          [showActionButton]="true"
          (actionClick)="createTask.emit()"
          data-testid="hk-tasks-empty"
        />
      } @else if (rows().length === 0) {
        <app-empty-state
          icon="clipboard-check"
          title="Sin tareas asignadas"
          description="No tienes habitaciones asignadas hoy."
          [showActionButton]="false"
        />
      } @else {
        <!-- R-ROW-05: assign several rooms to one housekeeper at once. -->
        @if (bulkIds().length > 0) {
          <div
            class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            role="region"
            aria-label="Acciones de la selección"
            data-testid="hk-bulk-bar"
          >
            <span class="text-sm font-medium text-text-primary">
              {{ bulkIds().length }} {{ bulkIds().length === 1 ? 'seleccionada' : 'seleccionadas' }}
            </span>
            <div class="flex gap-2">
              <app-button
                variant="ghost"
                size="sm"
                customClasses="!min-h-11"
                (clicked)="selectedIds.set(emptySelection())"
              >
                Quitar selección
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                customClasses="!min-h-11"
                [disabled]="saving() !== null"
                (clicked)="openBulkAssign()"
                data-testid="hk-bulk-assign"
              >
                <app-icon slot="icon" name="user-plus" [size]="16" />
                Asignar a…
              </app-button>
            </div>
          </div>
        }
        <app-responsive-data-view
          [data]="rows()"
          [columns]="columns()"
          [cardConfig]="cardConfig"
          [actions]="actions"
          [mobileActions]="actions"
          [striped]="true"
          [hoverable]="true"
          [selectable]="mode() === 'assign'"
          rowLabelKey="room"
          [(selectedIds)]="selectedIds"
          emptyMessage="No hay tareas con ese criterio"
          emptyIcon="search"
          data-testid="hk-tasks"
        />
      }
    }

    <app-modal
      [isOpen]="assigning() !== null || bulkAssigning()"
      (isOpenChange)="!$event && closeAssign()"
      (cancel)="closeAssign()"
      size="sm"
      [title]="assignTitle()"
      [subtitle]="bulkAssigning() ? '' : (assigning()?.type_label ?? '')"
    >
      <app-selector
        label="Camarera"
        [options]="staffOptions()"
        [value]="assignTo()"
        (valueChange)="assignTo.set($event === null ? UNASSIGNED : Number($event))"
      />
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="closeAssign()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="saving() !== null"
          [disabled]="saving() !== null"
          (clicked)="bulkAssigning() ? assignSelected() : assign()"
          data-testid="hk-assign-save"
        >
          Guardar
        </app-button>
      </div>
    </app-modal>

    <!-- R-ROW-01: a finished task still opens something. -->
    <app-modal
      [isOpen]="viewing() !== null"
      (isOpenChange)="!$event && viewing.set(null)"
      (cancel)="viewing.set(null)"
      size="sm"
      [title]="'Habitación ' + (viewing()?.room ?? '')"
      [subtitle]="viewing()?.type_label ?? ''"
    >
      @if (viewing(); as task) {
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" data-testid="hk-task-view">
          <dt class="text-text-secondary">Estado</dt>
          <dd class="text-text-primary">{{ statusLabel(task.status) }}</dd>
          <dt class="text-text-secondary">Camarera</dt>
          <dd class="text-text-primary">{{ task.assignee_label }}</dd>
          <dt class="text-text-secondary">Habitación</dt>
          <dd class="text-text-primary">{{ task.room_status_label }}</dd>
          @if (task.notes) {
            <dt class="text-text-secondary">Nota</dt>
            <dd class="text-text-primary whitespace-pre-line">{{ task.notes }}</dd>
          }
        </dl>
      }
      <div slot="footer" class="flex justify-end">
        <app-button variant="ghost" (clicked)="viewing.set(null)">Cerrar</app-button>
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
  /** U12 — the empty state asks the page for "+ Nueva tarea". */
  readonly createTask = output<void>();

  readonly day = signal<HousekeepingTasksDay | null>(null);
  /** R-FB-02 — reason of the last failed load; null = loaded or loading. */
  readonly loadError = signal<string | null>(null);
  readonly saving = signal<number | null>(null);
  readonly assigning = signal<TaskRow | null>(null);
  readonly assignTo = signal<number>(UNASSIGNED);
  /** U14 — rows ticked in the list (task ids). */
  readonly selectedIds = signal<Set<string | number>>(new Set<string | number>());
  /** U14 — the assign modal works on the selection instead of one row. */
  readonly bulkAssigning = signal(false);
  protected readonly emptySelection = () => new Set<string | number>();
  /** Finished task shown read-only (its row's "Ver"). */
  readonly viewing = signal<TaskRow | null>(null);
  protected readonly statusLabel = taskStatusLabel;

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

  /**
   * U14 — selected tasks that can still be assigned: pending and visible with
   * the current search and filters (a hidden row is never touched by surprise).
   */
  readonly bulkIds = computed<number[]>(() => {
    const selected = this.selectedIds();
    return this.rows()
      .filter((row) => row.status === 'pending' && selected.has(row.id))
      .map((row) => row.id);
  });

  readonly assignTitle = computed(() => {
    if (this.bulkAssigning()) {
      const count = this.bulkIds().length;
      return `Asignar ${count} ${count === 1 ? 'tarea' : 'tareas'}`;
    }
    return 'Asignar habitación ' + (this.assigning()?.room ?? '');
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
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'ghost',
      show: (row: TaskRow) => row.status === 'done',
      action: (row: TaskRow) => this.viewing.set(row),
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

  openBulkAssign(): void {
    if (this.bulkIds().length === 0) return;
    this.assignTo.set(UNASSIGNED);
    this.bulkAssigning.set(true);
  }

  closeAssign(): void {
    this.assigning.set(null);
    this.bulkAssigning.set(false);
  }

  /**
   * U14 — assigns every selected task to one housekeeper, one call after the
   * other (no bulk endpoint while a hotel has a few dozen rooms). A refused
   * task does not stop the rest; the toast tells how many went through.
   */
  assignSelected(): void {
    const ids = this.bulkIds();
    if (ids.length === 0 || this.saving() !== null) return;
    const userId = this.assignTo() === UNASSIGNED ? null : this.assignTo();
    const name = userId === null ? null : (this.staffNames().get(userId) ?? 'la camarera');
    this.saving.set(ids[0]);
    from(ids)
      .pipe(
        concatMap((id) =>
          this.housekeepingService.assignTask(id, userId).pipe(
            map((task): HousekeepingTask | null => task),
            catchError(() => of(null)),
          ),
        ),
        toArray(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        const done = results.filter((task): task is HousekeepingTask => task !== null);
        done.forEach((task) => this.replace(task));
        this.saving.set(null);
        this.closeAssign();
        this.selectedIds.set(new Set<string | number>());
        const what = `${done.length} ${done.length === 1 ? 'tarea' : 'tareas'}`;
        const outcome =
          name === null
            ? `${what} ${done.length === 1 ? 'quedó' : 'quedaron'} sin asignar`
            : `${what} ${done.length === 1 ? 'asignada' : 'asignadas'} a ${name}`;
        const failed = ids.length - done.length;
        if (failed === 0) {
          this.toastService.success(outcome);
        } else {
          this.toastService.error(
            `${outcome}. ${failed} no se ${failed === 1 ? 'pudo' : 'pudieron'} asignar`,
          );
          this.load();
        }
      });
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
            : (task.assigned_user_name ??
              this.staffNames().get(task.assigned_user_id) ??
              'Usuario retirado'),
    };
  }

  /** U12 — a task made by hand joins today's list (other dates do not show here). */
  add(task: HousekeepingTask): void {
    this.day.update((day) =>
      day && task.task_date === day.business_date && !day.tasks.some((t) => t.id === task.id)
        ? { ...day, tasks: [...day.tasks, task] }
        : day,
    );
  }

  private replace(updated: HousekeepingTask): void {
    this.day.update(
      (day) => day && { ...day, tasks: day.tasks.map((t) => (t.id === updated.id ? updated : t)) },
    );
  }
}
