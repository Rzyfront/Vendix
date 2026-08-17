import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  AddressFormFieldsComponent,
  AddressPayload,
  BadgeComponent,
  ButtonComponent,
  ColorPickerComponent,
  DialogService,
  IconComponent,
  ImageSourceModalComponent,
  InputComponent,
  ModalComponent,
  MultiSelectorComponent,
  MultiSelectorOption,
  ScrollableTab,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  TextareaComponent,
  ToggleComponent,
  TooltipComponent,
} from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/index';
import { ImageUploadService } from '../../../../../shared/services/image-upload.service';
import { dataUrlToFile } from '../../../../../shared/utils/data-url.util';

import {
  OrganizationAccountType,
  OrganizationDetail,
  OrganizationFiscalScope,
  OrganizationMode,
  OrganizationOperatingScope,
  OrganizationPrimaryAddress,
  OrganizationState,
  OrganizationUpdatePayload,
} from '../contracts/organization.contract';

/**
 * PATCH-source of truth for the super-admin organization edit modal
 * (plan §B.3).
 *
 * Loads the normalized `OrganizationDetail` from the parent's
 * `selectedOrganizationDetail()` signal, exposes four child `FormGroup`s
 * (basic / branding / ubicación / estado) and emits a typed
 * `OrganizationUpdatePayload` to the parent on submit.
 *
 * Implementation notes:
 * - Standalone, OnPush, zoneless + signals (skill `vendix-zoneless-signals`).
 * - All inputs/outputs use the signal API (`input<>()` / `output<>()`); no
 *   legacy `@Input` / `@Output` / `EventEmitter`.
 * - `populateForm` runs from an `effect` watching `organization()`; `resetForm`
 *   runs from another effect on `isOpen()` flipping to false.
 * - `addressFromOrg` mirrors the `primary_address` payload so the address
 *   child component owns its own form state (skill `vendix-address-geocoding`).
 * - Logo upload follows the store modal pattern: open
 *   `app-image-source-modal`, get a cropped data URL, upload to S3 via
 *   `ImageUploadService.uploadFile(file, 'organization_logos', ...)`, then
 *   patch the resulting key into `form.branding.logo_url` (skill
 *   `vendix-s3-storage`).
 */
@Component({
  selector: 'app-organization-edit-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    MultiSelectorComponent,
    ToggleComponent,
    ColorPickerComponent,
    AddressFormFieldsComponent,
    ImageSourceModalComponent,
    IconComponent,
    ButtonComponent,
    SpinnerComponent,
    TooltipComponent,
    BadgeComponent,
  ],
  templateUrl: './organization-edit-modal.component.html',
  styleUrls: ['./organization-edit-modal.component.scss'],
})
export class OrganizationEditModalComponent {
  /** Visibility of the modal — two-way bound to the parent via `[(isOpen)]`. */
  readonly isOpen = input<boolean>(false);

  /** Loading state — disables the save button while the parent PATCH is in flight. */
  readonly isSubmitting = input<boolean>(false);

  /**
   * Normalized detail shape returned by `GET /superadmin/organizations/:id`
   * (plan §A.3). Replaces the old `OrganizationListItem | undefined` so the
   * form has access to DIAN fields, branding aliases, primary_address and
   * the full _count.
   */
  readonly organization = input<OrganizationDetail | null>(null);

  /** Two-way bound visibility for the inner modal. */
  readonly isOpenChange = output<boolean>();

  /** Emitted when the modal transitions to open — parent uses this to lazy-load `OrganizationDetail`. */
  readonly opened = output<void>();

  /** Typed payload emitted on save. */
  readonly submit = output<OrganizationUpdatePayload>();

  /** Cancel/discard signal — parent uses it to clear `selectedOrganizationDetail`. */
  readonly cancel = output<void>();

  /** Active tab in the modal body. */
  readonly activeTab = signal<'basic' | 'branding' | 'ubicacion' | 'estado'>(
    'basic',
  );

  /** Hydrated address kept outside the form so address-form-fields owns its state. */
  readonly addressFromOrg = signal<AddressPayload | null>(null);

  /** Whether the inner `app-address-form-fields` reports valid state. */
  readonly addressValid = signal(true);

  /** Live preview values for the branding tab — update as the user types. */
  readonly logoPreviewUrl = signal<string | null>(null);
  readonly brandPrimary = signal<string>('#1A2B3C');
  readonly brandSecondary = signal<string>('#7C3AED');
  readonly brandAccent = signal<string>('#F59E0B');

  /** Logo upload flow — visibility of the image-source-modal. */
  readonly logoModalOpen = signal<boolean>(false);

  /** True while a freshly-cropped logo is uploading to S3. */
  readonly logoUploading = signal<boolean>(false);

  /** Form-dirty signal for the footer "Cambios sin guardar" indicator. */
  readonly formDirty = signal(false);

  /** Form-status signal — populated by the constructor once `form` is ready. */
  readonly formStatus = signal<'VALID' | 'INVALID' | 'PENDING' | 'DISABLED'>('VALID');

  /** Live slug preview that updates as the user types. */
  readonly slugPreviewUrl = signal<string>('');

  /** Accordion state for the partner / fraud sub-panels under the estado tab. */
  readonly partnerExpanded = signal<boolean>(false);
  readonly fraudExpanded = signal<boolean>(false);

  private readonly fb = inject(FormBuilder);
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);

  readonly tabsConfig: ScrollableTab[] = [
    { id: 'basic', label: 'Básica', icon: 'info' },
    { id: 'branding', label: 'Branding', icon: 'palette' },
    { id: 'ubicacion', label: 'Ubicación', icon: 'map-pin' },
    { id: 'estado', label: 'Estado', icon: 'power' },
  ];

  /** Selector options for DIAN/CO fields. */
  readonly documentTypeOptions: SelectorOption[] = [
    { value: '31', label: 'NIT' },
    { value: '13', label: 'Cédula de ciudadanía' },
    { value: '22', label: 'Cédula de extranjería' },
    { value: '41', label: 'Pasaporte' },
    { value: '42', label: 'Documento extranjero' },
  ];

  readonly personTypeOptions: SelectorOption[] = [
    { value: '1', label: 'Persona jurídica' },
    { value: '2', label: 'Persona natural' },
  ];

  readonly taxRegimeOptions: SelectorOption[] = [
    { value: '48', label: 'Responsable de IVA' },
    { value: '49', label: 'No responsable de IVA' },
  ];

  readonly fiscalResponsibilitiesOptions: MultiSelectorOption[] = [
    { value: 'O-13', label: 'O-13 — Gran contribuyente' },
    { value: 'O-15', label: 'O-15 — Autorretenedor' },
    { value: 'O-23', label: 'O-23 — Agente de retención IVA' },
    { value: 'O-47', label: 'O-47 — Régimen simple' },
    { value: 'R-99-PN', label: 'R-99-PN — No aplica' },
  ];

  readonly accountTypeOptions: SelectorOption[] = [
    { value: OrganizationAccountType.SINGLE_STORE, label: 'Tienda única' },
    { value: OrganizationAccountType.MULTI_STORE_ORG, label: 'Multi-tienda' },
  ];

  readonly operatingScopeOptions: SelectorOption[] = [
    { value: OrganizationOperatingScope.STORE, label: 'Por tienda' },
    { value: OrganizationOperatingScope.ORGANIZATION, label: 'A nivel organización' },
  ];

  readonly fiscalScopeOptions: SelectorOption[] = [
    { value: OrganizationFiscalScope.STORE, label: 'Por tienda' },
    { value: OrganizationFiscalScope.ORGANIZATION, label: 'A nivel organización' },
  ];

  readonly stateOptions: SelectorOption[] = [
    { value: OrganizationState.ACTIVE, label: 'Activo' },
    { value: OrganizationState.INACTIVE, label: 'Inactivo' },
    { value: OrganizationState.SUSPENDED, label: 'Suspendido' },
    { value: OrganizationState.DRAFT, label: 'Borrador' },
    { value: OrganizationState.ARCHIVED, label: 'Archivado' },
  ];

  readonly modeOptions: SelectorOption[] = [
    { value: OrganizationMode.PRODUCTION, label: 'Producción' },
    { value: OrganizationMode.DEMO, label: 'Demo' },
    { value: OrganizationMode.TEST, label: 'Test' },
  ];

  /**
   * The single source of truth for the form. Four child groups, one per tab.
   * Defaults use `null` (NOT empty strings) so validators fire on truly empty
   * input rather than passing on `''` and confusing the user later. The
   * `populateForm` effect below resets each child group whenever a new
   * `organization()` arrives.
   */
  readonly form: FormGroup = this.fb.group({
    basic: this.fb.group({
      name: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(255),
      ]),
      slug: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(255),
        Validators.pattern(/^[a-z0-9-]+$/),
      ]),
      legal_name: this.fb.control<string | null>(null, [
        Validators.maxLength(255),
      ]),
      tax_id: this.fb.control<string | null>(null, [
        Validators.maxLength(50),
      ]),
      document_type: this.fb.control<string | null>(null),
      verification_digit: this.fb.control<string | null>(null, [
        Validators.maxLength(1),
        Validators.pattern(/^[0-9A-Z]$/),
      ]),
      person_type: this.fb.control<string | null>(null),
      tax_regime: this.fb.control<string | null>(null),
      fiscal_responsibilities: this.fb.control<string[]>([]),
      ciiu_code: this.fb.control<string | null>(null, [
        Validators.maxLength(10),
      ]),
      email: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.email,
        Validators.maxLength(255),
      ]),
      phone: this.fb.control<string | null>(null, [Validators.maxLength(50)]),
      website: this.fb.control<string | null>(null, [
        Validators.maxLength(255),
      ]),
      description: this.fb.control<string | null>(null, [
        Validators.maxLength(2000),
      ]),
    }),
    branding: this.fb.group({
      logo_url: this.fb.control<string | null>(null),
      color_primary: this.fb.control<string | null>(null, [
        Validators.pattern(/^#[0-9A-F]{6}$/i),
      ]),
      color_secondary: this.fb.control<string | null>(null, [
        Validators.pattern(/^#[0-9A-F]{6}$/i),
      ]),
      color_accent: this.fb.control<string | null>(null, [
        Validators.pattern(/^#[0-9A-F]{6}$/i),
      ]),
    }),
    estado: this.fb.group({
      state: this.fb.control<string>(OrganizationState.ACTIVE, [
        Validators.required,
      ]),
      mode: this.fb.control<string>(OrganizationMode.PRODUCTION, [
        Validators.required,
      ]),
      account_type: this.fb.control<string>(OrganizationAccountType.SINGLE_STORE),
      operating_scope: this.fb.control<string>(OrganizationOperatingScope.STORE),
      fiscal_scope: this.fb.control<string>(OrganizationFiscalScope.STORE),
      is_partner: this.fb.control<boolean>(false),
      partner_settings: this.fb.control<Record<string, unknown> | null>(null),
      fraud_blocked: this.fb.control<boolean>(false),
      fraud_blocked_reason: this.fb.control<string | null>(null),
    }),
  });

  constructor() {
    // Track previous isOpen so we only emit `opened` on the false→true
    // transition (avoid re-firing on every signal touch inside @defer).
    let previousIsOpen = false;

    effect(() => {
      const open = this.isOpen();
      if (open && !previousIsOpen) {
        this.opened.emit();
      }
      previousIsOpen = open;
    });

    // When the parent assigns a new detail (lazy-loaded on modal open),
    // hydrate the form. Guarded against missing detail by nullability.
    effect(() => {
      const detail = this.organization();
      if (detail) {
        this.populateForm(detail);
      }
    });

    // When the modal hides, reset to defaults so a future open starts clean.
    effect(() => {
      if (!this.isOpen()) {
        this.resetForm();
      }
    });

    // ---- Form state bridging (skill `vendix-zoneless-signals` § Common Bugs) -

    // 1) Status → formStatus (used by `disabled: formStatus() === 'INVALID'`).
    this.formStatus.set(this.form.status);
    this.form.statusChanges.subscribe((s) => this.formStatus.set(s));

    // 2) Dirty flag → formDirty (footer "Cambios sin guardar" badge).
    this.form.statusChanges.subscribe(() => {
      this.formDirty.set(this.form.dirty);
    });

    // 3) Branding live preview — update logo/colors as the user types.
    const branding = this.form.get('branding');
    if (branding) {
      branding.valueChanges.subscribe((v: Record<string, unknown>) => {
        const logo = (v['logo_url'] as string | null) ?? null;
        this.logoPreviewUrl.set(logo && logo.trim() ? logo : null);
        const cp = v['color_primary'];
        const cs = v['color_secondary'];
        const ca = v['color_accent'];
        if (typeof cp === 'string' && /^#[0-9A-F]{6}$/i.test(cp)) {
          this.brandPrimary.set(cp);
        }
        if (typeof cs === 'string' && /^#[0-9A-F]{6}$/i.test(cs)) {
          this.brandSecondary.set(cs);
        }
        if (typeof ca === 'string' && /^#[0-9A-F]{6}$/i.test(ca)) {
          this.brandAccent.set(ca);
        }
      });
    }

    // 4) Slug live preview — `app.vendix.com/{slug}`.
    const slugCtrl = this.form.get(['basic', 'slug']);
    if (slugCtrl) {
      slugCtrl.valueChanges.subscribe((v: string | null) => {
        this.slugPreviewUrl.set((v ?? '').trim());
      });
    }
  }

  /**
   * Apply the normalized detail to the form. Mirrors plan §B.3:
   *   1) Identity + contact (basic).
   *   2) DIAN (document_type, DV, person_type, tax_regime, fiscal_responsibilities, ciiu_code).
   *   3) Branding (logo_url → live preview, color_*) from top-level aliases.
   *   4) Estado (state, mode, account_type, operating_scope, fiscal_scope, partner, fraud).
   *   5) primary_address → addressFromOrg signal.
   */
  private populateForm(detail: OrganizationDetail): void {
    const safeStr = (v: unknown): string | null => {
      if (v == null) return null;
      if (typeof v !== 'string') return null;
      return v.trim() ? v.trim() : null;
    };

    const colorPrimary = safeStr(detail.color_primary);
    const colorSecondary = safeStr(detail.color_secondary);
    const colorAccent = safeStr(detail.color_accent);
    const logoUrl = safeStr(detail.logo_url);

    const primaryAddress =
      detail.primary_address ?? null;

    this.form.patchValue(
      {
        basic: {
          name: detail.name ?? null,
          slug: detail.slug ?? null,
          legal_name: safeStr(detail.legal_name),
          tax_id: safeStr(detail.tax_id),
          document_type: safeStr(detail.document_type),
          verification_digit: safeStr(detail.verification_digit),
          person_type: safeStr(detail.person_type),
          tax_regime: safeStr(detail.tax_regime),
          fiscal_responsibilities: Array.isArray(detail.fiscal_responsibilities)
            ? detail.fiscal_responsibilities
            : [],
          ciiu_code: safeStr(detail.ciiu_code),
          email: safeStr(detail.email),
          phone: safeStr(detail.phone),
          website: safeStr(detail.website),
          description: safeStr(detail.description),
        },
        branding: {
          logo_url: logoUrl,
          color_primary: colorPrimary,
          color_secondary: colorSecondary,
          color_accent: colorAccent,
        },
        estado: {
          state: (detail.status as OrganizationState) ?? OrganizationState.ACTIVE,
          mode: (detail.mode as OrganizationMode) ?? OrganizationMode.PRODUCTION,
          account_type:
            (detail.account_type as OrganizationAccountType) ??
            OrganizationAccountType.SINGLE_STORE,
          operating_scope:
            (detail.operating_scope as OrganizationOperatingScope) ??
            OrganizationOperatingScope.STORE,
          fiscal_scope:
            (detail.fiscal_scope as OrganizationFiscalScope) ??
            OrganizationFiscalScope.STORE,
          is_partner: detail.is_partner ?? false,
          partner_settings: detail.partner_settings ?? null,
          fraud_blocked: detail.fraud_blocked ?? false,
          fraud_blocked_reason: safeStr(detail.fraud_blocked_reason),
        },
      },
      { emitEvent: false },
    );

    // The address child component owns its own form, mirror the snapshot
    // through the dedicated signal so it can `patchValue` on init.
    this.addressFromOrg.set(primaryAddress ? this.toAddressPayload(primaryAddress) : null);

    // Seed the live-preview signals so the brand card and slug preview are
    // correct on the very first render (without waiting for the user to type).
    this.logoPreviewUrl.set(logoUrl);
    this.brandPrimary.set(colorPrimary ?? '#1A2B3C');
    this.brandSecondary.set(colorSecondary ?? '#7C3AED');
    this.brandAccent.set(colorAccent ?? '#F59E0B');
    this.slugPreviewUrl.set((detail.slug ?? '').trim());
    this.formDirty.set(false);

    // Reset advanced panels — they only expand when the user explicitly
    // opens them after seeing the partner/fraud gates.
    this.partnerExpanded.set(detail.is_partner ?? false);
    this.fraudExpanded.set(detail.fraud_blocked ?? false);

    // Trigger validation re-runs after a programmatic hydration.
    this.form.updateValueAndValidity({ emitEvent: false });
    Object.values(this.form.controls).forEach((ctrl) =>
      ctrl.updateValueAndValidity({ emitEvent: false }),
    );
  }

  /** Convert `OrganizationPrimaryAddress` to the `AddressPayload` shape the form component expects. */
  private toAddressPayload(addr: OrganizationPrimaryAddress): AddressPayload {
    const lat =
      typeof addr.latitude === 'number'
        ? addr.latitude
        : addr.latitude != null
        ? Number(addr.latitude)
        : null;
    const lng =
      typeof addr.longitude === 'number'
        ? addr.longitude
        : addr.longitude != null
        ? Number(addr.longitude)
        : null;
    return {
      address_line1: addr.address_line1 ?? null,
      address_line2: addr.address_line2 ?? null,
      city: addr.city ?? null,
      state_province: addr.state_province ?? null,
      country_code: addr.country_code ?? 'CO',
      postal_code: addr.postal_code ?? null,
      phone_number: addr.phone_number ?? null,
      latitude: Number.isFinite(lat) ? (lat as number) : null,
      longitude: Number.isFinite(lng) ? (lng as number) : null,
      municipality_code: addr.municipality_code ?? null,
    };
  }

  /** Reset to fresh defaults. Called from the `isOpen === false` effect. */
  private resetForm(): void {
    this.form.reset({
      basic: {
        name: null,
        slug: null,
        legal_name: null,
        tax_id: null,
        document_type: null,
        verification_digit: null,
        person_type: null,
        tax_regime: null,
        fiscal_responsibilities: [],
        ciiu_code: null,
        email: null,
        phone: null,
        website: null,
        description: null,
      },
      branding: {
        logo_url: null,
        color_primary: null,
        color_secondary: null,
        color_accent: null,
      },
      estado: {
        state: OrganizationState.ACTIVE,
        mode: OrganizationMode.PRODUCTION,
        account_type: OrganizationAccountType.SINGLE_STORE,
        operating_scope: OrganizationOperatingScope.STORE,
        fiscal_scope: OrganizationFiscalScope.STORE,
        is_partner: false,
        partner_settings: null,
        fraud_blocked: false,
        fraud_blocked_reason: null,
      },
    });

    this.addressFromOrg.set(null);

    // Clear the live-preview signals so a future open starts from the
    // default placeholders rather than lingering values.
    this.logoPreviewUrl.set(null);
    this.brandPrimary.set('#1A2B3C');
    this.brandSecondary.set('#7C3AED');
    this.brandAccent.set('#F59E0B');
    this.slugPreviewUrl.set('');
    this.formDirty.set(false);
    this.partnerExpanded.set(false);
    this.fraudExpanded.set(false);
  }

  /** Handler wired to `app-address-form-fields (addressChange)`. */
  onAddressChange(_payload: AddressPayload): void {
    // The address child component owns its own form state; nothing else to
    // mirror here. The submit step reads `addressFromOrg()` directly.
  }

  onAddressValid(valid: boolean): void {
    this.addressValid.set(valid);
  }

  /**
   * Convert any falsy value or empty string to `undefined` so the DTO field
   * is omitted from the JSON payload entirely. Critical for numeric fields
   * like `latitude` / `longitude` — Nest's `@IsNumber()` rejects empty
   * strings with "must be a number conforming to the specified constraints".
   */
  private toOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Same as `toOptionalNumber` but for arbitrary strings. */
  private toOptionalString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t === '' ? undefined : t;
  }

  /** Confirm and emit. */
  async onSubmit(): Promise<void> {
    this.form.markAllAsTouched();
    if (!this.addressValid()) {
      this.toastService.error('La dirección está incompleta', 'Validación');
      this.activeTab.set('ubicacion');
      return;
    }
    if (this.formStatus() === 'INVALID') {
      this.toastService.error('Revisa los campos marcados', 'Validación');
      return;
    }

    const detail = this.organization();
    if (!detail) return;

    const value = this.form.value as {
      basic: {
        name: string | null;
        slug: string | null;
        legal_name: string | null;
        tax_id: string | null;
        document_type: string | null;
        verification_digit: string | null;
        person_type: string | null;
        tax_regime: string | null;
        fiscal_responsibilities: string[];
        ciiu_code: string | null;
        email: string | null;
        phone: string | null;
        website: string | null;
        description: string | null;
      };
      branding: {
        logo_url: string | null;
        color_primary: string | null;
        color_secondary: string | null;
        color_accent: string | null;
      };
      estado: {
        state: OrganizationState;
        mode: OrganizationMode;
        account_type: OrganizationAccountType;
        operating_scope: OrganizationOperatingScope;
        fiscal_scope: OrganizationFiscalScope;
        is_partner: boolean;
        partner_settings: Record<string, unknown> | null;
        fraud_blocked: boolean;
        fraud_blocked_reason: string | null;
      };
    };

    const newFiscalScope = value.estado.fiscal_scope;
    const oldFiscalScope = detail.fiscal_scope;
    if (newFiscalScope && oldFiscalScope && newFiscalScope !== oldFiscalScope) {
      const confirmed = await this.dialogService.confirm({
        title: 'Cambiar alcance fiscal',
        message:
          'Cambiar el alcance fiscal de la organización puede requerir reconfigurar la DIAN (numeración, certificados, razones sociales). ¿Continuar?',
        confirmText: 'Cambiar alcance fiscal',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      });
      if (!confirmed) return;
    }

    const address = this.addressFromOrg();

    const payload: OrganizationUpdatePayload = {
      name: value.basic.name ?? undefined,
      slug: value.basic.slug ?? undefined,
      legal_name: this.toOptionalString(value.basic.legal_name),
      tax_id: this.toOptionalString(value.basic.tax_id),
      document_type: this.toOptionalString(value.basic.document_type),
      verification_digit: this.toOptionalString(value.basic.verification_digit),
      person_type: this.toOptionalString(value.basic.person_type),
      tax_regime: this.toOptionalString(value.basic.tax_regime),
      fiscal_responsibilities:
        value.basic.fiscal_responsibilities &&
        value.basic.fiscal_responsibilities.length > 0
          ? value.basic.fiscal_responsibilities
          : undefined,
      ciiu_code: this.toOptionalString(value.basic.ciiu_code),
      email: value.basic.email ?? undefined,
      phone: this.toOptionalString(value.basic.phone),
      website: this.toOptionalString(value.basic.website),
      description: this.toOptionalString(value.basic.description),
      logo_url: this.toOptionalString(value.branding.logo_url),
      color_primary: this.toOptionalString(value.branding.color_primary),
      color_secondary: this.toOptionalString(value.branding.color_secondary),
      color_accent: this.toOptionalString(value.branding.color_accent),
      state: value.estado.state,
      mode: value.estado.mode,
      account_type: value.estado.account_type,
      operating_scope: value.estado.operating_scope,
      fiscal_scope: value.estado.fiscal_scope,
      is_partner: value.estado.is_partner,
      partner_settings:
        value.estado.is_partner && value.estado.partner_settings
          ? value.estado.partner_settings
          : undefined,
      fraud_blocked: value.estado.fraud_blocked,
      fraud_blocked_reason: value.estado.fraud_blocked
        ? this.toOptionalString(value.estado.fraud_blocked_reason)
        : undefined,
    };

    // Address subset — routed to the primary `addresses` row server-side.
    if (address && address.address_line1) {
      payload.address_line1 = address.address_line1 ?? undefined;
      payload.address_line2 = this.toOptionalString(address.address_line2);
      payload.city = address.city ?? undefined;
      payload.state_province = this.toOptionalString(address.state_province);
      payload.country_code = address.country_code ?? undefined;
      payload.municipality_code = this.toOptionalString(address.municipality_code);
      payload.postal_code = this.toOptionalString(address.postal_code);
      payload.latitude = this.toOptionalNumber(address.latitude);
      payload.longitude = this.toOptionalNumber(address.longitude);
    }

    this.submit.emit(payload);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  /** Open the image-source-modal so the user can pick / crop / upload a logo. */
  openLogoUpload(): void {
    this.logoModalOpen.set(true);
  }

  /** Clear the current logo from the form + live preview. */
  clearLogo(): void {
    this.form.get(['branding', 'logo_url'])?.setValue(null);
    this.logoPreviewUrl.set(null);
  }

  /**
   * Handler wired to `app-image-source-modal (imageEdited)`. The modal emits
   * a cropped data URL (image/webp). If the value is already an http(s) URL
   * (e.g. when the user pasted one and we forwarded it), patch it directly.
   * Otherwise upload to S3 first, then patch the resulting key.
   */
  onLogoUploaded(value: string): void {
    if (!value) return;

    // Already a hosted URL — skip the upload round-trip.
    if (/^https?:\/\//.test(value)) {
      this.form.get(['branding', 'logo_url'])?.setValue(value);
      this.form.get(['branding', 'logo_url'])?.markAsDirty();
      this.logoPreviewUrl.set(value);
      return;
    }

    const orgId = this.organization()?.id;
    if (!orgId) {
      this.toastService.error('No se pudo identificar la organización a editar');
      return;
    }

    let file: File;
    try {
      file = dataUrlToFile(value, `org-logo-${Date.now()}.webp`);
    } catch (_err) {
      this.toastService.error('No se pudo preparar el logo');
      return;
    }

    this.logoUploading.set(true);
    this.imageUploadService
      .uploadFile(file, 'organization_logos')
      .subscribe({
        next: (result) => {
          const storedKey = result?.key ?? result?.url ?? null;
          if (storedKey) {
            this.form.get(['branding', 'logo_url'])?.setValue(storedKey);
            this.form.get(['branding', 'logo_url'])?.markAsDirty();
            this.logoPreviewUrl.set(storedKey);
            this.toastService.success('Logo actualizado');
          } else {
            this.toastService.error('No se pudo obtener la URL del logo');
          }
          this.logoUploading.set(false);
        },
        error: (_err) => {
          this.toastService.error('No se pudo subir el logo');
          this.logoUploading.set(false);
        },
      });
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId as 'basic' | 'branding' | 'ubicacion' | 'estado');
  }

  togglePartner(): void {
    this.partnerExpanded.update((v) => !v);
  }

  toggleFraud(): void {
    this.fraudExpanded.update((v) => !v);
  }

  /**
   * Format a partner_settings key/value JSON for display in the read-only
   * summary. Falls back to "—" when the value is missing.
   */
  formatPartnerSettings(settings: Record<string, unknown> | null | undefined): string {
    if (!settings || Object.keys(settings).length === 0) return '—';
    return Object.entries(settings)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ');
  }
}
