import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  inject,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { CurrencyService } from '../../../../../../../services/currency.service';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';

export interface GeneralSettings {
  // Campos de store_settings (existentes)
  timezone: string;
  currency: string;
  language: string;
  tax_included: boolean;

  // Campos de la tabla stores (NUEVOS)
  name?: string;
  logo_url?: string | null;
  store_type?: 'physical' | 'online' | 'hybrid' | 'popup' | 'kiosko';
}

@Component({
  selector: 'app-general-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, SelectorComponent, IconComponent, ButtonComponent],
  templateUrl: './general-settings-form.component.html',
  styleUrls: ['./general-settings-form.component.scss'],
})
export class GeneralSettingsForm implements OnInit, OnChanges, OnDestroy {
  @Input() settings!: GeneralSettings;
  @Output() settingsChange = new EventEmitter<GeneralSettings>();
  @Output() pendingLogoUpload = new EventEmitter<{ file: File; preview: string } | null>();

  private currencyService = inject(CurrencyService);
  private toastService = inject(ToastService);
  logoPreview: string | null = null;
  private blobPreviewUrl: string | null = null;
  private logoInputRef: HTMLInputElement | null = null;

  form: FormGroup = new FormGroup({
    // Campos de stores
    name: new FormControl(''),
    logo_url: new FormControl(null),
    store_type: new FormControl('physical'),
    // Campos de store_settings
    timezone: new FormControl('America/Bogota'),
    currency: new FormControl('COP'),
    language: new FormControl('es'),
    tax_included: new FormControl(false),
  });

  storeTypes: SelectorOption[] = [
    { value: 'physical', label: 'Tienda Física' },
    { value: 'online', label: 'Tienda Online' },
    { value: 'hybrid', label: 'Híbrida (Física + Online)' },
    { value: 'popup', label: 'Tienda Pop-up' },
    { value: 'kiosko', label: 'Kiosco' },
  ];

  // Cargado dinámicamente desde CurrencyService
  currencies: SelectorOption[] = [];

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

  get logoUrlControl(): FormControl<string | null> {
    return this.form.get('logo_url') as FormControl<string | null>;
  }

  get storeTypeControl(): FormControl<string> {
    return this.form.get('store_type') as FormControl<string>;
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
    this.patchForm();
  }

  ngOnChanges() {
    this.patchForm();
  }

  async loadCurrencies() {
    try {
      const activeCurrencies = await this.currencyService.getActiveCurrencies();
      this.currencies = activeCurrencies.map((c) => ({
        value: c.code,
        label: `${c.name} (${c.code})`,
      }));

      // Si no hay moneda seleccionada y hay monedas disponibles, seleccionar la primera
      const currentCurrency = this.currencyControl.value;
      if (!currentCurrency && this.currencies.length > 0) {
        this.currencyControl.setValue(this.currencies[0].value as string);
      }
    } catch (error) {
      console.error('Error loading currencies:', error);
      // Fallback a monedas comunes si falla el servicio
      this.currencies = [
        { value: 'COP', label: 'Peso Colombiano (COP)' },
        { value: 'USD', label: 'Dólar Americano (USD)' },
        { value: 'EUR', label: 'Euro (EUR)' },
      ];

      // Seleccionar la primera por defecto si no hay ninguna
      if (!this.currencyControl.value) {
        this.currencyControl.setValue(this.currencies[0].value as string);
      }
    }
  }

  patchForm() {
    if (this.settings) {
      this.form.patchValue(this.settings);
      // Preserve local blob preview if user already selected a file (pending upload)
      if (!this.blobPreviewUrl) {
        this.logoPreview = this.settings.logo_url || null;
      }
    }
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  triggerLogoInput(): void {
    if (!this.logoInputRef) {
      this.logoInputRef = document.createElement('input');
      this.logoInputRef.type = 'file';
      this.logoInputRef.accept = 'image/*';
      this.logoInputRef.addEventListener('change', (e) => this.onLogoFileSelect(e));
    }
    this.logoInputRef.click();
  }

  onLogoFileSelect(event: Event): void {
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

    // Revoke previous blob URL if any
    if (this.blobPreviewUrl) {
      URL.revokeObjectURL(this.blobPreviewUrl);
    }

    // Create local preview — no S3 upload yet (lazy upload on save)
    this.blobPreviewUrl = URL.createObjectURL(file);
    this.logoPreview = this.blobPreviewUrl;
    this.pendingLogoUpload.emit({ file, preview: this.blobPreviewUrl });
    this.onFieldChange();

    input.value = '';
  }

  removeLogo(): void {
    if (this.blobPreviewUrl) {
      URL.revokeObjectURL(this.blobPreviewUrl);
      this.blobPreviewUrl = null;
    }
    this.logoPreview = null;
    this.logoUrlControl.setValue(null);
    this.pendingLogoUpload.emit(null);
    this.onFieldChange();
  }

  ngOnDestroy(): void {
    if (this.blobPreviewUrl) {
      URL.revokeObjectURL(this.blobPreviewUrl);
    }
  }
}
