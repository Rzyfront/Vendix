import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
} from '../../../../../../../shared/components/index';
import { injectFocusFirstField } from '../../../shared/focus-first-field';
import {
  HOUSEKEEPING_TASK_TYPE_LABELS,
  HousekeepingBoardUnit,
  HousekeepingStaffMember,
  HousekeepingTask,
  HousekeepingTaskError,
  HousekeepingTaskField,
  HousekeepingTaskType,
} from '../../interfaces/housekeeping.interface';
import { LodgingHousekeepingService } from '../../services/housekeeping.service';

/** `0` stands for "Sin asignar" in the selector (options need a value). */
const UNASSIGNED = 0;
const REQUIRED = 'Este campo es requerido';

/** What the opener already knows: the room tapped, or the kind of task. */
export interface TaskFormPreset {
  unitId?: number;
  type?: HousekeepingTaskType;
}

interface TaskForm {
  unit_id: FormControl<number | null>;
  type: FormControl<HousekeepingTaskType>;
  task_date: FormControl<string>;
  assigned_user_id: FormControl<number>;
  notes: FormControl<string>;
}

/**
 * Hospitality Suite (U12) — "+ Nueva tarea": a clean, inspection or repair
 * asked by hand for a room, even without a departure today. One task per
 * room, day and type: the API refusal shows under its field.
 */
@Component({
  selector: 'app-housekeeping-task-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="preset() !== null"
      (isOpenChange)="!$event && close()"
      (cancel)="close()"
      (opened)="reset(); focusFirstField()"
      [size]="'md'"
      [dialog]="true"
      title="Nueva tarea"
      subtitle="Limpieza, inspección o reparación de una habitación"
    >
      <form
        [formGroup]="form"
        id="housekeeping-task-form"
        class="space-y-4"
        novalidate
        data-testid="hk-task-form"
        (ngSubmit)="onSubmit()"
      >
        <app-selector
          data-autofocus
          formControlName="unit_id"
          label="Habitación"
          placeholder="Selecciona una habitación"
          [searchable]="true"
          [required]="true"
          [options]="unitOptions()"
          [errorText]="fieldError('unit_id')"
        />
        <app-selector
          formControlName="type"
          label="Tipo"
          [required]="true"
          [options]="typeOptions"
          [errorText]="fieldError('type')"
        />
        <app-input
          formControlName="task_date"
          label="Fecha"
          type="date"
          [min]="today()"
          [required]="true"
          [control]="form.controls.task_date"
          [error]="fieldError('task_date')"
          customWrapperClass="mt-0"
        />
        <app-selector
          formControlName="assigned_user_id"
          label="Camarera (opcional)"
          [options]="staffOptions()"
          [helpText]="staffHelp()"
          [errorText]="fieldError('assigned_user_id')"
        />
        <app-textarea
          formControlName="notes"
          label="Nota"
          placeholder="Ej.: revisar el aire acondicionado"
          [rows]="2"
          [control]="form.controls.notes"
        />
        @if (formError()) {
          <p role="alert" class="font-medium text-error" data-testid="hk-task-error">{{ formError() }}</p>
        }
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="close()">Cancelar</app-button>
        <app-button
          type="submit"
          form="housekeeping-task-form"
          variant="primary"
          [loading]="saving()"
          [disabled]="saving()"
        >
          <app-icon slot="icon" name="plus" [size]="16" />
          Crear tarea
        </app-button>
      </div>
    </app-modal>
  `,
})
export class HousekeepingTaskFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly housekeepingService = inject(LodgingHousekeepingService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly focusFirstField = injectFocusFirstField();

  /** Opens the form when set; `null` keeps it closed. */
  readonly preset = input<TaskFormPreset | null>(null);
  /** Active rooms of the board. */
  readonly units = input<HousekeepingBoardUnit[]>([]);
  /** Business date of the store (YYYY-MM-DD), the default date. */
  readonly today = input.required<string>();
  /** Housekeepers already loaded by the tasks tab; null loads them on open. */
  readonly staff = input<HousekeepingStaffMember[] | null>(null);

  readonly closed = output<void>();
  readonly created = output<HousekeepingTask>();

  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly serverError = signal<HousekeepingTaskError | null>(null);
  private readonly loadedStaff = signal<HousekeepingStaffMember[] | null>(null);
  /** Bumped on every edit so field errors follow the values (zoneless). */
  private readonly formVersion = signal(0);

  readonly typeOptions: SelectorOption[] = (
    Object.keys(HOUSEKEEPING_TASK_TYPE_LABELS) as HousekeepingTaskType[]
  ).map((type) => ({ value: type, label: HOUSEKEEPING_TASK_TYPE_LABELS[type] }));

  readonly unitOptions = computed<SelectorOption[]>(() =>
    this.units().map((unit) => ({
      value: unit.id,
      label: `${unit.code} · ${unit.unit_type.name}${unit.floor ? ` · Piso ${unit.floor}` : ''}`,
    })),
  );

  private readonly staffList = computed(() => this.staff() ?? this.loadedStaff() ?? []);

  readonly staffOptions = computed<SelectorOption[]>(() => [
    { value: UNASSIGNED, label: 'Sin asignar' },
    ...this.staffList().map((member) => ({ value: member.id, label: member.name })),
  ]);

  readonly staffHelp = computed(() =>
    this.staffList().length === 0
      ? 'No hay usuarios con el rol Camarera; puedes asignarla después.'
      : '',
  );

  /** A refusal that belongs to no field shows above the buttons. */
  readonly formError = computed(() => {
    const error = this.serverError();
    return error && error.field === null ? error.message : '';
  });

  readonly form: FormGroup<TaskForm> = this.fb.group<TaskForm>({
    unit_id: this.fb.control<number | null>(null, { validators: [Validators.required] }),
    type: this.fb.nonNullable.control<HousekeepingTaskType>('checkout_clean', {
      validators: [Validators.required],
    }),
    task_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    assigned_user_id: this.fb.nonNullable.control<number>(UNASSIGNED),
    notes: this.fb.nonNullable.control('', { validators: [Validators.maxLength(500)] }),
  });

  constructor() {
    // A refusal is about the values sent: editing any field clears it.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formVersion.update((v) => v + 1);
      if (this.serverError()) this.serverError.set(null);
    });
  }

  /** Error under a field: the API refusal, else "required" after a submit. */
  fieldError(field: HousekeepingTaskField): string {
    this.formVersion();
    const error = this.serverError();
    if (error?.field === field) return error.message;
    const control = this.form.controls[field];
    return this.submitted() && control.hasError('required') ? REQUIRED : '';
  }

  reset(): void {
    const preset = this.preset() ?? {};
    this.form.reset({
      unit_id: preset.unitId ?? null,
      type: preset.type ?? 'checkout_clean',
      task_date: this.today(),
      assigned_user_id: UNASSIGNED,
      notes: '',
    });
    this.submitted.set(false);
    this.serverError.set(null);
    this.saving.set(false);
    if (this.staff() === null && this.loadedStaff() === null) this.loadStaff();
  }

  close(): void {
    if (this.saving()) return;
    this.closed.emit();
  }

  onSubmit(): void {
    if (this.saving()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.housekeepingService
      .createTask({
        unit_id: Number(raw.unit_id),
        type: raw.type,
        task_date: raw.task_date,
        assigned_user_id:
          Number(raw.assigned_user_id) === UNASSIGNED ? null : Number(raw.assigned_user_id),
        notes: raw.notes.trim(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (task) => {
          this.saving.set(false);
          this.created.emit(task);
        },
        error: (error: HousekeepingTaskError) => {
          this.saving.set(false);
          this.serverError.set(error);
        },
      });
  }

  /** Only the housekeepers are needed; the tasks endpoint is the one that lists them. */
  private loadStaff(): void {
    this.housekeepingService
      .tasks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (day) => this.loadedStaff.set(day.staff ?? []),
        error: () => this.loadedStaff.set([]),
      });
  }
}
