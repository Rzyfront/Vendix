import { Component, DestroyRef, computed, signal, inject } from '@angular/core';

import {
  FormBuilder,
  FormGroup,
  FormsModule,
  Validators,
  ReactiveFormsModule } from '@angular/forms';
import { map, startWith } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { Store } from '@ngrx/store';
import { selectStoreSettings } from '../../../../core/store/auth/auth.selectors';
import { ShippingMethodsService } from '../settings/shipping/services/shipping-methods.service';
import { EcommerceService } from './services/ecommerce.service';
import {
  EcommerceSettings,
  FooterSettings,
  SettingsResponse,
  SliderImage,
  SliderPhoto } from './interfaces';
import { FooterSettingsFormComponent } from './components/footer-settings-form';
import { StoreShareModalComponent } from './components/store-share-modal';
import {
  ToastService,
  DialogService,
  IconComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SettingToggleComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton } from '../../../../shared/components';
import { TourModalComponent } from '../../../../shared/components/tour/tour-modal/tour-modal.component';
import { TourService } from '../../../../shared/components/tour/services/tour.service';
import { ECOMMERCE_TOUR_CONFIG } from '../../../../shared/components/tour/configs/ecommerce-tour.config';
import { SelectorOption } from '../../../../shared/components/selector/selector.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import type { Currency } from '../../../../shared/pipes/currency';

@Component({
  selector: 'app-ecommerce',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    IconComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
    StickyHeaderComponent,
    FooterSettingsFormComponent,
    StoreShareModalComponent,
    TourModalComponent
],
  templateUrl: './ecommerce.component.html',
  styleUrls: ['./ecommerce.component.scss'] })
export class EcommerceComponent {
  private fb = inject(FormBuilder);
  private ecommerceService = inject(EcommerceService);
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
    this.settingsForm.valueChanges.pipe(startWith(this.settingsForm.getRawValue())),
    { initialValue: this.settingsForm.getRawValue() }
  );

  readonly primaryColor = computed(() => this.formValueSignal()?.inicio?.colores?.primary_color ?? '#3B82F6');
  readonly secondaryColor = computed(() => this.formValueSignal()?.inicio?.colores?.secondary_color ?? '#10B981');
  readonly accentColor = computed(() => this.formValueSignal()?.inicio?.colores?.accent_color ?? '#F59E0B');

  // Slider images
  readonly sliderImages = signal<SliderImage[]>([]);
  readonly activeImageIndex = signal(0);
  readonly isUploadingImage = signal(false);

  // Logo state
  readonly isUploadingLogo = signal(false);
  readonly logoPreview = signal<string | null>(null);
  logoKey: string | null = null;

  // File input reference
  fileInputRef: HTMLInputElement | null = null;
  logoInputRef: HTMLInputElement | null = null;

  // Store info for auto-fill
  storeName = 'Mi Tienda';

  // Ecommerce URL for "Open Store" button
  ecommerceUrl: string | null = null;

  // Share modal state
  readonly isShareModalOpen = signal(false);

  // Footer settings (managed separately from the main form)
  footerSettings: FooterSettings | undefined;

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
        disabled: isSaving || isPristine });
    }

    if (this.isEditMode() && this.ecommerceUrl) {
      actions.push({
        id: 'share',
        label: 'Compartir',
        variant: 'outline',
        icon: 'share-2',
        disabled: !this.ecommerceUrl });
      actions.push({
        id: 'open',
        label: 'Abrir Tienda',
        variant: 'outline',
        icon: 'external-link',
        disabled: !this.ecommerceUrl });
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
      disabled: isSaving || isPristine || isInvalid });

    return actions;
  });

  constructor() {
    this.checkAndStartEcommerceTour();
    this.setupWhatsappPrefixEnforcement();
    this.loadSettings();
    this.currencyService.loadCurrency();
    this.loadCurrencies();
    this.checkShippingStatus();

    this.destroyRef.onDestroy(() => {
    });
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
          accent_color: ['#F59E0B'] }) }),

      // Configuración General
      general: this.fb.group({
        currency: [this.currencyService.currencyCode() || 'COP'],
        locale: ['es-CO'],
        timezone: ['America/Bogota'] }),

      // Slider Principal
      slider: this.fb.group({
        enable: [false],
        photos: this.fb.array([]) }),

      // Catálogo
      catalog: this.fb.group({
        products_per_page: [16],
        show_out_of_stock: [false],
        allow_reviews: [true],
        show_variants: [true],
        show_related_products: [false],
        enable_filters: [false] }),

      // Carrito
      cart: this.fb.group({
        cart_expiration_hours: [24],
        max_quantity_per_item: [10] }),

      // Checkout
      checkout: this.fb.group({
        whatsapp_checkout: [false],
        whatsapp_number: ['', [Validators.pattern(/^\+57[\d+#*\s()-]*$/)]],
        confirm_whatsapp_number: ['', [Validators.pattern(/^\+57[\d+#*\s()-]*$/)]],  // frontend-only, never sent to backend
        require_registration: [false] }) });
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
  get whatsappNumberControl() { return this.checkoutGroup.get('whatsapp_number') as any; }
  get confirmWhatsappNumberControl() { return this.checkoutGroup.get('confirm_whatsapp_number') as any; }
  get requireRegistrationControl() { return this.checkoutGroup.get('require_registration') as any; }

  /**
   * Enforces that WhatsApp number inputs always start with +57
   */
  private setupWhatsappPrefixEnforcement(): void {
    const controls = [this.whatsappNumberControl, this.confirmWhatsappNumberControl];

    controls.forEach(control => {
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
            this.confirmWhatsappNumberControl.setValue('+57', { emitEvent: false });
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

            // Pre-fill confirm_whatsapp_number from saved number
            if (response.config.checkout?.whatsapp_number) {
              let num = response.config.checkout.whatsapp_number;
              if (!num.startsWith('+57')) num = '+57' + num.replace(/^\+?5?7?/, '');
              this.whatsappNumberControl.setValue(num, { emitEvent: false });
              this.confirmWhatsappNumberControl.setValue(num, { emitEvent: false });
            }

            // Cargar logo si existe
            if (response.config.inicio?.logo_url) {
              this.logoPreview.set(response.config.inicio.logo_url);
              this.logoKey = response.config.inicio.logo_url;
            }

            // Cargar imágenes del slider
            if (response.config.slider?.photos) {
              this.sliderImages.set(
                response.config.slider.photos
                  .filter((photo) => photo.url !== null || photo.key !== null)
                  .map((photo) => ({
                    url: photo.url || undefined,
                    key: photo.key || undefined,
                    title: photo.title,
                    caption: photo.caption }))
              );
            }

            // Cargar configuración del footer
            if (response.config.footer) {
              this.footerSettings = response.config.footer;
            }

            // Obtener la URL de la Ecommerce desde la respuesta del endpoint
            this.ecommerceUrl = response.ecommerceUrl || null;
          } else {
            // MODO SETUP: no existe configuración
            this.isSetupMode.set(true);
            this.isEditMode.set(false);
            this.ecommerceUrl = null;
            this.loadTemplate();
          }
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            'Error al cargar configuración: ' + error.message,
          );
          this.isLoading.set(false);
        } });
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
          this.sliderImages.set([]);
          this.activeImageIndex.set(0);
          // Cargar defaults del footer
          if (template.footer) {
            this.footerSettings = template.footer;
          }
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error('Error al cargar template: ' + error.message);
          this.isLoading.set(false);
        } });
  }

  /**
   * Load active currencies for the selector
   */
  private async loadCurrencies(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ success: boolean; data: Currency[]; message?: string }>(
          `${environment.apiUrl}/public/currencies/active`
        )
      );

      if (response.success && response.data) {
        this.currencies = response.data.map((c) => ({
          value: c.code,
          label: `${c.name} (${c.code})` }));
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
    this.shippingMethodsService.getShippingMethodStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => this.hasShippingMethods.set(stats.enabled_methods > 0),
        error: () => this.hasShippingMethods.set(false) });
  }

  navigateToShipping(): void {
    this.router.navigate(['/admin/settings/shipping']);
  }

  private async showShippingRedirectModal(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Configurar Métodos de Envío',
      message: 'Tu tienda necesita al menos un método de envío activo para que los clientes puedan completar sus compras. Te redirigiremos a la configuración de envíos.',
      confirmText: 'Ir a Configuración de Envíos',
      cancelText: 'Configurar después' });
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
    for (let i = 0; i < files.length && valid_files.length < available_slots; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 5 * 1024 * 1024) continue;
      valid_files.push(file);
    }

    if (valid_files.length === 0) {
      this.toastService.warning('No se encontraron imágenes válidas (PNG, JPG, WebP - máx 5MB)');
      input.value = '';
      return;
    }

    if (files.length > available_slots) {
      this.toastService.info(`Se subirán ${valid_files.length} de ${files.length} imágenes (máximo 5 en total)`);
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
              arr.map((v, idx) => idx === placeholder_index
                ? {
                    url: result.url || result.key,
                    key: result.key,
                    thumbnail: result.thumbKey,
                    title: '',
                    caption: '' }
                : v)
            );
            pending_uploads--;
            if (pending_uploads === 0) {
              this.isUploadingImage.set(false);
              this.updateSliderPhotosForm();
              this.toastService.success(
                valid_files.length === 1
                  ? 'Imagen subida exitosamente'
                  : `${valid_files.length} imágenes subidas exitosamente`
              );
            }
          },
          error: (error) => {
            this.sliderImages.update((arr) =>
              arr.map((v, idx) => idx === placeholder_index ? (undefined as unknown as SliderImage) : v)
            );
            pending_uploads--;
            if (pending_uploads === 0) {
              this.sliderImages.update((arr) => arr.filter(Boolean));
              this.isUploadingImage.set(false);
              this.updateSliderPhotosForm();
            }
            this.toastService.error('Error al subir imagen: ' + error.message);
          } });
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
    field: 'title' | 'caption',
    value: string,
  ): void {
    const current = this.sliderImages();
    if (current[index]) {
      this.sliderImages.update((arr) =>
        arr.map((v, idx) => idx === index ? { ...v, [field]: value } : v)
      );
      this.updateSliderPhotosForm();
    }
  }

  /**
   * Handle input event for image title
   */
  onTitleInputChange(event: Event | string): void {
    const value = typeof event === 'string' ? event : (event.target as HTMLInputElement).value;
    this.updateImageMetadata(this.activeImageIndex(), 'title', value);
  }

  /**
   * Handle input event for image caption
   */
  onCaptionInputChange(event: Event | string): void {
    const value = typeof event === 'string' ? event : (event.target as HTMLInputElement).value;
    this.updateImageMetadata(this.activeImageIndex(), 'caption', value);
  }

  /**
   * Set the active image for preview
   */
  setActiveImage(index: number): void {
    this.activeImageIndex.set(index);
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
        } });

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

  /**
   * Update the form's slider photos array from sliderImages
   */
  private updateSliderPhotosForm(): void {
    const photos: SliderPhoto[] = this.sliderImages().map((img) => ({
      url: img.url || null,
      key: img.key || null,
      title: img.title || '',
      caption: img.caption || '' }));

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
        message: !number || !confirm
          ? 'Debes ingresar y confirmar tu numero de WhatsApp para activar esta opcion.'
          : 'Los numeros de WhatsApp no coinciden. Verifica e intenta de nuevo.',
        confirmText: 'Entendido',
        cancelText: 'Cerrar' });
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

    // Apply auto-fill before submitting
    this.applyAutoFill();

    this.isSaving.set(true);

    // Preparar el objeto de configuración (strip confirm_whatsapp_number — frontend-only)
    const { confirm_whatsapp_number, ...checkoutPayload } = this.settingsForm.value.checkout;
    const settings: EcommerceSettings = {
      ...this.settingsForm.value,
      checkout: checkoutPayload,
      inicio: {
        ...this.settingsForm.value.inicio,
        logo_url: this.logoKey || this.settingsForm.value.inicio.logo_url },
      slider: {
        ...this.settingsForm.value.slider,
        photos: this.sliderImages().map((img) => ({
          url: img.key || img.url || null, // Preferir la KEY para persistencia
          key: img.key || null,
          title: img.title || '',
          caption: img.caption || '' })) },
      footer: this.footerSettings };

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
        } });
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
    if (this.ecommerceUrl) {
      window.open(this.ecommerceUrl, '_blank', 'noopener,noreferrer');
    } else {
      this.toastService.warning('No se pudo obtener la URL de la tienda');
    }
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
    this.footerSettings = footer;
    this.settingsForm.markAsDirty();
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
        titulo: `Bienvenido a ${this.storeName}` });
    }

    // Auto-fill párrafo if empty
    if (!parrafo || parrafo.trim() === '') {
      inicio.patchValue({
        parrafo:
          'Encuentra aquí todo lo que buscas y si no lo encuentras pregúntanos...' });
    }
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
        accent_color: branding.accent_color || '#F59E0B' });
      this.settingsForm.markAsDirty();
      this.toastService.success('Colores sincronizados desde el branding de la tienda');
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
