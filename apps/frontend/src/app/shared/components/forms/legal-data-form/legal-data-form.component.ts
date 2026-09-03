import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
import { ToggleComponent } from '../../toggle/toggle.component';
import { TooltipComponent } from '../../tooltip/tooltip.component';
import { AlertBannerComponent } from '../../alert-banner/alert-banner.component';
import { IconComponent } from '../../icon/icon.component';
import { computeNitDv, nitDvValidator } from '../../../utils/nit.util';
import {
  CountryService,
  Department,
  City,
} from '../../../../services/country.service';
import {
  FiscalResponsibilitiesCatalog,
  FiscalResponsibilityCatalogEntry,
  FiscalVatPeriodicity,
} from '../../../../private/modules/fiscal-operations/interfaces/fiscal-operations.interface';

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
  /**
   * Código DANE del municipio (Divipola 5 dígitos) — columna real
   * `stores.municipality_code` / `organizations.municipality_code`.
   */
  municipality_code: string;
  /** Código CIIU dedicado a la cascada store→org. */
  ciiu_code: string;
  /** Periodicidad de declaración de IVA (art. 600 ET). Solo si O-48. */
  vat_periodicity: FiscalVatPeriodicity | '';
  /** Marca de retenedor en la fuente. */
  is_withholding_agent: boolean;
  /** Marca de autorretenedor. */
  is_self_withholder: boolean;
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
  municipality_code: FormControl<string>;
  ciiu_code: FormControl<string>;
  vat_periodicity: FormControl<FiscalVatPeriodicity | ''>;
  is_withholding_agent: FormControl<boolean>;
  is_self_withholder: FormControl<boolean>;
}

/**
 * Lista de respaldo (compatibilidad hacia atrás). Cuando el padre no inyecta
 * un catálogo fresco del backend (panel "Identidad" lo hace; el wizard, antes
 * de este cambio, lo usaba para el listado de toggles), caemos a esta lista
 * estática para no romper consumidores existentes. Mantenemos los 6 códigos
 * que ya estaban antes más O-48 y O-49 que el wizard nunca llegó a mostrar.
 */
const TAX_RESPONSIBILITY_CODES: { code: string; label: string }[] = [
  { code: 'R-99-PN', label: 'R-99-PN - No aplica - Persona natural' },
  { code: 'O-13', label: 'O-13 - Gran contribuyente' },
  { code: 'O-15', label: 'O-15 - Autorretenedor' },
  { code: 'O-23', label: 'O-23 - Agente retención IVA' },
  { code: 'O-47', label: 'O-47 - Régimen simple de tributación' },
  { code: 'O-48', label: 'O-48 - Responsable de IVA' },
  { code: 'O-49', label: 'O-49 - No responsable de IVA' },
  { code: 'R-99-PJ', label: 'R-99-PJ - No aplica - Persona jurídica' },
];

/** Código DIAN "Responsable de IVA" — habilita el selector de periodicidad. */
const VAT_RESPONSIBLE_CODE = 'O-48';
/** Código DIAN "No responsable de IVA" — excluyente con O-48 (aviso suave). */
const VAT_NOT_RESPONSIBLE_CODE = 'O-49';

/** Document types that carry a DIAN verification digit (DV). Only NIT does. */
const DV_DOCUMENT_TYPES: ReadonlySet<NitType> = new Set<NitType>(['NIT']);

/** Document types whose number can be alphanumeric (passport, foreign IDs). */
const ALPHANUMERIC_DOCUMENT_TYPES: ReadonlySet<NitType> = new Set<NitType>([
  'PP',
  'CE',
  'NIT_EXTRANJERIA',
]);

const VALID_VAT_PERIODICITIES: FiscalVatPeriodicity[] = [
  'monthly',
  'bimonthly',
  'four_monthly',
];

@Component({
  selector: 'app-legal-data-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    TooltipComponent,
    AlertBannerComponent,
    IconComponent,
  ],
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

      <!--
        "Ubicación DIAN": códigos DANE del municipio (Divipola 5 dígitos) y
        CIIU dedicado. El backend persiste estos valores en columnas reales
        (stores.municipality_code, stores.ciiu_code) que consume
        calculateIca al generar declaraciones. El catálogo api-colombia es
        solo referencia (devuelve IDs no-DANE; el código oficial lo captura
        el usuario).
      -->
      @if (showLocationHelpers()) {
        <fieldset
          class="space-y-3 rounded-lg border border-border p-3 md:p-4 bg-[var(--color-surface-secondary)]"
        >
          <legend class="text-sm font-medium text-text-primary px-1">
            Ubicación DIAN
          </legend>
          <p class="text-xs text-text-secondary -mt-1">
            Códigos oficiales que viajan en tus documentos electrónicos y
            determinan la tarifa de ICA.
          </p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <app-input
                label="Código DANE del municipio"
                formControlName="municipality_code"
                placeholder="Ej: 11001 (Bogotá)"
                [maxlength]="10"
                [required]="requireMunicipalityCode()"
                helperText="Divipola 5 dígitos. Se persiste en store.municipality_code."
              ></app-input>
            </div>
            <div>
              <app-input
                label="Código CIIU (DIAN)"
                formControlName="ciiu_code"
                placeholder="Ej: 4711 (Comercio al por menor)"
                [maxlength]="10"
                helperText="4 dígitos. Se persiste en store.ciiu_code (cascada store→org)."
              ></app-input>
            </div>
          </div>

          <div>
            <div
              class="flex items-center gap-1.5 text-sm font-medium text-text-primary mb-2"
            >
              <span>Referencia geográfica (api-colombia)</span>
              <app-tooltip
                content="Selector auxiliar para confirmar departamento/municipio antes de capturar el código DANE."
                position="bottom"
                size="sm"
              >
                <span
                  class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                >
                  <app-icon name="help-circle" [size]="12"></app-icon>
                </span>
              </app-tooltip>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <app-selector
                [options]="departmentOptions()"
                [placeholder]="
                  loadingDepartments() ? 'Cargando...' : 'Departamento'
                "
                [disabled]="true"
              ></app-selector>
              <app-selector
                [options]="cityOptions()"
                [placeholder]="cityPlaceholder()"
                [disabled]="true"
              ></app-selector>
            </div>
            <p class="text-[11px] text-text-secondary mt-2">
              La api-colombia devuelve IDs no-DANE; usa los selectores como
              referencia y captura el código DANE manualmente arriba.
            </p>
          </div>
        </fieldset>
      }

      <!--
        Responsabilidades fiscales (casilla 53 del RUT). Cada toggle se
        renderiza desde el catálogo que el padre inyecta o, en su defecto,
        desde la lista de respaldo. Cuando O-48 está activo, aparece el
        selector de periodicidad de IVA debajo del toggle.
      -->
      @if (showResponsibilities()) {
        <fieldset
          class="space-y-3 rounded-lg border border-border p-3 md:p-4"
        >
          <legend class="text-sm font-medium text-text-primary px-1">
            Responsabilidades tributarias (RUT)
          </legend>
          <p class="text-xs text-text-secondary -mt-1">
            Marca todas las responsabilidades registradas en tu RUT. La
            principal (la de arriba) debe estar entre las marcadas.
          </p>

          @if (vatConflict()) {
            <app-alert-banner variant="warning" icon="alert-triangle">
              «Responsable de IVA» (O-48) y «No responsable de IVA» (O-49)
              son excluyentes. Revisa cuál aplica según tu RUT.
            </app-alert-banner>
          }

          <div class="space-y-2">
            @for (entry of responsibilityEntries(); track entry.code) {
              <div
                class="flex flex-col gap-1 rounded border border-border px-3 py-2 hover:bg-gray-50"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div
                      class="flex items-center gap-1.5 text-sm font-medium text-text-primary"
                    >
                      <span>{{ entry.label }}</span>
                      <span
                        class="text-[11px] font-semibold text-[var(--color-primary)] bg-[var(--color-primary-light)] rounded px-1.5 py-0.5"
                      >
                        {{ entry.code }}
                      </span>
                      @if (entryTooltip(entry)) {
                        <app-tooltip
                          [content]="entryTooltip(entry)"
                          position="bottom"
                          size="sm"
                        >
                          <span
                            class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                          >
                            <app-icon name="help-circle" [size]="12"></app-icon>
                          </span>
                        </app-tooltip>
                      }
                    </div>
                    @if (entryDescription(entry)) {
                      <p class="text-xs text-text-secondary mt-0.5 leading-5">
                        {{ entryDescription(entry) }}
                      </p>
                    }
                  </div>
                  <app-toggle
                    [checked]="isResponsibilityChecked(entry.code)"
                    [disabled]="disabled()"
                    [ariaLabel]="entry.label"
                    (toggled)="onResponsibilityToggle(entry.code, $event)"
                  ></app-toggle>
                </div>

                @if (
                  showVatPeriodicity() && entry.code === vatResponsibleCode
                ) {
                  <div
                    class="mt-1 ml-1 rounded-lg border border-border bg-[var(--color-surface)] p-3 md:max-w-md"
                  >
                    <div
                      class="flex items-center gap-1.5 text-sm font-medium text-text-primary mb-2"
                    >
                      <span>¿Cada cuánto declaras IVA?</span>
                      <app-tooltip
                        content="La DIAN la asigna según tus ingresos; la mayoría declara de forma bimestral."
                        position="bottom"
                        size="sm"
                      >
                        <span
                          class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                        >
                          <app-icon name="help-circle" [size]="12"></app-icon>
                        </span>
                      </app-tooltip>
                    </div>
                    <app-selector
                      [formControl]="vatPeriodicityControlProxy"
                      [options]="vatPeriodicityOptions"
                      placeholder="Selecciona la periodicidad"
                    ></app-selector>
                  </div>
                }
              </div>
            }
          </div>
        </fieldset>
      }

      <!--
        Retención en la fuente: dos toggles que la DIAN declara en el RUT.
        El primero activa el rol de agente retenedor; el segundo activa el
        régimen de autorretenedor. Son excluyentes solo a nivel conceptual —
        el panel "Identidad" los renderiza sin bloqueo, igual que acá.
      -->
      <fieldset class="space-y-3 rounded-lg border border-border p-3 md:p-4">
        <legend class="text-sm font-medium text-text-primary px-1">
          Retención en la fuente
        </legend>
        <p class="text-xs text-text-secondary -mt-1">
          Configura tu rol ante la DIAN para autorretenciones y retenciones
          que aplican a tus documentos.
        </p>

        <div
          class="flex flex-col gap-1 rounded border border-border px-3 py-2 hover:bg-gray-50"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div
                class="flex items-center gap-1.5 text-sm font-medium text-text-primary"
              >
                <span>¿Eres agente de retención en la fuente?</span>
                <app-tooltip
                  content="Activa el rol de retenedor. Tus facturas deben practicar retenciones en la fuente a tus clientes cuando aplique."
                  position="bottom"
                  size="sm"
                >
                  <span
                    class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                  >
                    <app-icon name="help-circle" [size]="12"></app-icon>
                  </span>
                </app-tooltip>
              </div>
              <p class="text-xs text-text-secondary mt-0.5 leading-5">
                Define si tu NIT está registrado como retenedor. Aparece en
                el RUT (casilla 54).
              </p>
            </div>
            <app-toggle
              [checked]="isWithholdingAgentChecked()"
              [disabled]="disabled()"
              ariaLabel="Agente de retención en la fuente"
              (toggled)="onWithholdingAgentToggle($event)"
            ></app-toggle>
          </div>
        </div>

        <div
          class="flex flex-col gap-1 rounded border border-border px-3 py-2 hover:bg-gray-50"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div
                class="flex items-center gap-1.5 text-sm font-medium text-text-primary"
              >
                <span>¿Eres autorretenedor?</span>
                <app-tooltip
                  content="Régimen de autorretención. Tus facturas liquidan autorretenciones sobre tu propia actividad económica."
                  position="bottom"
                  size="sm"
                >
                  <span
                    class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                  >
                    <app-icon name="help-circle" [size]="12"></app-icon>
                  </span>
                </app-tooltip>
              </div>
              <p class="text-xs text-text-secondary mt-0.5 leading-5">
                Define si tu NIT practica autorretenciones. Aparece en el RUT
                (casilla 55).
              </p>
            </div>
            <app-toggle
              [checked]="isSelfWithholderChecked()"
              [disabled]="disabled()"
              ariaLabel="Autorretenedor"
              (toggled)="onSelfWithholderToggle($event)"
            ></app-toggle>
          </div>
        </div>
      </fieldset>
    </form>
  `,
})
export class LegalDataFormComponent implements OnInit {
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

  /**
   * Catálogo fresco que el padre (panel Identidad) trae del backend. Cuando
   * se inyecta, el fieldset renderiza entradas desde acá (con descripción y
   * tooltip de efectos) en vez de la lista de respaldo. Si se omite, se usa
   * `TAX_RESPONSIBILITY_CODES` para no romper consumidores existentes.
   */
  readonly catalog = input<FiscalResponsibilitiesCatalog | null>(null);

  /**
   * Cuando es `true` y el toggle O-48 está encendido, se muestra el selector
   * de periodicidad de IVA. El Centro Fiscal lo controla desde fuera; el
   * wizard lo deja activo por defecto.
   */
  readonly showVatPeriodicity = input<boolean>(true);

  /**
   * Cuando es `true` se renderiza la tarjeta "Ubicación DIAN" con los
   * inputs de municipality_code y ciiu_code. El panel ya tiene su propia
   * tarjeta ICA; el wizard lo deja activo por defecto.
   */
  readonly showLocationHelpers = input<boolean>(true);

  /**
   * Hace que `municipality_code` sea obligatorio (aparece como `required` en
   * el input y entra al reporte de `describeProblems()`). Default `true`.
   */
  readonly requireMunicipalityCode = input<boolean>(true);

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

  /** Catálogo de responsabilidades expuesto al template (respaldo o inyectado). */
  private readonly fallbackResponsibilities = TAX_RESPONSIBILITY_CODES;
  readonly responsibilityEntries = computed<
    FiscalResponsibilityCatalogEntry[]
  >(() => {
    const cat = this.catalog();
    if (cat?.responsibilities?.length) return cat.responsibilities;
    // Adaptamos la lista de respaldo al shape del catálogo para que el
    // template sea uniforme. Mantenemos la descripción vacía y sin efectos
    // cuando no hay catálogo fresco.
    return this.fallbackResponsibilities.map((r) => ({
      code: r.code,
      label: r.label,
      description: '',
      effects: [],
    }));
  });

  readonly vatResponsibleCode = VAT_RESPONSIBLE_CODE;
  readonly vatNotResponsibleCode = VAT_NOT_RESPONSIBLE_CODE;

  /** True cuando O-48 y O-49 están marcadas a la vez (aviso suave). */
  readonly vatConflict = computed(() => {
    // Lee del signal mirror para que el `computed` reaccione a cada toggle.
    const selected = this.taxResponsibilitiesValue() ?? [];
    return (
      selected.includes(VAT_RESPONSIBLE_CODE) &&
      selected.includes(VAT_NOT_RESPONSIBLE_CODE)
    );
  });

  readonly vatPeriodicityOptions: SelectorOption[] = [
    { value: 'monthly', label: 'Mensual' },
    { value: 'bimonthly', label: 'Bimestral' },
    { value: 'four_monthly', label: 'Cuatrimestral' },
  ];

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
      tax_responsibilities: new FormControl<string[]>([], {
        nonNullable: true,
        validators: [Validators.minLength(1)],
      }),
      tax_scheme: new FormControl('', { nonNullable: true }),
      municipality_code: new FormControl('', { nonNullable: true }),
      ciiu_code: new FormControl('', { nonNullable: true }),
      vat_periodicity: new FormControl<FiscalVatPeriodicity | ''>('', {
        nonNullable: true,
      }),
      is_withholding_agent: new FormControl(false, { nonNullable: true }),
      is_self_withholder: new FormControl(false, { nonNullable: true }),
    },
    { validators: nitDvValidator },
  );

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

  readonly taxSchemeOptions: SelectorOption[] = this.fallbackResponsibilities.map(
    (r) => ({ value: r.code, label: r.label }),
  );

  /**
   * Etiquetas de los controles obligatorios, para poder nombrar en el error
   * exactamente lo que falta. Sin esto el usuario solo ve "hay campos
   * incompletos" sobre un formulario que a simple vista está lleno, y no tiene
   * forma de saber cuál falla — sobre todo con `department`/`city`, que son
   * selectores en cascada y quedan vacíos si el catálogo no cargó.
   */
  private static readonly REQUIRED_LABELS: Record<string, string> = {
    nit: 'Número de documento',
    nit_dv: 'Dígito de verificación',
    legal_name: 'Razón social',
    fiscal_address: 'Dirección fiscal',
    country: 'País',
    department: 'Departamento',
    city: 'Ciudad / Municipio',
  };

  /**
   * Lista legible de lo que impide guardar. Vacía cuando el formulario es
   * válido. Distingue campo faltante de campo inconsistente: un DV que no
   * corresponde al NIT no es un dato "incompleto" y decírselo así al usuario
   * lo manda a buscar un campo vacío que no existe.
   *
   * `municipality_code` solo se reporta cuando el flag
   * `requireMunicipalityCode` está activo (default `true`); el panel
   * "Identidad" lo desactiva porque ya tiene su propia tarjeta ICA.
   */
  describeProblems(): string[] {
    const problems: string[] = [];

    for (const [name, label] of Object.entries(
      LegalDataFormComponent.REQUIRED_LABELS,
    )) {
      const control = this.form.get(name);
      // Un control deshabilitado u oculto (DV cuando el documento no es NIT)
      // no participa en la validación y no debe reportarse.
      if (!control || control.disabled || control.valid) continue;
      problems.push(label);
    }

    if (this.requireMunicipalityCode()) {
      const muni = this.form.controls.municipality_code;
      if (muni && !muni.disabled && !muni.value.trim()) {
        problems.push('Código DANE del municipio');
      }
    }

    if (this.form.errors?.['nitDv']) {
      problems.push(
        'el dígito de verificación no corresponde al número de documento',
      );
    }

    return problems;
  }

  /** Single in-flight departments fetch shared across init + prefill paths. */
  private departmentsPromise: Promise<void> | null = null;
  private selectedTaxRegime: TaxRegime = 'COMUN';

  ngOnInit(): void {
    // Default country is CO, so load its department catalog eagerly. The
    // prefill path reuses the same promise (no double fetch).
    if (this.form.controls.country.value === 'CO') {
      void this.ensureDepartments();
    }
  }

  /**
   * Adapter that lets the template bind `vat_periodicity` to the same
   * `FormControl` that lives on the typed group (`form.controls.vat_periodicity`)
   * while keeping the public `getValue()` synchronous. The template uses
   * `[formControl]="vatPeriodicityControlProxy"` to stay compatible with
   * `SelectorComponent`'s CVA contract.
   */
  get vatPeriodicityControlProxy(): FormControl<FiscalVatPeriodicity | ''> {
    return this.form.controls.vat_periodicity;
  }

  /** Mirror signal para el template (reaccionar al form sin re-renderizar). */
  private readonly vatPeriodicityValue = toSignal(
    this.form.controls.vat_periodicity.valueChanges,
    { initialValue: this.form.controls.vat_periodicity.value },
  );

  /**
   * Mirror signal del array de responsabilidades marcadas. Lo necesitamos
   * porque `form.controls.tax_responsibilities.value` NO es un signal — leer
   * su valor dentro de un `effect()` no registra dependencia, así que el
   * effect no re-corre cuando el usuario togglea O-48 off. Con este signal,
   * cualquier `setValue` dispara `valueChanges` y el effect se re-ejecuta.
   */
  private readonly taxResponsibilitiesValue = toSignal(
    this.form.controls.tax_responsibilities.valueChanges,
    { initialValue: this.form.controls.tax_responsibilities.value },
  );

  constructor() {
    // Prefill from initial value: patch silently, then sync the derived
    // signals (DV visibility, country branch) and load the Colombia catalog
    // so the pre-existing department/city resolve to selectable options.
    effect(() => {
      const v = this.initialValue();
      if (!v) return;
      let patchedRegime: TaxRegime = v.tax_regime ?? 'COMUN';
      if (
        v.tax_responsibilities?.includes(VAT_NOT_RESPONSIBLE_CODE) &&
        !v.tax_responsibilities?.includes(VAT_RESPONSIBLE_CODE)
      ) {
        patchedRegime = 'SIMPLIFICADO';
      }
      this.selectedTaxRegime = patchedRegime;
      this.form.patchValue(
        {
          ...v,
          tax_regime: patchedRegime,
          vat_periodicity: this.normalizeVatPeriodicity(v.vat_periodicity),
        },
        { emitEvent: false },
      );

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

    // Limpia vat_periodicity cuando O-48 se desmarca: el backend lo ignora,
    // pero no queremos persistir basura ('') sobre una periodicidad que el
    // usuario no eligió. Leemos el array desde el signal mirror (no del
    // `.value` directo) para que el effect re-corra ante cada toggle.
    effect(() => {
      const selected = this.taxResponsibilitiesValue() ?? [];
      const isVatResponsible = selected.includes(VAT_RESPONSIBLE_CODE);
      const current = this.vatPeriodicityValue();
      if (!isVatResponsible && current) {
        this.form.controls.vat_periodicity.setValue('', { emitEvent: false });
      }
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

        const regime = this.form.controls.tax_regime.value;
        if (regime !== this.selectedTaxRegime) {
          this.selectedTaxRegime = regime;
          const currentResp = this.form.controls.tax_responsibilities.value;
          if (
            regime === 'SIMPLIFICADO' &&
            !currentResp.includes(VAT_NOT_RESPONSIBLE_CODE)
          ) {
            const next = [
              ...currentResp.filter((c) => c !== VAT_RESPONSIBLE_CODE),
              VAT_NOT_RESPONSIBLE_CODE,
            ];
            this.form.controls.tax_responsibilities.setValue(next, {
              emitEvent: false,
            });
          } else if (
            regime === 'COMUN' &&
            !currentResp.includes(VAT_RESPONSIBLE_CODE)
          ) {
            const next = [
              ...currentResp.filter((c) => c !== VAT_NOT_RESPONSIBLE_CODE),
              VAT_RESPONSIBLE_CODE,
            ];
            this.form.controls.tax_responsibilities.setValue(next, {
              emitEvent: false,
            });
          }
        }

        this.emitCurrent();
      });
  }

  // ── Public API for parent ─────────────────────────────────
  getValue(): LegalDataValue {
    const raw = this.form.getRawValue();
    return {
      ...raw,
      vat_periodicity: this.normalizeVatPeriodicity(raw.vat_periodicity),
    };
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

  onResponsibilityToggle(code: string, enabled: boolean): void {
    let current = this.form.controls.tax_responsibilities.value;
    if (enabled) {
      if (code === VAT_NOT_RESPONSIBLE_CODE) {
        current = current.filter((c) => c !== VAT_RESPONSIBLE_CODE);
        this.form.controls.tax_regime.setValue('SIMPLIFICADO', {
          emitEvent: false,
        });
        this.selectedTaxRegime = 'SIMPLIFICADO';
      } else if (code === VAT_RESPONSIBLE_CODE) {
        current = current.filter((c) => c !== VAT_NOT_RESPONSIBLE_CODE);
        this.form.controls.tax_regime.setValue('COMUN', {
          emitEvent: false,
        });
        this.selectedTaxRegime = 'COMUN';
      }
    }
    const next = enabled
      ? Array.from(new Set([...current, code]))
      : current.filter((c) => c !== code);
    this.form.controls.tax_responsibilities.setValue(next);
    // Limpia vat_periodicity cuando O-48 se apaga.
    if (!enabled && code === VAT_RESPONSIBLE_CODE) {
      this.form.controls.vat_periodicity.setValue('', { emitEvent: false });
    }
  }

  /** True cuando el toggle de "agente de retención" está encendido. */
  isWithholdingAgentChecked(): boolean {
    return this.form.controls.is_withholding_agent.value;
  }

  onWithholdingAgentToggle(enabled: boolean): void {
    this.form.controls.is_withholding_agent.setValue(enabled);
  }

  /** True cuando el toggle de "autorretenedor" está encendido. */
  isSelfWithholderChecked(): boolean {
    return this.form.controls.is_self_withholder.value;
  }

  onSelfWithholderToggle(enabled: boolean): void {
    this.form.controls.is_self_withholder.setValue(enabled);
  }

  /** Tooltip de efectos cuando el catálogo los expone (cadena vacía = nada). */
  entryTooltip(entry: FiscalResponsibilityCatalogEntry): string {
    if (!entry.effects?.length) return '';
    return `Activa: ${entry.effects.join(' • ')}`;
  }

  /** Descripción legible para la responsabilidad; vacío = no mostramos nada. */
  entryDescription(entry: FiscalResponsibilityCatalogEntry): string {
    return entry.description ?? '';
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

  /**
   * Mantiene `vat_periodicity` en el set conocido por el backend
   * (`monthly | bimonthly | four_monthly`). Lo que no esté en el set se
   * serializa como '' para que el backend lo descarte silenciosamente.
   */
  private normalizeVatPeriodicity(
    value: FiscalVatPeriodicity | '' | null | undefined,
  ): FiscalVatPeriodicity | '' {
    return VALID_VAT_PERIODICITIES.includes(value as FiscalVatPeriodicity)
      ? (value as FiscalVatPeriodicity)
      : '';
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
    this.valueChange.emit(this.getValue());
  }
}