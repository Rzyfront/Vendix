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
import { ToggleComponent } from '../../toggle/toggle.component';

import {
  DomainConfigData,
  OrganizationConfigData,
} from '../interfaces/onboarding.interface';

@Component({
  selector: 'app-domain-config-step',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Header del Paso -->
      <div class="text-center">
        <div
          class="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-primary)]/10 rounded-full mb-4"
        >
          <app-icon
            name="globe"
            [size]="32"
            class="text-[var(--color-primary)]"
          ></app-icon>
        </div>
        <h3
          class="text-[var(--fs-lg)] font-[var(--fw-semibold)] text-[var(--color-text-primary)] mb-2"
        >
          Configura tu App
        </h3>
        <p
          class="text-[var(--fs-sm)] text-[var(--color-text-secondary)] max-w-md mx-auto"
        >
          Personaliza tu dominio y acceso a la plataforma
        </p>
      </div>

      <!-- Autocompletado desde Organización -->
      <div
        *ngIf="hasOrganizationData"
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
              Dominio sugerido
            </h4>
            <p class="text-[var(--fs-xs)] text-[var(--color-text-secondary)]">
              Hemos generado un dominio basado en el nombre de tu organización.
              Puedes modificarlo si lo necesitas.
            </p>
          </div>
        </div>
      </div>

      <!-- Formulario -->
      <form [formGroup]="form" class="space-y-4">
        <!-- Nombre del Dominio -->
        <div>
          <label
            class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
          >
            Nombre del Dominio *
          </label>
          <div class="flex gap-2">
            <app-input
              formControlName="hostname"
              placeholder="mi-empresa.vendix.app"
              [size]="'md'"
              [error]="getErrorMessage('hostname')"
              class="flex-1"
            ></app-input>
            <app-button
              variant="outline"
              size="md"
              (clicked)="checkDomainAvailability()"
              [loading]="checkingDomain"
              [disabled]="!form.get('hostname')?.value"
            >
              <app-icon name="search" [size]="16" slot="icon"></app-icon>
              Verificar
            </app-button>
          </div>

          <!-- Estado de disponibilidad -->
          <div
            *ngIf="domainAvailabilityChecked"
            class="mt-2 p-2 rounded-[var(--radius-sm)] text-[var(--fs-xs)]"
            [class]="
              domainAvailable
                ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                : 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
            "
          >
            <div class="flex items-center gap-2">
              <app-icon
                [name]="domainAvailable ? 'check-circle' : 'x-circle'"
                [size]="14"
              ></app-icon>
              <span>
                {{
                  domainAvailable
                    ? 'Dominio disponible'
                    : 'Dominio no disponible'
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- Tipo de Dominio -->
        <div>
          <label
            class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
          >
            Tipo de Dominio
          </label>
          <app-selector
            formControlName="domain_type"
            [placeholder]="'Selecciona tipo de dominio'"
            [options]="domainTypeOptions"
            [size]="'md'"
          ></app-selector>
        </div>

        <!-- Configuración SSL -->
        <div class="border-t border-[var(--color-border)] pt-4">
          <h4
            class="text-[var(--fs-md)] font-medium text-[var(--color-text-primary)] mb-4"
          >
            Configuración de Seguridad
          </h4>

          <div
            class="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]"
          >
            <div class="flex-1">
              <h5
                class="text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)]"
              >
                SSL/TLS Habilitado
              </h5>
              <p
                class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] mt-1"
              >
                Habilita HTTPS para conexiones seguras
              </p>
            </div>
            <app-toggle
              formControlName="ssl_enabled"
              (changed)="onToggleChange('ssl_enabled', $event)"
            ></app-toggle>
          </div>
        </div>

        <!-- Personalización de Marca -->
        <div class="border-t border-[var(--color-border)] pt-4">
          <h4
            class="text-[var(--fs-md)] font-medium text-[var(--color-text-primary)] mb-4"
          >
            Personalización de Marca
          </h4>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Color Primario -->
            <div>
              <label
                class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
              >
                Color Primario
              </label>
              <div class="flex gap-2">
                <input
                  type="color"
                  formControlName="primary_color"
                  class="h-10 w-20 border border-[var(--color-border)] rounded-[var(--radius-md)] cursor-pointer"
                />
                <app-input
                  formControlName="primary_color"
                  placeholder="#007bff"
                  [size]="'md'"
                  class="flex-1"
                ></app-input>
              </div>
            </div>

            <!-- Color Secundario -->
            <div>
              <label
                class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
              >
                Color Secundario
              </label>
              <div class="flex gap-2">
                <input
                  type="color"
                  formControlName="secondary_color"
                  class="h-10 w-20 border border-[var(--color-border)] rounded-[var(--radius-md)] cursor-pointer"
                />
                <app-input
                  formControlName="secondary_color"
                  placeholder="#6c757d"
                  [size]="'md'"
                  class="flex-1"
                ></app-input>
              </div>
            </div>
          </div>

          <!-- URL del Logo -->
          <div class="mt-4">
            <label
              class="block text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)] mb-2"
            >
              URL del Logo
            </label>
            <app-input
              formControlName="logo_url"
              placeholder="https://ejemplo.com/logo.png"
              [size]="'md'"
              [error]="getErrorMessage('logo_url')"
            ></app-input>
            <p class="text-[var(--fs-xs)] text-[var(--color-text-muted)] mt-1">
              Opcional: URL de tu logo personalizado
            </p>
          </div>
        </div>

        <!-- Funcionalidades -->
        <div class="border-t border-[var(--color-border)] pt-4">
          <h4
            class="text-[var(--fs-md)] font-medium text-[var(--color-text-primary)] mb-4"
          >
            Funcionalidades de la App
          </h4>

          <div class="space-y-3">
            <!-- E-commerce -->
            <div
              class="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]"
            >
              <div class="flex-1">
                <h5
                  class="text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)]"
                >
                  E-commerce
                </h5>
                <p
                  class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] mt-1"
                >
                  Habilita ventas online y catálogo de productos
                </p>
              </div>
              <app-toggle
                formControlName="ecommerce"
                (changed)="onToggleChange('ecommerce', $event)"
              ></app-toggle>
            </div>

            <!-- Inventario -->
            <div
              class="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]"
            >
              <div class="flex-1">
                <h5
                  class="text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)]"
                >
                  Gestión de Inventario
                </h5>
                <p
                  class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] mt-1"
                >
                  Control de stock y gestión de productos
                </p>
              </div>
              <app-toggle
                formControlName="inventory"
                (changed)="onToggleChange('inventory', $event)"
              ></app-toggle>
            </div>

            <!-- Analíticas -->
            <div
              class="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]"
            >
              <div class="flex-1">
                <h5
                  class="text-[var(--fs-sm)] font-medium text-[var(--color-text-primary)]"
                >
                  Analíticas y Reportes
                </h5>
                <p
                  class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] mt-1"
                >
                  Estadísticas detalladas de tu negocio
                </p>
              </div>
              <app-toggle
                formControlName="analytics"
                (changed)="onToggleChange('analytics', $event)"
              ></app-toggle>
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
              Configuración final
            </h4>
            <p class="text-[var(--fs-xs)] text-[var(--color-text-secondary)]">
              Una vez completado este paso, tu app estará lista para usar.
              Podrás modificar todas estas configuraciones más tarde en el panel
              de administración.
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

      input[type='color'] {
        cursor: pointer;
      }

      input[type='color']:focus {
        outline: none;
        box-shadow: 0 0 0 2px var(--color-ring);
      }
    `,
  ],
})
export class DomainConfigStepComponent implements OnInit, OnChanges {
  @Input() form: FormGroup;
  @Input() data: DomainConfigData = {
    hostname: '',
    domain_type: 'primary',
    is_active: true,
    ssl_enabled: false,
    settings: {
      branding: {
        primary_color: '#007bff',
        secondary_color: '#6c757d',
        logo_url: '',
      },
      features: {
        ecommerce: true,
        inventory: true,
        analytics: true,
      },
    },
  };
  @Input() organizationData: OrganizationConfigData = {
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
  @Output() dataChange = new EventEmitter<DomainConfigData>();
  @Output() validityChange = new EventEmitter<boolean>();

  // Opciones para los selectores
  domainTypeOptions = [
    { value: 'primary', label: 'Dominio Primario' },
    { value: 'secondary', label: 'Dominio Secundario' },
    { value: 'custom', label: 'Dominio Personalizado' },
  ];

  // Estado de verificación de dominio
  checkingDomain = false;
  domainAvailabilityChecked = false;
  domainAvailable = false;

  get hasOrganizationData(): boolean {
    return !!this.organizationData?.name;
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

    if (
      changes['organizationData'] &&
      changes['organizationData'].currentValue
    ) {
      this.generateSuggestedDomain();
    }
  }

  private initializeForm(): void {
    this.form = this.fb.group({
      hostname: [
        this.data?.hostname || '',
        [
          Validators.required,
          Validators.pattern(
            /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}$/,
          ),
        ],
      ],
      domain_type: [this.data?.domain_type || 'primary', [Validators.required]],
      ssl_enabled: [
        this.data?.ssl_enabled !== undefined ? this.data.ssl_enabled : false,
        [],
      ],
      primary_color: [
        this.data?.settings?.branding?.primary_color || '#007bff',
        [Validators.pattern(/^#[0-9A-Fa-f]{6}$/)],
      ],
      secondary_color: [
        this.data?.settings?.branding?.secondary_color || '#6c757d',
        [Validators.pattern(/^#[0-9A-Fa-f]{6}$/)],
      ],
      logo_url: [
        this.data?.settings?.branding?.logo_url || '',
        [Validators.pattern(/^https?:\/\/.+/)],
      ],
      ecommerce: [
        this.data?.settings?.features?.ecommerce !== undefined
          ? this.data.settings.features.ecommerce
          : true,
        [],
      ],
      inventory: [
        this.data?.settings?.features?.inventory !== undefined
          ? this.data.settings.features.inventory
          : true,
        [],
      ],
      analytics: [
        this.data?.settings?.features?.analytics !== undefined
          ? this.data.settings.features.analytics
          : true,
        [],
      ],
    });
  }

  private setupFormListeners(): void {
    this.form.valueChanges.subscribe((values) => {
      const domainData: DomainConfigData = {
        ...this.data,
        hostname: values.hostname,
        domain_type: values.domain_type,
        is_active:
          this.data?.is_active !== undefined ? this.data.is_active : true,
        ssl_enabled: values.ssl_enabled,
        settings: {
          branding: {
            primary_color: values.primary_color,
            secondary_color: values.secondary_color,
            logo_url: values.logo_url,
          },
          features: {
            ecommerce: values.ecommerce,
            inventory: values.inventory,
            analytics: values.analytics,
          },
        },
      };

      this.dataChange.emit(domainData);
      this.validityChange.emit(this.form.valid);
    });
  }

  private updateFormData(): void {
    if (this.form && this.data) {
      this.form.patchValue(
        {
          hostname: this.data.hostname,
          domain_type: this.data.domain_type,
          ssl_enabled: this.data.ssl_enabled,
          primary_color: this.data.settings?.branding?.primary_color,
          secondary_color: this.data.settings?.branding?.secondary_color,
          logo_url: this.data.settings?.branding?.logo_url,
          ecommerce: this.data.settings?.features?.ecommerce,
          inventory: this.data.settings?.features?.inventory,
          analytics: this.data.settings?.features?.analytics,
        },
        { emitEvent: false },
      );
    }
  }

  private generateSuggestedDomain(): void {
    if (this.organizationData?.name && !this.data?.hostname) {
      const baseHostname = this.organizationData.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const suggestedHostname = `${baseHostname}.vendix.app`;
      this.form.patchValue(
        { hostname: suggestedHostname },
        { emitEvent: false },
      );
    }
  }

  checkDomainAvailability(): void {
    const hostname = this.form.get('hostname')?.value;
    if (!hostname) return;

    this.checkingDomain = true;
    this.domainAvailabilityChecked = false;

    // Aquí se llamaría al servicio para verificar disponibilidad
    // Por ahora, simulamos una verificación
    setTimeout(() => {
      this.checkingDomain = false;
      this.domainAvailabilityChecked = true;
      // Simulación: dominios con "test" no están disponibles
      this.domainAvailable = !hostname.includes('test');
    }, 1500);
  }

  onToggleChange(field: string, value: boolean): void {
    // El cambio se manejará a través del form.valueChanges
  }

  getErrorMessage(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (!field || !field.errors) return '';

    const errors = field.errors;

    if (errors['required']) {
      return 'Este campo es requerido';
    }

    if (errors['pattern']) {
      if (fieldName === 'hostname') {
        return 'Formato de dominio inválido (ej: mi-empresa.vendix.app)';
      }
      if (fieldName === 'primary_color' || fieldName === 'secondary_color') {
        return 'Formato de color inválido (ej: #007bff)';
      }
      if (fieldName === 'logo_url') {
        return 'URL inválida (debe comenzar con http:// o https://)';
      }
      return 'Formato inválido';
    }

    return 'Campo inválido';
  }
}
