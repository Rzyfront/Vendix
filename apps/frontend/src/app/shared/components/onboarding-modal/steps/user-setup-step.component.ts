import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnInit,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IconComponent } from '../../index';
import {
  CountryService,
  Country,
  Department,
  City,
} from '../../../../services/country.service';

@Component({
  selector: 'app-user-setup-step',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .user-step {
        padding: 0;
        background: transparent;
      }

      .user-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
      }

      .user-header {
        text-align: center;
        margin-bottom: 1rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .user-icon-wrapper {
        margin-bottom: 0.75rem;
      }

      .user-icon-bg {
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-md);
      }

      .user-icon {
        color: var(--color-text-on-primary);
      }

      .user-title {
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.25rem;
      }

      .user-subtitle {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.5;
      }

      .optional-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        background: var(--color-success-light);
        border: 1px solid rgba(34, 197, 94, 0.3);
        border-radius: var(--radius-md);
        padding: 0.5rem 0.75rem;
        margin-bottom: 1rem;
      }

      .optional-icon {
        color: var(--color-success);
      }

      .optional-text {
        color: var(--color-success);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
      }

      .user-form {
        background: transparent;
        padding: 0;
        border: none;
        box-shadow: none;
      }

      .form-section {
        margin-bottom: 1.25rem;
        background: var(--color-surface);
        padding: 1rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
      }

      .form-section:last-child {
        margin-bottom: 0;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--color-border);
      }

      .section-icon {
        width: 28px;
        height: 28px;
        background: var(--color-primary-light);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .section-icon-element {
        color: var(--color-primary);
      }

      .section-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
      }

      .form-field.full-width {
        grid-column: 1 / -1;
      }

      .form-field.half-width {
        grid-column: span 2;
      }

      .field-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
        margin-bottom: 0.375rem;
      }

      .help-icon {
        color: var(--color-text-muted);
        cursor: help;
        position: relative;
        display: inline-flex;
      }

      .help-icon:hover {
        color: var(--color-primary);
      }

      .help-icon[data-tooltip]:hover::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.375rem 0.5rem;
        background: var(--color-text-primary);
        color: var(--color-surface);
        font-size: var(--fs-xs);
        font-weight: var(--fw-regular);
        border-radius: var(--radius-sm);
        white-space: nowrap;
        box-shadow: var(--shadow-md);
        z-index: 50;
        margin-bottom: 0.375rem;
        pointer-events: none;
      }

      .help-icon[data-tooltip]:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: var(--color-text-primary);
        margin-bottom: -0.125rem;
        z-index: 50;
        pointer-events: none;
      }

      .field-optional {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        font-style: italic;
      }

      .field-input {
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-size: var(--fs-sm);
        transition: all var(--transition-fast) ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        height: 2.25rem;
        width: 100%;
      }

      .field-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-ring);
      }

      .field-input::placeholder {
        color: var(--color-text-muted);
      }

      .field-hint {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.25rem;
      }

      .hint-icon {
        color: var(--color-text-muted);
      }

      .hint-text {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        line-height: 1.3;
      }

      .user-skip {
        margin-top: 1rem;
        text-align: center;
      }

      .skip-content {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        background: var(--color-warning-light);
        border: 1px solid rgba(251, 146, 60, 0.3);
        border-radius: var(--radius-md);
      }

      .skip-icon {
        color: var(--color-warning);
      }

      .skip-text {
        color: var(--color-warning);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
      }

      @media (max-width: 1024px) {
        .form-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 640px) {
        .form-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
  template: `
    <div class="step-content user-step">
      <div class="user-container">
        <!-- Header -->
        <div class="user-header">
          <div class="user-icon-wrapper">
            <div class="user-icon-bg">
              <app-icon name="user" size="48" class="user-icon"></app-icon>
            </div>
          </div>
          <div class="user-header-content">
            <h2 class="user-title">Completa tu perfil</h2>
            <p class="user-subtitle">
              Cuéntanos un poco sobre ti para personalizar tu experiencia
            </p>
          </div>
        </div>

        <!-- Optional Badge -->
        <div class="optional-badge">
          <app-icon name="info" size="16" class="optional-icon"></app-icon>
          <span class="optional-text">Todos los campos son opcionales</span>
        </div>

        <!-- User Form -->
        <form class="user-form" [formGroup]="formGroup">
          <!-- Personal Information Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="user-circle"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Información personal</h3>
            </div>

            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">
                  Nombre
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Tu primer nombre"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="first_name"
                  placeholder="Tu nombre"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Apellido
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Tu apellido principal"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="last_name"
                  placeholder="Tu apellido"
                />
              </div>

              <!-- Teléfono -->
              <div class="form-field">
                <label class="field-label">
                  Teléfono
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Solo para notificaciones importantes"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="tel"
                  class="field-input"
                  formControlName="phone"
                  placeholder="+57 123 456 7890"
                />
              </div>
            </div>
          </div>

          <!-- Address Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="map-pin"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Dirección</h3>
            </div>

            <div class="form-grid">
              <div class="form-field half-width">
                <label class="field-label">
                  Calle y número
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Dirección de tu domicilio"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="address_line1"
                  placeholder="Calle Principal 123"
                />
              </div>

              <div class="form-field half-width">
                <label class="field-label">
                  Apartamento, suite, etc.
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Información adicional de dirección"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="address_line2"
                  placeholder="Apt 101, Suite 200"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  País
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="País de residencia"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" formControlName="country_code">
                  <option value="">Selecciona</option>
                  <option
                    *ngFor="let country of countries"
                    [value]="country.code"
                  >
                    {{ country.name }}
                  </option>
                </select>
              </div>

              <!-- Departamento (Estado/Provincia) -->
              <div class="form-field">
                <label class="field-label">
                  Departamento
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Estado o departamento"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" formControlName="state_province">
                  <option value="">Selecciona un departamento</option>
                  <option *ngFor="let dep of departments" [value]="dep.id">
                    {{ dep.name }}
                  </option>
                </select>
              </div>

              <!-- Ciudad -->
              <div class="form-field">
                <label class="field-label">
                  Ciudad
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Ciudad de residencia"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" formControlName="city">
                  <option value="">Selecciona una ciudad</option>
                  <option *ngFor="let city of cities" [value]="city.id">
                    {{ city.name }}
                  </option>
                </select>
              </div>

              <!-- Código postal -->
              <div class="form-field">
                <label class="field-label">
                  Código postal
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Código postal de tu ubicación"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="postal_code"
                  placeholder="06000"
                />
              </div>
            </div>
          </div>
        </form>

        <!-- Skip Information -->
        <div class="user-skip">
          <div class="skip-content">
            <app-icon name="arrow-right" size="16" class="skip-icon"></app-icon>
            <span class="skip-text">
              Puedes completar esta información más tarde en tu perfil
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class UserSetupStepComponent implements OnInit {
  @Input() formGroup: any;
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();

  countries: Country[] = [];
  departments: Department[] = [];
  cities: City[] = [];

  constructor(
    private countryService: CountryService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.countries = this.countryService.getCountries();

    if (!this.formGroup) return;

    const countryControl = this.formGroup.get('country_code');
    const depControl = this.formGroup.get('state_province');
    const cityControl = this.formGroup.get('city');

    // Cargar departamentos al cambiar país
    countryControl.valueChanges.subscribe((code: string) => {
      if (code === 'CO') {
        this.loadDepartments();
      } else {
        this.departments = [];
        this.cities = [];
        depControl.setValue('');
        cityControl.setValue('');
        this.cdr.markForCheck();
      }
    });

    // Cargar ciudades al cambiar departamento
    depControl.valueChanges.subscribe((depId: number) => {
      if (depId) {
        this.loadCities(depId);
      } else {
        this.cities = [];
        cityControl.setValue('');
        this.cdr.markForCheck();
      }
    });

    // Si ya viene Colombia seleccionado, cargar departamentos
    if (countryControl.value === 'CO') {
      this.loadDepartments();
      // Si además hay un departamento seleccionado, cargar sus ciudades
      if (depControl.value) {
        this.loadCities(depControl.value);
      }
    }
  }

  async loadDepartments(): Promise<void> {
    this.departments = await this.countryService.getDepartments();
    this.cdr.markForCheck();
  }

  async loadCities(departmentId: number): Promise<void> {
    this.cities = await this.countryService.getCitiesByDepartment(departmentId);
    this.cdr.markForCheck();
  }
}
