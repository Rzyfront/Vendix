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
import { IconComponent, InputComponent, SelectorComponent } from '../../index';
import {
  CountryService,
  Country,
  Timezone,
  Department,
  City,
} from '../../../../services/country.service';

@Component({
  selector: 'app-store-setup-step',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IconComponent,
    InputComponent,
    SelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      /* ========================================
         MOBILE-FIRST STYLES (Base: < 640px)
         ======================================== */

      .store-step {
        padding: 0;
        background: transparent;
      }

      .store-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
      }

      /* Header - Mobile First */
      .store-header {
        text-align: center;
        margin-bottom: 1.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .store-icon-wrapper {
        margin-bottom: 1rem;
      }

      .store-icon-bg {
        width: 64px;
        height: 64px;
        background: var(--color-warning-light);
        border-radius: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .store-icon {
        color: var(--color-warning);
      }

      .store-title {
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }

      .store-subtitle {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.5;
        max-width: 280px;
      }

      /* Form Sections - Mobile First */
      .store-form {
        background: transparent;
        padding: 0;
        border: none;
        box-shadow: none;
      }

      .form-section {
        margin-bottom: 1.5rem;
        background: var(--color-surface);
        padding: 1.25rem;
        border-radius: var(--radius-xl);
        border: 1px solid var(--color-border);
      }

      .form-section:last-child {
        margin-bottom: 0;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1.25rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--color-border);
      }

      .section-icon {
        width: 32px;
        height: 32px;
        background: var(--color-warning-light);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .section-icon-element {
        color: var(--color-warning);
      }

      .section-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      /* Form Grid - Mobile First (1 column default) */
      .form-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      /* Location grid - Full width on mobile for better readability */
      .form-grid.location-grid {
        grid-template-columns: 1fr;
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

      /* Field Labels */
      .field-label {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.375rem;
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
        margin-bottom: 0.5rem;
      }

      .help-icon {
        color: var(--color-text-muted);
        cursor: help;
        position: relative;
        display: inline-flex;
      }

      .help-icon:hover {
        color: var(--color-warning);
      }

      .help-icon[data-tooltip]:hover::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.5rem 0.75rem;
        background: var(--color-text-primary);
        color: var(--color-surface);
        font-size: var(--fs-xs);
        border-radius: var(--radius-md);
        white-space: nowrap;
        box-shadow: var(--shadow-lg);
        z-index: 50;
        margin-bottom: 0.5rem;
        pointer-events: none;
      }

      .help-icon[data-tooltip]:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: var(--color-text-primary);
        margin-bottom: -0.25rem;
        z-index: 50;
        pointer-events: none;
      }

      .field-required {
        color: var(--color-error);
        font-size: var(--fs-xs);
        font-weight: var(--fw-bold);
      }

      .field-optional {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        font-style: italic;
      }

      /* Inputs - Compact touch targets */
      .field-input {
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        font-size: var(--fs-sm);
        transition: all var(--transition-fast) ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        height: 40px;
        width: 100%;
        -webkit-appearance: none;
        appearance: none;
      }

      .field-input:focus {
        outline: none;
        border-color: var(--color-warning);
        box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.15);
      }

      .field-input::placeholder {
        color: var(--color-text-muted);
      }

      /* Select arrow styling */
      select.field-input {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 0.75rem center;
        padding-right: 2.5rem;
      }

      /* ========================================
         STORE TYPE SELECTOR - Mobile First
         Horizontal list layout for touch
         ======================================== */

      .store-type-selector {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .store-type-option {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        cursor: pointer;
        transition: all var(--transition-fast) ease;
        background: var(--color-surface);
        position: relative;
      }

      .store-type-option:hover {
        border-color: var(--color-warning);
        background: var(--color-warning-light);
      }

      .store-type-option:active {
        transform: scale(0.98);
      }

      .store-type-option.active {
        border-width: 2px;
        border-color: var(--color-warning);
        background: var(--color-warning-light);
      }

      .store-type-icon {
        width: 40px;
        height: 40px;
        background: var(--color-surface);
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: var(--shadow-sm);
      }

      .store-type-option.active .store-type-icon {
        background: var(--color-surface);
      }

      .type-icon-element {
        color: var(--color-warning);
      }

      .store-type-content {
        flex: 1;
        text-align: left;
        min-width: 0;
      }

      .store-type-title {
        font-size: var(--fs-sm);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.125rem;
      }

      .store-type-description {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        line-height: 1.4;
      }

      .store-type-check {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .check-icon {
        color: var(--color-warning);
      }

      /* ========================================
         DESKTOP STYLES (≥ 640px)
         ======================================== */

      @media (min-width: 640px) {
        .store-subtitle {
          max-width: none;
        }

        .form-grid {
          grid-template-columns: repeat(2, 1fr);
        }

        .form-grid.location-grid {
          grid-template-columns: repeat(2, 1fr);
        }

        .form-field.half-width {
          grid-column: span 2;
        }

        .field-input {
          height: 40px;
          padding: 0.5rem 0.875rem;
        }

        /* Desktop: Grid layout for store types */
        .store-type-selector {
          flex-direction: row;
          gap: 1rem;
        }

        .store-type-option {
          flex-direction: column;
          flex: 1;
          text-align: center;
          gap: 0.75rem;
          padding: 1.25rem 1rem;
        }

        .store-type-content {
          text-align: center;
        }

        .store-type-check {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
        }
      }

      /* ========================================
         LARGE DESKTOP STYLES (≥ 1024px)
         ======================================== */

      @media (min-width: 1024px) {
        .form-grid.location-grid {
          grid-template-columns: repeat(4, 1fr);
        }
      }
    `,
  ],
  template: `
    <div class="step-content store-step">
      <div class="store-container">
        <!-- Header - Modern square icon style -->
        <div class="store-header">
          <div class="store-icon-wrapper">
            <div class="store-icon-bg">
              <app-icon name="store" size="36" class="store-icon"></app-icon>
            </div>
          </div>
          <div class="store-header-content">
            <h2 class="store-title">Configura tu tienda</h2>
            <p class="store-subtitle">
              Prepara tu punto de venta para empezar a vender
            </p>
          </div>
        </div>

        <!-- Store Form -->
        <form class="store-form" [formGroup]="formGroup">
          <!-- Basic Information Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="shopping-bag"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Información básica</h3>
            </div>

            <div class="form-grid">
              <div class="form-field">
                <app-input
                  formControlName="name"
                  [label]="'Nombre de la tienda'"
                  styleVariant="modern"
                  placeholder="Tienda Principal"
                  tooltipText="El nombre visible para tus clientes"
                  [required]="true"
                ></app-input>
              </div>

              <div class="form-field">
                <app-selector
                  formControlName="timezone"
                  [label]="'Zona horaria'"
                  styleVariant="modern"
                  placeholder="Selecciona una zona horaria"
                  tooltipText="Para reportes y horarios de atención"
                  [options]="timezoneOptions"
                ></app-selector>
              </div>
            </div>
          </div>

          <!-- Store Type Selection Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="layout"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Tipo de tienda</h3>
            </div>

            <div class="store-type-selector">
              <div
                class="store-type-option"
                [class.active]="formGroup.get('store_type')?.value === 'hybrid'"
                (click)="formGroup.get('store_type')?.setValue('hybrid')"
              >
                <div class="store-type-icon">
                  <app-icon
                    name="refresh-cw"
                    size="24"
                    class="type-icon-element"
                  ></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Híbrida</h4>
                  <p class="store-type-description">
                    Ventas en persona y online
                  </p>
                </div>
                <div class="store-type-check">
                  <app-icon
                    *ngIf="formGroup.get('store_type')?.value === 'hybrid'"
                    name="check-circle"
                    size="22"
                    class="check-icon"
                  ></app-icon>
                </div>
              </div>

              <div
                class="store-type-option"
                [class.active]="formGroup.get('store_type')?.value === 'online'"
                (click)="formGroup.get('store_type')?.setValue('online')"
              >
                <div class="store-type-icon">
                  <app-icon
                    name="globe"
                    size="24"
                    class="type-icon-element"
                  ></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Online</h4>
                  <p class="store-type-description">
                    Ventas por internet y delivery
                  </p>
                </div>
                <div class="store-type-check">
                  <app-icon
                    *ngIf="formGroup.get('store_type')?.value === 'online'"
                    name="check-circle"
                    size="22"
                    class="check-icon"
                  ></app-icon>
                </div>
              </div>

              <div
                class="store-type-option"
                [class.active]="formGroup.get('store_type')?.value === 'physical'"
                (click)="formGroup.get('store_type')?.setValue('physical')"
              >
                <div class="store-type-icon">
                  <app-icon
                    name="building"
                    size="24"
                    class="type-icon-element"
                  ></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Física</h4>
                  <p class="store-type-description">
                    Ventas en persona con caja física
                  </p>
                </div>
                <div class="store-type-check">
                  <app-icon
                    *ngIf="formGroup.get('store_type')?.value === 'physical'"
                    name="check-circle"
                    size="22"
                    class="check-icon"
                  ></app-icon>
                </div>
              </div>
            </div>
          </div>

          <!-- Location Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="map-pin"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Ubicación</h3>
            </div>

            <!-- Address line - full width -->
            <div class="form-grid" style="margin-bottom: 1rem;">
              <div class="form-field full-width">
                <app-input
                  formControlName="address_line1"
                  [label]="'Calle y número'"
                  styleVariant="modern"
                  placeholder="Calle Principal #123"
                  tooltipText="Dirección principal de la tienda"
                ></app-input>
              </div>
            </div>

            <!-- Location fields - 2 cols on mobile, 4 cols on desktop -->
            <div class="form-grid location-grid">
              <div class="form-field">
                <app-selector
                  formControlName="country_code"
                  [label]="'País'"
                  styleVariant="modern"
                  placeholder="Selecciona"
                  [options]="countryOptions"
                ></app-selector>
              </div>

              <div class="form-field">
                <app-selector
                  formControlName="state_province"
                  [label]="'Departamento'"
                  styleVariant="modern"
                  placeholder="Selecciona"
                  [options]="departmentOptions"
                ></app-selector>
              </div>

              <div class="form-field">
                <app-selector
                  formControlName="city"
                  [label]="'Ciudad'"
                  styleVariant="modern"
                  placeholder="Selecciona"
                  [options]="cityOptions"
                ></app-selector>
              </div>

              <div class="form-field">
                <app-input
                  formControlName="postal_code"
                  [label]="'Código postal'"
                  styleVariant="modern"
                  placeholder="06000"
                ></app-input>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class StoreSetupStepComponent implements OnInit {
  @Input() formGroup: any;
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();

  countries: Country[] = [];
  timezones: Timezone[] = [];
  departments: Department[] = [];
  cities: City[] = [];

  constructor(
    private countryService: CountryService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.countries = this.countryService.getCountries();
    this.timezones = this.countryService.getTimezones();

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
        depControl.setValue(null);
        cityControl.setValue(null);
        this.cdr.markForCheck();
      }
    });

    // Cargar ciudades al cambiar departamento
    depControl.valueChanges.subscribe((depId: any) => {
      if (depId) {
        const numericDepId = Number(depId);
        this.loadCities(numericDepId);
      } else {
        this.cities = [];
        cityControl.setValue(null);
        this.cdr.markForCheck();
      }
    });

    // Cargar datos iniciales si están presentes
    this.initializeFormData(countryControl, depControl, cityControl);
  }

  private async initializeFormData(
    countryControl: any,
    depControl: any,
    cityControl: any,
  ): Promise<void> {
    const countryValue = countryControl.value;
    const depValue = depControl.value ? Number(depControl.value) : null;
    const cityValue = cityControl.value ? Number(cityControl.value) : null;

    // Si el país es Colombia, cargar departamentos
    if (countryValue === 'CO') {
      await this.loadDepartments();
      this.cdr.markForCheck();

      // Si hay un departamento guardado, cargar sus ciudades
      if (depValue) {
        depControl.setValue(depValue, { emitEvent: false });
        await this.loadCities(depValue);
        this.cdr.markForCheck();

        // Si hay una ciudad guardada, establecerla
        if (cityValue) {
          cityControl.setValue(cityValue, { emitEvent: false });
        }
      }
    }
  }

  async loadDepartments(): Promise<void> {
    this.departments = await this.countryService.getDepartments();
    this.cdr.markForCheck();
  }

  async loadCities(depId: number): Promise<void> {
    this.cities = await this.countryService.getCitiesByDepartment(depId);
    this.cdr.markForCheck();
  }

  get timezoneOptions() {
    return this.timezones.map(tz => ({ value: tz.value, label: tz.label }));
  }

  get countryOptions() {
    return this.countries.map(c => ({ value: c.code, label: c.name }));
  }

  get departmentOptions() {
    return this.departments.map(d => ({ value: d.id, label: d.name }));
  }

  get cityOptions() {
    return this.cities.map(c => ({ value: c.id, label: c.name }));
  }
}
