import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { normalizeFiscalResponsibilityCode } from '../../../../../../../shared/constants/fiscal-responsibilities.constants';
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { RutScannerModalComponent } from '../../../../../../../shared/components/fiscal-activation-wizard/components/rut-scanner-modal.component';
import type { RutScanResult } from '../../../../../../../shared/components/fiscal-activation-wizard/interfaces/rut-scan-result.interface';
import {
  LegalDataFormComponent,
  type LegalDataValue,
  type NitType,
  type PersonType,
  type TaxRegime,
} from '../../../../../../../shared/components/forms/legal-data-form/legal-data-form.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import type {
  FiscalApiScope,
  FiscalDataEnvelope,
  FiscalDataSettings,
  FiscalResponsibilitiesCatalog,
} from '../../../../../fiscal-operations/interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from '../../../../../fiscal-operations/services/fiscal-operations.service';
import type { ActivationContext } from '../activation-wizard.model';

const VALID_TAX_REGIMES: TaxRegime[] = ['COMUN', 'SIMPLIFICADO', 'GRAN_CONTRIBUYENTE'];
const VALID_NIT_TYPES: NitType[] = ['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'];

const REGIME_LABELS: Record<string, string> = {
  COMUN: 'Régimen común',
  SIMPLIFICADO: 'Régimen simplificado',
  GRAN_CONTRIBUYENTE: 'Gran contribuyente',
};

/**
 * Paso 1 del asistente de activación: la empresa que factura.
 *
 * No monta `fiscal-legal-data-step` (atado al cursor del asistente fiscal y a
 * `commitStep`) ni `app-fiscal-identity-panel` (resuelve el scope por
 * `route.data.fiscalApiScope`, que estas rutas no declaran, y no emite evento
 * al guardar). Monta `app-legal-data-form` y guarda con el mismo PATCH-merge de
 * `settings/fiscal-data`.
 */
@Component({
  selector: 'vendix-activation-company-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    LegalDataFormComponent,
    RutScannerModalComponent,
  ],
  template: `
    <app-card>
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-[var(--color-text-primary)]">
              Empresa que factura
            </h2>
            <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Datos legales y fiscales que viajan en cada factura electrónica.
            </p>
          </div>
          @if (showForm() && !context().readOnly) {
            <app-button variant="outline" size="sm" [disabled]="saving()" (clicked)="scannerOpen.set(true)">
              <span class="inline-flex items-center gap-2">
                <app-icon name="sparkles" [size]="14"></app-icon>
                Escanear RUT con IA
              </span>
            </app-button>
          }
        </div>

        @if (loading()) {
          <div class="space-y-3 animate-pulse" aria-hidden="true">
            <div class="h-10 rounded-lg bg-[var(--color-surface-secondary)]"></div>
            <div class="h-40 rounded-lg bg-[var(--color-surface-secondary)]"></div>
          </div>
        } @else if (loadError(); as message) {
          <app-alert-banner variant="danger" icon="alert-triangle">{{ message }}</app-alert-banner>
          <div>
            <app-button variant="outline" size="sm" (clicked)="load()">Reintentar</app-button>
          </div>
        } @else {
          @if (context().readOnly && context().readOnlyReason) {
            <app-alert-banner variant="info" icon="info">{{ context().readOnlyReason }}</app-alert-banner>
          }

          @if (showForm()) {
            <app-legal-data-form
              #legalForm
              [initialValue]="seed()"
              [catalog]="catalog()"
              [disabled]="saving() || context().readOnly"
              [showResponsibilities]="true"
              [showVatPeriodicity]="true"
              [showLocationHelpers]="true"
              [requireMunicipalityCode]="true"
              (validityChange)="valid.set($event)"
            ></app-legal-data-form>

            @if (saveError(); as message) {
              <app-alert-banner variant="danger" icon="alert-triangle">{{ message }}</app-alert-banner>
            }

            @if (!context().readOnly) {
              <div class="flex flex-wrap justify-end gap-2">
                @if (context().legalDataComplete) {
                  <app-button variant="outline" [disabled]="saving()" (clicked)="cancelEdit()">Cancelar</app-button>
                }
                <app-button variant="primary" [loading]="saving()" [disabled]="saving()" (clicked)="save()">
                  Guardar y continuar
                </app-button>
              </div>
            }
          } @else {
            <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              @for (row of summaryRows(); track row.label) {
                <div class="min-w-0">
                  <dt class="text-xs text-[var(--color-text-secondary)]">{{ row.label }}</dt>
                  <dd class="font-medium text-[var(--color-text-primary)] break-words">{{ row.value }}</dd>
                </div>
              }
            </dl>
            @if (!context().readOnly) {
              <div>
                <app-button variant="outline" size="sm" (clicked)="editing.set(true)">
                  <span class="inline-flex items-center gap-2">
                    <app-icon name="pencil" [size]="14"></app-icon>
                    Editar
                  </span>
                </app-button>
              </div>
            }
          }
        }
      </div>
    </app-card>

    @if (!context().readOnly) {
      <app-rut-scanner-modal
        [isOpen]="scannerOpen()"
        [scope]="context().scope"
        (isOpenChange)="scannerOpen.set($event)"
        (confirmed)="onScanConfirmed($event)"
      ></app-rut-scanner-modal>
    }
  `,
})
export class ActivationCompanyStepComponent {
  private readonly fiscalOps = inject(FiscalOperationsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = input.required<ActivationContext>();
  readonly changed = output<void>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly valid = signal(false);
  readonly editing = signal(false);
  readonly scannerOpen = signal(false);
  readonly seed = signal<Partial<LegalDataValue> | null>(null);
  readonly catalog = signal<FiscalResponsibilitiesCatalog | null>(null);
  private readonly fiscalData = signal<FiscalDataSettings | null>(null);

  private readonly legalForm = viewChild<LegalDataFormComponent>('legalForm');

  private readonly apiScope = computed<FiscalApiScope>(() => this.context().scope);

  readonly showForm = computed(() => !this.context().legalDataComplete || this.editing());

  readonly summaryRows = computed(() => {
    const data = this.fiscalData();
    if (!data) return [];
    const nit = data.nit ? `${data.nit}${data.nit_dv ? '-' + data.nit_dv : ''}` : '—';
    const regime = data.tax_regime ? (REGIME_LABELS[data.tax_regime] ?? data.tax_regime) : '—';
    const place = [data.city, data.department].filter(Boolean).join(', ') || '—';
    return [
      { label: 'Razón social', value: data.legal_name || '—' },
      { label: 'NIT', value: nit },
      { label: 'Régimen', value: regime },
      { label: 'Responsabilidades', value: data.tax_responsibilities?.join(', ') || '—' },
      { label: 'Municipio', value: place },
    ];
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const scope = this.apiScope();

    this.fiscalOps
      .getResponsibilitiesCatalog(scope)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.data) this.catalog.set(res.data);
        },
        // Best-effort: el formulario cae a su lista de respaldo.
        error: () => undefined,
      });

    this.fiscalOps
      .getFiscalDataSettings(scope)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (envelope) => {
          const data = this.unwrap(envelope);
          this.fiscalData.set(data);
          this.seed.set(this.toSeed(data));
          this.loading.set(false);
        },
        error: (error) => {
          this.loadError.set(parseApiError(error).userMessage);
          this.loading.set(false);
        },
      });
  }

  cancelEdit(): void {
    this.seed.set(this.toSeed(this.fiscalData()));
    this.saveError.set(null);
    this.editing.set(false);
  }

  onScanConfirmed(result: RutScanResult): void {
    const current = this.legalForm()?.getValue() ?? {};
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
    const merged: Partial<LegalDataValue> = { ...current, ...this.definedOnly(scanned) };
    if (result.tax_responsibilities?.length) {
      merged.tax_responsibilities = Array.from(
        new Set(result.tax_responsibilities.map((r) => normalizeFiscalResponsibilityCode(r))),
      );
    }
    this.seed.set(merged);
    this.toast.success('Datos del RUT cargados. Revisa y guarda.');
  }

  save(): void {
    const form = this.legalForm();
    if (!form || this.context().readOnly) return;
    form.markAllTouched();
    if (!this.valid()) {
      const problems = form.describeProblems();
      this.saveError.set(
        problems.length
          ? `No se puede guardar. Revisa: ${problems.join(', ')}.`
          : 'Revisa los datos legales: hay campos obligatorios incompletos.',
      );
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    const payload: Record<string, unknown> = { ...form.getValue() };
    this.fiscalOps
      .patchFiscalDataSettings(this.apiScope(), payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editing.set(false);
          this.fiscalData.set({ ...(this.fiscalData() ?? {}), ...(payload as FiscalDataSettings) });
          this.toast.success('Datos de la empresa guardados');
          this.changed.emit();
        },
        error: (error) => {
          this.saving.set(false);
          this.saveError.set(parseApiError(error).userMessage);
        },
      });
  }

  /** La tienda envuelve con ResponseService; la organización devuelve plano. */
  private unwrap(envelope: FiscalDataEnvelope): FiscalDataSettings | null {
    if (envelope && 'fiscal_data' in envelope) return envelope.fiscal_data ?? null;
    const wrapped = envelope as { data?: { fiscal_data?: FiscalDataSettings | null } } | null;
    return wrapped?.data?.fiscal_data ?? null;
  }

  private toSeed(fiscal: FiscalDataSettings | null): Partial<LegalDataValue> {
    if (!fiscal) return {};
    const person: PersonType | undefined =
      fiscal.person_type === 'NATURAL' || fiscal.person_type === 'JURIDICA' ? fiscal.person_type : undefined;
    const regime = VALID_TAX_REGIMES.includes(fiscal.tax_regime as TaxRegime)
      ? (fiscal.tax_regime as TaxRegime)
      : undefined;
    const nitType = VALID_NIT_TYPES.includes(fiscal.nit_type as NitType) ? (fiscal.nit_type as NitType) : undefined;
    return {
      ...(fiscal.legal_name ? { legal_name: fiscal.legal_name } : {}),
      ...(fiscal.nit ? { nit: fiscal.nit } : {}),
      ...(fiscal.nit_dv ? { nit_dv: fiscal.nit_dv } : {}),
      ...(nitType ? { nit_type: nitType } : {}),
      ...(person ? { person_type: person } : {}),
      ...(regime ? { tax_regime: regime } : {}),
      ...(fiscal.ciiu ? { ciiu: fiscal.ciiu } : {}),
      ...(fiscal.fiscal_address ? { fiscal_address: fiscal.fiscal_address } : {}),
      ...(fiscal.country ? { country: fiscal.country } : {}),
      ...(fiscal.department ? { department: fiscal.department } : {}),
      ...(fiscal.city ? { city: fiscal.city } : {}),
      ...(fiscal.tax_scheme ? { tax_scheme: fiscal.tax_scheme } : {}),
      ...(fiscal.tax_responsibilities?.length ? { tax_responsibilities: [...fiscal.tax_responsibilities] } : {}),
      ...(fiscal.vat_periodicity ? { vat_periodicity: fiscal.vat_periodicity } : {}),
      ...(fiscal.municipality_code ? { municipality_code: fiscal.municipality_code } : {}),
      ...(fiscal.ciiu_code ? { ciiu_code: fiscal.ciiu_code } : {}),
      ...(fiscal.is_withholding_agent !== undefined ? { is_withholding_agent: fiscal.is_withholding_agent } : {}),
      ...(fiscal.is_self_withholder !== undefined ? { is_self_withholder: fiscal.is_self_withholder } : {}),
    };
  }

  private definedOnly(value: Partial<LegalDataValue>): Partial<LegalDataValue> {
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
