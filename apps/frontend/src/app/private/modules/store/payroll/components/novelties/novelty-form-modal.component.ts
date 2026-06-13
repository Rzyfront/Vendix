import {
  Component,
  input,
  output,
  model,
  inject,
  DestroyRef,
  signal,
  computed,
  effect,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { startWith } from 'rxjs/operators';

import { PayrollService } from '../../services/payroll.service';
import {
  CreateNoveltyDto,
  NoveltyType,
  PayrollNovelty,
} from '../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import {
  toLocalDateString,
  toUTCDateString,
} from '../../../../../../shared/utils/date.util';
import { NOVELTY_TYPE_CONFIG, NoveltyUnit } from './novelty-labels';

interface NoveltyFormControls {
  employee_id: FormControl<number | null>;
  novelty_type: FormControl<NoveltyType | null>;
  date_start: FormControl<string>;
  date_end: FormControl<string>;
  hours: FormControl<number | null>;
  days: FormControl<number | null>;
  amount: FormControl<number | null>;
  notes: FormControl<string>;
}

@Component({
  selector: 'app-novelty-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onClose()"
      [title]="isEdit() ? 'Editar Novedad' : 'Nueva Novedad'"
      size="md"
    >
      <div class="p-4">
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-4">
          <app-selector
            label="Empleado"
            formControlName="employee_id"
            [options]="employeeOptions()"
            [required]="true"
            placeholder="Seleccionar empleado..."
          ></app-selector>

          <app-selector
            label="Tipo de Novedad"
            formControlName="novelty_type"
            [options]="noveltyTypeOptions"
            [required]="true"
            placeholder="Seleccionar tipo..."
          ></app-selector>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Fecha Inicio"
              type="date"
              formControlName="date_start"
              [required]="true"
            ></app-input>

            <app-input
              label="Fecha Fin"
              type="date"
              formControlName="date_end"
              helperText="Opcional"
            ></app-input>
          </div>

          <!-- Campos condicionales por tipo -->
          @if (currentUnit() === 'hours') {
            <app-input
              label="Horas"
              type="number"
              formControlName="hours"
              [required]="true"
              placeholder="0"
              helperText="Cantidad de horas de la novedad"
            ></app-input>
          }

          @if (currentUnit() === 'days') {
            <app-input
              label="Días"
              type="number"
              formControlName="days"
              [required]="true"
              placeholder="0"
              helperText="Cantidad de días de la novedad"
            ></app-input>
          }

          @if (currentUnit() === 'amount') {
            <app-input
              label="Monto"
              [currency]="true"
              formControlName="amount"
              [required]="true"
              placeholder="0"
            ></app-input>
          }

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1"
              >Notas</label
            >
            <textarea
              formControlName="notes"
              rows="3"
              maxlength="255"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm
                     text-text-primary placeholder-text-secondary focus:border-primary-600
                     focus:outline-none focus:ring-1 focus:ring-primary-600 resize-none"
              placeholder="Notas (opcional)..."
            ></textarea>
          </div>
        </form>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="!formValid() || submitting()"
            [loading]="submitting()"
          >
            {{ isEdit() ? 'Guardar Cambios' : 'Crear Novedad' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class NoveltyFormModalComponent {
  private destroyRef = inject(DestroyRef);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);

  readonly isOpen = model<boolean>(false);
  /** Novedad a editar (null = modo crear). Solo se editan novelties 'pending'. */
  readonly novelty = input<PayrollNovelty | null>(null);
  readonly employeeOptions = input<SelectorOption[]>([]);
  readonly saved = output<void>();

  readonly submitting = signal(false);
  readonly isEdit = computed(() => this.novelty() !== null);

  readonly noveltyTypeOptions: SelectorOption[] = Object.entries(
    NOVELTY_TYPE_CONFIG,
  ).map(([value, cfg]) => ({ label: cfg.label, value }));

  readonly form = new FormGroup<NoveltyFormControls>({
    employee_id: new FormControl<number | null>(null, [Validators.required]),
    novelty_type: new FormControl<NoveltyType | null>(null, [
      Validators.required,
    ]),
    date_start: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    date_end: new FormControl('', { nonNullable: true }),
    hours: new FormControl<number | null>(null),
    days: new FormControl<number | null>(null),
    amount: new FormControl<number | null>(null),
    notes: new FormControl('', { nonNullable: true }),
  });

  /** Tipo seleccionado, puenteado a signal (zoneless-safe). */
  private readonly selectedType = toSignal(
    this.form.controls.novelty_type.valueChanges.pipe(
      startWith(this.form.controls.novelty_type.value),
    ),
    { initialValue: this.form.controls.novelty_type.value },
  );

  /** Unidad de captura del tipo actual: horas, días o monto. */
  readonly currentUnit = computed<NoveltyUnit | null>(() => {
    const type = this.selectedType();
    return type ? NOVELTY_TYPE_CONFIG[type]?.unit || null : null;
  });

  /** Estado del form puenteado a signal (form.status no es reactivo en computed). */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  readonly formValid = computed(() => this.formStatus() === 'VALID');

  constructor() {
    // Validadores condicionales según unidad del tipo seleccionado
    effect(() => {
      const unit = this.currentUnit();
      this.applyUnitValidators(unit);
    });

    // Prefill al abrir: edición o valores por defecto
    effect(() => {
      if (!this.isOpen()) return;
      const novelty = this.novelty();
      if (novelty) {
        this.patchFromNovelty(novelty);
      } else {
        this.resetForCreate();
      }
    });
  }

  private applyUnitValidators(unit: NoveltyUnit | null): void {
    const { hours, days, amount } = this.form.controls;
    const config: Array<[FormControl<number | null>, boolean]> = [
      [hours, unit === 'hours'],
      [days, unit === 'days'],
      [amount, unit === 'amount'],
    ];
    for (const [control, required] of config) {
      if (required) {
        control.setValidators([Validators.required, Validators.min(0.01)]);
      } else {
        control.clearValidators();
        if (control.value !== null) control.setValue(null, { emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
    // statusChanges no emite con emitEvent:false → forzar re-evaluación del grupo
    this.form.updateValueAndValidity();
  }

  private patchFromNovelty(novelty: PayrollNovelty): void {
    this.form.patchValue({
      employee_id: novelty.employee_id,
      novelty_type: novelty.novelty_type,
      date_start: novelty.date_start
        ? toUTCDateString(new Date(novelty.date_start))
        : '',
      date_end: novelty.date_end
        ? toUTCDateString(new Date(novelty.date_end))
        : '',
      hours: novelty.hours != null ? Number(novelty.hours) : null,
      days: novelty.days != null ? Number(novelty.days) : null,
      amount: novelty.amount != null ? Number(novelty.amount) : null,
      notes: novelty.notes || '',
    });
    // En edición no se cambia el empleado (el backend valida contra el original)
    this.form.controls.employee_id.disable({ emitEvent: false });
  }

  private resetForCreate(): void {
    this.form.reset({
      employee_id: null,
      novelty_type: null,
      date_start: toLocalDateString(),
      date_end: '',
      hours: null,
      days: null,
      amount: null,
      notes: '',
    });
    this.form.controls.employee_id.enable({ emitEvent: false });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const val = this.form.getRawValue();
    const unit = this.currentUnit();

    const dto: CreateNoveltyDto = {
      employee_id: Number(val.employee_id),
      novelty_type: val.novelty_type!,
      date_start: val.date_start,
      ...(val.date_end ? { date_end: val.date_end } : {}),
      ...(unit === 'hours' && val.hours != null
        ? { hours: Number(val.hours) }
        : {}),
      ...(unit === 'days' && val.days != null ? { days: Number(val.days) } : {}),
      ...(unit === 'amount' && val.amount != null
        ? { amount: Number(val.amount) }
        : {}),
      ...(val.notes ? { notes: val.notes } : {}),
    };

    this.submitting.set(true);
    const novelty = this.novelty();
    const request$ = novelty
      ? this.payrollService.updateNovelty(novelty.id, dto)
      : this.payrollService.createNovelty(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.show({
          variant: 'success',
          description: novelty
            ? 'Novedad actualizada exitosamente'
            : 'Novedad creada exitosamente',
        });
        this.submitting.set(false);
        this.saved.emit();
        this.onClose();
      },
      error: () => {
        this.toastService.show({
          variant: 'error',
          description: novelty
            ? 'Error al actualizar la novedad'
            : 'Error al crear la novedad',
        });
        this.submitting.set(false);
      },
    });
  }

  onClose(): void {
    this.isOpen.set(false);
  }
}
