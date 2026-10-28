import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';

import {
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  SettingToggleComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  CardComponent,
  ToastService,
} from '../../../../../../shared/components/index';

import {
  CreatePriceTierDto,
  PriceTier,
  PriceTierAdjustmentType,
  PriceTierAmountScope,
  PriceTierKind,
  UpdatePriceTierDto,
} from '../../interfaces';
import {
  buildPriceTierRulePayload,
  isFixedAmountTierType,
} from '../../utils/price-tier-rule.util';
import { PriceTiersService, PriceTierCacheService } from '../../services';

/**
 * Reactive form group typed for the price tier form.
 * Mirrors CreatePriceTierDto with frontend defaults.
 */
interface PriceTierFormControls {
  name: FormControl<string>;
  /**
   * Eje de la tarifa. `customer_tier` = a quién le vendo (mayorista, minorista);
   * `sale_unit` = en qué presentación vendo (rollo, metro, bulto, kilo). Se pide
   * explícitamente al crear porque ambos viven en la misma tabla y los
   * selectores filtran por este valor.
   */
  kind: FormControl<PriceTierKind>;
  code: FormControl<string>;
  description: FormControl<string>;
  discount_percentage: FormControl<number | null>;
  /** Cómo la tarifa ajusta el precio; `percent_discount` usa `discount_percentage`. */
  adjustment_type: FormControl<PriceTierAdjustmentType>;
  /** Valor de los tipos nuevos (porcentaje de recargo o monto). */
  adjustment_value: FormControl<number | null>;
  /** Solo para montos fijos: por unidad o por paquete. */
  amount_scope: FormControl<PriceTierAmountScope>;
  is_active: FormControl<boolean>;
  is_default: FormControl<boolean>;
  /**
   * Optional packaging quantity. When >= 2 the tier sells by package/box and
   * the backend DERIVES `is_package_unit = (units_per_package ?? 0) >= 2`.
   * Empty/null => sells by single unit.
   */
  units_per_package: FormControl<number | null>;
  sort_order: FormControl<number | null>;
}

/**
 * Valida el valor de ajuste contra el tipo elegido (mismo builder que arma el
 * payload). El error lleva el texto a mostrar.
 */
function tierRuleValueValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const group = control.parent;
    if (!group) return null;
    const { error } = buildPriceTierRulePayload({
      adjustment_type: group.get('adjustment_type')?.value ?? 'percent_discount',
      discount_percentage: group.get('discount_percentage')?.value ?? 0,
      adjustment_value: control.value,
      amount_scope: group.get('amount_scope')?.value ?? 'per_unit',
    });
    return error ? { rule: error } : null;
  };
}

/**
 * Optional integer validator. Passes when the control is empty (optional) or
 * holds an integer value; fails for fractional/non-numeric values.
 */
function optionalIntegerValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isInteger(numeric) ? null : { integer: true };
  };
}

@Component({
  selector: 'app-price-tier-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    SettingToggleComponent,
  ],
  templateUrl: './price-tier-form-page.component.html',
  styleUrl: './price-tier-form-page.component.scss',
})
export class PriceTierFormPageComponent implements OnInit {
  /**
   * Los dos ejes que conviven sobre `price_tiers`. La etiqueta describe el uso
   * real, no el nombre técnico, porque "tarifa" a secas es justo la palabra
   * ambigua que este campo desambigua.
   */
  readonly kindOptions = [
    {
      value: 'customer_tier',
      label: 'Tarifa de cliente (a quién le vendo)',
      description: 'Mayorista, minorista, distribuidor',
    },
    {
      value: 'sale_unit',
      label: 'Unidad de venta (en qué presentación vendo)',
      description: 'Bulto, kilo, rollo, metro, palada',
    },
  ];

  readonly adjustmentTypeOptions = [
    {
      value: 'percent_discount',
      label: 'Descuento porcentual',
      description: 'Ej.: 10 % menos sobre el precio base',
    },
    {
      value: 'percent_surcharge',
      label: 'Recargo porcentual',
      description: 'Ej.: 10 % más sobre el precio base',
    },
    {
      value: 'fixed_amount_discount',
      label: 'Descuento de monto fijo',
      description: 'Ej.: $500 menos',
    },
    {
      value: 'fixed_amount_surcharge',
      label: 'Recargo de monto fijo',
      description: 'Ej.: $500 más',
    },
    {
      value: 'fixed_price',
      label: 'Precio fijo',
      description: 'Todos los productos con esta tarifa valen lo mismo',
    },
  ];

  readonly amountScopeOptions = [
    { value: 'per_unit', label: 'Por unidad' },
    { value: 'per_package', label: 'Por paquete' },
  ];

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly priceTiersService = inject(PriceTiersService);
  private readonly priceTierCache = inject(PriceTierCacheService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tierId = signal<number | null>(null);
  readonly isEditMode = computed(() => this.tierId() !== null);
  readonly isLoading = signal(false);
  readonly isSubmitting = signal(false);

  readonly form: FormGroup<PriceTierFormControls> =
    this.fb.nonNullable.group<PriceTierFormControls>({
      kind: this.fb.nonNullable.control<PriceTierKind>('customer_tier'),
      name: this.fb.nonNullable.control('', {
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      code: this.fb.nonNullable.control('', {
        validators: [Validators.maxLength(50)],
      }),
      description: this.fb.nonNullable.control('', {
        validators: [Validators.maxLength(500)],
      }),
      discount_percentage: new FormControl<number | null>(0, {
        validators: [Validators.min(0), Validators.max(100)],
      }),
      adjustment_type:
        this.fb.nonNullable.control<PriceTierAdjustmentType>('percent_discount'),
      adjustment_value: new FormControl<number | null>(null, {
        validators: [tierRuleValueValidator()],
      }),
      amount_scope:
        this.fb.nonNullable.control<PriceTierAmountScope>('per_unit'),
      is_active: this.fb.nonNullable.control(true),
      is_default: this.fb.nonNullable.control(false),
      units_per_package: new FormControl<number | null>(null, {
        validators: [Validators.min(2), optionalIntegerValidator()],
      }),
      sort_order: new FormControl<number | null>(0, {
        validators: [Validators.min(0)],
      }),
    });

  /**
   * Signal mirror of `form.status` so `computed()` can react to validity changes.
   * Without this, `headerActions` computes once with the initial invalid state
   * (name vacío = required) and the "Crear Tarifa" button stays permanently
   * disabled even after the user fills the form.
   */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly adjustmentType = toSignal(
    this.form.controls.adjustment_type.valueChanges.pipe(
      startWith(this.form.controls.adjustment_type.value),
    ),
    { initialValue: this.form.controls.adjustment_type.value },
  );
  readonly isPercentDiscount = computed(
    () => this.adjustmentType() === 'percent_discount',
  );
  readonly showsAmountScope = computed(() =>
    isFixedAmountTierType(this.adjustmentType()),
  );
  readonly adjustmentValueLabel = computed(() => {
    switch (this.adjustmentType()) {
      case 'percent_surcharge':
        return 'Recargo (%)';
      case 'fixed_amount_discount':
        return 'Monto a descontar';
      case 'fixed_amount_surcharge':
        return 'Monto a sumar';
      case 'fixed_price':
        return 'Precio fijo';
      default:
        return 'Valor';
    }
  });

  constructor() {
    // El valor se valida contra el tipo: cambiar el tipo re-evalúa el valor.
    this.form.controls.adjustment_type.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() =>
        this.form.controls.adjustment_value.updateValueAndValidity(),
      );
  }

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'cancel',
      label: 'Cancelar',
      variant: 'outline',
      disabled: this.isSubmitting(),
    },
    {
      id: 'save',
      label: this.isEditMode() ? 'Guardar Cambios' : 'Crear Tarifa',
      variant: 'primary',
      icon: 'save',
      loading: this.isSubmitting(),
      disabled: this.isSubmitting() || this.formStatus() === 'INVALID',
    },
  ]);

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0) {
        this.toastService.error('Identificador de tarifa inválido');
        this.router.navigate(['/admin/price-tiers']);
        return;
      }
      this.tierId.set(id);
      this.loadTier(id);
    }
  }

  private loadTier(id: number): void {
    this.isLoading.set(true);
    this.priceTiersService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tier) => {
          this.patchForm(tier);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al cargar la tarifa',
          );
          this.isLoading.set(false);
          this.router.navigate(['/admin/price-tiers']);
        },
      });
  }

  private patchForm(tier: PriceTier): void {
    this.form.patchValue({
      name: tier.name ?? '',
      kind: tier.kind ?? 'customer_tier',
      code: tier.code ?? '',
      description: tier.description ?? '',
      discount_percentage:
        tier.discount_percentage == null
          ? 0
          : Number(tier.discount_percentage),
      adjustment_type: tier.adjustment_type ?? 'percent_discount',
      adjustment_value:
        tier.adjustment_value == null ? null : Number(tier.adjustment_value),
      amount_scope: tier.amount_scope ?? 'per_unit',
      is_active: tier.is_active,
      is_default: tier.is_default,
      units_per_package:
        tier.units_per_package == null ? null : Number(tier.units_per_package),
      sort_order: tier.sort_order ?? 0,
    });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') {
      this.cancel();
    } else if (actionId === 'save') {
      this.save();
    }
  }

  cancel(): void {
    this.router.navigate(['/admin/price-tiers']);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.warning('Revisa los campos del formulario');
      return;
    }

    const raw = this.form.getRawValue();

    // Packaging quantity drives the backend-derived `is_package_unit`.
    // Only a valid integer >= 2 means "sells by package"; anything else
    // (empty / < 2) means "sells by single unit".
    const unitsPerPackage =
      raw.units_per_package == null ? null : Number(raw.units_per_package);
    const hasPackaging =
      unitsPerPackage != null &&
      Number.isInteger(unitsPerPackage) &&
      unitsPerPackage >= 2;

    const rule = buildPriceTierRulePayload({
      adjustment_type: raw.adjustment_type,
      discount_percentage: raw.discount_percentage,
      adjustment_value: raw.adjustment_value,
      amount_scope: raw.amount_scope,
    });
    if (rule.error) {
      this.form.controls.adjustment_value.markAsTouched();
      this.toastService.warning(rule.error);
      return;
    }

    const payload: CreatePriceTierDto = {
      name: raw.name.trim(),
      kind: raw.kind,
      code: raw.code?.trim() ? raw.code.trim() : undefined,
      description: raw.description?.trim() ? raw.description.trim() : undefined,
      ...rule.payload,
      is_active: raw.is_active,
      is_default: raw.is_default,
      // On create: only send packaging when present (omit otherwise).
      units_per_package: hasPackaging ? unitsPerPackage : undefined,
      sort_order: raw.sort_order == null ? 0 : Number(raw.sort_order),
    };

    this.isSubmitting.set(true);

    const currentId = this.tierId();
    // On edit: always send packaging explicitly so clearing the field resets
    // the tier back to single-unit (null) instead of leaving a stale value.
    const updatePayload: UpdatePriceTierDto = {
      ...payload,
      units_per_package: hasPackaging ? unitsPerPackage : null,
    };
    const request$ = currentId
      ? this.priceTiersService.update(currentId, updatePayload)
      : this.priceTiersService.create(payload);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            currentId
              ? 'Tarifa actualizada correctamente'
              : 'Tarifa creada correctamente',
          );
          // Force POS/quotations/etc. to re-fetch the catalog on next open.
          this.priceTierCache.invalidate();
          this.isSubmitting.set(false);
          this.router.navigate(['/admin/price-tiers']);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al guardar la tarifa',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  getError(fieldName: keyof PriceTierFormControls): string {
    const control = this.form.get(fieldName);
    if (!control || !control.touched || !control.errors) return '';
    if (control.errors['rule']) return control.errors['rule'];
    if (control.errors['required']) return 'Este campo es requerido';
    if (control.errors['maxlength']) return 'Texto demasiado largo';
    if (control.errors['integer']) return 'Debe ser un número entero';
    if (control.errors['min']) return `Mínimo ${control.errors['min'].min}`;
    if (control.errors['max']) return `Máximo ${control.errors['max'].max}`;
    return '';
  }
}
