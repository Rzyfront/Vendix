import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { LodgingRestriction, RestrictionPayload } from '../../interfaces/rate-plan.interface';
import { RestrictionsService } from '../../services/restrictions.service';

/** Scope option value for "every room type". */
const ALL_TYPES = 0;

interface RestrictionForm {
  from_date: FormControl<string>;
  to_date: FormControl<string>;
  unit_type_id: FormControl<number>;
  min_stay: FormControl<number | null>;
  max_stay: FormControl<number | null>;
  closed_to_arrival: FormControl<boolean>;
  closed_to_departure: FormControl<boolean>;
  stop_sell: FormControl<boolean>;
}

/**
 * Hospitality Suite (H2.3) — restrictions of one night or a range picked in
 * the rates calendar: minimum/maximum stay for arrivals, closed to arrival or
 * departure and closed sale (stop-sell), for every room type or one. Saving replaces what
 * those nights had for that scope; everything empty removes them.
 */
@Component({
  selector: 'app-restriction-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      (opened)="reset()"
      [size]="'md'"
      [dialog]="true"
      title="Restricciones de venta"
      subtitle="Estancia mínima, llegadas, salidas y cerrar venta"
    >
      <form
        [formGroup]="form"
        id="restriction-form"
        class="space-y-4"
        novalidate
        (ngSubmit)="onSubmit()"
      >
        <div class="grid grid-cols-2 gap-3">
          <app-input
            formControlName="from_date"
            label="Desde la noche"
            type="date"
            [required]="true"
            [control]="form.controls.from_date"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="to_date"
            label="Hasta la noche"
            type="date"
            [required]="true"
            [control]="form.controls.to_date"
            [error]="datesError() ? 'Debe ser igual o posterior a la primera noche' : ''"
            customWrapperClass="mt-0"
          />
        </div>
        <app-selector
          formControlName="unit_type_id"
          label="Aplica a"
          [options]="scopeOptions()"
        />
        <div class="grid grid-cols-2 gap-3">
          <app-input
            formControlName="min_stay"
            label="Estancia mínima (noches)"
            type="number"
            [min]="1"
            placeholder="Sin mínimo"
            [control]="form.controls.min_stay"
            helperText="Para llegar esa noche"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="max_stay"
            label="Estancia máxima (noches)"
            type="number"
            [min]="1"
            placeholder="Sin máximo"
            [control]="form.controls.max_stay"
            [error]="stayError() ? 'No puede ser menor que la mínima' : ''"
            customWrapperClass="mt-0"
          />
        </div>
        <app-toggle formControlName="closed_to_arrival" label="Sin llegadas ese día (nadie puede llegar)" />
        <app-toggle formControlName="closed_to_departure" label="Sin salidas ese día (nadie puede salir)" />
        <app-toggle formControlName="stop_sell" label="Cerrar venta (no se vende esa noche)" />
        <p class="text-sm text-text-secondary">
          Un usuario con permiso para editar tarifas puede forzar una reserva que no cumpla estas
          restricciones indicando el motivo.
        </p>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button type="submit" form="restriction-form" variant="primary" [loading]="saving()">
          <app-icon slot="icon" name="save" [size]="16" />
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class RestrictionFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly restrictionsService = inject(RestrictionsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  /** Night clicked in the calendar, `YYYY-MM-DD`. */
  readonly date = input<string | null>(null);
  readonly unitTypes = input<UnitType[]>([]);
  /** Restrictions already loaded, to prefill the clicked night. */
  readonly restrictions = input<LodgingRestriction[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<LodgingRestriction[]>();

  readonly saving = signal(false);
  readonly datesError = signal(false);
  readonly stayError = signal(false);

  readonly scopeOptions = computed<SelectorOption[]>(() => [
    { value: ALL_TYPES, label: 'Todos los tipos de habitación' },
    ...this.unitTypes()
      .filter((t) => t.is_active)
      .map((t) => ({ value: t.id, label: t.name })),
  ]);

  readonly form: FormGroup<RestrictionForm> = this.fb.group<RestrictionForm>({
    from_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    to_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    unit_type_id: this.fb.nonNullable.control(ALL_TYPES),
    min_stay: this.fb.control<number | null>(null, { validators: [Validators.min(1)] }),
    max_stay: this.fb.control<number | null>(null, { validators: [Validators.min(1)] }),
    closed_to_arrival: this.fb.nonNullable.control(false),
    closed_to_departure: this.fb.nonNullable.control(false),
    stop_sell: this.fb.nonNullable.control(false),
  });

  constructor() {
    // Another scope shows what that scope already has on the first night.
    this.form.controls.unit_type_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((scope) => this.prefill(this.form.controls.from_date.value, scope));
  }

  reset(): void {
    const date = this.date() ?? '';
    this.form.reset({ from_date: date, to_date: date, unit_type_id: ALL_TYPES }, { emitEvent: false });
    this.prefill(date, ALL_TYPES);
    this.datesError.set(false);
    this.stayError.set(false);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const min_stay = Number(raw.min_stay) || null;
    const max_stay = Number(raw.max_stay) || null;
    this.datesError.set(!!raw.from_date && !!raw.to_date && raw.to_date < raw.from_date);
    this.stayError.set(min_stay != null && max_stay != null && max_stay < min_stay);
    if (this.form.invalid || this.datesError() || this.stayError()) return;

    const payload: RestrictionPayload = {
      from_date: raw.from_date,
      to_date: raw.to_date,
      unit_type_id: raw.unit_type_id === ALL_TYPES ? null : Number(raw.unit_type_id),
      min_stay,
      max_stay,
      closed_to_arrival: raw.closed_to_arrival,
      closed_to_departure: raw.closed_to_departure,
      stop_sell: raw.stop_sell,
    };
    this.saving.set(true);
    this.restrictionsService
      .save(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.toastService.success('Restricciones guardadas');
          this.saved.emit(result);
          this.isOpenChange.emit(false);
        },
        error: (message: unknown) => {
          this.saving.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron guardar las restricciones',
          );
        },
      });
  }

  private prefill(date: string, scope: number): void {
    const unitTypeId = scope === ALL_TYPES ? null : Number(scope);
    const current = this.restrictions().find(
      (r) => r.date === date && r.unit_type_id === unitTypeId,
    );
    this.form.patchValue(
      {
        min_stay: current?.min_stay ?? null,
        max_stay: current?.max_stay ?? null,
        closed_to_arrival: current?.closed_to_arrival ?? false,
        closed_to_departure: current?.closed_to_departure ?? false,
        stop_sell: current?.stop_sell ?? false,
      },
      { emitEvent: false },
    );
  }
}
