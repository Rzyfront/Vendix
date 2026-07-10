import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import { FiscalWizardStepId } from '../../../../core/models/fiscal-status.model';
import { WizardPrefillLegalData } from '../../../../core/models/wizard-prefill.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import {
  LegalDataFormComponent,
  LegalDataValue,
  NitType,
  PersonType,
  TaxRegime,
} from '../../forms/legal-data-form/legal-data-form.component';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';
import { RutScannerModalComponent } from '../components/rut-scanner-modal.component';
import {
  RutScanResult,
  RutScannerScope,
} from '../interfaces/rut-scan-result.interface';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { focusFirstInvalid } from '../../../../core/utils/focus-first-invalid';

@Component({
  selector: 'app-fiscal-legal-data-step',
  standalone: true,
  imports: [
    CommonModule,
    LegalDataFormComponent,
    ButtonComponent,
    IconComponent,
    RutScannerModalComponent,
  ],
  template: `
    <div class="step-body">
      @if (readOnlyForStore()) {
        <p class="step-banner" role="status">
          La configuración fiscal de tu organización está centralizada. Pídele
          a un ORG_ADMIN que complete este paso.
        </p>
      } @else {
        <!--
          AI-assisted prefill: scanning the RUT pre-loads the legal-data form
          with the extracted fiscal identity. The user always reviews and can
          edit every field afterwards — the scan never auto-submits.
        -->
        <div class="scan-banner">
          <div class="scan-banner__copy">
            <span class="scan-banner__title">
              <app-icon name="sparkles" [size]="16" class="text-[var(--color-primary)]" />
              Cargar datos desde el RUT
            </span>
            <span class="scan-banner__text">
              Sube tu RUT y la IA completará NIT, razón social, régimen y
              responsabilidades. Podrás revisarlos antes de continuar.
            </span>
          </div>
          <app-button
            variant="primary"
            size="sm"
            [disabled]="submitting()"
            (clicked)="openScanner()"
          >
            <span class="inline-flex items-center gap-2">
              <app-icon name="sparkles" [size]="16" />
              Escanear RUT
            </span>
          </app-button>
        </div>
      }

      <app-legal-data-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        (validityChange)="onValidity($event)"
        (valueChange)="onValueChange($event)"
      ></app-legal-data-form>

      @if (localError()) {
        <p class="step-error" role="alert">{{ localError() }}</p>
      }
    </div>

    @if (!readOnlyForStore()) {
      <app-rut-scanner-modal
        [isOpen]="scannerOpen()"
        [scope]="scannerScope()"
        (isOpenChange)="scannerOpen.set($event)"
        (confirmed)="onScanConfirmed($event)"
      ></app-rut-scanner-modal>
    }
  `,
  styles: [
    `
      .step-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .step-banner {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        background: var(--color-surface-secondary);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
      }
      .scan-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
        border: 1px solid
          color-mix(in oklab, var(--color-primary) 30%, transparent);
        border-radius: 0.65rem;
        padding: 0.85rem 1rem;
        background: color-mix(
          in oklab,
          var(--color-primary) 6%,
          var(--color-surface)
        );
      }
      .scan-banner__copy {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 12rem;
        flex: 1 1 16rem;
      }
      .scan-banner__title {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--color-text-primary);
      }
      .scan-banner__text {
        font-size: 0.8rem;
        line-height: 1.25rem;
        color: var(--color-text-secondary);
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive);
      }
    `,
  ],
})
export class FiscalLegalDataStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly stepId: FiscalWizardStepId = 'legal_data';
  readonly valid = signal(false);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<LegalDataValue> | null>(null);

  /** Visibility of the AI RUT scanner modal. */
  readonly scannerOpen = signal(false);

  /** Tenant namespace the scanner endpoint must hit (mirrors HTTP routing). */
  readonly scannerScope = computed<RutScannerScope>(() =>
    this.service.userScope(),
  );

  /**
   * True when the logged-in user is a STORE_ADMIN but the organization's
   * fiscal data lives at ORGANIZATION scope — in that case this step is
   * owned by an ORG_ADMIN and must be read-only here. Banner explains it.
   */
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form = viewChild.required<LegalDataFormComponent>('form');

  private loadedContextKey: string | null = null;

  /**
   * Guard for the draft autosave: the form emits `valueChange` on every
   * `patchValue`/`setValue` (including our own prefill/scan seeding), so we
   * only start persisting once the form is hydrated. Prevents an empty form
   * value (emitted during initialization) from clobbering a stored draft.
   */
  private hydrated = false;

  constructor() {
    effect(() => {
      const key = this.service.fiscalContextKey();
      if (key && key !== this.loadedContextKey) {
        this.loadedContextKey = key;
        this.hydrated = false;
        void this.loadInitial();
      }
    });
  }

  private baseUrl(): string {
    // userScope (logged-in user) routes the request, not org-level
    // fiscal_scope. See FiscalActivationWizardService.userScope.
    return `${environment.apiUrl}/${this.service.userScope()}/settings`;
  }

  private fiscalDataUrl(): string {
    // Canonical dedicated endpoint for `fiscal_data` (PATCH-merge, both scopes).
    return `${this.baseUrl()}/fiscal-data`;
  }

  private async loadInitial(): Promise<void> {
    // Precedence: a locally saved draft (the user's in-progress edits for this
    // exact fiscal context) wins over the prefill snapshot, so an accidental
    // reload/navigation never discards typed-but-unsubmitted data. When there
    // is no draft we fall back to the prefill-mapped legal data.
    const draft = this.service.hydrateWizardDraft<Partial<LegalDataValue>>();
    if (draft) {
      this.initial.set(draft);
      this.hydrated = true;
      return;
    }

    const legal = this.service.prefill()?.legal_data;
    if (!legal) {
      // Prefill not loaded yet (component mounted before loadPrefill
      // resolved, or prefill endpoint failed). Skip silently; the form
      // stays empty and the user can still type.
      this.hydrated = true;
      return;
    }
    this.initial.set(this.toLegalFormValue(legal));
    this.hydrated = true;
  }

  private toLegalFormValue(
    legal: WizardPrefillLegalData,
  ): Partial<LegalDataValue> {
    // Prefill's `fiscal_regime` is sourced from `fiscal_data.tax_regime`, so
    // it already carries the form's TaxRegime enum. Only seed the control when
    // it's a valid value — otherwise leave the form default ('COMUN') intact.
    const tax_regime = this.normalizeTaxRegime(legal.fiscal_regime);
    // Same guard as tax_regime: only seed nit_type/person_type when the prefill
    // carries a valid enum value, otherwise leave the form defaults ('NIT' /
    // 'JURIDICA') intact instead of overwriting them with null/garbage.
    const nit_type = this.normalizeNitType(legal.nit_type);
    const person_type = this.normalizePersonType(legal.person_type);
    return {
      ...(tax_regime ? { tax_regime } : {}),
      ...(nit_type ? { nit_type } : {}),
      ...(person_type ? { person_type } : {}),
      legal_name: legal.legal_name ?? '',
      nit: legal.nit ?? legal.tax_id ?? '',
      nit_dv: legal.nit_dv ?? '',
      ciiu: legal.ciiu ?? '',
      tax_responsibilities: legal.tax_responsibilities ?? [],
      tax_scheme: legal.tax_scheme ?? '',
    };
  }

  private normalizeTaxRegime(
    value: string | null | undefined,
  ): TaxRegime | undefined {
    const VALID_REGIMES: TaxRegime[] = [
      'COMUN',
      'SIMPLIFICADO',
      'GRAN_CONTRIBUYENTE',
    ];
    return value && VALID_REGIMES.includes(value as TaxRegime)
      ? (value as TaxRegime)
      : undefined;
  }

  private normalizeNitType(
    value: string | null | undefined,
  ): NitType | undefined {
    // Mirrors LegalDataFormComponent.nitTypeOptions values.
    const VALID_NIT_TYPES: NitType[] = [
      'NIT',
      'CC',
      'CE',
      'TI',
      'PP',
      'NIT_EXTRANJERIA',
    ];
    return value && VALID_NIT_TYPES.includes(value as NitType)
      ? (value as NitType)
      : undefined;
  }

  private normalizePersonType(
    value: string | null | undefined,
  ): PersonType | undefined {
    return value === 'NATURAL' || value === 'JURIDICA' ? value : undefined;
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  /**
   * Persist the form value as a draft on every edit (once hydrated). The draft
   * is keyed by the active fiscal context and is cleared by the service on
   * finalize()/deactivate() — see FiscalActivationWizardService.clearWizardDraft.
   */
  onValueChange(value: LegalDataValue): void {
    if (!this.hydrated || this.readOnlyForStore()) return;
    this.service.saveWizardDraft(value as unknown as Record<string, unknown>);
  }

  openScanner(): void {
    this.scannerOpen.set(true);
  }

  /**
   * Map the AI-extracted RUT data onto the legal-data form. The mapping is
   * 1:1 with `LegalDataValue` (the backend already normalizes enums/codes);
   * we merge over the current form value so empty scan fields never overwrite
   * data the user already entered. Re-seeding via `initial.set()` triggers the
   * form's `initialValue` effect (patchValue + DV/country/dept/city resync).
   */
  onScanConfirmed(result: RutScanResult): void {
    const current = this.form().getValue();
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
      tax_responsibilities: result.tax_responsibilities,
      tax_scheme: result.tax_scheme,
    };
    const merged: LegalDataValue = { ...current, ...this.defined(scanned) };
    this.initial.set(merged);
    // The form's valueChange effect persists the merged draft, but the
    // initial.set re-seed runs through patchValue(emitEvent:false), so persist
    // explicitly to capture the scan immediately.
    this.onValueChange(merged);
  }

  /**
   * Strip empty values (empty string / empty array / null / undefined) from a
   * partial so a blank scanned field doesn't wipe an existing form value.
   */
  private defined(
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

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    if (this.readOnlyForStore()) {
      if (!this.valid()) {
        this.localError.set(
          'La configuración fiscal heredada todavía no tiene datos legales completos.',
        );
        return null;
      }
      const ref = {
        scope: 'ORGANIZATION',
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      return { ref };
    }

    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) {
      focusFirstInvalid(this.host);
      return null;
    }

    this.submitting.set(true);
    this.localError.set(null);
    try {
      const value = form.getValue();
      const scope = this.service.userScope();
      // Both scopes expose a dedicated PATCH endpoint for fiscal_data that
      // deep-merges over `settings.fiscal_data` without touching the rest of
      // the settings JSON. Payload is the flat form value — no `settings`
      // wrapper, no `fiscal_data` wrapper.
      await firstValueFrom(
        this.http.patch(this.fiscalDataUrl(), {
          ...value,
          ...this.service.storeContext(),
        }),
      );
      const ref = {
        scope: scope === 'organization' ? 'ORGANIZATION' : 'STORE',
        nit: value.nit,
        // Carried so the DIAN step (3) can inherit the fiscal identity the
        // user just entered here, instead of asking for it again.
        nit_dv: value.nit_dv,
        legal_name: value.legal_name,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      return { ref };
    } catch (e) {
      this.localError.set(parseApiError(e).userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
