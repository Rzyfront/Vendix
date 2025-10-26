import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';
import { SelectorComponent } from '../../selector/selector.component';

import {
  OrganizationConfigData,
  UserConfigData,
} from '../interfaces/onboarding.interface';

@Component({
  selector: 'app-organization-config-step',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    IconComponent,
    SelectorComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Header del Paso -->
      <div class="text-center">
        <div
          class="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-primary)]/10 rounded-full mb-4"
        >
          <app-icon
            name="building"
            [size]="32"
            class="text-[var(--color-primary)]"
          ></app-icon>
        </div>
        <h3
          class="text-[var(--fs-lg)] font-[var(--fw-semibold)] text-[var(--color-text-primary)] mb-2"
        >
          Configura tu Organización
        </h3>
        <p
          class="text-[var(--fs-sm)] text-[var(--color-text-secondary)] max-w-md mx-auto"
        >
          Define los datos de tu empresa para personalizar la plataforma
        </p>
      </div>

      <!-- Autocompletado desde Usuario -->
      <div
        *ngIf="hasUserData"
        class="bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 rounded-[var(--radius-md)] p-4"
      >
        <div class="flex items-start gap-3">
          <app-icon
            name="sparkles"
            [size]="16"
            class="text-[var(--color-primary)] mt-0.5"
          ></app-icon>
          <div class="flex-1">
            <h4
              class="text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-1"
            >
              Información autocompletada
            </h4>
            <p class="text-[var(--fs-xs)] text-[var(--color-text-secondary)]">
              Hemos prellenado algunos campos con tu información personal.
              Puedes modificarlos si lo necesitas.
            </p>
          </div>
        </div>
      </div>

      <!-- Formulario -->
      <form [formGroup]="form" class="space-y-4">
        <!-- Nombre de la Organización -->
        <div>
          <label
            class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
          >
            Nombre de la Organización *
          </label>
          <app-input
            formControlName="name"
            placeholder="Mi Empresa S.A."
            [size]="'md'"
            [error]="getErrorMessage('name')"
          ></app-input>
        </div>

        <!-- Descripción -->
        <div>
          <label
            class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
          >
            Descripción
          </label>
          <textarea
            formControlName="description"
            rows="3"
            class="w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:border-[var(--color-primary)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none"
            placeholder="Describe brevemente tu organización..."
          ></textarea>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Industria -->
          <div>
            <label
              class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
            >
              Industria
            </label>
            <app-selector
              formControlName="industry"
              [placeholder]="'Selecciona una industria'"
              [options]="industryOptions"
              [size]="'md'"
            ></app-selector>
          </div>

          <!-- Sitio Web -->
          <div>
            <label
              class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
            >
              Sitio Web
            </label>
            <app-input
              formControlName="website"
              placeholder="https://miempresa.com"
              [size]="'md'"
              [error]="getErrorMessage('website')"
            ></app-input>
          </div>
        </div>

        <!-- Teléfono -->
        <div>
          <label
            class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
          >
            Teléfono de Contacto
          </label>
          <app-input
            formControlName="phone"
            placeholder="+1 (555) 123-4567"
            [size]="'md'"
            [error]="getErrorMessage('phone')"
          ></app-input>
        </div>

        <!-- Configuración Regional -->
        <div class="border-t border-[var(--color-border)] pt-4">
          <h4
            class="text-[var(--fs-md)] font-medium text-[var(--color-text-primary)] mb-4"
          >
            Configuración Regional
          </h4>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- Zona Horaria -->
            <div>
              <label
                class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
              >
                Zona Horaria
              </label>
              <app-selector
                formControlName="timezone"
                [placeholder]="'Selecciona zona horaria'"
                [options]="timezoneOptions"
                [size]="'md'"
              ></app-selector>
            </div>

            <!-- Moneda -->
            <div>
              <label
                class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
              >
                Moneda
              </label>
              <app-selector
                formControlName="currency"
                [placeholder]="'Selecciona moneda'"
                [options]="currencyOptions"
                [size]="'md'"
              ></app-selector>
            </div>

            <!-- Idioma -->
            <div>
              <label
                class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
              >
                Idioma
              </label>
              <app-selector
                formControlName="language"
                [placeholder]="'Selecciona idioma'"
                [options]="languageOptions"
                [size]="'md'"
              ></app-selector>
            </div>
          </div>
        </div>

        <!-- Configuración de Facturación -->
        <div class="border-t border-[var(--color-border)] pt-4">
          <h4
            class="text-[var(--fs-md)] font-medium text-[var(--color-text-primary)] mb-4"
          >
            Configuración de Facturación
          </h4>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- ID Fiscal -->
            <div>
              <label
                class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
              >
                ID Fiscal / Tax ID
              </label>
              <app-input
                formControlName="tax_id"
                placeholder="123456789"
                [size]="'md'"
              ></app-input>
            </div>

            <!-- Email de Facturación -->
            <div>
              <label
                class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
              >
                Email de Facturación
              </label>
              <app-input
                formControlName="billing_email"
                placeholder="billing@empresa.com"
                [size]="'md'"
                [error]="getErrorMessage('billing_email')"
              ></app-input>
            </div>
          </div>
        </div>
      </form>

      <!-- Información Adicional -->
      <div
        class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4"
      >
        <div class="flex items-start gap-3">
          <app-icon
            name="info"
            [size]="16"
            class="text-[var(--color-primary)] mt-0.5"
          ></app-icon>
          <div class="flex-1">
            <h4
              class="text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-1"
            >
              Configuración flexible
            </h4>
            <p class="text-[var(--fs-xs)] text-[var(--color-text-secondary)]">
              Estos datos serán utilizados para configurar automáticamente tu
              tienda y dominio en los siguientes pasos. Podrás modificarlos más
              tarde en la configuración de tu organización.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      textarea {
        font-family: inherit;
        font-size: var(--fs-sm);
        line-height: 1.5;
      }

      textarea:focus {
        outline: none;
        box-shadow: 0 0 0 2px var(--color-ring);
      }
    `,
  ],
})
export class OrganizationConfigStepComponent implements OnInit, OnChanges {
  @Input() form: FormGroup;
  @Input() data: OrganizationConfigData = {
    name: '',
    description: '',
    industry: '',
    website: '',
    phone: '',
    settings: {
      timezone: 'America/New_York',
      currency: 'USD',
      language: 'es',
      date_format: 'DD/MM/YYYY',
    },
    billing: {
      tax_id: '',
      billing_email: '',
    },
  };
  @Input() userData: UserConfigData = {
    first_name: '',
    last_name: '',
    phone: '',
    bio: '',
  };
  @Output() dataChange = new EventEmitter<OrganizationConfigData>();
  @Output() validityChange = new EventEmitter<boolean>();

  // Opciones para los selectores
  industryOptions = [
    { value: 'technology', label: 'Tecnología' },
    { value: 'retail', label: 'Retail' },
    { value: 'services', label: 'Servicios' },
    { value: 'manufacturing', label: 'Manufactura' },
    { value: 'healthcare', label: 'Salud' },
    { value: 'education', label: 'Educación' },
    { value: 'finance', label: 'Finanzas' },
    { value: 'other', label: 'Otro' },
  ];

  timezoneOptions = [
    { value: 'America/New_York', label: 'Nueva York (EST)' },
    { value: 'America/Chicago', label: 'Chicago (CST)' },
    { value: 'America/Denver', label: 'Denver (MST)' },
    { value: 'America/Los_Angeles', label: 'Los Ángeles (PST)' },
    { value: 'Europe/Madrid', label: 'Madrid (CET)' },
    { value: 'Europe/London', label: 'Londres (GMT)' },
    { value: 'Asia/Tokyo', label: 'Tokio (JST)' },
  ];

  currencyOptions = [
    { value: 'USD', label: 'USD - Dólar Americano' },
    { value: 'EUR', label: 'EUR - Euro' },
    { value: 'GBP', label: 'GBP - Libra Esterlina' },
    { value: 'MXN', label: 'MXN - Peso Mexicano' },
    { value: 'ARS', label: 'ARS - Peso Argentino' },
    { value: 'COP', label: 'COP - Peso Colombiano' },
  ];

  languageOptions = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'English' },
    { value: 'pt', label: 'Português' },
  ];

  get hasUserData(): boolean {
    return !!(
      this.userData?.first_name ||
      this.userData?.last_name ||
      this.userData?.phone
    );
  }

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({});
  }

  ngOnInit(): void {
    this.initializeForm();
    this.setupFormListeners();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && changes['data'].currentValue) {
      this.updateFormData();
    }
  }

  private initializeForm(): void {
    this.form = this.fb.group({
      name: [
        this.data?.name || '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(100),
        ],
      ],
      description: [this.data?.description || '', [Validators.maxLength(500)]],
      industry: [this.data?.industry || '', []],
      website: [
        this.data?.website || '',
        [Validators.pattern(/^https?:\/\/.+/)],
      ],
      phone: [
        this.data?.phone || '',
        [
          Validators.pattern(
            /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/,
          ),
        ],
      ],
      timezone: [
        this.data?.settings?.timezone || 'America/New_York',
        [Validators.required],
      ],
      currency: [this.data?.settings?.currency || 'USD', [Validators.required]],
      language: [this.data?.settings?.language || 'es', [Validators.required]],
      tax_id: [this.data?.billing?.tax_id || '', []],
      billing_email: [
        this.data?.billing?.billing_email || '',
        [Validators.email],
      ],
    });
  }

  private setupFormListeners(): void {
    this.form.valueChanges.subscribe((values) => {
      const organizationData: OrganizationConfigData = {
        ...this.data,
        name: values.name,
        description: values.description,
        industry: values.industry,
        website: values.website,
        phone: values.phone,
        settings: {
          timezone: values.timezone,
          currency: values.currency,
          language: values.language,
          date_format: this.data?.settings?.date_format || 'DD/MM/YYYY',
        },
        billing: {
          tax_id: values.tax_id,
          billing_email: values.billing_email,
        },
      };

      this.dataChange.emit(organizationData);
      this.validityChange.emit(this.form.valid);
    });
  }

  private updateFormData(): void {
    if (this.form && this.data) {
      this.form.patchValue(
        {
          name: this.data.name,
          description: this.data.description,
          industry: this.data.industry,
          website: this.data.website,
          phone: this.data.phone,
          timezone: this.data.settings?.timezone,
          currency: this.data.settings?.currency,
          language: this.data.settings?.language,
          tax_id: this.data.billing?.tax_id,
          billing_email: this.data.billing?.billing_email,
        },
        { emitEvent: false },
      );
    }
  }

  getErrorMessage(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (!field || !field.errors) return '';

    const errors = field.errors;

    if (errors['required']) {
      return 'Este campo es requerido';
    }

    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }

    if (errors['maxlength']) {
      return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    }

    if (errors['email']) {
      return 'Email inválido';
    }

    if (errors['pattern']) {
      if (fieldName === 'website') {
        return 'URL inválida (debe comenzar con http:// o https://)';
      }
      if (fieldName === 'phone') {
        return 'Formato de teléfono inválido';
      }
      return 'Formato inválido';
    }

    return 'Campo inválido';
  }
}
