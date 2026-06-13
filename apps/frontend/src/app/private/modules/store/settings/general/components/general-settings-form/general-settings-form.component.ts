import {
  Component,
  OnInit,
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
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import {
  STORE_INDUSTRIES,
  StoreIndustry,
  getModulesHiddenByIndustries,
} from '../../../../../../../shared/constants/industry-modules.constant';
import {
  APP_MODULES,
  AppModule,
} from '../../../../../../../shared/constants/app-modules.constant';
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

interface PanelUiEntry {
  key: string;
  label: string;
  description?: string;
  isParent: boolean;
}

@Component({
  selector: 'app-general-settings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    MultiSelectorComponent,
    SettingToggleComponent,
    ModalComponent,
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

  private readonly storeModules: PanelUiEntry[] = (
    APP_MODULES.STORE_ADMIN as AppModule[]
  ).flatMap((module) => {
    const parent: PanelUiEntry = {
      key: module.key,
      label: module.label,
      description: module.description,
      isParent: !!module.isParent,
    };
    const children: PanelUiEntry[] = (module.children ?? []).map((child) => ({
      key: child.key,
      label: child.label,
      description: child.description,
      isParent: false,
    }));
    return [parent, ...children];
  });

  readonly modules: ReadonlyArray<PanelUiEntry> = this.storeModules;

  // Vistas agrupadas (estructura anidada) para el layout tipo árbol del modal.
  // El form sigue siendo plano (panelUiForm por key); esto solo organiza el render.
  private readonly rawStoreModules = APP_MODULES.STORE_ADMIN as AppModule[];
  readonly modulesWithChildren: AppModule[] = this.rawStoreModules.filter(
    (m) => !!m.isParent && (m.children?.length ?? 0) > 0,
  );
  readonly standaloneModules: AppModule[] = this.rawStoreModules.filter(
    (m) => !m.isParent || (m.children?.length ?? 0) === 0,
  );

  readonly modulesHiddenByIndustries = signal<string[]>([]);

  readonly modulesModalOpen = signal(false);
  readonly offModulesCount = signal(0);

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        const sanitized = { ...current };
        if (!Array.isArray(sanitized.industries) || sanitized.industries.length === 0) {
          sanitized.industries = ['retail'];
        }
        this.form.patchValue(sanitized, { emitEvent: false });
        this.modulesHiddenByIndustries.set(
          getModulesHiddenByIndustries(sanitized.industries),
        );
      }
    });

    effect(() => {
      const incoming = this.panelUi();
      const incomingMap = incoming?.STORE_ADMIN ?? {};
      const hidden = this.modulesHiddenByIndustries();
      const patch: Record<string, boolean> = {};
      for (const m of this.storeModules) {
        if (hidden.includes(m.key)) {
          patch[m.key] = false;
        } else {
          patch[m.key] = incomingMap[m.key] !== false;
        }
      }
      this.panelUiForm.patchValue(patch, { emitEvent: false });
      this.syncPanelUiDisabledState();
    });

    effect(() => {
      this.modulesHiddenByIndustries();
      this.syncPanelUiDisabledState();
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
  });

  panelUiForm: FormGroup = new FormGroup(
    this.storeModules.reduce<Record<string, FormControl<boolean>>>(
      (acc, m) => {
        acc[m.key] = new FormControl<boolean>(true, { nonNullable: true });
        return acc;
      },
      {},
    ),
  );

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
    this.syncPanelUiDisabledState();
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  isModuleHiddenByIndustry(key: string): boolean {
    return this.modulesHiddenByIndustries().includes(key);
  }

  isChildModule(key: string): boolean {
    return this.storeModules.some((m) => m.key === key && !m.isParent);
  }

  panelUiControl(key: string): FormControl<boolean> {
    return this.panelUiForm.get(key) as FormControl<boolean>;
  }

  onPanelUiToggle(key: string) {
    if (this.isModuleHiddenByIndustry(key)) return;
    this.emitPanelUiChange();
    this.recomputeOffCount();
  }

  // El padre gobierna a sus children: al apagarlo, los children quedan en false
  // y disabled; al encenderlo, se habilitan (salvo los ocultos por industria).
  // Los children NO gobiernan al padre.
  onParentToggle(isEnabled: boolean, parent: AppModule): void {
    for (const child of parent.children ?? []) {
      if (this.isModuleHiddenByIndustry(child.key)) continue;
      const ctrl = this.panelUiForm.get(child.key);
      if (!ctrl) continue;
      ctrl.setValue(isEnabled, { emitEvent: false });
      if (isEnabled) {
        ctrl.enable({ emitEvent: false });
      } else {
        ctrl.disable({ emitEvent: false });
      }
    }
    this.emitPanelUiChange();
    this.recomputeOffCount();
  }

  private syncPanelUiDisabledState(): void {
    const hidden = this.modulesHiddenByIndustries();
    for (const m of this.storeModules) {
      const ctrl = this.panelUiForm.get(m.key);
      if (!ctrl) continue;
      if (hidden.includes(m.key)) {
        ctrl.disable({ emitEvent: false });
        ctrl.setValue(false, { emitEvent: false });
      } else {
        ctrl.enable({ emitEvent: false });
      }
    }
    // Los children quedan disabled si su padre está apagado (valor preservado),
    // para que el árbol se lea como apagado de forma consistente.
    for (const parent of this.modulesWithChildren) {
      const parentOff = this.panelUiForm.get(parent.key)?.value === false;
      for (const child of parent.children ?? []) {
        const childCtrl = this.panelUiForm.get(child.key);
        if (!childCtrl) continue;
        if (hidden.includes(child.key)) continue; // ya disabled arriba
        if (parentOff) {
          childCtrl.disable({ emitEvent: false });
        } else {
          childCtrl.enable({ emitEvent: false });
        }
      }
    }
    this.recomputeOffCount();
  }

  private recomputeOffCount(): void {
    const hidden = this.modulesHiddenByIndustries();
    let count = 0;
    for (const m of this.storeModules) {
      if (hidden.includes(m.key)) continue;
      const ctrl = this.panelUiForm.get(m.key);
      if (ctrl && ctrl.value === false) count++;
    }
    this.offModulesCount.set(count);
  }

  private emitPanelUiChange(): void {
    const hidden = this.modulesHiddenByIndustries();
    const disabledKeys: string[] = [];
    for (const m of this.storeModules) {
      const ctrl = this.panelUiForm.get(m.key);
      if (!ctrl) continue;
      if (hidden.includes(m.key)) continue;
      if (ctrl.value === false) disabledKeys.push(m.key);
    }
    // Always emit a value (never `undefined`) so the parent's save filter
    // includes `panel_ui` in the payload. An empty `STORE_ADMIN` map has the
    // same effect as "absent" for `MenuFilterService` (it only filters on
    // `false` values), and it lets the backend's deep-merge clear any
    // previously persisted `false` entries when the user toggles a module
    // back to ON.
    const storeAdmin: Record<string, boolean> = {};
    for (const key of disabledKeys) {
      storeAdmin[key] = false;
    }
    this.panelUiChange.emit({ STORE_ADMIN: storeAdmin });
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
    }
  }
}
