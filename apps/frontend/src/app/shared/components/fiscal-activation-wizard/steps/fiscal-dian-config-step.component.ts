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
import {
  WizardPrefillDianConfig,
  WizardPrefillResolution,
} from '../../../../core/models/wizard-prefill.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import {
  DianConfigFormComponent,
  DianConfigValue,
} from '../../forms/dian-config-form/dian-config-form.component';
import { IconComponent } from '../../icon/icon.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { focusFirstInvalid } from '../../../../core/utils/focus-first-invalid';

/**
 * Sentinel the DIAN config endpoints return in place of the stored software PIN.
 * Prefilling it keeps the field non-empty (so the user sees the PIN *is* saved)
 * while letting `submit()` skip it in the body instead of overwriting the secret
 * with four asterisks.
 */
const MASKED_SECRET = '****';

/** ISO timestamp → `yyyy-MM-dd`, the shape `<input type="date">` requires. */
function toDateInput(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '';
}

@Component({
  selector: 'app-fiscal-dian-config-step',
  standalone: true,
  imports: [CommonModule, DianConfigFormComponent, IconComponent],
  template: `
    <div class="step-body">
      @if (inheritedCertificate(); as inherited) {
        <div
          class="banner-inherited-cert"
          role="status"
          aria-live="polite"
        >
          <div class="banner-inherited-cert__icon">
            <app-icon name="shield-check" [size]="22"></app-icon>
          </div>
          <div class="banner-inherited-cert__body">
            <p class="banner-inherited-cert__title">
              Ya tienes cert cargado para esta entidad fiscal
            </p>
            <p class="banner-inherited-cert__detail">
              El certificado de firma configurado para
              <strong>{{ inheritedFromTypeLabel() }}</strong>
              se reutiliza aquí automáticamente.
              @if (inherited.certificate_expiry) {
                <span> Vigente hasta {{ inherited.certificate_expiry | date: 'longDate' }}</span>.
              }
            </p>
            <p class="banner-inherited-cert__hint">
              Si necesitas rotar el certificado (vencimiento, revocación), usa el botón
              "Rotar cert" en la sección de Certificado más abajo.
            </p>
          </div>
        </div>
      }

      <app-dian-config-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        [hasCertificate]="hasCertificate()"
        [certificateExpiry]="certificateExpiry()"
        (validityChange)="onValidity($event)"
      ></app-dian-config-form>

      @if (localError()) {
        <p class="step-error" role="alert">{{ localError() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .step-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive, #b91c1c);
      }
      .banner-inherited-cert {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.85rem 1rem;
        border: 1px solid
          color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
        border-radius: 0.5rem;
        background: color-mix(
          in srgb,
          var(--color-primary) 8%,
          var(--color-surface, #ffffff)
        );
        color: var(--color-text-primary, #111827);
      }
      .banner-inherited-cert__icon {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 1.85rem;
        height: 1.85rem;
        border-radius: 999px;
        background: color-mix(in srgb, var(--color-primary) 18%, transparent);
        color: var(--color-primary);
      }
      .banner-inherited-cert__body {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1 1 auto;
        min-width: 0;
      }
      .banner-inherited-cert__title {
        margin: 0;
        font-size: 0.92rem;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
      }
      .banner-inherited-cert__detail {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.35;
        color: var(--color-text-secondary, #4b5563);
      }
      .banner-inherited-cert__detail strong {
        color: var(--color-text-primary, #111827);
      }
      .banner-inherited-cert__hint {
        margin: 0;
        font-size: 0.78rem;
        line-height: 1.3;
        color: var(--color-text-secondary, #6b7280);
      }
    `,
  ],
})
export class FiscalDianConfigStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly stepId: FiscalWizardStepId = 'dian_config';
  readonly valid = signal(false);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<DianConfigValue> | null>(null);
  readonly existingConfigId = signal<number | null>(null);
  /** Active numbering resolution already persisted for this fiscal entity. */
  readonly existingResolutionId = signal<number | null>(null);
  /** B3: precarga del certificado existente desde el prefill. */
  readonly hasCertificate = signal(false);
  readonly certificateExpiry = signal<string | null>(null);
  /**
   * QUI-679: when the backend creates this config and reuses an existing cert
   * from a sibling configuration on the same fiscal entity, the create
   * response carries `inherited_certificate: true` + `inherited_from`. We
   * surface it as a banner so the user understands why no upload is needed
   * and which row currently holds the certificate.
   */
  readonly inheritedCertificate = signal<{
    dian_configuration_id: number;
    configuration_type: string;
    certificate_expiry: string | null;
  } | null>(null);
  readonly inheritedFromTypeLabel = computed(() => {
    const v = this.inheritedCertificate();
    if (!v) return null;
    const map: Record<string, string> = {
      invoicing: 'facturación electrónica',
      support_document: 'documento soporte',
      equivalent_document: 'documento equivalente POS',
      payroll: 'nómina electrónica',
    };
    return map[v.configuration_type] ?? v.configuration_type;
  });
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form = viewChild.required<DianConfigFormComponent>('form');
  private loadedContextKey: string | null = null;

  constructor() {
    effect(() => {
      const key = this.service.fiscalContextKey();
      if (key && key !== this.loadedContextKey) {
        this.loadedContextKey = key;
        void this.loadInitial();
      }
    });
  }

  private baseUrl(): string {
    // userScope routes the request; backend resolves fiscal ownership.
    return `${environment.apiUrl}/${this.service.userScope()}/invoicing/dian-config`;
  }

  private async loadInitial(): Promise<void> {
    // Replaces the previous N+1 GET against `/invoicing/dian-config`. The
    // prefill snapshot already contains the active dian_config row, which
    // is what we need to seed the form. The canonical PATCH/POST endpoints
    // in submit() are still the write path.
    // Reset the certificate preload so a context switch never shows a stale
    // "certificado cargado" state.
    this.hasCertificate.set(false);
    this.certificateExpiry.set(null);
    this.inheritedCertificate.set(null);
    this.existingResolutionId.set(null);

    const prefill = this.service.prefill();
    // The resolution lives in its own table, so it prefills independently of
    // whether a dian_configurations row exists yet.
    const resolutionValue = this.toResolutionFormValue(prefill?.resolution);

    const dian = prefill?.dian_config;
    if (dian) {
      this.existingConfigId.set(dian.id);
      // B3: surface the already-uploaded certificate so the user is not forced
      // to re-upload it. The step stays optional either way.
      this.hasCertificate.set(dian.has_certificate ?? false);
      this.certificateExpiry.set(dian.certificate_expiry ?? null);
      this.initial.set({
        ...this.toDianFormValue(dian),
        ...resolutionValue,
      });
      return;
    }
    // First-time activation: there's no dian_config row yet, so the snapshot
    // is empty. Rather than show a blank form, inherit the fiscal identity
    // (NIT, DV, business name) the user already entered in the Legal Data
    // step. The in-session step ref is the freshest source; fall back to the
    // (possibly stale) prefill legal_data snapshot.
    const seeded = this.seedFromLegalData();
    if (seeded || Object.keys(resolutionValue).length > 0) {
      this.initial.set({ ...(seeded ?? {}), ...resolutionValue });
    }
  }

  /**
   * Maps the prefill resolution onto the form's flat `resolution_*` controls.
   * Returns `{}` when the tenant has no active resolution, so spreading it is a
   * no-op and never blanks a field the user is typing into.
   */
  private toResolutionFormValue(
    resolution: WizardPrefillResolution | null | undefined,
  ): Partial<DianConfigValue> {
    if (!resolution) return {};
    this.existingResolutionId.set(resolution.id);
    return {
      resolution_number: resolution.resolution_number ?? '',
      resolution_prefix: resolution.prefix ?? '',
      resolution_range_from: resolution.range_from ?? null,
      resolution_range_to: resolution.range_to ?? null,
      resolution_valid_from: toDateInput(resolution.valid_from),
      resolution_valid_to: toDateInput(resolution.valid_to),
      resolution_date: toDateInput(resolution.resolution_date),
      resolution_technical_key: resolution.technical_key ?? '',
    };
  }

  /**
   * Builds an initial DIAN form value from the identity fields shared with
   * the Legal Data step, so they aren't re-typed. Returns null when nothing
   * useful is available yet (form stays empty and editable).
   */
  private seedFromLegalData(): Partial<DianConfigValue> | null {
    const legalRef = this.service.stepRefs()?.['legal_data'] as
      | { nit?: string; nit_dv?: string; legal_name?: string }
      | undefined;
    const legalPrefill = this.service.prefill()?.legal_data;

    const nit = legalRef?.nit ?? legalPrefill?.nit ?? '';
    const nit_dv = legalRef?.nit_dv ?? legalPrefill?.nit_dv ?? '';
    const name = legalRef?.legal_name ?? legalPrefill?.legal_name ?? '';

    if (!nit && !nit_dv && !name) {
      return null;
    }
    return {
      name,
      nit,
      nit_dv,
      nit_type: 'NIT',
      environment: 'test',
      software_id: '',
      software_pin: '',
      test_set_id: '',
    } as Partial<DianConfigValue>;
  }

  private toDianFormValue(
    dian: WizardPrefillDianConfig,
  ): Partial<DianConfigValue> {
    return {
      name: dian.name ?? '',
      nit: dian.nit ?? '',
      nit_dv: dian.nit_dv ?? '',
      nit_type: dian.nit_type ?? 'NIT',
      environment: dian.environment ?? 'test',
      // These ARE columns of `dian_configurations`. Blanking them forced the
      // user to retype the DIAN portal identifiers on every wizard visit — and
      // an empty `software_id` submitted back wiped a working config. The PIN is
      // a secret, so only its presence is prefilled (via the sentinel) and
      // `submit()` omits it from the body unless the user actually retypes it.
      software_id: dian.software_id ?? '',
      software_pin: dian.has_software_pin ? MASKED_SECRET : '',
      test_set_id: dian.test_set_id ?? '',
    } as Partial<DianConfigValue>;
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  private resolutionsUrl(): string {
    return `${environment.apiUrl}/${this.service.userScope()}/invoicing/resolutions`;
  }

  /**
   * Persists the `resolution_*` block as an `invoice_resolutions` row. Returns
   * the row id, or `null` when the user left the block empty (it is optional as
   * a whole; the form's group validator already blocks half-filled input).
   *
   * Throws on HTTP failure so `submit()` aborts the step commit.
   */
  private async persistResolution(
    value: DianConfigValue,
  ): Promise<number | null> {
    const form = this.form();
    if (!form.hasResolutionInput()) {
      return this.existingResolutionId();
    }

    const body = {
      resolution_number: value.resolution_number,
      document_type: 'sales_invoice' as const,
      resolution_date: value.resolution_date,
      prefix: value.resolution_prefix,
      range_from: Number(value.resolution_range_from),
      range_to: Number(value.resolution_range_to),
      valid_from: value.resolution_valid_from,
      valid_to: value.resolution_valid_to,
      is_active: true,
      ...(value.resolution_technical_key
        ? { technical_key: value.resolution_technical_key }
        : {}),
      // Only the organization-scoped controller accepts store_id; the store
      // controller derives it from the tenant context and ignores extras.
      ...this.service.storeContext(),
    };

    const existingId = this.existingResolutionId();
    const res: any = existingId
      ? await firstValueFrom(
          this.http.patch(`${this.resolutionsUrl()}/${existingId}`, body),
        )
      : await firstValueFrom(this.http.post(this.resolutionsUrl(), body));

    const payload = res?.data ?? res;
    const id = typeof payload?.id === 'number' ? payload.id : existingId;
    this.existingResolutionId.set(id ?? null);
    return id ?? null;
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) {
      focusFirstInvalid(this.host);
      return null;
    }

    this.submitting.set(true);
    this.localError.set(null);
    if (this.readOnlyForStore()) {
      const ref = {
        dian_config_id: this.existingConfigId(),
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      this.submitting.set(false);
      return { ref };
    }
    // ORG_ADMIN + fiscal_scope=STORE writes need a target store. The org
    // service rejects with "store_id is required when fiscal_scope=STORE".
    // For fiscal_scope=ORGANIZATION the row is anchored to the organization
    // only (store_id IS NULL), so no store selection is required.
    if (
      this.service.userScope() === 'organization' &&
      this.service.fiscalDataOwner() === 'store' &&
      this.service.targetStoreId() === null
    ) {
      this.localError.set(
        'Selecciona una tienda en el panel de manejo fiscal antes de continuar.',
      );
      this.submitting.set(false);
      return null;
    }
    try {
      const value = form.getValue();

      // Body matches CreateDianConfigDto. For ORG_ADMIN + fiscal_scope=STORE
      // spread the selected store_id so the backend pins the row to the
      // chosen store. For fiscal_scope=ORGANIZATION do NOT send store_id —
      // the row must be org-scoped (store_id IS NULL).
      // The PIN is only sent when the user typed a real value. Sending the
      // sentinel back would overwrite the stored secret with '****' and every
      // later DIAN call would fail authentication.
      const pinTouched =
        Boolean(value.software_pin) && value.software_pin !== MASKED_SECRET;
      const body = {
        name: value.name,
        nit: value.nit,
        nit_dv: value.nit_dv,
        nit_type: value.nit_type || 'NIT',
        software_id: value.software_id,
        ...(pinTouched ? { software_pin: value.software_pin } : {}),
        environment: value.environment,
        test_set_id: value.test_set_id || undefined,
        is_default: true,
        ...this.service.storeContext(),
      };

      let configId: number | null = this.existingConfigId();
      if (configId) {
        const res: any = await firstValueFrom(
          this.http.patch(`${this.baseUrl()}/${configId}`, body),
        );
        const payload = res?.data ?? res;
        configId =
          typeof payload?.id === 'number' ? payload.id : (configId ?? null);
        // Defensive: PATCH responses should not carry the inherited flag, but
        // if the backend ever starts reporting it here we surface it the same
        // way so the user always sees a consistent "cert ya cargado" state.
        if (payload?.inherited_certificate && payload?.inherited_from) {
          this.inheritedCertificate.set(payload.inherited_from);
          this.hasCertificate.set(true);
          this.certificateExpiry.set(
            payload.inherited_from?.certificate_expiry ?? null,
          );
        }
      } else {
        const res: any = await firstValueFrom(
          this.http.post(this.baseUrl(), body),
        );
        const payload = res?.data ?? res;
        configId = typeof payload?.id === 'number' ? payload.id : null;
        // QUI-679: the backend may have linked an existing certificate from a
        // sibling configuration on the same fiscal entity. Reflect that in
        // the wizard so the form shows "Certificado cargado" and the user
        // knows they don't need to upload anything.
        if (payload?.inherited_certificate && payload?.inherited_from) {
          this.inheritedCertificate.set(payload.inherited_from);
          this.hasCertificate.set(true);
          this.certificateExpiry.set(
            payload.inherited_from?.certificate_expiry ?? null,
          );
        }
      }

      // Upload certificate if provided. FormData payload — no body merge.
      if (value.certificate_file && configId && value.certificate_password) {
        const fd = new FormData();
        fd.append('certificate', value.certificate_file);
        fd.append('password', value.certificate_password);
        fd.append('config_id', String(configId));
        await firstValueFrom(
          this.http.post(`${this.baseUrl()}/upload-certificate`, fd),
        );
      }

      // The numbering resolution is a hard prerequisite for the test set and
      // for issuing, so it is persisted in the same commit as the DIAN config.
      // If this write fails the step is NOT marked complete, even though the
      // config itself was saved — otherwise the wizard would report "listo"
      // for a tenant that still cannot emit a single document.
      const resolutionId = await this.persistResolution(value);

      const ref = {
        dian_config_id: configId,
        resolution_id: resolutionId,
        environment: value.environment,
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
