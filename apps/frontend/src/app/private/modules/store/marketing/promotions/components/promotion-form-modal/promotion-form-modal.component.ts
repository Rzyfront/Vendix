import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import {
  ReactiveFormsModule,
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Promotion,
  PromotionQuantityTier,
  PromotionRuleType,
  CreatePromotionDto,
  UpdatePromotionDto,
} from '../../interfaces/promotion.interface';
import {
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../../../shared/components/multi-selector/multi-selector.component';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  SettingToggleComponent,
} from '../../../../../../../shared/components';
import { ProductsService } from '../../../../products/services/products.service';
import { CategoriesService } from '../../../../products/services/categories.service';

@Component({
  selector: 'app-promotion-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MultiSelectorComponent,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    SettingToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="promotion() ? 'Editar Promocion' : 'Nueva Promocion'"
      size="lg"
      (closed)="close.emit(undefined)"
    >
      <form [formGroup]="form" class="space-y-3">

        <!-- Name + Code -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="sm:col-span-2">
            <app-input
              label="Nombre"
              formControlName="name"
              placeholder="Ej: Descuento de bienvenida"
              [required]="true"
              [error]="form.get('name')?.touched && form.get('name')?.invalid ? 'El nombre es requerido' : ''"
            ></app-input>
          </div>
          <app-input
            label="Codigo (cupon)"
            formControlName="code"
            placeholder="Ej: BIENVENIDO20"
            customInputClass="font-mono uppercase"
          ></app-input>
        </div>

        <!-- Description -->
        <app-textarea
          label="Descripcion"
          formControlName="description"
          placeholder="Descripcion de la promocion..."
          [rows]="2"
        ></app-textarea>

        <!-- Rule type selector: flat (single discount) vs quantity_tiered (FormArray editor) -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-selector
            label="Regla"
            [options]="ruleTypeOptions"
            formControlName="rule_type"
            [required]="true"
          ></app-selector>

          <app-selector
            label="Alcance"
            [options]="scopeOptions"
            formControlName="scope"
          ></app-selector>
        </div>

        <!-- Flat: Type + Value -->
        @if (form.get('rule_type')?.value === 'flat') {
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <app-selector
              label="Tipo"
              [options]="typeOptions"
              formControlName="type"
              [required]="true"
            ></app-selector>

            <app-input
              label="Valor"
              type="number"
              formControlName="value"
              [required]="true"
              placeholder="0"
              [prefixIcon]="true"
              [min]="0"
              [max]="form.get('type')?.value === 'percentage' ? 100 : ''"
              [error]="flatValueError()"
            >
              <span slot="prefix-icon">{{ form.get('type')?.value === 'percentage' ? '%' : '$' }}</span>
            </app-input>
            <div></div>
          </div>
        }

        <!-- Quantity-tiered: editor -->
        @if (form.get('rule_type')?.value === 'quantity_tiered') {
          <div class="border border-border rounded-lg p-3 bg-background space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-sm font-semibold text-text-primary">Escalas por cantidad</h4>
                <p class="text-xs text-text-secondary">
                  Define rangos ascendentes de cantidad. Solo la ultima escala puede quedar abierta (sin maximo).
                </p>
              </div>
              <app-button variant="outline" size="sm" (clicked)="addTier()">
                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                Anadir escala
              </app-button>
            </div>

            @if (quantityTiers.length === 0) {
              <div class="text-center py-6 text-xs text-text-secondary border border-dashed border-border rounded-md">
                No hay escalas. Agrega al menos una para activar esta regla.
              </div>
            }

            @if (quantityTiersError()) {
              <p class="text-xs text-red-500">{{ quantityTiersError() }}</p>
            }

            <div formArrayName="quantity_tiers" class="space-y-3">
              @for (tier of quantityTiers.controls; track $index; let i = $index) {
                <div [formGroupName]="i" class="border border-border rounded-lg p-3 bg-surface space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-text-secondary">Escala {{ i + 1 }}</span>
                    <app-button variant="ghost" size="sm" (clicked)="removeTier(i)">
                      <app-icon slot="icon" name="trash-2" [size]="14" class="text-red-500"></app-icon>
                    </app-button>
                  </div>

                  <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <app-input
                      label="Cantidad min."
                      type="number"
                      formControlName="min_quantity"
                      [required]="true"
                      [min]="1"
                      [error]="tierFieldError(i, 'min_quantity')"
                    ></app-input>

                    <app-input
                      label="Cantidad max."
                      type="number"
                      formControlName="max_quantity"
                      [min]="1"
                      [error]="tierFieldError(i, 'max_quantity')"
                      placeholder="Solo ultima"
                    ></app-input>

                    <app-selector
                      label="Tipo"
                      [options]="typeOptions"
                      formControlName="type"
                      [required]="true"
                    ></app-selector>

                    <app-input
                      label="Valor"
                      type="number"
                      formControlName="value"
                      [required]="true"
                      [min]="0.01"
                      [max]="tier.get('type')?.value === 'percentage' ? 100 : ''"
                      [prefixIcon]="true"
                      [error]="tierFieldError(i, 'value')"
                    >
                      <span slot="prefix-icon">{{ tier.get('type')?.value === 'percentage' ? '%' : '$' }}</span>
                    </app-input>

                    <app-input
                      label="Orden"
                      type="number"
                      formControlName="sort_order"
                      [min]="0"
                    ></app-input>
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Product Selector (when scope is product) -->
        @if (form.get('scope')?.value === 'product') {
          <app-multi-selector
            label="Productos elegibles"
            [options]="productOptions()"
            formControlName="product_ids"
            placeholder="Buscar productos..."
            [required]="true"
            [errorText]="form.get('product_ids')?.touched && form.get('product_ids')?.invalid ? 'Selecciona al menos un producto para esta promocion' : ''"
          ></app-multi-selector>
          <p class="text-xs text-gray-500 -mt-1">
            La promocion solo aplicara cuando los productos seleccionados esten en el carrito.
          </p>
        }

        <!-- Category Selector (when scope is category) -->
        @if (form.get('scope')?.value === 'category') {
          <app-multi-selector
            label="Categorias elegibles"
            [options]="categoryOptions()"
            formControlName="category_ids"
            placeholder="Buscar categorias..."
            [required]="true"
            [errorText]="form.get('category_ids')?.touched && form.get('category_ids')?.invalid ? 'Selecciona al menos una categoria para esta promocion' : ''"
          ></app-multi-selector>
          <p class="text-xs text-gray-500 -mt-1">
            La promocion aplicara a todos los productos que pertenezcan a las categorias seleccionadas.
          </p>
        }

        <!-- Helper note for order scope -->
        @if (form.get('scope')?.value === 'order') {
          <p class="text-xs text-gray-500">
            La promocion aplicara al total de la compra cuando se cumpla la compra minima configurada.
          </p>
        }

        <!-- Dates + Min purchase -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Fecha inicio"
            type="date"
            formControlName="start_date"
            [required]="true"
            [error]="form.get('start_date')?.touched && form.get('start_date')?.invalid ? 'La fecha de inicio es requerida' : ''"
          ></app-input>
          <app-input
            label="Fecha fin"
            type="date"
            formControlName="end_date"
          ></app-input>
          <app-input
            label="Compra minima"
            type="number"
            formControlName="min_purchase_amount"
            placeholder="0"
            [min]="0"
          ></app-input>
        </div>

        <!-- Limits row -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          @if (form.get('type')?.value === 'percentage') {
            <app-input
              label="Descuento maximo"
              type="number"
              formControlName="max_discount_amount"
              placeholder="Sin limite"
              [min]="0"
            ></app-input>
          }
          <app-input
            label="Limite de usos"
            type="number"
            formControlName="usage_limit"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
          <app-input
            label="Limite por cliente"
            type="number"
            formControlName="per_customer_limit"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
        </div>

        <!-- Auto-apply + Priority -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <app-setting-toggle
            label="Aplicar automaticamente"
            description="Se aplica sin necesidad de codigo"
            formControlName="is_auto_apply"
          ></app-setting-toggle>
          <app-input
            label="Prioridad"
            type="number"
            formControlName="priority"
            placeholder="0"
            [min]="0"
          ></app-input>
        </div>

      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end items-center gap-3">
        <app-button variant="outline" (clicked)="close.emit(undefined)">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSubmit()" [disabled]="form.invalid">
          {{ promotion() ? 'Guardar cambios' : 'Crear Promocion' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PromotionFormModalComponent {
  readonly promotion = input<Promotion | null>(null);
  readonly save = output<CreatePromotionDto | UpdatePromotionDto>();
  readonly close = output<void>();

  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);

  form!: FormGroup;
  readonly productOptions = signal<MultiSelectorOption[]>([]);
  readonly categoryOptions = signal<MultiSelectorOption[]>([]);

  typeOptions: SelectorOption[] = [
    { value: 'percentage', label: 'Porcentaje' },
    { value: 'fixed_amount', label: 'Monto fijo' },
  ];

  scopeOptions: SelectorOption[] = [
    { value: 'order', label: 'Orden completa' },
    { value: 'product', label: 'Producto especifico' },
    { value: 'category', label: 'Categoria' },
  ];

  /**
   * Phase 3a: rule type selector.
   *  - `flat`: legacy single-discount on top-level `type` / `value` controls.
   *  - `quantity_tiered`: discount is computed by the per-row FormArray below.
   */
  ruleTypeOptions: SelectorOption[] = [
    { value: 'flat', label: 'Descuento unico' },
    { value: 'quantity_tiered', label: 'Escalas por cantidad' },
  ];

  constructor() {
    this.form = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      code: [''],
      rule_type: ['flat' as PromotionRuleType, Validators.required],
      type: ['percentage', Validators.required],
      value: [null, [Validators.required, Validators.min(0.01), Validators.max(100)]],
      scope: ['order'],
      start_date: ['', Validators.required],
      end_date: [''],
      min_purchase_amount: [null],
      max_discount_amount: [null],
      usage_limit: [null],
      per_customer_limit: [null],
      is_auto_apply: [false],
      priority: [0],
      product_ids: [[]],
      category_ids: [[]],
      quantity_tiers: this.fb.array([]),
    });

    effect(() => {
      this.populateForm(this.promotion());
    });

    this.form.get('type')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        this.configureValueValidators(type);
        if (type !== 'percentage') {
          this.form.patchValue({ max_discount_amount: null }, { emitEvent: false });
        }
      });

    this.form.get('scope')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((scope) => {
        this.configureScopeValidators(scope);
        // Clear fields that no longer apply for the new scope so they
        // are not submitted as dirty data.
        if (scope !== 'product') {
          this.form.patchValue({ product_ids: [] }, { emitEvent: false });
        }
        if (scope !== 'category') {
          this.form.patchValue({ category_ids: [] }, { emitEvent: false });
        }
      });

    /**
     * Phase 3a: rule_type toggle. When tiered, the flat `value` is no longer
     * required (it is ignored by the backend) and `quantity_tiers` must
     * contain at least one ascending tier row.
     */
    this.form.get('rule_type')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ruleType) => {
        this.configureRuleTypeValidators(ruleType);
      });

    // Load product and category options for multi-selectors
    this.productsService.getProducts({ limit: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => {
        this.productOptions.set(res.data.map(p => ({ value: p.id, label: p.name, description: p.sku })));
      });

    this.categoriesService.getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(cats => {
        this.categoryOptions.set(cats.map(c => ({ value: c.id, label: c.name })));
      });
  }

  /** Typed accessor for the tiers FormArray. */
  get quantityTiers(): FormArray {
    return this.form.get('quantity_tiers') as FormArray;
  }

  /**
   * Form-level error string for the tier editor when the array is empty
   * (only relevant in tiered mode) or fails the ascending / overlap check.
   */
  quantityTiersError(): string {
    const ruleType = this.form.get('rule_type')?.value;
    if (ruleType !== 'quantity_tiered') return '';
    const tiersArray = this.form.get('quantity_tiers');
    const errs = (tiersArray?.errors ?? null) as ValidationErrors | null;
    if (!errs) return '';
    if (errs['required']) {
      return 'Agrega al menos una escala para esta regla.';
    }
    if (errs['tiersOrder']) {
      return errs['tiersOrder'] as string;
    }
    return 'Revisa las escalas: deben ser ascendentes y continuas.';
  }

  /**
   * Per-field error string for a tier row. Mirrors how the existing flat
   * inputs surface `[error]`. Returns '' when the field is valid or untouched.
   */
  tierFieldError(index: number, field: string): string {
    const ctrl = this.quantityTiers.at(index)?.get(field);
    if (!ctrl || !ctrl.touched || !ctrl.errors) return '';
    const e = ctrl.errors;
    if (e['required']) return 'Requerido';
    if (e['min']) return `Debe ser >= ${e['min'].min}`;
    if (e['max']) return `Debe ser <= ${e['max'].max}`;
    if (e['tierOrder']) return e['tierOrder'] as string;
    return '';
  }

  /** Flat-`value` error string (moved out of the template so it stays readable). */
  flatValueError(): string {
    const ctrl = this.form.get('value');
    if (!ctrl || !ctrl.touched || !ctrl.errors) return '';
    if (ctrl.errors['required']) return 'El valor es requerido';
    if (ctrl.errors['min']) return 'Debe ser mayor a 0';
    if (ctrl.errors['max']) return `Debe ser <= ${ctrl.errors['max'].max}`;
    return '';
  }

  /**
   * Insert a new empty tier row at the end of the array.
   * `sort_order` defaults to the row index; `type` defaults to `'percentage'`
   * to match the form-level default.
   */
  addTier(): void {
    const index = this.quantityTiers.length;
    const group = this.fb.group({
      id: [null],
      min_quantity: [null, [Validators.required, Validators.min(1)]],
      max_quantity: [null, [Validators.min(1)]],
      type: ['percentage', Validators.required],
      value: [null, [Validators.required, Validators.min(0.01), Validators.max(100)]],
      sort_order: [index, [Validators.min(0)]],
    });

    // Per-row type toggles its own `value` max(100) constraint, mirroring
    // the top-level `configureValueValidators` pattern.
    group.get('type')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        const valueCtrl = group.get('value');
        const validators = [Validators.required, Validators.min(0.01)];
        if (type === 'percentage') {
          validators.push(Validators.max(100));
        }
        valueCtrl?.setValidators(validators);
        valueCtrl?.updateValueAndValidity({ emitEvent: false });
      });

    this.quantityTiers.push(group);
    this.quantityTiers.updateValueAndValidity({ emitEvent: false });
  }

  /** Drop a tier row by index. Keeps the surrounding rows intact. */
  removeTier(index: number): void {
    this.quantityTiers.removeAt(index);
    this.quantityTiers.updateValueAndValidity({ emitEvent: false });
  }

  private populateForm(promotion: Promotion | null): void {
    this.form.reset({
      name: promotion?.name || '',
      description: promotion?.description || '',
      code: promotion?.code || '',
      rule_type: (promotion?.rule_type ?? 'flat') as PromotionRuleType,
      type: promotion?.type || 'percentage',
      value: promotion?.value ?? null,
      scope: promotion?.scope || 'order',
      start_date: this.toDateInputValue(promotion?.start_date),
      end_date: this.toDateInputValue(promotion?.end_date),
      min_purchase_amount: promotion?.min_purchase_amount ?? null,
      max_discount_amount: promotion?.max_discount_amount ?? null,
      usage_limit: promotion?.usage_limit ?? null,
      per_customer_limit: promotion?.per_customer_limit ?? null,
      is_auto_apply: promotion?.is_auto_apply ?? false,
      priority: promotion?.priority ?? 0,
      product_ids: promotion?.promotion_products?.map((pp) => pp.product_id) || [],
      category_ids: promotion?.promotion_categories?.map((pc) => pc.category_id) || [],
    }, { emitEvent: false });

    // Reset the tiers array explicitly (reset() keeps existing FormArray children
    // unless we clear them). Seed rows from the persisted promotion.
    this.quantityTiers.clear({ emitEvent: false });
    const tiers = promotion?.promotion_quantity_tiers ?? [];
    if (tiers.length) {
      tiers.forEach((tier, idx) => this.pushTierRow(tier, idx));
    }

    this.configureValueValidators(this.form.get('type')?.value);
    this.configureScopeValidators(this.form.get('scope')?.value);
    this.configureRuleTypeValidators(this.form.get('rule_type')?.value);
  }

  /**
   * Build and append one tier row from a persisted row. Mirrors `addTier()`
   * but accepts the canonical `PromotionQuantityTier` shape (value arrives as
   * a Decimal string from the API; we coerce to a number for the input).
   */
  private pushTierRow(tier: PromotionQuantityTier, index: number): void {
    const group = this.fb.group({
      id: [tier.id ?? null],
      min_quantity: [tier.min_quantity, [Validators.required, Validators.min(1)]],
      max_quantity: [tier.max_quantity ?? null, [Validators.min(1)]],
      type: [tier.type, Validators.required],
      value: [tier.value != null ? Number(tier.value) : null, [Validators.required, Validators.min(0.01), Validators.max(100)]],
      sort_order: [tier.sort_order ?? index, [Validators.min(0)]],
    });

    if (tier.type !== 'percentage') {
      const valueCtrl = group.get('value');
      valueCtrl?.setValidators([Validators.required, Validators.min(0.01)]);
      valueCtrl?.updateValueAndValidity({ emitEvent: false });
    }

    group.get('type')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        const valueCtrl = group.get('value');
        const validators = [Validators.required, Validators.min(0.01)];
        if (type === 'percentage') {
          validators.push(Validators.max(100));
        }
        valueCtrl?.setValidators(validators);
        valueCtrl?.updateValueAndValidity({ emitEvent: false });
      });

    this.quantityTiers.push(group);
  }

  private configureValueValidators(type: string): void {
    const valueControl = this.form.get('value');
    const validators = [Validators.required, Validators.min(0.01)];
    if (type === 'percentage') {
      validators.push(Validators.max(100));
    }
    valueControl?.setValidators(validators);
    valueControl?.updateValueAndValidity({ emitEvent: false });
  }

  private configureScopeValidators(scope: string): void {
    const productIdsControl = this.form.get('product_ids');
    const categoryIdsControl = this.form.get('category_ids');

    productIdsControl?.clearValidators();
    categoryIdsControl?.clearValidators();

    if (scope === 'product') {
      productIdsControl?.setValidators([this.requiredArray]);
    }
    if (scope === 'category') {
      categoryIdsControl?.setValidators([this.requiredArray]);
    }

    productIdsControl?.updateValueAndValidity({ emitEvent: false });
    categoryIdsControl?.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Phase 3a: toggle validators between flat and tiered rule types.
   *  - `flat`: top-level `value` is required (existing behavior).
   *  - `quantity_tiered`: top-level `value` is optional (backend ignores it),
   *    and `quantity_tiers` must contain >=1 ascending valid row.
   */
  private configureRuleTypeValidators(ruleType: string): void {
    const valueCtrl = this.form.get('value');
    const tiersCtrl = this.form.get('quantity_tiers');

    // Reset validators on `value` — re-arm based on ruleType so we never end
    // up with stale required flags carried over from a previous mode.
    valueCtrl?.clearValidators();
    valueCtrl?.setErrors(null);

    // Reset validators on the tiers FormArray.
    tiersCtrl?.clearValidators();
    tiersCtrl?.setErrors(null);

    if (ruleType === 'quantity_tiered') {
      // Tiered: `value` is irrelevant. Skip required, allow null.
      valueCtrl?.setValidators([Validators.min(0.01)]);
      tiersCtrl?.setValidators([Validators.required, this.validateTiersOrder()]);
    } else {
      // Flat: existing required validators.
      const flatType = this.form.get('type')?.value ?? 'percentage';
      const flatValidators: ValidatorFn[] = [Validators.required, Validators.min(0.01)];
      if (flatType === 'percentage') {
        flatValidators.push(Validators.max(100));
      }
      valueCtrl?.setValidators(flatValidators);
    }

    valueCtrl?.updateValueAndValidity({ emitEvent: false });
    tiersCtrl?.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Cross-row validator enforcing ascending, contiguous tier ranges:
   *  - Sorted by (min_quantity, sort_order) ascending.
   *  - No gaps and no overlap: tier[i].max_quantity === tier[i+1].min_quantity - 1
   *    when both are defined.
   *  - Only the LAST row may leave `max_quantity` empty.
   *
   * Mirrors `IsValidQuantityTiers` from the backend DTO. The error key
   * `tiersOrder` is surfaced via `quantityTiersError()`.
   */
  private validateTiersOrder(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const array = control as FormArray;
      if (!(array instanceof FormArray)) return null;
      if (array.length === 0) {
        // Empty is handled by `Validators.required` on the array itself.
        return null;
      }

      const rows = array.controls.map((ctrl, idx) => {
        const v = (ctrl as FormGroup).getRawValue();
        return {
          idx,
          min: v.min_quantity != null ? Number(v.min_quantity) : null,
          max: v.max_quantity != null && v.max_quantity !== '' ? Number(v.max_quantity) : null,
          sort: v.sort_order != null ? Number(v.sort_order) : idx,
        };
      });

      // Sort by (min, sort_order) ASC. Rows with `min === null` are invalid
      // already; let them fall to the back so they don't poison the sort.
      const sorted = [...rows].sort((a, b) => {
        if (a.min == null && b.min == null) return a.sort - b.sort;
        if (a.min == null) return 1;
        if (b.min == null) return -1;
        if (a.min !== b.min) return a.min - b.min;
        return a.sort - b.sort;
      });

      for (let i = 0; i < sorted.length; i++) {
        const row = sorted[i];
        const isLast = i === sorted.length - 1;
        if (row.min == null || !Number.isFinite(row.min) || row.min < 1) {
          return { tiersOrder: `Escala ${i + 1}: cantidad minima invalida.` };
        }
        if (!isLast && (row.max == null || !Number.isFinite(row.max))) {
          return { tiersOrder: `Escala ${i + 1}: solo la ultima escala puede quedar sin maximo.` };
        }
        if (row.max != null && row.max < row.min) {
          return { tiersOrder: `Escala ${i + 1}: maximo debe ser >= minimo.` };
        }
        if (i < sorted.length - 1) {
          const next = sorted[i + 1];
          if (row.max == null || next.min == null) {
            return { tiersOrder: `Escala ${i + 1}: rango incompleto.` };
          }
          // Adjacency: row.max + 1 must equal next.min (no gaps, no overlap).
          if (row.max + 1 !== next.min) {
            return {
              tiersOrder: `Escala ${i + 1}: el rango debe ser continuo (max ${row.max} -> min ${next.min}).`,
            };
          }
        }
      }

      return null;
    };
  }

  private requiredArray(control: AbstractControl): ValidationErrors | null {
    return Array.isArray(control.value) && control.value.length > 0
      ? null
      : { required: true };
  }

  private toDateInputValue(value?: string | null): string {
    return value ? value.split('T')[0] : '';
  }

  private toNumberArray(value: unknown): number[] {
    return Array.isArray(value)
      ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];
  }

  onSubmit(): void {
    // Re-run scope validators in case the user changed scope and never blurred
    // the dependent selector. This prevents stale validity state.
    this.configureScopeValidators(this.form.get('scope')?.value);
    this.configureRuleTypeValidators(this.form.get('rule_type')?.value);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();

    // Clean up empty optional fields
    const dto: any = { ...raw };
    if (!dto.description) delete dto.description;
    if (!dto.code) delete dto.code;
    if (!dto.end_date) delete dto.end_date;
    if (dto.min_purchase_amount === null || dto.min_purchase_amount === '') delete dto.min_purchase_amount;
    if (dto.max_discount_amount === null || dto.max_discount_amount === '') delete dto.max_discount_amount;
    if (dto.usage_limit === null || dto.usage_limit === '') delete dto.usage_limit;
    if (dto.per_customer_limit === null || dto.per_customer_limit === '') delete dto.per_customer_limit;
    if (dto.type !== 'percentage') delete dto.max_discount_amount;

    // Normalize scope-specific IDs:
    // - Product scope: send product_ids, strip category_ids.
    // - Category scope: send category_ids, strip product_ids.
    // - Order scope: strip both — they must not be persisted as dirty data.
    if (dto.scope === 'product') {
      dto.product_ids = this.toNumberArray(dto.product_ids);
      delete dto.category_ids;
      if (!dto.product_ids.length) {
        // Defensive guard: should be unreachable because of form validators,
        // but we never want to send an inconsistent payload.
        this.form.get('product_ids')?.setErrors({ required: true });
        this.form.markAllAsTouched();
        return;
      }
    } else if (dto.scope === 'category') {
      dto.category_ids = this.toNumberArray(dto.category_ids);
      delete dto.product_ids;
      if (!dto.category_ids.length) {
        this.form.get('category_ids')?.setErrors({ required: true });
        this.form.markAllAsTouched();
        return;
      }
    } else {
      delete dto.product_ids;
      delete dto.category_ids;
    }

    // Phase 3a: quantity_tiered vs flat payload shaping.
    if (dto.rule_type === 'quantity_tiered') {
      // The backend keeps the top-level `type`/`value` columns non-nullable
      // (`value` is validated as @IsNumber @Min(0), NOT optional). In tiered
      // mode the form leaves `value` as null, which would fail validation
      // (400) even though the engine ignores the parent value and reads each
      // row's `type`/`value` instead. We coerce the parent `value` to 0 to
      // satisfy the DTO contract while keeping the flat path untouched, then
      // append the freshly built tiers array.
      dto.value = 0;
      dto.quantity_tiers = this.quantityTiers.controls.map((ctrl) => {
        const v = (ctrl as FormGroup).getRawValue();
        return {
          min_quantity: Number(v.min_quantity),
          max_quantity: v.max_quantity != null && v.max_quantity !== '' ? Number(v.max_quantity) : null,
          type: v.type,
          value: Number(v.value),
          sort_order: v.sort_order != null ? Number(v.sort_order) : 0,
        };
      });
    } else {
      // Flat: drop the tiers array (it must not be persisted as dirty data).
      delete dto.quantity_tiers;
    }

    this.save.emit(dto);
  }
}
