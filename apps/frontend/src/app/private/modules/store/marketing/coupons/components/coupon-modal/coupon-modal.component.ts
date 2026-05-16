import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';

import {
  ReactiveFormsModule,
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Coupon, CreateCouponRequest } from '../../interfaces/coupon.interface';
import {
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../../../shared/components/multi-selector/multi-selector.component';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  SettingToggleComponent,
} from '../../../../../../../shared/components';
import { ProductsService } from '../../../../products/services/products.service';
import { CategoriesService } from '../../../../products/services/categories.service';

@Component({
  selector: 'app-coupon-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    SettingToggleComponent,
    MultiSelectorComponent,
],
  template: `
    @if (visible()) {
    <app-modal
      [isOpen]="true"
      [title]="coupon() ? 'Editar Cupon' : 'Crear Cupon'"
      size="lg"
      (closed)="close.emit()"
    >
      <form [formGroup]="form" class="space-y-3">

        <!-- Code + Name -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Codigo"
            formControlName="code"
            placeholder="Ej: VERANO2026"
            [required]="true"
            customInputClass="font-mono uppercase"
            [suffixIcon]="true"
            [suffixClickable]="true"
            (suffixClick)="generateCode()"
            [error]="form.get('code')?.touched && form.get('code')?.invalid ? 'Minimo 3 caracteres' : ''"
          >
            <svg slot="suffix-icon" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </app-input>
          <div class="sm:col-span-2">
            <app-input
              label="Nombre"
              formControlName="name"
              placeholder="Ej: Descuento de verano"
              [required]="true"
              [error]="form.get('name')?.touched && form.get('name')?.invalid ? 'Minimo 2 caracteres' : ''"
            ></app-input>
          </div>
        </div>

        <!-- Description -->
        <app-textarea
          label="Descripcion"
          formControlName="description"
          placeholder="Descripcion del cupon (opcional)..."
          [rows]="2"
        ></app-textarea>

        <!-- Discount Type + Value + Applies To -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-selector
            label="Tipo de descuento"
            [options]="discountTypeOptions"
            formControlName="discount_type"
            [required]="true"
          ></app-selector>

          <app-input
            label="Valor"
            [type]="form.get('discount_type')?.value === 'PERCENTAGE' ? 'number' : 'text'"
            [currency]="form.get('discount_type')?.value !== 'PERCENTAGE'"
            formControlName="discount_value"
            [required]="true"
            placeholder="0"
            [prefixIcon]="true"
            [max]="form.get('discount_type')?.value === 'PERCENTAGE' ? 100 : undefined"
            [error]="form.get('discount_value')?.touched && form.get('discount_value')?.invalid ? 'Requerido, mayor a 0' : ''"
          >
            <span slot="prefix-icon">{{ form.get('discount_type')?.value === 'PERCENTAGE' ? '%' : '$' }}</span>
          </app-input>

          <app-selector
            label="Aplica a"
            [options]="appliesToOptions"
            formControlName="applies_to"
          ></app-selector>
        </div>

        @if (form.get('applies_to')?.value === 'SPECIFIC_PRODUCTS') {
          <app-multi-selector
            label="Productos"
            [options]="productOptions()"
            formControlName="product_ids"
            placeholder="Buscar productos..."
            [required]="true"
            [errorText]="form.get('product_ids')?.touched && form.get('product_ids')?.invalid ? 'Selecciona al menos un producto' : ''"
          ></app-multi-selector>
        }

        @if (form.get('applies_to')?.value === 'SPECIFIC_CATEGORIES') {
          <app-multi-selector
            label="Categorias"
            [options]="categoryOptions()"
            formControlName="category_ids"
            placeholder="Buscar categorias..."
            [required]="true"
            [errorText]="form.get('category_ids')?.touched && form.get('category_ids')?.invalid ? 'Selecciona al menos una categoria' : ''"
          ></app-multi-selector>
        }

        <!-- Valid From + Valid Until + Min Purchase -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Valido desde"
            type="datetime-local"
            formControlName="valid_from"
            [required]="true"
            [error]="form.get('valid_from')?.touched && form.get('valid_from')?.invalid ? 'Requerido' : ''"
          ></app-input>
          <app-input
            label="Valido hasta"
            type="datetime-local"
            formControlName="valid_until"
            [required]="true"
            [error]="form.get('valid_until')?.touched && form.get('valid_until')?.invalid ? 'Requerido' : ''"
          ></app-input>
          <app-input
            label="Compra minima"
            [currency]="true"
            formControlName="min_purchase_amount"
            placeholder="Sin minimo"
          ></app-input>
        </div>

        <!-- Max Discount + Max Uses + Uses Per Customer -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Descuento maximo"
            [currency]="true"
            formControlName="max_discount_amount"
            placeholder="Sin limite"
          ></app-input>
          <app-input
            label="Limite de usos"
            type="number"
            formControlName="max_uses"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
          <app-input
            label="Usos por cliente"
            type="number"
            formControlName="max_uses_per_customer"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
        </div>

        <!-- Active toggle -->
        <div class="pt-2">
        <app-setting-toggle
          label="Cupon activo"
          description="Disponible para uso inmediato"
          formControlName="is_active"
        ></app-setting-toggle>
        </div>

      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end items-center gap-3">
        <app-button variant="outline" (clicked)="close.emit()">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSubmit()" [disabled]="form.invalid" [loading]="loading()">
          {{ coupon() ? 'Guardar cambios' : 'Crear Cupon' }}
        </app-button>
      </div>
    </app-modal>
    }
  `,
})
export class CouponModalComponent {
  visible = input<boolean>(false);
  coupon = input<Coupon | null>(null);
  loading = input<boolean>(false);

  close = output<void>();
  save = output<CreateCouponRequest>();

  private fb = inject(FormBuilder);
  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);
  private destroyRef = inject(DestroyRef);

  readonly productOptions = signal<MultiSelectorOption[]>([]);
  readonly categoryOptions = signal<MultiSelectorOption[]>([]);

  discountTypeOptions: SelectorOption[] = [
    { value: 'PERCENTAGE', label: 'Porcentaje' },
    { value: 'FIXED_AMOUNT', label: 'Monto fijo' },
  ];

  appliesToOptions: SelectorOption[] = [
    { value: 'ALL_PRODUCTS', label: 'Todos los productos' },
    { value: 'SPECIFIC_PRODUCTS', label: 'Productos especificos' },
    { value: 'SPECIFIC_CATEGORIES', label: 'Categorias especificas' },
  ];

  form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(3)]],
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    discount_type: ['PERCENTAGE', Validators.required],
    discount_value: [null, [Validators.required, Validators.min(0.01)]],
    min_purchase_amount: [null],
    max_discount_amount: [null],
    max_uses: [null],
    max_uses_per_customer: [1],
    valid_from: ['', Validators.required],
    valid_until: ['', Validators.required],
    is_active: [true],
    applies_to: ['ALL_PRODUCTS'],
    product_ids: [[]],
    category_ids: [[]],
  });

  constructor() {
    effect(() => {
      this.populateForm(this.coupon());
    });

    this.form.get('discount_type')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => this.configureDiscountValueValidators(type));

    this.form.get('applies_to')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((appliesTo) => this.configureAppliesToValidators(appliesTo));

    this.productsService.getProducts({ limit: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.productOptions.set(res.data.map((product) => ({
          value: product.id,
          label: product.name,
          description: product.sku,
        })));
      });

    this.categoriesService.getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((categories) => {
        this.categoryOptions.set(categories.map((category) => ({
          value: category.id,
          label: category.name,
        })));
      });
  }

  private populateForm(coupon: Coupon | null): void {
    this.form.reset({
      code: coupon?.code || '',
      name: coupon?.name || '',
      description: coupon?.description || '',
      discount_type: coupon?.discount_type || 'PERCENTAGE',
      discount_value: coupon?.discount_value ? Number(coupon.discount_value) : null,
      min_purchase_amount: coupon?.min_purchase_amount
        ? Number(coupon.min_purchase_amount)
        : null,
      max_discount_amount: coupon?.max_discount_amount
        ? Number(coupon.max_discount_amount)
        : null,
      max_uses: coupon?.max_uses ?? null,
      max_uses_per_customer: coupon?.max_uses_per_customer ?? 1,
      valid_from: this.toDatetimeLocal(coupon?.valid_from),
      valid_until: this.toDatetimeLocal(coupon?.valid_until),
      is_active: coupon?.is_active ?? true,
      applies_to: coupon?.applies_to || 'ALL_PRODUCTS',
      product_ids: coupon?.coupon_products?.map((cp) => cp.product_id ?? cp.product?.id).filter(Boolean) || [],
      category_ids: coupon?.coupon_categories?.map((cc) => cc.category_id ?? cc.category?.id).filter(Boolean) || [],
    }, { emitEvent: false });

    this.configureDiscountValueValidators(this.form.get('discount_type')?.value);
    this.configureAppliesToValidators(this.form.get('applies_to')?.value);
  }

  private configureDiscountValueValidators(type: string): void {
    const discountValueControl = this.form.get('discount_value');
    const validators = [Validators.required, Validators.min(0.01)];
    if (type === 'PERCENTAGE') {
      validators.push(Validators.max(100));
    }
    discountValueControl?.setValidators(validators);
    discountValueControl?.updateValueAndValidity({ emitEvent: false });
  }

  private configureAppliesToValidators(appliesTo: string): void {
    const productIdsControl = this.form.get('product_ids');
    const categoryIdsControl = this.form.get('category_ids');

    productIdsControl?.clearValidators();
    categoryIdsControl?.clearValidators();

    if (appliesTo === 'SPECIFIC_PRODUCTS') {
      productIdsControl?.setValidators([this.requiredArray]);
    }
    if (appliesTo === 'SPECIFIC_CATEGORIES') {
      categoryIdsControl?.setValidators([this.requiredArray]);
    }

    productIdsControl?.updateValueAndValidity({ emitEvent: false });
    categoryIdsControl?.updateValueAndValidity({ emitEvent: false });
  }

  private requiredArray(control: AbstractControl): ValidationErrors | null {
    return Array.isArray(control.value) && control.value.length > 0
      ? null
      : { required: true };
  }

  generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.form.patchValue({ code });
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const request: CreateCouponRequest = {
      code: raw.code.toUpperCase().trim(),
      name: raw.name,
      description: raw.description || undefined,
      discount_type: raw.discount_type,
      discount_value: raw.discount_value,
      min_purchase_amount: raw.min_purchase_amount || undefined,
      max_discount_amount: raw.max_discount_amount || undefined,
      max_uses: raw.max_uses || undefined,
      max_uses_per_customer: raw.max_uses_per_customer || undefined,
      valid_from: new Date(raw.valid_from).toISOString(),
      valid_until: new Date(raw.valid_until).toISOString(),
      is_active: raw.is_active,
      applies_to: raw.applies_to,
    };

    if (raw.applies_to === 'SPECIFIC_PRODUCTS') {
      request.product_ids = this.toNumberArray(raw.product_ids);
    }
    if (raw.applies_to === 'SPECIFIC_CATEGORIES') {
      request.category_ids = this.toNumberArray(raw.category_ids);
    }

    this.save.emit(request);
  }

  private toNumberArray(value: unknown): number[] {
    return Array.isArray(value)
      ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];
  }

  private toDatetimeLocal(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toISOString().slice(0, 16);
  }
}
