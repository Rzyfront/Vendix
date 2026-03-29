import {
  Component,
  OnInit,
  computed,
  signal,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
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
  InputButtonsComponent,
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
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../shared/pipes/currency';
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
import { ReservationsService } from '../../../reservations/services/reservations.service';
import { ServiceProvider } from '../../../reservations/interfaces/reservation.interface';
import { CategoryQuickCreateComponent } from '../../components/category-quick-create.component';
import { BrandQuickCreateComponent } from '../../components/brand-quick-create.component';
import { TaxQuickCreateComponent } from '../../components/tax-quick-create.component';
import { AdjustmentCreateModalComponent } from '../../../inventory/operations/components/adjustment-create-modal.component';
import { InventoryService } from '../../../inventory/services/inventory.service';
import { BatchCreateAdjustmentsRequest, PreselectedProduct } from '../../../inventory/interfaces';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { PromotionsService } from '../../../marketing/promotions/services/promotions.service';

interface VariantAttribute {
  name: string;
  values: string[];
}

interface GeneratedVariant {
  id?: number;
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
    InputButtonsComponent,
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
  styles: [
    `
      /* ── AI Generate Button (subscription card style) ── */
      .ai-generate-btn {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 5px;
        border: 1px solid rgba(var(--color-primary-rgb), 0.4);
        font-size: 8px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.5) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.65) 25%,
          rgba(var(--color-primary-rgb), 0.4) 50%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.7) 75%,
          rgba(var(--color-primary-rgb), 0.55) 100%
        );
        background-size: 200% 200%;
        animation: ai-shimmer 3s ease-in-out infinite;
        color: white;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.1),
          0 2px 8px rgba(var(--color-primary-rgb), 0.3);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      }

      .ai-generate-btn:hover,
      .ai-description-wrapper:hover .ai-generate-btn {
        background: linear-gradient(
          135deg,
          var(--color-primary) 0%,
          color-mix(in srgb, var(--color-primary), white 20%) 25%,
          var(--color-primary) 50%,
          color-mix(in srgb, var(--color-primary), black 15%) 75%,
          var(--color-primary) 100%
        );
        background-size: 200% 200%;
        animation: ai-shimmer 2s ease-in-out infinite;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.2),
          0 4px 16px rgba(var(--color-primary-rgb), 0.5),
          0 0 28px rgba(var(--color-primary-rgb), 0.5);
        transform: translateY(-1px);
      }

      .ai-generate-btn:disabled {
        cursor: not-allowed;
        transform: none;
        animation: ai-shimmer 1.5s ease-in-out infinite;
      }

      /* ── Hover propagation: button hover → label + textarea ── */
      .ai-description-wrapper .ai-label {
        transition: all 0.4s ease;
      }

      .ai-description-wrapper .ai-textarea-wrapper {
        transition: all 0.4s ease;
        border-radius: 12px;
        padding: 2px;
        background: transparent;
      }

      .ai-description-wrapper:has(.ai-generate-btn:hover:not(:disabled))
        .ai-label {
        background: linear-gradient(
          90deg,
          rgba(var(--color-primary-rgb), 1) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 1) 50%,
          rgba(var(--color-primary-rgb), 1) 100%
        );
        background-size: 200% 100%;
        animation: ai-shimmer 2s ease-in-out infinite;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 600;
      }

      .ai-description-wrapper:has(.ai-generate-btn:hover:not(:disabled))
        .ai-textarea-wrapper {
        position: relative;
        border-radius: 12px;
        padding: 2px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.4) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.6) 25%,
          rgba(var(--color-primary-rgb), 0.3) 50%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.6) 75%,
          rgba(var(--color-primary-rgb), 0.4) 100%
        );
        background-size: 300% 300%;
        animation: ai-outline-flow 2s ease-in-out infinite;
      }

      .ai-description-wrapper:has(.ai-generate-btn:hover:not(:disabled))
        .ai-textarea-wrapper
        ::ng-deep
        textarea {
        border: none !important;
        border-radius: 10px;
      }

      /* ── Tooltip ── */
      .ai-tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        padding: 6px 12px;
        border-radius: 8px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.85) 0%,
          rgba(var(--color-primary-rgb), 0.95) 50%,
          rgba(var(--color-primary-rgb), 0.85) 100%
        );
        background-size: 200% 200%;
        animation: ai-shimmer 3s ease-in-out infinite;
        color: white;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 0.2s ease,
          transform 0.2s ease;
        transform: translateY(4px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.25),
          inset 0 1px 1px rgba(255, 255, 255, 0.15);
      }

      .ai-generate-btn:hover .ai-tooltip {
        opacity: 1;
        transform: translateY(0);
      }

      /* ── Generating State: animated outline on textarea ── */
      .ai-generating .ai-textarea-wrapper,
      .ai-description-wrapper:hover .ai-textarea-wrapper {
        position: relative;
        border-radius: 12px;
        padding: 2px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.6) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.8) 25%,
          rgba(var(--color-primary-rgb), 0.4) 50%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.9) 75%,
          rgba(var(--color-primary-rgb), 0.5) 100%
        );
        background-size: 300% 300%;
        animation: ai-outline-flow 2s ease-in-out infinite;
      }

      .ai-generating .ai-textarea-wrapper ::ng-deep textarea,
      .ai-description-wrapper:hover .ai-textarea-wrapper ::ng-deep textarea {
        border: none !important;
        border-radius: 10px;
      }

      .ai-generating .ai-label,
      .ai-description-wrapper:hover .ai-label {
        background: linear-gradient(
          90deg,
          rgba(var(--color-primary-rgb), 1) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 1) 50%,
          rgba(var(--color-primary-rgb), 1) 100%
        );
        background-size: 200% 100%;
        animation: ai-shimmer 2s ease-in-out infinite;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 600;
      }

      @keyframes ai-shimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      @keyframes ai-outline-flow {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }
    `,
  ],
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
  private cdr = inject(ChangeDetectorRef);
  private promotionsService = inject(PromotionsService);
  private reservationsService = inject(ReservationsService);

  // Provider assignment (for services with requires_booking)
  assignedProviders = signal<ServiceProvider[]>([]);
  allProviders = signal<ServiceProvider[]>([]);
  loadingProviders = signal(false);

  // Promotions
  promotionOptions: MultiSelectorOption[] = [];
  productPromotionIds: number[] = [];

  // Image loading state for feedback visual
  isLoadingImages = false;
  loadingProgress = 0;

  productForm: FormGroup = this.createForm();
  isSubmitting = signal(false);
  isGeneratingDescription = signal(false);
  aiDescriptionUsesLeft = signal(3);
  aiDescriptionLimitReached = computed(() => this.aiDescriptionUsesLeft() <= 0);
  isEditMode = signal(false);
  productId: number | null = null;
  product: Product | null = null;

  imageUrls: string[] = [];
  imageIds: (number | null)[] = []; // Parallel array: DB image ID (null for new/unsaved images)
  activeImageIndex = 0;
  isStockDetailsOpen = false;
  isReleasingReservations = false;
  categoryOptions: MultiSelectorOption[] = [];
  brandOptions: SelectorOption[] = [];
  taxCategoryOptions: MultiSelectorOption[] = [];
  stateOptions: SelectorOption[] = [
    { value: ProductState.ACTIVE, label: 'Activo' },
    { value: ProductState.INACTIVE, label: 'Inactivo' },
    { value: ProductState.ARCHIVED, label: 'Archivado' },
  ];

  pricingTypeOptions: { value: string; label: string }[] = [
    { value: 'unit', label: 'Venta por unidad' },
    { value: 'weight', label: 'Venta por peso (kg)' },
  ];

  productTypeOptions: { value: string; label: string }[] = [
    { value: 'physical', label: 'Producto Físico' },
    { value: 'service', label: 'Servicio' },
  ];

  serviceModalityOptions: SelectorOption[] = [
    { value: 'in_person', label: 'Presencial' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'hybrid', label: 'Híbrido' },
  ];

  servicePricingTypeOptions: SelectorOption[] = [
    { value: 'per_hour', label: 'Por hora' },
    { value: 'per_session', label: 'Por sesión' },
    { value: 'package', label: 'Paquete' },
    { value: 'subscription', label: 'Suscripción' },
  ];

  get isService(): boolean {
    return this.productForm.get('product_type')?.value === 'service';
  }

  onProductTypeChange(value: string): void {
    if (value === 'service') {
      this.productForm.patchValue({
        track_inventory: false,
        weight: 0,
        dimensions: { length: 0, width: 0, height: 0 },
        stock_quantity: 0,
      });
    } else {
      this.productForm.patchValue({
        track_inventory: true,
        service_duration_minutes: null,
        service_modality: null,
        service_pricing_type: null,
        requires_booking: false,
        booking_mode: null,
        is_recurring: false,
        service_instructions: '',
      });
    }
    this.cdr.detectChanges();
  }

  // Variants State
  hasVariants = false;
  variantAttributes: VariantAttribute[] = [];
  generatedVariants: GeneratedVariant[] = [];
  removedVariantKeys = new Set<string>();
  expandedVariantIndex = signal<number | null>(null);

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
  adjustmentLocationOptions: SelectorOption[] = [];

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
    this.productForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.formUpdateTrigger.update((v) => v + 1));
    this.productForm.statusChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.formUpdateTrigger.update((v) => v + 1));
  }

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();
    this.loadCategoriesAndBrands();

    // Verificar draft del modal de creación rápida
    const navState = history.state;
    if (navState?.draft) {
      this.applyDraftData(navState.draft);
    }

    // Check for ID in route to determine edit mode
    this.route.params.subscribe((params: Params) => {
      if (params['id']) {
        this.productId = +params['id'];
        this.isEditMode.set(true);
        this.loadProduct(this.productId);
        this.loadPromotionOptions();
        this.loadProductPromotions(this.productId);
      }
    });
  }

  private applyDraftData(draft: any): void {
    this.productForm.patchValue({
      name: draft.name || '',
      description: draft.description || '',
      base_price: draft.base_price || 0,
      stock_quantity: draft.stock_quantity || 0,
      track_inventory: draft.track_inventory ?? true,
      sku: draft.sku || '',
      category_ids: draft.category_ids || [],
      brand_id: draft.brand_id || null,
      tax_category_ids: draft.tax_category_ids || [],
      state: draft.state || ProductState.ACTIVE,
    });
  }

  loadPromotionOptions(): void {
    this.promotionsService
      .getPromotions({ limit: 200 })
      .subscribe((res) => {
        this.promotionOptions = res.data.map((p: any) => ({
          value: p.id,
          label: p.name,
          description: `${p.type === 'percentage' ? p.value + '%' : '$' + p.value} — ${p.state}`,
        }));
      });
  }

  loadProductPromotions(productId: number): void {
    this.productsService.getProductPromotions(productId).subscribe((promos) => {
      this.productPromotionIds = promos.map((p: any) => p.id);
    });
  }

  onPromotionsChange(ids: (string | number)[]): void {
    if (!this.productId) return;
    const numericIds = ids.map((id) => Number(id));
    this.productsService
      .updateProductPromotions(this.productId, numericIds)
      .subscribe({
        next: (promos) => {
          this.productPromotionIds = promos.map((p: any) => p.id);
          this.toastService.success('Promociones actualizadas');
        },
        error: () => {
          this.toastService.error('Error al actualizar promociones');
        },
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
      track_inventory: [true],
      category_ids: [[] as number[]],
      brand_id: [null],
      tax_category_ids: [[] as number[]],
      weight: [0, [Validators.min(0)]],
      dimensions: this.fb.group({
        length: [0, [Validators.min(0)]],
        width: [0, [Validators.min(0)]],
        height: [0, [Validators.min(0)]],
      }),
      state: [ProductState.ACTIVE],
      pricing_type: ['unit' as const],
      product_type: ['physical' as const],
      service_duration_minutes: [null],
      service_modality: [null],
      service_pricing_type: [null],
      requires_booking: [false],
      booking_mode: [null],
      is_recurring: [false],
      service_instructions: [''],
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
      track_inventory: product.track_inventory !== false,
      category_ids: categoryIds,
      brand_id: product.brand?.id ?? product.brand_id,
      tax_category_ids: taxCategoryIds,
      state: product.state,
      pricing_type:
        (product.pricing_type as any)?.value || product.pricing_type || 'unit',
      product_type: product.product_type || 'physical',
      service_duration_minutes: product.service_duration_minutes || null,
      service_modality: product.service_modality || null,
      service_pricing_type: product.service_pricing_type || null,
      requires_booking: product.requires_booking || false,
      booking_mode: product.booking_mode || null,
      is_recurring: product.is_recurring || false,
      service_instructions: product.service_instructions || '',
      weight: product.weight || 0,
      dimensions: {
        length: product.dimensions?.length || 0,
        width: product.dimensions?.width || 0,
        height: product.dimensions?.height || 0,
      },
    });

    // Load providers if this is a bookable service
    if (product.requires_booking && product.id) {
      this.loadProviders(product.id);
      this.loadAllProviders();
    }

    // Load images
    if (product.product_images && product.product_images.length > 0) {
      this.imageUrls = product.product_images.map((img: any) => img.image_url);
      this.imageIds = product.product_images.map((img: any) => img.id ?? null);
    }

    // Load variants if present
    if (product.product_variants && product.product_variants.length > 0) {
      this.hasVariants = true;
      this.generatedVariants = product.product_variants.map((v: any) => ({
        id: v.id,
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

      // Reconstruct variantAttributes from loaded variants
      const attributeMap = new Map<string, Set<string>>();
      for (const v of this.generatedVariants) {
        if (v.attributes) {
          for (const [key, value] of Object.entries(v.attributes)) {
            if (!attributeMap.has(key)) attributeMap.set(key, new Set());
            attributeMap.get(key)!.add(String(value));
          }
        }
      }
      this.variantAttributes = Array.from(attributeMap.entries()).map(
        ([name, values]) => ({ name, values: Array.from(values) }),
      );

      this.removedVariantKeys.clear();
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
    return this.generatedVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
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
  addQuickAttribute(name: string): void {
    // Don't add if an attribute with the same name already exists
    if (this.variantAttributes.some(a => a.name.toLowerCase() === name.toLowerCase())) {
      this.toastService.warning(`El atributo "${name}" ya existe`);
      return;
    }
    this.variantAttributes.push({ name, values: [] });
  }

  addAttribute(): void {
    this.variantAttributes.push({ name: '', values: [] });
  }

  removeAttribute(index: number): void {
    this.variantAttributes.splice(index, 1);
    this.removedVariantKeys.clear();
    this.generateVariants();
  }

  addAttributeValue(attrIndex: number, event: any): void {
    const value = event.target.value.trim();
    if (value) {
      if (!this.variantAttributes[attrIndex].values.includes(value)) {
        this.variantAttributes[attrIndex].values.push(value);
        this.removedVariantKeys.clear();
        this.generateVariants();
      }
      event.target.value = '';
    }
  }

  removeAttributeValue(attrIndex: number, valueIndex: number): void {
    this.variantAttributes[attrIndex].values.splice(valueIndex, 1);
    this.removedVariantKeys.clear();
    this.generateVariants();
  }

  generateVariants(showToast = false): void {
    // Filter incomplete attributes
    const validAttributes = this.variantAttributes.filter(
      (attr) => attr.name && attr.values.length > 0,
    );

    if (validAttributes.length === 0) {
      this.generatedVariants = [];
      return;
    }

    // Validate: warn if any attribute has a name but no values
    const incomplete = this.variantAttributes.filter(a => a.name && a.values.length === 0);
    if (incomplete.length > 0 && showToast) {
      this.toastService.warning(`El atributo "${incomplete[0].name}" no tiene valores`);
      return;
    }

    // Generate Cartesian product
    const combinations = this.cartesian(validAttributes.map((a) => a.values));

    const basePrice = this.productForm.get('base_price')?.value || 0;
    const baseCost = this.productForm.get('cost_price')?.value || 0;
    const baseMargin = this.productForm.get('profit_margin')?.value || 0;
    const baseSku = this.productForm.get('sku')?.value || '';

    this.generatedVariants = combinations
      .map((combo) => {
        const attributes: Record<string, string> = {};
        let nameSuffix = '';
        let skuSuffix = '';

        validAttributes.forEach((attr, index) => {
          const value = combo[index];
          attributes[attr.name] = value;
          nameSuffix += ` ${value}`; // e.g. " Red L"
          skuSuffix += `-${value.toUpperCase().substring(0, 3)}`; // e.g. "-RED-L"
        });

        // Skip variants that were manually removed by the user
        const key = JSON.stringify(attributes);
        if (this.removedVariantKeys.has(key)) {
          return null;
        }

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
      })
      .filter(Boolean) as GeneratedVariant[];

    if (showToast && this.generatedVariants.length > 0) {
      this.toastService.success(`Se generaron ${this.generatedVariants.length} variantes`);
    }
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
      variant.profit_margin = Number(
        (((price - cost) / cost) * 100).toFixed(2),
      );
    }
    this.variantIsCalculating = false;
  }

  getVariantPriceWithTax(variant: GeneratedVariant): number {
    const activePrice =
      variant.is_on_sale && variant.sale_price
        ? Number(variant.sale_price)
        : Number(variant.price || 0);

    const selectedTaxIds =
      this.productForm.get('tax_category_ids')?.value || [];
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

  trackByIndex(index: number): number {
    return index;
  }

  get previewVariantCount(): number {
    const validAttributes = this.variantAttributes.filter(
      (attr) => attr.name && attr.values.length > 0,
    );
    if (validAttributes.length === 0) return 0;
    return validAttributes.reduce((total, attr) => total * attr.values.length, 1);
  }

  applyBasePriceToAll(): void {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    const baseCost = Number(this.productForm.get('cost_price')?.value || 0);
    const baseMargin = Number(this.productForm.get('profit_margin')?.value || 0);
    this.generatedVariants.forEach(v => {
      v.price = basePrice;
      v.cost_price = baseCost;
      v.profit_margin = baseMargin;
    });
    this.toastService.success(`Precio base aplicado a ${this.generatedVariants.length} variantes`);
  }

  applyBaseCostToAll(): void {
    const baseCost = Number(this.productForm.get('cost_price')?.value || 0);
    const baseMargin = Number(this.productForm.get('profit_margin')?.value || 0);
    this.generatedVariants.forEach(v => {
      v.cost_price = baseCost;
      v.profit_margin = baseMargin;
      v.price = Number((baseCost * (1 + baseMargin / 100)).toFixed(2));
    });
    this.toastService.success(`Costo base aplicado a ${this.generatedVariants.length} variantes`);
  }

  toggleVariantExpand(idx: number): void {
    this.expandedVariantIndex.update(current => current === idx ? null : idx);
  }

  async removeVariant(idx: number): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar Variante',
      message: `¿Estás seguro de eliminar la variante "${this.generatedVariants[idx]?.name}"?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const variant = this.generatedVariants[idx];

    // If the variant exists in DB, delete it via API first
    if (variant.id) {
      try {
        await this.productsService.deleteProductVariant(variant.id).toPromise();
        this.toastService.success('Variante eliminada correctamente');
      } catch (err: any) {
        console.error('Error deleting variant:', err);
        this.toastService.error('Error al eliminar la variante');
        return; // Don't remove from UI if backend failed
      }
    }

    // Track removed key so generateVariants() won't recreate it on blur
    if (variant.attributes && Object.keys(variant.attributes).length > 0) {
      this.removedVariantKeys.add(JSON.stringify(variant.attributes));
    }
    this.generatedVariants.splice(idx, 1);

    // Rebuild variantAttributes from remaining variants so the UI
    // removes attribute values that no longer have any variant.
    this.rebuildAttributesFromVariants();
  }

  private rebuildAttributesFromVariants(): void {
    if (this.generatedVariants.length === 0) {
      this.variantAttributes = [];
      return;
    }

    const attributeMap = new Map<string, Set<string>>();
    for (const v of this.generatedVariants) {
      if (v.attributes) {
        for (const [key, value] of Object.entries(v.attributes)) {
          if (!attributeMap.has(key)) attributeMap.set(key, new Set());
          attributeMap.get(key)!.add(String(value));
        }
      }
    }
    this.variantAttributes = Array.from(attributeMap.entries()).map(
      ([name, values]) => ({ name, values: Array.from(values) }),
    );
  }

  async removeVariantImage(idx: number): Promise<void> {
    const variant = this.generatedVariants[idx];

    // If the image exists in DB, delete it via API (also removes from S3)
    if (variant.image_id) {
      try {
        await this.productsService
          .deleteProductImage(variant.image_id)
          .toPromise();
      } catch (err: any) {
        console.error('Error deleting variant image:', err);
        this.toastService.error('Error al eliminar la imagen de variante');
        return;
      }
    }

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

  async releaseReservations(): Promise<void> {
    if (!this.product?.id || this.totalStockReserved === 0) return;

    const confirmed = await this.dialogService.confirm({
      title: 'Liberar Reservas',
      message: `Se liberarán ${this.totalStockReserved} unidades reservadas de este producto. Las reservas activas serán canceladas y el stock quedará disponible nuevamente.`,
      confirmText: 'Liberar Reservas',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (!confirmed) return;

    this.isReleasingReservations = true;
    this.inventoryService.releaseReservationsByProduct(this.product.id).subscribe({
      next: (response) => {
        const data = response.data;
        this.toastService.success(
          `${data.released_count} reserva(s) liberadas (${data.total_quantity} unidades)`,
        );
        this.loadProduct(this.productId!);
        this.isReleasingReservations = false;
      },
      error: (error) => {
        this.toastService.error('Error al liberar reservas: ' + error);
        this.isReleasingReservations = false;
      },
    });
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

      const filesToProcess = filesArray
        .slice(0, remainingSlots)
        .filter((file) => file.type.startsWith('image/'));

      if (filesToProcess.length === 0) {
        this.toastService.warning(
          'Por favor selecciona archivos de imagen válidos',
        );
        input.value = '';
        return;
      }

      // Show loading feedback
      this.isLoadingImages = true;
      this.loadingProgress = 0;
      this.cdr.detectChanges();

      // Process images sequentially to avoid race conditions
      this.processImagesSequentially(filesToProcess, 0).then(() => {
        this.isLoadingImages = false;
        this.loadingProgress = 0;
        if (this.imageUrls.length === 1) {
          this.activeImageIndex = 0;
        }
        this.cdr.detectChanges();
        this.toastService.success(
          `${filesToProcess.length} imagen(es) cargada(s) correctamente`,
        );
      });

      input.value = '';
    }
  }

  private processImagesSequentially(
    files: File[],
    index: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (index >= files.length) {
        resolve();
        return;
      }

      const file = files[index];
      const reader = new FileReader();

      reader.onload = (e) => {
        const result = e.target?.result as string;
        this.imageUrls.push(result);
        this.imageIds.push(null);

        // Update progress
        this.loadingProgress = Math.round(((index + 1) / files.length) * 100);
        this.cdr.detectChanges();

        // Process next image
        this.processImagesSequentially(files, index + 1).then(resolve);
      };

      reader.onerror = () => {
        this.toastService.error(`Error al cargar la imagen: ${file.name}`);
        // Continue with next image even if this one failed
        this.processImagesSequentially(files, index + 1).then(resolve);
      };

      reader.readAsDataURL(file);
    });
  }

  async removeImage(index: number): Promise<void> {
    const imageId = this.imageIds[index];

    // If the image exists in DB, delete it via API (also removes from S3)
    if (imageId) {
      try {
        await this.productsService.deleteProductImage(imageId).toPromise();
      } catch (err: any) {
        console.error('Error deleting image:', err);
        this.toastService.error('Error al eliminar la imagen');
        return;
      }
    }

    this.imageUrls.splice(index, 1);
    this.imageIds.splice(index, 1);
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
    const returnPage = this.route.snapshot.queryParams['fromPage'] || 1;
    this.router.navigate(['/admin/products'], {
      queryParams: { page: returnPage },
    });
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

    const isServiceType = formValue.product_type === 'service';

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
      track_inventory: isServiceType ? false : !!formValue.track_inventory,
      stock_quantity: isServiceType
        ? undefined
        : formValue.track_inventory
          ? Number(formValue.stock_quantity)
          : undefined,
      category_ids: formValue.category_ids || [],
      tax_category_ids: formValue.tax_category_ids || [],
      brand_id: formValue.brand_id ? Number(formValue.brand_id) : null,
      state: formValue.state || ProductState.ACTIVE,
      pricing_type:
        typeof formValue.pricing_type === 'object'
          ? formValue.pricing_type.value
          : formValue.pricing_type || 'unit',
      product_type: formValue.product_type || 'physical',
      // Service-specific fields
      ...(isServiceType && {
        service_duration_minutes: formValue.service_duration_minutes
          ? Number(formValue.service_duration_minutes)
          : undefined,
        service_modality: formValue.service_modality || undefined,
        service_pricing_type: formValue.service_pricing_type || undefined,
        requires_booking: !!formValue.requires_booking,
        booking_mode: formValue.booking_mode || undefined,
        is_recurring: !!formValue.is_recurring,
        service_instructions: formValue.service_instructions || undefined,
      }),
      images: images.length > 0 ? images : undefined,
      weight: isServiceType
        ? undefined
        : formValue.weight > 0
          ? Number(formValue.weight)
          : undefined,
      dimensions:
        isServiceType
          ? undefined
          : formValue.dimensions &&
              (formValue.dimensions.length > 0 ||
                formValue.dimensions.width > 0 ||
                formValue.dimensions.height > 0)
            ? {
                length: Number(formValue.dimensions.length),
                width: Number(formValue.dimensions.width),
                height: Number(formValue.dimensions.height),
              }
            : undefined,
    };

    // Add Variants - ALWAYS send the array so the backend can handle the toggle
    // When hasVariants is false, send empty array to delete all existing variants
    if (this.hasVariants) {
      productData.variants = this.generatedVariants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        price_override: Number(v.price),
        cost_price: Number(v.cost_price),
        profit_margin: Number(v.profit_margin),
        is_on_sale: !!v.is_on_sale,
        sale_price: Number(v.sale_price),
        stock_quantity: formValue.track_inventory ? Number(v.stock) : undefined,
        attributes: v.attributes,
        variant_image_url: v.image_url?.startsWith('data:')
          ? v.image_url
          : undefined,
      }));

      // Set base stock_quantity to the sum of variant stocks for immediate UI consistency
      // Backend syncProductStock() handles the real sync
      if (formValue.track_inventory) {
        productData.stock_quantity = this.totalVariantStock;
      }
    } else {
      // Send empty array to tell backend to delete all existing variants
      productData.variants = [];
    }

    const request$ =
      this.isEditMode() && this.productId
        ? this.productsService.updateProduct(this.productId, productData)
        : this.productsService.createProduct(productData);

    request$.subscribe({
      next: () => {
        this.toastService.success(
          this.isEditMode()
            ? 'Producto actualizado correctamente'
            : 'Producto creado correctamente',
        );
        const returnPage = this.route.snapshot.queryParams['fromPage'] || 1;
        this.router.navigate(['/admin/products'], {
          queryParams: { page: returnPage },
        });
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

  generateAIDescription(): void {
    if (this.aiDescriptionLimitReached()) {
      this.toastService.warning(
        'Límite de generaciones alcanzado (3 por producto)',
      );
      return;
    }

    const name = this.productForm.get('name')?.value;
    if (!name?.trim()) {
      this.toastService.warning('Ingresa el nombre del producto primero');
      return;
    }

    this.isGeneratingDescription.set(true);

    const brandId = this.productForm.get('brand_id')?.value;
    const brand = brandId
      ? this.brandOptions.find((b) => b.value === brandId)?.label
      : undefined;

    const categoryIds: number[] =
      this.productForm.get('category_ids')?.value || [];
    const category =
      categoryIds.length > 0
        ? this.categoryOptions
            .filter((c) => categoryIds.includes(c.value as number))
            .map((c) => c.label)
            .join(', ')
        : undefined;

    const payload: Record<string, any> = {
      name: name.trim(),
      base_price: this.productForm.get('base_price')?.value || undefined,
      sku: this.productForm.get('sku')?.value || undefined,
      brand,
      category,
    };

    // Remove undefined values
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === '')
        delete payload[key];
    });

    this.productsService.generateDescription(payload).subscribe({
      next: (data: any) => {
        this.productForm.get('description')?.setValue(data.description);
        this.aiDescriptionUsesLeft.update((n) => n - 1);
        const left = this.aiDescriptionUsesLeft();
        this.toastService.success(
          left > 0
            ? `Descripción generada con IA (${left} uso${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''})`
            : 'Descripción generada con IA (último uso)',
        );
        this.isGeneratingDescription.set(false);
      },
      error: (err: any) => {
        console.error('AI generation error:', err);
        const message = extractApiErrorMessage(err);
        this.toastService.error(message, 'Error al generar descripción');
        this.isGeneratingDescription.set(false);
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.productForm.get(fieldName);
    if (!field || !field.errors || !field.touched) return '';
    if (field.errors['required']) return 'Campo obligatorio';
    if (field.errors['min']) return `Valor mínimo: ${field.errors['min'].min}`;
    return 'Valor inválido';
  }

  get adjustmentPreselectedProduct(): PreselectedProduct | null {
    if (!this.product) return null;
    return { id: this.product.id, name: this.product.name, sku: this.product.sku ?? null };
  }

  // Adjustment Modal
  openAdjustmentModal(): void {
    this.isAdjustmentModalOpen = true;
    if (this.adjustmentLocationOptions.length === 0) {
      this.inventoryService.getLocations().subscribe({
        next: (response) => {
          const locations = response.data || [];
          this.adjustmentLocationOptions = locations.map((l: any) => ({ value: l.id, label: l.name }));
        },
        error: () => {},
      });
    }
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

  onAdjustmentSave(dto: BatchCreateAdjustmentsRequest): void {
    this.isAdjusting = true;
    this.inventoryService.batchCreateAdjustments(dto).subscribe({
      next: () => {
        this.toastService.success('Ajustes de inventario creados como borrador');
        this.isAdjusting = false;
        this.closeAdjustmentModal();
        if (this.productId) {
          this.loadProduct(this.productId);
        }
      },
      error: (err) => {
        console.error('Error creating adjustments', err);
        this.toastService.error('Error al realizar los ajustes');
        this.isAdjusting = false;
      },
    });
  }

  onAdjustmentSaveAndComplete(dto: BatchCreateAdjustmentsRequest): void {
    this.isAdjusting = true;
    this.inventoryService.batchCreateAndComplete(dto).subscribe({
      next: () => {
        this.toastService.success('Ajustes creados y aplicados correctamente');
        this.isAdjusting = false;
        this.closeAdjustmentModal();
        if (this.productId) {
          this.loadProduct(this.productId);
        }
      },
      error: (err) => {
        console.error('Error creating adjustments', err);
        this.toastService.error('Error al realizar los ajustes');
        this.isAdjusting = false;
      },
    });
  }

  // Product states
  readonly productStateOptions = ['active', 'inactive', 'archived'] as const;
  readonly productStateButtonOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'archived', label: 'Archived' },
  ];

  // Confirmación de cambio de estado (solo en edición)
  onStateChange(newState: string): void {
    if (!this.isEditMode()) return; // En creación no requiere confirmación

    const previousState = this.productForm.get('state')?.value;
    if (previousState === newState) return;

    this.dialogService
      .confirm({
        title: 'Change Product Status',
        message: `Are you sure you want to change the product status to "${this.formatStatus(newState)}"? This action cannot be undone and may affect product visibility.`,
        confirmText: 'Change Status',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (!confirmed) {
          // Revert: el formControl ya cambió vía CVA, restaurar al valor previo
          this.productForm.get('state')?.setValue(previousState, { emitEvent: false });
          this.cdr.detectChanges();
        }
      });
  }

  /** @deprecated Use onStateChange instead */
  updateProductState(newState: string): void {
    this.productForm.get('state')?.setValue(newState);
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

  // ─── Provider Assignment (requires_booking services) ───

  loadProviders(productId: number): void {
    this.loadingProviders.set(true);
    this.reservationsService.getProvidersForService(productId).subscribe({
      next: (providers) => {
        this.assignedProviders.set(providers);
        this.loadingProviders.set(false);
      },
      error: () => {
        this.loadingProviders.set(false);
      },
    });
  }

  loadAllProviders(): void {
    this.reservationsService.getProviders().subscribe({
      next: (providers) => this.allProviders.set(providers),
      error: () => {},
    });
  }

  availableProvidersForProduct(): ServiceProvider[] {
    const assignedIds = new Set(this.assignedProviders().map((p) => p.id));
    return this.allProviders().filter((p) => !assignedIds.has(p.id));
  }

  addProviderToService(providerIdStr: string | number): void {
    const providerId = Number(providerIdStr);
    if (!providerId || !this.productId) return;
    this.reservationsService.assignServiceToProvider(providerId, this.productId).subscribe({
      next: () => {
        this.toastService.success('Proveedor asignado al servicio');
        this.loadProviders(this.productId!);
      },
      error: () => {
        this.toastService.error('Error al asignar proveedor');
      },
    });
  }

  removeProviderFromService(providerId: number): void {
    if (!this.productId) return;
    this.reservationsService.removeServiceFromProvider(providerId, this.productId).subscribe({
      next: () => {
        this.toastService.success('Proveedor removido del servicio');
        this.loadProviders(this.productId!);
      },
      error: () => {
        this.toastService.error('Error al remover proveedor');
      },
    });
  }

  getProviderInitials(provider: ServiceProvider): string {
    if (provider.display_name) {
      return provider.display_name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    }
    if (provider.employee) {
      return (
        (provider.employee.first_name?.[0] || '') +
        (provider.employee.last_name?.[0] || '')
      ).toUpperCase();
    }
    return '??';
  }

  goToScheduleConfig(): void {
    this.router.navigate(['/admin/reservations/schedules']);
  }
}
