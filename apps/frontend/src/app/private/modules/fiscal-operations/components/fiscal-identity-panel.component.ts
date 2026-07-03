import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  ToggleComponent,
  TooltipComponent,
} from '../../../../shared/components/index';
import {
  LegalDataFormComponent,
  LegalDataValue,
  NitType,
  PersonType,
  TaxRegime,
} from '../../../../shared/components/forms/legal-data-form/legal-data-form.component';
import { RutScannerModalComponent } from '../../../../shared/components/fiscal-activation-wizard/components/rut-scanner-modal.component';
import {
  RutScanResult,
  RutScannerScope,
} from '../../../../shared/components/fiscal-activation-wizard/interfaces/rut-scan-result.interface';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { CountryService } from '../../../../services/country.service';
import {
  ApiResponse,
  FiscalApiScope,
  FiscalDataEnvelope,
  FiscalDataResponse,
  FiscalDataSettings,
  FiscalResponsibilityCatalogEntry,
  FiscalVatPeriodicity,
} from '../interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from '../services/fiscal-operations.service';
import { FiscalOperationsHeaderActionsService } from '../services/fiscal-operations-header-actions.service';

/** Código DIAN "Responsable de IVA" — habilita el selector de periodicidad. */
const VAT_RESPONSIBLE_CODE = 'O-48';
/** Código DIAN "No responsable de IVA" — excluyente con O-48 (aviso suave). */
const VAT_NOT_RESPONSIBLE_CODE = 'O-49';

const VALID_TAX_REGIMES: TaxRegime[] = [
  'COMUN',
  'SIMPLIFICADO',
  'GRAN_CONTRIBUYENTE',
];

const VALID_NIT_TYPES: NitType[] = [
  'NIT',
  'CC',
  'CE',
  'TI',
  'PP',
  'NIT_EXTRANJERIA',
];

const VALID_VAT_PERIODICITIES: FiscalVatPeriodicity[] = [
  'monthly',
  'bimonthly',
  'four_monthly',
];

/**
 * Tab "Identidad" del Centro Fiscal — editor post-wizard de la identidad
 * fiscal. El wizard detecta responsabilidades con IA al activar; este panel
 * permite reconfigurarlas después: datos legales editables, toggles por
 * responsabilidad DIAN (casilla 53 del RUT) con descripciones amigables,
 * periodicidad de IVA y re-escaneo de RUT con IA.
 *
 * Los cambios se guardan con PATCH-merge sobre `settings.fiscal_data`
 * (mismo endpoint del wizard) y solo afectan la generación de obligaciones
 * de períodos futuros.
 */
@Component({
  selector: 'app-fiscal-identity-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    TooltipComponent,
    LegalDataFormComponent,
    RutScannerModalComponent,
  ],
  template: `
    <section class="space-y-4">
      @if (loading()) {
        <!-- Skeleton de carga -->
        <div class="space-y-4 animate-pulse" aria-hidden="true">
          <div class="h-12 rounded-xl bg-gray-200"></div>
          <div class="h-72 rounded-xl bg-gray-200"></div>
          <div class="h-56 rounded-xl bg-gray-200"></div>
        </div>
      } @else if (loadError()) {
        <app-card>
          <div class="flex flex-col items-center gap-3 py-10 text-center">
            <app-icon
              name="alert-triangle"
              [size]="32"
              class="text-amber-500"
            ></app-icon>
            <p class="text-sm font-medium text-text-primary">
              No pudimos cargar tu identidad fiscal
            </p>
            <p class="text-xs text-text-secondary max-w-md">
              {{ loadError() }}
            </p>
            <app-button variant="outline" size="sm" (clicked)="load()">
              <span class="inline-flex items-center gap-2">
                <app-icon name="refresh-cw" [size]="14"></app-icon>
                Reintentar
              </span>
            </app-button>
          </div>
        </app-card>
      } @else {
        <!-- Aviso de alcance temporal de los cambios -->
        <app-alert-banner variant="info" icon="info">
          Los cambios afectan las obligaciones de períodos futuros; las ya
          generadas no se modifican.
        </app-alert-banner>

        <!-- Card 1: Identidad fiscal (datos legales) -->
        <app-card>
          <div
            class="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 mb-4"
          >
            <div>
              <h2 class="text-base font-semibold text-text-primary">
                Identidad fiscal
              </h2>
              <p class="text-xs text-text-secondary mt-0.5">
                Datos legales y tributarios que viajan en tus documentos
                fiscales.
              </p>
            </div>
            <app-button
              variant="outline"
              size="sm"
              [disabled]="saving()"
              (clicked)="openScanner()"
            >
              <span class="inline-flex items-center gap-2">
                <app-icon name="sparkles" [size]="14"></app-icon>
                Re-escanear RUT
              </span>
            </app-button>
          </div>

          <app-legal-data-form
            #legalForm
            [initialValue]="formSeed()"
            [disabled]="saving()"
            [showResponsibilities]="false"
            (validityChange)="legalValid.set($event)"
            (valueChange)="onLegalValueChange($event)"
          ></app-legal-data-form>
        </app-card>

        <!-- Card 2: Responsabilidades fiscales como toggles -->
        <app-card>
          <div class="border-b border-border pb-3 mb-2">
            <h2 class="text-base font-semibold text-text-primary">
              Responsabilidades fiscales
            </h2>
            <p class="text-xs text-text-secondary mt-0.5">
              Casilla 53 del RUT. Cada responsabilidad activa o desactiva
              obligaciones en tu calendario fiscal.
            </p>
          </div>

          @if (vatConflict()) {
            <div class="my-3">
              <app-alert-banner variant="warning" icon="alert-triangle">
                «Responsable de IVA» (O-48) y «No responsable de IVA» (O-49)
                son excluyentes. Revisa cuál aplica según tu RUT.
              </app-alert-banner>
            </div>
          }

          <div class="divide-y divide-border">
            @for (entry of catalog(); track entry.code) {
              <div class="py-3">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div
                      class="flex items-center gap-1.5 text-sm font-medium text-text-primary"
                    >
                      <span>{{ entry.label }}</span>
                      <span
                        class="text-[11px] font-semibold text-primary-700 bg-primary-600/10 rounded px-1.5 py-0.5"
                      >
                        {{ entry.code }}
                      </span>
                      @if (entry.effects.length) {
                        <app-tooltip
                          [content]="effectsTooltip(entry)"
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
                    <p class="text-xs text-text-secondary mt-1 leading-5">
                      {{ entry.description }}
                    </p>
                  </div>
                  <app-toggle
                    [checked]="isSelected(entry.code)"
                    [disabled]="saving()"
                    [ariaLabel]="entry.label"
                    (toggled)="onResponsibilityToggled(entry.code, $event)"
                  ></app-toggle>
                </div>

                <!-- Periodicidad de IVA: solo visible con O-48 encendido -->
                @if (entry.code === vatResponsibleCode && showVatSelector()) {
                  <div
                    class="mt-3 ml-1 rounded-lg border border-border bg-surface p-3 md:max-w-md"
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
                      [formControl]="vatPeriodicityControl"
                      [options]="vatPeriodicityOptions"
                      placeholder="Selecciona la periodicidad"
                    ></app-selector>
                  </div>
                }
              </div>
            }
          </div>

          @if (unknownCodes().length) {
            <p class="text-xs text-text-secondary mt-3">
              Otros códigos registrados en tu RUT (se conservan al guardar):
              {{ unknownCodes().join(', ') }}
            </p>
          }
        </app-card>

        <!-- Card 3: Ubicación ICA — municipio DANE + CIIU en cascada -->
        <app-card>
          <div class="border-b border-border pb-3 mb-4">
            <h2 class="text-base font-semibold text-text-primary">
              Ubicación ICA
            </h2>
            <p class="text-xs text-text-secondary mt-0.5">
              El ICA se declara en el municipio donde ejerces la actividad.
              Captura el código DANE del municipio (Divipola 5 dígitos) y el
              código CIIU de tu actividad principal; la cascada store→org
              resuelve la tarifa al generar la declaración.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label
                class="block text-xs font-medium text-text-primary mb-1"
                for="ica-municipality-code"
              >
                Código DANE del municipio
                <app-tooltip
                  content="Código Divipola del municipio donde opera la tienda (5 dígitos). Se normaliza a los primeros 5 caracteres al matchear contra la tabla de tarifas."
                  position="bottom"
                  size="sm"
                >
                  <span
                    class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary ml-1"
                  >
                    <app-icon name="help-circle" [size]="12"></app-icon>
                  </span>
                </app-tooltip>
              </label>
              <app-input
                inputId="ica-municipality-code"
                [formControl]="icaMunicipalityCodeControl"
                [disabled]="saving()"
                placeholder="Ej: 11001 (Bogotá)"
                [maxlength]="10"
              ></app-input>
              <p class="text-[11px] text-text-secondary mt-1">
                Se persiste en <code>store.municipality_code</code>. Si la
                tienda tiene dirección primaria con código DANE, M4 lo copia
                automáticamente.
              </p>
            </div>

            <div>
              <label
                class="block text-xs font-medium text-text-primary mb-1"
                for="ica-ciiu-code"
              >
                Código CIIU
                <app-tooltip
                  content="Código CIIU de la actividad económica (4 dígitos). Cascada store→org: si la tienda no tiene CIIU propio, se usa el de la organización."
                  position="bottom"
                  size="sm"
                >
                  <span
                    class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary ml-1"
                  >
                    <app-icon name="help-circle" [size]="12"></app-icon>
                  </span>
                </app-tooltip>
              </label>
              <app-input
                inputId="ica-ciiu-code"
                [formControl]="icaCiiuCodeControl"
                [disabled]="saving()"
                placeholder="Ej: 4711 (Comercio al por menor)"
                [maxlength]="10"
              ></app-input>
              <p class="text-[11px] text-text-secondary mt-1">
                Cascada: <code>store.ciiu_code</code> →
                <code>organization.ciiu_code</code> → null (warning).
              </p>
            </div>
          </div>

          <div class="mt-4">
            <div
              class="flex items-center gap-1.5 text-sm font-medium text-text-primary mb-2"
            >
              <span>Referencia geográfica (catálogo api-colombia)</span>
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
            <div class="grid gap-3 md:grid-cols-2">
              <app-selector
                [formControl]="icaDepartmentControl"
                [options]="icaDepartmentOptions()"
                placeholder="Departamento"
                (searchChange)="onIcaDepartmentSearch($event)"
              ></app-selector>
              <app-selector
                [formControl]="icaCityControl"
                [options]="icaCityOptions()"
                [placeholder]="icaCityPlaceholder()"
              ></app-selector>
            </div>
            <p class="text-[11px] text-text-secondary mt-2">
              La api-colombia devuelve IDs no-DANE; usa el departamento/ciudad
              como referencia y captura el código DANE manualmente arriba.
            </p>
          </div>
        </app-card>

        <!-- Acciones -->
        <div class="flex justify-end">
          <app-button
            variant="primary"
            [disabled]="!dirty() || saving()"
            [loading]="saving()"
            (clicked)="save()"
          >
            Guardar cambios
          </app-button>
        </div>
      }
    </section>

    <app-rut-scanner-modal
      [isOpen]="scannerOpen()"
      [scope]="scannerScope"
      (isOpenChange)="scannerOpen.set($event)"
      (confirmed)="onScanConfirmed($event)"
    ></app-rut-scanner-modal>
  `,
})
export class FiscalIdentityPanelComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(FiscalOperationsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly headerActions = inject(FiscalOperationsHeaderActionsService);
  private readonly countryService = inject(CountryService);

  /** Scope del API resuelto desde la data de la ruta (igual que el resto del módulo). */
  private readonly apiScope: FiscalApiScope = this.resolveScope();

  readonly vatResponsibleCode = VAT_RESPONSIBLE_CODE;
  /** El scanner usa el mismo namespace de tenant que el resto del módulo. */
  readonly scannerScope: RutScannerScope = this.apiScope;

  // ── Estado de carga / guardado ────────────────────────────
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);

  // ── Datos ─────────────────────────────────────────────────
  readonly catalog = signal<FiscalResponsibilityCatalogEntry[]>([]);
  /** Seed del formulario de datos legales (re-seed en carga y al escanear RUT). */
  readonly formSeed = signal<Partial<LegalDataValue> | null>(null);
  readonly legalValid = signal(false);
  readonly selectedResponsibilities = signal<string[]>([]);

  readonly vatPeriodicityControl = new FormControl<FiscalVatPeriodicity>(
    'bimonthly',
    { nonNullable: true },
  );

  // ── Captura ICA (municipio DANE + CIIU) ──────────────────
  /**
   * FormControls para la sección "Ubicación ICA". Persisten vía
   * PATCH /store|organization/settings/fiscal-data usando los campos
   * dedicados `municipality_code` y `ciiu_code` del DTO, que el backend
   * escribe en las columnas reales `stores.municipality_code` /
   * `stores.ciiu_code` (o `organizations.ciiu_code` cuando el scope es
   * organización) — las mismas que lee `calculateIca` en
   * tax-declaration-draft.service.ts.
   */
  readonly icaMunicipalityCodeControl = new FormControl<string>('', {
    nonNullable: true,
  });
  readonly icaCiiuCodeControl = new FormControl<string>('', {
    nonNullable: true,
  });

  /** Departamento/municipio de referencia vía api-colombia (read-only hint). */
  readonly icaDepartments = signal<
    Array<{ id: number; name: string }>
  >([]);
  readonly icaCities = signal<
    Array<{ id: number; name: string; departmentId: number }>
  >([]);
  readonly icaDepartmentControl = new FormControl<string>('', {
    nonNullable: true,
  });
  readonly icaCityControl = new FormControl<string>('', {
    nonNullable: true,
  });

  readonly icaDepartmentOptions = computed<SelectorOption[]>(() =>
    this.icaDepartments().map((d) => ({ value: String(d.id), label: d.name })),
  );
  readonly icaCityOptions = computed<SelectorOption[]>(() =>
    this.icaCities().map((c) => ({ value: String(c.id), label: c.name })),
  );
  readonly icaCityPlaceholder = computed(() => {
    if (!this.icaDepartmentControl.value) {
      return 'Seleccione departamento primero';
    }
    return 'Seleccione municipio';
  });

  readonly vatPeriodicityOptions: SelectorOption[] = [
    { value: 'monthly', label: 'Mensual' },
    { value: 'bimonthly', label: 'Bimestral (la más común)' },
    { value: 'four_monthly', label: 'Cuatrimestral' },
  ];

  // ── Dirty tracking ────────────────────────────────────────
  /**
   * El formulario legal no es signal-friendly hacia afuera, así que el panel
   * serializa cada `valueChange` y lo compara contra el snapshot tomado al
   * hidratar (`awaitingBaseline`). El primer emit tras un seed inicial fija
   * la línea base; los siguientes marcan dirty.
   */
  private awaitingBaseline = false;
  private readonly legalJson = signal('');
  private readonly baselineLegalJson = signal('');
  private readonly savedResponsibilities = signal<string[]>([]);
  private readonly savedVatPeriodicity =
    signal<FiscalVatPeriodicity>('bimonthly');

  private readonly vatPeriodicityValue = toSignal(
    this.vatPeriodicityControl.valueChanges,
    { initialValue: this.vatPeriodicityControl.value },
  );

  readonly showVatSelector = computed(() =>
    this.selectedResponsibilities().includes(VAT_RESPONSIBLE_CODE),
  );

  readonly vatConflict = computed(() => {
    const selected = this.selectedResponsibilities();
    return (
      selected.includes(VAT_RESPONSIBLE_CODE) &&
      selected.includes(VAT_NOT_RESPONSIBLE_CODE)
    );
  });

  /** Códigos presentes en el RUT pero no cubiertos por el catálogo (se preservan). */
  readonly unknownCodes = computed(() => {
    const known = new Set(this.catalog().map((entry) => entry.code));
    return this.selectedResponsibilities().filter((code) => !known.has(code));
  });

  /** Snapshot del CIIU/municipio persistidos para dirty tracking de la sección ICA. */
  private readonly baselineIcaCiiu = signal<string>('');
  private readonly baselineIcaMunicipality = signal<string>('');

  readonly dirty = computed(() => {
    if (this.legalJson() !== this.baselineLegalJson()) return true;
    if (
      !this.sameCodes(
        this.selectedResponsibilities(),
        this.savedResponsibilities(),
      )
    ) {
      return true;
    }
    if (this.icaCiiuCodeControl.value !== this.baselineIcaCiiu()) return true;
    if (
      this.icaMunicipalityCodeControl.value !== this.baselineIcaMunicipality()
    ) {
      return true;
    }
    return (
      this.showVatSelector() &&
      this.vatPeriodicityValue() !== this.savedVatPeriodicity()
    );
  });

  // ── Re-escaneo de RUT ─────────────────────────────────────
  readonly scannerOpen = signal(false);

  private readonly legalForm =
    viewChild.required<LegalDataFormComponent>('legalForm');

  constructor() {
    // El botón "Actualizar" del sticky-header del shell delega vía bus;
    // en este tab refresca identidad + catálogo.
    this.headerActions.register('refresh', () => this.load());
    this.destroyRef.onDestroy(() => this.headerActions.unregister('refresh'));

    // Carga lazy del catálogo de departamentos para la sección ICA.
    void this.loadIcaDepartments();
    // Cuando el usuario selecciona un departamento, hidratar ciudades.
    this.icaDepartmentControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!value) {
          this.icaCities.set([]);
          this.icaCityControl.setValue('', { emitEvent: false });
          return;
        }
        void this.loadIcaCities(Number(value));
      });

    this.load();
  }

  private async loadIcaDepartments(): Promise<void> {
    try {
      const departments = await this.countryService.getDepartments();
      this.icaDepartments.set(
        departments.map((d) => ({ id: d.id, name: d.name })),
      );
    } catch {
      this.icaDepartments.set([]);
    }
  }

  private async loadIcaCities(departmentId: number): Promise<void> {
    try {
      const cities = await this.countryService.getCitiesByDepartment(
        departmentId,
      );
      this.icaCities.set(
        cities.map((c) => ({
          id: c.id,
          name: c.name,
          departmentId: c.departmentId,
        })),
      );
    } catch {
      this.icaCities.set([]);
    }
  }

  /** Hook del SelectorComponent para refresh manual al teclear búsqueda. */
  onIcaDepartmentSearch(_event: unknown): void {
    // No-op: la api-colombia devuelve el catálogo completo por departamento;
    // un search local en cliente se puede agregar si la lista crece.
    // El arg es `unknown` porque el contrato de SelectorComponent.searchChange
    // emite el `Event` nativo; no usamos el query aquí.
  }

  // ── Carga ─────────────────────────────────────────────────
  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      fiscalData: this.service.getFiscalDataSettings(this.apiScope),
      catalog: this.service.getResponsibilitiesCatalog(this.apiScope),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ fiscalData, catalog }) => {
          this.catalog.set(catalog?.data?.responsibilities ?? []);
          this.hydrate(this.unwrapFiscalData(fiscalData));
          this.loading.set(false);
        },
        error: (error) => {
          this.loadError.set(parseApiError(error).userMessage);
          this.loading.set(false);
        },
      });
  }

  // ── Formulario legal ──────────────────────────────────────
  onLegalValueChange(value: LegalDataValue): void {
    const json = JSON.stringify(value);
    if (this.awaitingBaseline) {
      this.baselineLegalJson.set(json);
      this.awaitingBaseline = false;
    }
    this.legalJson.set(json);
  }

  // ── Responsabilidades ─────────────────────────────────────
  isSelected(code: string): boolean {
    return this.selectedResponsibilities().includes(code);
  }

  onResponsibilityToggled(code: string, enabled: boolean): void {
    const next = new Set(this.selectedResponsibilities());
    if (enabled) next.add(code);
    else next.delete(code);
    this.selectedResponsibilities.set(Array.from(next));
  }

  effectsTooltip(entry: FiscalResponsibilityCatalogEntry): string {
    return `Activa: ${entry.effects.join(' • ')}`;
  }

  // ── Scanner de RUT ────────────────────────────────────────
  openScanner(): void {
    this.scannerOpen.set(true);
  }

  /**
   * Vuelca los datos extraídos por la IA sobre el formulario (merge sobre el
   * valor actual: un campo vacío del scan nunca pisa lo ya escrito) y sobre
   * los toggles de responsabilidades. No guarda nada: el usuario revisa y
   * confirma con "Guardar cambios".
   */
  onScanConfirmed(result: RutScanResult): void {
    const current = this.legalForm().getValue();
    const scanned: Partial<LegalDataValue> = {
      nit: result.nit,
      nit_dv: result.nit_dv,
      nit_type: result.nit_type,
      legal_name: result.legal_name,
      person_type: result.person_type,
      tax_regime: result.tax_regime,
      ciiu: result.ciiu,
      fiscal_address: result.fiscal_address,
      country: result.country,
      department: result.department,
      city: result.city,
      tax_scheme: result.tax_scheme,
    };
    this.formSeed.set({ ...current, ...this.definedOnly(scanned) });

    if (result.tax_responsibilities?.length) {
      this.selectedResponsibilities.set(
        Array.from(new Set(result.tax_responsibilities)),
      );
    }

    this.toast.success('Datos del RUT cargados. Revisa y guarda los cambios.');
  }

  // ── Guardado ──────────────────────────────────────────────
  save(): void {
    const form = this.legalForm();
    form.markAllTouched();
    if (!this.legalValid()) {
      this.toast.error(
        'Revisa los datos legales: hay campos obligatorios incompletos.',
      );
      return;
    }

    this.saving.set(true);
    const icaCiiu = this.icaCiiuCodeControl.value?.trim() || undefined;
    const icaMunicipality =
      this.icaMunicipalityCodeControl.value?.trim() || undefined;
    const payload: Record<string, unknown> = {
      ...form.getValue(),
      tax_responsibilities: this.selectedResponsibilities(),
      vat_periodicity: this.vatPeriodicityControl.value,
      // El DTO legado `ciiu` (legal-data-form) sigue viajando para no romper
      // el resto del formulario legal; el CIIU "oficial" para la cascada de
      // ICA es el campo dedicado `ciiu_code`, que el backend persiste en la
      // columna real `stores.ciiu_code` / `organizations.ciiu_code`.
      ciiu: icaCiiu || form.getValue().ciiu || undefined,
      // `municipality_code` y `ciiu_code` son campos dedicados del DTO
      // (update-store-fiscal-data.dto.ts / update-org-fiscal-data.dto.ts) que
      // el service persiste directamente en `stores.municipality_code` /
      // `stores.ciiu_code` (o `organizations.ciiu_code`) — las mismas
      // columnas que lee `calculateIca` en tax-declaration-draft.service.ts.
      ...(icaMunicipality !== undefined && {
        municipality_code: icaMunicipality,
      }),
      ...(icaCiiu !== undefined && { ciiu_code: icaCiiu }),
    };

    this.service
      .patchFiscalDataSettings(this.apiScope, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          // Nueva línea base = lo recién guardado.
          this.baselineLegalJson.set(this.legalJson());
          this.savedResponsibilities.set([
            ...this.selectedResponsibilities(),
          ]);
          this.savedVatPeriodicity.set(this.vatPeriodicityControl.value);
          this.baselineIcaCiiu.set(this.icaCiiuCodeControl.value ?? '');
          this.baselineIcaMunicipality.set(
            this.icaMunicipalityCodeControl.value ?? '',
          );
          this.toast.success('Identidad fiscal actualizada');
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.error(parseApiError(error).userMessage);
        },
      });
  }

  // ── Internos ──────────────────────────────────────────────
  private resolveScope(): FiscalApiScope {
    const routeScope = this.route.pathFromRoot
      .map((route) => route.snapshot.data['fiscalApiScope'])
      .find(
        (value) =>
          value === 'store' ||
          value === 'organization' ||
          value === 'platform',
      );
    return (routeScope as FiscalApiScope | undefined) ?? 'store';
  }

  /** Normaliza el envelope: store envuelve con ResponseService, org devuelve plano. */
  private unwrapFiscalData(
    response: FiscalDataEnvelope,
  ): FiscalDataSettings | null {
    if (response && 'fiscal_data' in response) {
      return response.fiscal_data ?? null;
    }
    const wrapped = response as ApiResponse<FiscalDataResponse> | null;
    return wrapped?.data?.fiscal_data ?? null;
  }

  private hydrate(fiscal: FiscalDataSettings | null): void {
    const responsibilities = fiscal?.tax_responsibilities ?? [];
    this.selectedResponsibilities.set([...responsibilities]);
    this.savedResponsibilities.set([...responsibilities]);

    const periodicity = VALID_VAT_PERIODICITIES.includes(
      fiscal?.vat_periodicity as FiscalVatPeriodicity,
    )
      ? (fiscal?.vat_periodicity as FiscalVatPeriodicity)
      : 'bimonthly';
    this.vatPeriodicityControl.setValue(periodicity);
    this.savedVatPeriodicity.set(periodicity);

    // Sección ICA: `ciiu_code`/`municipality_code` son los campos dedicados
    // que el GET refleja directamente desde las columnas reales
    // `stores.ciiu_code`/`stores.municipality_code` (o
    // `organizations.ciiu_code`). Fallback a `ciiu` legado solo si el campo
    // dedicado aún no tiene valor (tenant que no ha guardado desde este panel).
    // El FormControl siempre se inicializa con string vacío por
    // `{ nonNullable: true }`, así que un undefined nunca rompe.
    const persistedCiiu = fiscal?.ciiu_code || fiscal?.ciiu || '';
    const persistedMunicipality = fiscal?.municipality_code || '';
    this.icaCiiuCodeControl.setValue(persistedCiiu);
    this.baselineIcaCiiu.set(persistedCiiu);
    this.icaMunicipalityCodeControl.setValue(persistedMunicipality);
    this.baselineIcaMunicipality.set(persistedMunicipality);

    // El próximo valueChange del form (disparado por el seed) fija la línea base.
    this.awaitingBaseline = true;
    this.formSeed.set(this.toLegalSeed(fiscal));
  }

  /**
   * Seed parcial para el form legal: solo campos con valor y enums válidos,
   * para no pisar los defaults del formulario con datos corruptos/vacíos.
   */
  private toLegalSeed(
    fiscal: FiscalDataSettings | null,
  ): Partial<LegalDataValue> {
    if (!fiscal) return {};
    const personType: PersonType | undefined =
      fiscal.person_type === 'NATURAL' || fiscal.person_type === 'JURIDICA'
        ? fiscal.person_type
        : undefined;
    const taxRegime = VALID_TAX_REGIMES.includes(
      fiscal.tax_regime as TaxRegime,
    )
      ? (fiscal.tax_regime as TaxRegime)
      : undefined;
    const nitType = VALID_NIT_TYPES.includes(fiscal.nit_type as NitType)
      ? (fiscal.nit_type as NitType)
      : undefined;

    return {
      ...(fiscal.legal_name ? { legal_name: fiscal.legal_name } : {}),
      ...(fiscal.nit ? { nit: fiscal.nit } : {}),
      ...(fiscal.nit_dv ? { nit_dv: fiscal.nit_dv } : {}),
      ...(nitType ? { nit_type: nitType } : {}),
      ...(personType ? { person_type: personType } : {}),
      ...(taxRegime ? { tax_regime: taxRegime } : {}),
      ...(fiscal.ciiu ? { ciiu: fiscal.ciiu } : {}),
      ...(fiscal.fiscal_address
        ? { fiscal_address: fiscal.fiscal_address }
        : {}),
      ...(fiscal.country ? { country: fiscal.country } : {}),
      ...(fiscal.department ? { department: fiscal.department } : {}),
      ...(fiscal.city ? { city: fiscal.city } : {}),
      ...(fiscal.tax_scheme ? { tax_scheme: fiscal.tax_scheme } : {}),
    };
  }

  /** Quita vacíos de un parcial para que un campo en blanco del scan no borre datos. */
  private definedOnly(
    value: Partial<LegalDataValue>,
  ): Partial<LegalDataValue> {
    const out: Partial<LegalDataValue> = {};
    (Object.keys(value) as (keyof LegalDataValue)[]).forEach((key) => {
      const v = value[key];
      if (v === null || v === undefined) return;
      if (typeof v === 'string' && v.trim() === '') return;
      if (Array.isArray(v) && v.length === 0) return;
      (out as Record<string, unknown>)[key] = v;
    });
    return out;
  }

  private sameCodes(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((code, index) => code === sortedB[index]);
  }
}
