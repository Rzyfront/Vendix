import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  ToggleComponent,
  SelectorComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

// Interfaces
import { InventoryLocation, CreateLocationDto, UpdateLocationDto, LocationType } from '../../interfaces';

// Services
import { CountryService, Country, Department, City } from '../../../../../../services/country.service';

@Component({
  selector: 'app-location-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    ToggleComponent,
    SelectorComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [title]="location ? 'Editar Ubicación' : 'Nueva Ubicación'"
      size="md"
      (closed)="onCancel()"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-6 max-h-[70vh] overflow-y-auto px-1">
          <!-- Basic Info -->
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2 md:col-span-1">
              <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Nombre *</label>
              <app-input
                formControlName="name"
                placeholder="Ej: Almacén Principal"
                [error]="getError('name')"
              ></app-input>
            </div>
            <div class="col-span-2 md:col-span-1">
              <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Código *</label>
              <app-input
                formControlName="code"
                placeholder="Ej: ALM-01"
                [error]="getError('code')"
              ></app-input>
            </div>
          </div>

          <!-- Type Selection -->
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2 md:col-span-1">
              <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Tipo de Ubicación</label>
              <app-selector
                formControlName="type"
                [options]="typeOptions"
                placeholder="Seleccionar tipo"
              ></app-selector>
            </div>
            <div class="col-span-2 md:col-span-1 flex flex-col justify-end pb-1.5">
               <div class="flex items-center gap-3 bg-background-secondary/50 p-2.5 rounded-xl border border-border-subtle">
                <app-toggle formControlName="is_active"></app-toggle>
                <span class="text-sm font-medium text-text-primary">Ubicación activa</span>
              </div>
            </div>
          </div>

          <!-- Address Section Toggle (PRO UI) -->
          <div class="pt-2">
            <button 
              type="button"
              (click)="toggleAddress()"
              class="w-full flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-primary/5 to-transparent border border-primary/20 hover:border-primary/40 transition-all group"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  <app-icon name="map-pin" size="20"></app-icon>
                </div>
                <div class="text-left">
                  <h4 class="text-sm font-bold text-text-primary">Dirección Física</h4>
                  <p class="text-xs text-text-secondary">Agregar ubicación geográfica específica</p>
                </div>
              </div>
              <app-icon 
                [name]="showAddress ? 'chevron-up' : 'chevron-down'" 
                size="20" 
                class="text-text-secondary group-hover:text-primary transition-colors"
              ></app-icon>
            </button>

            <!-- Expandable Content -->
            <div 
              *ngIf="showAddress"
              formGroupName="address"
              class="mt-4 space-y-4 p-4 rounded-2xl border border-border-subtle bg-background-secondary/30"
            >
              <div class="grid grid-cols-2 gap-4">
                <div class="col-span-2">
                  <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Línea de Dirección 1 *</label>
                  <app-input
                    formControlName="address_line_1"
                    placeholder="Ej: Calle 123 # 45 - 67"
                    [error]="getError('address.address_line_1')"
                  ></app-input>
                </div>
                <div class="col-span-2">
                   <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Línea de Dirección 2</label>
                  <app-input
                    formControlName="address_line_2"
                    placeholder="Ej: Bodega 4 o Apt 101"
                  ></app-input>
                </div>
                <div class="col-span-2 md:col-span-1">
                  <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">País *</label>
                  <app-selector
                    formControlName="country"
                    [options]="countryOptions"
                    placeholder="Seleccionar país"
                    [errorText]="getError('address.country')"
                  ></app-selector>
                </div>
                <div class="col-span-2 md:col-span-1" *ngIf="form.get('address.country')?.value === 'CO'">
                  <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Departamento *</label>
                  <app-selector
                    formControlName="state"
                    [options]="departmentOptions"
                    placeholder="Seleccionar departamento"
                    [errorText]="getError('address.state')"
                  ></app-selector>
                </div>
                <div class="col-span-2 md:col-span-1" *ngIf="form.get('address.country')?.value !== 'CO'">
                  <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Estado / Provincia *</label>
                  <app-input
                    formControlName="state"
                    placeholder="Ej: Cundinamarca"
                    [error]="getError('address.state')"
                  ></app-input>
                </div>
                <div class="col-span-2 md:col-span-1" *ngIf="form.get('address.country')?.value === 'CO'">
                  <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Ciudad *</label>
                  <app-selector
                    formControlName="city"
                    [options]="cityOptions"
                    placeholder="Seleccionar ciudad"
                    [errorText]="getError('address.city')"
                  ></app-selector>
                </div>
                <div class="col-span-2 md:col-span-1" *ngIf="form.get('address.country')?.value !== 'CO'">
                  <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Ciudad *</label>
                  <app-input
                    formControlName="city"
                    placeholder="Ej: Bogotá"
                    [error]="getError('address.city')"
                  ></app-input>
                </div>
                <div class="col-span-2 md:col-span-1">
                  <label class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1">Código Postal *</label>
                  <app-input
                    formControlName="postal_code"
                    placeholder="Ej: 110111"
                    [error]="getError('address.postal_code')"
                  ></app-input>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-3 w-full">
        <app-button variant="secondary" type="button" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          type="button"
          [loading]="isSubmitting"
          [disabled]="form.invalid || isSubmitting"
          (clicked)="onSubmit()"
        >
          {{ location ? 'Guardar Cambios' : 'Crear Ubicación' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class LocationFormModalComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() location: InventoryLocation | null = null;
  @Input() isSubmitting = false;

  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreateLocationDto | UpdateLocationDto>();

  typeOptions = [
    { value: 'warehouse', label: 'Almacén / Bodega' },
    { value: 'store', label: 'Tienda / Local' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'transit', label: 'En Tránsito' },
  ];

  form: FormGroup;
  showAddress = false;
  countries: Country[] = [];
  departments: Department[] = [];
  cities: City[] = [];
  isLoadingLocations = false;

  constructor(
    private fb: FormBuilder,
    private countryService: CountryService
  ) {
    this.form = this.createForm();
  }

  ngOnInit(): void {
    this.countries = this.countryService.getCountries();
    this.setupAddressListeners();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['location'] && this.location) {
      this.patchForm(this.location);
    } else if (changes['isOpen'] && this.isOpen && !this.location) {
      this.form.reset({ is_active: true, type: 'warehouse' });
      this.showAddress = false;
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(200)]],
      code: ['', [Validators.required, Validators.maxLength(50)]],
      type: ['warehouse', [Validators.required]],
      is_active: [true],
      address: this.fb.group({
        address_line_1: [''],
        address_line_2: [''],
        city: [''],
        state: [''],
        postal_code: [''],
        country: ['CO'],
      })
    });
  }

  private setAddressValidators(required: boolean) {
    const addressForm = this.form.get('address');
    if (required) {
      addressForm?.get('address_line_1')?.setValidators([Validators.required]);
      addressForm?.get('city')?.setValidators([Validators.required]);
      addressForm?.get('state')?.setValidators([Validators.required]);
      addressForm?.get('postal_code')?.setValidators([Validators.required]);
      addressForm?.get('country')?.setValidators([Validators.required]);
    } else {
      addressForm?.get('address_line_1')?.clearValidators();
      addressForm?.get('city')?.clearValidators();
      addressForm?.get('state')?.clearValidators();
      addressForm?.get('postal_code')?.clearValidators();
      addressForm?.get('country')?.clearValidators();
    }

    ['address_line_1', 'city', 'state', 'postal_code', 'country'].forEach(key => {
      addressForm?.get(key)?.updateValueAndValidity();
    });
  }

  toggleAddress() {
    this.showAddress = !this.showAddress;
    this.setAddressValidators(this.showAddress);
  }

  private setupAddressListeners() {
    const addressGroup = this.form.get('address');
    const countryControl = addressGroup?.get('country');
    const stateControl = addressGroup?.get('state');

    countryControl?.valueChanges.subscribe(code => {
      if (code === 'CO') {
        this.loadDepartments();
      } else {
        this.departments = [];
        this.cities = [];
        stateControl?.setValue('');
        addressGroup?.get('city')?.setValue('');
      }
    });

    stateControl?.valueChanges.subscribe(stateVal => {
      if (stateVal && this.form.get('address.country')?.value === 'CO') {
        // stateVal could be a name or an ID depending on source
        const dept = this.departments.find(d => d.name === stateVal || d.id === Number(stateVal));
        if (dept) {
          this.loadCities(dept.id);
        }
      } else {
        this.cities = [];
        addressGroup?.get('city')?.setValue('');
      }
    });
  }

  private async loadDepartments() {
    this.isLoadingLocations = true;
    try {
      this.departments = await this.countryService.getDepartments();
    } finally {
      this.isLoadingLocations = false;
    }
  }

  private async loadCities(deptId: number) {
    this.isLoadingLocations = true;
    try {
      this.cities = await this.countryService.getCitiesByDepartment(deptId);
    } finally {
      this.isLoadingLocations = false;
    }
  }

  get countryOptions() {
    return this.countries.map(c => ({ value: c.code, label: c.name }));
  }

  get departmentOptions() {
    return this.departments.map(d => ({ value: d.id.toString(), label: d.name }));
  }

  get cityOptions() {
    return this.cities.map(c => ({ value: c.id.toString(), label: c.name }));
  }

  private patchForm(location: InventoryLocation): void {
    this.form.patchValue({
      name: location.name,
      code: location.code,
      type: location.type || 'warehouse',
      is_active: location.is_active,
    });

    if (location.address) {
      this.showAddress = true;
      // First set non-CO fields
      this.form.get('address')?.patchValue({
        address_line_1: location.address.address_line_1,
        address_line_2: location.address.address_line_2,
        postal_code: location.address.postal_code,
        country: location.address.country,
      }, { emitEvent: false });

      // Setup validators but dont toggle showAddress again (it was already set)
      this.setAddressValidators(true);

      if (location.address.country === 'CO') {
        this.loadDepartments().then(() => {
          const dept = this.departments.find(d => d.name === location.address?.state);
          if (dept) {
            this.form.get('address.state')?.setValue(dept.id.toString(), { emitEvent: false });
            this.loadCities(dept.id).then(() => {
              const city = this.cities.find(c => c.name === location.address?.city);
              if (city) {
                this.form.get('address.city')?.setValue(city.id.toString(), { emitEvent: false });
              }
            });
          }
        });
      } else {
        // If not CO, just patch names directly as strings
        this.form.get('address')?.patchValue({
          state: location.address.state,
          city: location.address.city,
        });
      }
    }
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['maxlength']) return 'Texto demasiado largo';
    }
    return '';
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.valid) {
      const val = JSON.parse(JSON.stringify(this.form.value));
      if (!this.showAddress) {
        delete val.address;
      } else if (val.address) {
        // Ensure we send names for state and city if they are IDs
        if (val.address.country === 'CO') {
          const dept = this.departments.find(d => d.id === Number(val.address.state));
          if (dept) val.address.state = dept.name;

          const city = this.cities.find(c => c.id === Number(val.address.city));
          if (city) val.address.city = city.name;
        }
      }
      this.save.emit(val);
    }
  }
}
