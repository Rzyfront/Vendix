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
import { FileUploadDropzoneComponent } from '../../file-upload-dropzone/file-upload-dropzone.component';
import { DianHabilitationScannerModalComponent } from '../../dian-habilitation-scanner/dian-habilitation-scanner-modal.component';
import {
  DianHabilitationScanResult,
  HabilitationScanField,
  HabilitationScannerScope,
} from '../../dian-habilitation-scanner/interfaces/habilitation-scan-result.interface';
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
      /**
       * Expediente PARCIAL: se guardó la configuración y los documentos que el
       * usuario sí aportó, pero el trámite del certificado NO se envió a la
       * cola del superadmin porque faltan piezas. Es un estado legítimo, no un
       * error: el paso avanza y el tenant vuelve cuando tenga el resto.
       * `missing` es lo que falta, para poder decírselo por su nombre.
       */
      kind: 'documents_partial';
      ref: Record<string, unknown>;
      missing: IdentityDocumentType[];
    }
  | {
      kind: 'config_saved';
      ref: Record<string, unknown>;
    };

@Component({
  selector: 'app-fiscal-dian-config-step',
  standalone: true,
  imports: [
    CommonModule,
    DianConfigFormComponent,
    IconComponent,
    FileUploadDropzoneComponent,
    DianHabilitationScannerModalComponent,
  ],
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
              @case ('documents_partial') {
                <p class="banner-success__title">
                  Guardamos lo que aportaste. El trámite aún no se envía.
                </p>
                <p class="banner-success__detail">
                  Registramos la configuración DIAN y los documentos que ya
                  adjuntaste. El trámite del certificado de firma
                  <strong>todavía no se envió</strong>, porque el expediente
                  está incompleto: falta
                  {{ documentLabelList(success.missing) }}. Puedes continuar
                  con la activación y volver a este paso para adjuntarlo; el
                  envío ocurre cuando el expediente esté completo. Hasta
                  entonces tu tienda no podrá emitir documentos electrónicos.
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

        @if (identityBranchActive()) {
          <!--
            Carga de documentos de identidad. El juego depende de
            person_type: persona natural nunca aporta certificado de existencia
            (una persona natural no tiene representación legal). El backend
            lo rechaza igual, pero el cliente no debe ofrecer el campo: es
            pedirle al usuario algo que va a recibir un 400.
          -->
          <p class="identity-documents-banner" role="note">
            <app-icon name="info" [size]="18"></app-icon>
            <span>
              Adjunta los documentos que la entidad emisora exige para
              expedir el certificado a nombre de
              <strong>{{ entityDisplayName() }}</strong>
              (NIT {{ form.getValue().nit }}@if (form.getValue().nit_dv) {-{{ form.getValue().nit_dv }}}).
              @if (personType() === 'juridica') {
                Como persona jurídica también necesitas el certificado de
                existencia y representación legal.
              }
            </span>
          </p>

          <div class="identity-documents">
            <h3 class="identity-documents__title">Documentos de identidad</h3>
            <section class="identity-documents__grid">
              @for (doc of requiredDocumentTypes(); track doc) {
                <app-file-upload-dropzone
                  accept="application/pdf"
                  icon="upload-cloud"
                  [label]="documentLabel(doc)"
                  helperText="Obligatorio · Solo PDF"
                  (fileSelected)="onDocumentFile(doc, $event)"
                  (fileRemoved)="removeDocumentFile(doc)"
                ></app-file-upload-dropzone>
              }
            </section>
          </div>
        }

        <!--
          Lectura por foto del set de pruebas DIAN. Vive ARRIBA del formulario
          porque su valor es evitar transcribir a mano dos UUID, un PIN y una
          clave técnica de 40 caracteres: ofrecerlo después de que el usuario ya
          tecleó no ahorra nada. Se oculta en solo-lectura (la tienda no puede
          escribir sobre una configuración de la organización).
        -->
        @if (!readOnlyForStore()) {
          <section class="scan-cta">
            <div class="scan-cta__body">
              <p class="scan-cta__title">
                ¿Tienes a la mano el set de pruebas de la DIAN?
              </p>
              <p class="scan-cta__hint">
                Sube una foto y la IA llena Software ID, PIN, Test Set ID y la
                resolución de pruebas. Podrás revisar cada campo antes de
                aplicarlo.
              </p>
            </div>
            <button
              type="button"
              class="scan-cta__button"
              [disabled]="submitting()"
              (click)="openScanner()"
            >
              <app-icon name="sparkles" [size]="16"></app-icon>
              <span>Escanear con IA</span>
            </button>
          </section>

          <app-dian-habilitation-scanner-modal
            [isOpen]="scannerOpen()"
            [scope]="scannerScope()"
            (isOpenChange)="scannerOpen.set($event)"
            (confirmed)="onScanConfirmed($event)"
          ></app-dian-habilitation-scanner-modal>
        }

        <app-dian-config-form
          #form
          [initialValue]="initial()"
          [disabled]="submitting() || readOnlyForStore()"
          [hasCertificate]="hasCertificate()"
          [certificateExpiry]="certificateExpiry()"
          [hideCertificate]="identityBranchActive()"
          [requireDianCredentials]="!identityBranchActive()"
          [storedTechnicalKeyLength]="storedTechnicalKey()?.length ?? null"
          (validityChange)="onValidity($event)"
        ></app-dian-config-form>

        @if (localError()) {
          <p class="step-error" role="alert">{{ localError() }}</p>
        } @else if (!valid() && blockingReasons().length) {
          <!--
            Guía EN REPOSO, no un error: por eso role="note" y no
            role="alert". El usuario no acaba de equivocarse, simplemente
            todavía no ha llenado algo.

            Sin este bloque el paso es un callejón sin salida: el shell apaga
            su "Continuar" con !valid(), los mensajes por campo de app-input
            solo se pintan cuando el control está touched, y lo único que
            marca todo tocado es el markAllTouched() de un submit() que el
            botón apagado impide disparar. Resultado: botón muerto y ninguna
            pista. Acá el motivo se muestra sin depender de ningún clic.
          -->
          <div class="blocking-reasons" role="note">
            <app-icon name="info" [size]="18"></app-icon>
            <div class="blocking-reasons__body">
              <p class="blocking-reasons__title">Para continuar falta:</p>
              <ul class="blocking-reasons__list">
                @for (reason of blockingReasons(); track reason) {
                  <li>{{ reason }}</li>
                }
              </ul>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: `
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
      .scan-cta {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.85rem 1rem;
        border: 1px solid
          color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
        border-radius: 0.5rem;
        background: color-mix(
          in srgb,
          var(--color-primary) 8%,
          var(--color-surface, #ffffff)
        );
      }
      @media (min-width: 768px) {
        .scan-cta {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }
      }
      .scan-cta__title {
        margin: 0;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
      }
      .scan-cta__hint {
        margin: 0.15rem 0 0;
        font-size: 0.8rem;
        line-height: 1.4;
        color: var(--color-text-secondary, #4b5563);
      }
      .scan-cta__button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        flex: 0 0 auto;
        padding: 0.55rem 1rem;
        border: none;
        border-radius: 0.5rem;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        background: var(--color-primary);
        color: var(--color-text-on-primary, #ffffff);
      }
      .scan-cta__button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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
      /*
       * Banner informativo azul que vive FUERA del grid de dropzones.
       * Span completo del ancho para que la copy no quede torcida dentro
       * de una de las 3 columnas de PC.
       *
       * El bloque "Para continuar falta" comparte esta misma caja —mismo
       * borde, mismo relleno, mismos tokens— en vez de estrenar un sistema
       * visual: es el mismo registro de voz (una nota informativa), y
       * duplicar tokens es cómo se desalinean después.
       */
      .identity-documents-banner,
      .blocking-reasons {
        display: flex;
        gap: 0.6rem;
        align-items: flex-start;
        padding: 0.85rem 1rem;
        margin: 0 0 0.6rem 0;
        width: 100%;
        border: 1px solid color-mix(in srgb, var(--color-info) 35%, var(--color-border));
        border-radius: 0.55rem;
        background: color-mix(in srgb, var(--color-info) 8%, var(--color-surface));
        color: var(--color-text-primary, #0f172a);
        font-size: 0.84rem;
        line-height: 1.45;
        box-sizing: border-box;
      }
      .identity-documents-banner app-icon,
      .blocking-reasons app-icon {
        flex: 0 0 auto;
        color: var(--color-info);
        margin-top: 0.1rem;
      }
      .identity-documents-banner span,
      .blocking-reasons__body {
        flex: 1 1 auto;
      }
      .identity-documents-banner strong {
        color: var(--color-text-primary, #0f172a);
        font-weight: 600;
      }
      .blocking-reasons__title {
        margin: 0;
        font-weight: 600;
      }
      .blocking-reasons__list {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        margin: 0.3rem 0 0;
        padding-left: 1.1rem;
      }

      /*
       * Contenedor de los 3 dropzones de identidad. Hacemos grid aquí
       * para que el padre pinte las 3 fichas en fila en PC y apiladas
       * en móvil/tablet. El __row queda como wrapper transparente.
       */
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
        width: 100%;
      }
      .identity-documents__grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.6rem;
        width: 100%;
      }
      @media (min-width: 768px) {
        .identity-documents__grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.75rem;
        }
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
})
export class FiscalDianConfigStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly stepId: FiscalWizardStepId = 'dian_config';
  /**
   * Puerta de avance que LEE EL SHELL (`!step()?.valid()` deshabilita su
   * "Continuar"). No es lo que emite el formulario: es el veredicto que
   * calcula `recomputeValid()` combinando esa emisión con la regla de la rama
   * activa. Sigue siendo una signal escribible porque `submit()` necesita
   * poder forzarla a `false` y dejar el banner como único camino de salida.
   */
  readonly valid = signal(false);
  /**
   * Última validez emitida por `app-dian-config-form`. Se guarda aparte de
   * `valid` porque en la rama de documentos de identidad la validez del
   * formulario deja de ser la única condición para avanzar.
   */
  private readonly formValid = signal(false);
  /**
   * Motivos, en español y legibles, por los que el "Continuar" del shell está
   * apagado. Es una signal escrita a mano y no un `computed` por la misma
   * razón que `valid`: el veredicto nace de `describeInvalidFields()`, que
   * lee `FormControl`s —no reactivos bajo Zoneless—, así que hay que
   * refrescarlo en los mismos puntos donde se recalcula la validez.
   */
  readonly blockingReasons = signal<string[]>([]);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<DianConfigValue> | null>(null);
  readonly existingConfigId = signal<number | null>(null);
  /** Active numbering resolution already persisted for this fiscal entity. */
  readonly existingResolutionId = signal<number | null>(null);

  /**
   * Clave técnica YA GUARDADA para la resolución del prefill, descrita por su
   * longitud. `null` cuando no hay ninguna.
   *
   * Nunca contiene el valor: el backend dejó de enviarlo. Lo que la UI necesita
   * decir es «ya hay una, de 40 caracteres» para que el usuario no la reescriba
   * a ciegas —y para que una de 38, que es lo que quemó un consecutivo en
   * producción, sea visible de inmediato.
   */
  readonly storedTechnicalKey = signal<{ length: number } | null>(null);
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
  /**
   * Default de rama: ahora arranca en `without_cert` para reducir fricción en
   * tiendas nuevas (el camino más común es tramitar el cert con la plataforma,
   * no subirlo). Si la prefill ya tiene cert (`hasCertificate() === true`)
   * la bifurcación ni se renderiza, así que este default aplica solo al
   * primer wizard visit.
   */
  readonly certificateBranch = signal<'with_cert' | 'without_cert'>(
    'without_cert',
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

  /**
   * Rama de documentos de identidad activa: el usuario dijo "no tengo
   * certificado" y no hay uno propio ni heredado que lo desmienta. Es el
   * predicado ÚNICO del que cuelgan tres decisiones que antes se escribían
   * a mano por separado: ocultar el bloque de certificado, relajar la
   * exigencia de credenciales DIAN, y cambiar la puerta de avance.
   */
  readonly identityBranchActive = computed(
    () => this.certificateBranch() === 'without_cert' && !this.hasCertificate(),
  );

  /**
   * Documentos de identidad efectivamente adjuntos, contados SOLO sobre los
   * que exige el `person_type` actual: un certificado de existencia cargado y
   * luego cambiado a persona natural no debe seguir sumando.
   */
  readonly attachedDocumentCount = computed(() => {
    const docs = this.identityDocuments();
    return this.requiredDocumentTypes().filter((type) => docs[type] !== null)
      .length;
  });

  /** Documentos del juego completo que todavía faltan por adjuntar. */
  readonly missingDocumentTypes = computed<IdentityDocumentType[]>(() => {
    const docs = this.identityDocuments();
    return this.requiredDocumentTypes().filter((type) => docs[type] === null);
  });

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

  // ─── Escáner IA del set de pruebas DIAN ──────────────────────────────────
  /** Visibilidad del modal de escaneo. */
  readonly scannerOpen = signal(false);
  /**
   * Namespace al que pega el escáner. Es el scope del USUARIO, igual que
   * `baseUrl()`: quien decide la ruta es el app type con el que entró, no el
   * `fiscal_scope` de la organización (el backend resuelve la propiedad fiscal
   * del otro lado).
   */
  readonly scannerScope = computed<HabilitationScannerScope>(() =>
    this.service.userScope() === 'organization' ? 'organization' : 'store',
  );

  openScanner(): void {
    this.scannerOpen.set(true);
  }

  /**
   * Precarga el formulario con lo que la IA logró leer.
   *
   * Se aplica TODO campo con valor (`value !== null`), incluidos los marcados
   * "confírmalo": el modal ya los mostró uno por uno con su advertencia y exigió
   * la casilla de verificación, así que el usuario aceptó esos valores a
   * sabiendas. Lo que NO se aplica es lo que falló su regla estructural — el
   * backend ya lo devolvió como `null`, y precargar un UUID incompleto o un
   * rango invertido sería peor que dejar el campo vacío.
   *
   * `environment` entra igual que el resto: si los documentos son de
   * habilitación, el ambiente correcto es `test` y dejar 'production' pegado de
   * una edición anterior sería mandar el set de pruebas al ambiente real.
   */
  onScanConfirmed(scan: DianHabilitationScanResult): void {
    const patch: Partial<DianConfigValue> = {};

    const take = <K extends keyof DianConfigValue>(
      key: K,
      field: HabilitationScanField<DianConfigValue[K] & {}>,
    ): void => {
      if (field.value !== null && field.value !== undefined) {
        patch[key] = field.value;
      }
    };

    take('name', scan.name);
    take('nit', scan.nit);
    take('nit_dv', scan.nit_dv);
    take('environment', scan.environment);
    take('software_id', scan.software_id);
    take('software_pin', scan.software_pin);
    take('test_set_id', scan.test_set_id);
    take('resolution_number', scan.resolution_number);
    take('resolution_prefix', scan.resolution_prefix);
    take('resolution_range_from', scan.resolution_range_from);
    take('resolution_range_to', scan.resolution_range_to);
    take('resolution_valid_from', scan.resolution_valid_from);
    take('resolution_valid_to', scan.resolution_valid_to);
    take('resolution_date', scan.resolution_date);
    take('resolution_technical_key', scan.resolution_technical_key);

    // El NIT sale del RUT, no del set de pruebas: el documento imprime el del
    // facturador, que es el mismo, pero el tipo de documento no aparece en
    // ninguna parte y siempre es NIT en una habilitación.
    if (patch.nit) {
      patch.nit_type = 'NIT';
    }

    this.form().applyScan(patch);
    this.localError.set(null);
  }

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
    this.certificateBranch.set('without_cert');
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
    this.storedTechnicalKey.set(
      resolution.technical_key_set
        ? { length: resolution.technical_key_length }
        : null,
    );
    return {
      resolution_number: resolution.resolution_number ?? '',
      resolution_prefix: resolution.prefix ?? '',
      resolution_range_from: resolution.range_from ?? null,
      resolution_range_to: resolution.range_to ?? null,
      resolution_valid_from: toDateInput(resolution.valid_from),
      resolution_valid_to: toDateInput(resolution.valid_to),
      resolution_date: toDateInput(resolution.resolution_date),
      // VACÍO a propósito, y no la clave: el backend dejó de mandarla porque es
      // el secreto que hashea el CUFE. Vacío significa «conserva la guardada»
      // —`buildResolutionBody` sólo incluye `technical_key` cuando el campo
      // trae algo—, y `storedTechnicalKey` es lo que la UI muestra para que el
      // usuario sepa que sí hay una y no la vuelva a teclear por las dudas.
      resolution_technical_key: '',
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
    this.formValid.set(v);
    this.recomputeValid();
  }

  /**
   * Decide si el shell puede habilitar su "Continuar".
   *
   * En la rama normal la regla es la de siempre: lo que diga el formulario.
   * En la rama de documentos de identidad la DIAN todavía no ha emitido el
   * software_id ni la resolución —son justamente lo que el tenant viene a
   * tramitar—, así que exigirlos deja el botón muerto para siempre. Ahí la
   * puerta pasa a ser "al menos UN documento adjunto": lo que el paso puede
   * verificar y lo único que el tenant puede aportar hoy.
   *
   * Es un método imperativo y no un `computed` porque `valid` también se
   * fuerza a `false` desde `submit()`: mientras el banner de resultado está
   * en pantalla, el único camino de salida debe ser su botón.
   */
  private recomputeValid(): void {
    // El motivo del bloqueo se recalcula DENTRO de este método, nunca en un
    // call-site aparte: si se separaran, un punto que actualiza uno y olvida
    // el otro deja la UI diciendo una cosa y el botón haciendo otra.
    this.recomputeBlockingReasons();
    if (this.successInfo()) {
      this.valid.set(false);
      return;
    }
    if (this.identityBranchActive()) {
      this.valid.set(this.formValid() && this.attachedDocumentCount() > 0);
      return;
    }
    this.valid.set(this.formValid());
  }

  /**
   * Traduce el veredicto del formulario —más la regla propia de este paso— a
   * una lista que el usuario pueda leer y accionar.
   *
   * `describeInvalidFields()` ya respeta la relajación de
   * `requireDianCredentials`, así que en la rama de identidad no nombra
   * credenciales que la DIAN todavía no ha emitido. Lo que ese método no
   * puede saber es la regla que vive acá: en esa rama el paso también exige
   * un documento adjunto, y ese motivo se añade sin él.
   */
  private recomputeBlockingReasons(): void {
    if (this.successInfo()) {
      this.blockingReasons.set([]);
      return;
    }
    const reasons: string[] = [];
    try {
      reasons.push(...this.form().describeInvalidFields());
    } catch {
      // `viewChild.required` lanza si el formulario todavía no está en el
      // árbol (o si el banner ya lo reemplazó). Sin formulario no hay
      // veredicto que traducir, y no tener motivos es la respuesta correcta.
    }
    if (this.identityBranchActive() && this.attachedDocumentCount() === 0) {
      reasons.push('Adjunta al menos un documento de identidad');
    }
    this.blockingReasons.set(reasons);
  }

  /**
   * Cambia la rama y limpia los archivos seleccionados. Si el usuario vuelve
   * a `with_cert` después de subir documentos de identidad, no debe quedar
   * evidencia de ellos en la signal — un F5 los borra del `<input type="file">`
   * pero la signal sobreviviría.
   */
  onBranchChange(branch: 'with_cert' | 'without_cert'): void {
    this.certificateBranch.set(branch);
    // La rama cambia la regla de avance Y borra los adjuntos: hay que
    // reevaluar antes de que el usuario toque nada más.
    this.recomputeValid();
    this.identityDocuments.set({
      rut: null,
      id: null,
      certificate_of_existence: null,
    });
    // Si vamos a "no tengo cert", vaciamos también el archivo y contraseña
    // del cert cargados en el form. Si vamos a "tengo cert", no tocamos
    // la password — el sentinel MASKED_SECRET que el padre inyectó indica
    // "el cert sigue cargado en backend".
    if (branch === 'without_cert') {
      const form = this.form();
      if (form) {
        form.removeFile();
      }
    }
  }

  /**
   * Vinculado al `(fileRemoved)` del dropzone de identidad. El backend
   * ya rechazó documentos previos con 400 si el expediente está `issuing`
   * o `issued`; acá permitimos borrar mientras la prefill siga editable.
   */
  removeDocumentFile(type: IdentityDocumentType): void {
    this.identityDocuments.update((state) => ({
      ...state,
      [type]: null,
    }));
    this.recomputeValid();
  }

  /**
   * Dropzone emite `File` directo en `fileSelected`. Si el usuario cancela
   * el picker, no se llama y el signal existente se preserva.
   */
  onDocumentFile(type: IdentityDocumentType, file: File): void {
    this.identityDocuments.update((state) => ({ ...state, [type]: file }));
    // El primer adjunto es el que abre el "Continuar" en la rama de
    // identidad; sin este recálculo el botón esperaría a que el formulario
    // volviera a emitir validez, que puede no ocurrir nunca.
    this.recomputeValid();
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

  /**
   * Enumera documentos faltantes en prosa ("el RUT y el documento de
   * identidad"), para que el banner del expediente parcial diga qué falta
   * con el mismo nombre que llevan los dropzones de arriba.
   */
  documentLabelList(types: IdentityDocumentType[]): string {
    const labels = types.map((type) => this.documentLabel(type));
    if (labels.length <= 1) return labels[0] ?? '';
    return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
  }

  /**
   * Los documentos de identidad se aceptan SOLO en PDF. El backend
   * (`DIAN_IDENTITY_DOCUMENT_MIME_TYPES`) sigue aceptando JPG/PNG/WEBP
   * por compatibilidad con flujos legacy, pero el wizard bloquea el picker
   * del navegador a PDF y muestra helperText "Solo PDF" en el dropzone.
   */
  allowedMimeAccept(): string {
    return 'application/pdf';
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

    // En la rama de documentos de identidad el validador de grupo está
    // relajado (`requireDianCredentials=false`), así que "hay algo escrito"
    // ya NO implica "está completo" — que era la premisa que hacía seguro
    // decidir con `hasResolutionInput()`. Mandar un rango a medias devuelve
    // 400 y tumba el paso entero por un bloque que la DIAN todavía no ha
    // emitido. Se omite la persistencia y se conserva la resolución previa
    // si la había.
    if (this.identityBranchActive() && !form.hasCompleteResolutionInput()) {
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
    // Lo que falta del juego completo decide DOS cosas más abajo: si el
    // expediente se manda a la cola del superadmin, y qué banner ve el
    // usuario. Se lee una sola vez, antes de tocar la red.
    const missingDocuments = this.missingDocumentTypes();
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
      // Se sube LO QUE HAYA, sin exigir el juego completo. La puerta de
      // avance del paso es "al menos un documento" (ver `recomputeValid`):
      // lanzar acá por un faltante contradiría esa puerta y volvería a
      // dejar varado al tenant que solo tiene el RUT a mano.
      const docs = this.identityDocuments();
      const attached = this.requiredDocumentTypes().filter(
        (document_type) => docs[document_type] !== null,
      );
      if (attached.length === 0) {
        // Guarda defensiva: `valid` ya debería haber impedido llegar acá.
        // Si llegamos, subir cero documentos dejaría una fila vacía que
        // nadie puede tramitar.
        throw new Error(
          'Adjunta al menos un documento de identidad para continuar.',
        );
      }
      for (const document_type of attached) {
        const file = docs[document_type] as File;
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

      // El expediente se ENVÍA a la cola del superadmin SOLO cuando está
      // completo. El backend (`dian-config.service.ts`,
      // `submitIdentityDocuments`) rechaza con 400 un expediente incompleto,
      // y lo documenta así: «Un expediente incompleto en la cola le hace
      // perder el viaje a un humano y devuelve al tenant a la casilla de
      // salida días después.» La fila ya nace en
      // `certificate_provisioning_status = 'documents_pending'`, que es
      // exactamente el estado de espera correcto para lo que falta. Decisión
      // explícita: avanzar sí, enviar el expediente no.
      if (missingDocuments.length === 0) {
        await firstValueFrom(
          this.http.post(
            `${this.baseUrl()}/${configId}/identity-documents/submit`,
            {},
          ),
        );
      }
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
      // El banner debe decir la verdad de lo que ACABA de pasar: expediente
      // enviado solo si se envió; si quedó parcial, nombrar lo que falta.
      successInfo =
        missingDocuments.length === 0
          ? { kind: 'documents_submitted', ref: commitRef }
          : {
              kind: 'documents_partial',
              ref: commitRef,
              missing: missingDocuments,
            };
    } else {
      successInfo = { kind: 'config_saved', ref: commitRef };
    }

    return { commitRef, successInfo };
  }
}
