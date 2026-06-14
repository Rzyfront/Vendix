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

    this.load();
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
    const payload: Record<string, unknown> = {
      ...form.getValue(),
      tax_responsibilities: this.selectedResponsibilities(),
      vat_periodicity: this.vatPeriodicityControl.value,
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
