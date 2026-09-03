import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  Validators,
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
import {
  INDUSTRY_METADATA,
  STORE_INDUSTRIES,
  StoreIndustry,
  getModulesHiddenByIndustries,
} from '../../../../../../../shared/constants/industry-modules.constant';
import type { PanelUISettings } from '../../../../../../../core/models/store-settings.interface';
import { CurrencyService } from '../../../../../../../services/currency.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { debounceTime } from 'rxjs';

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
  ],
  templateUrl: './general-settings-form.component.html',
  styleUrls: ['./general-settings-form.component.scss'],
})
export class GeneralSettingsForm implements OnInit {
  readonly settings = input.required<GeneralSettings>();
  readonly services = input<any>();
  readonly settingsChange = output<GeneralSettings>();

  readonly panelUi = input<PanelUISettings | undefined>(undefined);
  readonly panelUiChange = output<PanelUISettings | undefined>();

  /**
   * Valor actual del sub-grupo `services`.
   *
   * OPCIONAL a propósito: el otro consumidor de este formulario
   * (`store-configuration-modal`) sólo cablea `[settings]` y `(settingsChange)`
   * y no debe romperse ni necesitar cambios.
   *
   * Existe porque Configuración General se partió en rutas hijas: el padre ya no
   * puede leer `form.get('services')` por `viewChild` en el momento de guardar
   * —el formulario está desmontado si el usuario está en otra pestaña—, así que
   * el valor se empuja al store en cuanto cambia.
   */
  readonly servicesValueChange = output<any>();

  /**
   * Validez del formulario completo. OPCIONAL, por lo mismo que arriba.
   *
   * El padre la necesita para decidir si abortar el guardado sin tener el
   * componente montado. `form.valid` es una propiedad, no una señal, así que se
   * puentea desde `statusChanges` (más los puntos donde el patch la cambia con
   * `emitEvent: false` y no habría emisión).
   */
  readonly formValidityChange = output<boolean>();

  /**
   * Contador que el padre incrementa para pedir que el formulario marque todos
   * sus controles como touched+dirty y así se pinten los mensajes de error.
   *
   * Es un contador y no un booleano para que dos intentos de guardado seguidos
   * vuelvan a pedirlo. Arranca en 0 = nadie lo pidió, que es lo que ve el
   * consumidor que no cablea el input.
   */
  readonly markTouchedRequest = input<number>(0);

  private currencyService = inject(CurrencyService);
  private currencyFormatService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  /** Última validez emitida, para no repetir emisiones idénticas. */
  private lastEmittedValidity: boolean | null = null;

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

    // Patch the form once when the loaded settings become available.
    // Timing: the form mounts BEFORE the parent's `loadSettings` async
    // HTTP call resolves, so the first effect tick has `settings()`
    // empty. We track a flag and keep retrying until the data lands,
    // then lock the patch in. After that, subsequent settings changes
    // (from the user's own debounced settingsChange emits) are NOT
    // re-applied, which breaks the form-reset feedback cycle.
    this.hasInitiallyPatchedForm = false;
    effect(() => {
      if (this.hasInitiallyPatchedForm) return;
      const current = this.settings();
      const servicesValue = this.services();
      if (!current) return;

      this.hasInitiallyPatchedForm = true;

      const sanitized = { ...current };
      if (!Array.isArray(sanitized.industries) || sanitized.industries.length === 0) {
        sanitized.industries = ['retail'];
      }
      this.form.patchValue(sanitized, { emitEvent: false });

      const servicesGroup = this.form.get('services') as FormGroup | null;
      if (servicesGroup && servicesValue) {
        servicesGroup.patchValue(servicesValue, { emitEvent: false });

        // The patchValue above uses emitEvent: false to avoid triggering
        // a validation cascade, but the <app-services-settings-form>
        // child subscribes to state_province.valueChanges to load the
        // matching cities. Without an explicit emit, the city dropdown
        // stays empty for the pre-populated department. Re-set the value
        // here with emitEvent: true so the child's effect fires and
        // loads cities for the persisted department.
        const stateProv = servicesGroup.get('local_address.state_province') as FormControl | null;
        if (stateProv && servicesValue?.local_address?.state_province) {
          stateProv.setValue(servicesValue.local_address.state_province, { emitEvent: true });
        }
      }

      this.modulesHiddenByIndustries.set(
        getModulesHiddenByIndustries(sanitized.industries),
      );

      // El patch usa `emitEvent: false`, así que `statusChanges` NO emite y el
      // padre se quedaría con la validez previa al patch. Se publica a mano.
      this.emitFormValidity();
    });

    // El padre pide marcar touched cuando aborta un guardado por formulario
    // inválido. El contador arranca en 0 (nadie lo pidió); un valor > 0 al
    // montar es legítimo — significa que el padre navegó hasta acá justamente
    // para que se vean los errores.
    effect(() => {
      if (this.markTouchedRequest() === 0) return;
      this.markAllAsTouched(this.form);
    });

    // Propagate changes from the services sub-form up to the parent's
    // settingsChange output. The nested FormGroup's valueChanges does
    // NOT bubble automatically to the FormGroup, so we listen here.
    //
    // debounceTime(50) is critical: without it, every keystroke
    // triggered a `settingsChange.emit` → settings signal update in
    // the parent facade → `effect(() => form.patchValue(...))` cycle
    // in THIS component, which reset the input on every keystroke
    // and made typing feel laggy. With 50ms debounce, the emit only
    // fires when the user pauses typing — the cycle breaks and the
    // input stays responsive. Lower than 300ms so that "Guardar
    // Cambios" sees fresh data if clicked right after a keystroke.
    this.servicesForm.valueChanges
      .pipe(debounceTime(50))
      .subscribe(() => {
        // `services` viaja aparte de las secciones de primer nivel, así que el
        // padre lo necesita aunque el formulario completo esté inválido: sin
        // esto, un guardado desde otra pestaña persistiría el valor rancio.
        this.servicesValueChange.emit(this.servicesForm.value);
        this.emitFormValidity();
        if (this.form.valid) {
          this.settingsChange.emit(this.form.value);
        }
      });
  }

  /** Guard so the settings effect patches the form exactly once on the
   * first non-empty settings payload. After the lock, the form is the
   * source of truth and the effect short-circuits, breaking the
   * feedback cycle that was resetting user input on every keystroke. */
  private hasInitiallyPatchedForm = false;

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
    // Sub-form 'services' — kept in the FormGroup so the parent can
    // still persist `offer_home_service` and the persisted address, but
    // no longer required: the 'Servicios' card with the address inputs
    // was hidden on 2026-07-26 (see general-settings.component.html),
    // so we can't block save on fields the user can't see. If the card
    // is re-enabled in the future, re-add the Validators.required on
    // address_line1 / city / country_code below.
    services: new FormGroup({
      offer_home_service: new FormControl<boolean | null>(null),
      local_address: new FormGroup({
        address_line1: new FormControl(''),
        address_line2: new FormControl(''),
        city: new FormControl(''),
        state_province: new FormControl(''),
        country_code: new FormControl('CO'),
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
    label: INDUSTRY_METADATA[id].label,
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
    // En ngOnInit y no en el constructor: los outputs del componente todavía no
    // están cableados cuando corre el constructor y la primera emisión se
    // perdería.
    this.emitFormValidity();
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emitFormValidity());

    await this.loadCurrencies();
  }

  /** Publica `form.valid` sólo cuando cambió respecto de la última emisión. */
  private emitFormValidity(): void {
    const valid = this.form.valid;
    if (this.lastEmittedValidity === valid) return;
    this.lastEmittedValidity = valid;
    this.formValidityChange.emit(valid);
  }

  /**
   * Marca recursivamente todos los controles del formulario (y de sus
   * sub-grupos) como touched + dirty para que afloren los mensajes de error bajo
   * cada campo inválido.
   *
   * Vivía en el padre, que la invocaba a través del `viewChild` justo antes de
   * mostrar el toast de 'formulario incompleto'. Con Configuración General
   * partida en rutas hijas el padre ya no tiene esa referencia, así que la
   * responsabilidad baja al formulario y se dispara por `markTouchedRequest`.
   */
  private markAllAsTouched(form: FormGroup): void {
    form.markAllAsTouched();
    Object.values(form.controls).forEach((ctrl) => {
      if (ctrl instanceof FormGroup) {
        this.markAllAsTouched(ctrl);
      } else {
        ctrl.markAsDirty();
      }
    });
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
    this.emitFormValidity();
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
}
