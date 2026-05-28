import { Component, DestroyRef, computed, signal, inject } from '@angular/core';

import {
  FormBuilder,
  FormGroup,
  FormsModule,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { map, startWith } from 'rxjs';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { Store } from '@ngrx/store';
import { selectStoreSettings } from '../../../../core/store/auth/auth.selectors';
import { ShippingMethodsService } from '../settings/shipping/services/shipping-methods.service';
import { EcommerceService } from './services/ecommerce.service';
import { ProductService } from '../products/services/product.service';
import { CategoriesService } from '../products/services/categories.service';
import { BrandsService } from '../products/services/brands.service';
import {
  EcommerceSettings,
  FooterSettings,
  SettingsResponse,
  SliderImage,
  SliderPhoto,
} from './interfaces';
import type { SliderActionType } from './interfaces';
import { FooterSettingsFormComponent } from './components/footer-settings-form';
import { StoreShareModalComponent } from './components/store-share-modal';
import {
  ToastService,
  DialogService,
  IconComponent,
  ButtonComponent,
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
  SettingToggleComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../shared/components';
import { TourModalComponent } from '../../../../shared/components/tour/tour-modal/tour-modal.component';
import { TourService } from '../../../../shared/components/tour/services/tour.service';
import { ECOMMERCE_TOUR_CONFIG } from '../../../../shared/components/tour/configs/ecommerce-tour.config';
import { SelectorOption } from '../../../../shared/components/selector/selector.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import type { Currency } from '../../../../shared/pipes/currency';
import { ProductState } from '../products/interfaces';

type HomeSectionKey =
  | 'slider'
  | 'welcome'
  | 'categories'
  | 'brands'
  | 'featured_products';

interface HomeSectionAdminItem {
  key: HomeSectionKey;
  label: string;
  description: string;
  icon: string;
  defaultOrder: number;
  hasLimit: boolean;
  limitMax: number;
}

type SliderTargetField = 'product_id' | 'category_id' | 'brand_id';

const HOME_SECTION_ITEMS: HomeSectionAdminItem[] = [
  {
    key: 'slider',
    label: 'Slider principal',
    description: 'Hero visual, promociones y llamadas a la acción.',
    icon: 'image',
    defaultOrder: 10,
    hasLimit: false,
    limitMax: 1,
  },
  {
    key: 'welcome',
    label: 'Bienvenida',
    description: 'Título y párrafo independientes del slider.',
    icon: 'message-square',
    defaultOrder: 20,
    hasLimit: false,
    limitMax: 1,
  },
  {
    key: 'categories',
    label: 'Categorías',
    description: 'Accesos visuales a las familias de productos.',
    icon: 'layout-grid',
    defaultOrder: 30,
    hasLimit: true,
    limitMax: 24,
  },
  {
    key: 'brands',
    label: 'Marcas',
    description: 'Logos y accesos a marcas disponibles.',
    icon: 'tags',
    defaultOrder: 40,
    hasLimit: true,
    limitMax: 24,
  },
  {
    key: 'featured_products',
    label: 'Productos destacados',
    description: 'Colección curada con productos marcados como destacados.',
    icon: 'sparkles',
    defaultOrder: 50,
    hasLimit: true,
    limitMax: 48,
  },
];

@Component({
  selector: 'app-ecommerce',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    IconComponent,
    ButtonComponent,
    InputComponent,
    MultiSelectorComponent,
    SelectorComponent,
    SettingToggleComponent,
    StickyHeaderComponent,
    FooterSettingsFormComponent,
    StoreShareModalComponent,
    TourModalComponent,
  ],
  templateUrl: './ecommerce.component.html',
  styleUrls: ['./ecommerce.component.scss'],
})
export class EcommerceComponent {
  private fb = inject(FormBuilder);
  private ecommerceService = inject(EcommerceService);
  private productService = inject(ProductService);
  private categoriesService = inject(CategoriesService);
  private brandsService = inject(BrandsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);
  private http = inject(HttpClient);
  private store = inject(Store);
  private router = inject(Router);
  private shippingMethodsService = inject(ShippingMethodsService);
  private tourService = inject(TourService);
  private destroyRef = inject(DestroyRef);
  // Tour
  readonly showTourModal = signal(false);
  readonly ecommerceTourConfig = ECOMMERCE_TOUR_CONFIG;

  // Currencies for selector
  currencies: SelectorOption[] = [];

  // Mode detection
  isSetupMode = signal(false);
  isEditMode = signal(false);

  // Form & UI state
  settingsForm: FormGroup = this.createForm();
  readonly isLoading = signal(false);
  isSaving = signal(false);
  hasShippingMethods = signal<boolean | null>(null);

  private readonly formValueSignal = toSignal(
    this.settingsForm.valueChanges.pipe(
      startWith(this.settingsForm.getRawValue()),
    ),
    { initialValue: this.settingsForm.getRawValue() },
  );

  readonly orderedHomeSections = computed<HomeSectionAdminItem[]>(() => {
    const sections = this.formValueSignal()?.home_sections ?? {};
    return HOME_SECTION_ITEMS.map((section) => ({
      ...section,
      defaultOrder: Number(
        sections?.[section.key]?.sort_order ?? section.defaultOrder,
      ),
    })).sort((a, b) => a.defaultOrder - b.defaultOrder);
  });

  readonly primaryColor = computed(
    () => this.formValueSignal()?.inicio?.colores?.primary_color ?? '#3B82F6',
  );
  readonly secondaryColor = computed(
    () => this.formValueSignal()?.inicio?.colores?.secondary_color ?? '#10B981',
  );
  readonly accentColor = computed(
    () => this.formValueSignal()?.inicio?.colores?.accent_color ?? '#F59E0B',
  );

  // Slider images
  readonly sliderImages = signal<SliderImage[]>([]);
  readonly activeImageIndex = signal(0);
  readonly isUploadingImage = signal(false);
  readonly sliderProductOptions = signal<SelectorOption[]>([]);
  readonly sliderCategoryOptions = signal<SelectorOption[]>([]);
  readonly sliderBrandOptions = signal<SelectorOption[]>([]);
  readonly sliderActionOptions: Array<{
    value: SliderActionType;
    label: string;
  }> = [
    { value: 'none', label: 'Sin acción' },
    { value: 'internal_url', label: 'URL interna' },
    { value: 'external_url', label: 'URL externa' },
    { value: 'product', label: 'Producto' },
    { value: 'category', label: 'Categoría' },
    { value: 'brand', label: 'Marca' },
  ];
  readonly activeSliderTargetField = computed<SliderTargetField | null>(() => {
    const active = this.sliderImages()[this.activeImageIndex()];
    if (!active) return null;
    if (active.action_type === 'product') return 'product_id';
    if (active.action_type === 'category') return 'category_id';
    if (active.action_type === 'brand') return 'brand_id';
    return null;
  });
  readonly activeSliderTargetOptions = computed<SelectorOption[]>(() => {
    const field = this.activeSliderTargetField();
    if (field === 'product_id') {
      return this.sliderProductOptions();
    }
    if (field === 'category_id') {
      return this.sliderCategoryOptions();
    }
    if (field === 'brand_id') {
      return this.sliderBrandOptions();
    }
    return [];
  });
  readonly activeSliderTargetValues = computed<(string | number)[]>(() => {
    const active = this.sliderImages()[this.activeImageIndex()];
    const field = this.activeSliderTargetField();
    if (!active || !field || !active[field]) return [];
    return [active[field] as number];
  });
  readonly activeSliderTargetLabel = computed(() => {
    const field = this.activeSliderTargetField();
    if (field === 'product_id') return 'Producto destino';
    if (field === 'category_id') return 'Categoría destino';
    if (field === 'brand_id') return 'Marca destino';
    return 'Destino';
  });

  // Logo state
  readonly isUploadingLogo = signal(false);
  readonly logoPreview = signal<string | null>(null);
  logoKey: string | null = null;
  readonly isUploadingFavicon = signal(false);
  readonly faviconPreview = signal<string | null>(null);
  faviconKey: string | null = null;

  // File input reference
  fileInputRef: HTMLInputElement | null = null;
  logoInputRef: HTMLInputElement | null = null;
  faviconInputRef: HTMLInputElement | null = null;

  // Store info for auto-fill
  storeName = 'Mi Tienda';

  // Ecommerce URL for "Open Store" button
  readonly ecommerceUrl = signal<string | null>(null);
  readonly ecommerceQrCodeDataUrl = signal<string | null>(null);
  readonly ecommerceQrTargetUrl = signal<string | null>(null);
  readonly ecommerceQrGeneratedAt = signal<string | null>(null);
  readonly ecommerceQrStale = signal(false);
  readonly isGeneratingQr = signal(false);

  // Share modal state
  readonly isShareModalOpen = signal(false);

  // Footer settings (managed separately from the main form)
  readonly footerSettings = signal<FooterSettings | undefined>(undefined);

  readonly ecommerceHeaderActions = computed<StickyHeaderActionButton[]>(() => {
    this.formValueSignal();
    const actions: StickyHeaderActionButton[] = [];
    const isPristine = this.settingsForm.pristine;
    const isInvalid = this.settingsForm.invalid;
    const isSaving = this.isSaving();

    if (this.isSetupMode()) {
      actions.push({
        id: 'reset',
        label: 'Restablecer',
        variant: 'outline',
        disabled: isSaving || isPristine,
      });
    }

    const ecommerceUrl = this.ecommerceUrl();

    if (this.isEditMode() && ecommerceUrl) {
      actions.push({
        id: 'share',
        label: 'Compartir',
        variant: 'outline',
        icon: 'share-2',
        disabled: !ecommerceUrl,
      });
      actions.push({
        id: 'open',
        label: 'Abrir Tienda',
        variant: 'outline',
        icon: 'external-link',
        disabled: !ecommerceUrl,
      });
    }

    actions.push({
      id: 'save',
      label: isSaving
        ? 'Guardando...'
        : this.isSetupMode()
          ? 'Configurar Tienda'
          : 'Guardar Cambios',
      variant: 'primary',
      icon: isSaving ? undefined : 'save',
      loading: isSaving,
      disabled: isSaving || isPristine || isInvalid,
    });

    return actions;
  });

  constructor() {
    this.checkAndStartEcommerceTour();
    this.setupWhatsappPrefixEnforcement();
    this.loadSettings();
    this.loadSliderTargetOptions();
    this.currencyService.loadCurrency();
    this.loadCurrencies();
    this.checkShippingStatus();

    this.destroyRef.onDestroy(() => {});
  }

  /**
   * Create the settings form with nested structure
   */
  private createForm(): FormGroup {
    return this.fb.group({
      // App type identifier (always STORE_ECOMMERCE)
      app: ['STORE_ECOMMERCE'],

      // Sección Inicio
      inicio: this.fb.group({
        titulo: [''],
        parrafo: [''],
        logo_url: [''],
        favicon_url: [''],
        colores: this.fb.group({
          primary_color: ['#3B82F6'],
          secondary_color: ['#10B981'],
          accent_color: ['#F59E0B'],
        }),
      }),

      // Configuración General
      general: this.fb.group({
        currency: [this.currencyService.currencyCode() || 'COP'],
        locale: ['es-CO'],
        timezone: ['America/Bogota'],
      }),

      // Slider Principal
      slider: this.fb.group({
        enable: [false],
        photos: this.fb.array([]),
      }),

      // Secciones del inicio
      home_sections: this.fb.group({
        slider: this.fb.group({
          enabled: [true],
          title: ['Slider principal'],
          subtitle: ['La primera historia visual de tu tienda'],
          sort_order: [10, [Validators.min(1)]],
        }),
        welcome: this.fb.group({
          enabled: [false],
          title: [''],
          subtitle: [''],
          sort_order: [20, [Validators.min(1)]],
        }),
        categories: this.fb.group({
          enabled: [true],
          title: ['Categorías'],
          subtitle: ['Explora por tipo de producto'],
          limit: [8, [Validators.min(1), Validators.max(24)]],
          sort_order: [30, [Validators.min(1)]],
        }),
        brands: this.fb.group({
          enabled: [true],
          title: ['Marcas'],
          subtitle: ['Compra por tus marcas favoritas'],
          limit: [8, [Validators.min(1), Validators.max(24)]],
          sort_order: [40, [Validators.min(1)]],
        }),
        featured_products: this.fb.group({
          enabled: [true],
          title: ['Productos destacados'],
          subtitle: ['Selección especial de la tienda'],
          limit: [16, [Validators.min(1), Validators.max(48)]],
          sort_order: [50, [Validators.min(1)]],
        }),
      }),

      // Catálogo
      catalog: this.fb.group({
        products_per_page: [16],
        show_out_of_stock: [false],
        allow_reviews: [true],
        show_variants: [true],
        show_related_products: [false],
        enable_filters: [false],
      }),

      // Carrito
      cart: this.fb.group({
        cart_expiration_hours: [24],
        max_quantity_per_item: [10],
      }),

      // Checkout
      checkout: this.fb.group({
        whatsapp_checkout: [false],
        whatsapp_number: ['', [Validators.pattern(/^\+57[\d+#*\s()-]*$/)]],
        confirm_whatsapp_number: [
          '',
          [Validators.pattern(/^\+57[\d+#*\s()-]*$/)],
        ], // frontend-only, never sent to backend
        require_registration: [false],
      }),
    });
  }

  // --- Typed Getters for Form Controls ---
  get inicioGroup(): FormGroup {
    return this.settingsForm.get('inicio') as FormGroup;
  }
  get catalogGroup(): FormGroup {
    return this.settingsForm.get('catalog') as FormGroup;
  }
  get cartGroup(): FormGroup {
    return this.settingsForm.get('cart') as FormGroup;
  }
  get checkoutGroup(): FormGroup {
    return this.settingsForm.get('checkout') as FormGroup;
  }
  get generalGroup(): FormGroup {
    return this.settingsForm.get('general') as FormGroup;
  }

  // Inicio
  get primaryColorControl() {
    return this.inicioGroup.get('colores.primary_color') as any;
  }
  get secondaryColorControl() {
    return this.inicioGroup.get('colores.secondary_color') as any;
  }
  get accentColorControl() {
    return this.inicioGroup.get('colores.accent_color') as any;
  }

  // General
  get currencyControl() {
    return this.generalGroup.get('currency') as any;
  }
  get localeControl() {
    return this.generalGroup.get('locale') as any;
  }
  get timezoneControl() {
    return this.generalGroup.get('timezone') as any;
  }

  // Slider
  get sliderEnableControl() {
    return this.settingsForm.get('slider.enable') as any;
  }

  // Catalog
  get productsPerPageControl() {
    return this.catalogGroup.get('products_per_page') as any;
  }
  get showOutOfStockControl() {
    return this.catalogGroup.get('show_out_of_stock') as any;
  }
  get allowReviewsControl() {
    return this.catalogGroup.get('allow_reviews') as any;
  }
  get showVariantsControl() {
    return this.catalogGroup.get('show_variants') as any;
  }
  get showRelatedProductsControl() {
    return this.catalogGroup.get('show_related_products') as any;
  }
  get enableFiltersControl() {
    return this.catalogGroup.get('enable_filters') as any;
  }

  // Cart
  get cartExpirationHoursControl() {
    return this.cartGroup.get('cart_expiration_hours') as any;
  }
  get maxQuantityPerItemControl() {
    return this.cartGroup.get('max_quantity_per_item') as any;
  }

  // Checkout
  get whatsappCheckoutControl() {
    return this.checkoutGroup.get('whatsapp_checkout') as any;
  }
  get whatsappNumberControl() {
    return this.checkoutGroup.get('whatsapp_number') as any;
  }
  get confirmWhatsappNumberControl() {
    return this.checkoutGroup.get('confirm_whatsapp_number') as any;
  }
  get requireRegistrationControl() {
    return this.checkoutGroup.get('require_registration') as any;
  }

  /**
   * Enforces that WhatsApp number inputs always start with +57
   */
  private setupWhatsappPrefixEnforcement(): void {
    const controls = [
      this.whatsappNumberControl,
      this.confirmWhatsappNumberControl,
    ];

    controls.forEach((control) => {
      control.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((value: string) => {
          if (!value || value.length < 3) {
            control.setValue('+57', { emitEvent: false });
            return;
          }

          if (!value.startsWith('+57')) {
            // Keep content but ensure prefix
            let cleanValue = value.replace(/^\+?5?7?/, '');
            control.setValue('+57' + cleanValue, { emitEvent: false });
          }
        });
    });

    // Handle the toggle: when enabled, initialize with +57 if empty
    this.whatsappCheckoutControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled: boolean) => {
        if (enabled) {
          if (!this.whatsappNumberControl.value) {
            this.whatsappNumberControl.setValue('+57', { emitEvent: false });
          }
          if (!this.confirmWhatsappNumberControl.value) {
            this.confirmWhatsappNumberControl.setValue('+57', {
              emitEvent: false,
            });
          }
        }
      });
  }

  /**
   * Load settings and determine mode (setup vs edit)
   */
  private loadSettings(): void {
    this.isLoading.set(true);
    this.ecommerceService
      .getSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: SettingsResponse) => {
          if (response.exists && response.config) {
            // MODO EDICIÓN: configuración existe
            this.isEditMode.set(true);
            this.isSetupMode.set(false);
            this.settingsForm.patchValue(response.config);
            this.hydrateWelcomeSection(response.config);

            // Pre-fill confirm_whatsapp_number from saved number
            if (response.config.checkout?.whatsapp_number) {
              let num = response.config.checkout.whatsapp_number;
              if (!num.startsWith('+57'))
                num = '+57' + num.replace(/^\+?5?7?/, '');
              this.whatsappNumberControl.setValue(num, { emitEvent: false });
              this.confirmWhatsappNumberControl.setValue(num, {
                emitEvent: false,
              });
            }

            // Cargar logo si existe
            if (response.config.inicio?.logo_url) {
              this.logoPreview.set(response.config.inicio.logo_url);
              this.logoKey = response.config.inicio.logo_url;
            } else {
              this.logoPreview.set(null);
              this.logoKey = null;
            }
            const faviconUrl =
              response.config.inicio?.favicon_url ||
              response.branding?.favicon_url ||
              this.getStoreBrandingFaviconUrl();
            if (faviconUrl) {
              this.faviconPreview.set(faviconUrl);
              this.faviconKey = faviconUrl;
            } else {
              this.faviconPreview.set(null);
              this.faviconKey = null;
            }

            // Cargar imágenes del slider
            if (response.config.slider?.photos) {
              this.sliderImages.set(
                response.config.slider.photos
                  .filter((photo) => !!(photo.url || photo.key))
                  .map((photo) => ({
                    url: photo.url || undefined,
                    key: photo.key || undefined,
                    title: photo.title,
                    caption: photo.caption,
                    action_type: photo.action_type || 'none',
                    action_label: photo.action_label,
                    action_url: photo.action_url,
                    product_id: photo.product_id ?? null,
                    category_id: photo.category_id ?? null,
                    brand_id: photo.brand_id ?? null,
                    open_in_new_tab: photo.open_in_new_tab ?? true,
                  })),
              );
            } else {
              this.sliderImages.set([]);
            }

            // Cargar configuración del footer
            this.footerSettings.set(response.config.footer);

            // Obtener la URL de la Ecommerce desde la respuesta del endpoint
            this.ecommerceUrl.set(response.ecommerceUrl || null);
            this.ecommerceQrCodeDataUrl.set(response.qrCodeDataUrl || null);
            this.ecommerceQrTargetUrl.set(
              response.qrCodeUrl || response.ecommerceUrl || null,
            );
            this.ecommerceQrGeneratedAt.set(response.qrCodeGeneratedAt || null);
            this.ecommerceQrStale.set(!!response.qrCodeStale);
          } else {
            // MODO SETUP: no existe configuración
            this.isSetupMode.set(true);
            this.isEditMode.set(false);
            this.ecommerceUrl.set(null);
            this.ecommerceQrCodeDataUrl.set(null);
            this.ecommerceQrTargetUrl.set(null);
            this.ecommerceQrGeneratedAt.set(null);
            this.ecommerceQrStale.set(false);
            this.loadTemplate();
          }
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            'Error al cargar configuración: ' + error.message,
          );
          this.isLoading.set(false);
        },
      });
  }

  /**
   * Load default template (used in setup mode)
   */
  private loadTemplate(): void {
    this.isLoading.set(true);
    this.ecommerceService
      .getTemplate('basic')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (template: EcommerceSettings) => {
          this.settingsForm.patchValue(template);
          this.hydrateWelcomeSection(template);
          this.logoPreview.set(template.inicio?.logo_url || null);
          this.logoKey = template.inicio?.logo_url || null;
          const faviconUrl =
            template.inicio?.favicon_url || this.getStoreBrandingFaviconUrl();
          this.faviconPreview.set(faviconUrl);
          this.faviconKey = faviconUrl;
          this.sliderImages.set([]);
          this.activeImageIndex.set(0);
          // Cargar defaults del footer
          this.footerSettings.set(template.footer);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error('Error al cargar template: ' + error.message);
          this.isLoading.set(false);
        },
      });
  }

  private loadSliderTargetOptions(): void {
    this.productService
      .getProducts({ page: 1, limit: 100, state: ProductState.ACTIVE })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.sliderProductOptions.set(
            (response.data || []).map((product) => ({
              value: product.id,
              label: product.name,
              description: product.sku || undefined,
            })),
          );
        },
        error: () => this.sliderProductOptions.set([]),
      });

    this.categoriesService
      .getAllCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => {
          this.sliderCategoryOptions.set(
            categories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
          );
        },
        error: () => this.sliderCategoryOptions.set([]),
      });

    this.brandsService
      .getAllBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (brands) => {
          this.sliderBrandOptions.set(
            brands.map((brand) => ({
              value: brand.id,
              label: brand.name,
            })),
          );
        },
        error: () => this.sliderBrandOptions.set([]),
      });
  }

  /**
   * Load active currencies for the selector
   */
  private async loadCurrencies(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ success: boolean; data: Currency[]; message?: string }>(
          `${environment.apiUrl}/public/currencies/active`,
        ),
      );

      if (response.success && response.data) {
        this.currencies = response.data.map((c) => ({
          value: c.code,
          label: `${c.name} (${c.code})`,
        }));
      } else {
        // Fallback to common currencies if service fails
        this.currencies = [
          { value: 'COP', label: 'Peso Colombiano (COP)' },
          { value: 'USD', label: 'Dólar Americano (USD)' },
          { value: 'EUR', label: 'Euro (EUR)' },
        ];
      }
    } catch (error) {
      console.error('Error loading currencies:', error);
      // Fallback to common currencies
      this.currencies = [
        { value: 'COP', label: 'Peso Colombiano (COP)' },
        { value: 'USD', label: 'Dólar Americano (USD)' },
        { value: 'EUR', label: 'Euro (EUR)' },
      ];
    }
  }

  /**
   * Check if the store has active shipping methods configured
   */
  private checkShippingStatus(): void {
    this.shippingMethodsService
      .getShippingMethodStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => this.hasShippingMethods.set(stats.enabled_methods > 0),
        error: () => this.hasShippingMethods.set(false),
      });
  }

  navigateToShipping(): void {
    this.router.navigate(['/admin/settings/shipping']);
  }

  private async showShippingRedirectModal(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Configurar Métodos de Envío',
      message:
        'Tu tienda necesita al menos un método de envío activo para que los clientes puedan completar sus compras. Te redirigiremos a la configuración de envíos.',
      confirmText: 'Ir a Configuración de Envíos',
      cancelText: 'Configurar después',
    });
    if (confirmed) {
      this.router.navigate(['/admin/settings/shipping']);
    }
  }

  /**
   * Trigger file input for slider image upload
   */
  triggerFileInput(): void {
    if (this.isUploadingImage()) return;
    if (this.sliderImages().length >= 5) {
      this.toastService.warning('Máximo 5 imágenes permitidas');
      return;
    }

    // Create or reuse file input
    if (!this.fileInputRef) {
      this.fileInputRef = document.createElement('input');
      this.fileInputRef.type = 'file';
      this.fileInputRef.accept = 'image/*';
      this.fileInputRef.multiple = true;
      this.fileInputRef.addEventListener('change', (e) =>
        this.onSliderImageUpload(e),
      );
    }
    this.fileInputRef.click();
  }

  /**
   * Handle slider image upload
   */
  onSliderImageUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) return;

    const available_slots = 5 - this.sliderImages().length;
    if (available_slots <= 0) {
      this.toastService.warning('Máximo 5 imágenes permitidas');
      input.value = '';
      return;
    }

    // Filter valid image files and cap to available slots
    const valid_files: File[] = [];
    for (
      let i = 0;
      i < files.length && valid_files.length < available_slots;
      i++
    ) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 5 * 1024 * 1024) continue;
      valid_files.push(file);
    }

    if (valid_files.length === 0) {
      this.toastService.warning(
        'No se encontraron imágenes válidas (PNG, JPG, WebP - máx 5MB)',
      );
      input.value = '';
      return;
    }

    if (files.length > available_slots) {
      this.toastService.info(
        `Se subirán ${valid_files.length} de ${files.length} imágenes (máximo 5 en total)`,
      );
    }

    this.isUploadingImage.set(true);
    let pending_uploads = valid_files.length;

    for (const file of valid_files) {
      // Create placeholder with uploading state
      const placeholder: SliderImage = { url: '', uploading: true };
      this.sliderImages.update((arr) => [...arr, placeholder]);
      const placeholder_index = this.sliderImages().length - 1;

      this.ecommerceService
        .uploadSliderImage(file)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result) => {
            this.sliderImages.update((arr) =>
              arr.map((v, idx) =>
                idx === placeholder_index
                  ? {
                      url: result.url || result.key,
                      key: result.key,
                      thumbnail: result.thumbKey,
                      title: '',
                      caption: '',
                      action_type: 'none',
                      open_in_new_tab: true,
                    }
                  : v,
              ),
            );
            pending_uploads--;
            if (pending_uploads === 0) {
              this.isUploadingImage.set(false);
              this.updateSliderPhotosForm();
              this.toastService.success(
                valid_files.length === 1
                  ? 'Imagen subida exitosamente'
                  : `${valid_files.length} imágenes subidas exitosamente`,
              );
            }
          },
          error: (error) => {
            this.sliderImages.update((arr) =>
              arr.map((v, idx) =>
                idx === placeholder_index
                  ? (undefined as unknown as SliderImage)
                  : v,
              ),
            );
            pending_uploads--;
            if (pending_uploads === 0) {
              this.sliderImages.update((arr) => arr.filter(Boolean));
              this.isUploadingImage.set(false);
              this.updateSliderPhotosForm();
            }
            this.toastService.error('Error al subir imagen: ' + error.message);
          },
        });
    }

    input.value = '';
  }

  /**
   * Remove slider image at index
   */
  removeSliderImage(index: number): void {
    this.sliderImages.update((arr) => arr.filter((_, idx) => idx !== index));
    const length = this.sliderImages().length;
    if (this.activeImageIndex() >= length) {
      this.activeImageIndex.set(Math.max(0, length - 1));
    }
    this.updateSliderPhotosForm();
  }

  /**
   * Update image metadata (title or caption)
   */
  updateImageMetadata(
    index: number,
    field: 'title' | 'caption' | 'action_label' | 'action_url',
    value: string,
  ): void {
    const current = this.sliderImages();
    if (current[index]) {
      this.sliderImages.update((arr) =>
        arr.map((v, idx) => (idx === index ? { ...v, [field]: value } : v)),
      );
      this.updateSliderPhotosForm();
    }
  }

  /**
   * Handle input event for image title
   */
  onTitleInputChange(event: Event | string): void {
    const value =
      typeof event === 'string'
        ? event
        : (event.target as HTMLInputElement).value;
    this.updateImageMetadata(this.activeImageIndex(), 'title', value);
  }

  /**
   * Handle input event for image caption
   */
  onCaptionInputChange(event: Event | string): void {
    const value =
      typeof event === 'string'
        ? event
        : (event.target as HTMLInputElement).value;
    this.updateImageMetadata(this.activeImageIndex(), 'caption', value);
  }

  updateImageAction(
    index: number,
    field: 'action_type' | 'open_in_new_tab',
    value: SliderActionType | boolean,
  ): void {
    const current = this.sliderImages();
    if (!current[index]) return;

    this.sliderImages.update((arr) =>
      arr.map((v, idx) =>
        idx === index
          ? {
              ...v,
              [field]: value,
              ...(field === 'action_type' && value === 'none'
                ? {
                    action_label: '',
                    action_url: '',
                    product_id: null,
                    category_id: null,
                    brand_id: null,
                  }
                : {}),
            }
          : v,
      ),
    );
    this.updateSliderPhotosForm();
  }

  onSliderActionTypeChange(value: string | number | null): void {
    this.updateImageAction(
      this.activeImageIndex(),
      'action_type',
      (value || 'none') as SliderActionType,
    );
  }

  onSliderTargetChange(values: (string | number)[]): void {
    const field = this.activeSliderTargetField();
    if (!field) return;
    const selectedValue = values.length > 0 ? values[values.length - 1] : null;

    this.updateImageTargetId(
      this.activeImageIndex(),
      field,
      selectedValue === null ? '' : selectedValue.toString(),
    );
  }

  updateImageTargetId(
    index: number,
    field: 'product_id' | 'category_id' | 'brand_id',
    value: string,
  ): void {
    const current = this.sliderImages();
    if (!current[index]) return;

    const numericValue = value.trim() ? Number(value) : null;
    this.sliderImages.update((arr) =>
      arr.map((v, idx) =>
        idx === index ? { ...v, [field]: numericValue || null } : v,
      ),
    );
    this.updateSliderPhotosForm();
  }

  /**
   * Set the active image for preview
   */
  setActiveImage(index: number): void {
    this.activeImageIndex.set(index);
  }

  moveHomeSection(key: HomeSectionKey, direction: -1 | 1): void {
    const sections = this.orderedHomeSections();
    const currentIndex = sections.findIndex((section) => section.key === key);
    const target = sections[currentIndex + direction];

    if (currentIndex < 0 || !target) return;

    const currentGroup = this.getHomeSectionGroup(key);
    const targetGroup = this.getHomeSectionGroup(target.key);
    const currentOrder = Number(
      currentGroup.get('sort_order')?.value ?? sections[currentIndex].defaultOrder,
    );
    const targetOrder = Number(
      targetGroup.get('sort_order')?.value ?? target.defaultOrder,
    );

    currentGroup.patchValue({ sort_order: targetOrder });
    targetGroup.patchValue({ sort_order: currentOrder });
    this.settingsForm.markAsDirty();
  }

  private getHomeSectionGroup(key: HomeSectionKey): FormGroup {
    return this.settingsForm.get(['home_sections', key]) as FormGroup;
  }

  private getStoreBrandingFaviconUrl(): string | null {
    const storeSettings: any = this.store.selectSignal(selectStoreSettings)();
    return (
      storeSettings?.branding?.favicon_url ||
      storeSettings?.app?.favicon_url ||
      null
    );
  }

  /**
   * Trigger file input for logo upload
   */
  triggerLogoInput(): void {
    if (this.isUploadingLogo()) return;

    if (!this.logoInputRef) {
      this.logoInputRef = document.createElement('input');
      this.logoInputRef.type = 'file';
      this.logoInputRef.accept = 'image/*';
      this.logoInputRef.addEventListener('change', (e) => this.onLogoUpload(e));
    }
    this.logoInputRef.click();
  }

  /**
   * Handle logo upload
   */
  onLogoUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.type.startsWith('image/')) {
      this.toastService.warning('Solo se permiten archivos de imagen');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.toastService.warning('El logo excede el tamaño máximo de 2MB');
      return;
    }

    this.isUploadingLogo.set(true);

    this.ecommerceService
      .uploadSliderImage(file) // Reutilizamos el mismo servicio de subida
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.logoPreview.set(result.url || result.key);
          this.logoKey = result.key;

          const inicioGroup = this.settingsForm.get('inicio') as FormGroup;
          if (inicioGroup) {
            inicioGroup.patchValue({ logo_url: result.key });
            this.settingsForm.markAsDirty();
          }

          this.isUploadingLogo.set(false);
          this.toastService.success('Logo subido exitosamente');
        },
        error: (error) => {
          this.isUploadingLogo.set(false);
          this.toastService.error('Error al subir el logo: ' + error.message);
        },
      });

    input.value = '';
  }

  /**
   * Remove logo
   */
  removeLogo(): void {
    this.logoPreview.set(null);
    this.logoKey = null;
    const inicioGroup = this.settingsForm.get('inicio') as FormGroup;
    if (inicioGroup) {
      inicioGroup.patchValue({ logo_url: '' });
      this.settingsForm.markAsDirty();
    }
  }

  triggerFaviconInput(): void {
    if (this.isUploadingFavicon()) return;

    if (!this.faviconInputRef) {
      this.faviconInputRef = document.createElement('input');
      this.faviconInputRef.type = 'file';
      this.faviconInputRef.accept = 'image/*';
      this.faviconInputRef.addEventListener('change', (e) =>
        this.onFaviconUpload(e),
      );
    }
    this.faviconInputRef.click();
  }

  onFaviconUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.type.startsWith('image/')) {
      this.toastService.warning('Solo se permiten archivos de imagen');
      return;
    }

    if (file.size > 1 * 1024 * 1024) {
      this.toastService.warning('El favicon excede el tamaño máximo de 1MB');
      return;
    }

    this.isUploadingFavicon.set(true);

    this.ecommerceService
      .uploadSliderImage(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.faviconPreview.set(result.url || result.key);
          this.faviconKey = result.key;

          const inicioGroup = this.settingsForm.get('inicio') as FormGroup;
          if (inicioGroup) {
            inicioGroup.patchValue({ favicon_url: result.key });
            this.settingsForm.markAsDirty();
          }

          this.isUploadingFavicon.set(false);
          this.toastService.success('Favicon subido exitosamente');
        },
        error: (error) => {
          this.isUploadingFavicon.set(false);
          this.toastService.error(
            'Error al subir el favicon: ' + error.message,
          );
        },
      });

    input.value = '';
  }

  removeFavicon(): void {
    this.faviconPreview.set(null);
    this.faviconKey = null;
    const inicioGroup = this.settingsForm.get('inicio') as FormGroup;
    if (inicioGroup) {
      inicioGroup.patchValue({ favicon_url: '' });
      this.settingsForm.markAsDirty();
    }
  }

  /**
   * Update the form's slider photos array from sliderImages
   */
  private updateSliderPhotosForm(): void {
    const photos: SliderPhoto[] = this.sliderImages().map((img) => ({
      url: img.url || null,
      key: img.key || null,
      title: img.title || '',
      caption: img.caption || '',
      action_type: img.action_type || 'none',
      action_label: img.action_label || '',
      action_url: img.action_url || '',
      product_id: img.product_id ?? null,
      category_id: img.category_id ?? null,
      brand_id: img.brand_id ?? null,
      open_in_new_tab: img.open_in_new_tab ?? true,
    }));

    // Asegurarnos de que el formulario tenga los datos actualizados
    const sliderGroup = this.settingsForm.get('slider') as FormGroup;
    if (sliderGroup) {
      // Sincronizar el valor del slider en el formulario
      sliderGroup.patchValue({ photos }, { emitEvent: true });
      this.settingsForm.markAsDirty();
    }
  }

  /**
   * Validate WhatsApp checkout configuration before saving.
   * If toggle is on but numbers are empty or don't match, shows a warning and deactivates the toggle.
   */
  private async validateWhatsappCheckout(): Promise<boolean> {
    const isEnabled = this.whatsappCheckoutControl.value;
    if (!isEnabled) return true;

    const number = (this.whatsappNumberControl.value || '').trim();
    const confirm = (this.confirmWhatsappNumberControl.value || '').trim();

    if (!number || !confirm || number !== confirm) {
      await this.dialogService.confirm({
        title: 'WhatsApp Checkout',
        message:
          !number || !confirm
            ? 'Debes ingresar y confirmar tu numero de WhatsApp para activar esta opcion.'
            : 'Los numeros de WhatsApp no coinciden. Verifica e intenta de nuevo.',
        confirmText: 'Entendido',
        cancelText: 'Cerrar',
      });
      this.whatsappCheckoutControl.setValue(false);
      this.whatsappNumberControl.setValue('');
      this.confirmWhatsappNumberControl.setValue('');
      return false;
    }

    return true;
  }

  /**
   * Submit the form
   */
  async onSubmit(): Promise<void> {
    if (this.settingsForm.invalid) {
      this.toastService.warning('Por favor verifica los datos del formulario');
      return;
    }

    // Validate WhatsApp checkout before proceeding
    const whatsappValid = await this.validateWhatsappCheckout();
    if (!whatsappValid) return;

    this.syncInicioFromWelcomeSection();

    this.isSaving.set(true);

    // Preparar el objeto de configuración (strip confirm_whatsapp_number — frontend-only)
    const { confirm_whatsapp_number, ...checkoutPayload } =
      this.settingsForm.value.checkout;
    const settings: EcommerceSettings = {
      ...this.settingsForm.value,
      checkout: checkoutPayload,
      inicio: {
        ...this.settingsForm.value.inicio,
        logo_url: this.logoKey || this.settingsForm.value.inicio.logo_url,
        favicon_url:
          this.faviconKey || this.settingsForm.value.inicio.favicon_url,
      },
      slider: {
        ...this.settingsForm.value.slider,
        photos: this.sliderImages().map((img) => ({
          url: img.key || img.url || null, // Preferir la KEY para persistencia
          key: img.key || null,
          title: img.title || '',
          caption: img.caption || '',
          action_type: img.action_type || 'none',
          action_label: img.action_label || '',
          action_url: img.action_url || '',
          product_id: img.product_id ?? null,
          category_id: img.category_id ?? null,
          brand_id: img.brand_id ?? null,
          open_in_new_tab: img.open_in_new_tab ?? true,
        })),
      },
      footer: this.footerSettings(),
    };

    this.ecommerceService
      .updateSettings(settings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (savedSettings) => {
          const message = this.isSetupMode()
            ? 'Tienda e-commerce configurada exitosamente'
            : 'Configuración actualizada exitosamente';

          this.toastService.success(message);
          this.settingsForm.markAsPristine();

          // If we were in setup mode, transition to edit mode
          if (this.isSetupMode()) {
            this.isSetupMode.set(false);
            this.isEditMode.set(true);

            // Reload to get the saved configuration
            this.loadSettings();
          }

          this.isSaving.set(false);

          // Si no hay métodos de envío, mostrar modal de redirección
          if (this.hasShippingMethods() === false) {
            this.showShippingRedirectModal();
          }
        },
        error: (error) => {
          this.toastService.error('Error al guardar: ' + error.message);
          this.isSaving.set(false);
        },
      });
  }

  /**
   * Reset the form
   */
  onReset(): void {
    if (this.isSetupMode()) {
      this.loadTemplate();
    } else {
      this.loadSettings();
    }
    this.settingsForm.markAsPristine();
  }

  /**
   * Open the Ecommerce store in a new tab
   */
  openEcommerceStore(): void {
    const ecommerceUrl = this.ecommerceUrl();
    if (ecommerceUrl) {
      window.open(ecommerceUrl, '_blank', 'noopener,noreferrer');
    } else {
      this.toastService.warning('No se pudo obtener la URL de la tienda');
    }
  }

  generateEcommerceQr(): void {
    if (!this.ecommerceUrl() && !this.isEditMode()) {
      this.toastService.warning(
        'Guarda la configuración antes de generar el QR',
      );
      return;
    }

    this.isGeneratingQr.set(true);
    this.ecommerceService
      .generateQrCode()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (qr) => {
          this.ecommerceUrl.set(qr.ecommerceUrl);
          this.ecommerceQrTargetUrl.set(qr.qrCodeUrl);
          this.ecommerceQrCodeDataUrl.set(qr.qrCodeDataUrl);
          this.ecommerceQrGeneratedAt.set(qr.qrCodeGeneratedAt);
          this.ecommerceQrStale.set(false);
          this.isGeneratingQr.set(false);
          this.toastService.success('QR generado exitosamente');
        },
        error: (error) => {
          this.isGeneratingQr.set(false);
          this.toastService.error('Error al generar QR: ' + error.message);
        },
      });
  }

  downloadEcommerceQr(): void {
    const qr = this.ecommerceQrCodeDataUrl();
    if (!qr || typeof document === 'undefined') return;

    const link = document.createElement('a');
    link.href = qr;
    link.download = 'qr-tienda-online.png';
    link.click();
  }

  copyEcommerceQrLink(): void {
    const url = this.ecommerceQrTargetUrl() || this.ecommerceUrl();
    if (!url) return;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => this.toastService.success('Link copiado'))
        .catch(() => this.copyEcommerceQrLinkFallback(url));
      return;
    }

    this.copyEcommerceQrLinkFallback(url);
  }

  openEcommerceQrLink(): void {
    const url = this.ecommerceQrTargetUrl() || this.ecommerceUrl();
    if (!url || typeof window === 'undefined') return;

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private copyEcommerceQrLinkFallback(url: string): void {
    if (typeof document === 'undefined') {
      this.toastService.error('No se pudo copiar el link');
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const copied = document.execCommand('copy');
      if (copied) {
        this.toastService.success('Link copiado');
      } else {
        this.toastService.error('No se pudo copiar el link');
      }
    } finally {
      document.body.removeChild(textarea);
    }
  }

  formatQrGeneratedAt(): string {
    const generatedAt = this.ecommerceQrGeneratedAt();
    if (!generatedAt) return '';

    return new Date(generatedAt).toLocaleString('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'reset') this.onReset();
    else if (actionId === 'share') this.isShareModalOpen.set(true);
    else if (actionId === 'open') this.openEcommerceStore();
    else if (actionId === 'save') this.onSubmit();
  }

  /**
   * Handle footer settings changes from FooterSettingsFormComponent
   */
  onFooterChange(footer: FooterSettings): void {
    this.footerSettings.set(footer);
    this.settingsForm.markAsDirty();
  }

  private hydrateWelcomeSection(config?: EcommerceSettings): void {
    const welcome = config?.home_sections?.welcome;
    if (welcome) return;

    const title = config?.inicio?.titulo?.trim() || '';
    const subtitle = config?.inicio?.parrafo?.trim() || '';
    if (!title && !subtitle) return;

    this.getHomeSectionGroup('welcome').patchValue(
      {
        enabled: true,
        title,
        subtitle,
      },
      { emitEvent: false },
    );
  }

  private syncInicioFromWelcomeSection(): void {
    const inicio = this.settingsForm.get('inicio');
    const welcome = this.getHomeSectionGroup('welcome');
    if (!inicio || !welcome) return;

    inicio.patchValue(
      {
        titulo: welcome.get('title')?.value || '',
        parrafo: welcome.get('subtitle')?.value || '',
      },
      { emitEvent: false },
    );
  }

  /**
   * Sync color picker native input with FormControl
   */
  onColorPickerChange(controlName: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const coloresGroup = this.settingsForm.get('inicio.colores') as FormGroup;
    coloresGroup.get(controlName)?.setValue(value);
    this.settingsForm.markAsDirty();
  }

  /**
   * Sincronizar colores desde el branding de la tienda (source of truth)
   */
  syncColorsFromBranding(): void {
    const storeSettings: any = this.store.selectSignal(selectStoreSettings)();
    const branding = storeSettings?.branding;

    if (!branding) {
      this.toastService.warning('No se encontró configuración de branding');
      return;
    }

    const coloresGroup = this.settingsForm.get('inicio.colores') as FormGroup;
    if (coloresGroup) {
      coloresGroup.patchValue({
        primary_color: branding.primary_color || '#3B82F6',
        secondary_color: branding.secondary_color || '#10B981',
        accent_color: branding.accent_color || '#F59E0B',
      });
      this.settingsForm.markAsDirty();
      this.toastService.success(
        'Colores sincronizados desde el branding de la tienda',
      );
    }
  }

  /**
   * Check and start ecommerce tour for first-time users
   */
  private checkAndStartEcommerceTour(): void {
    const tourId = 'ecommerce-config-first-visit';
    if (this.tourService.canShowTour(tourId)) {
      setTimeout(() => {
        this.showTourModal.set(true);
      }, 1500);
    }
  }
}
