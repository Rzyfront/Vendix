import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import {
  CountryService,
  Country,
  Department,
  City,
} from '../../../../../../services/country.service';
import { CreateAddressPayload } from '../../services/store-orders.service';

/**
 * Modal de captura de dirección de envío para una orden (A3-edit).
 *
 * Presentacional: NO realiza llamadas HTTP. Captura y valida la dirección con
 * el vocabulario del DTO backend (`address_line_1`, `state`, `country`) y la
 * emite por `submitForm`; el padre (order-details) la persiste
 * (`POST /store/addresses` → `PATCH /store/orders/:id`) y controla `saving`.
 *
 * Cascada país → departamento → ciudad reutilizando `CountryService`
 * (Colombia), igual que el modal de direcciones de ecommerce. En submit los
 * IDs de departamento/ciudad se convierten a nombre, que es lo que el backend
 * almacena en `state_province`/`city`.
 *
 * Zoneless-clean: signals + ReactiveForms, sin APIs legacy de CD.
 */
@Component({
  selector: 'app-shipping-address-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      title="Agregar dirección de entrega"
      [subtitle]="customerName() || 'Cliente'"
      size="md"
      (cancel)="close.emit()"
      (closed)="close.emit()"
    >
      <form [formGroup]="form" class="space-y-3" (ngSubmit)="submit()">
        <div
          class="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-700"
        >
          <app-icon name="info" [size]="14" class="mt-0.5 flex-shrink-0"></app-icon>
          <span>
            La dirección quedará vinculada al cliente y se asignará como destino
            de envío de esta orden.
          </span>
        </div>

        <app-input
          label="Dirección"
          placeholder="Calle 123 #45-67"
          formControlName="address_line_1"
          [control]="form.get('address_line_1')"
        ></app-input>

        <app-input
          label="Complemento (opcional)"
          placeholder="Apto, torre, barrio…"
          formControlName="address_line_2"
        ></app-input>

        <app-selector
          label="País"
          placeholder="Selecciona el país"
          [options]="countryOptions()"
          [searchable]="true"
          formControlName="country_code"
        ></app-selector>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <app-selector
            label="Departamento"
            [placeholder]="loadingDepartments() ? 'Cargando…' : 'Selecciona'"
            [options]="departmentOptions()"
            [searchable]="true"
            formControlName="state_province"
          ></app-selector>

          <app-selector
            label="Ciudad"
            [placeholder]="loadingCities() ? 'Cargando…' : 'Selecciona'"
            [options]="cityOptions()"
            [searchable]="true"
            formControlName="city"
          ></app-selector>
        </div>

        <app-input
          label="Código postal (opcional)"
          placeholder="000000"
          formControlName="postal_code"
        ></app-input>

        <app-textarea
          label="Instrucciones de entrega (opcional)"
          placeholder="Dejar con portería, timbre dañado, etc."
          [rows]="2"
          formControlName="delivery_instructions"
        ></app-textarea>
      </form>

      <div slot="footer" class="flex items-center justify-end gap-2">
        <app-button
          variant="ghost"
          type="button"
          [disabled]="saving()"
          (clicked)="close.emit()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          type="button"
          [loading]="saving()"
          [disabled]="form.invalid || saving()"
          (clicked)="submit()"
        >
          Guardar dirección
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ShippingAddressModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly countryService = inject(CountryService);

  /** Cliente al que se vinculará la dirección (de `order.customer_id`). */
  readonly customerId = input<number | null>(null);
  /** Nombre del cliente, solo para el subtítulo del modal. */
  readonly customerName = input<string>('');
  /** True mientras el padre persiste (POST + PATCH). */
  readonly saving = input<boolean>(false);

  /** Cierra el modal sin guardar. */
  readonly close = output<void>();
  /** Emite el payload listo para `POST /store/addresses`. */
  readonly submitForm = output<CreateAddressPayload>();

  readonly form: FormGroup = this.fb.group({
    address_line_1: ['', [Validators.required, Validators.minLength(5)]],
    address_line_2: [''],
    country_code: ['CO', Validators.required],
    state_province: [
      { value: '', disabled: true },
      [Validators.required],
    ],
    city: [{ value: '', disabled: true }, [Validators.required]],
    postal_code: [''],
    delivery_instructions: [''],
  });

  // Datos de ubicación — signals
  readonly countries = signal<Country[]>([]);
  readonly departments = signal<Department[]>([]);
  readonly cities = signal<City[]>([]);
  readonly loadingDepartments = signal(false);
  readonly loadingCities = signal(false);

  readonly countryOptions = computed<SelectorOption[]>(() =>
    this.countries().map((c) => ({ value: c.code, label: c.name })),
  );
  readonly departmentOptions = computed<SelectorOption[]>(() =>
    this.departments().map((d) => ({ value: d.id, label: d.name })),
  );
  readonly cityOptions = computed<SelectorOption[]>(() =>
    this.cities().map((c) => ({ value: c.id, label: c.name })),
  );

  constructor() {
    this.countries.set(this.countryService.getCountries());
    this.setupLocationListeners();
    this.loadDepartments();
  }

  private setupLocationListeners(): void {
    const countryControl = this.form.get('country_code');
    const depControl = this.form.get('state_province');
    const cityControl = this.form.get('city');

    countryControl?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code: string) => {
        if (code === 'CO') {
          this.loadDepartments();
        } else {
          this.departments.set([]);
          this.cities.set([]);
          depControl?.setValue('');
          cityControl?.setValue('');
          depControl?.disable({ emitEvent: false });
          cityControl?.disable({ emitEvent: false });
        }
      });

    depControl?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((depId: unknown) => {
        if (depId) {
          const numericDepId = Number(depId);
          if (!isNaN(numericDepId)) this.loadCities(numericDepId);
        } else {
          this.cities.set([]);
          cityControl?.setValue('');
          cityControl?.disable({ emitEvent: false });
        }
      });
  }

  private async loadDepartments(): Promise<void> {
    const ctrl = this.form.get('state_province');
    ctrl?.disable({ emitEvent: false });
    this.loadingDepartments.set(true);
    const deps = await this.countryService.getDepartments();
    this.departments.set(deps);
    this.loadingDepartments.set(false);
    if (this.departments().length > 0) ctrl?.enable({ emitEvent: false });
  }

  private async loadCities(depId: number): Promise<void> {
    const ctrl = this.form.get('city');
    ctrl?.disable({ emitEvent: false });
    this.loadingCities.set(true);
    const cities = await this.countryService.getCitiesByDepartment(depId);
    this.cities.set(cities);
    this.loadingCities.set(false);
    if (this.cities().length > 0) ctrl?.enable({ emitEvent: false });
  }

  submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    // `getRawValue` incluye los controles deshabilitados por la cascada.
    const raw = this.form.getRawValue();

    // Para Colombia los selectores manejan IDs; el backend almacena nombres.
    let stateName = String(raw.state_province ?? '');
    let cityName = String(raw.city ?? '');
    if (raw.country_code === 'CO') {
      const dep = this.departments().find((d) => d.id === Number(raw.state_province));
      if (dep) stateName = dep.name;
      const city = this.cities().find((c) => c.id === Number(raw.city));
      if (city) cityName = city.name;
    }

    const payload: CreateAddressPayload = {
      address_line_1: String(raw.address_line_1).trim(),
      city: cityName,
      state: stateName,
      country: String(raw.country_code),
      type: 'shipping',
    };
    if (raw.address_line_2?.trim()) payload.address_line_2 = raw.address_line_2.trim();
    if (raw.postal_code?.trim()) payload.postal_code = raw.postal_code.trim();
    if (raw.delivery_instructions?.trim())
      payload.delivery_instructions = raw.delivery_instructions.trim();
    const cid = this.customerId();
    if (cid != null) payload.customer_id = cid;

    this.submitForm.emit(payload);
  }
}
