import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { debounceTime, startWith, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

import {
  INDUSTRY_METADATA,
  STORE_INDUSTRIES,
} from '../../../../../shared/constants/industry-modules.constant';
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
  UserSelectComponent,
} from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/index';
import { CurrencyService } from '../../../../../services/currency.service';
import { SuperAdminUsersLookupService } from '../services/super-admin-users-lookup.service';
import { OrganizationsLookupService } from '../services/organizations-lookup.service';
import { ImageUploadService } from '../../../../../shared/services/image-upload.service';
import { dataUrlToFile } from '../../../../../shared/utils/data-url.util';
import {
  ManagerOption,
  OrganizationOption,
  StoreDetail,
  StoreIndustry,
  StoreUpdatePayload,
} from '../contracts/store.contract';

/**
 * At least one industry must be selected — mirrors the backend contract.
 * Sourced from the existing super-admin `store-create-modal.component.ts` to
 * keep validation identical between create/edit.
 */
const nonEmptyArray: ValidatorFn = (control) => {
  const v = control.value;
  return Array.isArray(v) && v.length > 0 ? null : { required: true };
};

/**
 * PATCH-source of truth for the super-admin store edit modal (plan §B.5).
 *
 * Loads the enriched `StoreDetail` from the parent's `selectedStoreDetail()`
 * signal, exposes four child `FormGroup`s (basic / branding / location /
 * status) and emits a typed `StoreUpdatePayload` to the parent on submit.
 *
 * Implementation notes:
 * - Standalone, OnPush, zoneless + signals (skill `vendix-zoneless-signals`).
 * - All inputs/outputs use the signal API (`input<>()` / `output<>()`); no
 *   legacy `@Input` / `@Output` / `EventEmitter`.
 * - The `AddressPayload` is hydrated through a dedicated signal so the
 *   address-form-fields child owns its own form state; the `location` group
 *   mirrors it for the payload emission step.
 * - `populateForm` runs from an `effect` watching `store()`; `resetForm` runs
 *   from another effect on `isOpen()` flipping to false.
 */
@Component({
  selector: 'app-store-edit-modal',
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
    UserSelectComponent,
    AddressFormFieldsComponent,
    ImageSourceModalComponent,
    IconComponent,
    ButtonComponent,
    SpinnerComponent,
    TooltipComponent,
    BadgeComponent,
  ],
  templateUrl: './store-edit-modal.component.html',
  styleUrls: ['./store-edit-modal.component.scss'],
})
export class StoreEditModalComponent {
  /** Visibility of the modal — two-way bound to the parent via `[(isOpen)]`. */
  readonly isOpen = input<boolean>(false);

  /** Loading state — disables the save button while the parent PATCH is in flight. */
  readonly isSubmitting = input<boolean>(false);

  /**
   * Enriched detail shape returned by `GET /superadmin/stores/:id` (plan §A.3).
   * Replaces the old `StoreListItem | undefined` so the form has access to
   * `manager`, `currency`, `primary_address`, `description`, `email`, etc.
   */
  readonly store = input<StoreDetail | null>(null);

  /** Two-way bound visibility for the inner modal. */
  readonly isOpenChange = output<boolean>();
  /** Emitted when the modal transitions to open — parent uses this to lazy-load `StoreDetail`. */
  readonly opened = output<void>();
  /** Typed payload emitted on save. */
  readonly submit = output<StoreUpdatePayload>();
  /** Cancel/discard signal — parent uses it to clear `selectedStoreDetail`. */
  readonly cancel = output<void>();

  /** Active tab in the modal body. */
  readonly activeTab = signal<'basic' | 'branding' | 'location' | 'status'>(
    'basic',
  );

  /** Hydrated address kept outside the form so address-form-fields owns its state. */
  readonly addressFromStore = signal<AddressPayload | null>(null);

  /** Whether the inner `app-address-form-fields` reports valid state. */
  readonly addressValid = signal(true);

  /** Free-text query for the manager user-select (wired to debounced lookup). */
  readonly managersQuery = signal('');

  /** Live preview values for the branding tab — update as the user types. */
  readonly logoPreviewUrl = signal<string | null>(null);
  readonly brandPrimary = signal<string>('#7ED7A5');
  readonly brandSecondary = signal<string>('#4A90A4');
  readonly brandAccent = signal<string>('#F5A623');

  /** Logo upload flow — visibility of the image-source-modal. */
  readonly logoModalOpen = signal<boolean>(false);

  /** True while a freshly-cropped logo is uploading to S3. */
  readonly logoUploading = signal<boolean>(false);

  /** Form-dirty signal for the footer "Cambios sin guardar" indicator. */
  readonly formDirty = signal(false);

  /** Form-status signal — populated by the constructor once `storeForm` is ready. */
  readonly formStatus = signal<'VALID' | 'INVALID' | 'PENDING' | 'DISABLED'>('VALID');

  /**
   * Live slug preview that updates as the user types. Falls back to a
   * placeholder when the slug is empty or stores the previous valid slug so
   * the URL bar never flickers between an empty and a non-empty state.
   */
  readonly slugPreviewUrl = signal<string>('');

  private readonly fb = inject(FormBuilder);
  private readonly currencySvc = inject(CurrencyService);
  private readonly orgLookup = inject(OrganizationsLookupService);
  private readonly superAdminUsersLookup = inject(SuperAdminUsersLookupService);
  private readonly dialogService = inject(DialogService);
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly toastService = inject(ToastService);

  /**
   * Static option list derived from `STORE_INDUSTRIES`. Computed once because
   * the catalog is module-level — no need to rebuild it on every render.
   */
  readonly industryOptions: MultiSelectorOption[] = STORE_INDUSTRIES.map((id) => ({
    value: id,
    label: INDUSTRY_METADATA[id].label,
  }));

  readonly tabsConfig: ScrollableTab[] = [
    { id: 'basic', label: 'Básica', icon: 'fingerprint' },
    { id: 'branding', label: 'Branding', icon: 'palette' },
    { id: 'location', label: 'Ubicación', icon: 'map-pin' },
    { id: 'status', label: 'Estado', icon: 'power' },
  ];

  /**
   * The single source of truth for the form. Four child groups, one per tab.
   * Defaults use `null` (NOT empty strings) so validators fire on truly empty
   * input rather than passing on `''` and confusing the user later. The
   * `populateForm` effect below resets each child group whenever a new
   * `store()` arrives.
   */
  readonly storeForm: FormGroup = this.fb.group({
    basic: this.fb.group({
      name: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.minLength(2),
      ]),
      slug: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.minLength(2),
        Validators.pattern(/^[a-z0-9-]+$/),
      ]),
      store_code: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.minLength(2),
      ]),
      email: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.email,
      ]),
      phone: this.fb.control<string | null>(null),
      website: this.fb.control<string | null>(null, [Validators.pattern(/^https?:\/\/.+/)]),
      domain: this.fb.control<string | null>(null),
      timezone: this.fb.control<string | null>(null),
      store_type: this.fb.control<string | null>('physical', [
        Validators.required,
      ]),
      industries: this.fb.control<StoreIndustry[]>(['retail'], {
        validators: [nonEmptyArray],
      }),
      organization_id: this.fb.control<number | null>(null, [
        Validators.required,
      ]),
      manager_user_id: this.fb.control<number | null>(null),
      description: this.fb.control<string | null>(null),
    }),
    branding: this.fb.group({
      logo_url: this.fb.control<string | null>(null),
      currency_code: this.fb.control<string | null>(null, [
        Validators.pattern(/^[A-Z]{3}$/),
      ]),
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
    location: this.fb.group({
      address_line1: this.fb.control<string | null>(null),
      address_line2: this.fb.control<string | null>(null),
      city: this.fb.control<string | null>(null),
      state_province: this.fb.control<string | null>(null),
      country_code: this.fb.control<string | null>('CO', [
        Validators.pattern(/^[A-Z]{2}$/),
      ]),
      department_code: this.fb.control<string | null>(null),
      municipality_code: this.fb.control<string | null>(null),
      postal_code: this.fb.control<string | null>(null),
      latitude: this.fb.control<number | null>(null, [
        Validators.min(-90),
        Validators.max(90),
      ]),
      longitude: this.fb.control<number | null>(null, [
        Validators.min(-180),
        Validators.max(180),
      ]),
    }),
    status: this.fb.group({
      is_active: this.fb.control<boolean>(true, [Validators.required]),
    }),
  });

  /** Selector option sources. Each is rebuilt whenever the underlying signal changes. */
  readonly organizationOptions = toSignal(
    this.orgLookup.listAll(),
    { initialValue: [] as OrganizationOption[] },
  );

  /**
   * Currencies are fetched via a Promise-returning service. We wrap the call
   * in a signal-friendly conversion via `toSignal(toObservable(...))` so the
   * selector reacts to the loading lifecycle without forcing the consumer to
   * manage subscriptions.
   */
  private readonly currenciesFetch$ = of(null).pipe(
    switchMap(() => this.currencySvc.getActiveCurrencies()),
  );
  readonly currencies = toSignal(this.currenciesFetch$, {
    initialValue: [],
  });
  readonly currencyOptions = (): SelectorOption[] =>
    (this.currencies() ?? []).map((c) => ({
      value: c.code,
      label: `${c.name} (${c.code})`,
    }));

  /** Organization options for the searchable selector. */
  readonly organizationSelectOptions = (): SelectorOption[] =>
    (this.organizationOptions() ?? []).map((o) => ({
      value: o.id,
      label: o.name,
    }));

  /**
   * Free-text `OrganizationOption[]` — open list of ALL orgs fetched by
   * `OrganizationLookupService.listAll()`. The selector is searchable so the
   * user can filter; we don't pre-filter here because the open catalog is
   * expected to be small in the super-admin console.
   */

  /**
   * Manager list — debounced free-text search via
   * `SuperAdminUsersLookupService.searchManagers`. The picker keeps its own
   * internal debounce, but we add an extra one here so the underlying lookup
   * isn't re-issued on every keystroke.
   */
  private readonly managers$ = toObservable(this.managersQuery).pipe(
    debounceTime(300),
    switchMap((term) => {
      const trimmed = (term ?? '').trim();
      if (!trimmed) return of([] as ManagerOption[]);
      return this.superAdminUsersLookup.searchManagers(trimmed);
    }),
  );
  readonly managers = toSignal(this.managers$, {
    initialValue: [] as ManagerOption[],
  });

  /**
   * Static store-type options — mirrors backend enum values verbatim. Sources
   * come from the existing super-admin list module (plan §B.5.B).
   */
  readonly storeTypeOptions: SelectorOption[] = [
    { value: 'physical', label: 'Física' },
    { value: 'online', label: 'Online' },
    { value: 'hybrid', label: 'Híbrida' },
    { value: 'popup', label: 'Temporal' },
    { value: 'kiosko', label: 'Kiosco' },
  ];

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
    // hydrate the form. Guarded against missing detail by `untracked`-style
    // nullability.
    effect(() => {
      const detail = this.store();
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

    // ---- Live preview + status bridge --------------------------------------
    // `form.status` / `form.value` are plain properties, NOT signals — read
    // them inside a `computed`/`effect` and the computed never recomputes
    // (skill `vendix-zoneless-signals` "Common Bugs"). Bridge them through
    // `statusChanges` / `valueChanges` so the template (and the save button)
    // see a signal.

    // 1) Status → formStatus (used by `disabled: formStatus() === 'INVALID'`).
    this.formStatus.set(this.storeForm.status);
    this.storeForm.statusChanges.subscribe((s) => this.formStatus.set(s));

    // 2) Dirty flag → formDirty (footer "Cambios sin guardar" badge).
    this.storeForm.statusChanges.subscribe(() => {
      this.formDirty.set(this.storeForm.dirty);
    });

    // 3) Branding live preview — update logo/colors as the user types.
    const branding = this.storeForm.get('branding');
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

    // 4) Slug live preview — `https://{slug}.vendix.com`.
    const slugCtrl = this.storeForm.get(['basic', 'slug']);
    if (slugCtrl) {
      slugCtrl.valueChanges.subscribe((v: string | null) => {
        this.slugPreviewUrl.set((v ?? '').trim());
      });
    }
  }

  /**
   * Apply the merged detail shape to the form. Mirrors the contract's
   * precedence documented in plan §B.5.B:
   *   1) Top-level normalized fields (`store.email/phone/website/...`)
   *   2) Legacy `store_settings.settings.*` fallback
   *   3) `primary_address.*` snapshot
   */
  private populateForm(detail: StoreDetail): void {
    const settings = (detail.settings ?? {}) as Record<string, unknown>;

    const primaryAddress =
      detail.primary_address ??
      detail.addresses?.find((a) => a.is_primary) ??
      detail.addresses?.[0] ??
      null;

    const safeStr = (v: unknown): string | null => {
      if (v == null) return null;
      if (typeof v !== 'string') return null;
      return v.trim() ? v.trim() : null;
    };

    const currencyCode =
      safeStr(detail.currency_code) ?? safeStr(settings['currency_code']);
    const colorPrimary =
      safeStr(detail.color_primary) ?? safeStr(settings['color_primary']);
    const colorSecondary =
      safeStr(detail.color_secondary) ?? safeStr(settings['color_secondary']);
    const colorAccent =
      safeStr(detail.color_accent) ?? safeStr(settings['color_accent']);
    const logoUrl = safeStr(detail.logo_url);

    this.storeForm.patchValue(
      {
        basic: {
          name: detail.name ?? null,
          slug: detail.slug ?? null,
          store_code: detail.store_code ?? null,
          email: safeStr(detail.email) ?? safeStr(settings['email']),
          phone: safeStr(detail.phone) ??
            safeStr(settings['phone']) ??
            primaryAddress?.phone_number ??
            null,
          website:
            safeStr(detail.website) ?? safeStr(settings['website']),
          domain: detail.domain ?? null,
          timezone: detail.timezone ?? null,
          store_type: detail.store_type ?? 'physical',
          industries:
            Array.isArray(detail.industries) && detail.industries.length > 0
              ? detail.industries
              : (['retail'] as StoreIndustry[]),
          organization_id: detail.organization_id ?? null,
          manager_user_id: detail.manager_user_id ?? detail.manager?.id ?? null,
          description:
            safeStr(detail.description) ?? safeStr(settings['description']),
        },
        branding: {
          logo_url: logoUrl,
          currency_code: currencyCode,
          color_primary: colorPrimary,
          color_secondary: colorSecondary,
          color_accent: colorAccent,
        },
        location: {
          address_line1: primaryAddress?.address_line1 ?? null,
          address_line2: primaryAddress?.address_line2 ?? null,
          city: primaryAddress?.city ?? null,
          state_province: primaryAddress?.state_province ?? null,
          country_code: (primaryAddress?.country_code ?? 'CO').toUpperCase(),
          department_code: null,
          municipality_code: primaryAddress?.municipality_code ?? null,
          postal_code: primaryAddress?.postal_code ?? null,
          latitude: primaryAddress?.latitude ?? null,
          longitude: primaryAddress?.longitude ?? null,
        },
        status: {
          is_active: detail.is_active ?? true,
        },
      },
      { emitEvent: false },
    );

    // The address child component owns its own form, mirror the snapshot
    // through the dedicated signal so it can `patchValue` on init.
    this.addressFromStore.set(
      primaryAddress
        ? {
            address_line1: primaryAddress.address_line1 ?? null,
            address_line2: primaryAddress.address_line2 ?? null,
            city: primaryAddress.city ?? null,
            state_province: primaryAddress.state_province ?? null,
            country_code: primaryAddress.country_code ?? 'CO',
            postal_code: primaryAddress.postal_code ?? null,
            phone_number: primaryAddress.phone_number ?? null,
            latitude: primaryAddress.latitude ?? null,
            longitude: primaryAddress.longitude ?? null,
            municipality_code: primaryAddress.municipality_code ?? null,
          }
        : null,
    );

    // Seed the live-preview signals so the brand card and slug preview are
    // correct on the very first render (without waiting for the user to type).
    this.logoPreviewUrl.set(logoUrl);
    this.brandPrimary.set(colorPrimary ?? '#7ED7A5');
    this.brandSecondary.set(colorSecondary ?? '#4A90A4');
    this.brandAccent.set(colorAccent ?? '#F5A623');
    this.slugPreviewUrl.set((detail.slug ?? '').trim());
    this.formDirty.set(false);

    // Trigger validation re-runs after a programmatic hydration.
    this.storeForm.updateValueAndValidity({ emitEvent: false });
    Object.values(this.storeForm.controls).forEach((ctrl) => ctrl.updateValueAndValidity({ emitEvent: false }));
  }

  /** Reset to fresh defaults. Called from the `isOpen === false` effect. */
  private resetForm(): void {
    this.storeForm.reset({
      basic: {
        name: null,
        slug: null,
        store_code: null,
        email: null,
        phone: null,
        website: null,
        domain: null,
        timezone: null,
        store_type: 'physical',
        industries: ['retail'],
        organization_id: null,
        manager_user_id: null,
        description: null,
      },
      branding: {
        logo_url: null,
        currency_code: null,
        color_primary: null,
        color_secondary: null,
        color_accent: null,
      },
      location: {
        address_line1: null,
        address_line2: null,
        city: null,
        state_province: null,
        country_code: 'CO',
        department_code: null,
        municipality_code: null,
        postal_code: null,
        latitude: null,
        longitude: null,
      },
      status: {
        is_active: true,
      },
    });
    this.addressFromStore.set(null);

    // Clear the live-preview signals so a future open starts from the
    // default placeholders rather than lingering values.
    this.logoPreviewUrl.set(null);
    this.brandPrimary.set('#7ED7A5');
    this.brandSecondary.set('#4A90A4');
    this.brandAccent.set('#F5A623');
    this.slugPreviewUrl.set('');
    this.formDirty.set(false);
  }

  /** Handler wired to `app-address-form-fields (addressChange)`. */
  onAddressChange(payload: AddressPayload): void {
    // Mirror into the location FormGroup so the persistence step reads the
    // same data the user last typed.
    this.storeForm.patchValue({
      location: {
        address_line1: payload.address_line1 ?? null,
        address_line2: payload.address_line2 ?? null,
        city: payload.city ?? null,
        state_province: payload.state_province ?? null,
        country_code: payload.country_code ?? null,
        postal_code: payload.postal_code ?? null,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        municipality_code: payload.municipality_code ?? null,
      },
    });
  }

  onAddressValid(valid: boolean): void {
    this.addressValid.set(valid);
  }

  /**
   * Convert any falsy value or empty string to `undefined` so the DTO field
   * is omitted from the JSON payload entirely. Critical for numeric fields
   * like `latitude` / `longitude` — Nest's `@IsNumber()` rejects empty
   * strings with "must be a number conforming to the specified constraints".
   * Also used for optional strings where `""` should NOT be persisted.
   */
  private toOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Confirm and emit. */
  async onSubmit(): Promise<void> {
    this.storeForm.markAllAsTouched();
    if (this.storeForm.invalid) return;

    const detail = this.store();
    if (!detail) return;

    const value = this.storeForm.value as {
      basic: {
        name: string | null;
        slug: string | null;
        store_code: string | null;
        email: string | null;
        phone: string | null;
        website: string | null;
        domain: string | null;
        timezone: string | null;
        store_type: string | null;
        industries: StoreIndustry[];
        organization_id: number | null;
        manager_user_id: number | null;
        description: string | null;
      };
      branding: {
        logo_url: string | null;
        currency_code: string | null;
        color_primary: string | null;
        color_secondary: string | null;
        color_accent: string | null;
      };
      location: {
        address_line1: string | null;
        address_line2: string | null;
        city: string | null;
        state_province: string | null;
        country_code: string | null;
        department_code: string | null;
        municipality_code: string | null;
        postal_code: string | null;
        latitude: number | null;
        longitude: number | null;
      };
      status: { is_active: boolean };
    };

    // Re-parenting guard — moving a store between organizations can break
    // billing/subscription/DIAN bindings (plan §E.9). Surface a confirmation
    // when the parent organization has actually changed.
    const newOrgId = value.basic.organization_id;
    const oldOrgId = detail.organization_id;
    if (newOrgId != null && oldOrgId !== newOrgId) {
      const orgList = this.organizationOptions() ?? [];
      const oldOrg =
        orgList.find((o) => o.id === oldOrgId)?.name ??
        `#${oldOrgId}`;
      const newOrg =
        orgList.find((o) => o.id === newOrgId)?.name ??
        `#${newOrgId}`;
      const confirmed = await this.dialogService.confirm({
        title: 'Cambiar organización',
        message: `Vas a mover esta tienda de "${oldOrg}" a "${newOrg}". Esto puede afectar facturación, suscripción y configuración DIAN. ¿Continuar?`,
        confirmText: 'Cambiar organización',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      });
      if (!confirmed) return;
    }

    const payload: StoreUpdatePayload = {
      name: value.basic.name ?? undefined,
      slug: value.basic.slug ?? undefined,
      store_code: value.basic.store_code ?? undefined,
      email: value.basic.email ?? undefined,
      phone: value.basic.phone ?? undefined,
      website: value.basic.website ?? undefined,
      domain: value.basic.domain ?? undefined,
      timezone: value.basic.timezone ?? undefined,
      store_type:
        (value.basic.store_type as StoreUpdatePayload['store_type']) ??
        detail.store_type,
      industries: Array.isArray(value.basic.industries) && value.basic.industries.length
        ? value.basic.industries
        : detail.industries,
      is_active: value.status.is_active,
      logo_url: value.branding.logo_url ?? undefined,
      currency_code: value.branding.currency_code ?? undefined,
      color_primary: value.branding.color_primary ?? undefined,
      color_secondary: value.branding.color_secondary ?? undefined,
      color_accent: value.branding.color_accent ?? undefined,
      organization_id: newOrgId ?? undefined,
      manager_user_id: value.basic.manager_user_id ?? undefined,
      description: value.basic.description ?? undefined,

      // Address subset — keep typed so the backend DTO accepts them.
      address_line1: value.location.address_line1 ?? undefined,
      address_line2: value.location.address_line2 ?? undefined,
      city: value.location.city ?? undefined,
      state_province: value.location.state_province ?? undefined,
      country_code: value.location.country_code ?? undefined,
      department_code: value.location.department_code ?? undefined,
      municipality_code: value.location.municipality_code ?? undefined,
      postal_code: value.location.postal_code ?? undefined,
      // Defensive: empty strings become `undefined` so Nest's @IsNumber()
      // doesn't reject them with "must be a number conforming to constraints".
      // Same for the address fields that hit @IsString/@Length validators.
      latitude: this.toOptionalNumber(value.location.latitude),
      longitude: this.toOptionalNumber(value.location.longitude),
    };

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
    this.storeForm.get(['branding', 'logo_url'])?.setValue(null);
    this.logoPreviewUrl.set(null);
  }

  /**
   * Handler wired to `app-image-source-modal (imageEdited)`. The modal emits a
   * cropped data URL (JPEG). If the value is already an http(s) URL (e.g.
   * when the user pasted one and we forwarded it), patch it directly.
   * Otherwise upload to S3 first, then patch the resulting URL.
   */
  onLogoUploaded(value: string): void {
    if (!value) return;

    // Already a hosted URL — skip the upload round-trip.
    if (/^https?:\/\//.test(value)) {
      this.storeForm.get(['branding', 'logo_url'])?.setValue(value);
      this.storeForm.get(['branding', 'logo_url'])?.markAsDirty();
      this.logoPreviewUrl.set(value);
      return;
    }

    const storeId = this.store()?.id;
    if (!storeId) {
      this.toastService.error('No se pudo identificar la tienda a editar');
      return;
    }

    let file: File;
    try {
      file = dataUrlToFile(value, `logo-${Date.now()}.jpg`);
    } catch (_err) {
      this.toastService.error('No se pudo preparar el logo');
      return;
    }

    this.logoUploading.set(true);
    this.imageUploadService
      .uploadFile(file, 'store_logos', { storeId })
      .subscribe({
        next: (result) => {
          const hostedUrl = result?.url ?? result?.key ?? null;
          if (hostedUrl) {
            this.storeForm.get(['branding', 'logo_url'])?.setValue(hostedUrl);
            this.storeForm.get(['branding', 'logo_url'])?.markAsDirty();
            this.logoPreviewUrl.set(hostedUrl);
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
    this.activeTab.set(tabId as 'basic' | 'branding' | 'location' | 'status');
  }
}
