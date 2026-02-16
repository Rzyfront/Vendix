import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ShippingZone, CreateZoneDto } from '../../interfaces/shipping-zones.interface';
import { ShippingMethodsService } from '../../services/shipping-methods.service';
import {
  CountryService,
  Country,
  Department,
} from '../../../../../../../services/country.service';
import {
  ModalComponent,
  InputComponent,
  ToggleComponent,
  IconComponent,
  SelectorComponent,
  ButtonComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-zone-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ToggleComponent,
    IconComponent,
    SelectorComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="mode === 'create' ? 'Crear Zona de Envío' : 'Editar Zona de Envío'"
      [subtitle]="'Define el alcance geográfico para calcular envíos'"
      (closed)="close.emit()"
      size="md"
    >
      <div slot="header">
        <div
          class="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center border border-indigo-100"
        >
          <app-icon name="map-pin" size="20" class="text-indigo-600"></app-icon>
        </div>
      </div>

      <form
        [formGroup]="form"
        id="zoneForm"
        (ngSubmit)="onSubmit()"
        class="space-y-4"
      >
        <!-- Name -->
        <app-input
          label="Nombre interno"
          placeholder="ej: Zona Norte"
          formControlName="name"
          [required]="true"
          hint="Usado para identificar la zona internamente"
        ></app-input>

        <!-- Display Name -->
        <app-input
          label="Nombre para mostrar (opcional)"
          placeholder="ej: Región Norte del País"
          formControlName="display_name"
          hint="Se muestra a los clientes en el checkout"
        ></app-input>

        <!-- Country Selector -->
        <div>
          <app-selector
            label="País de Cobertura"
            formControlName="country"
            [options]="countryOptions"
            [required]="true"
            (valueChange)="onCountryChange()"
          ></app-selector>
          <p
            class="text-[10px] text-gray-400 mt-1.5 px-1 flex items-center gap-1"
          >
            <app-icon name="info" size="10"></app-icon>
            Actualmente se soporta un país por zona para una gestión regional
            optimizada.
          </p>
        </div>

        <!-- Departments/Regions for Colombia -->
        <div
          *ngIf="showRegions"
          class="animate-in slide-in-from-top-2 duration-200 mt-6"
        >
          <div class="flex items-center justify-between mb-4">
            <label
              class="block text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide"
              >Departamentos / Regiones</label
            >
            <div *ngIf="!loadingRegions" class="flex items-center gap-2">
              <span
                class="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md uppercase"
              >
                {{ selectedRegions.size }} seleccionados
              </span>
            </div>
          </div>

          <div
            *ngIf="loadingRegions"
            class="flex items-center justify-center p-12 bg-gray-50/50 rounded-2xl border border-dashed text-gray-400 gap-2"
          >
            <app-icon name="loader-2" size="20" [spin]="true"></app-icon>
            <span class="text-sm font-medium">Cargando departamentos...</span>
          </div>

          <div
            *ngIf="!loadingRegions"
            class="border border-[var(--color-border)] rounded-2xl p-4 bg-gray-50/30"
          >
            <div
              class="flex items-center justify-between mb-4 pb-3 border-b border-gray-200/60"
            >
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  [checked]="allRegionsSelected"
                  (change)="toggleAllRegions($event)"
                  id="all-regions"
                  class="w-5 h-5 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]/20 transition-all cursor-pointer"
                />
                <label
                  for="all-regions"
                  class="text-sm font-bold text-[var(--color-text-primary)] cursor-pointer"
                  >Seleccionar Todos</label
                >
              </div>
              <span
                class="text-xs text-gray-400 font-medium italic"
                *ngIf="selectedRegions.size === 0"
                >Se asume "Todo el país"</span
              >
            </div>

            <div
              class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar"
            >
              <div
                *ngFor="let dep of departments"
                [class.bg-white]="isRegionSelected(dep.name)"
                [class.border-[var(--color-primary)]]="isRegionSelected(dep.name)"
                class="flex items-center gap-3 p-3 rounded-xl border border-transparent hover:bg-white hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer"
                (click)="toggleRegion(dep.name)"
              >
                <input
                  type="checkbox"
                  [checked]="isRegionSelected(dep.name)"
                  (change)="toggleRegion(dep.name)"
                  [id]="'dep-' + dep.id"
                  class="w-4 h-4 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]/20 transition-all pointer-events-none"
                />
                <label
                  [for]="'dep-' + dep.id"
                  class="text-sm font-medium text-gray-700 cursor-pointer pointer-events-none"
                  >{{ dep.name }}</label
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Manual Regions Input for other countries -->
        <app-input
          *ngIf="!showRegions && form.get('country')?.value"
          label="Regiones/Provincias (opcional)"
          placeholder="ej: Santiago, La Vega, Puerto Plata"
          formControlName="regions_text"
          hint="Separa con comas. Dejar vacío para incluir todo el país."
        ></app-input>

        <!-- Cities (optional) -->
        <app-input
          label="Ciudades específicas (opcional)"
          placeholder="ej: Santiago de los Caballeros, Moca"
          formControlName="cities_text"
          hint="Separa con comas. Dejar vacío para no restringir."
        ></app-input>

        <!-- Zip codes (optional) -->
        <app-input
          label="Códigos postales (opcional)"
          placeholder="ej: 51000, 10100, 10200"
          formControlName="zip_codes_text"
          hint="Separa con comas. Dejar vacío para no restringir."
        ></app-input>

        <!-- Status -->
        <div
          class="flex items-center justify-between p-4 rounded-xl border border-[var(--color-border)] bg-gray-50/30 mt-6"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center border border-green-100"
            >
              <app-icon
                name="check"
                size="16"
                class="text-green-600"
              ></app-icon>
            </div>
            <div>
              <span class="text-sm font-bold text-[var(--color-text-primary)]"
                >Estado Activo</span
              >
              <p class="text-xs text-[var(--color-text-secondary)]">
                Las zonas inactivas no se usan para calcular envíos.
              </p>
            </div>
          </div>
          <app-toggle formControlName="is_active"></app-toggle>
        </div>
      </form>

      <div slot="footer" class="flex items-center justify-end gap-3 w-full">
        <app-button variant="ghost" (clicked)="close.emit()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          [loading]="isSubmitting"
          [disabled]="form.invalid"
          (clicked)="onSubmit()"
        >
          <app-icon name="save" size="18" slot="icon" class="mr-2"></app-icon>
          {{ mode === 'edit' ? 'Guardar Cambios' : 'Crear Zona' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ZoneModalComponent implements OnInit {
  @Input() zone?: ShippingZone;
  @Input() mode: 'create' | 'edit' = 'create';
  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingMethodsService);
  private countryService = inject(CountryService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  form: FormGroup;
  isSubmitting = false;

  countryOptions: { value: string; label: string }[] = [];
  departments: Department[] = [];
  loadingRegions = false;
  selectedRegions: Set<string> = new Set();

  private countryFlags: Record<string, string> = {
    DO: '\u{1F1E9}\u{1F1F4}',
    CO: '\u{1F1E8}\u{1F1F4}',
    MX: '\u{1F1F2}\u{1F1FD}',
    US: '\u{1F1FA}\u{1F1F8}',
    PR: '\u{1F1F5}\u{1F1F7}',
    PA: '\u{1F1F5}\u{1F1E6}',
    VE: '\u{1F1FB}\u{1F1EA}',
    AR: '\u{1F1E6}\u{1F1F7}',
    CL: '\u{1F1E8}\u{1F1F1}',
    PE: '\u{1F1F5}\u{1F1EA}',
    ES: '\u{1F1EA}\u{1F1F8}',
  };

  constructor() {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      display_name: ['', Validators.maxLength(100)],
      country: ['', Validators.required],
      regions_text: [''],
      cities_text: [''],
      zip_codes_text: [''],
      is_active: [true],
    });
  }

  ngOnInit(): void {
    // Load country options
    const countries = this.countryService.getCountries();
    this.countryOptions = countries.map((c) => ({
      value: c.code,
      label: `${this.countryFlags[c.code] || ''} ${c.name}`.trim(),
    }));

    // If editing, populate the form
    if (this.zone && this.mode === 'edit') {
      this.populateForm(this.zone);
    }
  }

  private async populateForm(zone: ShippingZone): Promise<void> {
    const country = zone.countries?.[0] || '';

    this.form.patchValue({
      name: zone.name,
      display_name: zone.display_name || '',
      country: country,
      regions_text: '',
      cities_text: zone.cities?.join(', ') || '',
      zip_codes_text: zone.zip_codes?.join(', ') || '',
      is_active: zone.is_active,
    });

    // If Colombia, load departments and pre-select regions
    if (country === 'CO' && zone.regions?.length) {
      await this.loadDepartments();
      this.selectedRegions = new Set(zone.regions);
    } else if (country === 'CO') {
      await this.loadDepartments();
    } else {
      this.form.patchValue({
        regions_text: zone.regions?.join(', ') || '',
      });
    }
  }

  get showRegions(): boolean {
    return this.form.get('country')?.value === 'CO';
  }

  get allRegionsSelected(): boolean {
    return (
      this.departments.length > 0 &&
      this.selectedRegions.size === this.departments.length
    );
  }

  async onCountryChange(): Promise<void> {
    this.selectedRegions = new Set();
    this.form.patchValue({ regions_text: '' });
    this.departments = [];

    if (this.form.get('country')?.value === 'CO') {
      await this.loadDepartments();
    }
  }

  private async loadDepartments(): Promise<void> {
    this.loadingRegions = true;
    try {
      const deps = await this.countryService.getDepartments();
      deps.sort((a, b) => a.name.localeCompare(b.name));
      this.departments = deps;
    } catch (error) {
      console.error('Error loading departments:', error);
      this.departments = [];
    } finally {
      this.loadingRegions = false;
      this.cdr.markForCheck();
    }
  }

  isRegionSelected(regionName: string): boolean {
    return this.selectedRegions.has(regionName);
  }

  toggleRegion(regionName: string): void {
    if (this.selectedRegions.has(regionName)) {
      this.selectedRegions.delete(regionName);
    } else {
      this.selectedRegions.add(regionName);
    }
  }

  toggleAllRegions(event: any): void {
    if (event.target.checked) {
      this.departments.forEach((d) => this.selectedRegions.add(d.name));
    } else {
      this.selectedRegions.clear();
    }
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    const values = this.form.value;

    const parseList = (text: string): string[] =>
      text
        ? text.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        : [];

    let regions: string[] = [];
    if (values.country === 'CO') {
      regions = Array.from(this.selectedRegions);
    } else {
      regions = parseList(values.regions_text);
    }

    const dto: CreateZoneDto = {
      name: values.name,
      display_name: values.display_name || undefined,
      countries: [values.country],
      regions: regions,
      cities: parseList(values.cities_text),
      zip_codes: parseList(values.zip_codes_text),
      is_active: values.is_active,
    };

    const request$ = this.zone && this.mode === 'edit'
      ? this.shippingService.updateZone(this.zone.id, dto)
      : this.shippingService.createZone(dto);

    request$.subscribe({
      next: () => {
        this.isSubmitting = false;
        this.toast.success(
          this.mode === 'edit'
            ? 'Zona actualizada correctamente'
            : 'Zona creada correctamente'
        );
        this.saved.emit();
        this.close.emit();
      },
      error: (err) => {
        this.isSubmitting = false;
        this.toast.error('Error al guardar la zona: ' + (err.message || 'Error desconocido'));
      },
    });
  }
}
