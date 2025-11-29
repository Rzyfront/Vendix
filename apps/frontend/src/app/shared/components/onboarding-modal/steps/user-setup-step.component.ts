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
import { CountryService, Country, Department, City } from '../../../../services/country.service';
import { InputComponent } from '../../input/input.component';

@Component({
  selector: 'app-user-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .user-step {
        padding: 1.5rem 0;
        background: #fafbfc;
        border-radius: 1rem;
        margin: -1rem;
      }

      .user-container {
        max-width: 680px;
        margin: 0 auto;
        padding: 0 1.5rem;
      }

      .user-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .user-icon-wrapper {
        margin-bottom: 1.5rem;
      }

      .user-icon-bg {
        width: 80px;
        height: 80px;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto;
        box-shadow: 0 8px 24px rgba(139, 92, 246, 0.24);
      }

      .user-icon {
        color: white;
      }

      .user-title {
        font-size: 1.75rem;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 0.5rem;
      }

      .user-subtitle {
        color: #6b7280;
        font-size: 1rem;
        line-height: 1.6;
      }

      .optional-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        margin-bottom: 2rem;
      }

      .optional-icon {
        color: #22c55e;
      }

      .optional-text {
        color: #166534;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .user-form {
        background: white;
        border-radius: 0.75rem;
        padding: 1.5rem;
        border: 1px solid #e5e7eb;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      }

      .form-section {
        margin-bottom: 2rem;
      }

      .form-section:last-child {
        margin-bottom: 0;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #f3f4f6;
      }

      .section-icon {
        width: 40px;
        height: 40px;
        background: #f3f4f6;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .section-icon-element {
        color: #8b5cf6;
      }

      .section-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
      }

      .form-field.full-width {
        grid-column: 1 / -1;
      }

      .field-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        margin-bottom: 0.5rem;
      }

      .field-optional {
        color: #9ca3af;
        font-size: 0.75rem;
        font-weight: 400;
      }

      .field-input {
        padding: 0.75rem 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        transition: all 0.2s ease;
        background: white;
      }

      .field-input:focus {
        outline: none;
        border-color: #8b5cf6;
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }

      .field-input::placeholder {
        color: #9ca3af;
      }

      .field-hint {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }

      .hint-icon {
        color: #9ca3af;
      }

      .hint-text {
        color: #6b7280;
        font-size: 0.75rem;
        line-height: 1.4;
      }

      .user-skip {
        margin-top: 1.5rem;
        text-align: center;
      }

      .skip-content {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: #fef3c7;
        border: 1px solid #fde68a;
        border-radius: 0.5rem;
      }

      .skip-icon {
        color: #d97706;
      }

      .skip-text {
        color: #92400e;
        font-size: 0.875rem;
        line-height: 1.4;
      }

      @media (max-width: 640px) {
        .user-container {
          padding: 0 1rem;
        }

        .form-grid {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .user-form {
          padding: 1rem;
        }

        .user-title {
          font-size: 1.5rem;
        }

        .section-header {
          flex-direction: column;
          text-align: center;
          gap: 0.5rem;
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
                <app-input
                  label="Teléfono"
                  formControlName="phone"
                  type="tel"
                  placeholder="+57 123 456 7890"
                  helperText="Solo para notificaciones importantes"
                  customWrapperClass="-mt-4"
                  customInputClass="!p-3 !border-2 !border-gray-300 !rounded-sm focus:!border-purple-500 focus:!ring-2 focus:!ring-purple-500/10"
                ></app-input>
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
              <div class="form-field full-width">
                <label class="field-label">
                  Calle y número
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="address_line1"
                  placeholder="Calle Principal 123"
                />
              </div>

              <div class="form-field full-width">
                <label class="field-label">
                  Apartamento, suite, etc.
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
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" formControlName="country_code">
                  <option value="">Selecciona un país</option>
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
                  <span class="field-optional">(opcional)</span>
                </label>
                <select
                  class="field-input"
                  formControlName="state_province"
                  
                >
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
                  <span class="field-optional">(opcional)</span>
                </label>
                <select
                  class="field-input"
                  formControlName="city"
                  
                >
                  <option value="">Selecciona una ciudad</option>
                  <option *ngFor="let city of cities" [value]="city.id">
                    {{ city.name }}
                  </option>
                </select>
              </div>

              <!-- Código postal -->
              <div class="form-field">
                <app-input
                  label="Código postal"
                  formControlName="postal_code"
                  type="tel"
                  placeholder="06000"
                  customWrapperClass="-mt-4"
                  customInputClass="!p-3 !border-2 !border-gray-300 !rounded-sm focus:!border-purple-500 focus:!ring-2 focus:!ring-purple-500/10"
                ></app-input>
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
    private cdr: ChangeDetectorRef
  ) {}

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


