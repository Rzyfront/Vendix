import {
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  input,
  output,
  DestroyRef,
  inject,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  Domain,
  UpdateDomainDto,
  DomainOwnership,
  AppType,
  DomainConfig,
  BrandingConfig,
  SeoConfig,
  FeaturesConfig,
  ThemeConfig,
  EcommerceConfig,
  IntegrationsConfig,
  SecurityConfig,
  PerformanceConfig,
} from '../../interfaces/domain.interface';
import { OrganizationDomainsService } from '../../services/organization-domains.service';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  ToggleComponent,
  InputComponent,
  TextareaComponent,
  ScrollableTabsComponent,
  ScrollableTab,
  SpinnerComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';
import { DnsInstructionsComponent } from '../dns-instructions/dns-instructions.component';

type ConfigTabId = 'branding' | 'seo' | 'features' | 'theme' | 'ecommerce' | 'integrations' | 'security' | 'performance';

interface TabConfig {
  id: ConfigTabId;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-domain-edit-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
    InputComponent,
    TextareaComponent,
    ScrollableTabsComponent,
    SpinnerComponent,
    DnsInstructionsComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Editar Dominio"
      [subtitle]="domain()?.hostname || ''"
      >
      @if (domain()) {
        <!-- Tabs Navigation -->
        <div class="mb-4">
          <app-scrollable-tabs
            [tabs]="tabs"
            [activeTab]="activeTab()"
            size="sm"
            (tabChange)="onTabChange($event)"
          />
        </div>

        <!-- Tab Content -->
        <div class="min-h-[400px]">
          <!-- Branding Tab -->
          @if (activeTab() === 'branding') {
            <div [formGroup]="brandingForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="palette" [size]="16" />
                Configuración de Branding
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="company_name"
                  label="Nombre de la empresa"
                  placeholder="Mi Empresa"
                />
                <app-input
                  formControlName="store_name"
                  label="Nombre de la tienda"
                  placeholder="Mi Tienda"
                />
                <app-input
                  formControlName="logo_url"
                  label="URL del Logo"
                  placeholder="https://ejemplo.com/logo.png"
                />
                <app-input
                  formControlName="favicon"
                  label="URL del Favicon"
                  placeholder="https://ejemplo.com/favicon.ico"
                />
              </div>
              <div class="grid grid-cols-3 gap-4">
                <app-input
                  formControlName="primary_color"
                  label="Color primario"
                  type="color"
                />
                <app-input
                  formControlName="secondary_color"
                  label="Color secundario"
                  type="color"
                />
                <app-input
                  formControlName="accent_color"
                  label="Color de acento"
                  type="color"
                />
              </div>
            </div>
          }

          <!-- SEO Tab -->
          @if (activeTab() === 'seo') {
            <div [formGroup]="seoForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="search" [size]="16" />
                Configuración SEO
              </h4>
              <app-input
                formControlName="title"
                label="Título"
                placeholder="Mi Tienda - Los mejores productos"
              />
              <app-textarea
                formControlName="description"
                label="Descripción"
                placeholder="Descripción de la tienda para motores de búsqueda..."
                [rows]="3"
              />
              <app-input
                formControlName="keywords"
                label="Palabras clave"
                placeholder="tienda, productos, compras (separadas por coma)"
              />
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="og_image"
                  label="URL imagen OG"
                  placeholder="https://ejemplo.com/og-image.png"
                />
                <app-input
                  formControlName="og_type"
                  label="Tipo OG"
                  placeholder="website"
                />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="robots"
                  label="Robots"
                  placeholder="index,follow"
                />
                <app-input
                  formControlName="canonical_url"
                  label="Canonical URL"
                  placeholder="https://ejemplo.com"
                />
              </div>
            </div>
          }

          <!-- Features Tab -->
          @if (activeTab() === 'features') {
            <div [formGroup]="featuresForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="toggle-left" [size]="16" />
                Características del Dominio
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <app-toggle
                  formControlName="multi_store"
                  label="Multi-tienda"
                />
                <app-toggle
                  formControlName="user_management"
                  label="Gestión de usuarios"
                />
                <app-toggle
                  formControlName="analytics"
                  label="Analíticas"
                />
                <app-toggle
                  formControlName="inventory"
                  label="Inventario"
                />
                <app-toggle
                  formControlName="pos"
                  label="Punto de venta (POS)"
                />
                <app-toggle
                  formControlName="orders"
                  label="Pedidos"
                />
                <app-toggle
                  formControlName="customers"
                  label="Clientes"
                />
                <app-toggle
                  formControlName="guest_checkout"
                  label="Compras como invitado"
                />
                <app-toggle
                  formControlName="wishlist"
                  label="Lista de deseos"
                />
                <app-toggle
                  formControlName="reviews"
                  label="Reseñas"
                />
                <app-toggle
                  formControlName="coupons"
                  label="Cupones"
                />
                <app-toggle
                  formControlName="shipping"
                  label="Envíos"
                />
                <app-toggle
                  formControlName="payments"
                  label="Pagos"
                />
                <app-toggle
                  formControlName="api_access"
                  label="Acceso API"
                />
                <app-toggle
                  formControlName="webhooks"
                  label="Webhooks"
                />
                <app-toggle
                  formControlName="custom_themes"
                  label="Temas personalizados"
                />
                <app-toggle
                  formControlName="advanced_analytics"
                  label="Analíticas avanzadas"
                />
              </div>
            </div>
          }

          <!-- Theme Tab -->
          @if (activeTab() === 'theme') {
            <div [formGroup]="themeForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="layout" [size]="16" />
                Configuración de Tema
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-selector
                  formControlName="layout"
                  [options]="layoutOptions"
                  label="Diseño"
                  placeholder="Seleccionar diseño"
                  size="md"
                />
                <app-selector
                  formControlName="sidebar_mode"
                  [options]="sidebarModeOptions"
                  label="Modo sidebar"
                  placeholder="Seleccionar modo"
                  size="md"
                />
                <app-selector
                  formControlName="color_scheme"
                  [options]="colorSchemeOptions"
                  label="Esquema de color"
                  placeholder="Seleccionar esquema"
                  size="md"
                />
                <app-input
                  formControlName="font_family"
                  label="Familia de fuente"
                  placeholder="Inter, sans-serif"
                />
              </div>
              <app-input
                formControlName="border_radius"
                label="Border radius"
                placeholder="8px"
              />
              <app-textarea
                formControlName="custom_css"
                label="CSS personalizado"
                placeholder=".custom { color: red; }"
                [rows]="4"
              />
            </div>
          }

          <!-- Ecommerce Tab -->
          @if (activeTab() === 'ecommerce') {
            <div [formGroup]="ecommerceForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="shopping-cart" [size]="16" />
                Configuración de E-commerce
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="currency"
                  label="Moneda"
                  placeholder="COP"
                />
                <app-input
                  formControlName="locale"
                  label="Locale"
                  placeholder="es-CO"
                />
                <app-input
                  formControlName="timezone"
                  label="Zona horaria"
                  placeholder="America/Bogota"
                />
                <app-selector
                  formControlName="tax_calculation"
                  [options]="taxCalculationOptions"
                  label="Cálculo de impuestos"
                  placeholder="Seleccionar"
                  size="md"
                />
              </div>
              <div class="space-y-3">
                <app-toggle
                  formControlName="shipping_enabled"
                  label="Envíos habilitados"
                />
                <app-toggle
                  formControlName="digital_products_enabled"
                  label="Productos digitales"
                />
                <app-toggle
                  formControlName="subscriptions_enabled"
                  label="Suscripciones"
                />
              </div>
            </div>
          }

          <!-- Integrations Tab -->
          @if (activeTab() === 'integrations') {
            <div [formGroup]="integrationsForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="plug" [size]="16" />
                Integraciones
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="google_analytics"
                  label="Google Analytics ID"
                  placeholder="UA-XXXXX-X"
                />
                <app-input
                  formControlName="google_tag_manager"
                  label="Google Tag Manager ID"
                  placeholder="GTM-XXXXX"
                />
                <app-input
                  formControlName="facebook_pixel"
                  label="Facebook Pixel ID"
                  placeholder="XXXXXXXXXX"
                />
                <app-input
                  formControlName="hotjar"
                  label="Hotjar ID"
                  placeholder="XXXXXXX"
                />
                <app-input
                  formControlName="intercom"
                  label="Intercom ID"
                  placeholder="abc123"
                />
                <app-input
                  formControlName="crisp"
                  label="Crisp ID"
                  placeholder="crisp-123"
                />
              </div>
            </div>
          }

          <!-- Security Tab -->
          @if (activeTab() === 'security') {
            <div [formGroup]="securityForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="shield" [size]="16" />
                Configuración de Seguridad
              </h4>
              <div class="space-y-3">
                <app-toggle
                  formControlName="force_https"
                  label="Forzar HTTPS"
                />
                <app-toggle
                  formControlName="hsts"
                  label="HSTS (HTTP Strict Transport Security)"
                />
              </div>
              <app-textarea
                formControlName="content_security_policy"
                label="Content Security Policy"
                placeholder="default-src https:; script-src https: 'self'"
                [rows]="3"
              />
            </div>
          }

          <!-- Performance Tab -->
          @if (activeTab() === 'performance') {
            <div [formGroup]="performanceForm" class="space-y-4">
              <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <app-icon name="zap" [size]="16" />
                Configuración de Rendimiento
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="cache_ttl"
                  label="TTL de caché (segundos)"
                  type="number"
                  placeholder="3600"
                />
              </div>
              <div class="space-y-3">
                <app-toggle
                  formControlName="cdn_enabled"
                  label="CDN habilitado"
                />
                <app-toggle
                  formControlName="compression_enabled"
                  label="Compresión habilitada"
                />
                <app-toggle
                  formControlName="image_lazy_loading"
                  label="Carga perezosa de imágenes"
                />
              </div>
            </div>
          }
        </div>

        <!-- DNS Instructions Section (for custom domains) -->
        @if (showDnsSection()) {
          <div class="mt-6 pt-6 border-t border-[var(--color-border)]">
            <app-dns-instructions [hostname]="domain()?.hostname || null" />
          </div>
        }
      } @else {
        <div class="flex items-center justify-center py-12">
          <app-spinner [size]="'lg'" />
        </div>
      }

      <div slot="footer" class="flex justify-between items-center">
        <div class="flex items-center gap-3">
          @if (showSslRenew()) {
            <app-button
              variant="outline"
              size="sm"
              [loading]="isRenewingSsl()"
              (clicked)="onRenewSsl()"
            >
              <app-icon name="refresh-cw" [size]="14" slot="icon" />
              Renovar SSL
            </app-button>
          }
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
            [disabled]="isSubmitting()"
            [loading]="isSubmitting()"
            >
            <app-icon name="save" [size]="16" slot="icon" />
            Guardar Cambios
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class DomainEditModalComponent implements OnInit, OnChanges {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private domainsService = inject(OrganizationDomainsService);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly domain = input<Domain | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly submit = output<{
    hostname: string;
    data: UpdateDomainDto;
  }>();
  readonly cancel = output<void>();

  readonly activeTab = signal<ConfigTabId>('branding');
  readonly isRenewingSsl = signal(false);

  readonly tabs: ScrollableTab[] = [
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

  readonly sidebarModeOptions: SelectorOption[] = [
    { value: 'expanded', label: 'Expandido' },
    { value: 'collapsed', label: 'Colapsado' },
    { value: 'overlay', label: 'Superpuesto' },
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

  brandingForm!: FormGroup;
  seoForm!: FormGroup;
  featuresForm!: FormGroup;
  themeForm!: FormGroup;
  ecommerceForm!: FormGroup;
  integrationsForm!: FormGroup;
  securityForm!: FormGroup;
  performanceForm!: FormGroup;

  ownershipOptions: SelectorOption[] = [];
  appTypeOptions: SelectorOption[] = [];

  constructor() {
    this.initializeForms();
  }

  ngOnInit(): void {
    this.loadOptions();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['domain'] && this.domain()) {
      this.populateForms();
    }
  }

  get showDnsSection(): () => boolean {
    return () => {
      const d = this.domain();
      if (!d) return false;
      return d.ownership !== 'vendix_subdomain' && d.ownership !== 'vendix_core';
    };
  }

  get showSslRenew(): () => boolean {
    return () => {
      const d = this.domain();
      if (!d) return false;
      return ['custom_domain', 'custom_subdomain', 'third_party_subdomain'].includes(d.ownership);
    };
  }

  private initializeForms(): void {
    this.brandingForm = this.fb.group({
      company_name: [''],
      store_name: [''],
      logo_url: [''],
      favicon: [''],
      primary_color: ['#007bff'],
      secondary_color: ['#6c757d'],
      accent_color: ['#28a745'],
    });

    this.seoForm = this.fb.group({
      title: [''],
      description: [''],
      keywords: [''],
      og_image: [''],
      og_type: ['website'],
      robots: ['index,follow'],
      canonical_url: [''],
    });

    this.featuresForm = this.fb.group({
      multi_store: [true],
      user_management: [true],
      analytics: [true],
      custom_domain: [true],
      inventory: [true],
      pos: [true],
      orders: [true],
      customers: [true],
      guest_checkout: [true],
      wishlist: [true],
      reviews: [true],
      coupons: [true],
      shipping: [true],
      payments: [true],
      api_access: [false],
      webhooks: [false],
      custom_themes: [false],
      advanced_analytics: [false],
    });

    this.themeForm = this.fb.group({
      layout: ['sidebar'],
      sidebar_mode: ['expanded'],
      color_scheme: ['auto'],
      border_radius: ['8px'],
      font_family: ['Inter, sans-serif'],
      custom_css: [''],
    });

    this.ecommerceForm = this.fb.group({
      currency: ['COP'],
      locale: ['es-CO'],
      timezone: ['America/Bogota'],
      tax_calculation: ['automatic'],
      shipping_enabled: [true],
      digital_products_enabled: [false],
      subscriptions_enabled: [false],
    });

    this.integrationsForm = this.fb.group({
      google_analytics: [''],
      google_tag_manager: [''],
      facebook_pixel: [''],
      hotjar: [''],
      intercom: [''],
      crisp: [''],
    });

    this.securityForm = this.fb.group({
      force_https: [true],
      hsts: [false],
      content_security_policy: [''],
      allowed_origins: [[] as string[]],
    });

    this.performanceForm = this.fb.group({
      cache_ttl: [3600],
      cdn_enabled: [true],
      compression_enabled: [true],
      image_lazy_loading: [true],
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

  private populateForms(): void {
    const domain = this.domain();
    if (!domain) return;

    const config = domain.config || {};

    this.brandingForm.patchValue({
      company_name: config.branding?.company_name || '',
      store_name: config.branding?.store_name || '',
      logo_url: config.branding?.logo_url || '',
      favicon: config.branding?.favicon || '',
      primary_color: config.branding?.primary_color || '#007bff',
      secondary_color: config.branding?.secondary_color || '#6c757d',
      accent_color: config.branding?.accent_color || '#28a745',
    });

    this.seoForm.patchValue({
      title: config.seo?.title || '',
      description: config.seo?.description || '',
      keywords: config.seo?.keywords?.join(', ') || '',
      og_image: config.seo?.og_image || '',
      og_type: config.seo?.og_type || 'website',
      robots: config.seo?.robots || 'index,follow',
      canonical_url: config.seo?.canonical_url || '',
    });

    this.featuresForm.patchValue({
      multi_store: config.features?.multi_store ?? true,
      user_management: config.features?.user_management ?? true,
      analytics: config.features?.analytics ?? true,
      custom_domain: config.features?.custom_domain ?? true,
      inventory: config.features?.inventory ?? true,
      pos: config.features?.pos ?? true,
      orders: config.features?.orders ?? true,
      customers: config.features?.customers ?? true,
      guest_checkout: config.features?.guest_checkout ?? true,
      wishlist: config.features?.wishlist ?? true,
      reviews: config.features?.reviews ?? true,
      coupons: config.features?.coupons ?? true,
      shipping: config.features?.shipping ?? true,
      payments: config.features?.payments ?? true,
      api_access: config.features?.api_access ?? false,
      webhooks: config.features?.webhooks ?? false,
      custom_themes: config.features?.custom_themes ?? false,
      advanced_analytics: config.features?.advanced_analytics ?? false,
    });

    this.themeForm.patchValue({
      layout: config.theme?.layout || 'sidebar',
      sidebar_mode: config.theme?.sidebar_mode || 'expanded',
      color_scheme: config.theme?.color_scheme || 'auto',
      border_radius: config.theme?.border_radius || '8px',
      font_family: config.theme?.font_family || 'Inter, sans-serif',
      custom_css: config.theme?.custom_css || '',
    });

    this.ecommerceForm.patchValue({
      currency: config.ecommerce?.currency || 'COP',
      locale: config.ecommerce?.locale || 'es-CO',
      timezone: config.ecommerce?.timezone || 'America/Bogota',
      tax_calculation: config.ecommerce?.tax_calculation || 'automatic',
      shipping_enabled: config.ecommerce?.shipping_enabled ?? true,
      digital_products_enabled: config.ecommerce?.digital_products_enabled ?? false,
      subscriptions_enabled: config.ecommerce?.subscriptions_enabled ?? false,
    });

    this.integrationsForm.patchValue({
      google_analytics: config.integrations?.google_analytics || '',
      google_tag_manager: config.integrations?.google_tag_manager || '',
      facebook_pixel: config.integrations?.facebook_pixel || '',
      hotjar: config.integrations?.hotjar || '',
      intercom: config.integrations?.intercom || '',
      crisp: config.integrations?.crisp || '',
    });

    this.securityForm.patchValue({
      force_https: config.security?.force_https ?? true,
      hsts: config.security?.hsts ?? false,
      content_security_policy: config.security?.content_security_policy || '',
      allowed_origins: config.security?.allowed_origins || [],
    });

    this.performanceForm.patchValue({
      cache_ttl: config.performance?.cache_ttl || 3600,
      cdn_enabled: config.performance?.cdn_enabled ?? true,
      compression_enabled: config.performance?.compression_enabled ?? true,
      image_lazy_loading: config.performance?.image_lazy_loading ?? true,
    });
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId as ConfigTabId);
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onRenewSsl(): void {
    const domain = this.domain();
    if (!domain) return;

    this.isRenewingSsl.set(true);
    this.domainsService.renewSsl(domain.id).subscribe({
      next: () => {
        this.isRenewingSsl.set(false);
      },
      error: () => {
        this.isRenewingSsl.set(false);
      },
    });
  }

  onSubmit(): void {
    const domain = this.domain();
    if (!domain) return;

    const config: DomainConfig = {
      branding: {
        company_name: this.brandingForm.get('company_name')?.value || undefined,
        store_name: this.brandingForm.get('store_name')?.value || undefined,
        logo_url: this.brandingForm.get('logo_url')?.value || undefined,
        favicon: this.brandingForm.get('favicon')?.value || undefined,
        primary_color: this.brandingForm.get('primary_color')?.value || undefined,
        secondary_color: this.brandingForm.get('secondary_color')?.value || undefined,
        accent_color: this.brandingForm.get('accent_color')?.value || undefined,
      },
      seo: {
        title: this.seoForm.get('title')?.value || undefined,
        description: this.seoForm.get('description')?.value || undefined,
        keywords: this.seoForm.get('keywords')?.value?.split(',').map((k: string) => k.trim()).filter(Boolean) || undefined,
        og_image: this.seoForm.get('og_image')?.value || undefined,
        og_type: this.seoForm.get('og_type')?.value || undefined,
        robots: this.seoForm.get('robots')?.value || undefined,
        canonical_url: this.seoForm.get('canonical_url')?.value || undefined,
      },
      features: {
        multi_store: this.featuresForm.get('multi_store')?.value ?? undefined,
        user_management: this.featuresForm.get('user_management')?.value ?? undefined,
        analytics: this.featuresForm.get('analytics')?.value ?? undefined,
        custom_domain: this.featuresForm.get('custom_domain')?.value ?? undefined,
        inventory: this.featuresForm.get('inventory')?.value ?? undefined,
        pos: this.featuresForm.get('pos')?.value ?? undefined,
        orders: this.featuresForm.get('orders')?.value ?? undefined,
        customers: this.featuresForm.get('customers')?.value ?? undefined,
        guest_checkout: this.featuresForm.get('guest_checkout')?.value ?? undefined,
        wishlist: this.featuresForm.get('wishlist')?.value ?? undefined,
        reviews: this.featuresForm.get('reviews')?.value ?? undefined,
        coupons: this.featuresForm.get('coupons')?.value ?? undefined,
        shipping: this.featuresForm.get('shipping')?.value ?? undefined,
        payments: this.featuresForm.get('payments')?.value ?? undefined,
        api_access: this.featuresForm.get('api_access')?.value ?? undefined,
        webhooks: this.featuresForm.get('webhooks')?.value ?? undefined,
        custom_themes: this.featuresForm.get('custom_themes')?.value ?? undefined,
        advanced_analytics: this.featuresForm.get('advanced_analytics')?.value ?? undefined,
      },
      theme: {
        layout: this.themeForm.get('layout')?.value || undefined,
        sidebar_mode: this.themeForm.get('sidebar_mode')?.value || undefined,
        color_scheme: this.themeForm.get('color_scheme')?.value || undefined,
        border_radius: this.themeForm.get('border_radius')?.value || undefined,
        font_family: this.themeForm.get('font_family')?.value || undefined,
        custom_css: this.themeForm.get('custom_css')?.value || undefined,
      },
      ecommerce: {
        currency: this.ecommerceForm.get('currency')?.value || undefined,
        locale: this.ecommerceForm.get('locale')?.value || undefined,
        timezone: this.ecommerceForm.get('timezone')?.value || undefined,
        tax_calculation: this.ecommerceForm.get('tax_calculation')?.value || undefined,
        shipping_enabled: this.ecommerceForm.get('shipping_enabled')?.value ?? undefined,
        digital_products_enabled: this.ecommerceForm.get('digital_products_enabled')?.value ?? undefined,
        subscriptions_enabled: this.ecommerceForm.get('subscriptions_enabled')?.value ?? undefined,
      },
      integrations: {
        google_analytics: this.integrationsForm.get('google_analytics')?.value || undefined,
        google_tag_manager: this.integrationsForm.get('google_tag_manager')?.value || undefined,
        facebook_pixel: this.integrationsForm.get('facebook_pixel')?.value || undefined,
        hotjar: this.integrationsForm.get('hotjar')?.value || undefined,
        intercom: this.integrationsForm.get('intercom')?.value || undefined,
        crisp: this.integrationsForm.get('crisp')?.value || undefined,
      },
      security: {
        force_https: this.securityForm.get('force_https')?.value ?? undefined,
        hsts: this.securityForm.get('hsts')?.value ?? undefined,
        content_security_policy: this.securityForm.get('content_security_policy')?.value || undefined,
        allowed_origins: this.securityForm.get('allowed_origins')?.value || undefined,
      },
      performance: {
        cache_ttl: this.performanceForm.get('cache_ttl')?.value || undefined,
        cdn_enabled: this.performanceForm.get('cdn_enabled')?.value ?? undefined,
        compression_enabled: this.performanceForm.get('compression_enabled')?.value ?? undefined,
        image_lazy_loading: this.performanceForm.get('image_lazy_loading')?.value ?? undefined,
      },
    };

    const updateData: UpdateDomainDto = {
      config,
    };

    this.submit.emit({
      hostname: domain.hostname,
      data: updateData,
    });
  }

  getErrorMessage(control: AbstractControl | null): string {
    if (!control || !control.errors || !control.touched) {
      return '';
    }

    const errors = control.errors;
    if (errors['required']) {
      return 'Este campo es requerido';
    }

    return 'Valor inválido';
  }
}
