import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ScrollableTabsComponent,
  SpinnerComponent,
  StickyHeaderComponent,
} from '../../../../../shared/components';
import type {
  ScrollableTab,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../shared/components';
import { OrganizationSettingsService } from '../services/organization-settings.service';
import {
  OrganizationBranding,
  OrganizationSettings,
} from '../../../../../core/models/organization.model';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';

type BrandingControlName =
  | 'name'
  | 'primary_color'
  | 'secondary_color'
  | 'accent_color'
  | 'logo_url'
  | 'favicon_url';

interface BrandingFormControls {
  name: FormControl<string>;
  primary_color: FormControl<string>;
  secondary_color: FormControl<string>;
  accent_color: FormControl<string>;
  logo_url: FormControl<string>;
  favicon_url: FormControl<string>;
}

interface BrandingColorField {
  control: 'primary_color' | 'secondary_color' | 'accent_color';
  label: string;
}

type BrandingAssetControlName = 'logo_url' | 'favicon_url';

interface PendingBrandAssetUpload {
  file: File;
  preview: string;
}

@Component({
  selector: 'app-application',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ScrollableTabsComponent,
    SpinnerComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="application-settings min-h-screen">
      <app-sticky-header
        title="Configuración de la aplicación"
        subtitle="Identidad visual de la organización"
        icon="sliders"
        [showBackButton]="true"
        backRoute="/admin/config"
        [badgeText]="badgeText()"
        [badgeColor]="badgeColor()"
        [badgePulse]="badgePulse()"
        [metadataContent]="metadataContent()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div
        class="sticky top-[41px] z-10 bg-background py-1.5 md:static md:bg-transparent md:py-0 lg:hidden"
      >
        <app-scrollable-tabs
          [tabs]="sections"
          [activeTab]="activeSection()"
          size="md"
          ariaLabel="Secciones de identidad visual"
          (tabChange)="scrollToSection($event)"
        />
      </div>

      @if (loading()) {
        <div class="loading-card">
          <app-spinner size="lg" text="Cargando configuración..." />
        </div>
      } @else {
        @if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            <div class="error-content">
              <span>{{ error() }}</span>
              <app-button variant="ghost" size="sm" (clicked)="dismissError()">
                Cerrar
              </app-button>
            </div>
          </app-alert-banner>
        }

        <form
          class="application-settings__content"
          [formGroup]="form"
          (ngSubmit)="onSave()"
        >
          <section id="section-preview" class="settings-section">
            <div class="section-header">
              <div class="section-icon section-icon--primary">
                <app-icon name="app-window" size="18" />
              </div>
              <div>
                <h2 class="section-title">Vista previa</h2>
                <p class="section-description">
                  Identidad visual y datos actuales de la organización.
                </p>
              </div>
            </div>

            <div class="preview-grid">
              <div
                class="brand-preview"
                [style.--org-primary]="preview().primary_color"
                [style.--org-secondary]="preview().secondary_color"
                [style.--org-accent]="preview().accent_color"
                [style.background]="preview().background_color"
                [style.color]="preview().text_color"
              >
                <div
                  class="brand-preview__bar"
                  [style.background]="preview().primary_color"
                >
                  <div
                    class="brand-preview__mark"
                    [style.background]="preview().accent_color"
                  >
                    @if (logoPreview()) {
                      <img [src]="logoPreview()!" alt="" />
                    } @else {
                      <app-icon name="building-2" size="18" />
                    }
                  </div>
                  <div
                    class="brand-preview__nav brand-preview__nav--active"
                  ></div>
                  <div class="brand-preview__nav"></div>
                  <div
                    class="brand-preview__nav brand-preview__nav--accent"
                  ></div>
                </div>

                <div class="brand-preview__body">
                  <div class="brand-preview__header">
                    <div>
                      <span>ORG_ADMIN</span>
                      <h3>{{ organizationName() }}</h3>
                    </div>
                    <div class="brand-preview__pill">Branding</div>
                  </div>

                  <div
                    class="brand-preview__panel"
                    [style.background]="preview().surface_color"
                  >
                    <span [style.background]="preview().secondary_color"></span>
                    <strong>Panel administrativo</strong>
                    <small [style.color]="preview().text_secondary_color">
                      Primario · Secundario · Acento
                    </small>
                  </div>
                </div>
              </div>

              <div class="brand-summary">
                <div class="brand-summary__item">
                  <span>Tipo de cuenta</span>
                  <strong>{{ accountTypeLabel() }}</strong>
                </div>
                <div class="brand-summary__item">
                  <span>Alcance operativo</span>
                  <strong>{{ operatingScopeLabel() }}</strong>
                </div>
                <div class="brand-summary__item">
                  <span>Slug</span>
                  <strong>{{ organizationSlug() }}</strong>
                </div>
              </div>
            </div>
          </section>

          <section id="section-identity" class="settings-section">
            <div class="section-header">
              <div class="section-icon section-icon--blue">
                <app-icon name="building-2" size="18" />
              </div>
              <div>
                <h2 class="section-title">Identidad</h2>
                <p class="section-description">
                  Campos reales de la sección branding.
                </p>
              </div>
            </div>

            <div class="section-body">
              <div class="identity-grid">
                <app-input
                  [formControl]="control('name')"
                  [control]="control('name')"
                  label="Nombre"
                  placeholder="Nombre de la organización"
                  [required]="true"
                />

                <div class="asset-card">
                  <input
                    #logoInput
                    type="file"
                    accept="image/*"
                    class="asset-card__input"
                    (change)="onBrandAssetSelected('logo_url', $event)"
                  />
                  <div class="asset-card__preview asset-card__preview--logo">
                    @if (logoPreview()) {
                      <img [src]="logoPreview()!" alt="Logo" />
                    } @else {
                      <app-icon name="image" size="22" />
                    }
                  </div>
                  <div class="asset-card__content">
                    <div>
                      <label class="asset-card__label">Logo</label>
                      <p>PNG o JPG. Máx 2MB.</p>
                    </div>
                    <div class="asset-card__actions">
                      <app-button
                        type="button"
                        variant="outline"
                        size="sm"
                        [disabled]="saving()"
                        (clicked)="logoInput.click()"
                      >
                        <app-icon name="upload" size="14" slot="icon" />
                        {{ logoPreview() ? 'Cambiar' : 'Subir' }}
                      </app-button>
                      @if (logoPreview()) {
                        <button
                          type="button"
                          class="asset-card__remove"
                          [disabled]="saving()"
                          aria-label="Quitar logo"
                          (click)="removeBrandAsset('logo_url')"
                        >
                          <app-icon name="x" size="14" />
                        </button>
                      }
                    </div>
                  </div>
                </div>

                <div class="asset-card">
                  <input
                    #faviconInput
                    type="file"
                    accept="image/*"
                    class="asset-card__input"
                    (change)="onBrandAssetSelected('favicon_url', $event)"
                  />
                  <div class="asset-card__preview asset-card__preview--favicon">
                    @if (faviconPreview()) {
                      <img [src]="faviconPreview()!" alt="Favicon" />
                    } @else {
                      <app-icon name="feather" size="22" />
                    }
                  </div>
                  <div class="asset-card__content">
                    <div>
                      <label class="asset-card__label">Favicon</label>
                      <p>PNG, JPG o ICO. Máx 1MB.</p>
                    </div>
                    <div class="asset-card__actions">
                      <app-button
                        type="button"
                        variant="outline"
                        size="sm"
                        [disabled]="saving()"
                        (clicked)="faviconInput.click()"
                      >
                        <app-icon name="upload" size="14" slot="icon" />
                        {{ faviconPreview() ? 'Cambiar' : 'Subir' }}
                      </app-button>
                      @if (faviconPreview()) {
                        <button
                          type="button"
                          class="asset-card__remove"
                          [disabled]="saving()"
                          aria-label="Quitar favicon"
                          (click)="removeBrandAsset('favicon_url')"
                        >
                          <app-icon name="x" size="14" />
                        </button>
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="section-colors" class="settings-section">
            <div class="section-header">
              <div class="section-icon section-icon--pink">
                <app-icon name="palette" size="18" />
              </div>
              <div>
                <h2 class="section-title">Colores</h2>
                <p class="section-description">
                  Paleta persistida en la configuración de marca.
                </p>
              </div>
            </div>

            <div class="section-body">
              <div class="color-grid">
                @for (field of colorFields; track field.control) {
                  <div class="color-field">
                    <label
                      class="color-field__label"
                      [for]="'org-branding-' + field.control"
                    >
                      {{ field.label }}
                    </label>
                    <div class="color-field__row">
                      <input
                        [id]="'org-branding-' + field.control"
                        type="color"
                        class="color-picker"
                        [formControl]="control(field.control)"
                        [attr.aria-label]="field.label"
                      />
                      <app-input
                        [formControl]="control(field.control)"
                        [control]="control(field.control)"
                        size="sm"
                        placeholder="#000000"
                      />
                    </div>
                  </div>
                }
              </div>
            </div>
          </section>
        </form>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .application-settings {
        scroll-behavior: smooth;
      }

      .loading-card {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 260px;
        border: 1px solid var(--color-border);
        border-radius: 16px;
        background: var(--color-surface);
      }

      .error-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
      }

      .application-settings__content {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding-bottom: 80px;
      }

      .settings-section {
        overflow: hidden;
        border: 1px solid var(--color-border);
        border-radius: 16px;
        background: var(--color-surface);
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
        scroll-margin-top: 88px;
      }

      .section-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px;
        border-bottom: 1px solid var(--color-border);
      }

      .section-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        border-radius: 10px;
      }

      .section-icon--primary {
        color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.12);
      }

      .section-icon--blue {
        color: #2563eb;
        background: #eff6ff;
      }

      .section-icon--pink {
        color: #db2777;
        background: #fdf2f8;
      }

      .section-title {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 16px;
        font-weight: 700;
        line-height: 1.25;
      }

      .section-description {
        margin: 4px 0 0;
        color: var(--color-text-secondary);
        font-size: 13px;
        line-height: 1.45;
      }

      .section-body,
      .preview-grid {
        padding: 16px;
      }

      .preview-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
      }

      .brand-preview {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr);
        min-height: 250px;
        overflow: hidden;
        border: 1px solid
          color-mix(in srgb, var(--org-primary) 32%, var(--color-border));
        border-radius: 14px;
        box-shadow: 0 16px 40px
          color-mix(in srgb, var(--org-primary) 16%, transparent);
      }

      .brand-preview__bar {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 16px 10px;
      }

      .brand-preview__mark {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.38);
        border-radius: 10px;
        color: var(--org-primary);
      }

      .brand-preview__mark img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .brand-preview__nav {
        width: 28px;
        height: 6px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--org-secondary) 72%, white);
      }

      .brand-preview__nav--active {
        width: 38px;
        background: rgba(255, 255, 255, 0.82);
      }

      .brand-preview__nav--accent {
        background: var(--org-accent);
      }

      .brand-preview__body {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
        padding: 16px;
      }

      .brand-preview__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .brand-preview__header span {
        display: block;
        margin-bottom: 4px;
        font-size: 11px;
        font-weight: 700;
      }

      .brand-preview__header h3 {
        margin: 0;
        font-size: 20px;
        font-weight: 800;
        line-height: 1.1;
        overflow-wrap: anywhere;
      }

      .brand-preview__pill {
        flex: 0 0 auto;
        border-radius: 999px;
        padding: 6px 10px;
        border: 1px solid
          color-mix(in srgb, var(--org-primary) 28%, transparent);
        background: color-mix(in srgb, var(--org-primary) 10%, white);
        color: var(--org-secondary);
        font-size: 12px;
        font-weight: 700;
      }

      .brand-preview__panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: auto;
        border: 1px solid
          color-mix(
            in srgb,
            var(--org-secondary) 22%,
            rgba(148, 163, 184, 0.22)
          );
        border-radius: 12px;
        padding: 14px;
        box-shadow: inset 4px 0 0 var(--org-accent);
      }

      .brand-preview__panel span {
        width: 36px;
        height: 7px;
        border-radius: 999px;
      }

      .brand-preview__panel strong {
        font-size: 15px;
      }

      .brand-preview__panel small {
        font-size: 12px;
      }

      .brand-summary {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .brand-summary__item {
        min-height: 64px;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--color-background);
      }

      .brand-summary__item span {
        display: block;
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 600;
      }

      .brand-summary__item strong {
        display: block;
        margin-top: 4px;
        color: var(--color-text-primary);
        font-size: 15px;
        overflow-wrap: anywhere;
      }

      .identity-grid,
      .color-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
      }

      .asset-card {
        display: grid;
        grid-template-columns: 76px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        min-height: 100px;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--color-background);
      }

      .asset-card__input {
        display: none;
      }

      .asset-card__preview {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 76px;
        height: 76px;
        overflow: hidden;
        border: 1px dashed var(--color-border);
        border-radius: 12px;
        color: var(--color-text-muted);
        background: var(--color-surface);
      }

      .asset-card__preview--favicon {
        border-radius: 16px;
      }

      .asset-card__preview img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        padding: 8px;
      }

      .asset-card__content {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }

      .asset-card__label {
        display: block;
        margin-bottom: 4px;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 700;
      }

      .asset-card__content p {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.35;
      }

      .asset-card__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .asset-card__remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 34px;
        height: 34px;
        border: 1px solid rgba(var(--color-destructive-rgb), 0.28);
        border-radius: 10px;
        color: var(--color-destructive);
        background: rgba(var(--color-destructive-rgb), 0.08);
        cursor: pointer;
      }

      .asset-card__remove:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .asset-card__remove:focus-visible {
        outline: 2px solid var(--color-destructive);
        outline-offset: 2px;
      }

      .color-field {
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--color-background);
      }

      .color-field__label {
        display: block;
        margin-bottom: 8px;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 700;
      }

      .color-field__row {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
      }

      .color-picker {
        width: 44px;
        height: 36px;
        overflow: hidden;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: transparent;
        cursor: pointer;
      }

      .color-picker:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }

      @media (min-width: 640px) {
        .brand-summary {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (min-width: 768px) {
        .application-settings__content {
          gap: 20px;
          padding-bottom: 40px;
        }

        .section-header,
        .section-body,
        .preview-grid {
          padding: 20px 24px;
        }

        .identity-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .color-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (min-width: 1180px) {
        .preview-grid {
          grid-template-columns: minmax(0, 1fr) 280px;
        }

        .brand-summary {
          grid-template-columns: 1fr;
          align-content: start;
        }

        .color-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
    `,
  ],
})
export class ApplicationComponent {
  private readonly settingsService = inject(OrganizationSettingsService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  private readonly fallbackBranding: OrganizationBranding = {
    name: '',
    primary_color: '#7ED7A5',
    secondary_color: '#2F6F4E',
    accent_color: '#FFFFFF',
    background_color: '#FFFFFF',
    surface_color: '#F9FAFB',
    text_color: '#111827',
    text_secondary_color: '#6B7280',
    text_muted_color: '#9CA3AF',
    logo_url: '',
    favicon_url: '',
  };

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly settings = signal<OrganizationSettings | null>(null);
  readonly hasUnsavedChanges = signal(false);
  readonly lastSaved = signal<Date | null>(null);
  readonly activeSection = signal('preview');
  readonly uploadingAssets = signal(false);
  readonly logoPreview = signal<string | null>(null);
  readonly faviconPreview = signal<string | null>(null);
  readonly pendingLogoUpload = signal<PendingBrandAssetUpload | null>(null);
  readonly pendingFaviconUpload = signal<PendingBrandAssetUpload | null>(null);

  readonly form = new FormGroup<BrandingFormControls>({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    primary_color: this.colorControl('#7ED7A5'),
    secondary_color: this.colorControl('#2F6F4E'),
    accent_color: this.colorControl('#FFFFFF'),
    logo_url: new FormControl('', { nonNullable: true }),
    favicon_url: new FormControl('', { nonNullable: true }),
  });

  readonly formSnapshot = signal(this.form.getRawValue());
  readonly saving = computed(
    () => this.settingsService.saving() || this.uploadingAssets(),
  );
  readonly preview = computed(() => ({
    ...this.fallbackBranding,
    ...(this.settings()?.branding ?? {}),
    ...this.formSnapshot(),
  }));
  readonly organization = computed(() => this.authFacade.userOrganization());
  readonly organizationName = computed(() => {
    const name = this.preview().name.trim();
    return name || this.organization()?.name || 'Organización';
  });
  readonly accountTypeLabel = computed(() => {
    const accountType = this.organization()?.account_type;
    if (accountType === 'SINGLE_STORE') return 'Tienda única';
    if (accountType === 'MULTI_STORE_ORG') return 'Multi-tienda';
    return 'No definido';
  });
  readonly operatingScopeLabel = computed(() => {
    const scope = this.organization()?.operating_scope;
    if (scope === 'STORE') return 'Por tienda';
    if (scope === 'ORGANIZATION') return 'Organización';
    return 'No definido';
  });
  readonly organizationSlug = computed(() => {
    const slug = this.organization()?.slug;
    return slug || 'No definido';
  });
  readonly badgeText = computed(() =>
    this.hasUnsavedChanges() ? 'Pendiente' : 'Sincronizado',
  );
  readonly badgeColor = computed<StickyHeaderBadgeColor>(() =>
    this.hasUnsavedChanges() ? 'yellow' : 'green',
  );
  readonly badgePulse = computed(() => this.hasUnsavedChanges());
  readonly metadataContent = computed(() => {
    const saved = this.lastSaved();
    return saved ? `Último guardado: ${this.formatTime(saved)}` : '';
  });
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'discard',
      label: 'Descartar',
      variant: 'outline-danger',
      icon: 'rotate-ccw',
      disabled: !this.hasUnsavedChanges() || this.saving(),
    },
    {
      id: 'save',
      label: 'Guardar',
      variant: 'primary',
      icon: 'save',
      loading: this.saving(),
      disabled: !this.hasUnsavedChanges() || this.form.invalid,
    },
  ]);

  readonly sections: ScrollableTab[] = [
    { id: 'preview', label: 'Vista', icon: 'app-window' },
    { id: 'identity', label: 'Identidad', icon: 'building-2' },
    { id: 'colors', label: 'Colores', icon: 'palette' },
  ];

  readonly colorFields: BrandingColorField[] = [
    { control: 'primary_color', label: 'Primario' },
    { control: 'secondary_color', label: 'Secundario' },
    { control: 'accent_color', label: 'Acento' },
  ];

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.formSnapshot.set(this.form.getRawValue());
        this.hasUnsavedChanges.set(this.form.dirty);
      });

    this.loadSettings();

    this.destroyRef.onDestroy(() => {
      this.revokeBrandAssetPreview('logo_url');
      this.revokeBrandAssetPreview('favicon_url');
    });
  }

  control(name: BrandingControlName): FormControl<string> {
    return this.form.controls[name];
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'save') {
      this.onSave();
      return;
    }

    if (actionId === 'discard') {
      this.discardChanges();
    }
  }

  onBrandAssetSelected(
    controlName: BrandingAssetControlName,
    event: Event,
  ): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.error.set('Solo se permiten archivos de imagen.');
      return;
    }

    const maxSize = controlName === 'logo_url' ? 2 * 1024 * 1024 : 1024 * 1024;
    const label = controlName === 'logo_url' ? 'logo' : 'favicon';
    if (file.size > maxSize) {
      this.error.set(
        `El ${label} excede el tamaño máximo de ${maxSize / 1024 / 1024}MB.`,
      );
      return;
    }

    this.revokeBrandAssetPreview(controlName);
    const preview = URL.createObjectURL(file);
    const pendingUpload = { file, preview };

    if (controlName === 'logo_url') {
      this.logoPreview.set(preview);
      this.pendingLogoUpload.set(pendingUpload);
    } else {
      this.faviconPreview.set(preview);
      this.pendingFaviconUpload.set(pendingUpload);
    }

    this.error.set(null);
    this.form.markAsDirty();
    this.hasUnsavedChanges.set(true);
  }

  removeBrandAsset(controlName: BrandingAssetControlName): void {
    this.revokeBrandAssetPreview(controlName);
    if (controlName === 'logo_url') {
      this.logoPreview.set(null);
    } else {
      this.faviconPreview.set(null);
    }
    this.control(controlName).setValue('');
    this.control(controlName).markAsDirty();
    this.form.markAsDirty();
    this.hasUnsavedChanges.set(true);
  }

  async onSave(): Promise<void> {
    if (this.saving()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Revisa los campos obligatorios antes de guardar.');
      return;
    }

    this.error.set(null);

    try {
      this.uploadingAssets.set(true);
      const branding = await this.buildBrandingForSave();
      const settings = await firstValueFrom(
        this.settingsService
          .saveSettings({ branding })
          .pipe(takeUntilDestroyed(this.destroyRef)),
      );

      this.settings.set(settings);
      this.applyBranding(settings.branding);
      this.lastSaved.set(new Date());
    } catch {
      this.error.set('Error al guardar la configuración de la aplicación.');
    } finally {
      this.uploadingAssets.set(false);
    }
  }

  private async buildBrandingForSave(): Promise<OrganizationBranding> {
    const formValue = this.form.getRawValue();
    const branding = this.normalizeBranding({
      ...(this.settings()?.branding ?? {}),
      ...formValue,
    });

    const pendingLogo = this.pendingLogoUpload();
    const pendingFavicon = this.pendingFaviconUpload();

    if (pendingLogo) {
      const result = await firstValueFrom(
        this.settingsService.uploadOrganizationLogo(pendingLogo.file),
      );
      branding.logo_url = result.key;
    }

    if (pendingFavicon) {
      const result = await firstValueFrom(
        this.settingsService.uploadOrganizationFavicon(pendingFavicon.file),
      );
      branding.favicon_url = result.key;
    }

    return branding;
  }

  private revokeBrandAssetPreview(controlName: BrandingAssetControlName): void {
    if (controlName === 'logo_url') {
      const pending = this.pendingLogoUpload();
      if (pending) URL.revokeObjectURL(pending.preview);
      this.pendingLogoUpload.set(null);
      return;
    }

    const pending = this.pendingFaviconUpload();
    if (pending) URL.revokeObjectURL(pending.preview);
    this.pendingFaviconUpload.set(null);
  }

  dismissError(): void {
    this.error.set(null);
  }

  scrollToSection(sectionId: string): void {
    this.activeSection.set(sectionId);
    if (typeof document === 'undefined') return;

    const el = document.getElementById(`section-${sectionId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private loadSettings(): void {
    this.loading.set(true);
    this.error.set(null);

    this.settingsService
      .getSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.settings.set(settings);
          this.applyBranding(settings.branding);
          this.loading.set(false);

          const serviceError = this.settingsService.error();
          if (serviceError) {
            this.error.set(serviceError);
          }
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Error al cargar la configuración de la aplicación.');
        },
      });
  }

  private applyBranding(branding: OrganizationBranding): void {
    const normalized = this.normalizeBranding(branding);
    this.revokeBrandAssetPreview('logo_url');
    this.revokeBrandAssetPreview('favicon_url');
    this.logoPreview.set(normalized.logo_url || null);
    this.faviconPreview.set(normalized.favicon_url || null);
    this.form.patchValue(
      {
        name: normalized.name,
        primary_color: normalized.primary_color,
        secondary_color: normalized.secondary_color,
        accent_color: normalized.accent_color,
        logo_url: normalized.logo_url ?? '',
        favicon_url: normalized.favicon_url ?? '',
      },
      { emitEvent: false },
    );
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.formSnapshot.set(this.form.getRawValue());
    this.hasUnsavedChanges.set(false);
  }

  private discardChanges(): void {
    const current = this.settings();
    if (!current) return;
    this.applyBranding(current.branding);
    this.error.set(null);
  }

  private normalizeBranding(
    branding: Partial<OrganizationBranding>,
  ): OrganizationBranding {
    return {
      ...this.fallbackBranding,
      ...branding,
      logo_url: branding.logo_url ?? '',
      favicon_url: branding.favicon_url ?? '',
    };
  }

  private formatTime(date: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  }

  private colorControl(value: string): FormControl<string> {
    return new FormControl(value, {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.pattern(/^#[0-9A-Fa-f]{6}$/),
      ],
    });
  }
}
