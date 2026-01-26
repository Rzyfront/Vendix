import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { EcommerceService } from './services/ecommerce.service';
import {
  EcommerceSettings,
  SettingsResponse,
  SliderImage,
  SliderPhoto,
} from './interfaces';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectorComponent } from '../../../../shared/components/selector/selector.component';
import { SettingToggleComponent } from '../../../../shared/components/setting-toggle/setting-toggle.component';

@Component({
  selector: 'app-ecommerce',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IconComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
  ],
  templateUrl: './ecommerce.component.html',
  styleUrls: ['./ecommerce.component.scss'],
})
export class EcommerceComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Mode detection
  isSetupMode = false;
  isEditMode = false;

  // Form & UI state
  settingsForm: FormGroup;
  isLoading = false;
  isSaving = false;

  // Slider images
  sliderImages: SliderImage[] = [];
  activeImageIndex = 0;
  isUploadingImage = false;

  // Logo state
  isUploadingLogo = false;
  logoPreview: string | null = null;
  logoKey: string | null = null;

  // File input reference
  fileInputRef: HTMLInputElement | null = null;
  logoInputRef: HTMLInputElement | null = null;

  // Store info for auto-fill
  storeName = 'Mi Tienda';

  // Ecommerce URL for "Open Store" button
  ecommerceUrl: string | null = null;

  constructor(
    private fb: FormBuilder,
    private ecommerceService: EcommerceService,
    private toastService: ToastService,
  ) {
    this.settingsForm = this.createForm();
  }

  ngOnInit(): void {
    this.loadSettings();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
        colores: this.fb.group({
          primary_color: ['#3B82F6'],
          secondary_color: ['#10B981'],
          accent_color: ['#F59E0B'],
        }),
      }),

      // Configuración General
      general: this.fb.group({
        currency: ['COP'],
        locale: ['es-CO'],
        timezone: ['America/Bogota'],
      }),

      // Slider Principal
      slider: this.fb.group({
        enable: [false],
        photos: this.fb.array([]),
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
        require_registration: [false],
      }),
    });
  }

  // --- Typed Getters for Form Controls ---
  get inicioGroup(): FormGroup { return this.settingsForm.get('inicio') as FormGroup; }
  get catalogGroup(): FormGroup { return this.settingsForm.get('catalog') as FormGroup; }
  get cartGroup(): FormGroup { return this.settingsForm.get('cart') as FormGroup; }
  get checkoutGroup(): FormGroup { return this.settingsForm.get('checkout') as FormGroup; }
  get generalGroup(): FormGroup { return this.settingsForm.get('general') as FormGroup; }

  // Inicio
  get tituloControl() { return this.inicioGroup.get('titulo') as any; }
  get parrafoControl() { return this.inicioGroup.get('parrafo') as any; }
  get primaryColorControl() { return this.inicioGroup.get('colores.primary_color') as any; }
  get secondaryColorControl() { return this.inicioGroup.get('colores.secondary_color') as any; }
  get accentColorControl() { return this.inicioGroup.get('colores.accent_color') as any; }

  // General
  get currencyControl() { return this.generalGroup.get('currency') as any; }
  get localeControl() { return this.generalGroup.get('locale') as any; }
  get timezoneControl() { return this.generalGroup.get('timezone') as any; }

  // Slider
  get sliderEnableControl() { return this.settingsForm.get('slider.enable') as any; }

  // Catalog
  get productsPerPageControl() { return this.catalogGroup.get('products_per_page') as any; }
  get showOutOfStockControl() { return this.catalogGroup.get('show_out_of_stock') as any; }
  get allowReviewsControl() { return this.catalogGroup.get('allow_reviews') as any; }
  get showVariantsControl() { return this.catalogGroup.get('show_variants') as any; }
  get showRelatedProductsControl() { return this.catalogGroup.get('show_related_products') as any; }
  get enableFiltersControl() { return this.catalogGroup.get('enable_filters') as any; }

  // Cart
  get cartExpirationHoursControl() { return this.cartGroup.get('cart_expiration_hours') as any; }
  get maxQuantityPerItemControl() { return this.cartGroup.get('max_quantity_per_item') as any; }

  // Checkout
  get whatsappCheckoutControl() { return this.checkoutGroup.get('whatsapp_checkout') as any; }
  get requireRegistrationControl() { return this.checkoutGroup.get('require_registration') as any; }

  /**
   * Load settings and determine mode (setup vs edit)
   */
  private loadSettings(): void {
    this.isLoading = true;
    this.ecommerceService
      .getSettings()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: SettingsResponse) => {
          if (response.exists && response.config) {
            // MODO EDICIÓN: configuración existe
            this.isEditMode = true;
            this.isSetupMode = false;
            this.settingsForm.patchValue(response.config);

            // Cargar logo si existe
            if (response.config.inicio?.logo_url) {
              this.logoPreview = response.config.inicio.logo_url;
              this.logoKey = response.config.inicio.logo_url;
            }

            // Cargar imágenes del slider
            if (response.config.slider?.photos) {
              this.sliderImages = response.config.slider.photos
                .filter((photo) => photo.url !== null || photo.key !== null)
                .map((photo) => ({
                  url: photo.url || undefined,
                  key: photo.key || undefined,
                  title: photo.title,
                  caption: photo.caption,
                }));
            }

            // Obtener la URL de la Ecommerce desde la respuesta del endpoint
            this.ecommerceUrl = response.ecommerceUrl || null;
          } else {
            // MODO SETUP: no existe configuración
            this.isSetupMode = true;
            this.isEditMode = false;
            this.ecommerceUrl = null;
            this.loadTemplate();
          }
          this.isLoading = false;
        },
        error: (error) => {
          this.toastService.error(
            'Error al cargar configuración: ' + error.message,
          );
          this.isLoading = false;
        },
      });
  }

  /**
   * Load default template (used in setup mode)
   */
  private loadTemplate(): void {
    this.isLoading = true;
    this.ecommerceService
      .getTemplate('basic')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (template: EcommerceSettings) => {
          this.settingsForm.patchValue(template);
          this.sliderImages = [];
          this.activeImageIndex = 0;
          this.isLoading = false;
        },
        error: (error) => {
          this.toastService.error('Error al cargar template: ' + error.message);
          this.isLoading = false;
        },
      });
  }

  /**
   * Trigger file input for slider image upload
   */
  triggerFileInput(): void {
    if (this.isUploadingImage) return;
    if (this.sliderImages.length >= 5) {
      this.toastService.warning('Máximo 5 imágenes permitidas');
      return;
    }

    // Create or reuse file input
    if (!this.fileInputRef) {
      this.fileInputRef = document.createElement('input');
      this.fileInputRef.type = 'file';
      this.fileInputRef.accept = 'image/*';
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
    if (this.sliderImages.length >= 5) {
      this.toastService.warning('Máximo 5 imágenes permitidas');
      input.value = '';
      return;
    }

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      this.toastService.warning('Solo se permiten archivos de imagen');
      input.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.toastService.warning('El archivo excede el tamaño máximo de 5MB');
      input.value = '';
      return;
    }

    // Create placeholder with uploading state
    const placeholder: SliderImage = { url: '', uploading: true };
    this.sliderImages.push(placeholder);
    this.isUploadingImage = true;

    // Upload
    this.ecommerceService
      .uploadSliderImage(file)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          const index = this.sliderImages.findIndex((img) => img.uploading);
          if (index !== -1) {
            this.sliderImages[index] = {
              url: result.url || result.key, // Usar la URL firmada para previsualización
              key: result.key, // Guardar la KEY para persistencia
              thumbnail: result.thumbKey,
              title: '',
              caption: '',
            };
          }
          this.isUploadingImage = false;
          this.updateSliderPhotosForm();
          this.toastService.success('Imagen subida exitosamente');
        },
        error: (error) => {
          this.sliderImages = this.sliderImages.filter((img) => !img.uploading);
          this.isUploadingImage = false;
          this.toastService.error('Error al subir imagen: ' + error.message);
        },
      });

    input.value = '';
  }

  /**
   * Remove slider image at index
   */
  removeSliderImage(index: number): void {
    this.sliderImages.splice(index, 1);
    if (this.activeImageIndex >= this.sliderImages.length) {
      this.activeImageIndex = Math.max(0, this.sliderImages.length - 1);
    }
    this.updateSliderPhotosForm();
  }

  /**
   * Update image metadata (title or caption)
   */
  updateImageMetadata(
    index: number,
    field: 'title' | 'caption',
    value: string,
  ): void {
    if (this.sliderImages[index]) {
      this.sliderImages[index][field] = value;
      this.updateSliderPhotosForm();
    }
  }

  /**
   * Handle input event for image title
   */
  onTitleInputChange(event: Event | string): void {
    const value = typeof event === 'string' ? event : (event.target as HTMLInputElement).value;
    this.updateImageMetadata(this.activeImageIndex, 'title', value);
  }

  /**
   * Handle input event for image caption
   */
  onCaptionInputChange(event: Event | string): void {
    const value = typeof event === 'string' ? event : (event.target as HTMLInputElement).value;
    this.updateImageMetadata(this.activeImageIndex, 'caption', value);
  }

  /**
   * Set the active image for preview
   */
  setActiveImage(index: number): void {
    this.activeImageIndex = index;
  }

  /**
   * Trigger file input for logo upload
   */
  triggerLogoInput(): void {
    if (this.isUploadingLogo) return;

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

    this.isUploadingLogo = true;

    this.ecommerceService
      .uploadSliderImage(file) // Reutilizamos el mismo servicio de subida
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.logoPreview = result.url || result.key;
          this.logoKey = result.key;

          const inicioGroup = this.settingsForm.get('inicio') as FormGroup;
          if (inicioGroup) {
            inicioGroup.patchValue({ logo_url: result.key });
            this.settingsForm.markAsDirty();
          }

          this.isUploadingLogo = false;
          this.toastService.success('Logo subido exitosamente');
        },
        error: (error) => {
          this.isUploadingLogo = false;
          this.toastService.error('Error al subir el logo: ' + error.message);
        },
      });

    input.value = '';
  }

  /**
   * Remove logo
   */
  removeLogo(): void {
    this.logoPreview = null;
    this.logoKey = null;
    const inicioGroup = this.settingsForm.get('inicio') as FormGroup;
    if (inicioGroup) {
      inicioGroup.patchValue({ logo_url: '' });
      this.settingsForm.markAsDirty();
    }
  }

  /**
   * Update the form's slider photos array from sliderImages
   */
  private updateSliderPhotosForm(): void {
    const photos: SliderPhoto[] = this.sliderImages.map((img) => ({
      url: img.url || null,
      key: img.key || null,
      title: img.title || '',
      caption: img.caption || '',
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
   * Submit the form
   */
  onSubmit(): void {
    if (this.settingsForm.invalid) {
      this.toastService.warning('Por favor verifica los datos del formulario');
      return;
    }

    // Apply auto-fill before submitting
    this.applyAutoFill();

    this.isSaving = true;

    // Preparar el objeto de configuración
    const settings: EcommerceSettings = {
      ...this.settingsForm.value,
      inicio: {
        ...this.settingsForm.value.inicio,
        logo_url: this.logoKey || this.settingsForm.value.inicio.logo_url,
      },
      slider: {
        ...this.settingsForm.value.slider,
        photos: this.sliderImages.map((img) => ({
          url: img.key || img.url || null, // Preferir la KEY para persistencia
          key: img.key || null,
          title: img.title || '',
          caption: img.caption || '',
        })),
      },
    };

    this.ecommerceService
      .updateSettings(settings)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (savedSettings) => {
          const message = this.isSetupMode
            ? 'Tienda e-commerce configurada exitosamente'
            : 'Configuración actualizada exitosamente';

          this.toastService.success(message);
          this.settingsForm.markAsPristine();

          // If we were in setup mode, transition to edit mode
          if (this.isSetupMode) {
            this.isSetupMode = false;
            this.isEditMode = true;

            // Reload to get the saved configuration
            this.loadSettings();
          }

          this.isSaving = false;
        },
        error: (error) => {
          this.toastService.error('Error al guardar: ' + error.message);
          this.isSaving = false;
        },
      });
  }

  /**
   * Reset the form
   */
  onReset(): void {
    if (this.isSetupMode) {
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
    if (this.ecommerceUrl) {
      window.open(this.ecommerceUrl, '_blank', 'noopener,noreferrer');
    } else {
      this.toastService.warning('No se pudo obtener la URL de la tienda');
    }
  }

  /**
   * Apply auto-fill defaults to inicio section
   */
  private applyAutoFill(): void {
    const inicio = this.settingsForm.get('inicio');
    if (!inicio) return;

    const titulo = inicio.get('titulo')?.value;
    const parrafo = inicio.get('parrafo')?.value;

    // Auto-fill título if empty
    if (!titulo || titulo.trim() === '') {
      inicio.patchValue({
        titulo: `Bienvenido a ${this.storeName}`,
      });
    }

    // Auto-fill párrafo if empty
    if (!parrafo || parrafo.trim() === '') {
      inicio.patchValue({
        parrafo:
          'Encuentra aquí todo lo que buscas y si no lo encuentras pregúntanos...',
      });
    }
  }
  /**
   * Sincronizar colores desde el tema actual
   */
  syncColorsFromTheme(): void {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);

    const primaryColor = this.rgbToHex(
      computedStyle.getPropertyValue('--color-primary').trim(),
    );
    const secondaryColor = this.rgbToHex(
      computedStyle.getPropertyValue('--color-secondary').trim(),
    );
    const accentColor = this.rgbToHex(
      computedStyle.getPropertyValue('--color-accent').trim(),
    );

    const coloresGroup = this.settingsForm.get('inicio.colores') as FormGroup;
    if (coloresGroup) {
      coloresGroup.patchValue({
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        accent_color: accentColor,
      });
      this.settingsForm.markAsDirty();
      this.toastService.success(
        'Colores sincronizados con la aplicación actual',
      );
    }
  }

  /**
   * Convert RGB/RGBA to Hex
   */
  private rgbToHex(rgb: string): string {
    // Si ya es hex, retornar
    if (rgb.startsWith('#')) return rgb;

    // Extraer números
    const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/);
    if (!match) return rgb;

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    return (
      '#' +
      [r, g, b]
        .map((x) => {
          const hex = x.toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('')
    ).toUpperCase();
  }
}
