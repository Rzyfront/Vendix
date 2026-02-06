import {
  Component,
  input,
  output,
  signal,
  OnInit,
  ChangeDetectorRef,
  inject,
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
} from '../../../../../../../shared/components/index';

interface CountryOption {
  value: string;
  label: string;
  flag: string;
}

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
  ],
  template: `
    <app-modal
      [isOpen]="is_open()"
      [title]="mode() === 'create' ? 'Crear Zona de Envío' : 'Editar Zona de Envío'"
      size="md"
      (close)="onClose()"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <!-- Name -->
          <app-input
            label="Nombre interno"
            placeholder="ej: Zona Norte"
            formControlName="name"
            [error]="getError('name')"
            hint="Usado para identificar la zona internamente"
          />

          <!-- Display Name -->
          <app-input
            label="Nombre para mostrar (opcional)"
            placeholder="ej: Región Norte del País"
            formControlName="display_name"
            hint="Se muestra a los clientes en el checkout"
          />

          <!-- Country Selector -->
          <app-selector
            label="País de Cobertura"
            formControlName="country"
            [options]="countryOptions"
            placeholder="Selecciona un país"
            [required]="true"
            (valueChange)="onCountryChange()"
          />

          <!-- Departments/Regions for Colombia -->
          @if (showRegionsSelector()) {
            <div class="animate-in fade-in-0 slide-in-from-top-2">
              @if (loadingRegions()) {
                <div class="flex items-center gap-2 py-4 text-muted-foreground">
                  <app-icon name="loader-2" class="h-5 w-5 animate-spin" />
                  <span>Cargando departamentos...</span>
                </div>
              } @else {
                <div>
                  <label class="text-sm font-medium mb-2 block">
                    Departamentos
                    <span class="text-muted-foreground font-normal">(opcional - dejar vacío para todo el país)</span>
                  </label>
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-1">
                    @for (dep of departments(); track dep.id) {
                      <button
                        type="button"
                        class="flex items-center gap-2 p-2 rounded-lg border text-sm transition-colors text-left"
                        [class.border-primary]="isRegionSelected(dep.name)"
                        [class.bg-primary/5]="isRegionSelected(dep.name)"
                        [class.border-border]="!isRegionSelected(dep.name)"
                        (click)="toggleRegion(dep.name)"
                      >
                        <span class="truncate flex-1">{{ dep.name }}</span>
                        @if (isRegionSelected(dep.name)) {
                          <app-icon name="check" class="h-4 w-4 text-primary shrink-0" />
                        }
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }

          <!-- Manual Regions Input for other countries -->
          @if (!showRegionsSelector() && form.get('country')?.value) {
            <app-input
              label="Regiones/Provincias (opcional)"
              placeholder="ej: Santiago, La Vega, Puerto Plata"
              formControlName="regions_text"
              hint="Separa con comas. Dejar vacío para incluir todo el país."
            />
          }

          <!-- Cities (optional) -->
          <app-input
            label="Ciudades específicas (opcional)"
            placeholder="ej: Santiago de los Caballeros, Moca"
            formControlName="cities_text"
            hint="Separa con comas. Dejar vacío para no restringir."
          />

          <!-- Zip codes (optional) -->
          <app-input
            label="Códigos postales (opcional)"
            placeholder="ej: 51000, 10100, 10200"
            formControlName="zip_codes_text"
            hint="Separa con comas. Dejar vacío para no restringir."
          />

          <!-- Is Active -->
          <div class="flex items-center justify-between pt-2">
            <div>
              <p class="font-medium">Estado activo</p>
              <p class="text-sm text-muted-foreground">
                Las zonas inactivas no se usan para calcular envíos
              </p>
            </div>
            <app-toggle formControlName="is_active" />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
            (click)="onClose()"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            [disabled]="is_saving() || form.invalid"
          >
            @if (is_saving()) {
              <div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
              Guardando...
            } @else {
              {{ mode() === 'create' ? 'Crear Zona' : 'Guardar Cambios' }}
            }
          </button>
        </div>
      </form>
    </app-modal>
  `,
  styles: [`
    .animate-in {
      animation: animateIn 0.2s ease-out;
    }
    @keyframes animateIn {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `],
})
export class ZoneModalComponent implements OnInit {
  private countryService = inject(CountryService);
  private cdr = inject(ChangeDetectorRef);

  // Inputs
  readonly is_open = input<boolean>(false);
  readonly mode = input<'create' | 'edit'>('create');
  readonly zone = input<ShippingZone | null>(null);

  // Outputs
  readonly close = output<void>();
  readonly save = output<CreateZoneDto>();

  // State
  readonly is_saving = signal(false);
  readonly selected_regions = signal<Set<string>>(new Set());
  readonly departments = signal<Department[]>([]);
  readonly loadingRegions = signal(false);

  // Form
  form: FormGroup;

  // Country options for selector
  countryOptions: { value: string; label: string }[] = [];

  // Countries with flag emoji support
  private countryFlags: Record<string, string> = {
    DO: '🇩🇴',
    CO: '🇨🇴',
    MX: '🇲🇽',
    US: '🇺🇸',
    PR: '🇵🇷',
    PA: '🇵🇦',
    VE: '🇻🇪',
    AR: '🇦🇷',
    CL: '🇨🇱',
    PE: '🇵🇪',
    ES: '🇪🇸',
  };

  constructor(
    private fb: FormBuilder,
    private shipping_service: ShippingMethodsService
  ) {
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
    // Load countries from CountryService
    const countries = this.countryService.getCountries();
    this.countryOptions = countries.map((c) => ({
      value: c.code,
      label: `${this.countryFlags[c.code] || ''} ${c.name}`.trim(),
    }));

    // Watch for zone input changes to populate form
    const zone = this.zone();
    if (zone && this.mode() === 'edit') {
      this.populateForm(zone);
    }
  }

  private async populateForm(zone: ShippingZone): Promise<void> {
    // Set country (use first country from array)
    const country = zone.countries?.[0] || '';

    this.form.patchValue({
      name: zone.name,
      display_name: zone.display_name || '',
      country: country,
      regions_text: '', // Will be set below or via regions selector
      cities_text: zone.cities?.join(', ') || '',
      zip_codes_text: zone.zip_codes?.join(', ') || '',
      is_active: zone.is_active,
    });

    // If it's Colombia, load departments and set selected regions
    if (country === 'CO' && zone.regions?.length) {
      await this.loadDepartments();
      this.selected_regions.set(new Set(zone.regions));
    } else {
      // For other countries, use text input
      this.form.patchValue({
        regions_text: zone.regions?.join(', ') || '',
      });
    }
  }

  showRegionsSelector(): boolean {
    return this.form.get('country')?.value === 'CO';
  }

  async onCountryChange(): Promise<void> {
    const country = this.form.get('country')?.value;

    // Reset regions when country changes
    this.selected_regions.set(new Set());
    this.form.patchValue({ regions_text: '' });
    this.departments.set([]);

    if (country === 'CO') {
      await this.loadDepartments();
    }
  }

  private async loadDepartments(): Promise<void> {
    this.loadingRegions.set(true);
    try {
      const deps = await this.countryService.getDepartments();
      // Sort alphabetically
      deps.sort((a, b) => a.name.localeCompare(b.name));
      this.departments.set(deps);
    } catch (error) {
      console.error('Error loading departments:', error);
      this.departments.set([]);
    } finally {
      this.loadingRegions.set(false);
      this.cdr.markForCheck();
    }
  }

  isRegionSelected(name: string): boolean {
    return this.selected_regions().has(name);
  }

  toggleRegion(name: string): void {
    const current = new Set(this.selected_regions());
    if (current.has(name)) {
      current.delete(name);
    } else {
      current.add(name);
    }
    this.selected_regions.set(current);
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['maxlength']) return 'Máximo 100 caracteres';
    }
    return '';
  }

  onClose(): void {
    this.form.reset({
      name: '',
      display_name: '',
      country: '',
      regions_text: '',
      cities_text: '',
      zip_codes_text: '',
      is_active: true,
    });
    this.selected_regions.set(new Set());
    this.departments.set([]);
    this.close.emit();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const values = this.form.value;

    // Parse comma-separated values into arrays
    const parseList = (text: string): string[] =>
      text
        ? text
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];

    // Get regions: from selector for Colombia, from text input for others
    let regions: string[] = [];
    if (values.country === 'CO') {
      regions = Array.from(this.selected_regions());
    } else {
      regions = parseList(values.regions_text);
    }

    const dto: CreateZoneDto = {
      name: values.name,
      display_name: values.display_name || undefined,
      countries: [values.country], // Single country per zone
      regions: regions,
      cities: parseList(values.cities_text),
      zip_codes: parseList(values.zip_codes_text),
      is_active: values.is_active,
    };

    this.save.emit(dto);
  }

  setIsSaving(value: boolean): void {
    this.is_saving.set(value);
  }

  async resetAndPopulate(zone: ShippingZone | null): Promise<void> {
    if (zone) {
      await this.populateForm(zone);
    } else {
      this.form.reset({
        name: '',
        display_name: '',
        country: '',
        regions_text: '',
        cities_text: '',
        zip_codes_text: '',
        is_active: true,
      });
      this.selected_regions.set(new Set());
      this.departments.set([]);
    }
  }
}
