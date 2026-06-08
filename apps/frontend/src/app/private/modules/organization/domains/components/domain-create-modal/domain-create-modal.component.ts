import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  input,
  output,
  DestroyRef,
  inject,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
} from '@angular/forms';

import {
  CreateDomainDto,
  DomainOwnership,
  AppType,
  DomainConfig,
} from '../../interfaces/domain.interface';
import { OrganizationDomainsService } from '../../services/organization-domains.service';

import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  IconComponent,
  ImageSourceModalComponent,
  SelectorComponent,
  ToggleComponent,
  ScrollableTabsComponent,
  ScrollableTab,
  SelectorOption,
} from '../../../../../../shared/components/index';
import { StoreBindingPickerComponent } from '../store-binding-picker/store-binding-picker.component';
import { ImageUploadService } from '../../../../../../shared/services';
import { dataUrlToFile } from '../../../../../../shared/utils';
import { environment } from '../../../../../../../environments/environment';

type DomainAssetField = 'logo_url' | 'favicon';

type ConfigTabId = 'branding' | 'seo' | 'features' | 'theme' | 'ecommerce' | 'integrations' | 'security' | 'performance';

@Component({
  selector: 'app-domain-create-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
    ScrollableTabsComponent,
    StoreBindingPickerComponent,
    ImageSourceModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Crear Nuevo Dominio"
      subtitle="Configura un nuevo dominio para tu organización o tienda"
      >
      <form [formGroup]="domainForm" class="space-y-4">
        <!-- Hostname Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
          >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
            >
            <app-icon name="globe" [size]="16" />
            Configuración del Dominio
          </h3>

          <div class="space-y-4">
            <!-- Ownership Type -->
            <app-selector
              formControlName="ownership"
              label="Tipo de Dominio"
              [options]="ownershipOptions"
              [required]="true"
              [errorText]="getErrorMessage(domainForm.get('ownership'))"
              placeholder="Seleccionar tipo"
              size="md"
              />

            <!-- Hostname Input -->
            <div class="space-y-2">
              <label
                class="block text-sm font-medium text-[var(--color-text-primary)]"
                >
                Hostname <span class="text-[var(--color-destructive)]">*</span>
              </label>
              <div class="flex items-center gap-2">
                <app-input
                  formControlName="hostname"
                  [placeholder]="hostnamePlaceholder"
                  [required]="true"
                  [control]="domainForm.get('hostname')"
                  [error]="getErrorMessage(domainForm.get('hostname'))"
                  size="md"
                  class="flex-1"
                  >
                  <app-icon name="link" [size]="16" slot="prefix" />
                </app-input>
                @if (isVendixSubdomain) {
                  <span
                    class="text-sm text-[var(--color-text-secondary)] whitespace-nowrap"
                    >
                    .{{ vendixDomain }}
                  </span>
                }
              </div>
              <p class="text-xs text-[var(--color-text-secondary)]">
                {{ hostnameHelperText }}
              </p>
            </div>
          </div>
        </div>

        <!-- Assignment Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
          >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
            >
            <app-icon name="link-2" [size]="16" />
            Asignación
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Store Binding Picker -->
            <app-store-binding-picker
              [selectedStoreId]="selectedStoreId()"
              (storeChange)="onStoreChange($event)"
            />

            <!-- App Type -->
            <app-selector
              formControlName="app_type"
              label="Tipo de Aplicación"
              [options]="appTypeOptions"
              placeholder="Seleccionar aplicación"
              size="md"
              />
          </div>
        </div>

        <!-- Options Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
          >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
            >
            <app-icon name="settings" [size]="16" />
            Opciones
          </h3>

          <div class="flex items-center gap-4">
            <app-toggle formControlName="is_primary" label="Dominio primario" />
            <span class="text-sm text-[var(--color-text-secondary)]">
              El dominio primario será el principal para la tienda u organización
            </span>
          </div>
        </div>

        <!-- Configuration Tabs -->
        @if (!isVendixSubdomain) {
          <div
            class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
            >
            <h3
              class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
              >
              <app-icon name="sliders" [size]="16" />
              Configuración Avanzada
            </h3>

            <app-scrollable-tabs
              [tabs]="configTabs"
              [activeTab]="activeTab()"
              size="sm"
              (tabChange)="onTabChange($event)"
            />

            <div class="mt-4">
              <!-- Branding Tab -->
              @if (activeTab() === 'branding') {
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-input
                      label="Nombre de la empresa"
                      formControlName="company_name"
                      placeholder="Mi Empresa"
                    />
                    <app-input
                      label="Nombre de la tienda"
                      formControlName="store_name"
                      placeholder="Mi Tienda"
                    />
                  </div>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="domain-asset">
                      <label class="domain-asset__label">Logo</label>
                      <div class="domain-asset__row">
                        <div class="domain-asset__preview">
                          @if (logoPreview()) {
                            <img [src]="logoPreview()!" alt="Logo" />
                          } @else {
                            <app-icon name="image" [size]="20" />
                          }
                        </div>
                        <app-button
                          variant="outline"
                          size="sm"
                          [disabled]="uploadingAsset()"
                          (clicked)="openAssetModal('logo_url')"
                        >
                          <app-icon name="upload" [size]="14" slot="icon" />
                          {{ logoPreview() ? 'Cambiar' : 'Subir' }}
                        </app-button>
                      </div>
                    </div>
                    <div class="domain-asset">
                      <label class="domain-asset__label">Favicon</label>
                      <div class="domain-asset__row">
                        <div class="domain-asset__preview">
                          @if (faviconPreview()) {
                            <img [src]="faviconPreview()!" alt="Favicon" />
                          } @else {
                            <app-icon name="feather" [size]="20" />
                          }
                        </div>
                        <app-button
                          variant="outline"
                          size="sm"
                          [disabled]="uploadingAsset()"
                          (clicked)="openAssetModal('favicon')"
                        >
                          <app-icon name="upload" [size]="14" slot="icon" />
                          {{ faviconPreview() ? 'Cambiar' : 'Subir' }}
                        </app-button>
                      </div>
                    </div>
                  </div>
                  <div class="grid grid-cols-3 gap-4">
                    <app-input
                      label="Color primario"
                      type="color"
                      formControlName="primary_color"
                    />
                    <app-input
                      label="Color secundario"
                      type="color"
                      formControlName="secondary_color"
                    />
                    <app-input
                      label="Color de acento"
                      type="color"
                      formControlName="accent_color"
                    />
                  </div>
                </div>
              }

              <!-- SEO Tab -->
              @if (activeTab() === 'seo') {
                <div class="space-y-4">
                  <app-input
                    label="Título SEO"
                    formControlName="seo_title"
                    placeholder="Mi Tienda - Los mejores productos"
                  />
                  <div class="space-y-2">
                    <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                      Descripción SEO
                    </label>
                    <textarea
                      formControlName="seo_description"
                      placeholder="Descripción de la tienda para motores de búsqueda..."
                      class="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                      rows="3"
                    ></textarea>
                  </div>
                  <app-input
                    label="Palabras clave"
                    formControlName="seo_keywords"
                    placeholder="tienda, productos, compras (separadas por coma)"
                  />
                </div>
              }

              <!-- Features Tab (Summary) -->
              @if (activeTab() === 'features') {
                <div class="space-y-3">
                  <p class="text-sm text-[var(--color-text-secondary)]">
                    Las características se habilitarán después de crear el dominio.
                    Podrás configurarlas en la edición del dominio.
                  </p>
                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex items-center gap-2 p-2 bg-[var(--color-muted)]/30 rounded">
                      <app-icon name="toggle-left" [size]="14" class="text-[var(--color-text-secondary)]" />
                      <span class="text-xs text-[var(--color-text-primary)]">Inventario</span>
                    </div>
                    <div class="flex items-center gap-2 p-2 bg-[var(--color-muted)]/30 rounded">
                      <app-icon name="toggle-left" [size]="14" class="text-[var(--color-text-secondary)]" />
                      <span class="text-xs text-[var(--color-text-primary)]">Pedidos</span>
                    </div>
                    <div class="flex items-center gap-2 p-2 bg-[var(--color-muted)]/30 rounded">
                      <app-icon name="toggle-left" [size]="14" class="text-[var(--color-text-secondary)]" />
                      <span class="text-xs text-[var(--color-text-primary)]">Pagos</span>
                    </div>
                    <div class="flex items-center gap-2 p-2 bg-[var(--color-muted)]/30 rounded">
                      <app-icon name="toggle-left" [size]="14" class="text-[var(--color-text-secondary)]" />
                      <span class="text-xs text-[var(--color-text-primary)]">Envíos</span>
                    </div>
                  </div>
                </div>
              }

              <!-- Theme Tab -->
              @if (activeTab() === 'theme') {
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-selector
                      formControlName="theme_layout"
                      [options]="layoutOptions"
                      label="Diseño"
                      placeholder="Seleccionar diseño"
                      size="md"
                    />
                    <app-selector
                      formControlName="theme_color_scheme"
                      [options]="colorSchemeOptions"
                      label="Esquema de color"
                      placeholder="Seleccionar esquema"
                      size="md"
                    />
                  </div>
                  <app-input
                    label="Familia de fuente"
                    formControlName="theme_font_family"
                    placeholder="Inter, sans-serif"
                  />
                </div>
              }

              <!-- Ecommerce Tab -->
              @if (activeTab() === 'ecommerce') {
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-input
                      label="Moneda"
                      formControlName="ecommerce_currency"
                      placeholder="COP"
                    />
                    <app-input
                      label="Locale"
                      formControlName="ecommerce_locale"
                      placeholder="es-CO"
                    />
                    <app-input
                      label="Zona horaria"
                      formControlName="ecommerce_timezone"
                      placeholder="America/Bogota"
                    />
                    <app-selector
                      formControlName="ecommerce_tax_calculation"
                      [options]="taxCalculationOptions"
                      label="Cálculo de impuestos"
                      placeholder="Seleccionar"
                      size="md"
                    />
                  </div>
                </div>
              }

              <!-- Integrations Tab -->
              @if (activeTab() === 'integrations') {
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-input
                      label="Google Analytics ID"
                      formControlName="ga_id"
                      placeholder="UA-XXXXX-X"
                    />
                    <app-input
                      label="Google Tag Manager ID"
                      formControlName="gtm_id"
                      placeholder="GTM-XXXXX"
                    />
                    <app-input
                      label="Facebook Pixel ID"
                      formControlName="fb_pixel_id"
                      placeholder="XXXXXXXXXX"
                    />
                    <app-input
                      label="Hotjar ID"
                      formControlName="hotjar_id"
                      placeholder="XXXXXXX"
                    />
                  </div>
                </div>
              }

              <!-- Security Tab -->
              @if (activeTab() === 'security') {
                <div class="space-y-3">
                  <app-toggle
                    formControlName="security_force_https"
                    label="Forzar HTTPS"
                  />
                  <app-toggle
                    formControlName="security_hsts"
                    label="HSTS (HTTP Strict Transport Security)"
                  />
                </div>
              }

              <!-- Performance Tab -->
              @if (activeTab() === 'performance') {
                <div class="space-y-3">
                  <app-toggle
                    formControlName="perf_cdn_enabled"
                    label="CDN habilitado"
                  />
                  <app-toggle
                    formControlName="perf_image_lazy_loading"
                    label="Carga perezosa de imágenes"
                  />
                </div>
              }
            </div>
          </div>
        }
      </form>

      <div slot="footer" class="flex justify-between items-center">
        <div class="text-sm text-[var(--color-text-secondary)]">
          <span class="text-[var(--color-destructive)]">*</span> Campos
          requeridos
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting()"
            >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="domainForm.invalid || isSubmitting()"
            [loading]="isSubmitting()"
            >
            <app-icon name="plus" [size]="16" slot="icon" ></app-icon>
            Crear Dominio
          </app-button>
        </div>
      </div>
    </app-modal>

    <app-image-source-modal
      [(isOpen)]="assetModalOpen"
      [singleImage]="true"
      [headerTitle]="assetModalTitle()"
      (imagesAdded)="onDomainAssetImages($event)"
    />
  `,
  styles: [`
    :host {
      display: block;
    }

    .domain-asset__label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
    }

    .domain-asset__row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .domain-asset__preview {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      flex: 0 0 auto;
      overflow: hidden;
      border: 1px dashed var(--color-border);
      border-radius: 10px;
      color: var(--color-text-muted);
      background: var(--color-surface);
    }

    .domain-asset__preview img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      padding: 6px;
    }
  `],
})
export class DomainCreateModalComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private fb = FormBuilder;
  readonly vendixDomain = environment.vendixDomain;
  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly stores = input<{ id: number; name: string; slug: string }[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly submit = output<CreateDomainDto>();
  readonly cancel = output<void>();

  domainForm!: FormGroup;
  ownershipOptions: SelectorOption[] = [];
  appTypeOptions: SelectorOption[] = [];

  readonly activeTab = signal<ConfigTabId>('branding');
  readonly selectedStoreId = signal<number | null>(null);

  readonly assetModalOpen = signal(false);
  readonly activeAssetField = signal<DomainAssetField | null>(null);
  readonly uploadingAsset = signal(false);
  readonly logoPreview = signal<string | null>(null);
  readonly faviconPreview = signal<string | null>(null);
  readonly assetModalTitle = computed<string | null>(() => {
    const field = this.activeAssetField();
    if (field === 'logo_url') return 'Logo';
    if (field === 'favicon') return 'Favicon';
    return null;
  });

  readonly configTabs: ScrollableTab[] = [
    { id: 'branding', label: 'Branding', icon: 'palette' },
    { id: 'seo', label: 'SEO', icon: 'search' },
    { id: 'features', label: 'Features', icon: 'toggle-left' },
    { id: 'theme', label: 'Tema', icon: 'layout' },
    { id: 'ecommerce', label: 'E-commerce', icon: 'shopping-cart' },
    { id: 'integrations', label: 'Integraciones', icon: 'plug' },
    { id: 'security', label: 'Seguridad', icon: 'shield' },
    { id: 'performance', label: 'Rendimiento', icon: 'zap' },
  ];

  readonly layoutOptions: SelectorOption[] = [
    { value: 'sidebar', label: 'Sidebar' },
    { value: 'topbar', label: 'Topbar' },
    { value: 'minimal', label: 'Minimal' },
  ];

  readonly colorSchemeOptions: SelectorOption[] = [
    { value: 'light', label: 'Claro' },
    { value: 'dark', label: 'Oscuro' },
    { value: 'auto', label: 'Automático' },
  ];

  readonly taxCalculationOptions: SelectorOption[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'automatic', label: 'Automático' },
    { value: 'disabled', label: 'Deshabilitado' },
  ];

  private domainsService: OrganizationDomainsService;
  private formBuilder: FormBuilder;
  private readonly imageUploadService = inject(ImageUploadService);

  constructor(
    private fb_: FormBuilder,
    private domainsService_: OrganizationDomainsService,
  ) {
    this.formBuilder = fb_;
    this.domainsService = domainsService_;
    this.initializeForm();
  }

  ngOnInit(): void {
    this.loadOptions();
    this.setupOwnershipListener();
  }

  private initializeForm(): void {
    this.domainForm = this.fb_.group({
      hostname: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.pattern(/^[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9]$/),
        ],
      ],
      ownership: [DomainOwnership.VENDIX_SUBDOMAIN, [Validators.required]],
      store_id: [null],
      app_type: [AppType.STORE_ECOMMERCE],
      is_primary: [false],
      // Branding
      company_name: [''],
      store_name: [''],
      logo_url: [''],
      favicon: [''],
      primary_color: ['#007bff'],
      secondary_color: ['#6c757d'],
      accent_color: ['#28a745'],
      // SEO
      seo_title: [''],
      seo_description: [''],
      seo_keywords: [''],
      // Theme
      theme_layout: ['sidebar'],
      theme_color_scheme: ['auto'],
      theme_font_family: ['Inter, sans-serif'],
      // Ecommerce
      ecommerce_currency: ['COP'],
      ecommerce_locale: ['es-CO'],
      ecommerce_timezone: ['America/Bogota'],
      ecommerce_tax_calculation: ['automatic'],
      // Integrations
      ga_id: [''],
      gtm_id: [''],
      fb_pixel_id: [''],
      hotjar_id: [''],
      // Security
      security_force_https: [true],
      security_hsts: [false],
      // Performance
      perf_cdn_enabled: [true],
      perf_image_lazy_loading: [true],
    });
  }

  private loadOptions(): void {
    this.ownershipOptions = this.domainsService
      .getDomainOwnershipOptions()
      .map((opt) => ({ value: opt.value, label: opt.label }));
    this.appTypeOptions = this.domainsService
      .getAppTypeOptions()
      .map((opt) => ({ value: opt.value, label: opt.label }));
  }

  private setupOwnershipListener(): void {
    this.domainForm
      .get('ownership')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ownership) => {
        const hostnameControl = this.domainForm.get('hostname');
        if (ownership === DomainOwnership.VENDIX_SUBDOMAIN) {
          hostnameControl?.setValidators([
            Validators.required,
            Validators.minLength(3),
            Validators.pattern(/^[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9]$/),
          ]);
        } else {
          hostnameControl?.setValidators([
            Validators.required,
            Validators.minLength(3),
            Validators.pattern(
              /^[a-zA-Z0-9][a-zA-Z0-9\-\.]*[a-zA-Z0-9]\.[a-zA-Z]{2}$/,
            ),
          ]);
        }
        hostnameControl?.updateValueAndValidity();
      });
  }

  get isVendixSubdomain(): boolean {
    return (
      this.domainForm.get('ownership')?.value === DomainOwnership.VENDIX_SUBDOMAIN
    );
  }

  get hostnamePlaceholder(): string {
    if (this.isVendixSubdomain) {
      return 'mi-tienda';
    }
    return 'mi-tienda.ejemplo.com';
  }

  get hostnameHelperText(): string {
    if (this.isVendixSubdomain) {
      return `Tu subdominio se creará como: [nombre].${this.vendixDomain}`;
    }
    return 'Ingresa tu dominio completo (ej: tienda.tuempresa.com)';
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId as ConfigTabId);
  }

  onStoreChange(storeId: number | null): void {
    this.selectedStoreId.set(storeId);
    this.domainForm.get('store_id')?.setValue(storeId);
  }

  openAssetModal(field: DomainAssetField): void {
    this.activeAssetField.set(field);
    this.assetModalOpen.set(true);
  }

  async onDomainAssetImages(dataUrls: string[]): Promise<void> {
    const dataUrl = dataUrls[0];
    const field = this.activeAssetField();
    if (!dataUrl || !field) return;

    const label = field === 'logo_url' ? 'logo' : 'favicon';
    const file = dataUrlToFile(dataUrl, `${label}.jpg`);

    this.uploadingAsset.set(true);
    try {
      const result = await firstValueFrom(
        this.imageUploadService.uploadFile(file, 'logos'),
      );
      this.domainForm.get(field)?.setValue(result.key);
      this.domainForm.get(field)?.markAsDirty();
      if (field === 'logo_url') {
        this.logoPreview.set(result.url);
      } else {
        this.faviconPreview.set(result.url);
      }
    } finally {
      this.uploadingAsset.set(false);
      this.activeAssetField.set(null);
    }
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.domainForm.invalid) {
      this.domainForm.markAllAsTouched();
      return;
    }

    const formValue = this.domainForm.value;

    // Build hostname with suffix for Vendix subdomains
    let hostname = formValue.hostname;
    if (formValue.ownership === DomainOwnership.VENDIX_SUBDOMAIN) {
      hostname = `${formValue.hostname}.${this.vendixDomain}`;
    }

    // Build config only for non-Vendix subdomains
    let config: DomainConfig | undefined;
    if (formValue.ownership !== DomainOwnership.VENDIX_SUBDOMAIN) {
      config = {
        branding: {
          company_name: formValue.company_name || undefined,
          store_name: formValue.store_name || undefined,
          logo_url: formValue.logo_url || undefined,
          favicon: formValue.favicon || undefined,
          primary_color: formValue.primary_color || undefined,
          secondary_color: formValue.secondary_color || undefined,
          accent_color: formValue.accent_color || undefined,
        },
        seo: {
          title: formValue.seo_title || undefined,
          description: formValue.seo_description || undefined,
          keywords: formValue.seo_keywords?.split(',').map((k: string) => k.trim()).filter(Boolean) || undefined,
        },
        theme: {
          layout: formValue.theme_layout || undefined,
          color_scheme: formValue.theme_color_scheme || undefined,
          font_family: formValue.theme_font_family || undefined,
        },
        ecommerce: {
          currency: formValue.ecommerce_currency || undefined,
          locale: formValue.ecommerce_locale || undefined,
          timezone: formValue.ecommerce_timezone || undefined,
          tax_calculation: formValue.ecommerce_tax_calculation as 'manual' | 'automatic' | 'disabled' || undefined,
        },
        integrations: {
          google_analytics: formValue.ga_id || undefined,
          google_tag_manager: formValue.gtm_id || undefined,
          facebook_pixel: formValue.fb_pixel_id || undefined,
          hotjar: formValue.hotjar_id || undefined,
        },
        security: {
          force_https: formValue.security_force_https ?? undefined,
          hsts: formValue.security_hsts ?? undefined,
        },
        performance: {
          cdn_enabled: formValue.perf_cdn_enabled ?? undefined,
          image_lazy_loading: formValue.perf_image_lazy_loading ?? undefined,
        },
      };
    }

    const domainData: CreateDomainDto = {
      hostname,
      ownership: formValue.ownership,
      store_id: this.selectedStoreId() || undefined,
      app_type: formValue.app_type || undefined,
      is_primary: formValue.is_primary || false,
      config,
    };

    this.submit.emit(domainData);
  }

  private resetForm(): void {
    this.domainForm.reset({
      hostname: '',
      ownership: DomainOwnership.VENDIX_SUBDOMAIN,
      store_id: null,
      app_type: AppType.STORE_ECOMMERCE,
      is_primary: false,
      company_name: '',
      store_name: '',
      logo_url: '',
      favicon: '',
      primary_color: '#007bff',
      secondary_color: '#6c757d',
      accent_color: '#28a745',
      seo_title: '',
      seo_description: '',
      seo_keywords: '',
      theme_layout: 'sidebar',
      theme_color_scheme: 'auto',
      theme_font_family: 'Inter, sans-serif',
      ecommerce_currency: 'COP',
      ecommerce_locale: 'es-CO',
      ecommerce_timezone: 'America/Bogota',
      ecommerce_tax_calculation: 'automatic',
      ga_id: '',
      gtm_id: '',
      fb_pixel_id: '',
      hotjar_id: '',
      security_force_https: true,
      security_hsts: false,
      perf_cdn_enabled: true,
      perf_image_lazy_loading: true,
    });
    this.selectedStoreId.set(null);
    this.activeTab.set('branding');
    this.logoPreview.set(null);
    this.faviconPreview.set(null);
    this.activeAssetField.set(null);
  }

  getErrorMessage(control: AbstractControl | null): string {
    if (!control || !control.errors || !control.touched) {
      return '';
    }

    const errors = control.errors;
    if (errors['required']) {
      return 'Este campo es requerido';
    }
    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }
    if (errors['pattern']) {
      if (this.isVendixSubdomain) {
        return 'Solo letras, números y guiones. Debe empezar y terminar con letra o número';
      }
      return 'Formato de dominio inválido';
    }

    return 'Valor inválido';
  }
}
