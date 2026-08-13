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

/** Tipos de documento de identidad que la entidad emisora acepta. */
type IdentityDocumentType = 'rut' | 'id' | 'certificate_of_existence';

interface IdentityDocumentFile {
  document_type: IdentityDocumentType;
  file: File | null;
}

/**
 * Resultado de un `submit()` exitoso, conservado en una signal local hasta que
 * el usuario hace clic en "Continuar" y el step llama a `commitStep()`.
 *
 * SIN esta signal el shell destruye el step vía `@switch` justo después del
 * `await submit()` y el banner no llega a pintarse más que un frame. El
 * contrato de `FiscalWizardStepHost` exige que `submit()` devuelva `{ ref }`,
 * pero NO exige que dentro se haya llamado a `commitStep()`: el shell solo
 * espera un resultado, no un side-effect. Por eso es seguro diferir el
 * commit: el shell no destruye el step hasta que `currentStep` cambia, y eso
 * lo cambia `commitStep()`.
 */
type SuccessInfo =
  | {
      kind: 'inherited';
      ref: Record<string, unknown>;
      inherited_from: {
        id: number;
        configuration_type: string;
        certificate_expiry: string | null;
      };
    }
  | {
      kind: 'documents_submitted';
      ref: Record<string, unknown>;
    }
  | {
      kind: 'config_saved';
      ref: Record<string, unknown>;
    };

@Component({
  selector: 'app-fiscal-dian-config-step',
  standalone: true,
  imports: [CommonModule, DianConfigFormComponent, IconComponent],
  template: `
    <div class="step-body">
      @if (successInfo(); as success) {
        <!--
          Banner PERSISTENTE: vive hasta que el usuario hace clic en
          "Continuar" (o "Aceptar"), momento en que el step llama a
          commitStep() y el shell avanza. Sin esto, el shell destruye el
          step un frame después del POST y el banner nunca se lee.

          El shell's "Continuar" está deshabilitado mientras successInfo está
          poblada (valid = false), así que el único camino de salida es el
          botón de este banner.
        -->
        <div class="banner-success" role="status" aria-live="polite">
          <div class="banner-success__icon">
            <app-icon name="check-circle" [size]="22"></app-icon>
          </div>
          <div class="banner-success__body">
            @switch (success.kind) {
              @case ('inherited') {
                <p class="banner-success__title">
                  Cert reutilizado. Tu tienda ya puede operar.
                </p>
                <p class="banner-success__detail">
                  El certificado configurado para
                  <strong>{{ inheritedFromTypeLabel() }}</strong>
                  se aplica también a esta habilitación.
                  @if (success.inherited_from.certificate_expiry) {
                    <span>
                      Vigente hasta
                      {{ success.inherited_from.certificate_expiry | date: 'longDate' }}.
                    </span>
                  }
                </p>
              }
              @case ('documents_submitted') {
                <p class="banner-success__title">
                  Expediente enviado. Te avisaremos.
                </p>
                <p class="banner-success__detail">
                  Recibimos tu RUT, documento de identidad
                  @if (personType() === 'juridica') {
                    y certificado de existencia
                  }
                  y los pusimos a disposición de la plataforma para tramitar
                  tu certificado de firma. Tu tienda quedará
                  <strong>pendiente hasta que superadmin cargue tu certificado</strong>;
                  mientras tanto no podrá emitir documentos electrónicos.
                </p>
              }
              @case ('config_saved') {
                <p class="banner-success__title">
                  Configuración guardada.
                </p>
                <p class="banner-success__detail">
                  Registramos la configuración DIAN. Puedes continuar.
                </p>
              }
            }
            <div class="banner-success__actions">
              <button
                type="button"
                class="primary-btn"
                (click)="commitFromBanner()"
                [disabled]="committing()"
              >
                @if (committing()) {
                  Avanzando…
                } @else {
                  Continuar
                }
              </button>
            </div>
          </div>
        </div>
      } @else {
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

        @if (!readOnlyForStore() && !hasCertificate()) {
          <!--
            Bifurcación QUI-657. Solo aparece cuando NO hay cert heredado ni
            cert ya cargado: si el cert existe, la decisión ya está tomada y
            el usuario no debería volver a elegir.
          -->
          <fieldset class="branch-selector">
            <legend class="branch-selector__legend">
              ¿Ya tienes el certificado de firma digital?
            </legend>
            <div class="branch-selector__options">
              <label
                class="branch-selector__option"
                [class.branch-selector__option--active]="
                  certificateBranch() === 'with_cert'
                "
              >
                <input
                  type="radio"
                  name="certificate_branch"
                  value="with_cert"
                  [checked]="certificateBranch() === 'with_cert'"
                  (change)="onBranchChange('with_cert')"
                />
                <app-icon name="key" [size]="20"></app-icon>
                <div class="branch-selector__option-body">
                  <p class="branch-selector__option-title">Tengo el certificado</p>
                  <p class="branch-selector__option-hint">
                    Voy a subir mi .p12 ahora.
                  </p>
                </div>
              </label>
              <label
                class="branch-selector__option"
                [class.branch-selector__option--active]="
                  certificateBranch() === 'without_cert'
                "
              >
                <input
                  type="radio"
                  name="certificate_branch"
                  value="without_cert"
                  [checked]="certificateBranch() === 'without_cert'"
                  (change)="onBranchChange('without_cert')"
                />
                <app-icon name="file-text" [size]="20"></app-icon>
                <div class="branch-selector__option-body">
                  <p class="branch-selector__option-title">No tengo certificado</p>
                  <p class="branch-selector__option-hint">
                    La plataforma lo tramita con mis documentos de identidad.
                  </p>
                </div>
              </label>
            </div>
          </fieldset>
        }

        @if (certificateBranch() === 'without_cert' && !hasCertificate()) {
          <!--
            Carga de documentos de identidad. El juego depende de
            person_type: persona natural nunca aporta certificado de existencia
            (una persona natural no tiene representación legal). El backend
            lo rechaza igual, pero el cliente no debe ofrecer el campo: es
            pedirle al usuario algo que va a recibir un 400.
          -->
          <section class="identity-documents">
            <h3 class="identity-documents__title">
              Documentos de identidad
            </h3>
            <p class="identity-documents__hint">
              Adjunta los documentos que la entidad emisora exige para
              expedir el certificado a nombre de
              <strong>{{ entityDisplayName() }}</strong>
              (NIT {{ form().getValue().nit }}@if (form().getValue().nit_dv) {-{{ form().getValue().nit_dv }}}).
              @if (personType() === 'juridica') {
                Como persona jurídica también necesitas el certificado de
                existencia y representación legal.
              }
            </p>

            @for (doc of requiredDocumentTypes(); track doc) {
              <div class="identity-documents__row">
                <label class="identity-documents__row-label">
                  {{ documentLabel(doc) }}
                  <span class="identity-documents__req">obligatorio</span>
                </label>
                <input
                  type="file"
                  [accept]="allowedMimeAccept()"
                  (change)="onDocumentFile(doc, $event)"
                />
                @if (getDocumentFile(doc); as picked) {
                  <p class="identity-documents__filename">
                    {{ picked.file?.name ?? 'archivo seleccionado' }}
                    @if (picked.file) {
                      · {{ formatBytes(picked.file.size) }}
                    }
                  </p>
                }
              </div>
            }
          </section>
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
      .banner-success {
        display: flex;
        align-items: flex-start;
        gap: 0.85rem;
        padding: 1rem 1.1rem;
        border: 1px solid
          color-mix(in srgb, var(--color-success, #16a34a) 30%, var(--color-border));
        border-radius: 0.6rem;
        background: color-mix(
          in srgb,
          var(--color-success, #16a34a) 7%,
          var(--color-surface, #ffffff)
        );
        color: var(--color-text-primary, #111827);
      }
      .banner-success__icon {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        background: color-mix(
          in srgb,
          var(--color-success, #16a34a) 18%,
          transparent
        );
        color: var(--color-success, #16a34a);
      }
      .banner-success__body {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        flex: 1 1 auto;
        min-width: 0;
      }
      .banner-success__title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      .banner-success__detail {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.4;
        color: var(--color-text-secondary, #4b5563);
      }
      .banner-success__actions {
        margin-top: 0.6rem;
        display: flex;
        justify-content: flex-end;
      }
      .banner-success__actions .primary-btn {
        min-height: 2.2rem;
        padding: 0.4rem 0.9rem;
        font-size: 0.85rem;
        font-weight: 600;
        border-radius: 0.4rem;
        border: 1px solid
          var(--color-primary, #2563eb);
        background: var(--color-primary, #2563eb);
        color: #ffffff;
        cursor: pointer;
      }
      .banner-success__actions .primary-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .branch-selector {
        margin: 0;
        padding: 0.85rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
      }
      .branch-selector__legend {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        padding: 0;
      }
      .branch-selector__options {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.5rem;
      }
      @media (min-width: 640px) {
        .branch-selector__options {
          grid-template-columns: 1fr 1fr;
        }
      }
      .branch-selector__option {
        display: flex;
        align-items: flex-start;
        gap: 0.55rem;
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.4rem;
        cursor: pointer;
        background: var(--color-surface, #ffffff);
        color: var(--color-text-primary, #111827);
      }
      .branch-selector__option--active {
        border-color: var(--color-primary, #2563eb);
        background: color-mix(
          in srgb,
          var(--color-primary, #2563eb) 6%,
          var(--color-surface, #ffffff)
        );
      }
      .branch-selector__option input[type='radio'] {
        margin-top: 0.2rem;
      }
      .branch-selector__option-body {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .branch-selector__option-title {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .branch-selector__option-hint {
        margin: 0;
        font-size: 0.78rem;
        color: var(--color-text-secondary, #6b7280);
      }
      .identity-documents {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        padding: 0.85rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
      }
      .identity-documents__title {
        margin: 0;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
      }
      .identity-documents__hint {
        margin: 0;
        font-size: 0.82rem;
        line-height: 1.4;
        color: var(--color-text-secondary, #4b5563);
      }
      .identity-documents__row {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.55rem 0.7rem;
        border: 1px dashed var(--color-border);
        border-radius: 0.4rem;
      }
      .identity-documents__row-label {
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        display: flex;
        gap: 0.4rem;
        align-items: center;
      }
      .identity-documents__req {
        font-size: 0.7rem;
        font-weight: 500;
        color: var(--color-text-secondary, #6b7280);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .identity-documents__filename {
        margin: 0;
        font-size: 0.78rem;
        color: var(--color-text-secondary, #4b5563);
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

  // ─── QUI-657 ─────────────────────────────────────────────────────────────
  /** Rama del wizard: "tengo cert" (default) o "no tengo cert". */
  readonly certificateBranch = signal<'with_cert' | 'without_cert'>(
    'with_cert',
  );
  /**
   * Archivos de identidad seleccionados por el usuario en la rama
   * `without_cert`. La clave es el `document_type` que el backend espera.
   */
  readonly identityDocuments = signal<Record<IdentityDocumentType, File | null>>(
    { rut: null, id: null, certificate_of_existence: null },
  );
  /**
   * Resultado de un submit exitoso. Mientras está poblada, el step muestra
   * el banner persistente y el shell's "Continuar" está deshabilitado
   * (`valid = false`). Se libera cuando el usuario hace clic en "Continuar"
   * en el banner, momento en que se llama a `commitStep()` y el shell
   * destruye este step.
   */
  readonly successInfo = signal<SuccessInfo | null>(null);
  /** True mientras el banner está avanzando al siguiente step. */
  readonly committing = signal(false);

  /** person_type del prefill legal_data. */
  readonly personType = computed<'natural' | 'juridica'>(() => {
    const raw = this.service.prefill()?.legal_data?.person_type ?? '';
    const v = raw.toLowerCase();
    if (v === 'natural') return 'natural';
    return 'juridica';
  });

  /** Documentos exigidos por la entidad emisora para este `person_type`. */
  readonly requiredDocumentTypes = computed<IdentityDocumentType[]>(() =>
    this.personType() === 'natural' ? ['rut', 'id'] : ['rut', 'id', 'certificate_of_existence'],
  );

  /** Nombre legible del tenant para mostrar en el hint del expediente. */
  readonly entityDisplayName = computed(() => {
    const ld = this.service.prefill()?.legal_data;
    return ld?.legal_name ?? 'la entidad';
  });
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
    // QUI-657: cada cambio de contexto fiscal debe olvidar el resultado
    // pendiente y los archivos seleccionados — sino el banner persistente
    // sobreviviría un cambio de tienda y mostraría "éxito" de un submit
    // que ya no corresponde a este wizard.
    this.successInfo.set(null);
    this.committing.set(false);
    this.certificateBranch.set('with_cert');
    this.identityDocuments.set({
      rut: null,
      id: null,
      certificate_of_existence: null,
    });

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
      // QUI-679 review fix #5: rehidratar el banner desde el prefill para que
      // un wizard revisit muestre por qué no se pidió el `.p12`. Sin esto, el
      // banner solo aparecía tras un POST, y un comerciante que vuelve al step
      // después de un F5 lo veía vacío.
      if (dian.inherited_certificate && dian.inherited_from) {
        this.inheritedCertificate.set({
          dian_configuration_id: dian.inherited_from.id,
          configuration_type: dian.inherited_from.configuration_type,
          certificate_expiry: dian.inherited_from.certificate_expiry,
        });
      }
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

  /**
   * Cambia la rama y limpia los archivos seleccionados. Si el usuario vuelve
   * a `with_cert` después de subir documentos de identidad, no debe quedar
   * evidencia de ellos en la signal — un F5 los borra del `<input type="file">`
   * pero la signal sobreviviría.
   */
  onBranchChange(branch: 'with_cert' | 'without_cert'): void {
    this.certificateBranch.set(branch);
    this.identityDocuments.set({
      rut: null,
      id: null,
      certificate_of_existence: null,
    });
  }

  onDocumentFile(
    type: IdentityDocumentType,
    event: Event,
  ): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.identityDocuments.update((state) => ({ ...state, [type]: file }));
  }

  getDocumentFile(type: IdentityDocumentType): File | null {
    return this.identityDocuments()[type];
  }

  documentLabel(type: IdentityDocumentType): string {
    return {
      rut: 'RUT',
      id: 'Documento de identidad',
      certificate_of_existence:
        'Certificado de existencia y representación legal',
    }[type];
  }

  allowedMimeAccept(): string {
    // Lista blanca en espejo del backend: PDF, JPG, PNG, WEBP.
    return 'application/pdf,image/jpeg,image/png,image/webp';
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * Llamado por el botón "Continuar" del banner persistente.
   *
   * Es el ÚNICO punto donde este step llama a `commitStep()`. `submit()` no
   * lo hace: devuelve `{ ref }` y deja que el banner tome el control. El
   * shell se queda esperando porque `submit()` ya retornó y el `currentStep`
   * no cambia hasta que `commitStep()` corra. Eso mantiene el step montado
   * y el banner visible hasta que el usuario confirma.
   */
  async commitFromBanner(): Promise<void> {
    const info = this.successInfo();
    if (!info) return;
    this.committing.set(true);
    try {
      await this.service.commitStep(this.stepId, info.ref);
    } finally {
      this.committing.set(false);
    }
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

    // Si el banner persistente está mostrando un resultado, el shell's
    // "Continuar" está deshabilitado y `submit()` solo se llama si el usuario
    // hace clic en el botón del banner — que en su lugar llama a
    // `commitFromBanner()`. Esta guarda es defensiva: si alguien llega hasta
    // acá con un resultado pendiente, no hacemos doble POST.
    if (this.successInfo()) {
      return null;
    }

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
      // readOnlyForStore es un atajo: no escribimos nada, solo informamos
      // al shell que el step está completo. Como acá no hay banner que
      // mostrar, podemos llamar a commitStep() directamente.
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
      const ref = await this.persistConfigAndCertificate(value);

      // Diferir `commitStep()`: el banner persistente toma el control de
      // cuándo avanza el shell. Si no diferimos, el shell destruye el step
      // vía `@switch` antes de que el usuario pueda leer el resultado.
      // `valid` se baja a `false` para que el botón "Continuar" del shell
      // quede deshabilitado y el único camino de salida sea el banner.
      this.valid.set(false);
      this.successInfo.set(ref.successInfo);
      return { ref: ref.commitRef };
    } catch (e) {
      this.localError.set(parseApiError(e).userMessage);
      // El shell ya tenía el botón "Continuar" deshabilitado por el
      // `valid.set(false)` previo; no lo re-habilitamos en error porque
      // un reintento desde el shell lanzaría OTRO POST sobre el mismo
      // estado. El usuario corrige la forma y vuelve a hacer clic.
      return null;
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * Implementa la rama elegida por el usuario (`with_cert` o `without_cert`)
   * y devuelve la información que el step necesita después:
   *
   * - `commitRef` es lo que va al shell cuando el usuario hace clic en
   *   "Continuar" del banner.
   * - `successInfo` es lo que muestra el banner: cert heredado, expediente
   *   enviado, o config guardada en su rama más simple.
   *
   * Sacar esto de `submit()` es lo que permite que la rama `without_cert`
   * reutilice casi todo el código de la rama `with_cert` y que los errores
   * se mapeen igual a `parseApiError`.
   */
  private async persistConfigAndCertificate(
    value: DianConfigValue,
  ): Promise<{
    commitRef: Record<string, unknown>;
    successInfo: SuccessInfo;
  }> {
    // Pin the user-chosen branch on the DTO. Backend ignores it when the
    // config has a cert already, so the "with cert" path is a no-op for
    // existing configs.
    const branch = this.certificateBranch();
    const pinTouched =
      Boolean(value.software_pin) && value.software_pin !== MASKED_SECRET;
    const body: Record<string, unknown> = {
      name: value.name,
      nit: value.nit,
      nit_dv: value.nit_dv,
      nit_type: value.nit_type || 'NIT',
      software_id: value.software_id,
      ...(pinTouched ? { software_pin: value.software_pin } : {}),
      environment: value.environment,
      test_set_id: value.test_set_id || undefined,
      is_default: true,
      certificate_branch: branch,
      ...this.service.storeContext(),
    };

    let configId: number | null = this.existingConfigId();
    let inheritedFrom:
      | { id: number; configuration_type: string; certificate_expiry: string | null }
      | null = null;

    if (configId) {
      const res: any = await firstValueFrom(
        this.http.patch(`${this.baseUrl()}/${configId}`, body),
      );
      const payload = res?.data ?? res;
      configId =
        typeof payload?.id === 'number' ? payload.id : (configId ?? null);
      if (payload?.inherited_certificate && payload?.inherited_from) {
        inheritedFrom = {
          id: payload.inherited_from.id,
          configuration_type: payload.inherited_from.configuration_type,
          certificate_expiry:
            payload.inherited_from.certificate_expiry ?? null,
        };
        this.inheritedCertificate.set({
          dian_configuration_id: payload.inherited_from.id,
          configuration_type: payload.inherited_from.configuration_type,
          certificate_expiry: payload.inherited_from.certificate_expiry,
        });
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
      if (payload?.inherited_certificate && payload?.inherited_from) {
        inheritedFrom = {
          id: payload.inherited_from.id,
          configuration_type: payload.inherited_from.configuration_type,
          certificate_expiry:
            payload.inherited_from.certificate_expiry ?? null,
        };
        this.inheritedCertificate.set({
          dian_configuration_id: payload.inherited_from.id,
          configuration_type: payload.inherited_from.configuration_type,
          certificate_expiry: payload.inherited_from.certificate_expiry,
        });
        this.hasCertificate.set(true);
        this.certificateExpiry.set(
          payload.inherited_from?.certificate_expiry ?? null,
        );
      }
    }

    if (!configId) {
      // Sin id no podemos seguir: el backend no devolvió la fila creada y no
      // hay a qué subarle cert ni qué expediente enviar. Lanzar hace que
      // el catch del submit mapee el error y muestre `localError`.
      throw new Error('No se obtuvo el identificador de la configuración.');
    }

    // ─── Rama "tengo cert": subir el .p12 ─────────────────────────────
    if (branch === 'with_cert') {
      if (value.certificate_file && value.certificate_password) {
        const fd = new FormData();
        fd.append('certificate', value.certificate_file);
        fd.append('password', value.certificate_password);
        fd.append('config_id', String(configId));
        await firstValueFrom(
          this.http.post(`${this.baseUrl()}/upload-certificate`, fd),
        );
      }
    } else {
      // ─── Rama "no tengo cert": documentos de identidad ───────────────
      //
      // La resolución se persiste ANTES de enviar el expediente: la
      // habilitación de la DIAN exige que la resolución esté registrada
      // para poder emitir una vez que llegue el cert.
      const docs = this.identityDocuments();
      for (const document_type of this.requiredDocumentTypes()) {
        const file = docs[document_type];
        if (!file) {
          throw new Error(
            `Falta el documento obligatorio: ${this.documentLabel(document_type)}.`,
          );
        }
        const fd = new FormData();
        fd.append('document', file);
        fd.append('document_type', document_type);
        await firstValueFrom(
          this.http.post(
            `${this.baseUrl()}/${configId}/identity-documents`,
            fd,
          ),
        );
      }
      // Enviar el expediente a la cola del superadmin. Falla acá si la
      // entidad fiscal no tenía la `person_type` correcta o si la fila ya
      // tenía cert.
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl()}/${configId}/identity-documents/submit`,
          {},
        ),
      );
    }

    // La resolución se persiste en ambas ramas porque la habilitación DIAN
    // la exige para emitir. Si falla, el catch del submit aborta el step
    // SIN setear `successInfo`, así que el wizard no avanza.
    const resolutionId = await this.persistResolution(value);

    const commitRef = {
      dian_config_id: configId,
      resolution_id: resolutionId,
      environment: value.environment,
      branch,
      completed_at: new Date().toISOString(),
    };

    // Prioridad del banner: cert heredado > expediente enviado > config
    // guardada simple. El cert heredado es el caso más fuerte (la tienda YA
    // está lista para emitir), por lo que gana incluso si el usuario eligió
    // `without_cert` por error — el backend habría ignorado la rama de
    // todos modos.
    let successInfo: SuccessInfo;
    if (inheritedFrom) {
      successInfo = {
        kind: 'inherited',
        ref: commitRef,
        inherited_from: inheritedFrom,
      };
    } else if (branch === 'without_cert') {
      successInfo = { kind: 'documents_submitted', ref: commitRef };
    } else {
      successInfo = { kind: 'config_saved', ref: commitRef };
    }

    return { commitRef, successInfo };
  }
}
