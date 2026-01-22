import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';

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
  imports: [CommonModule, ReactiveFormsModule, InputComponent, ToggleComponent],
  templateUrl: './general-settings-form.component.html',
  styleUrls: ['./general-settings-form.component.scss'],
})
export class GeneralSettingsForm implements OnInit, OnChanges {
  @Input() settings!: GeneralSettings;
  @Output() settingsChange = new EventEmitter<GeneralSettings>();

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

  storeTypes = [
    { value: 'physical', label: 'Tienda Física' },
    { value: 'online', label: 'Tienda Online' },
    { value: 'hybrid', label: 'Híbrida (Física + Online)' },
    { value: 'popup', label: 'Tienda Pop-up' },
    { value: 'kiosko', label: 'Kiosco' },
  ];

  currencies = [
    { value: 'COP', label: 'Peso Colombiano (COP)' },
    { value: 'USD', label: 'Dólar Americano (USD)' },
    { value: 'EUR', label: 'Euro (EUR)' },
    { value: 'MXN', label: 'Peso Mexicano (MXN)' },
    { value: 'ARS', label: 'Peso Argentino (ARS)' },
    { value: 'PEN', label: 'Sol Peruano (PEN)' },
    { value: 'CLP', label: 'Peso Chileno (CLP)' },
  ];

  languages = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'Inglés' },
    { value: 'pt', label: 'Portugués' },
  ];

  commonTimezones = [
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
  ];

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

  ngOnInit() {
    this.patchForm();
  }

  ngOnChanges() {
    this.patchForm();
  }

  patchForm() {
    if (this.settings) {
      this.form.patchValue(this.settings);
    }
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }
}
