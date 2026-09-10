import {
  Component,
  input,
  output,
  model,
  signal,
  computed,
  effect,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith, map } from 'rxjs/operators';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  ToastService,
  IconComponent,
  MultiSelectorComponent,
  MultiSelectorOption,
  SelectorOption,
  DialogService,
  TooltipComponent,
  TaxInclusiveChipComponent,
} from '../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  Product,
  ProductState,
  ProductCategory,
  Brand,
  TaxCategory,
} from '../interfaces';
import { ProductsService } from '../services/products.service';
import { CategoriesService } from '../services/categories.service';
import { BrandsService } from '../services/brands.service';
import { TaxesService } from '../services/taxes.service';
import { PosBarcodeService } from '../../pos/services/pos-barcode.service';
import {
  buildTaxInclusivePayload,
  catalogInclusiveDefault,
  estimatePriceWithTax,
  hydrateTaxInclusiveMap,
  parseTaxRateFraction,
  resolveTaxInclusive,
  withoutTaxFromMap,
} from '../utils/product-tax-inclusive.util';
import { CategoryQuickCreateComponent } from './category-quick-create.component';
import { TaxQuickCreateComponent } from './tax-quick-create.component';
import { AccountCodeSelectComponent } from './account-code-select.component';

@Component({
  selector: 'app-product-create-modal',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    MultiSelectorComponent,
    TooltipComponent,
    CategoryQuickCreateComponent,
    TaxQuickCreateComponent,
    AccountCodeSelectComponent,
    TaxInclusiveChipComponent,
  ],
  templateUrl: './product-create-modal/product-create-modal.component.html',
  styleUrls: ['./product-create-modal/product-create-modal.component.scss'],
})
export class ProductCreateModalComponent {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);
  private brandsService = inject(BrandsService);
  private taxesService = inject(TaxesService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);
  private barcodeService = inject(PosBarcodeService);

  readonly isOpen = model<boolean>(false);
  readonly isSubmitting = input<boolean>(false);
  readonly product = input<Product | null>(null);
  readonly submit = output<any>();
  readonly cancel = output<void>();

  get isEditMode(): boolean {
    return !!this.product();
  }

  productForm: FormGroup = this.createForm();
  categoryOptions = signal<SelectorOption[]>([]);
  brandOptions = signal<SelectorOption[]>([]);
  taxCategoryOptions = signal<MultiSelectorOption[]>([]);

  readonly taxInclusiveMap = signal<Record<number, boolean>>({});

  readonly selectedTaxCategoryIds = toSignal(
    this.productForm.get('tax_category_ids')!.valueChanges.pipe(
      startWith(this.productForm.get('tax_category_ids')!.value || []),
      map((ids: any) => (Array.isArray(ids) ? ids.map(Number) : [])),
    ),
    { initialValue: [] as number[] },
  );

  readonly selectedTaxCategories = computed<TaxCategory[]>(() => {
    const ids = this.selectedTaxCategoryIds() || [];
    return ids
      .map((id) => this.allTaxCategories.find((c) => c.id === id))
      .filter((c): c is TaxCategory => !!c);
  });

  isTaxInclusive(taxId: number): boolean {
    return resolveTaxInclusive(taxId, this.taxInclusiveMap(), this.allTaxCategories);
  }

  setTaxInclusive(taxId: number, isInclusive: boolean): void {
    this.taxInclusiveMap.update((m) => ({ ...m, [taxId]: isInclusive }));
  }

  removeTaxCategory(taxId: number): void {
    const current: number[] =
      this.productForm.get('tax_category_ids')?.value || [];
    this.productForm
      .get('tax_category_ids')
      ?.setValue(current.filter((id) => id !== taxId));
    // F-032: quitar el impuesto borra su entrada; al re-añadirlo rige el
    // catálogo, no un valor resucitado.
    this.taxInclusiveMap.set(withoutTaxFromMap(this.taxInclusiveMap(), taxId));
  }

  taxInclusiveHint(taxId: number): string {
    return this.isTaxInclusive(taxId)
      ? 'El impuesto ya está dentro del precio unitario. Click para cambiarlo a adicional.'
      : 'El impuesto se suma sobre el precio unitario. Click para cambiarlo a incluido.';
  }

  getTaxRatePercent(tax: TaxCategory): number {
    const raw = tax.rate ?? tax.tax_rates?.[0]?.rate ?? 0;
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) return 0;
    const percent = val > 1 ? val : val * 100;
    return Math.round(percent * 100) / 100;
  }

  // Quick create modals state
  isCategoryCreateOpen = signal(false);
  isBrandCreateOpen = signal(false);
  isTaxCategoryCreateOpen = signal(false);

  /**
   * Bloque contable plegado. Se abre solo si el producto ya trae cuenta
   * (edición), para que el dato no quede escondido detrás de un clic.
   */
  readonly isAccountingOpen = signal(false);

  private allTaxCategories: TaxCategory[] = [];
  private isInitialized = signal(false);

  constructor() {

    // React to product input changes
    effect(() => {
      const prod = this.product();
      if (prod) {
        this.populateForm();
      } else {
        this.resetForm();
      }
    });

    // React to isOpen changes - solo ejecutar una vez por apertura
    effect(() => {
      if (this.isOpen() && !this.isInitialized()) {
        this.currencyService.loadCurrency();
        this.loadCategoriesAndBrands();
        if (!this.product()) {
          this.resetForm();
        }
        this.isInitialized.set(true);
      }
      // Cuando el modal se cierra, resetear el flag para la próxima apertura
      if (!this.isOpen()) {
        this.isInitialized.set(false);
      }
    });

    // Scan-to-fill: a barcode scan (gated by barcode_scanner.enabled) overwrites
    // the barcode control, clearing any residue the burst left in a focused input.
    this.barcodeService.scans$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => {
        this.productForm.get('barcode')?.setValue(code);
      });
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(1),
          Validators.maxLength(255),
        ],
      ],
      description: [''],
      base_price: [null, [Validators.required, Validators.min(0)]],
      sku: [''],
      barcode: ['', [Validators.maxLength(64)]],
      category_ids: [[]],
      brand_ids: [[]],
      tax_category_ids: [[] as number[]],
      allow_pos_price_override: [false],
      state: [ProductState.ACTIVE],
      // Subcuenta PUC de ingreso. Vacío = mapping contable por defecto, que es
      // lo que necesita el 99% de los productos: por eso vive plegada.
      account_code: [null as string | null],
    });
  }

  resetForm() {
    this.productForm.reset({
      base_price: 0,
      tax_category_ids: [],
      allow_pos_price_override: false,
      state: ProductState.ACTIVE,
      account_code: null,
    });
    // F-023: el mapa no sobrevive entre productos (scope por producto).
    this.taxInclusiveMap.set({});
    this.isAccountingOpen.set(false);
  }

  goToAdvancedCreation(): void {
    const val = this.productForm.value;
    const draftData = {
      name: val.name || '',
      description: val.description || '',
      base_price: val.base_price || 0,
      sku: val.sku || '',
      barcode: val.barcode || '',
      category_ids: val.category_ids || [],
      brand_ids: val.brand_ids || [],
      tax_category_ids: val.tax_category_ids || [],
      allow_pos_price_override: !!val.allow_pos_price_override,
      state: val.state || 'active',
      // Viaja al formulario avanzado para que el salto no pierda la cuenta.
      account_code: val.account_code || null,
      tax_inclusive_map: buildTaxInclusivePayload(
        val.tax_category_ids || [],
        this.taxInclusiveMap(),
      ),
    };

    this.router.navigate(['/admin/products/create'], {
      state: { draft: draftData },
    });
    this.onCancel();
  }

  /**
   * Estimado de exhibición (F-013): especificación de signo, no oráculo de
   * centavos. El total facturable lo define el backend.
   */
  get priceWithTax(): number {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    const selectedIds: number[] =
      this.productForm.get('tax_category_ids')?.value || [];
    if (!basePrice || selectedIds.length === 0) return basePrice;

    return estimatePriceWithTax(
      basePrice,
      selectedIds.map((id) => {
        const tc = this.allTaxCategories.find((c) => c.id === id);
        return {
          rateFraction: parseTaxRateFraction(
            tc?.rate ?? tc?.tax_rates?.[0]?.rate ?? 0,
          ),
          inclusive: this.isTaxInclusive(id),
        };
      }),
    );
  }

  private loadCategoriesAndBrands(): void {
    if (this.categoryOptions().length === 0) this.loadCategories();
    if (this.brandOptions().length === 0) this.loadBrands();
    if (this.taxCategoryOptions().length === 0) this.loadTaxCategories();
  }

  // Populate form when product data is available (edit mode)
  private populateForm(): void {
    const prod = this.product();
    if (!prod) return;

    this.productForm.patchValue({
      name: prod.name,
      base_price: prod.base_price,
      barcode: prod.barcode,
      // Try to get category from new structure or legacy if exists
      category_ids:
        (prod as any).category_ids?.length > 0
          ? (prod as any).category_ids
          : prod.categories?.[0]?.id
            ? [prod.categories[0].id]
            : [],
      brand_ids: prod.brand_id ? [prod.brand_id] : [],
      tax_category_ids: (prod.product_tax_assignments || []).map(
        (ta: any) => ta.tax_category_id,
      ),
      allow_pos_price_override: prod.allow_pos_price_override === true,
      state: prod.state || ProductState.ACTIVE,
      account_code: prod.account_code ?? null,
    });

    // F-007/F-022/F-024: hidratación assignment-first
    // (`ta.is_inclusive ?? embebido ?? catálogo`), reconstruida desde cero
    // para que el orden populate-vs-catálogo no decida el resultado.
    if (prod.product_tax_assignments) {
      this.taxInclusiveMap.set(
        hydrateTaxInclusiveMap(
          prod.product_tax_assignments,
          this.allTaxCategories,
        ),
      );
    } else {
      this.taxInclusiveMap.set(
        hydrateTaxInclusiveMap([], this.allTaxCategories),
      );
    }

    if (prod.account_code) {
      this.isAccountingOpen.set(true);
    }
  }

  private loadCategories(): void {
    this.categoriesService.getAllCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories: ProductCategory[]) => {
        this.categoryOptions.set(categories.map((cat: ProductCategory) => ({
          value: cat.id,
          label: cat.name,
          description: cat.description ?? undefined,
        })));
      },
      error: (error: any) => {
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar categorías');
        this.categoryOptions.set([]);
      },
    });
  }

  private loadTaxCategories(): void {
    this.taxesService.getTaxCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (taxCategories: TaxCategory[]) => {
        this.allTaxCategories = taxCategories;
        // F-024: solo rellena entradas ausentes; la asignación ya hidratada
        // nunca se sobrescribe con el default del catálogo.
        const map = { ...this.taxInclusiveMap() };
        for (const cat of taxCategories) {
          if (map[cat.id] === undefined) {
            map[cat.id] = catalogInclusiveDefault(cat);
          }
        }
        this.taxInclusiveMap.set(map);

        if (taxCategories.length > 0) {
          this.taxCategoryOptions.set(taxCategories.map((cat: TaxCategory) => {
            const rawRate = cat.rate ?? cat.tax_rates?.[0]?.rate ?? 0;
            const rate = parseFloat(String(rawRate));
            const finalRate = isNaN(rate) ? 0 : rate;

            return {
              value: cat.id,
              label: `${cat.name} (${(finalRate * 100).toFixed(0)}%)`,
              description: cat.description,
            };
          }));
        }
      },
      error: (error: any) => {
        const message = extractApiErrorMessage(error);
        this.toastService.error(
          message,
          'Error al cargar categorías de impuestos',
        );
      },
    });
  }

  private loadBrands(): void {
    this.brandsService.getAllBrands().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (brands: Brand[]) => {
        this.brandOptions.set(brands.map((brand: Brand) => ({
          value: brand.id,
          label: brand.name,
          description: brand.description ?? undefined,
        })));
      },
      error: (error: any) => {
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar marcas');
        this.brandOptions.set([]);
      },
    });
  }

  onCategoryCreated(category: ProductCategory): void {
    this.categoryOptions.update(options => [
      ...options,
      {
        value: category.id,
        label: category.name,
        description: category.description ?? undefined,
      },
    ]);
    this.productForm.patchValue({ category_ids: [category.id] });
    this.isCategoryCreateOpen.set(false);
  }

  onBrandCreated(brand: Brand): void {
    this.brandOptions.update(options => [
      ...options,
      {
        value: brand.id,
        label: brand.name,
        description: brand.description ?? undefined,
      },
    ]);
    this.productForm.patchValue({ brand_ids: [brand.id] });
    this.isBrandCreateOpen.set(false);
  }

  onTaxCategoryCreated(taxCategory: TaxCategory): void {
    const rawRate = taxCategory.rate ?? taxCategory.tax_rates?.[0]?.rate ?? 0;
    const rate = parseFloat(String(rawRate));
    const finalRate = isNaN(rate) ? 0 : rate;
    this.taxCategoryOptions.update(options => [
      ...options,
      {
        value: taxCategory.id,
        label: `${taxCategory.name} (${(finalRate * 100).toFixed(0)}%)`,
        description: taxCategory.description,
      },
    ]);
    this.allTaxCategories = [...this.allTaxCategories, taxCategory];
    const currentIds = this.productForm.get('tax_category_ids')?.value || [];
    if (taxCategory && taxCategory.id) {
      this.productForm.patchValue({
        tax_category_ids: [...currentIds, taxCategory.id],
      });
    }
  }

  onCancel() {
    this.isOpen.set(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.productForm.invalid || this.isSubmitting()) {
      this.productForm.markAllAsTouched();
      return;
    }

    // Construct simplified DTO
    const val = this.productForm.value;
    const effectiveTaxIds: number[] = (val.tax_category_ids || []).map(
      (id: unknown) => Number(id),
    );
    const dto: any = {
      name: val.name,
      base_price: val.base_price,
      sku: val.sku || undefined,
      barcode: val.barcode || undefined,
      // Map categories to array for backend
      category_ids: val.category_ids || [],
      brand_id: val.brand_ids?.[0] ? Number(val.brand_ids[0]) : null,
      tax_category_ids: val.tax_category_ids || [],
      // F-021: el mapa viaja en el camino principal, filtrado a ids efectivos
      // (contrato A.2; deploy backend-primero, F-030).
      tax_inclusive_map: buildTaxInclusivePayload(
        effectiveTaxIds,
        this.taxInclusiveMap(),
      ),
      allow_pos_price_override: !!val.allow_pos_price_override,
      state: val.state,
      // Se envía siempre, incluso en null: omitirlo en una edición dejaría
      // pegada la cuenta anterior aunque el operador la haya limpiado.
      account_code: val.account_code || null,
    };

    if (!this.isEditMode) {
      dto.track_inventory = false;
    }

    delete dto.stock_quantity;
    delete dto.stock_by_location;
    delete dto.cost_price;
    delete dto.profit_margin;

    this.submit.emit(dto);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.productForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }

    const errors = field.errors;

    if (errors['required']) {
      return 'Este campo es obligatorio';
    }

    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }

    if (errors['maxlength']) {
      return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    }

    if (errors['min']) {
      return `El valor mínimo es ${errors['min'].min}`;
    }

    if (errors['email']) {
      return 'Formato de correo inválido';
    }

    return 'Entrada inválida';
  }

  onStockAdjustmentClick(): void {
    this.toastService.info(
      'Para ajustar stock, use la edición avanzada del producto o el módulo de Inventario',
      'Ajuste de Stock',
    );
  }

  // Product states (copiado de order-details)
  readonly productStateOptions = ['active', 'inactive', 'archived'] as const;

  // Método de actualización (con confirmación como en órdenes)
  updateProductState(newState: string): void {
    if (this.productForm.get('state')?.value === newState) return;

    this.dialogService
      .confirm({
        title: 'Change Product Status',
        message: `Are you sure you want to change the product status to "${this.formatStatus(newState)}"? This action cannot be undone and may affect product visibility.`,
        confirmText: 'Change Status',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.productForm.get('state')?.setValue(newState);
        }
      });
  }

  // Helper methods (copiados de order-details)
  getStatusColor(status: string): string {
    const statusColors: { [key: string]: string } = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-yellow-100 text-yellow-800',
      archived: 'bg-red-100 text-red-800',
    };
    return statusColors[status] || 'bg-gray-100 text-gray-800';
  }

  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
