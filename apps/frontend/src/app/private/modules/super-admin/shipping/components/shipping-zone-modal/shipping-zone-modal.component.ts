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
import { ShippingService } from '../../services/shipping.service';
import {
  CountryService,
  Country,
  Department,
} from '../../../../../../services/country.service';
import { ShippingZone } from '../../interfaces/shipping.interface';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';

@Component({
  selector: 'app-superadmin-shipping-zone-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IconComponent,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    ToggleComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="(zone ? 'Editar' : 'Nueva') + ' Zona de Envío del Sistema'"
      [subtitle]="'Define el alcance geográfico para todas las tiendas'"
      (closed)="close.emit()"
      size="lg"
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
        id="shippingZoneForm"
        (ngSubmit)="onSubmit()"
        class="space-y-4"
      >
        <app-input
          label="Nombre de la Zona"
          formControlName="name"
          placeholder="Ej: Zona Nacional, Todo Colombia..."
          [required]="true"
        ></app-input>

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

        <!-- Regions / Departments -->
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
                [class.border-[var(--color-primary)]]="
                  isRegionSelected(dep.name)
                "
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
                Disponible para todas las tiendas.
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
          {{ zone ? 'Actualizar Zona' : 'Crear Zona' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ShippingZoneModalComponent implements OnInit {
  @Input() zone?: ShippingZone;
  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingService);
  private countryService: CountryService = inject(CountryService);
  private cdr = inject(ChangeDetectorRef);

  form: FormGroup;
  isSubmitting = false;

  countries: Country[] = [];
  countryOptions: SelectorOption[] = [];
  departments: Department[] = [];
  loadingRegions = false;
  selectedRegions: Set<string> = new Set();

  constructor() {
    this.form = this.fb.group({
      name: ['', Validators.required],
      country: ['', Validators.required],
      is_active: [true],
    });
  }

  ngOnInit() {
    this.countries = this.countryService.getCountries();
    this.countryOptions = this.countries.map((c) => ({
      value: c.code,
      label: c.name,
    }));

    if (this.zone) {
      this.form.patchValue({
        name: this.zone.name,
        country: this.zone.countries[0] || '',
        is_active: this.zone.is_active,
      });

      if (this.zone.regions) {
        this.selectedRegions = new Set(this.zone.regions);
      }

      // Trigger region load if country is set
      this.onCountryChange(false);
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

  async onCountryChange(resetRegions = true) {
    const countryCode = this.form.get('country')?.value;

    if (resetRegions) {
      this.selectedRegions.clear();
    }

    if (countryCode === 'CO') {
      this.loadingRegions = true;
      try {
        this.departments = await this.countryService.getDepartments();
      } catch (e) {
        console.error('Error loading departments', e);
      } finally {
        this.loadingRegions = false;
        this.cdr.markForCheck();
      }
    } else {
      this.departments = [];
    }
  }

  isRegionSelected(regionName: string): boolean {
    return this.selectedRegions.has(regionName);
  }

  toggleRegion(regionName: string) {
    if (this.selectedRegions.has(regionName)) {
      this.selectedRegions.delete(regionName);
    } else {
      this.selectedRegions.add(regionName);
    }
  }

  toggleAllRegions(event: any) {
    if (event.target.checked) {
      this.departments.forEach((d) => this.selectedRegions.add(d.name));
    } else {
      this.selectedRegions.clear();
    }
  }

  onSubmit() {
    if (this.form.invalid) return;

    this.isSubmitting = true;
    const formValue = this.form.value;

    const payload: Partial<ShippingZone> = {
      name: formValue.name,
      countries: [formValue.country],
      regions: Array.from(this.selectedRegions),
      cities: [],
      zip_codes: [],
      is_active: formValue.is_active,
    };

    const request$ = this.zone
      ? this.shippingService.updateZone(this.zone.id, payload)
      : this.shippingService.createZone(payload);

    request$.subscribe({
      next: () => {
        this.isSubmitting = false;
        this.saved.emit();
        this.close.emit();
      },
      error: () => {
        this.isSubmitting = false;
        alert('Error al guardar la zona.');
      },
    });
  }
}
