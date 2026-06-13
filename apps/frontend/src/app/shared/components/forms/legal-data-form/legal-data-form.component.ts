import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { computeNitDv, nitDvValidator } from '../../../utils/nit.util';
import {
  CountryService,
  Department,
  City,
} from '../../../../services/country.service';

export type PersonType = 'NATURAL' | 'JURIDICA';
export type TaxRegime = 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';
export type NitType = 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

export interface LegalDataValue {
  nit: string;
  nit_dv: string;
  nit_type: NitType;
  legal_name: string;
  person_type: PersonType;
  tax_regime: TaxRegime;
  ciiu: string;
  fiscal_address: string;
  country: string;
  department: string;
  city: string;
  tax_responsibilities: string[];
  tax_scheme: string;
}

interface LegalDataControls {
  nit: FormControl<string>;
  nit_dv: FormControl<string>;
  nit_type: FormControl<NitType>;
  legal_name: FormControl<string>;
  person_type: FormControl<PersonType>;
  tax_regime: FormControl<TaxRegime>;
  ciiu: FormControl<string>;
  fiscal_address: FormControl<string>;
  country: FormControl<string>;
  department: FormControl<string>;
  city: FormControl<string>;
  tax_responsibilities: FormControl<string[]>;
  tax_scheme: FormControl<string>;
}

const TAX_RESPONSIBILITY_CODES: { code: string; label: string }[] = [
  { code: 'R-99-PN', label: 'R-99-PN - No aplica - Persona natural' },
  { code: 'O-13', label: 'O-13 - Gran contribuyente' },
  { code: 'O-15', label: 'O-15 - Autorretenedor' },
  { code: 'O-23', label: 'O-23 - Agente retención IVA' },
  { code: 'O-47', label: 'O-47 - Régimen simple de tributación' },
  { code: 'R-99-PJ', label: 'R-99-PJ - No aplica - Persona jurídica' },
];

/** Document types that carry a DIAN verification digit (DV). Only NIT does. */
const DV_DOCUMENT_TYPES: ReadonlySet<NitType> = new Set<NitType>(['NIT']);

/** Document types whose number can be alphanumeric (passport, foreign IDs). */
const ALPHANUMERIC_DOCUMENT_TYPES: ReadonlySet<NitType> = new Set<NitType>([
  'PP',
  'CE',
  'NIT_EXTRANJERIA',
]);

@Component({
  selector: 'app-legal-data-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, SelectorComponent],
  template: `
    <form [formGroup]="form" class="space-y-4">
      <!--
        Razón social FIRST: it is the primary legal-identity field and heads
        the form. (annotation A3 — input de razón social como primer input)
      -->
      <app-input
        label="Razón social"
        formControlName="legal_name"
        [required]="true"
        placeholder="Ej: Comercializadora ABC S.A.S."
      ></app-input>

      <!--
        Document identity. Type FIRST (it governs whether a DV applies and
        whether the number must be numeric), then the number, then the DV
        which only shows for NIT. (annotations A3/A4)
      -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <app-selector
          label="Tipo de documento"
          formControlName="nit_type"
          [options]="nitTypeOptions"
          [required]="true"
          placeholder="Seleccione tipo"
        ></app-selector>
        <div [ngClass]="requiresDv() ? '' : 'md:col-span-2'">
          <app-input
            [label]="documentNumberLabel()"
            formControlName="nit"
            [required]="true"
            [placeholder]="documentNumberPlaceholder()"
            (inputChange)="onNitChange($event)"
          ></app-input>
        </div>
        @if (requiresDv()) {
          <app-input
            label="Dígito de verificación"
            formControlName="nit_dv"
            [required]="true"
            [suffixIcon]="true"
            placeholder="DV"
            [helperText]="dvHint()"
          ></app-input>
        }
      </div>

      @if (requiresDv() && form.errors?.['nitDv']) {
        <p class="text-xs text-[var(--color-destructive)] -mt-2">
          El dígito de verificación no coincide con el NIT.
        </p>
      }

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <app-selector
          label="Tipo de persona"
          formControlName="person_type"
          [options]="personTypeOptions"
          [required]="true"
          placeholder="Seleccione tipo"
        ></app-selector>
        <app-selector
          label="Régimen tributario"
          formControlName="tax_regime"
          [options]="taxRegimeOptions"
          [required]="true"
          placeholder="Seleccione régimen"
        ></app-selector>
      </div>

      <!--
        A5: the "principal responsibility" is the single TaxLevelCode that
        DIAN reads from THIS issuer on every invoice. It is distinct from the
        full RUT list below — help text spells the difference out so the two
        controls no longer read as duplicates. (annotations A5/A6)
      -->
      <app-selector
        label="Responsabilidad principal del emisor (DIAN)"
        formControlName="tax_scheme"
        [options]="taxSchemeOptions"
        placeholder="Seleccione la principal"
        helpText="Código TaxLevelCode que viaja en TUS facturas como emisor. Debe ser una de las responsabilidades marcadas más abajo."
      ></app-selector>

      <app-input
        label="Código CIIU (Actividad económica)"
        formControlName="ciiu"
        placeholder="Ej: 4711"
        helperText="Clasificación Industrial Internacional Uniforme"
      ></app-input>

      <app-input
        label="Dirección fiscal"
        formControlName="fiscal_address"
        [required]="true"
        placeholder="Ej: Calle 100 # 15 - 20"
      ></app-input>

      <!--
        A7: country -> department -> city catalog. For Colombia the
        department/city selectors are fed from the api-colombia catalog via
        CountryService; other countries fall back to free text.
      -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <app-selector
          label="País"
          formControlName="country"
          [options]="countryOptions"
          [required]="true"
          placeholder="Seleccione país"
        ></app-selector>

        @if (isColombia()) {
          <app-selector
            label="Departamento"
            formControlName="department"
            [options]="departmentOptions()"
            [required]="true"
            [placeholder]="
              loadingDepartments() ? 'Cargando...' : 'Seleccione departamento'
            "
          ></app-selector>
          <app-selector
            label="Ciudad / Municipio"
            formControlName="city"
            [options]="cityOptions()"
            [required]="true"
            [placeholder]="cityPlaceholder()"
          ></app-selector>
        } @else {
          <app-input
            label="Departamento / Estado"
            formControlName="department"
            [required]="true"
            placeholder="Ej: Cundinamarca"
          ></app-input>
          <app-input
            label="Ciudad / Municipio"
            formControlName="city"
            [required]="true"
            placeholder="Ej: Bogotá"
          ></app-input>
        }
      </div>

      @if (showResponsibilities()) {
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium text-text-primary">
            Responsabilidades tributarias (RUT)
          </legend>
          <p class="text-xs text-text-secondary mb-2">
            Marca todas las responsabilidades registradas en tu RUT. La principal
            (la de arriba) debe estar entre las marcadas.
          </p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            @for (resp of taxResponsibilities; track resp.code) {
              <label
                class="flex items-start gap-2 text-sm cursor-pointer p-2 rounded border border-border hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  class="mt-0.5"
                  [checked]="isResponsibilityChecked(resp.code)"
                  [disabled]="disabled()"
                  (change)="onResponsibilityToggle(resp.code, $event)"
                />
                <span class="text-text-secondary">{{ resp.label }}</span>
              </label>
            }
          </div>
        </fieldset>
      }
    </form>
  `,
})
export class LegalDataFormComponent {
  // ── Inputs / Outputs ──────────────────────────────────────
  readonly initialValue = input<Partial<LegalDataValue> | null>(null);
  readonly disabled = input<boolean>(false);
  /**
   * Permite ocultar el fieldset de responsabilidades (casilla 53) cuando el
   * contenedor las gestiona con su propia UI (p. ej. el tab "Identidad" del
   * Centro Fiscal, que las renderiza como toggles desde el catálogo DIAN).
   * Default `true` para no alterar el wizard de activación.
   */
  readonly showResponsibilities = input<boolean>(true);

  readonly valueChange = output<LegalDataValue>();
  readonly validityChange = output<boolean>();

  // ── Services ──────────────────────────────────────────────
  private readonly countryService = inject(CountryService);
  private readonly destroyRef = inject(DestroyRef);

  // ── State ─────────────────────────────────────────────────
  readonly valid = signal(false);
  readonly dvHint = signal<string>('');

  /** Mirrors of form controls that drive reactive template branches. */
  private readonly selectedNitType = signal<NitType>('NIT');
  private readonly selectedCountry = signal<string>('CO');
  private readonly selectedDepartment = signal<string>('');

  /** Colombia catalog state (api-colombia via CountryService). */
  private readonly departments = signal<Department[]>([]);
  private readonly cities = signal<City[]>([]);
  readonly loadingDepartments = signal(false);
  readonly loadingCities = signal(false);

  readonly requiresDv = computed(() => DV_DOCUMENT_TYPES.has(this.selectedNitType()));
  readonly isColombia = computed(() => this.selectedCountry() === 'CO');
  readonly documentNumberLabel = computed(() =>
    this.selectedNitType() === 'NIT' ? 'NIT' : 'Número de documento',
  );
  readonly documentNumberPlaceholder = computed(() =>
    this.selectedNitType() === 'NIT' ? 'Ej: 900123456' : 'Ej: 1020304050',
  );

  readonly countryOptions: SelectorOption[] = this.countryService
    .getCountries()
    .map((c) => ({ value: c.code, label: c.name }));

  readonly departmentOptions = computed<SelectorOption[]>(() =>
    this.departments().map((d) => ({ value: d.name, label: d.name })),
  );
  readonly cityOptions = computed<SelectorOption[]>(() =>
    this.cities().map((c) => ({ value: c.name, label: c.name })),
  );
  readonly cityPlaceholder = computed(() => {
    if (this.loadingCities()) return 'Cargando...';
    if (!this.selectedDepartment()) return 'Seleccione departamento primero';
    return 'Seleccione ciudad';
  });

  // ── Typed form ────────────────────────────────────────────
  readonly form: FormGroup<LegalDataControls> = new FormGroup<LegalDataControls>(
    {
      nit: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^\d+$/)],
      }),
      nit_dv: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^\d$/)],
      }),
      nit_type: new FormControl<NitType>('NIT', { nonNullable: true }),
      legal_name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(2)],
      }),
      person_type: new FormControl<PersonType>('JURIDICA', { nonNullable: true }),
      tax_regime: new FormControl<TaxRegime>('COMUN', { nonNullable: true }),
      ciiu: new FormControl('', { nonNullable: true }),
      fiscal_address: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      country: new FormControl('CO', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      department: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      city: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      tax_responsibilities: new FormControl<string[]>([], { nonNullable: true }),
      tax_scheme: new FormControl('', { nonNullable: true }),
    },
    { validators: nitDvValidator },
  );

  readonly taxResponsibilities = TAX_RESPONSIBILITY_CODES;

  readonly personTypeOptions: SelectorOption[] = [
    { value: 'NATURAL', label: 'Persona Natural' },
    { value: 'JURIDICA', label: 'Persona Jurídica' },
  ];

  readonly nitTypeOptions: SelectorOption[] = [
    { value: 'NIT', label: 'NIT' },
    { value: 'CC', label: 'Cédula de ciudadanía' },
    { value: 'CE', label: 'Cédula de extranjería' },
    { value: 'TI', label: 'Tarjeta de identidad' },
    { value: 'PP', label: 'Pasaporte' },
    { value: 'NIT_EXTRANJERIA', label: 'NIT extranjería' },
  ];

  readonly taxRegimeOptions: SelectorOption[] = [
    { value: 'COMUN', label: 'Común' },
    { value: 'SIMPLIFICADO', label: 'Simplificado' },
    { value: 'GRAN_CONTRIBUYENTE', label: 'Gran Contribuyente' },
  ];

  readonly taxSchemeOptions: SelectorOption[] = TAX_RESPONSIBILITY_CODES.map(
    (r) => ({ value: r.code, label: r.label }),
  );

  /** Single in-flight departments fetch shared across init + prefill paths. */
  private departmentsPromise: Promise<void> | null = null;

  constructor() {
    // Default country is CO, so load its department catalog eagerly. The
    // prefill path reuses the same promise (no double fetch).
    if (this.form.controls.country.value === 'CO') {
      void this.ensureDepartments();
    }

    // Prefill from initial value: patch silently, then sync the derived
    // signals (DV visibility, country branch) and load the Colombia catalog
    // so the pre-existing department/city resolve to selectable options.
    effect(() => {
      const v = this.initialValue();
      if (!v) return;
      this.form.patchValue(v, { emitEvent: false });

      const type = this.form.controls.nit_type.value;
      this.selectedNitType.set(type);
      this.applyDocumentTypeRules(type);

      const country = this.form.controls.country.value;
      this.selectedCountry.set(country);
      if (country === 'CO') {
        const dept = this.form.controls.department.value;
        void this.ensureDepartments().then(() => {
          if (dept) {
            this.selectedDepartment.set(dept);
            void this.loadCities(dept);
          }
        });
      }
      this.emitCurrent();
    });

    // Disabled state
    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    // React to user edits: document type drives DV/number validators;
    // country drives the Colombia catalog; department drives the city list.
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const type = this.form.controls.nit_type.value;
        if (type !== this.selectedNitType()) {
          this.selectedNitType.set(type);
          this.applyDocumentTypeRules(type);
        }

        const country = this.form.controls.country.value;
        if (country !== this.selectedCountry()) {
          this.selectedCountry.set(country);
          // Country changed → previous department/city are stale.
          this.form.controls.department.setValue('', { emitEvent: false });
          this.form.controls.city.setValue('', { emitEvent: false });
          this.selectedDepartment.set('');
          this.cities.set([]);
          if (country === 'CO') void this.ensureDepartments();
          else this.departments.set([]);
        }

        const dept = this.form.controls.department.value;
        if (this.selectedCountry() === 'CO' && dept !== this.selectedDepartment()) {
          this.selectedDepartment.set(dept);
          // Department changed → reset the city and reload its options.
          this.form.controls.city.setValue('', { emitEvent: false });
          if (dept) void this.loadCities(dept);
          else this.cities.set([]);
        }

        this.emitCurrent();
      });
  }

  // ── Public API for parent ─────────────────────────────────
  getValue(): LegalDataValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  // ── Template helpers ──────────────────────────────────────
  onNitChange(nit: string): void {
    if (this.selectedNitType() !== 'NIT') {
      this.dvHint.set('');
      return;
    }
    const expected = computeNitDv(nit);
    this.dvHint.set(expected ? `DV sugerido: ${expected}` : '');
  }

  isResponsibilityChecked(code: string): boolean {
    return this.form.controls.tax_responsibilities.value.includes(code);
  }

  onResponsibilityToggle(code: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.form.controls.tax_responsibilities.value;
    const next = checked
      ? Array.from(new Set([...current, code]))
      : current.filter((c) => c !== code);
    this.form.controls.tax_responsibilities.setValue(next);
  }

  // ── Internal ──────────────────────────────────────────────
  /**
   * Adjusts the number/DV validators for the chosen document type. Only NIT
   * carries a verification digit; passports / foreign IDs may be alphanumeric.
   */
  private applyDocumentTypeRules(type: NitType): void {
    const num = this.form.controls.nit;
    const dv = this.form.controls.nit_dv;

    num.setValidators(
      ALPHANUMERIC_DOCUMENT_TYPES.has(type)
        ? [Validators.required]
        : [Validators.required, Validators.pattern(/^\d+$/)],
    );
    num.updateValueAndValidity({ emitEvent: false });

    if (DV_DOCUMENT_TYPES.has(type)) {
      dv.setValidators([Validators.required, Validators.pattern(/^\d$/)]);
    } else {
      dv.clearValidators();
      dv.setValue('', { emitEvent: false });
      this.dvHint.set('');
    }
    dv.updateValueAndValidity({ emitEvent: false });
  }

  private ensureDepartments(): Promise<void> {
    if (!this.departmentsPromise) {
      this.departmentsPromise = this.loadDepartments();
    }
    return this.departmentsPromise;
  }

  private async loadDepartments(): Promise<void> {
    this.loadingDepartments.set(true);
    try {
      const list = await this.countryService.getDepartments();
      this.departments.set(
        [...list].sort((a, b) => a.name.localeCompare(b.name)),
      );
    } finally {
      this.loadingDepartments.set(false);
    }
  }

  private async loadCities(departmentName: string): Promise<void> {
    const dept = this.departments().find((d) => d.name === departmentName);
    if (!dept) {
      this.cities.set([]);
      return;
    }
    this.loadingCities.set(true);
    try {
      const list = await this.countryService.getCitiesByDepartment(dept.id);
      this.cities.set([...list].sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      this.loadingCities.set(false);
    }
  }

  private emitCurrent(): void {
    const isValid = this.form.valid;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.form.getRawValue());
  }
}
