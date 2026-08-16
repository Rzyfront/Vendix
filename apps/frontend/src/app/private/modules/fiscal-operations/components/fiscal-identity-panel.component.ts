import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
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
} from '../interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from '../services/fiscal-operations.service';
import { FiscalOperationsHeaderActionsService } from '../services/fiscal-operations-header-actions.service';

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

/**
 * Tab "Identidad" del Centro Fiscal — editor post-wizard de la identidad
 * fiscal. El wizard detecta responsabilidades con IA al activar; este panel
 * permite reconfigurarlas después: datos legales editables, toggles por
 * responsabilidad DIAN (casilla 53 del RUT) con descripciones amigables,
 * periodicidad de IVA, ubicación DIAN (municipio DANE + CIIU) y re-escaneo
 * de RUT con IA.
 *
 * Los cambios se guardan con PATCH-merge sobre `settings.fiscal_data`
 * (mismo endpoint del wizard) y solo afectan la generación de obligaciones
 * de períodos futuros.
 */
@Component({
  selector: 'app-fiscal-identity-panel',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    LegalDataFormComponent,
    RutScannerModalComponent,
  ],
  template: `
    <section class="space-y-4">
      @if (loading()) {
        <!-- Skeleton de carga -->
        <div class="space-y-4 animate-pulse" aria-hidden="true">
          <div class="h-12 rounded-xl bg-[var(--color-surface-secondary)]"></div>
          <div class="h-72 rounded-xl bg-[var(--color-surface-secondary)]"></div>
        </div>
      } @else if (loadError()) {
        <app-card>
          <div class="flex flex-col items-center gap-3 py-10 text-center">
            <app-icon
              name="alert-triangle"
              [size]="32"
              class="text-warning"
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

        <!-- Identidad fiscal (datos legales + responsabilidades + ubicación DIAN) -->
        <app-card>
          <div
            class="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 mb-4"
          >
            <div>
              <h2 class="text-base font-semibold text-text-primary">
                Identidad fiscal
              </h2>
              <p class="text-xs text-text-secondary mt-0.5">
                Datos legales, responsabilidades tributarias y ubicación DIAN
                que viajan en tus documentos fiscales.
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

          <!--
            showResponsibilities DEBE ir en true.

            El selector de periodicidad de IVA se renderiza DENTRO del fieldset
            de responsabilidades, colgado de la fila O-48 (ver
            legal-data-form.component.ts). Con el fieldset apagado y
            showVatPeriodicity encendido, la periodicidad no tenía NINGUNA forma
            de escribirse desde la UI — y el formulario la seguía enviando en el
            PATCH. Resultado: «Guardar cambios» fallaba por un campo que la
            pantalla no ofrecía, justo al intentar capturar el municipio y el
            CIIU.

            El false era un resto de cuando este panel pintaba sus propios
            toggles; la sección vive en el form desde la deduplicación (mismo
            motivo por el que onScanConfirmed vuelca ahí tax_responsibilities) y
            el subtítulo de la tarjeta ya promete «responsabilidades
            tributarias».

            OJO: sin acentos graves. Este comentario vive dentro del template
            literal del decorador; un backtick aquí lo cierra y el archivo deja
            de compilar con errores que apuntan a nombres inexistentes.
          -->
          <app-legal-data-form
            #legalForm
            [initialValue]="formSeed()"
            [disabled]="saving()"
            [showResponsibilities]="true"
            [requireMunicipalityCode]="true"
            [showVatPeriodicity]="true"
            [showLocationHelpers]="true"
            (validityChange)="legalValid.set($event)"
            (valueChange)="onLegalValueChange($event)"
          ></app-legal-data-form>
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

  /** El scanner usa el mismo namespace de tenant que el resto del módulo. */
  readonly scannerScope: RutScannerScope = this.apiScope;

  // ── Estado de carga / guardado ────────────────────────────
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);

  // ── Datos ─────────────────────────────────────────────────
  /** Seed del formulario de datos legales (re-seed en carga y al escanear RUT). */
  readonly formSeed = signal<Partial<LegalDataValue> | null>(null);
  readonly legalValid = signal(false);

  // ── Dirty tracking ────────────────────────────────────────
  /**
   * El formulario legal no es signal-friendly hacia afuera, así que el panel
   * serializa cada `valueChange` y lo compara contra el snapshot tomado al
   * hidratar (`awaitingBaseline`). El primer emit tras un seed inicial fija
   * la línea base; los siguientes marcan dirty. Responsabilidades,
   * periodicidad de IVA y ubicación DIAN viven dentro del mismo form value,
   * así que un solo JSON cubre toda la identidad.
   */
  private awaitingBaseline = false;
  private readonly legalJson = signal('');
  private readonly baselineLegalJson = signal('');

  readonly dirty = computed(() => this.legalJson() !== this.baselineLegalJson());

  // ── Re-escaneo de RUT ─────────────────────────────────────
  readonly scannerOpen = signal(false);

  private readonly legalForm =
    viewChild.required<LegalDataFormComponent>('legalForm');

  constructor() {
    // El botón "Actualizar" del sticky-header del shell delega vía bus;
    // en este tab refresca identidad.
    this.headerActions.register('refresh', () => this.load());
    this.destroyRef.onDestroy(() => this.headerActions.unregister('refresh'));

    this.load();
  }

  // ── Carga ─────────────────────────────────────────────────
  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.service
      .getFiscalDataSettings(this.apiScope)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fiscalData) => {
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

  // ── Scanner de RUT ────────────────────────────────────────
  openScanner(): void {
    this.scannerOpen.set(true);
  }

  /**
   * Vuelca los datos extraídos por la IA sobre el formulario (merge sobre el
   * valor actual: un campo vacío del scan nunca pisa lo ya escrito). No
   * guarda nada: el usuario revisa y confirma con "Guardar cambios".
   *
   * `tax_responsibilities` que vengan del scanner se cuelan en el mismo
   * `formSeed` para que el `<app-legal-data-form>` los pinte en su fieldset
   * interno (la sección vive en el form desde la deduplicación).
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
    const merged: Partial<LegalDataValue> = {
      ...current,
      ...this.definedOnly(scanned),
    };

    if (result.tax_responsibilities?.length) {
      merged.tax_responsibilities = Array.from(
        new Set(result.tax_responsibilities),
      );
    }

    this.formSeed.set(merged);
    this.toast.success('Datos del RUT cargados. Revisa y guarda los cambios.');
  }

  // ── Guardado ──────────────────────────────────────────────
  save(): void {
    const form = this.legalForm();
    form.markAllTouched();
    if (!this.legalValid()) {
      // Nombrar lo que falla en vez de decir "hay campos incompletos" sobre un
      // formulario que a simple vista está lleno: el usuario no tiene forma de
      // adivinar cuál control quedó inválido.
      const problems = form.describeProblems();
      this.toast.error(
        problems.length
          ? `No se puede guardar — revisa: ${problems.join(', ')}.`
          : 'Revisa los datos legales: hay campos obligatorios incompletos.',
      );
      return;
    }

    this.saving.set(true);
    const value = form.getValue();
    // El servicio exige `Record<string, unknown>` (PATCH-merge). Copiamos
    // campo por campo en lugar de castear para no perder el tipado del
    // origen ni filtrar llaves que la firma no conoce.
    const payload: Record<string, unknown> = { ...value };
    this.service
      .patchFiscalDataSettings(this.apiScope, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          // Nueva línea base = lo recién guardado.
          this.baselineLegalJson.set(this.legalJson());
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
    // El próximo valueChange del form (disparado por el seed) fija la línea base.
    this.awaitingBaseline = true;
    this.formSeed.set(this.toLegalSeed(fiscal));
  }

  /**
   * Seed parcial para el form legal: solo campos con valor y enums válidos,
   * para no pisar los defaults del formulario con datos corruptos/vacíos.
   * Cubre todos los campos que `LegalDataFormComponent` espera (incluye los
   * nuevos: responsabilidades, periodicidad, ubicación DIAN, retenciones).
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
      ...(fiscal.tax_responsibilities?.length
        ? { tax_responsibilities: [...fiscal.tax_responsibilities] }
        : {}),
      ...(fiscal.vat_periodicity
        ? { vat_periodicity: fiscal.vat_periodicity }
        : {}),
      ...(fiscal.municipality_code
        ? { municipality_code: fiscal.municipality_code }
        : {}),
      ...(fiscal.ciiu_code ? { ciiu_code: fiscal.ciiu_code } : {}),
      ...(fiscal.is_withholding_agent !== undefined
        ? { is_withholding_agent: fiscal.is_withholding_agent }
        : {}),
      ...(fiscal.is_self_withholder !== undefined
        ? { is_self_withholder: fiscal.is_self_withholder }
        : {}),
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
}