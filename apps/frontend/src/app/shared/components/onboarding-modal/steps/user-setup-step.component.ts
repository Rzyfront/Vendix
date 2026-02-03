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
      /* ═══════════════════════════════════════════════════════════════
         MOBILE-FIRST STYLES - Base styles optimized for mobile
         ═══════════════════════════════════════════════════════════════ */

      .user-step {
        padding: 0;
        background: transparent;
      }

      .user-container {
        max-width: 100%;
        margin: 0;
        padding: 0 0.25rem;
      }

      /* ─────────────────────────────────────────────────────────────────
         HEADER - iOS-inspired hero section
         ───────────────────────────────────────────────────────────────── */
      .user-header {
        text-align: center;
        margin-bottom: 1rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0 1rem;
      }

      .user-icon-wrapper {
        margin-bottom: 0.875rem;
      }

      .user-icon-bg {
        width: 80px;
        height: 80px;
        background: var(--color-primary-light);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .user-icon {
        color: var(--color-primary);
      }

      .user-title {
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.375rem;
      }

      .user-subtitle {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.5;
        max-width: 280px;
      }

      /* ─────────────────────────────────────────────────────────────────
         OPTIONAL BADGE - Subtle info indicator
         ───────────────────────────────────────────────────────────────── */
      .optional-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        background: var(--color-primary-light);
        border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
        border-radius: 1.25rem;
        padding: 0.5rem 1rem;
        margin-bottom: 1rem;
      }

      .optional-icon {
        color: var(--color-primary);
      }

      .optional-text {
        color: var(--color-primary);
        font-size: 11px;
        font-weight: var(--fw-medium);
        letter-spacing: 0.02em;
      }

      /* ─────────────────────────────────────────────────────────────────
         FORM CONTAINER
         ───────────────────────────────────────────────────────────────── */
      .user-form {
        background: transparent;
        padding: 0;
        border: none;
        box-shadow: none;
      }

      /* ─────────────────────────────────────────────────────────────────
         FORM SECTIONS - iOS-style cards
         ───────────────────────────────────────────────────────────────── */
      .form-section {
        margin-bottom: 1rem;
        background: var(--color-surface);
        padding: 1rem 1.25rem;
        border-radius: 1.25rem;
        border: 1px solid var(--color-border);
      }

      .form-section:last-child {
        margin-bottom: 0;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        margin-bottom: 1rem;
        padding-bottom: 0;
        border-bottom: none;
      }

      .section-icon {
        width: 32px;
        height: 32px;
        background: var(--color-primary-light);
        border-radius: 0.625rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
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

      /* ─────────────────────────────────────────────────────────────────
         FORM GRID - Mobile-first responsive layout
         ───────────────────────────────────────────────────────────────── */
      .form-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.875rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
      }

      .form-field.full-width {
        grid-column: 1 / -1;
      }

      .form-field.half-width {
        grid-column: 1 / -1;
      }

      /* ─────────────────────────────────────────────────────────────────
         LABELS - iOS-style uppercase micro labels
         ───────────────────────────────────────────────────────────────── */
      .field-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 11px;
        font-weight: var(--fw-medium);
        color: var(--color-text-muted);
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .help-icon {
        color: var(--color-text-muted);
        cursor: help;
        position: relative;
        display: none;
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
        text-transform: none;
        letter-spacing: normal;
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
        font-size: 10px;
        font-style: normal;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        opacity: 0.7;
      }

      /* ─────────────────────────────────────────────────────────────────
         INPUTS - Compact touch targets
         ───────────────────────────────────────────────────────────────── */
      .field-input {
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        font-size: var(--fs-sm);
        transition: all var(--transition-fast) ease;
        background: var(--color-background);
        color: var(--color-text-primary);
        width: 100%;
        height: 40px;
        min-height: 40px;
        -webkit-appearance: none;
        appearance: none;
      }

      .field-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-ring);
        background: var(--color-surface);
      }

      .field-input::placeholder {
        color: var(--color-text-muted);
        opacity: 0.6;
      }

      /* Select specific styling */
      select.field-input {
        cursor: pointer;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 1rem center;
        padding-right: 2.5rem;
      }

      /* ─────────────────────────────────────────────────────────────────
         HINTS
         ───────────────────────────────────────────────────────────────── */
      .field-hint {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.375rem;
      }

      .hint-icon {
        color: var(--color-text-muted);
      }

      .hint-text {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        line-height: 1.3;
      }

      /* ═══════════════════════════════════════════════════════════════
         TABLET BREAKPOINT (640px+) - 2 columns
         ═══════════════════════════════════════════════════════════════ */
      @media (min-width: 640px) {
        .user-container {
          padding: 0;
        }

        .user-icon-bg {
          width: 72px;
          height: 72px;
        }

        .user-title {
          font-size: var(--fs-xl);
        }

        .user-subtitle {
          max-width: 320px;
        }

        .form-grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
        }

        .form-field.half-width {
          grid-column: span 1;
        }

        .field-label {
          font-size: var(--fs-xs);
        }

        .field-input {
          padding: 0.625rem 0.75rem;
          font-size: var(--fs-sm);
          height: 40px;
          min-height: 40px;
        }

        .help-icon {
          display: inline-flex;
        }

        }

      /* ═══════════════════════════════════════════════════════════════
         DESKTOP BREAKPOINT (1024px+) - 4 columns
         ═══════════════════════════════════════════════════════════════ */
      @media (min-width: 1024px) {
        .user-icon-bg {
          width: 64px;
          height: 64px;
        }

        .form-section {
          padding: 1.25rem 1.5rem;
        }

        .form-grid {
          grid-template-columns: repeat(4, 1fr);
        }

        .form-field.half-width {
          grid-column: span 2;
        }

        .field-input {
          padding: 0.5rem 0.75rem;
          height: 40px;
          min-height: 40px;
          border-radius: var(--radius-md);
        }

        select.field-input {
          padding-right: 2rem;
          background-position: right 0.75rem center;
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
              <app-icon name="user" size="40" class="user-icon"></app-icon>
            </div>
          </div>
          <div class="user-header-content">
            <h2 class="user-title">Completa tu perfil</h2>
            <p class="user-subtitle">
              Cuéntanos sobre ti para personalizar tu experiencia
            </p>
          </div>
        </div>

        <!-- Optional Badge -->
        <div class="optional-badge">
          <app-icon name="info" size="14" class="optional-icon"></app-icon>
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
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Tu primer nombre"></app-icon>
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
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Tu apellido principal"></app-icon>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="last_name"
                  placeholder="Tu apellido"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Teléfono
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Solo para notificaciones importantes"></app-icon>
                </label>
                <input
                  type="tel"
                  class="field-input"
                  formControlName="phone"
                  placeholder="+57 300 123 4567"
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
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Dirección de tu domicilio"></app-icon>
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
                  Apto, edificio, etc.
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Información adicional de dirección"></app-icon>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="address_line2"
                  placeholder="Apt 101, Torre A"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  País
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="País de residencia"></app-icon>
                </label>
                <select class="field-input" formControlName="country_code">
                  <option value="">Selecciona país</option>
                  <option
                    *ngFor="let country of countries"
                    [value]="country.code"
                  >
                    {{ country.name }}
                  </option>
                </select>
              </div>

              <div class="form-field">
                <label class="field-label">
                  Departamento
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Estado o departamento"></app-icon>
                </label>
                <select class="field-input" formControlName="state_province">
                  <option value="">Selecciona</option>
                  <option *ngFor="let dep of departments" [value]="dep.id">
                    {{ dep.name }}
                  </option>
                </select>
              </div>

              <div class="form-field">
                <label class="field-label">
                  Ciudad
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Ciudad de residencia"></app-icon>
                </label>
                <select class="field-input" formControlName="city">
                  <option value="">Selecciona</option>
                  <option *ngFor="let city of cities" [value]="city.id">
                    {{ city.name }}
                  </option>
                </select>
              </div>

              <div class="form-field">
                <label class="field-label">
                  Código postal
                  <app-icon name="help-circle" size="12" class="help-icon" data-tooltip="Código postal de tu ubicación"></app-icon>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="postal_code"
                  placeholder="110111"
                />
              </div>
            </div>
          </div>
        </form>
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
