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
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { HOUSEKEEPING_STATUS_LABELS } from '../../../rooms/interfaces/unit.interface';
import {
  HOUSEKEEPING_TASK_TYPE_LABELS,
  HousekeepingTask,
  HousekeepingTasksDay,
} from '../../interfaces/housekeeping.interface';
import { LodgingHousekeepingService } from '../../services/housekeeping.service';

/** `0` stands for "Sin asignar" in the selector (options need a value). */
const UNASSIGNED = 0;

/**
 * Hospitality Suite — tasks of the day (H5.2). In `assign` mode the head
 * housekeeper sees every task and picks the housekeeper of each room; in
 * `mine` mode the housekeeper sees only hers and marks them "Terminada",
 * which leaves a dirty room clean, waiting for inspection.
 */
@Component({
  selector: 'app-housekeeping-tasks-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BadgeComponent, ButtonComponent, CardComponent, SelectorComponent, SpinnerComponent],
  template: `
    <app-card [responsive]="true">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 class="text-base font-semibold text-text-primary">
            {{ mode() === 'assign' ? 'Tareas de hoy' : 'Mis tareas de hoy' }}
          </h3>
          @if (day(); as d) {
            <p class="text-xs text-text-secondary">
              {{ pendingCount() }} pendientes de {{ d.tasks.length }}
              @if (mode() === 'assign') {
                · {{ unassignedCount() }} sin asignar
              }
            </p>
          }
        </div>
        <app-button variant="outline" size="sm" (clicked)="load()">Actualizar</app-button>
      </div>

      @if (day() === null) {
        <div class="flex justify-center py-6"><app-spinner size="md" /></div>
      } @else if (day()!.tasks.length === 0) {
        <p class="py-4 text-center text-sm text-text-secondary">
          {{
            mode() === 'assign'
              ? 'Hoy no hay salidas ni huéspedes en casa que limpiar.'
              : 'No tienes habitaciones asignadas hoy.'
          }}
        </p>
      } @else {
        @if (mode() === 'assign' && staffOptions().length === 1) {
          <p class="mb-3 rounded-md bg-surface-secondary p-2 text-xs text-text-secondary">
            No hay usuarios con el rol Camarera en esta tienda. Créalos en Usuarios para asignarles habitaciones.
          </p>
        }
        <ul class="flex flex-col divide-y divide-border">
          @for (task of day()!.tasks; track task.id) {
            <li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" [attr.data-testid]="'hk-task-' + task.unit.code">
              <div class="flex items-start gap-3">
                <span class="text-lg font-semibold text-text-primary">{{ task.unit.code }}</span>
                <span class="flex flex-col">
                  <span class="text-sm text-text-primary">{{ typeLabel(task) }}</span>
                  <span class="text-xs text-text-secondary">
                    {{ task.unit.unit_type.name }}{{ task.unit.floor ? ' · Piso ' + task.unit.floor : '' }}
                    · {{ statusLabel(task) }}
                  </span>
                </span>
              </div>

              @if (task.status === 'done') {
                <app-badge variant="success" size="sm">Terminada</app-badge>
              } @else if (mode() === 'assign') {
                <div class="w-full sm:w-56">
                  <app-selector
                    size="sm"
                    [options]="staffOptions()"
                    [value]="task.assigned_user_id ?? 0"
                    [disabled]="saving() !== null"
                    (valueChange)="assign(task, $event)"
                  />
                </div>
              } @else {
                <app-button
                  variant="primary"
                  size="md"
                  [fullWidth]="true"
                  class="sm:w-40"
                  [loading]="saving() === task.id"
                  [disabled]="saving() !== null"
                  (clicked)="complete(task)"
                >
                  Terminada
                </app-button>
              }
            </li>
          }
        </ul>
      }
    </app-card>
  `,
})
export class HousekeepingTasksPanelComponent implements OnInit {
  private readonly housekeepingService = inject(LodgingHousekeepingService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly mode = input.required<'assign' | 'mine'>();
  /** A finished task may have changed a room's status on the board. */
  readonly roomChanged = output<void>();

  readonly day = signal<HousekeepingTasksDay | null>(null);
  readonly saving = signal<number | null>(null);

  readonly staffOptions = computed<SelectorOption[]>(() => [
    { value: UNASSIGNED, label: 'Sin asignar' },
    ...(this.day()?.staff ?? []).map((member) => ({ value: member.id, label: member.name })),
  ]);
  readonly pendingCount = computed(
    () => (this.day()?.tasks ?? []).filter((t) => t.status === 'pending').length,
  );
  readonly unassignedCount = computed(
    () =>
      (this.day()?.tasks ?? []).filter((t) => t.status === 'pending' && t.assigned_user_id === null)
        .length,
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const request =
      this.mode() === 'assign' ? this.housekeepingService.tasks() : this.housekeepingService.myTasks();
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (day) => this.day.set(day),
      error: (message: unknown) => {
        this.day.set({ business_date: '', tasks: [], staff: [] });
        this.toastService.error(typeof message === 'string' ? message : 'No se pudieron cargar las tareas');
      },
    });
  }

  typeLabel(task: HousekeepingTask): string {
    return HOUSEKEEPING_TASK_TYPE_LABELS[task.type];
  }

  statusLabel(task: HousekeepingTask): string {
    return HOUSEKEEPING_STATUS_LABELS[task.unit.housekeeping_status];
  }

  assign(task: HousekeepingTask, value: string | number | null): void {
    const userId = value === null || Number(value) === UNASSIGNED ? null : Number(value);
    if (userId === task.assigned_user_id || this.saving() !== null) return;
    this.saving.set(task.id);
    this.housekeepingService
      .assignTask(task.id, userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(null);
          this.replace(updated);
        },
        error: (message: unknown) => {
          this.saving.set(null);
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
            : this.statusLabel(updated).toLowerCase();
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

  private replace(updated: HousekeepingTask): void {
    this.day.update(
      (day) => day && { ...day, tasks: day.tasks.map((t) => (t.id === updated.id ? updated : t)) },
    );
  }
}
