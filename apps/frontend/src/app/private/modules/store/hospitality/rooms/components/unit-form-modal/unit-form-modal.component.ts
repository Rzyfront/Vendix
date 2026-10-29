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
import { injectFocusFirstField } from '../../../shared/focus-first-field';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
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
import { UnitType } from '../../interfaces/unit-type.interface';
import {
  expandUnitRange,
  LodgingUnit,
  MAX_BULK_UNITS,
} from '../../interfaces/unit.interface';
import { LodgingUnitsService } from '../../services/units.service';

interface UnitForm {
  code: FormControl<string>;
  range_from: FormControl<number | null>;
  range_to: FormControl<number | null>;
  unit_type_id: FormControl<number | null>;
  floor: FormControl<string>;
  zone: FormControl<string>;
}

/**
 * Hospitality Suite (H0.3) — create/edit a physical room. In create mode the
 * "Varias (rango)" toggle creates 101…110 in one request.
 */
@Component({
  selector: 'app-unit-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      (opened)="onOpened()"
      [size]="'md'"
      [dialog]="true"
      [title]="title()"
      subtitle="Número, tipo y ubicación de la habitación"
    >
      <form
        [formGroup]="form"
        id="unit-form"
        class="space-y-4"
        novalidate
        (ngSubmit)="onSubmit()"
      >
        @if (!isEditMode()) {
          <app-toggle
            label="Crear varias (rango)"
            [checked]="isRange()"
            (toggled)="setRange($event)"
          />
        }
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          @if (isRange()) {
            <app-input
              data-testid="unit-first-field"
              data-autofocus
              formControlName="range_from"
              label="Desde"
              type="number"
              [min]="0"
              [required]="true"
              placeholder="101"
              customWrapperClass="mt-0"
            />
            <app-input
              formControlName="range_to"
              label="Hasta"
              type="number"
              [min]="0"
              [required]="true"
              placeholder="110"
              [helperText]="'Máximo ' + maxBulk + ' habitaciones.'"
              customWrapperClass="mt-0"
            />
          } @else {
            <app-input
              data-testid="unit-first-field"
              data-autofocus
              class="md:col-span-2"
              formControlName="code"
              label="Número"
              type="text"
              placeholder="Ej. 101, Cabaña 1"
              [required]="true"
              [control]="form.controls.code"
              customWrapperClass="mt-0"
            />
          }
          <app-selector
            class="md:col-span-2"
            formControlName="unit_type_id"
            label="Tipo de habitación"
            placeholder="Selecciona un tipo"
            [required]="true"
            [options]="typeOptions()"
          />
          <app-input
            formControlName="floor"
            label="Piso"
            type="text"
            placeholder="Ej. 1"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="zone"
            label="Zona"
            type="text"
            placeholder="Ej. Jardín, Torre B"
            customWrapperClass="mt-0"
          />
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button type="submit" form="unit-form" variant="primary" [loading]="saving()">
          <app-icon slot="icon" [name]="isEditMode() ? 'save' : 'plus'" [size]="16" />
          {{ isEditMode() ? 'Guardar cambios' : 'Crear' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class UnitFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly unitsService = inject(LodgingUnitsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly focusFirstField = injectFocusFirstField();

  readonly isOpen = input(false);
  readonly unit = input<LodgingUnit | null>(null);
  readonly unitTypes = input<UnitType[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<void>();

  readonly maxBulk = MAX_BULK_UNITS;
  readonly saving = signal(false);
  readonly isRange = signal(false);
  readonly isEditMode = computed(() => this.unit() != null);
  readonly title = computed(() =>
    this.isEditMode()
      ? `Editar habitación ${this.unit()?.code ?? ''}`
      : 'Nueva habitación',
  );
  readonly typeOptions = computed<SelectorOption[]>(() =>
    this.unitTypes()
      .filter((t) => t.is_active || t.id === this.unit()?.unit_type_id)
      .map((t) => ({ value: t.id, label: t.name })),
  );

  readonly form: FormGroup<UnitForm> = this.fb.group<UnitForm>({
    code: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(30)],
    }),
    range_from: this.fb.control<number | null>(null),
    range_to: this.fb.control<number | null>(null),
    unit_type_id: this.fb.control<number | null>(null, {
      validators: [Validators.required],
    }),
    floor: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(30)],
    }),
    zone: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(60)],
    }),
  });

  constructor() {
    effect(() => {
      this.unit();
      this.syncFromUnit();
    });
  }

  syncFromUnit(): void {
    const u = this.unit();
    this.isRange.set(false);
    this.form.reset({
      code: u?.code ?? '',
      range_from: null,
      range_to: null,
      unit_type_id:
        u?.unit_type_id ?? this.unitTypes().find((t) => t.is_active)?.id ?? null,
      floor: u?.floor ?? '',
      zone: u?.zone ?? '',
    });
  }

  onOpened(): void {
    this.syncFromUnit();
    this.focusFirstField();
  }

  /** Switching to range mode swaps "Número" for "Desde": focus it too. */
  setRange(enabled: boolean): void {
    this.isRange.set(enabled);
    this.focusFirstField();
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    const raw = this.form.getRawValue();
    // Only the type is checked here: app-input adds `required` to `code`,
    // which must not block range mode; number and range are checked below.
    if (raw.unit_type_id == null) {
      this.form.markAllAsTouched();
      this.toastService.error('Selecciona el tipo de habitación');
      return;
    }
    const common = {
      unit_type_id: raw.unit_type_id,
      floor: raw.floor.trim() || undefined,
      zone: raw.zone.trim() || undefined,
    };
    const current = this.unit();
    let request$: Observable<unknown>;

    if (current) {
      const code = raw.code.trim();
      if (!code) {
        this.toastService.error('Escribe el número de la habitación');
        return;
      }
      request$ = this.unitsService.update(current.id, {
        ...common,
        code,
        floor: raw.floor.trim(),
        zone: raw.zone.trim(),
      });
    } else if (this.isRange()) {
      const codes = expandUnitRange(Number(raw.range_from), Number(raw.range_to));
      if (!codes) {
        this.toastService.error(
          `El rango no es válido: "Hasta" debe ser mayor o igual que "Desde" y máximo ${MAX_BULK_UNITS} habitaciones`,
        );
        return;
      }
      request$ = this.unitsService.createBulk({ ...common, codes });
    } else {
      const code = raw.code.trim();
      if (!code) {
        this.toastService.error('Escribe el número de la habitación');
        return;
      }
      request$ = this.unitsService.create({ ...common, code });
    }

    this.saving.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toastService.success(
          current
            ? 'Habitación actualizada'
            : this.isRange()
              ? 'Habitaciones creadas'
              : 'Habitación creada',
        );
        this.saved.emit();
        this.isOpenChange.emit(false);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo guardar la habitación',
        );
      },
    });
  }
}
