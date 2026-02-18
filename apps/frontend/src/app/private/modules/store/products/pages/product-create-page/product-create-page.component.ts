import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule, ActivatedRoute, Router, Params } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  FormsModule, // Added FormsModule
  Validators,
  FormControl,
} from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  ToastService,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  MultiSelectorComponent,
  MultiSelectorOption,
  TextareaComponent,
  ModalComponent,
  DialogService,
  SettingToggleComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  CreateProductDto,
  CreateProductImageDto,
  ProductCategory,
  Brand,
  Product,
  ProductState,
  TaxCategory,
} from '../../interfaces';
import { ProductsService } from '../../services/products.service';
import { CategoriesService } from '../../services/categories.service';
import { BrandsService } from '../../services/brands.service';
import { TaxesService } from '../../services/taxes.service';
import { CategoryQuickCreateComponent } from '../../components/category-quick-create.component';
import { BrandQuickCreateComponent } from '../../components/brand-quick-create.component';
import { TaxQuickCreateComponent } from '../../components/tax-quick-create.component';
import { AdjustmentCreateModalComponent } from '../../../inventory/operations/components/adjustment-create-modal.component';
import { InventoryService } from '../../../inventory/services/inventory.service';
import { CreateAdjustmentDto } from '../../../inventory/interfaces';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

interface VariantAttribute {
  name: string;
  values: string[];
}

interface GeneratedVariant {
  sku: string;
  name: string;
  price: number;
  cost_price: number;
  profit_margin: number;
  is_on_sale: boolean;
  sale_price: number;
  stock: number;
  attributes: Record<string, string>;
  image_url?: string;
  image_file?: File;
  image_id?: number;
}

@Component({
  selector: 'app-product-create-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    MultiSelectorComponent,
    TextareaComponent,
    ModalComponent,
    SettingToggleComponent,
    CategoryQuickCreateComponent,
    BrandQuickCreateComponent,
    TaxQuickCreateComponent,
    AdjustmentCreateModalComponent,
    StickyHeaderComponent,
    CurrencyPipe,
  ],
  templateUrl: './product-create-page.component.html',
})
export class ProductCreatePageComponent implements OnInit {
  private fb = inject(FormBuilder);
  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);
  private brandsService = inject(BrandsService);
  private taxesService = inject(TaxesService);
  private toastService = inject(ToastService);
  private inventoryService = inject(InventoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);

  productForm: FormGroup = this.createForm();
  isSubmitting = signal(false);
  isEditMode = signal(false);
  productId: number | null = null;
  product: Product | null = null;

  imageUrls: string[] = [];
  activeImageIndex = 0;
  isStockDetailsOpen = false;
  categoryOptions: MultiSelectorOption[] = [];
  brandOptions: SelectorOption[] = [];
  taxCategoryOptions: MultiSelectorOption[] = [];
  stateOptions: SelectorOption[] = [
    { value: ProductState.ACTIVE, label: 'Activo' },
    { value: ProductState.INACTIVE, label: 'Inactivo' },
    { value: ProductState.ARCHIVED, label: 'Archivado' },
  ];

  // Variants State
  hasVariants = false;
  variantAttributes: VariantAttribute[] = [];
  generatedVariants: GeneratedVariant[] = [];

  // New Attribute Input
  newAttributeName = '';
  newAttributeValue = '';
  currentAttributeValues: string[] = [];

  // Quick create modals state
  isCategoryCreateOpen = false;
  isBrandCreateOpen = false;
  isTaxCategoryCreateOpen = false;
  isAdjustmentModalOpen = false;
  isAdjusting = false;

  // Trigger for computed units to react to non-signal form state changes
  private formUpdateTrigger = signal(0);

  readonly productHeaderActions = computed<StickyHeaderActionButton[]>(() => {
    this.formUpdateTrigger(); // Dependency
    return [
      {
        id: 'cancel',
        label: 'Cancelar',
        variant: 'outline',
      },
      {
        id: 'save',
        label: this.isEditMode() ? 'Guardar Cambios' : 'Crear Producto',
        variant: 'primary',
        loading: this.isSubmitting(),
        disabled: this.isSubmitting() || this.productForm.invalid,
      },
    ];
  });

  constructor() {
    // Sincronizar trigger con cambios del formulario
    this.productForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formUpdateTrigger.update(v => v + 1));
    this.productForm.statusChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formUpdateTrigger.update(v => v + 1));
  }

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();
    this.loadCategoriesAndBrands();

    // Check for ID in route to determine edit mode
    this.route.params.subscribe((params: Params) => {
      if (params['id']) {
        this.productId = +params['id'];
        this.isEditMode.set(true);
        this.loadProduct(this.productId);
      }
    });
  }

  private createForm(): FormGroup {
    const form = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(1),
          Validators.maxLength(255),
        ],
      ],
      slug: ['', [Validators.maxLength(255)]],
      description: [''],
      cost_price: [0, [Validators.min(0)]],
      profit_margin: [0, [Validators.min(0)]],
      base_price: [0, [Validators.required, Validators.min(0)]],
      is_on_sale: [false],
      sale_price: [0, [Validators.min(0)]],
      available_for_ecommerce: [true],
      sku: ['', [Validators.maxLength(100)]],
      stock_quantity: [0, [Validators.min(0)]],
      category_ids: [[] as number[]],
      brand_id: [null],
      tax_category_ids: [[] as number[]],
      weight: [0, [Validators.min(0)]],
      dimensions: this.fb.group({
        length: [0, [Validators.min(0)]],
        width: [0, [Validators.min(0)]],
        height: [0, [Validators.min(0)]]
      }),
      state: [ProductState.ACTIVE],
    });

    this.setupPriceCalculations(form);
    return form;
  }

  private setupPriceCalculations(form: FormGroup): void {
    const costCtrl = form.get('cost_price');
    const marginCtrl = form.get('profit_margin');
    const basePriceCtrl = form.get('base_price');

    // Calculate base_price from cost and margin
    costCtrl?.valueChanges.subscribe(() => this.calculateBasePrice(form));
    marginCtrl?.valueChanges.subscribe(() => this.calculateBasePrice(form));

    // Calculate margin from base_price and cost
    basePriceCtrl?.valueChanges.subscribe(() => {
      const cost = Number(costCtrl?.value || 0);
      const basePrice = Number(basePriceCtrl?.value || 0);

      if (cost > 0 && !this.isCalculating) {
        this.isCalculating = true;
        const margin = ((basePrice - cost) / cost) * 100;
        marginCtrl?.setValue(Number(margin.toFixed(2)), { emitEvent: false });
        this.isCalculating = false;
      }
    });
  }

  private isCalculating = false;
  private calculateBasePrice(form: FormGroup): void {
    if (this.isCalculating) return;

    const cost = Number(form.get('cost_price')?.value || 0);
    const margin = Number(form.get('profit_margin')?.value || 0);

    this.isCalculating = true;
    const basePrice = cost * (1 + margin / 100);
    form
      .get('base_price')
      ?.setValue(Number(basePrice.toFixed(2)), { emitEvent: false });
    this.isCalculating = false;
  }

  get priceWithTax(): number {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    const selectedTaxIds =
      this.productForm.get('tax_category_ids')?.value || [];

    let totalTaxRate = 0;
    selectedTaxIds.forEach((id: number) => {
      const taxCat = this.allTaxCategories.find((tc) => tc.id === id);
      if (taxCat) {
        // Extraer la tasa del primer tax_rate si no existe en el nivel superior
        const rawRate = taxCat.rate ?? taxCat.tax_rates?.[0]?.rate ?? 0;
        const rate = parseFloat(String(rawRate));
        totalTaxRate += isNaN(rate) ? 0 : rate;
      }
    });

    return basePrice * (1 + totalTaxRate);
  }

  private allTaxCategories: TaxCategory[] = [];

  private loadProduct(id: number): void {
    this.productsService.getProductById(id).subscribe({
      next: (product: Product) => {
        this.product = product;
        this.patchForm(product);
      },
      error: (error: any) => {
        console.error('Error loading product:', error);
        this.toastService.error('Error al cargar el producto');
        this.router.navigate(['/admin/products']);
      },
    });
  }

  private patchForm(product: Product): void {
    // Extract category IDs from categories (API returns categories directly)
    const categoryIds = (product.categories || [])
      .map((c: ProductCategory) => c.id)
      .filter((id) => id !== undefined);

    // Extract tax category IDs
    const taxCategoryIds = (product.product_tax_assignments || [])
      .map((ta: any) => ta.tax_category_id)
      .filter((id) => id !== undefined);

    this.productForm.patchValue({
      name: product.name,
      slug: product.slug,
      description: product.description,
      cost_price: product.cost_price || 0,
      profit_margin: product.profit_margin || 0,
      base_price: product.base_price,
      is_on_sale: product.is_on_sale || false,
      sale_price: product.sale_price || 0,
      available_for_ecommerce: product.available_for_ecommerce !== false,
      sku: product.sku,
      stock_quantity: product.stock_quantity,
      category_ids: categoryIds,
      brand_id: product.brand?.id ?? product.brand_id,
      tax_category_ids: taxCategoryIds,
      state: product.state,
      weight: product.weight || 0,
      dimensions: {
        length: product.dimensions?.length || 0,
        width: product.dimensions?.width || 0,
        height: product.dimensions?.height || 0
      }
    });

    // Load images
    if (product.product_images && product.product_images.length > 0) {
      this.imageUrls = product.product_images.map((img: any) => img.image_url);
    }

    // Load variants if present
    if (product.product_variants && product.product_variants.length > 0) {
      this.hasVariants = true;
      this.generatedVariants = product.product_variants.map((v: any) => ({
        sku: v.sku,
        name: v.name || `${product.name} - ${v.sku}`,
        price:
          v.price_override !== undefined && v.price_override !== null
            ? Number(v.price_override)
            : Number(product.base_price),
        cost_price: Number(v.cost_price || product.cost_price || 0),
        profit_margin: Number(v.profit_margin || product.profit_margin || 0),
        is_on_sale: !!v.is_on_sale,
        sale_price: Number(v.sale_price || 0),
        stock: v.stock_quantity,
        attributes: v.attributes || {},
        image_url: v.product_images?.image_url || undefined,
        image_id: v.image_id || undefined,
      }));

      // Try to reconstruct variantAttributes from variants if possible
      // This is a bit complex without stored attribute definitions
      // For now, we just show the generated variants list
    }
  }

  private loadCategoriesAndBrands(): void {
    this.loadCategories();
    this.loadBrands();
    this.loadTaxCategories();
  }

  private loadCategories(): void {
    this.categoriesService.getCategories().subscribe({
      next: (categories: ProductCategory[]) => {
        this.categoryOptions = categories.map((cat: ProductCategory) => ({
          value: cat.id,
          label: cat.name,
          description: cat.description,
        }));
      },
      error: (error: any) => {
        console.error('Error loading categories:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar categorías');
      },
    });
  }

  private loadTaxCategories(): void {
    this.taxesService.getTaxCategories().subscribe({
      next: (taxCategories: TaxCategory[]) => {
        this.allTaxCategories = taxCategories;
        this.taxCategoryOptions = taxCategories.map((cat: TaxCategory) => {
          // Extraer la tasa del primer tax_rate si no existe en el nivel superior
          const rawRate = cat.rate ?? cat.tax_rates?.[0]?.rate ?? 0;
          const rate = parseFloat(String(rawRate));
          const finalRate = isNaN(rate) ? 0 : rate;

          return {
            value: cat.id,
            label: `${cat.name} (${(finalRate * 100).toFixed(0)}%)`,
            description: cat.description,
          };
        });
      },
      error: (error: any) => {
        console.error('Error loading tax categories:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(
          message,
          'Error al cargar categorías de impuestos',
        );
      },
    });
  }

  private loadBrands(): void {
    this.brandsService.getBrands().subscribe({
      next: (brands: Brand[]) => {
        this.brandOptions = brands.map((brand: Brand) => ({
          value: brand.id,
          label: brand.name,
          description: brand.description,
        }));

        // Re-set the brand value to force selector sync after options load
        const brandControl = this.productForm.get('brand_id');
        if (brandControl?.value) {
          const currentValue = brandControl.value;
          brandControl.setValue(currentValue);
        }
      },
      error: (error: any) => {
        console.error('Error loading brands:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar marcas');
      },
    });
  }

  get totalVariantStock(): number {
    return this.generatedVariants.reduce(
      (sum, v) => sum + (v.stock || 0),
      0,
    );
  }

  toggleVariants(isChecked: boolean): void {
    const currentStock = this.productForm.get('stock_quantity')?.value || 0;

    // If enabling variants in edit mode with existing stock, show warning
    if (isChecked && this.isEditMode() && currentStock > 0) {
      this.dialogService
        .confirm({
          title: 'Activar variantes',
          message: `Al activar variantes, el stock actual (${currentStock} unidades) será reiniciado a 0. Deberás asignar stock a cada variante individualmente.`,
          confirmText: 'Activar variantes',
          cancelText: 'Cancelar',
          confirmVariant: 'danger',
        })
        .then((confirmed: boolean) => {
          if (confirmed) {
            this.applyVariantToggle(true);
          }
          // If not confirmed, don't change hasVariants
        });
      return;
    }

    this.applyVariantToggle(isChecked);
  }

  private applyVariantToggle(isChecked: boolean): void {
    this.hasVariants = isChecked;

    const priceControl = this.productForm.get('base_price');
    const stockControl = this.productForm.get('stock_quantity');

    if (this.hasVariants) {
      priceControl?.clearValidators();
      stockControl?.clearValidators();
      if (this.variantAttributes.length === 0) {
        this.variantAttributes.push({ name: '', values: [] });
      }
    } else {
      priceControl?.setValidators([Validators.required, Validators.min(0)]);
      stockControl?.setValidators([Validators.min(0)]);
    }
    priceControl?.updateValueAndValidity();
    stockControl?.updateValueAndValidity();
  }

  // Variant Attribute Management
  addAttribute(): void {
    this.variantAttributes.push({ name: '', values: [] });
  }

  removeAttribute(index: number): void {
    this.variantAttributes.splice(index, 1);
    this.generateVariants();
  }

  addAttributeValue(attrIndex: number, event: any): void {
    const value = event.target.value.trim();
    if (value) {
      if (!this.variantAttributes[attrIndex].values.includes(value)) {
        this.variantAttributes[attrIndex].values.push(value);
        this.generateVariants();
      }
      event.target.value = '';
    }
  }

  removeAttributeValue(attrIndex: number, valueIndex: number): void {
    this.variantAttributes[attrIndex].values.splice(valueIndex, 1);
    this.generateVariants();
  }

  generateVariants(): void {
    // Filter incomplete attributes
    const validAttributes = this.variantAttributes.filter(
      (attr) => attr.name && attr.values.length > 0,
    );

    if (validAttributes.length === 0) {
      this.generatedVariants = [];
      return;
    }

    // Generate Cartesian product
    const combinations = this.cartesian(validAttributes.map((a) => a.values));

    const basePrice = this.productForm.get('base_price')?.value || 0;
    const baseCost = this.productForm.get('cost_price')?.value || 0;
    const baseMargin = this.productForm.get('profit_margin')?.value || 0;
    const baseSku = this.productForm.get('sku')?.value || '';

    this.generatedVariants = combinations.map((combo) => {
      const attributes: Record<string, string> = {};
      let nameSuffix = '';
      let skuSuffix = '';

      validAttributes.forEach((attr, index) => {
        const value = combo[index];
        attributes[attr.name] = value;
        nameSuffix += ` ${value}`; // e.g. " Red L"
        skuSuffix += `-${value.toUpperCase().substring(0, 3)}`; // e.g. "-RED-L"
      });

      // Check if this variant already exists to preserve custom values
      const existing = this.generatedVariants.find(
        (v) => JSON.stringify(v.attributes) === JSON.stringify(attributes),
      );

      if (existing) return existing;

      return {
        name: `${this.productForm.get('name')?.value || 'Product'}${nameSuffix}`,
        sku: baseSku ? `${baseSku}${skuSuffix}` : '',
        price: basePrice,
        cost_price: baseCost,
        profit_margin: baseMargin,
        is_on_sale: false,
        sale_price: 0,
        stock: 0,
        attributes,
      };
    });
  }

  private cartesian(args: any[][]): any[] {
    const r: any[] = [];
    const max = args.length - 1;
    function helper(arr: any[], i: number) {
      for (let j = 0, l = args[i].length; j < l; j++) {
        const a = arr.slice(0); // clone arr
        a.push(args[i][j]);
        if (i == max) r.push(a);
        else helper(a, i + 1);
      }
    }
    if (args.length > 0) helper([], 0);
    return r;
  }

  // --- Variant Pricing (bidirectional) ---
  private variantIsCalculating = false;

  onVariantCostOrMarginChange(variant: GeneratedVariant): void {
    if (this.variantIsCalculating) return;
    this.variantIsCalculating = true;
    const cost = Number(variant.cost_price || 0);
    const margin = Number(variant.profit_margin || 0);
    variant.price = Number((cost * (1 + margin / 100)).toFixed(2));
    this.variantIsCalculating = false;
  }

  onVariantPriceChange(variant: GeneratedVariant): void {
    if (this.variantIsCalculating) return;
    this.variantIsCalculating = true;
    const cost = Number(variant.cost_price || 0);
    const price = Number(variant.price || 0);
    if (cost > 0) {
      variant.profit_margin = Number((((price - cost) / cost) * 100).toFixed(2));
    }
    this.variantIsCalculating = false;
  }

  getVariantPriceWithTax(variant: GeneratedVariant): number {
    const activePrice = variant.is_on_sale && variant.sale_price
      ? Number(variant.sale_price)
      : Number(variant.price || 0);

    const selectedTaxIds = this.productForm.get('tax_category_ids')?.value || [];
    let totalTaxRate = 0;
    selectedTaxIds.forEach((id: number) => {
      const taxCat = this.allTaxCategories.find((tc) => tc.id === id);
      if (taxCat) {
        const rawRate = taxCat.rate ?? taxCat.tax_rates?.[0]?.rate ?? 0;
        const rate = parseFloat(String(rawRate));
        totalTaxRate += isNaN(rate) ? 0 : rate;
      }
    });

    return activePrice * (1 + totalTaxRate);
  }

  // --- Variant Image Handling ---
  triggerVariantImageUpload(idx: number): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        this.toastService.warning('La imagen no puede superar 2MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        this.generatedVariants[idx].image_url = e.target?.result as string;
        this.generatedVariants[idx].image_file = file;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  removeVariantImage(idx: number): void {
    this.generatedVariants[idx].image_url = undefined;
    this.generatedVariants[idx].image_file = undefined;
    this.generatedVariants[idx].image_id = undefined;
  }

  // ... (Copy basic handlers from Modal: ImageUrl, FileSelect, etc.) ...
  onCategoryCreated(category: ProductCategory): void {
    this.loadCategories();
    // Add to current selection
    const currentIds = this.productForm.get('category_ids')?.value || [];
    if (category && category.id) {
      this.productForm.patchValue({
        category_ids: [...currentIds, category.id],
      });
    }
    this.isCategoryCreateOpen = false;
  }

  onBrandCreated(brand: Brand): void {
    this.loadBrands();
    if (brand && brand.id) {
      this.productForm.patchValue({ brand_id: brand.id });
    }
    this.isBrandCreateOpen = false;
  }

  onTaxCategoryCreated(taxCategory: TaxCategory): void {
    this.loadTaxCategories();
    // Add to current selection
    const currentIds = this.productForm.get('tax_category_ids')?.value || [];
    if (taxCategory && taxCategory.id) {
      this.productForm.patchValue({
        tax_category_ids: [...currentIds, taxCategory.id],
      });
    }
    // Keep modal open for creating another
  }

  get totalStockOnHand(): number {
    return (this.product?.stock_levels || []).reduce(
      (sum, sl: any) => sum + (sl.quantity_on_hand || 0),
      0,
    );
  }

  get totalStockAvailable(): number {
    return (this.product?.stock_levels || []).reduce(
      (sum, sl: any) => sum + (sl.quantity_available || 0),
      0,
    );
  }

  get totalStockReserved(): number {
    return (this.product?.stock_levels || []).reduce(
      (sum, sl: any) => sum + (sl.quantity_reserved || 0),
      0,
    );
  }

  get lowStockCount(): number {
    return (this.product?.stock_levels || []).filter(
      (sl: any) => (sl.quantity_available || 0) <= (sl.reorder_point || 0),
    ).length;
  }

  get warehouseCount(): number {
    return new Set(
      (this.product?.stock_levels || []).map((sl: any) => sl.location_id),
    ).size;
  }

  isExpired(date: Date | string): boolean {
    if (!date) return false;
    const expiryDate = new Date(date);
    const today = new Date();
    return expiryDate < today;
  }

  triggerFileUpload(): void {
    const fileInput = document.querySelector('.file-input') as HTMLInputElement;
    fileInput?.click();
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files) {
      const filesArray = Array.from(files);
      const remainingSlots = 5 - this.imageUrls.length;

      if (remainingSlots <= 0) {
        this.toastService.warning('Límite de 5 imágenes alcanzado');
        input.value = '';
        return;
      }

      filesArray.slice(0, remainingSlots).forEach((file) => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const result = e.target?.result as string;
            this.imageUrls.push(result);
            if (this.imageUrls.length === 1) {
              this.activeImageIndex = 0;
            }
          };
          reader.readAsDataURL(file);
        }
      });
      input.value = '';
    }
  }

  removeImage(index: number): void {
    this.imageUrls.splice(index, 1);
    if (this.activeImageIndex >= this.imageUrls.length) {
      this.activeImageIndex = Math.max(0, this.imageUrls.length - 1);
    }
  }

  setActiveImage(index: number): void {
    this.activeImageIndex = index;
  }

  nextImage(): void {
    if (this.imageUrls.length === 0) return;
    this.activeImageIndex = (this.activeImageIndex + 1) % this.imageUrls.length;
  }

  prevImage(): void {
    if (this.imageUrls.length === 0) return;
    this.activeImageIndex =
      (this.activeImageIndex - 1 + this.imageUrls.length) %
      this.imageUrls.length;
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src =
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRjRNEY2Ii8+CjxwYXRoIGQ9Ik0xMiA2VjEwTDEwIDhMMTIgNlpNMTIgNlYxMEwxNCA4TDEyIDZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
  }

  private isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  onCancel(): void {
    this.router.navigate(['/admin/products']);
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') this.onCancel();
    else if (actionId === 'save') this.onSubmit();
  }

  onSubmit(): void {
    if (this.productForm.invalid || this.isSubmitting()) {
      this.productForm.markAllAsTouched();
      this.toastService.error(
        'Por favor, completa todos los campos requeridos correctamente',
        'Formulario inválido',
      );
      return;
    }

    this.isSubmitting.set(true);
    const formValue = this.productForm.value;

    // Prepare Images
    const images: CreateProductImageDto[] = this.imageUrls.map(
      (url, index) => ({
        image_url: url,
        is_main: index === 0,
      }),
    );

    // Basic DTO
    const productData: CreateProductDto = {
      name: formValue.name,
      slug: formValue.slug || undefined,
      description: formValue.description || undefined,
      cost_price: Number(formValue.cost_price),
      profit_margin: Number(formValue.profit_margin),
      base_price: Number(formValue.base_price),
      is_on_sale: !!formValue.is_on_sale,
      sale_price: Number(formValue.sale_price),
      available_for_ecommerce: !!formValue.available_for_ecommerce,
      sku: formValue.sku || undefined,
      stock_quantity: Number(formValue.stock_quantity),
      category_ids: formValue.category_ids || [],
      tax_category_ids: formValue.tax_category_ids || [],
      brand_id: formValue.brand_id ? Number(formValue.brand_id) : null,
      state: formValue.state || ProductState.ACTIVE,
      images: images.length > 0 ? images : undefined,
      weight: formValue.weight > 0 ? Number(formValue.weight) : undefined,
      dimensions: formValue.dimensions && (
        formValue.dimensions.length > 0 ||
        formValue.dimensions.width > 0 ||
        formValue.dimensions.height > 0
      ) ? {
        length: Number(formValue.dimensions.length),
        width: Number(formValue.dimensions.width),
        height: Number(formValue.dimensions.height)
      } : undefined,
    };

    // Add Variants if enabled
    if (this.hasVariants && this.generatedVariants.length > 0) {
      productData.variants = this.generatedVariants.map((v) => ({
        sku: v.sku,
        name: v.name,
        price_override: Number(v.price),
        cost_price: Number(v.cost_price),
        profit_margin: Number(v.profit_margin),
        is_on_sale: !!v.is_on_sale,
        sale_price: Number(v.sale_price),
        stock_quantity: Number(v.stock),
        attributes: v.attributes,
        variant_image_url: v.image_url?.startsWith('data:') ? v.image_url : undefined,
      }));

      // Set base stock_quantity to the sum of variant stocks for immediate UI consistency
      // Backend syncProductStock() handles the real sync
      productData.stock_quantity = this.totalVariantStock;
    }

    const request$ =
      this.isEditMode() && this.productId
        ? this.productsService.updateProduct(this.productId, productData as any) // Cast to any to avoid strict UpdateDto mismatch if needed, or fix DTO
        : this.productsService.createProduct(productData);

    request$.subscribe({
      next: () => {
        this.toastService.success(
          this.isEditMode()
            ? 'Producto actualizado correctamente'
            : 'Producto creado correctamente',
        );
        this.router.navigate(['/admin/products']);
      },
      error: (err: any) => {
        console.error('Error saving product:', err);
        const message = extractApiErrorMessage(err);
        this.toastService.error(
          message,
          this.isEditMode()
            ? 'Error al actualizar el producto'
            : 'Error al crear el producto',
        );
        this.isSubmitting.set(false);
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.productForm.get(fieldName);
    if (!field || !field.errors || !field.touched) return '';
    if (field.errors['required']) return 'Required field';
    if (field.errors['min']) return `Min value: ${field.errors['min'].min}`;
    return 'Invalid value';
  }

  // Adjustment Modal
  openAdjustmentModal(): void {
    this.isAdjustmentModalOpen = true;
  }

  openStockAdjustment(): void {
    this.openAdjustmentModal();
  }

  goToPurchase(): void {
    if (this.productId) {
      this.router.navigate(['/admin/inventory/pop'], {
        queryParams: { product_id: this.productId },
      });
    }
  }

  closeAdjustmentModal(): void {
    this.isAdjustmentModalOpen = false;
  }

  onAdjustmentSave(dto: CreateAdjustmentDto): void {
    this.isAdjusting = true;
    this.inventoryService.createAdjustment(dto).subscribe({
      next: () => {
        this.toastService.success(
          'Ajuste de inventario realizado correctamente',
        );
        this.isAdjusting = false;
        this.closeAdjustmentModal();
        // Reload product to see stock changes (optional but good)
        if (this.productId) {
          this.loadProduct(this.productId);
        }
        // Redirect to adjustments history as per plan
        this.router.navigate(['/admin/inventory/adjustments']);
      },
      error: (err) => {
        console.error('Error creating adjustment', err);
        this.toastService.error('Error al realizar el ajuste');
        this.isAdjusting = false;
      },
    });
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
