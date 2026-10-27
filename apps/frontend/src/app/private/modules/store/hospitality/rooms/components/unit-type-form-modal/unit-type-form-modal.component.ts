import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, startWith } from 'rxjs/operators';
import { of } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';
import { TaxesService } from '../../../../products/services/taxes.service';
import { UnitType, UnitTypePayload } from '../../interfaces/unit-type.interface';
import { UnitTypesService } from '../../services/unit-types.service';

export const MAX_CAPACITY_MESSAGE =
  'La capacidad máxima debe ser mayor que cero';

const NO_TAX = 0;

interface UnitTypeForm {
  name: FormControl<string>;
  base_occupancy: FormControl<number | null>;
  max_adults: FormControl<number | null>;
  max_children: FormControl<number | null>;
  bed_config: FormControl<string>;
  base_price: FormControl<number | null>;
  tax_category_id: FormControl<number>;
}

/**
 * Hospitality Suite (H0.2) — create/edit a room type. Saving also creates or
 * updates its "Noche – {tipo}" service product on the backend.
 */
@Component({
  selector: 'app-unit-type-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      (opened)="syncFromUnitType()"
      [size]="'md'"
      [dialog]="true"
      [title]="title()"
      subtitle="Capacidad, camas y precio base por noche"
    >
      <form [formGroup]="form" class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-input
            class="md:col-span-2"
            formControlName="name"
            label="Nombre"
            type="text"
            placeholder="Ej. Doble estándar, Suite, Cabaña"
            [required]="true"
            [control]="form.controls.name"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="base_occupancy"
            label="Ocupación base"
            type="number"
            [min]="1"
            [required]="true"
            helperText="Personas incluidas en el precio base."
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="max_adults"
            label="Máximo de adultos"
            type="number"
            [min]="1"
            [required]="true"
            [error]="maxAdultsError()"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="max_children"
            label="Máximo de niños"
            type="number"
            [min]="0"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="bed_config"
            label="Camas"
            type="text"
            placeholder="Ej. 1 doble + 1 sencilla"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="base_price"
            label="Precio base por noche"
            [currency]="true"
            [required]="true"
            [control]="form.controls.base_price"
            helperText="Antes de impuestos."
            customWrapperClass="mt-0"
          />
          <app-selector
            formControlName="tax_category_id"
            label="Impuesto"
            [options]="taxOptions()"
          />
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button variant="primary" [loading]="saving()" (clicked)="onSubmit()">
          <app-icon slot="icon" [name]="isEditMode() ? 'save' : 'plus'" [size]="16" />
          {{ isEditMode() ? 'Guardar cambios' : 'Crear tipo' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class UnitTypeFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly taxesService = inject(TaxesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly unitType = input<UnitType | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<UnitType>();

  readonly saving = signal(false);
  readonly isEditMode = computed(() => this.unitType() != null);
  readonly title = computed(() =>
    this.isEditMode()
      ? `Editar tipo: ${this.unitType()?.name ?? ''}`
      : 'Nuevo tipo de habitación',
  );

  readonly taxOptions = toSignal(
    this.taxesService.getTaxCategories().pipe(
      map((taxes): SelectorOption[] => [
        { value: NO_TAX, label: 'Sin impuesto' },
        ...taxes.map((t) => ({ value: t.id, label: t.name })),
      ]),
      catchError(() => of<SelectorOption[]>([{ value: NO_TAX, label: 'Sin impuesto' }])),
    ),
    { initialValue: [{ value: NO_TAX, label: 'Sin impuesto' }] as SelectorOption[] },
  );

  readonly form: FormGroup<UnitTypeForm> = this.fb.group<UnitTypeForm>({
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    base_occupancy: this.fb.control<number | null>(2, {
      validators: [Validators.required, Validators.min(1)],
    }),
    max_adults: this.fb.control<number | null>(2, {
      validators: [Validators.required, Validators.min(1)],
    }),
    max_children: this.fb.control<number | null>(0, {
      validators: [Validators.min(0)],
    }),
    bed_config: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(255)],
    }),
    base_price: this.fb.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
    tax_category_id: this.fb.nonNullable.control<number>(NO_TAX),
  });

  // Form status is not a signal: bridge it so the error recomputes (zoneless).
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  private readonly touched = signal(false);

  readonly maxAdultsError = computed(() => {
    this.formStatus();
    const control = this.form.controls.max_adults;
    if (!this.touched() && !control.dirty) return '';
    if (control.hasError('min')) return MAX_CAPACITY_MESSAGE;
    if (control.hasError('required')) return 'Este campo es requerido.';
    return '';
  });

  constructor() {
    effect(() => {
      this.unitType();
      this.syncFromUnitType();
    });
  }

  syncFromUnitType(): void {
    const u = this.unitType();
    this.touched.set(false);
    this.form.reset({
      name: u?.name ?? '',
      base_occupancy: u?.base_occupancy ?? 2,
      max_adults: u?.max_adults ?? 2,
      max_children: u?.max_children ?? 0,
      bed_config: u?.bed_config ?? '',
      base_price: u ? Number(u.product.base_price) : null,
      tax_category_id:
        u?.product.product_tax_assignments[0]?.tax_categories.id ?? NO_TAX,
    });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.touched.set(true);
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: UnitTypePayload = {
      name: raw.name.trim(),
      base_occupancy: raw.base_occupancy ?? 1,
      max_adults: raw.max_adults ?? 0,
      max_children: raw.max_children ?? 0,
      bed_config: raw.bed_config.trim() || undefined,
      base_price: raw.base_price ?? 0,
      tax_category_ids: raw.tax_category_id ? [raw.tax_category_id] : [],
    };
    const current = this.unitType();
    const request$ = current
      ? this.unitTypesService.update(current.id, payload)
      : this.unitTypesService.create(payload);

    this.saving.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toastService.success(
          current ? 'Tipo de habitación actualizado' : 'Tipo de habitación creado',
        );
        this.saved.emit(result);
        this.isOpenChange.emit(false);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo guardar el tipo de habitación',
        );
      },
    });
  }
}
