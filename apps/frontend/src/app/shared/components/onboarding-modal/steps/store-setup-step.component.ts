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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .store-step {
        padding: 0;
        background: transparent;
      }

      .store-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
      }

      .store-header {
        text-align: center;
        margin-bottom: 1rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .store-icon-wrapper {
        margin-bottom: 0.75rem;
      }

      .store-icon-bg {
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, var(--color-warning) 0%, #ea580c 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-md);
      }

      .store-icon {
        color: var(--color-text-on-primary);
      }

      .store-title {
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.25rem;
      }

      .store-subtitle {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.5;
      }

      .store-form {
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
        background: var(--color-warning-light);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
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
        color: var(--color-warning);
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
        border-color: var(--color-warning);
        box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.15);
      }

      .field-input::placeholder {
        color: var(--color-text-muted);
      }

      .store-type-selector {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
      }

      .store-type-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        cursor: pointer;
        transition: all var(--transition-fast) ease;
        background: var(--color-surface);
        position: relative;
        text-align: center;
      }

      .store-type-option:hover {
        border-color: var(--color-warning);
        background: var(--color-warning-light);
      }

      .store-type-option.active {
        border-color: var(--color-warning);
        background: var(--color-warning-light);
        box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.15);
      }

      .store-type-icon {
        width: 40px;
        height: 40px;
        background: var(--color-warning-light);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .type-icon-element {
        color: var(--color-warning);
      }

      .store-type-content {
        flex: 1;
      }

      .store-type-title {
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin-bottom: 0.125rem;
      }

      .store-type-description {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        line-height: 1.3;
      }

      .store-type-check {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
      }

      .check-icon {
        color: var(--color-warning);
      }

      @media (max-width: 1024px) {
        .form-grid {
          grid-template-columns: repeat(2, 1fr);
        }
        .store-type-selector {
          grid-template-columns: 1fr;
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
    <div class="step-content store-step">
      <div class="store-container">
        <!-- Header -->
        <div class="store-header">
          <div class="store-icon-wrapper">
            <div class="store-icon-bg">
              <app-icon name="store" size="48" class="store-icon"></app-icon>
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
                <label class="field-label">
                  Nombre de la tienda
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="El nombre visible para tus clientes"></app-icon>
                  <span class="field-required">*</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="name"
                  placeholder="Tienda Principal"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Zona horaria
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Para reportes y horarios de atención"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" formControlName="timezone">
                  <option value="">Selecciona una zona horaria</option>
                  <option
                    *ngFor="let timezone of timezones"
                    [value]="timezone.value"
                  >
                    {{ timezone.label }}
                  </option>
                </select>
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
                    size="32"
                    class="type-icon-element"
                  ></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Híbrida</h4>
                  <p class="store-type-description">
                    Ventas en persona y online
                  </p>
                </div>
                <div
                  class="store-type-check"
                  *ngIf="formGroup.get('store_type')?.value === 'hybrid'"
                >
                  <app-icon
                    name="check-circle"
                    size="20"
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
                    size="32"
                    class="type-icon-element"
                  ></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Online</h4>
                  <p class="store-type-description">
                    Ventas por internet y delivery
                  </p>
                </div>
                <div
                  class="store-type-check"
                  *ngIf="formGroup.get('store_type')?.value === 'online'"
                >
                  <app-icon
                    name="check-circle"
                    size="20"
                    class="check-icon"
                  ></app-icon>
                </div>
              </div>

              <div
                class="store-type-option"
                [class.active]="
                  formGroup.get('store_type')?.value === 'physical'
                "
                (click)="formGroup.get('store_type')?.setValue('physical')"
              >
                <div class="store-type-icon">
                  <app-icon
                    name="building"
                    size="32"
                    class="type-icon-element"
                  ></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Física</h4>
                  <p class="store-type-description">
                    Ventas en persona con caja física
                  </p>
                </div>
                <div
                  class="store-type-check"
                  *ngIf="formGroup.get('store_type')?.value === 'physical'"
                >
                  <app-icon
                    name="check-circle"
                    size="20"
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

            <div class="form-grid">
              <div class="form-field half-width">
                <label class="field-label">
                  Calle y número
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Dirección principal de la tienda"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="address_line1"
                  placeholder="Calle Principal #123"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  País
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="País de operación"></app-icon>
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

              <div class="form-field">
                <label class="field-label">
                  Departamento
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Estado o región"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" formControlName="state_province">
                  <option value="">Selecciona</option>
                  <option *ngFor="let dep of departments" [value]="dep.id">
                    {{ dep.name }}
                  </option>
                </select>
              </div>

              <!-- Ciudad -->
              <div class="form-field">
                <label class="field-label">
                  Ciudad
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Ciudad de operación"></app-icon>
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" formControlName="city">
                  <option value="">Selecciona</option>
                  <option *ngFor="let city of cities" [value]="city.id">
                    {{ city.name }}
                  </option>
                </select>
              </div>

              <!-- Código postal -->
              <div class="form-field">
                <label class="field-label">
                  Código postal
                  <app-icon name="help-circle" size="14" class="help-icon" data-tooltip="Código postal del área"></app-icon>
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
}
