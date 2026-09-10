import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { startWith } from 'rxjs/operators';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  TaxInclusiveChipComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import { TaxesService } from '../../services/taxes.service';
import {
  CreateTaxCategoryDto,
  TAX_FISCAL_TYPE_OPTIONS,
  TaxCategory,
  TaxFiscalType,
  UpdateTaxCategoryDto,
  taxFirstRate,
  taxRatePercent,
} from '../../interfaces/tax-category.interface';

interface TaxFormControls {
  name: FormControl<string>;
  description: FormControl<string>;
  tax_type: FormControl<TaxFiscalType>;
  /** Porcentaje UI (19 = 19%). Solo aplica en creación (ver nota v1). */
  rate: FormControl<number | null>;
  is_compound: FormControl<boolean>;
  is_inclusive: FormControl<boolean>;
}

/**
 * Modal crear/editar categoría de impuesto (tasa única por categoría en v1).
 *
 * v1 — el backend NO acepta tasas anidadas (`CreateTaxCategoryDto` trae `rate`
 * plano y el servicio crea UNA `tax_rate`; `PATCH :id` no toca `tax_rates`):
 * en edición la tasa y `is_compound` se muestran deshabilitados y se excluyen
 * del payload (enviarlos rompería el update de Prisma: no son columnas de
 * `tax_categories`). Tampoco hay columna de estado en backend: el alta/baja
 * va por archivar (DELETE) desde la lista.
 *
 * Zoneless: `form.invalid`/`form.value` nunca se leen dentro de
 * `computed()`/`effect()`; el estado se puentea con
 * `toSignal(statusChanges/valueChanges)` + `initialValue`.
 */
@Component({
  selector: 'app-tax-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    TaxInclusiveChipComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onCancel()"
      size="md"
      [title]="tax() ? 'Editar Impuesto' : 'Nuevo Impuesto'"
      subtitle="Tasa única por categoría en esta v1"
    >
      <form [formGroup]="form" class="space-y-4">
        <app-input
          label="Nombre"
          placeholder="Ej: IVA 19%"
          formControlName="name"
          [required]="true"
          [maxlength]="255"
        ></app-input>

        <app-input
          label="Descripción (opcional)"
          placeholder="Ej: IVA general bienes y servicios"
          formControlName="description"
        ></app-input>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-selector
            label="Tipo fiscal"
            [options]="taxTypeOptions"
            formControlName="tax_type"
            [required]="true"
            helpText="Define cuenta PUC, declaración y código DIAN."
          ></app-selector>
          <app-input
            label="Tasa (%)"
            type="number"
            placeholder="Ej: 19"
            helperText="Porcentaje. Se guarda como fracción (19% → 0.19)."
            formControlName="rate"
            [required]="true"
            min="0"
            max="100"
          ></app-input>
        </div>
        @if (tax()) {
          <p class="text-xs text-text-muted">
            La tasa se define al crear el impuesto; en esta v1 no se edita.
          </p>
        }

        <div class="flex items-center gap-3 pt-1">
          <app-toggle formControlName="is_compound" label="Compuesto"></app-toggle>
          <span class="text-xs text-text-muted">
            Se calcula sobre base + otros impuestos. Solo al crear.
          </span>
        </div>

        <!-- Incluido / Adicional con el chip compartido (no duplicado). -->
        <div class="space-y-2 rounded-lg border border-border p-3">
          <span class="text-sm font-medium text-text-primary">
            El precio unitario…
          </span>
          <vendix-tax-inclusive-chip
            [name]="chipName()"
            [rate]="chipRate()"
            [inclusive]="chipInclusive()"
            hint="Incluido = el precio ya trae el impuesto dentro. Adicional = se suma sobre el precio."
            (inclusiveChange)="isInclusiveControl.setValue($event)"
            (remove)="isInclusiveControl.setValue(false)"
          />
          <p class="text-xs text-text-muted">
            En este editor de un solo impuesto, Quitar equivale a Adicional
            (no hay nada de lo cual desprenderlo).
          </p>
        </div>
      </form>

      <div
        slot="footer"
        class="flex justify-end gap-3 pt-4 border-t border-border mt-4"
      >
        <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          variant="primary"
          (clicked)="onSave()"
          [disabled]="!canSave()"
          [loading]="saving()"
        >
          <app-icon name="save" [size]="16" slot="icon"></app-icon>
          {{ tax() ? 'Guardar Cambios' : 'Crear Impuesto' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TaxFormModalComponent {
  private destroyRef = inject(DestroyRef);
  private service = inject(TaxesService);
  private toast = inject(ToastService);

  /** Visibilidad two-way del modal. */
  readonly isOpen = model<boolean>(false);
  /** Impuesto en edición; `null` = modo creación. */
  readonly tax = input<TaxCategory | null>(null);
  /** Se emite tras crear/actualizar para que el padre refresque. */
  readonly saved = output<void>();

  readonly saving = signal(false);

  readonly taxTypeOptions = TAX_FISCAL_TYPE_OPTIONS;

  readonly form = new FormGroup<TaxFormControls>({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    description: new FormControl('', { nonNullable: true }),
    tax_type: new FormControl<TaxFiscalType>('iva', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    rate: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0), Validators.max(100)],
    }),
    is_compound: new FormControl(false, { nonNullable: true }),
    is_inclusive: new FormControl(false, { nonNullable: true }),
  });

  get isInclusiveControl(): FormControl<boolean> {
    return this.form.get('is_inclusive') as FormControl<boolean>;
  }

  /** Puente zoneless-safe de validez (nunca `form.invalid` en computed). */
  private readonly status = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  /** Puente zoneless-safe del valor para el chip (nunca `form.value` en computed). */
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  readonly canSave = computed(
    () => this.status() === 'VALID' && !this.saving(),
  );

  readonly chipName = computed(() => {
    const name = this.formValue().name?.trim();
    return name ? name : 'Impuesto';
  });

  readonly chipRate = computed(() => {
    const rate = Number(this.formValue().rate ?? 0);
    return Number.isFinite(rate) ? rate : 0;
  });

  readonly chipInclusive = computed(
    () => this.formValue().is_inclusive ?? false,
  );

  constructor() {
    // Rehidrata el formulario al abrir o al cambiar el impuesto editado.
    effect(() => {
      const open = this.isOpen();
      const editing = this.tax();
      if (!open) return;

      if (editing) {
        const firstRate = taxFirstRate(editing);
        this.form.reset({
          name: editing.name ?? '',
          description: editing.description ?? '',
          tax_type: editing.tax_type ?? 'iva',
          rate: taxRatePercent(editing),
          is_compound: firstRate?.is_compound ?? false,
          is_inclusive: editing.is_inclusive ?? firstRate?.is_inclusive ?? false,
        });
        // v1: PATCH no toca tax_rates → tasa/compuesto no editables.
        this.form.get('rate')?.disable();
        this.form.get('is_compound')?.disable();
      } else {
        this.form.get('rate')?.enable();
        this.form.get('is_compound')?.enable();
        this.resetForm();
      }
    });
  }

  onSave(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const editing = this.tax();

    if (editing) {
      // Solo columnas reales de tax_categories (ver nota v1 del archivo).
      const dto: UpdateTaxCategoryDto = {
        name: raw.name.trim(),
        tax_type: raw.tax_type,
        is_inclusive: raw.is_inclusive,
      };
      const description = raw.description.trim();
      if (description) dto.description = description;
      this.service
        .update(editing.id, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.onSaved('Impuesto actualizado'),
          error: (err) => this.onError(err, 'No se pudo actualizar el impuesto'),
        });
      return;
    }

    const dto: CreateTaxCategoryDto = {
      name: raw.name.trim(),
      type: 'percentage',
      tax_type: raw.tax_type,
      rate: Number(raw.rate ?? 0),
      is_inclusive: raw.is_inclusive,
      is_compound: raw.is_compound,
    };
    const description = raw.description.trim();
    if (description) dto.description = description;
    this.service
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.onSaved('Impuesto creado exitosamente'),
        error: (err) => this.onError(err, 'No se pudo crear el impuesto'),
      });
  }

  onCancel(): void {
    this.close();
  }

  private onSaved(message: string): void {
    this.toast.success(message);
    this.saving.set(false);
    this.saved.emit();
    this.close();
  }

  private onError(err: unknown, fallback: string): void {
    this.saving.set(false);
    this.toast.error(typeof err === 'string' ? err : fallback);
  }

  private close(): void {
    this.isOpen.set(false);
  }

  private resetForm(): void {
    this.form.reset({
      name: '',
      description: '',
      tax_type: 'iva',
      rate: null,
      is_compound: false,
      is_inclusive: false,
    });
  }
}
