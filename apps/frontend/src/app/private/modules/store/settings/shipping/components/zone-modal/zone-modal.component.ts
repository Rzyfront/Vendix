import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  inject,
  ChangeDetectorRef,
} from '@angular/core';

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
  Department,
  City,
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
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ToggleComponent,
    IconComponent,
    SelectorComponent,
    ButtonComponent
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

        <!-- País (Colombia, fijo) -->
        <div class="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-gray-50/30">
          <span class="text-xl">🇨🇴</span>
          <div>
            <p class="text-sm font-semibold text-[var(--color-text-primary)]">Colombia</p>
            <p class="text-xs text-[var(--color-text-secondary)]">País de cobertura</p>
          </div>
        </div>

        <!-- Departamento -->
        <div>
          @if (loadingDepartments) {
            <div class="flex items-center gap-2 p-3 text-sm text-gray-400">
              <app-icon name="loader-2" size="16" [spin]="true"></app-icon>
              Cargando departamentos...
            </div>
          } @else {
            <app-selector
              label="Departamento (opcional)"
              formControlName="department"
              [options]="departmentOptions"
              placeholder="Todo Colombia"
              (valueChange)="onDepartmentChange($event)"
            ></app-selector>
          }
          <p class="text-[10px] text-gray-400 mt-1.5 px-1 flex items-center gap-1">
            <app-icon name="info" size="10"></app-icon>
            Dejar vacío para cubrir todo el país.
          </p>
        </div>

        <!-- Ciudad (cascading desde departamento) -->
        <div>
          @if (loadingCities) {
            <div class="flex items-center gap-2 p-3 text-sm text-gray-400">
              <app-icon name="loader-2" size="16" [spin]="true"></app-icon>
              Cargando ciudades...
            </div>
          } @else {
            <app-selector
              label="Ciudad específica (opcional)"
              formControlName="city"
              [options]="cityOptions"
              [disabled]="!form.get('department')?.value"
              placeholder="Todo el departamento"
            ></app-selector>
          }
          <p class="text-[10px] text-gray-400 mt-1.5 px-1 flex items-center gap-1">
            <app-icon name="info" size="10"></app-icon>
            Selecciona primero un departamento. Dejar vacío para todo el departamento.
          </p>
        </div>

        <!-- Códigos postales (opcional) -->
        <app-input
          label="Códigos postales (opcional)"
          placeholder="ej: 51000, 10100, 10200"
          formControlName="zip_codes_text"
          hint="Separa con comas. Dejar vacío para no restringir."
        ></app-input>

        <!-- Estado -->
        <div
          class="flex items-center justify-between p-4 rounded-xl border border-[var(--color-border)] bg-gray-50/30 mt-6"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center border border-green-100"
            >
              <app-icon name="check" size="16" class="text-green-600"></app-icon>
            </div>
            <div>
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Estado Activo</span>
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

  departments: Department[] = [];
  cities: City[] = [];
  loadingDepartments = false;
  loadingCities = false;

  get departmentOptions(): { value: string; label: string }[] {
    return this.departments.map((d) => ({ value: d.name, label: d.name }));
  }

  get cityOptions(): { value: string; label: string }[] {
    return this.cities.map((c) => ({ value: c.name, label: c.name }));
  }

  constructor() {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      display_name: ['', Validators.maxLength(100)],
      department: [''],
      city: [''],
      zip_codes_text: [''],
      is_active: [true],
    });
  }

  async ngOnInit(): Promise<void> {
    await this.loadDepartments();

    if (this.zone && this.mode === 'edit') {
      await this.populateForm(this.zone);
    }
  }

  private async loadDepartments(): Promise<void> {
    this.loadingDepartments = true;
    try {
      const deps = await this.countryService.getDepartments();
      this.departments = deps.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      this.departments = [];
    } finally {
      this.loadingDepartments = false;
      this.cdr.markForCheck();
    }
  }

  private async loadCities(depName: string): Promise<void> {
    const dep = this.departments.find((d) => d.name === depName);
    if (!dep) {
      this.cities = [];
      this.cdr.markForCheck();
      return;
    }

    this.loadingCities = true;
    this.cdr.markForCheck();
    try {
      this.cities = await this.countryService.getCitiesByDepartment(dep.id);
    } catch {
      this.cities = [];
    } finally {
      this.loadingCities = false;
      this.cdr.markForCheck();
    }
  }

  private async populateForm(zone: ShippingZone): Promise<void> {
    const depName = zone.regions?.[0] || '';
    const cityName = zone.cities?.[0] || '';

    this.form.patchValue({
      name: zone.name,
      display_name: zone.display_name || '',
      department: depName,
      city: '',
      zip_codes_text: zone.zip_codes?.join(', ') || '',
      is_active: zone.is_active,
    });

    if (depName) {
      await this.loadCities(depName);
      if (cityName) {
        this.form.patchValue({ city: cityName }, { emitEvent: false });
        this.cdr.markForCheck();
      }
    }
  }

  async onDepartmentChange(depName: string | number | null): Promise<void> {
    this.form.patchValue({ city: '' }, { emitEvent: false });
    this.cities = [];

    if (depName && typeof depName === 'string') {
      await this.loadCities(depName);
    } else {
      this.cdr.markForCheck();
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

    const dto: CreateZoneDto = {
      name: values.name,
      display_name: values.display_name || undefined,
      countries: ['CO'],
      regions: values.department ? [values.department] : [],
      cities: values.city ? [values.city] : [],
      zip_codes: parseList(values.zip_codes_text),
      is_active: values.is_active,
    };

    const request$ = this.zone && this.mode === 'edit'
      ? this.shippingService.updateZone(this.zone.id, dto)
      : this.shippingService.createZone(dto);

    request$.subscribe({
      next: () => {
        this.isSubmitting = false;
        this.toast.show({
          variant: 'success',
          description: this.mode === 'edit'
            ? 'Zona actualizada correctamente'
            : 'Zona creada correctamente',
        });
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        this.saved.emit();
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        this.close.emit();
      },
      error: (err) => {
        this.isSubmitting = false;
        this.toast.show({
          variant: 'error',
          description: 'Error al guardar la zona: ' + (err.message || 'Error desconocido'),
        });
      },
    });
  }
}
