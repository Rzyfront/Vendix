import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map, startWith, switchMap } from 'rxjs/operators';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency';

import {
  CreateFormulaDto,
  FORMULA_STATUS_LABELS,
  FormulaCost,
  FormulaStatus,
  ManufacturingProductOption,
} from '../../../interfaces';
import { ManufacturingFormulasService } from '../../../services';
import {
  ProductProfileModalComponent,
  ProductProfileProduct,
  ProductProfileRecipe,
} from '../../../../../../../shared/components/product-profile/index';
import { ReplaceRecipeItemDto } from '../../../../restaurant-ops/recipes/interfaces';

interface FormulaFormShape {
  product_id: FormControl<number | null>;
  code: FormControl<string>;
  version: FormControl<number | null>;
  status: FormControl<FormulaStatus>;
  yield_quantity: FormControl<number | null>;
  yield_unit: FormControl<string>;
  waste_percent: FormControl<number | null>;
  preparation_notes: FormControl<string>;
}

interface FormulaItemControls {
  id: FormControl<number | null>;
  component_product_id: FormControl<number | null>;
  quantity: FormControl<number | null>;
  waste_percent: FormControl<number | null>;
}

interface LiveCostLine {
  name: string;
  unit: string;
  effectiveQuantity: number;
  unitCost: number | null;
  lineCost: number;
}

/** Exige al menos un componente (Validators.minLength no aplica a FormArray). */
function atLeastOneItemValidator(
  control: AbstractControl,
): ValidationErrors | null {
  return control instanceof FormArray && control.length === 0
    ? { minItems: true }
    : null;
}

const LIST_ROUTE = '/admin/manufacturing/formulas';

@Component({
  selector: 'app-formula-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    ButtonComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    CurrencyPipe,
    DecimalPipe,
    ProductProfileModalComponent,
  ],
  templateUrl: './formula-form-page.component.html',
})
export class FormulaFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly formulasService = inject(ManufacturingFormulasService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly isEditMode = signal(false);
  readonly formulaId = signal<number | null>(null);
  readonly isLoadingFormula = signal(false);
  readonly isLoadingProducts = signal(false);
  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);

  /** Productos activos no-servicio (terminados e insumos). */
  readonly products = signal<ManufacturingProductOption[]>([]);
  /** Ficha del producto fabricado: mismo componente que recetas y KDS. */
  readonly isProfileOpen = signal(false);

  readonly profileProduct = computed<ProductProfileProduct | null>(() => {
    const id = Number(this.formValue().product_id);
    if (!id) return null;
    const product = this.products().find((p) => p.id === id);
    if (!product) return null;
    return {
      id: product.id,
      name: product.name,
      sku: product.sku ?? null,
      description: product.description ?? null,
      stock_unit: product.stock_unit ?? null,
      image_url: product.image_url ?? null,
      product_images: product.product_images ?? [],
    };
  });

  readonly profileRecipe = computed<ProductProfileRecipe | null>(() => {
    const rows = this.itemsValue();
    if (!rows.length) return null;
    const values = this.formValue();
    return {
      yield_quantity: values.yield_quantity ?? 0,
      yield_unit: values.yield_unit ?? '',
      waste_percent: values.waste_percent ?? 0,
      preparation_notes: values.preparation_notes ?? null,
      items: rows.map((row) => ({
        component_product_id: Number(row.component_product_id),
        name: this.productName(Number(row.component_product_id)),
        quantity: row.quantity ?? 0,
        waste_percent: row.waste_percent ?? 0,
        stock_unit:
          this.products().find((p) => p.id === Number(row.component_product_id))
            ?.stock_unit ?? null,
      })),
    };
  });

  private productName(id: number): string {
    return this.products().find((p) => p.id === id)?.name ?? `Producto #${id}`;
  }

  /** Costo guardado en servidor (solo fórmulas ya creadas). */
  readonly serverCost = signal<FormulaCost | null>(null);

  readonly statusOptions: SelectorOption[] = (
    Object.keys(FORMULA_STATUS_LABELS) as FormulaStatus[]
  ).map((value) => ({ value, label: FORMULA_STATUS_LABELS[value] }));

  readonly yieldUnitOptions: SelectorOption[] = [
    { value: 'unidad', label: 'Unidad' },
    { value: 'kg', label: 'Kilogramos (kg)' },
    { value: 'g', label: 'Gramos (g)' },
    { value: 'L', label: 'Litros (L)' },
    { value: 'ml', label: 'Mililitros (ml)' },
    { value: 'm', label: 'Metros (m)' },
    { value: 'm2', label: 'Metros cuadrados (m2)' },
    { value: 'lote', label: 'Lote' },
  ];

  readonly itemsArray = this.fb.nonNullable.array<FormGroup<FormulaItemControls>>(
    [],
    { validators: [atLeastOneItemValidator] },
  );

  readonly form: FormGroup<FormulaFormShape> = this.fb.nonNullable.group<FormulaFormShape>({
    product_id: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required],
    }),
    code: this.fb.nonNullable.control('', { validators: [Validators.maxLength(30)] }),
    version: this.fb.nonNullable.control<number | null>(1, {
      validators: [Validators.min(1)],
    }),
    status: this.fb.nonNullable.control<FormulaStatus>('draft'),
    yield_quantity: this.fb.nonNullable.control<number | null>(1, {
      validators: [Validators.required, Validators.min(0.0001)],
    }),
    yield_unit: this.fb.nonNullable.control('unidad', {
      validators: [Validators.required, Validators.maxLength(20)],
    }),
    waste_percent: this.fb.nonNullable.control<number | null>(0, {
      validators: [Validators.min(0), Validators.max(100)],
    }),
    preparation_notes: this.fb.nonNullable.control(''),
  });

  /** Puentes form → signal (form.status / valueChanges no son signals). */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  private readonly itemsStatus = toSignal(
    this.itemsArray.statusChanges.pipe(startWith(this.itemsArray.status)),
    { initialValue: this.itemsArray.status },
  );
  private readonly itemsValue = toSignal(
    this.itemsArray.valueChanges.pipe(startWith(this.itemsArray.getRawValue())),
    { initialValue: this.itemsArray.getRawValue() },
  );
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(
      map(() => this.form.getRawValue()),
      startWith(this.form.getRawValue()),
    ),
    { initialValue: this.form.getRawValue() },
  );

  readonly productOptions = computed<SelectorOption[]>(() =>
    this.products().map((p) => ({
      value: p.id,
      label: p.name + (p.sku ? ` (${p.sku})` : ''),
      description: p.stock_unit ? `Unidad: ${p.stock_unit}` : undefined,
      imageUrl: p.image_url ?? p.product_images?.[0]?.image_url ?? undefined,
    })),
  );

  /** Insumos elegibles: todos menos el producto que se fabrica. */
  readonly componentOptions = computed<SelectorOption[]>(() => {
    const yieldId = Number(this.formValue().product_id);
    return this.productOptions().filter((o) => Number(o.value) !== yieldId);
  });

  /** Costo unitario conocido por insumo: servidor primero, luego `cost_price`. */
  private readonly knownUnitCosts = computed<Map<number, number>>(() => {
    const costMap = new Map<number, number>();
    for (const p of this.products()) {
      const cost = Number(p.cost_price);
      if (Number.isFinite(cost) && p.cost_price != null && p.cost_price !== '') {
        costMap.set(p.id, cost);
      }
    }
    for (const line of this.serverCost()?.lines ?? []) {
      costMap.set(line.component_product_id, Number(line.unit_cost) || 0);
    }
    return costMap;
  });

  /** Costo teórico en vivo, recalculado localmente mientras se edita. */
  readonly liveCost = computed(() => {
    const costs = this.knownUnitCosts();
    const products = this.products();
    const lines: LiveCostLine[] = [];
    let total = 0;
    let missing = 0;
    for (const raw of this.itemsValue()) {
      const productId = Number(raw.component_product_id);
      if (!productId) continue;
      const product = products.find((p) => p.id === productId);
      const qty = Number(raw.quantity) || 0;
      const waste = Number(raw.waste_percent) || 0;
      const effective = qty * (1 + waste / 100);
      const unitCost = costs.get(productId) ?? null;
      if (unitCost == null) missing++;
      const lineCost = effective * (unitCost ?? 0);
      total += lineCost;
      lines.push({
        name: product?.name ?? `Producto #${productId}`,
        unit: product?.stock_unit ?? '',
        effectiveQuantity: effective,
        unitCost,
        lineCost,
      });
    }
    const yieldQty = Number(this.formValue().yield_quantity) || 0;
    return {
      lines,
      total,
      unit: yieldQty > 0 ? total / yieldQty : 0,
      missing,
    };
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const invalid =
      this.formStatus() !== 'VALID' ||
      this.itemsStatus() !== 'VALID' ||
      this.isLoadingFormula();
    return [
      { id: 'cancel', label: 'Cancelar', variant: 'outline', disabled: false },
      {
        id: 'save',
        label: this.isEditMode() ? 'Guardar cambios' : 'Crear fórmula',
        icon: this.isEditMode() ? 'save' : 'plus',
        variant: 'primary',
        loading: this.isSubmitting(),
        disabled: invalid || this.isSubmitting(),
      },
    ];
  });

  ngOnInit(): void {
    this.loadProducts();
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode.set(true);
      this.formulaId.set(Number(id));
      this.form.controls.product_id.disable({ emitEvent: false });
      this.loadFormula(Number(id));
    } else {
      this.addItem();
    }
  }

  // ─── Carga ───────────────────────────────────────────────────────────────

  private loadProducts(): void {
    this.isLoadingProducts.set(true);
    this.formulasService
      .listProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.products.set(rows.filter((p) => p.product_type !== 'service'));
          this.isLoadingProducts.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'No se pudieron cargar los productos',
          );
          this.isLoadingProducts.set(false);
        },
      });
  }

  private loadFormula(id: number): void {
    this.isLoadingFormula.set(true);
    this.formulasService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (formula) => {
          this.form.patchValue({
            product_id: formula.product_id,
            code: formula.code ?? '',
            version: formula.version != null ? Number(formula.version) : 1,
            status: formula.status ?? 'draft',
            yield_quantity: Number(formula.yield_quantity ?? 1),
            yield_unit: formula.yield_unit ?? 'unidad',
            waste_percent: Number(formula.waste_percent ?? 0),
            preparation_notes: formula.preparation_notes ?? '',
          });
          this.itemsArray.clear({ emitEvent: false });
          for (const item of formula.items ?? []) {
            this.itemsArray.push(
              this.buildItemGroup({
                id: item.id,
                component_product_id: item.component_product_id,
                quantity: Number(item.quantity ?? 0),
                waste_percent: Number(item.waste_percent ?? 0),
              }),
            );
          }
          this.isLoadingFormula.set(false);
          this.loadServerCost(id);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'No se pudo cargar la fórmula',
          );
          this.isLoadingFormula.set(false);
          this.router.navigate([LIST_ROUTE]);
        },
      });
  }

  private loadServerCost(id: number): void {
    this.formulasService
      .getCost(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cost) => this.serverCost.set(cost),
        error: () => this.serverCost.set(null),
      });
  }

  // ─── Componentes ─────────────────────────────────────────────────────────

  private buildItemGroup(
    value: Partial<{
      id: number | null;
      component_product_id: number | null;
      quantity: number | null;
      waste_percent: number | null;
    }> = {},
  ): FormGroup<FormulaItemControls> {
    return this.fb.nonNullable.group<FormulaItemControls>({
      id: this.fb.nonNullable.control<number | null>(value.id ?? null),
      component_product_id: this.fb.nonNullable.control<number | null>(
        value.component_product_id ?? null,
        { validators: [Validators.required] },
      ),
      quantity: this.fb.nonNullable.control<number | null>(value.quantity ?? 1, {
        validators: [Validators.required, Validators.min(0.0001)],
      }),
      waste_percent: this.fb.nonNullable.control<number | null>(
        value.waste_percent ?? 0,
        { validators: [Validators.min(0), Validators.max(100)] },
      ),
    });
  }

  addItem(): void {
    this.itemsArray.push(this.buildItemGroup());
    this.itemsArray.markAsDirty();
  }

  removeItem(index: number): void {
    this.itemsArray.removeAt(index);
    this.itemsArray.markAsDirty();
  }

  unitOf(productId: number | null | undefined): string {
    // Lee la señal de valores para que la plantilla se repinte al elegir insumo.
    this.itemsValue();
    if (productId == null) return '';
    return this.products().find((p) => p.id === Number(productId))?.stock_unit ?? '';
  }

  // ─── Acciones ────────────────────────────────────────────────────────────

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') this.cancel();
    if (actionId === 'save') this.submit();
  }

  private cancel(): void {
    if (this.form.dirty || this.itemsArray.dirty) {
      this.dialogService
        .confirm({
          title: 'Descartar cambios',
          message: 'Tienes cambios sin guardar. ¿Salir sin guardar?',
          confirmText: 'Salir sin guardar',
          cancelText: 'Continuar editando',
          confirmVariant: 'danger',
        })
        .then((confirmed: boolean) => {
          if (confirmed) this.router.navigate([LIST_ROUTE]);
        });
    } else {
      this.router.navigate([LIST_ROUTE]);
    }
  }

  submit(): void {
    this.submitError.set(null);
    this.form.markAllAsTouched();
    this.itemsArray.markAllAsTouched();
    if (this.form.invalid || this.itemsArray.invalid) {
      const errors: string[] = [];
      if (this.itemsArray.length === 0) {
        errors.push('Agrega al menos un componente a la fórmula.');
      } else if (this.itemsArray.invalid) {
        errors.push(
          'Revisa los componentes: cada uno necesita un insumo y una cantidad mayor a 0.',
        );
      }
      if (this.form.invalid) {
        errors.push('Completa los campos obligatorios del encabezado.');
      }
      this.submitError.set(errors.join(' '));
      this.toastService.warning('Revisa los campos marcados antes de guardar');
      return;
    }

    const raw = this.form.getRawValue();
    const status = raw.status;
    const base = {
      yield_quantity: Number(raw.yield_quantity ?? 0),
      yield_unit: raw.yield_unit,
      waste_percent: Number(raw.waste_percent ?? 0),
      preparation_notes: raw.preparation_notes || undefined,
      status,
      ...(raw.code.trim() ? { code: raw.code.trim() } : {}),
      ...(raw.version != null ? { version: Number(raw.version) } : {}),
    };

    const items: ReplaceRecipeItemDto[] = this.itemsArray.controls.map((group) => {
      const item = group.getRawValue();
      return {
        id: item.id ?? undefined,
        component_product_id: Number(item.component_product_id),
        quantity: Number(item.quantity ?? 0),
        waste_percent: Number(item.waste_percent ?? 0),
        waste_mode: 'percent',
        is_optional: false,
      };
    });

    const wasEdit = this.isEditMode();
    const upsert$ = wasEdit
      ? this.formulasService.update(this.formulaId() as number, base)
      : this.formulasService.create({
          product_id: Number(raw.product_id),
          ...base,
        } as CreateFormulaDto);

    this.isSubmitting.set(true);
    upsert$
      .pipe(
        switchMap((formula) => {
          if (!formula || formula.id == null) {
            throw new Error('Respuesta inválida del servidor. Intenta de nuevo.');
          }
          // Si el reemplazo de componentes falla, el reintento actualiza la
          // fórmula ya creada en vez de duplicarla.
          this.formulaId.set(formula.id);
          this.isEditMode.set(true);
          this.form.controls.product_id.disable({ emitEvent: false });
          return this.formulasService.replaceItems(formula.id, items);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.toastService.success(
            wasEdit ? 'Fórmula actualizada correctamente' : 'Fórmula creada correctamente',
          );
          this.router.navigate([LIST_ROUTE]);
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          const message =
            typeof err === 'string'
              ? err
              : ((err as { message?: string } | null)?.message ??
                'Error al guardar la fórmula');
          this.submitError.set(message);
          this.toastService.error(message, 'No se pudo guardar la fórmula', 6000);
        },
      });
  }
}
