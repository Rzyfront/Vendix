import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  ValidatorFn,
} from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';
import {
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../../../shared/components/multi-selector/multi-selector.component';
import { PanelUiModulesEditorComponent } from '../../../../../../../shared/components/panel-ui-modules-editor/panel-ui-modules-editor.component';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  STORE_INDUSTRIES,
  StoreIndustry,
  getModulesHiddenByIndustries,
} from '../../../../../../../shared/constants/industry-modules.constant';
import type { PanelUISettings } from '../../../../../../../core/models/store-settings.interface';
import { CurrencyService } from '../../../../../../../services/currency.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

export interface GeneralSettings {
  // Campos de store_settings (existentes)
  timezone: string;
  currency: string;
  language: string;
  tax_included: boolean;

  // Campos de la tabla stores
  name?: string;
  logo_url?: string | null;
  store_type?: 'physical' | 'online' | 'hybrid' | 'popup' | 'kiosko';
  industries?: StoreIndustry[];
}

const nonEmptyArray: ValidatorFn = (control) => {
  const v = control.value;
  return Array.isArray(v) && v.length > 0 ? null : { required: true };
};

@Component({
  selector: 'app-general-settings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    MultiSelectorComponent,
    PanelUiModulesEditorComponent,
    ModalComponent,
    IconComponent,
  ],
  templateUrl: './general-settings-form.component.html',
  styleUrls: ['./general-settings-form.component.scss'],
})
export class GeneralSettingsForm implements OnInit {
  readonly settings = input.required<GeneralSettings>();
  readonly settingsChange = output<GeneralSettings>();

  readonly panelUi = input<PanelUISettings | undefined>(undefined);
  readonly panelUiChange = output<PanelUISettings | undefined>();

  private currencyService = inject(CurrencyService);
  private currencyFormatService = inject(CurrencyFormatService);

  readonly modulesHiddenByIndustries = signal<string[]>([]);

  readonly modulesModalOpen = signal(false);

  /** `value` for the shared editor — derived from the store-level
   *  `panel_ui.STORE_ADMIN` map. Absent = true (allowed). */
  readonly editorValue = signal<Record<string, boolean>>({});

  /** `hiddenByIndustry` for the shared editor — only industry gating
   *  applies at the store level; no `hiddenByStore` ceiling. */
  readonly hiddenByIndustry = computed(() => this.modulesHiddenByIndustries());
  readonly hiddenByStore = signal<string[]>([]);

  /** `offModulesCount` for the "N ocultos" badge in the trigger card.
   *  Counts modules explicitly disabled by the store owner (≠ gated
   *  by industry, which is not the store's choice). */
  readonly offModulesCount = computed(() => {
    let count = 0;
    for (const v of Object.values(this.editorValue())) {
      if (v === false) count++;
    }
    return count;
  });

  constructor() {
    // Sync `panelUi()` input → `editorValue()` so the editor sees the
    // resolved store-level state (absent keys are NOT materialized here
    // — the editor treats them as `true` for its own rendering).
    effect(() => {
      const incoming = this.panelUi();
      this.editorValue.set({ ...(incoming?.STORE_ADMIN ?? {}) });
    });

    effect(() => {
      const current = this.settings();
      if (current) {
        const sanitized = { ...current };
        if (!Array.isArray(sanitized.industries) || sanitized.industries.length === 0) {
          sanitized.industries = ['retail'];
        }
        this.form.patchValue(sanitized, { emitEvent: false });

        // Explicitly set the 'services' sub-form (the patchValue
        // recursive path can leave the toggle control stale when the
        // parent re-mounts after navigation; setValue on the nested
        // FormGroup guarantees the offer_home_service control is
        // updated to the persisted value).
        const servicesGroup = this.form.get('services') as FormGroup | null;
        const servicesValue = (sanitized as any).services;
        if (servicesGroup && servicesValue) {
          servicesGroup.patchValue(servicesValue, { emitEvent: false });
        }

        this.modulesHiddenByIndustries.set(
          getModulesHiddenByIndustries(sanitized.industries),
        );
      }
    });

    // Propagate changes from the services sub-form up to the parent's
    // settingsChange output. The nested FormGroup's valueChanges does
    // NOT bubble automatically to the FormGroup, so we listen here.
    this.servicesForm.valueChanges.subscribe(() => {
      if (this.form.valid) {
        this.settingsChange.emit(this.form.value);
      }
    });
  }

  form: FormGroup = new FormGroup({
    // Campos de stores
    name: new FormControl(''),
    store_type: new FormControl('physical'),
    industries: new FormControl<string[]>(['retail'], { nonNullable: true, validators: [nonEmptyArray] }),
    // Campos de store_settings
    timezone: new FormControl('America/Bogota'),
    currency: new FormControl(
      this.currencyFormatService.currencyCode() || 'COP',
    ),
    language: new FormControl('es'),
    tax_included: new FormControl(false),
    // Sub-form 'services' — rendered as a separate card by the parent
    // (GeneralSettingsComponent) using <app-services-settings-form>.
    // offer_home_service starts as null (not 'true') so the UI does not
    // assume the feature is on when the backend has no value yet.
    // patchValue from the parent sets the real persisted value.
    services: new FormGroup({
      offer_home_service: new FormControl<boolean | null>(null),
      // Local address — always captured (required) regardless of the
      // offer_home_service toggle, because the address is the
      // dispatch origin for both 'En el local' and 'A domicilio' flows.
      local_address: new FormGroup({
        address_line1: new FormControl('', [Validators.required]),
        address_line2: new FormControl(''),
        city: new FormControl('', [Validators.required]),
        state_province: new FormControl(''),
        country_code: new FormControl('CO', [Validators.required]),
        postal_code: new FormControl(''),
      }),
    }),
  });

  /** Expose the services sub-form so the parent can pass it to the
   * standalone ServicesSettingsForm card. */
  get servicesForm(): FormGroup {
    return this.form.get('services') as FormGroup;
  }

  storeTypes: SelectorOption[] = [
    { value: 'physical', label: 'Tienda Física' },
    { value: 'online', label: 'Tienda Online' },
    { value: 'hybrid', label: 'Híbrida (Física + Online)' },
    { value: 'popup', label: 'Tienda Pop-up' },
    { value: 'kiosko', label: 'Kiosco' },
  ];

  industryOptions: MultiSelectorOption[] = STORE_INDUSTRIES.map((id) => ({
    value: id,
    label: this.getIndustryLabel(id),
  }));

  // Cargado dinámicamente desde CurrencyService
  readonly currencies = signal<SelectorOption[]>([]);

  languages: SelectorOption[] = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'Inglés' },
    { value: 'pt', label: 'Portugués' },
  ];

  commonTimezones: SelectorOption[] = [
    'America/Bogota',
    'America/Mexico_City',
    'America/Lima',
    'America/Santiago',
    'America/Argentina/Buenos_Aires',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Europe/Madrid',
    'Europe/London',
  ].map((tz) => ({ value: tz, label: tz }));

  // Typed getters for FormControls
  get nameControl(): FormControl<string> {
    return this.form.get('name') as FormControl<string>;
  }

  get storeTypeControl(): FormControl<string> {
    return this.form.get('store_type') as FormControl<string>;
  }

  get industriesControl(): FormControl<string[]> {
    return this.form.get('industries') as FormControl<string[]>;
  }

  get timezoneControl(): FormControl<string> {
    return this.form.get('timezone') as FormControl<string>;
  }

  get currencyControl(): FormControl<string> {
    return this.form.get('currency') as FormControl<string>;
  }

  get languageControl(): FormControl<string> {
    return this.form.get('language') as FormControl<string>;
  }

  get taxIncludedControl(): FormControl<boolean> {
    return this.form.get('tax_included') as FormControl<boolean>;
  }

  async ngOnInit() {
    await this.loadCurrencies();
  }

  async loadCurrencies() {
    try {
      const activeCurrencies = await this.currencyService.getActiveCurrencies();
      const mapped = activeCurrencies.map((c) => ({
        value: c.code,
        label: `${c.name} (${c.code})`,
      }));
      this.currencies.set(mapped);

      // Si no hay moneda seleccionada y hay monedas disponibles, seleccionar la primera
      const currentCurrency = this.currencyControl.value;
      if (!currentCurrency && mapped.length > 0) {
        this.currencyControl.setValue(mapped[0].value as string);
      }
    } catch (error) {
      console.error('Error loading currencies:', error);
      // Fallback a monedas comunes si falla el servicio
      const fallback: SelectorOption[] = [
        { value: 'COP', label: 'Peso Colombiano (COP)' },
        { value: 'USD', label: 'Dólar Americano (USD)' },
        { value: 'EUR', label: 'Euro (EUR)' },
      ];
      this.currencies.set(fallback);

      // Seleccionar la primera por defecto si no hay ninguna
      if (!this.currencyControl.value) {
        this.currencyControl.setValue(fallback[0].value as string);
      }
    }
  }

  onFieldChange() {
    this.modulesHiddenByIndustries.set(
      getModulesHiddenByIndustries(this.industriesControl.value),
    );
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  /**
   * Map the editor's `valueChange` (Record<key, boolean>, gated keys
   * already omitted) to the store-level payload. Semantics:
   *   - `false` = store-owner disabled (publish as `{key: false}`)
   *   - `true` = allowed (omit from the map; absent=allowed per the
   *     panel-ui contract, so re-enabling a previously disabled module
   *     also clears it via deep-merge on the backend)
   *   - The store-emit shape is always `{ STORE_ADMIN: { ... } }`.
   *   - The local `editorValue` mirror is kept in sync so the trigger
   *     card's "N ocultos" badge updates without waiting for the round-trip.
   */
  onModulesChange(next: Record<string, boolean>): void {
    this.editorValue.set({ ...next });
    const disabled: Record<string, boolean> = {};
    for (const key of Object.keys(next)) {
      if (next[key] === false) disabled[key] = false;
    }
    this.panelUiChange.emit({ STORE_ADMIN: disabled });
  }

  private getIndustryLabel(id: StoreIndustry): string {
    switch (id) {
      case 'retail':
        return 'Retail';
      case 'restaurant':
        return 'Restaurante';
      case 'manufacturing':
        return 'Manufactura';
      case 'service':
        return 'Servicios';
      case 'gym':
        return 'Gimnasio';
    }
  }
}
