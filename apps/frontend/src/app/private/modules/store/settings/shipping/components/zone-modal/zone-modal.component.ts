import {Component, computed, input, output, OnInit, inject, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ShippingZone,
  CreateZoneDto,
} from '../../interfaces/shipping-zones.interface';
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
  MultiSelectorComponent,
  ButtonComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { dedupeGeoNames } from '../../../../../../../core/utils/geo-name.util';

@Component({
  selector: 'app-zone-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ToggleComponent,
    IconComponent,
    MultiSelectorComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="
        mode() === 'create' ? 'Crear Zona de Envío' : 'Editar Zona de Envío'
      "
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
        <div
          class="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-gray-50/30"
        >
          <span class="text-xl">🇨🇴</span>
          <div>
            <p class="text-sm font-semibold text-[var(--color-text-primary)]">
              Colombia
            </p>
            <p class="text-xs text-[var(--color-text-secondary)]">
              País de cobertura
            </p>
          </div>
        </div>

        <!-- Departamentos (múltiples) -->
        <div>
          @if (loadingDepartments) {
            <div class="flex items-center gap-2 p-3 text-sm text-gray-400">
              <app-icon name="loader-2" size="16" [spin]="true"></app-icon>
              Cargando departamentos...
            </div>
          } @else {
            <app-multi-selector
              label="Departamentos (opcional)"
              formControlName="departments"
              [options]="departmentOptions"
              placeholder="Todo Colombia"
              (valueChange)="onDepartmentsChange($event)"
            ></app-multi-selector>
          }
          <p
            class="text-[10px] text-gray-400 mt-1.5 px-1 flex items-center gap-1"
          >
            <app-icon name="info" size="10"></app-icon>
            Puedes elegir varios. Dejar vacío para cubrir todo el país.
          </p>
        </div>

        <!-- Ciudades (cascada desde los departamentos elegidos) -->
        <div>
          @if (loadingCities) {
            <div class="flex items-center gap-2 p-3 text-sm text-gray-400">
              <app-icon name="loader-2" size="16" [spin]="true"></app-icon>
              Cargando ciudades...
            </div>
          } @else {
            <app-multi-selector
              label="Ciudades específicas (opcional)"
              formControlName="cities"
              [options]="cityOptions"
              [disabled]="selectedDepartments().length === 0"
              placeholder="Todos los municipios de esos departamentos"
              (valueChange)="onCitiesChange($event)"
            ></app-multi-selector>
          }
          <p
            class="text-[10px] text-gray-400 mt-1.5 px-1 flex items-center gap-1"
          >
            <app-icon name="info" size="10"></app-icon>
            Selecciona primero uno o más departamentos. Dejar vacío para cubrir
            todos sus municipios.
          </p>
        </div>

        <!-- Alcance resultante: la cobertura es lo que más confunde al
             configurar zonas, así que se dice en palabras. -->
        <div
          class="flex items-start gap-2 p-3 rounded-xl border border-[var(--color-border)] bg-gray-50/30"
        >
          <app-icon
            name="map-pin"
            size="14"
            class="text-indigo-600 mt-0.5"
          ></app-icon>
          <p class="text-xs text-[var(--color-text-secondary)]">
            {{ coverageSummary() }}
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
          [loading]="isSubmitting()"
          [disabled]="form.invalid"
          (clicked)="onSubmit()"
        >
          <app-icon name="save" size="18" slot="icon" class="mr-2"></app-icon>
          {{ mode() === 'edit' ? 'Guardar Cambios' : 'Crear Zona' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ZoneModalComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  readonly zone = input<ShippingZone>();
  readonly mode = input<'create' | 'edit'>('create');
  readonly close = output<void>();
  readonly saved = output<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingMethodsService);
  private countryService = inject(CountryService);
  private toast = inject(ToastService);

  form: FormGroup;
  readonly isSubmitting = signal(false);

  departments: Department[] = [];
  loadingDepartments = false;
  loadingCities = false;

  /**
   * Ciudades por nombre de departamento. Una zona puede cubrir varios
   * departamentos, así que hay que acumular sus municipios en vez de pisar la
   * lista con cada cambio.
   */
  private readonly citiesByDepartment = signal<Record<string, City[]>>({});

  /** Espejo reactivo de los departamentos elegidos (zoneless: el template lo lee). */
  readonly selectedDepartments = signal<string[]>([]);
  /** Espejo reactivo de las ciudades elegidas. */
  readonly selectedCities = signal<string[]>([]);

  get departmentOptions(): { value: string; label: string }[] {
    return this.departments.map((d) => ({ value: d.name, label: d.name }));
  }

  /**
   * Unión de los municipios de todos los departamentos seleccionados. El nombre
   * del departamento va como `description` porque hay municipios homónimos en
   * departamentos distintos.
   */
  get cityOptions(): {
    value: string;
    label: string;
    description?: string;
  }[] {
    const byDepartment = this.citiesByDepartment();
    return this.selectedDepartments().flatMap((depName) =>
      (byDepartment[depName] ?? []).map((c) => ({
        value: c.name,
        label: c.name,
        description: depName,
      })),
    );
  }

  /** Explica en palabras qué va a cubrir la zona con la selección actual. */
  readonly coverageSummary = computed(() => {
    const deps = this.selectedDepartments();
    const cities = this.selectedCities();

    if (deps.length === 0) {
      return 'Esta zona cubrirá todo Colombia. Sirve como cobertura de respaldo para las direcciones que ninguna otra zona alcance.';
    }
    if (cities.length === 0) {
      return `Esta zona cubrirá todos los municipios de ${deps.length === 1 ? deps[0] : `${deps.length} departamentos`}.`;
    }
    return `Esta zona cubrirá ${cities.length === 1 ? cities[0] : `${cities.length} municipios`}. Las direcciones de otras ciudades no podrán finalizar la compra salvo que otra zona las cubra.`;
  });

  constructor() {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      departments: [[] as string[]],
      display_name: ['', Validators.maxLength(100)],
      cities: [[] as string[]],
      zip_codes_text: [''],
      is_active: [true],
    });
  }

  async ngOnInit(): Promise<void> {
    await this.loadDepartments();

    const currentZone = this.zone();
    const currentMode = this.mode();
    if (currentZone && currentMode === 'edit') {
      await this.populateForm(currentZone);
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
    }
  }

  /**
   * Carga (y cachea) los municipios de los departamentos indicados que aún no
   * se hayan traído. Nunca descarta lo ya cargado: la zona puede cubrir varios.
   */
  private async loadCitiesFor(depNames: string[]): Promise<void> {
    const pending = depNames.filter(
      (name) => !(name in this.citiesByDepartment()),
    );
    if (pending.length === 0) return;

    this.loadingCities = true;
    try {
      const loaded = await Promise.all(
        pending.map(async (name) => {
          const dep = this.departments.find((d) => d.name === name);
          if (!dep) return [name, [] as City[]] as const;
          try {
            return [
              name,
              await this.countryService.getCitiesByDepartment(dep.id),
            ] as const;
          } catch {
            // El catálogo puede caerse; dejamos el departamento sin municipios
            // en vez de romper el modal. La zona igual se puede guardar a nivel
            // de departamento.
            return [name, [] as City[]] as const;
          }
        }),
      );

      this.citiesByDepartment.update((current) => {
        const next = { ...current };
        for (const [name, cities] of loaded) next[name] = cities;
        return next;
      });
    } finally {
      this.loadingCities = false;
    }
  }

  private async populateForm(zone: ShippingZone): Promise<void> {
    const depNames = zone.regions ?? [];
    const cityNames = zone.cities ?? [];

    this.form.patchValue({
      name: zone.name,
      display_name: zone.display_name || '',
      departments: depNames,
      cities: [],
      zip_codes_text: zone.zip_codes?.join(', ') || '',
      is_active: zone.is_active,
    });
    this.selectedDepartments.set(depNames);

    if (depNames.length > 0) {
      await this.loadCitiesFor(depNames);
      if (cityNames.length > 0) {
        // Antes esto leía sólo `zone.cities[0]`, así que editar una zona con
        // varias ciudades perdía todas menos la primera al guardar.
        this.form.patchValue({ cities: cityNames }, { emitEvent: false });
        this.selectedCities.set(cityNames);
      }
    }
  }

  async onDepartmentsChange(value: (string | number)[]): Promise<void> {
    const depNames = (value ?? []).map((v) => String(v));
    this.selectedDepartments.set(depNames);

    await this.loadCitiesFor(depNames);

    // Quitar las ciudades que ya no pertenecen a ningún departamento elegido.
    const stillValid = new Set(this.cityOptions.map((o) => o.value));
    const prunedCities = this.selectedCities().filter((c) =>
      stillValid.has(c),
    );
    this.selectedCities.set(prunedCities);
    this.form.patchValue({ cities: prunedCities }, { emitEvent: false });
  }

  onCitiesChange(value: (string | number)[]): void {
    this.selectedCities.set((value ?? []).map((v) => String(v)));
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    const values = this.form.value;

    const parseList = (text: string): string[] =>
      text
        ? text
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];

    // Se persiste el nombre legible del catálogo, pero se deduplica por forma
    // normalizada: el backend resuelve las zonas comparando normalizado, así
    // que "Bogotá" y "bogota" en la misma zona serían la misma entrada.
    const dto: CreateZoneDto = {
      name: values.name,
      display_name: values.display_name || undefined,
      countries: ['CO'],
      regions: dedupeGeoNames(values.departments ?? []),
      cities: dedupeGeoNames(values.cities ?? []),
      zip_codes: dedupeGeoNames(parseList(values.zip_codes_text)),
      is_active: values.is_active,
    };

    const currentZone = this.zone();
    const currentMode = this.mode();
    const request$ =
      currentZone && currentMode === 'edit'
        ? this.shippingService.updateZone(currentZone.id, dto)
        : this.shippingService.createZone(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.toast.show({
          variant: 'success',
          description:
            currentMode === 'edit'
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
        this.isSubmitting.set(false);
        this.toast.show({
          variant: 'error',
          description:
            'Error al guardar la zona: ' + (err.message || 'Error desconocido'),
        });
      },
    });
  }
}
