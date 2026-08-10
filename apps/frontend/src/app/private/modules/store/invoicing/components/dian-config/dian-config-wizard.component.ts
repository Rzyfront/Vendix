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
import { NgClass, DatePipe } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { map, switchMap, timer, type Subscription } from 'rxjs';
// Validadores compartidos por las cuatro puertas de entrada de configuración DIAN.
// Son el espejo del DTO del backend: lo que el DTO rechaza, se rechaza acá antes
// de gastar un viaje a la DIAN.
import {
  DIAN_VALIDATION_MESSAGES,
  dianSoftwarePinValidator,
  dianUuidValidator,
  nitFormatValidator,
} from '../../../../../../shared/utils/dian-validators';
import { nitDvValidator } from '../../../../../../shared/utils/nit.util';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { pollAsyncJob } from '../../../../../../core/utils/async-job-poll.util';
import {
  DianAuditLog,
  DianConfig,
  DianProductionReadiness,
  DianTestResult,
  InvoiceResolution,
} from '../../interfaces/invoice.interface';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../shared/components/steps-line/steps-line.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  DianTechnicalResponseComponent,
  DianTechnicalResponseData,
} from '../../../../../../shared/components/dian-technical-response/dian-technical-response.component';

/**
 * Typed credentials form interface.
 * Kept strict per `vendix-angular-forms` skill.
 */
interface CredentialsForm {
  name: FormControl<string>;
  nit_type: FormControl<string>;
  nit: FormControl<string>;
  nit_dv: FormControl<string>;
  software_id: FormControl<string>;
  software_pin: FormControl<string>;
  test_set_id: FormControl<string>;
}

interface CertificateForm {
  certificate_password: FormControl<string>;
}

/** Sentinel the API returns instead of a stored secret. */
const MASKED_SECRET = '****';

/** How often the UI re-asks DIAN for a verdict while a batch is queued. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Automatic polls before the UI stops and invites the merchant to come back
 * later. 20 × 15 s ≈ 5 minutes — long enough for a fast DIAN response, short
 * enough that nobody sits watching a spinner. The ZipKey is persisted, so
 * "Consultar estado" resolves the verdict whenever they return.
 */
const MAX_AUTO_POLLS = 20;

/** How often the waiting card rotates its fiscal tip. */
const TIP_ROTATION_MS = 9_000;

/**
 * Shown while DIAN validates the batch. Real habilitación facts, so the wait
 * teaches something instead of just spinning.
 */
const DIAN_TIPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'La DIAN define cuántos documentos exige tu set',
    body: 'Hoy son 50: 30 facturas de venta, 10 notas débito y 10 notas crédito. La cifra exacta la muestra el portal de habilitación en «Total de documentos requeridos» — es el único dato válido. La DIAN los valida en bloque: o aprueba el conjunto, o reporta los errores de cada documento.',
  },
  {
    title: 'La validación es asíncrona',
    body: 'La DIAN responde primero con un ZipKey (acuse de recibo) y valida después. Por eso el resultado puede tardar desde segundos hasta varias horas en horas pico.',
  },
  {
    title: 'No reenvíes el set mientras esté en validación',
    body: 'Un reenvío consume otros 50 números de tu resolución y la DIAN lo rechaza por duplicado. Usa "Consultar estado": no reenvía nada.',
  },
  {
    title: 'La clave técnica (ClTec) alimenta el CUFE',
    body: 'El CUFE se calcula con el NIT, los totales, la fecha y la clave técnica de la resolución. Si la ClTec está mal, todos los documentos fallan la firma.',
  },
  {
    title: 'La habilitación es automática',
    body: 'Cuando la DIAN aprueba el set, actualiza tu RUT con la responsabilidad 52 (facturador electrónico). No hay que radicar nada más.',
  },
  {
    title: 'El rango SETP no sirve para facturar',
    body: 'El rango de habilitación (prefijo SETP) es solo de pruebas. Para producción necesitas la Autorización de Numeración de Facturación que se solicita en Muisca.',
  },
  {
    title: 'Guarda el certificado vigente',
    body: 'La firma XAdES usa tu certificado digital. Si vence, la DIAN rechaza cada documento aunque el resto de la configuración esté perfecta.',
  },
];

/** Visual state of the test-set panel. */
type TestSetState = 'idle' | 'running' | 'pending' | 'passed' | 'rejected';

/** Per-document answer from DIAN about an already submitted batch. */
interface TestSetDiagnosisDocument {
  number: string;
  kind: string;
  cufe: string;
  registered: boolean;
  status_code: string;
  status_message: string;
}

interface TestSetDiagnosis {
  zip_key: string;
  total_documents: number;
  sampled: number;
  registered_count: number;
  verdict: 'not_registered' | 'partially_registered' | 'registered';
  documents: TestSetDiagnosisDocument[];
}

/** The persisted `last_test_result` JSON, as returned by GET :id/test-results. */
interface PersistedTestResult {
  executed_at?: string;
  rechecked_at?: string;
  total_documents?: number;
  invoices?: number;
  debit_notes?: number;
  credit_notes?: number;
  zip_key?: string | null;
  pending?: boolean;
  rejected?: boolean;
  tracking_id?: string;
  number_from?: number;
  number_to?: number;
  /** Resolución usada en ese envío; preselecciona el selector al volver. */
  resolution_id?: number | null;
  /** Nombre del ZIP entregado a la DIAN. Su longitud es parte del contrato del anexo. */
  zip_file_name?: string | null;
  operation_mode?: string | null;
  /** Evidencia por documento, incluido el nombre de archivo dentro del ZIP. */
  documents?: Array<{
    number?: string;
    kind?: string;
    cufe?: string;
    file_name?: string;
  }>;
  dian_response?: {
    success?: boolean;
    status_code?: string;
    status_message?: string;
    error_messages?: string[];
    /** Sobre SOAP crudo, recortado a 12 KB por el backend. */
    raw_response?: string;
  };
  poll_history?: Array<{
    attempt: number;
    status_code: string;
    status_message: string;
    success: boolean;
  }>;
  /**
   * Vía de validación sincrónica (`SendBillSync`), anidada porque no reemplaza al
   * lote. Es el veredicto que no admite interpretación: la DIAN respondió en la
   * misma llamada con `IsValid` y las reglas violadas.
   */
  validation?: {
    executed_at?: string | null;
    is_valid?: boolean;
    dian_response?: {
      status_code?: string;
      status_message?: string;
      error_messages?: string[];
      raw_response?: string;
    } | null;
  } | null;
}

/**
 * DIAN Configuration Wizard — 5-step standalone component.
 *
 * Steps:
 *  1. Credentials (NIT, software_id, pin, test_set_id)
 *  2. Certificate upload (.p12 + password) — uses existing S3 pattern (server persists only s3_key)
 *  3. Environment (test / production)
 *  4. Test connection / run test set
 *  5. Audit log
 *
 * Inputs:
 *  - initialConfig: DianConfig | null — existing config to edit, or null for new.
 *  - initialStep: number — 0-based step to start on (used when resuming).
 *
 * Outputs:
 *  - saved(DianConfig): emitted whenever the config is persisted (create/update/cert/env).
 *  - cancelled(): emitted when user closes/cancels.
 */
@Component({
  selector: 'vendix-dian-config-wizard',
  standalone: true,
  imports: [
    NgClass,
    DatePipe,
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    StepsLineComponent,
    DianTechnicalResponseComponent,
  ],
  template: `
    <div class="space-y-4">
      <!-- Stepper Navigation -->
      <app-steps-line
        [steps]="stepsConfig"
        [currentStep]="activeStep()"
        [clickable]="true"
        size="md"
        (stepClicked)="activeStep.set($event)"
      ></app-steps-line>

      <!-- ═══ Step 1: Credentials ═══ -->
      @if (activeStep() === 0) {
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-[var(--color-surface)]">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="key" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Credenciales DIAN</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Ingrese los datos de su empresa y credenciales del software de facturacion electronica.
          </p>
          <form [formGroup]="credentialsForm" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="Nombre de la configuracion"
                formControlName="name"
                [control]="nameControl"
                placeholder="Ej: Empresa SAS, Persona Natural"
                [required]="true"
              ></app-input>
              <app-selector
                label="Tipo de documento"
                formControlName="nit_type"
                [options]="nitTypeOptions"
                placeholder="Seleccione tipo"
              ></app-selector>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="NIT / Documento"
                formControlName="nit"
                [control]="nitControl"
                placeholder="Ej: 900123456"
                [required]="true"
              ></app-input>
              <app-input
                label="Digito de Verificacion (DV)"
                formControlName="nit_dv"
                [control]="nitDvControl"
                placeholder="Ej: 7"
              ></app-input>
            </div>
            <!--
              El error del DV es de GRUPO: compara nit con nit_dv, y ningun
              validador de control puede ver a su hermano. Por eso app-input no lo
              pinta y se muestra aca. Se exige touched en los dos para no gritarle
              al usuario mientras todavia esta escribiendo el NIT.
              (Sin acentos ni backticks: este comentario vive dentro del template
              literal del componente, y un backtick lo corta.)
            -->
            @if (
              credentialsForm.hasError('nitDv') &&
              nitControl.touched &&
              nitDvControl.touched
            ) {
              <p class="text-xs text-error font-medium">{{ nitDvMessage }}</p>
            }
            <app-input
              label="Software ID"
              formControlName="software_id"
              [control]="softwareIdControl"
              placeholder="ID del software registrado en la DIAN"
              [required]="true"
            ></app-input>
            <app-input
              label="PIN del Software"
              type="password"
              formControlName="software_pin"
              [control]="softwarePinControl"
              [placeholder]="selectedConfig() ? 'PIN guardado — escribe uno nuevo solo si deseas cambiarlo' : 'PIN secreto del software'"
              [required]="!selectedConfig()"
            ></app-input>
            <app-input
              label="Test Set ID"
              formControlName="test_set_id"
              [control]="testSetIdControl"
              placeholder="ID del set de pruebas (opcional)"
            ></app-input>
          </form>
          <div class="flex items-center justify-between gap-3 pt-4 border-t border-border">
            <app-button variant="ghost" size="sm" (clicked)="cancelled.emit()">
              Cancelar
            </app-button>
            <div class="flex items-center gap-2">
              <!-- Already-saved credentials must not force a pointless PATCH just
                   to move forward. -->
              @if (selectedConfig()) {
                <app-button variant="outline" (clicked)="activeStep.set(1)">
                  Continuar sin cambios
                  <app-icon slot="icon" name="arrow-right" [size]="14"></app-icon>
                </app-button>
              }
              <app-button
                variant="primary"
                (clicked)="saveCredentials()"
                [disabled]="credentialsForm.invalid || savingCredentials()"
                [loading]="savingCredentials()"
              >
                {{ selectedConfig() ? 'Actualizar' : 'Guardar' }} Credenciales
              </app-button>
            </div>
          </div>
        </div>
      }

      <!-- ═══ Step 2: Certificate ═══ -->
      @if (activeStep() === 1) {
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-[var(--color-surface)]">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="upload" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Certificado Digital</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Suba su certificado digital (.p12) para firmar las facturas electronicas.
          </p>
          @if (!selectedConfig()) {
            <div class="p-3 rounded-lg bg-warning-light border border-warning text-warning text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Primero debe guardar las credenciales en el Paso 1.
              </div>
            </div>
          }
          @if (selectedConfig()) {
            <div class="space-y-4">
              @if (selectedConfig()!.certificate_s3_key) {
                <div class="p-3 rounded-lg bg-success-light border border-success text-success text-sm">
                  <div class="flex items-center gap-2">
                    <app-icon name="check-circle" [size]="16"></app-icon>
                    <span>Certificado cargado</span>
                  </div>
                  @if (selectedConfig()!.certificate_expiry) {
                    @if (isCertExpired()) {
                      <div class="mt-1 text-xs text-error font-medium">
                        Vencido el {{ selectedConfig()!.certificate_expiry | date:'dd/MM/yyyy':'UTC' }}
                      </div>
                    } @else {
                      <div class="mt-1 text-xs">
                        Expira: {{ selectedConfig()!.certificate_expiry | date:'dd/MM/yyyy':'UTC' }}
                      </div>
                    }
                  }
                </div>
              }
              <div class="space-y-3">
                <label class="block text-sm font-medium text-text-primary">Archivo del certificado (.p12)</label>
                <div
                  class="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
                  (click)="fileInput.click()"
                  (dragover)="onDragOver($event)"
                  (drop)="onDrop($event)"
                >
                  <app-icon name="upload-cloud" [size]="32" class="text-text-secondary mx-auto mb-2"></app-icon>
                  <p class="text-sm text-text-secondary">
                    {{ selectedFile() ? selectedFile()!.name : 'Haga clic o arrastre su archivo .p12 aqui' }}
                  </p>
                  @if (!selectedFile()) {
                    <p class="text-xs text-text-secondary mt-1">Solo archivos .p12</p>
                  }
                </div>
                <input
                  #fileInput
                  type="file"
                  accept=".p12,.pfx"
                  (change)="onFileSelected($event)"
                  class="hidden"
                />
              </div>
              <form [formGroup]="certificateForm" class="space-y-4">
                <app-input
                  label="Contrasena del certificado"
                  type="password"
                  formControlName="certificate_password"
                  [control]="certificatePasswordControl"
                  placeholder="Contrasena del archivo .p12"
                  [required]="!!selectedFile()"
                  [helperText]="selectedFile() ? 'Necesaria para abrir el archivo que acabas de seleccionar.' : 'Solo se pide cuando subes un archivo nuevo.'"
                ></app-input>
              </form>
              <div class="flex items-center justify-between gap-3 pt-4 border-t border-border">
                <app-button variant="outline" size="sm" (clicked)="activeStep.set(0)">
                  <app-icon slot="icon" name="arrow-left" [size]="14"></app-icon>
                  Anterior
                </app-button>
                <div class="flex items-center gap-2">
                  <!-- A stored certificate is enough to keep going: forcing a
                       re-upload turned this step into a dead end. -->
                  @if (hasCertificate() && !selectedFile()) {
                    <app-button variant="outline" (clicked)="activeStep.set(2)">
                      Continuar
                      <app-icon slot="icon" name="arrow-right" [size]="14"></app-icon>
                    </app-button>
                  }
                  <app-button
                    variant="primary"
                    (clicked)="uploadCertificate()"
                    [disabled]="!selectedFile() || certificateForm.invalid || uploadingCertificate()"
                    [loading]="uploadingCertificate()"
                  >
                    {{ hasCertificate() ? 'Reemplazar Certificado' : 'Subir Certificado' }}
                  </app-button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- ═══ Step 3: Environment ═══ -->
      @if (activeStep() === 2) {
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-[var(--color-surface)]">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="globe" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Ambiente</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Seleccione el ambiente de facturacion electronica.
          </p>
          @if (!selectedConfig()) {
            <div class="p-3 rounded-lg bg-warning-light border border-warning text-warning text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Primero debe guardar las credenciales en el Paso 1.
              </div>
            </div>
          }
          @if (selectedConfig()) {
            <div class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  (click)="setEnvironment('test')"
                  class="p-4 rounded-lg border-2 text-left transition-all"
                  [ngClass]="{
                    'border-primary bg-[var(--color-primary-light)]': selectedEnvironment() === 'test',
                    'border-border hover:border-primary': selectedEnvironment() !== 'test'
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      [ngClass]="{
                        'border-primary': selectedEnvironment() === 'test',
                        'border-border': selectedEnvironment() !== 'test'
                      }"
                    >
                      @if (selectedEnvironment() === 'test') {
                        <div class="w-2 h-2 rounded-full bg-primary"></div>
                      }
                    </div>
                    <span class="text-sm font-medium text-text-primary">Pruebas (Habilitacion)</span>
                  </div>
                  <p class="text-xs text-text-secondary pl-6">
                    Envia facturas al ambiente de pruebas de la DIAN. Use este modo durante la habilitacion.
                  </p>
                </button>
                <button
                  (click)="setEnvironment('production')"
                  [disabled]="!testSetPassed()"
                  class="p-4 rounded-lg border-2 text-left transition-all"
                  [ngClass]="{
                    'border-primary bg-[var(--color-primary-light)]': selectedEnvironment() === 'production',
                    'border-border hover:border-primary': selectedEnvironment() !== 'production' && testSetPassed(),
                    'border-border opacity-60 cursor-not-allowed': !testSetPassed()
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      [ngClass]="{
                        'border-primary': selectedEnvironment() === 'production',
                        'border-border': selectedEnvironment() !== 'production'
                      }"
                    >
                      @if (selectedEnvironment() === 'production') {
                        <div class="w-2 h-2 rounded-full bg-primary"></div>
                      }
                    </div>
                    <span class="text-sm font-medium text-text-primary">Producción</span>
                  </div>
                  <p class="text-xs text-text-secondary pl-6">
                    Envia facturas reales a la DIAN. Solo active despues de completar la habilitacion.
                  </p>
                  @if (!testSetPassed()) {
                    <p class="text-xs text-warning pl-6 mt-2 flex items-start gap-1">
                      <app-icon name="lock" [size]="12" class="mt-0.5"></app-icon>
                      Disponible cuando la DIAN apruebe tu set de pruebas.
                    </p>
                  }
                </button>
              </div>
              <div class="p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-border text-sm">
                <div class="flex items-center justify-between">
                  <span class="text-text-secondary">Estado de habilitacion:</span>
                  <span class="px-2 py-0.5 rounded-full text-xs font-medium"
                    [ngClass]="getEnablementStatusClass(selectedConfig()!.enablement_status)"
                  >
                    {{ getEnablementStatusLabel(selectedConfig()!.enablement_status) }}
                  </span>
                </div>
                <div class="flex items-center justify-between mt-2">
                  <span class="text-text-secondary">Ambiente actual:</span>
                  <span class="text-text-primary font-medium">{{ selectedConfig()!.environment === 'test' ? 'Pruebas' : 'Producción' }}</span>
                </div>
              </div>
              <!-- ── Paso a producción ── -->
              @if (testSetPassed()) {
                <div class="p-4 rounded-lg border border-border space-y-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <app-icon name="shield-check" [size]="16" class="text-primary"></app-icon>
                      <span class="text-sm font-medium text-text-primary">
                        Paso a producción
                      </span>
                    </div>
                    <app-button
                      variant="ghost"
                      size="sm"
                      (clicked)="loadReadiness()"
                      [loading]="loadingReadiness()"
                    >
                      <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                      Verificar requisitos
                    </app-button>
                  </div>

                  @if (alreadyInProduction()) {
                    <div class="p-3 rounded-lg bg-success-light border border-success text-success text-sm flex items-start gap-2">
                      <app-icon name="check-circle" [size]="16" class="mt-0.5"></app-icon>
                      <span>
                        Esta configuración ya está emitiendo facturas electrónicas
                        reales ante la DIAN.
                      </span>
                    </div>
                  }

                  @if (readiness()) {
                    <!--
                      Tres grupos, no una lista plana: lo que el comercio puede
                      hacer hoy, lo que solo la DIAN puede resolver, y las alertas
                      que todavía no bloquean. Mezclarlos hace que un veredicto
                      pendiente de la DIAN se lea como una tarea del comercio.
                    -->
                    @if (actionableBlockers().length) {
                      <div class="space-y-1.5">
                        <p class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                          Te falta hacer ({{ actionableBlockers().length }})
                        </p>
                        @for (check of actionableBlockers(); track check.key) {
                          <div class="flex items-start gap-2 text-xs">
                            <app-icon name="alert-circle" [size]="14" class="text-warning mt-0.5"></app-icon>
                            <div>
                              <span class="text-text-primary font-medium">{{ check.label }}</span>
                              <div class="text-text-secondary mt-0.5">
                                {{ check.action }}
                                @if (check.owner === 'platform') {
                                  <span class="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--color-surface-secondary)] text-text-secondary">
                                    lo resuelve Vendix
                                  </span>
                                }
                              </div>
                            </div>
                          </div>
                        }
                      </div>
                    }

                    @if (dianPendingChecks().length) {
                      <div class="space-y-1.5">
                        <p class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                          Esperando a la DIAN ({{ dianPendingChecks().length }})
                        </p>
                        @for (check of dianPendingChecks(); track check.key) {
                          <div class="flex items-start gap-2 text-xs">
                            <app-icon name="clock" [size]="14" class="text-info mt-0.5"></app-icon>
                            <div>
                              <span class="text-text-primary font-medium">{{ check.label }}</span>
                              <div class="text-text-secondary mt-0.5">{{ check.action }}</div>
                            </div>
                          </div>
                        }
                      </div>
                    }

                    @if (readinessWarnings().length) {
                      <div class="space-y-1.5">
                        <p class="text-[11px] font-semibold uppercase tracking-wide text-warning">
                          Avisos ({{ readinessWarnings().length }})
                        </p>
                        @for (check of readinessWarnings(); track check.key) {
                          <div class="flex items-start gap-2 text-xs">
                            <app-icon name="alert-triangle" [size]="14" class="text-warning mt-0.5"></app-icon>
                            <div>
                              <span class="text-text-primary font-medium">{{ check.label }}</span>
                              <div class="text-text-secondary mt-0.5">{{ check.action }}</div>
                            </div>
                          </div>
                        }
                      </div>
                    }

                    @if (satisfiedChecks().length) {
                      <div class="space-y-1.5">
                        <p class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                          Listo ({{ satisfiedChecks().length }})
                        </p>
                        @for (check of satisfiedChecks(); track check.key) {
                          <div class="flex items-start gap-2 text-xs">
                            <app-icon name="check-circle" [size]="14" class="text-success mt-0.5"></app-icon>
                            <span class="text-text-secondary">{{ check.label }}</span>
                          </div>
                        }
                      </div>
                    }
                  } @else if (!loadingReadiness()) {
                    <p class="text-xs text-text-secondary">
                      Verifica los requisitos para saber si ya puedes emitir facturas reales.
                    </p>
                  }

                  @if (!alreadyInProduction()) {
                    <div class="flex justify-end pt-2">
                      <app-button
                        variant="primary"
                        size="sm"
                        (clicked)="promoteToProduction()"
                        [disabled]="promoting() || readiness()?.ready !== true"
                        [loading]="promoting()"
                      >
                        <app-icon slot="icon" name="shield-check" [size]="14"></app-icon>
                        Activar producción
                      </app-button>
                    </div>
                  }
                </div>
              }

              <div class="flex items-center justify-between gap-3 pt-4 border-t border-border">
                <app-button variant="outline" size="sm" (clicked)="activeStep.set(1)">
                  <app-icon slot="icon" name="arrow-left" [size]="14"></app-icon>
                  Anterior
                </app-button>
                <app-button
                  variant="primary"
                  (clicked)="saveEnvironment()"
                  [disabled]="savingEnvironment()"
                  [loading]="savingEnvironment()"
                >
                  {{ selectedEnvironment() === selectedConfig()!.environment ? 'Continuar' : 'Guardar Ambiente' }}
                </app-button>
              </div>
            </div>
          }
        </div>
      }

      <!-- ═══ Step 4: Test Connection ═══ -->
      @if (activeStep() === 3) {
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-[var(--color-surface)]">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="zap" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Probar Conexion</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Verifique la conexion con la DIAN y ejecute el set de pruebas de habilitacion.
          </p>
          @if (!selectedConfig()) {
            <div class="p-3 rounded-lg bg-warning-light border border-warning text-warning text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Primero debe completar los pasos anteriores.
              </div>
            </div>
          }
          @if (selectedConfig()) {
            <div class="space-y-4">
              <div class="space-y-3 mb-4">
                <label class="text-sm font-medium text-text-primary">Resolucion para el set de pruebas</label>
                <select
                  class="w-full px-3 py-2 border border-border rounded-lg text-sm bg-[var(--color-surface)] focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  [ngModel]="selectedResolutionId()"
                  (ngModelChange)="selectedResolutionId.set($event)"
                >
                  <option [ngValue]="null" disabled>Seleccione una resolucion</option>
                  @for (res of resolutions(); track res.id) {
                    <option [ngValue]="res.id">
                      {{ res.prefix }} — Resolucion {{ res.resolution_number }} ({{ res.range_from }} - {{ res.range_to }})
                    </option>
                  }
                </select>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <app-button
                  variant="outline"
                  (clicked)="testConnection()"
                  [disabled]="testingConnection()"
                  [loading]="testingConnection()"
                >
                  <app-icon slot="icon" name="wifi" [size]="14"></app-icon>
                  Probar Conexion
                </app-button>
                <app-button
                  variant="primary"
                  (clicked)="runTestSet()"
                  [disabled]="runningTestSet() || !selectedResolutionId() || testSetState() === 'pending' || testSetState() === 'passed'"
                  [loading]="runningTestSet()"
                >
                  <app-icon slot="icon" name="play" [size]="14"></app-icon>
                  {{ testSetState() === 'rejected' ? 'Reintentar Set de Pruebas' : 'Ejecutar Set de Pruebas' }}
                </app-button>
                <!-- Re-poll: resolves the verdict of the batch already sent. It
                     never re-transmits, so it is always safe to press. -->
                @if (testSetResult()?.zip_key || testSetState() === 'pending') {
                  <app-button
                    variant="outline"
                    (clicked)="checkTestSetStatus(false)"
                    [disabled]="checkingStatus()"
                    [loading]="checkingStatus()"
                  >
                    <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                    Consultar estado
                  </app-button>
                }
              </div>
              @if (testResult()) {
                <div class="p-4 rounded-lg border"
                  [ngClass]="{
                    'bg-success-light border-success': testResult()!.success,
                    'bg-error-light border-error': !testResult()!.success
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <app-icon
                      [name]="testResult()!.success ? 'check-circle' : 'x-circle'"
                      [size]="18"
                      [class]="testResult()!.success ? 'text-success' : 'text-error'"
                    ></app-icon>
                    <span class="text-sm font-medium" [class]="testResult()!.success ? 'text-success' : 'text-error'">
                      {{ testResult()!.success ? 'Conexion exitosa' : 'Error de conexion' }}
                    </span>
                  </div>
                  <div class="text-xs space-y-1 pl-6" [class]="testResult()!.success ? 'text-success' : 'text-error'">
                    <div>{{ testResult()!.message }}</div>
                    <div>Ambiente: {{ testResult()!.environment === 'test' ? 'Pruebas' : 'Producción' }}</div>
                    <div>Tiempo de respuesta: {{ testResult()!.response_time_ms }}ms</div>
                    @if (testResult()!.dian_status) {
                      <div>Estado DIAN: {{ testResult()!.dian_status }}</div>
                    }
                  </div>
                </div>
              }
              <!-- ══ Lote descartado ══
                   Sin esto, tras recargar no quedaba rastro del descarte y la
                   pantalla volvía a verse como si nunca se hubiera enviado nada.
                   El texto viene del backend (wait.reason) a propósito: la UI ya
                   inventó una explicación una vez —«se envió antes de que se
                   guardaran las claves de documento»— sobre un lote que sí tenía
                   sus 50 CUFE guardados.
                   OJO: sin comillas invertidas acá. La plantilla ES un template
                   literal de TypeScript, así que un backtick en un comentario
                   cierra el string y el resto se compila como código. -->
              @if (testSetWait()?.state === 'abandoned') {
                <div class="p-3 rounded-lg border border-border bg-[var(--color-surface)] flex items-start gap-2">
                  <app-icon name="trash-2" [size]="14" class="mt-0.5 shrink-0 text-text-secondary"></app-icon>
                  <p class="text-xs text-text-secondary">
                    {{ testSetWait()?.reason }}
                  </p>
                </div>
              }

              <!-- ══ Waiting state: DIAN acknowledged the batch, no verdict yet ══
                   El contenedor cambia de "informativo" a "advertencia" cuando el
                   backend declara el lote estancado: un spinner azul eterno es
                   exactamente lo que hace creer que el proceso está colgado. -->
              @if (testSetState() === 'running' || testSetState() === 'pending') {
                <div
                  class="p-4 rounded-lg border space-y-4"
                  [ngClass]="
                    testSetStalled()
                      ? 'border-warning bg-warning-light'
                      : 'border-[var(--color-info)] bg-[var(--color-info-light)]'
                  "
                >
                  <div class="flex items-start gap-3">
                    <div class="mt-0.5 shrink-0">
                      @if (testSetStalled()) {
                        <app-icon name="alert-triangle" [size]="20" class="text-warning"></app-icon>
                      } @else {
                        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--color-info)]"></div>
                      }
                    </div>
                    <div class="min-w-0">
                      <p
                        class="text-sm font-medium"
                        [class]="testSetStalled() ? 'text-warning' : 'text-[var(--color-info)]'"
                      >
                        {{ testSetState() === 'running'
                          ? 'Generando, firmando y enviando el set de habilitación…'
                          : testSetStalled()
                            ? 'La DIAN no está emitiendo veredicto para este lote'
                            : 'La DIAN está validando tu set de pruebas' }}
                      </p>
                      <p class="text-xs text-text-secondary mt-1">
                        {{ testSetState() === 'running'
                          ? 'No cierres esta ventana: el envío puede tardar hasta un minuto.'
                          : testSetStalled()
                            ? (testSetWait()?.reason ?? 'Seguir consultando no lo va a resolver: hay que diagnosticar o reenviar.')
                            : 'El envío ya se completó. Ahora esperamos el veredicto, que la DIAN entrega de forma asíncrona.' }}
                      </p>
                      @if (testSetState() === 'pending' && !testSetStalled() && waitingSinceLabel()) {
                        <!--
                          The status line must derive from the polling signals, never
                          assert activity on its own: a batch left three days in this
                          state showed "consultando cada 15 segundos" long after the
                          automatic window had closed.
                        -->
                        <p class="text-xs text-text-secondary mt-1">
                          Enviado {{ waitingSinceLabel() }}@if (polling()) {, consultando cada 15 segundos}@else {. El sondeo automático está detenido}.
                        </p>
                      }
                    </div>
                  </div>

                  <!-- Fiscal tips: turn dead wait time into something useful.
                       Se ocultan cuando el lote está estancado: ahí el usuario no
                       necesita entretenimiento, necesita decidir. -->
                  @if (!testSetStalled()) {
                    <div class="p-3 rounded-lg bg-[var(--color-surface)] border border-border">
                      <div class="flex items-start gap-2">
                        <app-icon name="lightbulb" [size]="16" class="text-primary mt-0.5 shrink-0"></app-icon>
                        <div class="min-w-0">
                          <p class="text-xs font-semibold text-text-primary">{{ currentTip().title }}</p>
                          <p class="text-xs text-text-secondary mt-0.5">{{ currentTip().body }}</p>
                        </div>
                      </div>
                    </div>
                  }

                  @if (testSetResult()?.zip_key) {
                    <div class="text-xs text-text-secondary">
                      ZipKey: <span class="font-mono break-all">{{ testSetResult()!.zip_key }}</span>
                    </div>
                  }

                  <!-- Long wait: stop the timer and tell them it is fine to leave.
                       No aplica a un lote estancado: ahí "seguir consultando" es
                       precisamente lo que ya se demostró inútil. -->
                  @if (pollExhausted() && !testSetStalled()) {
                    <div class="p-3 rounded-lg bg-warning-light border border-warning text-xs text-warning space-y-2">
                      <div class="flex items-start gap-2">
                        <app-icon name="clock" [size]="14" class="mt-0.5 shrink-0"></app-icon>
                        <span>
                          La DIAN se está tomando más de lo habitual. Puedes cerrar
                          esta ventana y volver más tarde: guardamos el ZipKey, así
                          que el resultado no se pierde.
                        </span>
                      </div>
                      <div class="flex justify-end">
                        <app-button
                          variant="outline"
                          size="sm"
                          (clicked)="resumePolling()"
                          [loading]="checkingStatus()"
                        >
                          <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                          Seguir consultando
                        </app-button>
                      </div>
                    </div>
                  }

                  <!--
                    Escape hatch for a batch DIAN never judges. Re-polling the
                    ZipKey can only ever repeat "en proceso"; asking per document
                    tells us whether it reached DIAN's records at all, and if it
                    did not, the batch can be discarded and re-sent.
                  -->
                  @if (testSetState() === 'pending' && testSetResult()?.zip_key) {
                    @if (!canDiagnoseDocuments()) {
                      <p class="text-xs text-text-secondary">
                        Este lote se envió antes de que se guardaran las claves de
                        documento, así que no se puede consultar por CUFE. La única
                        salida es descartarlo y reenviar el set.
                      </p>
                    }
                    <div class="flex flex-wrap gap-2 justify-end">
                      @if (canDiagnoseDocuments()) {
                        <app-button
                          variant="outline"
                          size="sm"
                          (clicked)="diagnoseDocuments()"
                          [loading]="diagnosing()"
                        >
                          <app-icon slot="icon" name="stethoscope" [size]="14"></app-icon>
                          Diagnosticar documentos
                        </app-button>
                      }
                      <app-button
                        [variant]="testSetStalled() ? 'primary' : 'outline'"
                        size="sm"
                        (clicked)="abandonBatch()"
                        [loading]="abandoning()"
                      >
                        <app-icon slot="icon" name="trash-2" [size]="14"></app-icon>
                        Descartar lote y reenviar
                      </app-button>
                    </div>
                  }

                  @if (diagnosis(); as diag) {
                    <div
                      class="p-3 rounded-lg border text-xs space-y-2"
                      [ngClass]="{
                        'bg-error-light border-error': diag.verdict === 'not_registered',
                        'bg-warning-light border-warning': diag.verdict === 'partially_registered',
                        'bg-success-light border-success': diag.verdict === 'registered'
                      }"
                    >
                      <p class="font-semibold">
                        @switch (diag.verdict) {
                          @case ('not_registered') {
                            La DIAN no tiene registrado ninguno de los documentos consultados.
                            El lote nunca se clasificó: descártalo y vuelve a enviarlo.
                          }
                          @case ('partially_registered') {
                            La DIAN registró {{ diag.registered_count }} de {{ diag.sampled }} documentos consultados.
                          }
                          @default {
                            Los documentos sí llegaron a la DIAN; el lote está en su cola de validación.
                          }
                        }
                      </p>
                      <div class="space-y-1">
                        @for (doc of diag.documents; track doc.cufe) {
                          <div class="flex items-start gap-2">
                            <app-icon
                              [name]="doc.registered ? 'check-circle' : 'x-circle'"
                              [size]="12"
                              class="mt-0.5 shrink-0"
                            ></app-icon>
                            <span class="min-w-0">
                              <span class="font-mono">{{ doc.number }}</span>
                              — {{ doc.status_message || doc.status_code }}
                            </span>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- ══ Terminal states: approved / rejected ══ -->
              @if (testSetState() === 'passed' || testSetState() === 'rejected') {
                <div class="p-4 rounded-lg border"
                  [ngClass]="{
                    'bg-success-light border-success': testSetState() === 'passed',
                    'bg-error-light border-error': testSetState() === 'rejected'
                  }"
                >
                  <div class="flex items-center gap-2 mb-3">
                    <app-icon
                      [name]="testSetState() === 'passed' ? 'check-circle' : 'x-circle'"
                      [size]="18"
                      [class]="testSetState() === 'passed' ? 'text-success' : 'text-error'"
                    ></app-icon>
                    <span class="text-sm font-medium" [class]="testSetState() === 'passed' ? 'text-success' : 'text-error'">
                      {{ testSetResult()!.message }}
                    </span>
                  </div>

                  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div class="p-2 bg-[var(--color-surface)] rounded border border-border text-center">
                      <div class="text-text-secondary">Total</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.total_documents }}</div>
                    </div>
                    <div class="p-2 bg-[var(--color-surface)] rounded border border-border text-center">
                      <div class="text-text-secondary">Facturas</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.invoices_count }}</div>
                    </div>
                    <div class="p-2 bg-[var(--color-surface)] rounded border border-border text-center">
                      <div class="text-text-secondary">Notas Debito</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.debit_notes_count }}</div>
                    </div>
                    <div class="p-2 bg-[var(--color-surface)] rounded border border-border text-center">
                      <div class="text-text-secondary">Notas Credito</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.credit_notes_count }}</div>
                    </div>
                  </div>

                  <div class="mt-3 space-y-1 text-xs text-text-secondary">
                    @if (testSetResult()!.number_from && testSetResult()!.number_to) {
                      <div>
                        Numeración usada: {{ testSetResult()!.number_from }} — {{ testSetResult()!.number_to }}
                      </div>
                    }
                    @if (testSetResult()!.executed_at) {
                      <div>Enviado: {{ testSetResult()!.executed_at | date:'dd/MM/yy HH:mm' }}</div>
                    }
                    @if (testSetResult()!.rechecked_at) {
                      <div>Última consulta: {{ testSetResult()!.rechecked_at | date:'dd/MM/yy HH:mm' }}</div>
                    }
                    @if (testSetResult()!.zip_key) {
                      <div>ZipKey: <span class="font-mono break-all">{{ testSetResult()!.zip_key }}</span></div>
                    }
                    @if (testSetResult()!.dian_status) {
                      <div>Estado DIAN: <span class="font-mono">{{ testSetResult()!.dian_status }}</span></div>
                    }
                  </div>

                  <!-- Per-document DIAN errors: the only actionable output of a rejection. -->
                  @if (testSetResult()!.error_messages?.length) {
                    <div class="mt-3 p-3 rounded bg-[var(--color-surface)] border border-error/40 max-h-48 overflow-y-auto">
                      <p class="text-xs font-semibold text-error mb-1">
                        Errores reportados por la DIAN
                      </p>
                      <ul class="list-disc pl-4 space-y-0.5 text-xs text-text-secondary">
                        @for (msg of testSetResult()!.error_messages; track msg) {
                          <li>{{ msg }}</li>
                        }
                      </ul>
                    </div>
                  }

                  @if (testSetState() === 'passed') {
                    <div class="mt-3 p-3 rounded bg-[var(--color-surface)] border border-success/40 text-xs text-text-secondary">
                      <p class="font-semibold text-success mb-1">Siguiente paso</p>
                      La DIAN habilitó tu NIT como facturador electrónico. Solicita la
                      Autorización de Numeración de Facturación en Muisca, regístrala
                      como resolución y luego activa producción en el paso de Ambiente.
                      <div class="mt-2">
                        <app-button variant="outline" size="sm" (clicked)="goToProduction()">
                          <app-icon slot="icon" name="shield-check" [size]="14"></app-icon>
                          Ir al paso de producción
                        </app-button>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Respuesta técnica: fuera de los bloques por estado a propósito.
                   Cuando la DIAN no emite veredicto, el estado es justamente el
                   que menos información da, y es cuando más se necesita el
                   StatusDescription crudo y los nombres de archivo enviados. -->
              @if (technicalResult()) {
                <app-dian-technical-response [result]="technicalResult()"></app-dian-technical-response>
              }

              <div class="flex items-center justify-between pt-4 border-t border-border">
                <app-button variant="outline" size="sm" (clicked)="activeStep.set(2)">
                  <app-icon slot="icon" name="arrow-left" [size]="14"></app-icon>
                  Anterior
                </app-button>
                <app-button variant="primary" size="sm" (clicked)="activeStep.set(4)">
                  Registros
                  <app-icon slot="icon" name="arrow-right" [size]="14"></app-icon>
                </app-button>
              </div>
            </div>
          }
        </div>
      }

      <!-- ═══ Step 5: Audit Logs ═══ -->
      @if (activeStep() === 4) {
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-[var(--color-surface)]">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="file-text" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Registro de Operaciones</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Historial de operaciones realizadas con esta configuracion DIAN.
          </p>
          <div class="flex items-center justify-end mb-3">
            <app-button
              variant="outline"
              size="sm"
              (clicked)="loadAuditLogs()"
              [loading]="loadingAuditLogs()"
            >
              <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
              Actualizar
            </app-button>
          </div>
          @if (loadingAuditLogs()) {
            <div class="py-6 text-center">
              <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          }
          @if (!loadingAuditLogs()) {
            <div class="overflow-x-auto">
              @if (auditLogs().length > 0) {
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-border">
                      <th class="text-left py-2 px-3 text-text-secondary font-medium">Accion</th>
                      <th class="text-left py-2 px-3 text-text-secondary font-medium hidden md:table-cell">Documento</th>
                      <th class="text-center py-2 px-3 text-text-secondary font-medium">Estado</th>
                      <th class="text-right py-2 px-3 text-text-secondary font-medium hidden md:table-cell">Duracion</th>
                      <th class="text-right py-2 px-3 text-text-secondary font-medium">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (log of auditLogs(); track log.id) {
                      <tr class="border-b border-border/50 hover:bg-[var(--color-surface-secondary)]">
                        <td class="py-2 px-3">
                          <div class="text-text-primary">{{ log.action }}</div>
                          @if (log.error_message) {
                            <div class="text-xs text-error mt-0.5 max-w-[200px] truncate">
                              {{ log.error_message }}
                            </div>
                          }
                        </td>
                        <td class="py-2 px-3 hidden md:table-cell">
                          @if (log.document_number) {
                            <span class="text-text-primary">{{ log.document_type }} {{ log.document_number }}</span>
                          } @else {
                            <span class="text-text-secondary">-</span>
                          }
                        </td>
                        <td class="py-2 px-3 text-center">
                          <span class="px-1.5 py-0.5 text-xs rounded-full"
                            [ngClass]="{
                              'bg-success-light text-success': log.status === 'success',
                              'bg-error-light text-error': log.status === 'error',
                              'bg-warning-light text-warning': log.status === 'pending',
                              'bg-[var(--color-surface-secondary)] text-text-secondary': log.status !== 'success' && log.status !== 'error' && log.status !== 'pending'
                            }"
                          >
                            {{ log.status }}
                          </span>
                        </td>
                        <td class="py-2 px-3 text-right hidden md:table-cell text-text-secondary">
                          {{ log.duration_ms ? log.duration_ms + 'ms' : '-' }}
                        </td>
                        <td class="py-2 px-3 text-right text-text-secondary text-xs">
                          {{ log.created_at | date:'dd/MM/yy HH:mm' }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              } @else {
                <div class="py-8 text-center">
                  <app-icon name="file-text" [size]="32" class="text-text-secondary mx-auto mb-2"></app-icon>
                  <p class="text-text-secondary text-sm">No hay registros de operaciones</p>
                </div>
              }
            </div>
          }
          @if (auditLogs().length > 0) {
            <div class="flex items-center justify-between pt-3 border-t border-border">
              <span class="text-xs text-text-secondary">Pagina {{ auditLogPage() }}</span>
              <div class="flex gap-2">
                <app-button variant="outline" size="sm" (clicked)="prevAuditPage()" [disabled]="auditLogPage() <= 1">
                  Anterior
                </app-button>
                <app-button variant="outline" size="sm" (clicked)="nextAuditPage()">
                  Siguiente
                </app-button>
              </div>
            </div>
          }
          <div class="flex items-center justify-end pt-4 border-t border-border">
            <app-button variant="primary" size="sm" (clicked)="finish()">
              <app-icon slot="icon" name="check" [size]="14"></app-icon>
              Finalizar
            </app-button>
          </div>
        </div>
      }
    </div>
  `,
})
export class DianConfigWizardComponent {
  private readonly invoicingService = inject(DianConfigApiService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / Outputs ──────────────────────────────────────
  readonly initialConfig = input<DianConfig | null>(null);
  readonly initialStep = input<number>(0);

  readonly saved = output<DianConfig>();
  readonly cancelled = output<void>();

  // ── State (signals) ───────────────────────────────────────
  readonly selectedConfig = signal<DianConfig | null>(null);
  readonly activeStep = signal(0);

  // Step 1
  readonly savingCredentials = signal(false);

  // Step 2
  readonly selectedFile = signal<File | null>(null);
  readonly uploadingCertificate = signal(false);

  // Step 3
  readonly selectedEnvironment = signal<'test' | 'production'>('test');
  readonly savingEnvironment = signal(false);

  // Step 4
  readonly testingConnection = signal(false);
  readonly runningTestSet = signal(false);
  readonly testResult = signal<DianTestResult | null>(null);
  readonly resolutions = signal<InvoiceResolution[]>([]);
  readonly selectedResolutionId = signal<number | null>(null);
  readonly testSetResult = signal<DianTestResult | null>(null);
  /**
   * `last_test_result` sin mapear. `mapPersistedResult` produce el veredicto
   * LEGIBLE y deja fuera lo que solo sirve para diagnosticar: nombres de archivo,
   * modo de operación y el sobre SOAP crudo. Guardar el original evita ensanchar
   * `DianTestResult` con campos que ninguna pantalla lee.
   */
  private readonly persistedTestResult = signal<PersistedTestResult | null>(null);
  readonly loadingTestSet = signal(false);
  readonly checkingStatus = signal(false);
  readonly polling = signal(false);
  readonly pollAttempts = signal(0);
  readonly pollExhausted = signal(false);
  readonly diagnosing = signal(false);
  readonly abandoning = signal(false);
  /** Per-document answer from DIAN; null until the merchant asks for it. */
  readonly diagnosis = signal<TestSetDiagnosis | null>(null);
  readonly tipIndex = signal(0);

  // Step 3 (production transition)
  readonly readiness = signal<DianProductionReadiness | null>(null);
  readonly loadingReadiness = signal(false);
  readonly promoting = signal(false);

  // Step 5
  readonly auditLogs = signal<DianAuditLog[]>([]);
  readonly loadingAuditLogs = signal(false);
  readonly auditLogPage = signal(1);

  // ── Typed Forms ───────────────────────────────────────────
  readonly credentialsForm: FormGroup<CredentialsForm> = this.fb.nonNullable.group({
    // VALIDADORES DE FORMATO, NO SOLO `required`.
    //
    // Este formulario tenía siete `required` pelados y ningún validador de forma,
    // mientras el riel de plataforma —un operador interno, una configuración—
    // tenía seis. La validación estaba invertida respecto al riesgo: acá un
    // `software_id` mal copiado no lo rechaza nadie, y si llega a la DIAN el
    // documento nunca clasifica, indistinguible de una cola atascada, con el
    // consecutivo del set ya gastado.
    //
    // Son el espejo del DTO del backend (`@IsUUID`, forma del NIT). Viven en
    // `shared/utils/dian-validators` para que las cuatro puertas de entrada
    // rechacen lo mismo.
    name: ['', [Validators.required]],
    nit_type: ['NIT'],
    nit: ['', [Validators.required, nitFormatValidator]],
    nit_dv: [''],
    software_id: ['', [Validators.required, dianUuidValidator]],
    software_pin: ['', [Validators.required, dianSoftwarePinValidator]],
    test_set_id: ['', [dianUuidValidator]],
  }, {
    // `nitDvValidator` es de GRUPO, no de control: compara `nit` con `nit_dv`, y
    // un validador de control no puede ver a su hermano. Ya existía en
    // `shared/utils/nit.util.ts` y ninguna de las tres superficies lo usaba.
    //
    // Importa porque el DV no es decorativo: entra en el CUFE, así que un dígito
    // equivocado hace que la DIAN recompute un hash distinto y rechace cada
    // documento emitido, con su consecutivo ya gastado.
    validators: [nitDvValidator],
  });

  readonly certificateForm: FormGroup<CertificateForm> = this.fb.nonNullable.group({
    certificate_password: ['', [Validators.required]],
  });

  /**
   * Texto del desajuste NIT↔DV.
   *
   * Constante y no `computed`: el mensaje no depende del estado, solo su
   * visibilidad, y esa la decide el `@if` del template leyendo el formulario —el
   * mismo patrón que ya usa `[disabled]="credentialsForm.invalid"`, que funciona
   * porque la validez cambia por eventos del DOM y esos disparan detección.
   *
   * Se toma del mapa compartido para que este formulario no redacte su propia
   * versión del mismo rechazo.
   */
  readonly nitDvMessage = DIAN_VALIDATION_MESSAGES['nitDv'];

  // ── Typed getters (per vendix-angular-forms skill) ───────
  get nameControl(): FormControl<string> { return this.credentialsForm.controls.name; }
  get nitControl(): FormControl<string> { return this.credentialsForm.controls.nit; }
  get nitDvControl(): FormControl<string> { return this.credentialsForm.controls.nit_dv; }
  get softwareIdControl(): FormControl<string> { return this.credentialsForm.controls.software_id; }
  get softwarePinControl(): FormControl<string> { return this.credentialsForm.controls.software_pin; }
  get testSetIdControl(): FormControl<string> { return this.credentialsForm.controls.test_set_id; }
  get certificatePasswordControl(): FormControl<string> { return this.certificateForm.controls.certificate_password; }

  // ── Static configuration ──────────────────────────────────
  readonly stepsConfig: StepsLineItem[] = [
    { label: 'Credenciales' },
    { label: 'Certificado' },
    { label: 'Ambiente' },
    { label: 'Prueba' },
    { label: 'Registros' },
  ];

  readonly nitTypeOptions: SelectorOption[] = [
    { value: 'NIT', label: 'NIT' },
    { value: 'CC', label: 'Cedula de Ciudadania (CC)' },
    { value: 'CE', label: 'Cedula de Extranjeria (CE)' },
    { value: 'TI', label: 'Tarjeta de Identidad (TI)' },
    { value: 'PP', label: 'Pasaporte (PP)' },
    { value: 'NIT_EXTRANJERIA', label: 'NIT Extranjeria' },
  ];

  // ── Derived state ─────────────────────────────────────────
  /** True when a certificate is already stored, so re-upload is optional. */
  readonly hasCertificate = computed(
    () => !!this.selectedConfig()?.certificate_s3_key,
  );

  /**
   * Tri-state verdict of the test set. `pending` is the state the old UI could
   * not express: DIAN has the batch but has not judged it, which is neither
   * success nor failure and must NOT invite a re-send.
   */
  /**
   * Datos del panel técnico, atados al lote VIGENTE por su ZipKey.
   *
   * El snapshot trae nombres de archivo y sobre SOAP del lote que lo generó. Si el
   * veredicto en pantalla ya es de otro lote, mostrar ese snapshot al lado sería la
   * misma clase de mentira que se arregló esta semana —una pantalla afirmando cosas
   * de un lote que no es el vigente—. Ante desacuerdo, no se muestra nada.
   */
  readonly technicalResult = computed<DianTechnicalResponseData | null>(() => {
    const snapshot = this.persistedTestResult();
    if (!snapshot) return null;
    const live = this.testSetResult()?.zip_key ?? null;
    if (live && snapshot.zip_key && live !== snapshot.zip_key) return null;
    return snapshot as DianTechnicalResponseData;
  });

  readonly testSetState = computed<TestSetState>(() => {
    if (this.runningTestSet()) return 'running';
    const result = this.testSetResult();
    if (!result) return 'idle';

    // El backend es la autoridad sobre el estado del lote, igual que con
    // `stalled`. Antes esto se derivaba solo de los booleanos y el
    // `return 'pending'` de abajo convertía cualquier estado que no fuera
    // success/pending/rejected en «la DIAN está validando tu set de pruebas».
    // Un lote DESCARTADO cae justo ahí: la pantalla afirmaba que la DIAN estaba
    // validando un lote que el usuario acababa de descartar.
    if (this.testSetWait()?.state === 'abandoned') return 'idle';

    if (result.success) return 'passed';
    if (result.pending) return 'pending';
    if (result.rejected) return 'rejected';
    return 'pending';
  });

  readonly currentTip = computed(
    () => DIAN_TIPS[this.tipIndex() % DIAN_TIPS.length],
  );

  /**
   * Backend reading of the wait. The frontend must not re-derive "stalled" from
   * its own clock: the browser timer resets on every navigation, while the
   * backend measures from `executed_at`, which is the only stable origin.
   */
  readonly testSetWait = computed(() => this.testSetResult()?.wait ?? null);

  /** True once waiting has stopped being a strategy for this batch. */
  readonly testSetStalled = computed(
    () => this.testSetWait()?.stalled === true,
  );

  /**
   * Cuántos documentos lleva el lote, según lo que el backend realmente envió.
   * La copia decía "50 documentos" —la composición de 2019— cuando `own_software`
   * envía 4. El dato ya venía en el resultado (`total_documents`) y nadie lo
   * leía: un número escrito a mano en la UI envejece sin que nada lo delate.
   */
  readonly testSetDocumentsLabel = computed(() => {
    const total = this.testSetResult()?.total_documents ?? null;
    if (!total) return 'los documentos de habilitación';
    return `${total} documento${total === 1 ? '' : 's'}`;
  });

  /**
   * Batches submitted before per-document keys were persisted cannot be asked
   * about by CUFE — offering the button would only produce a 412.
   */
  readonly canDiagnoseDocuments = computed(
    () => this.testSetWait()?.diagnosable !== false,
  );

  /**
   * Ticks while the UI is waiting, so the elapsed-time label stays live. A
   * `computed` reading `Date.now()` alone would never re-evaluate: the signal
   * graph has no idea the clock moved.
   */
  private readonly nowTick = signal(0);

  /** Human "hace X" label for how long DIAN has held the batch. */
  readonly waitingSinceLabel = computed(() => {
    this.nowTick();
    const started = this.testSetResult()?.executed_at;
    if (!started) return null;
    const elapsedMs = Date.now() - new Date(started).getTime();
    if (Number.isNaN(elapsedMs) || elapsedMs < 0) return null;
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 1) return 'hace menos de un minuto';
    if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} hora${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `hace ${days} día${days === 1 ? '' : 's'}`;
  });

  /** The DIAN test set is the gate for production; nothing else unlocks it. */
  readonly testSetPassed = computed(() => {
    const status = this.selectedConfig()?.enablement_status;
    return status === 'test_set_passed' || status === 'enabled';
  });

  readonly alreadyInProduction = computed(
    () =>
      this.selectedConfig()?.environment === 'production' &&
      this.selectedConfig()?.enablement_status === 'enabled',
  );

  readonly readinessBlockers = computed(
    () => this.readiness()?.checks.filter((c) => !c.satisfied) ?? [],
  );

  /**
   * Los tres cortes del checklist. Se derivan de `checks` en vez de leer los
   * arrays `actionable` / `waiting_on_dian` / `warnings` del backend para que la
   * pantalla siga funcionando contra un backend que aún no los envía — el
   * criterio es exactamente el mismo (`severity` y `blocked_by`, con los mismos
   * valores por defecto).
   */
  private readonly unsatisfiedChecks = computed(
    () => this.readiness()?.checks.filter((c) => !c.satisfied) ?? [],
  );

  readonly readinessWarnings = computed(() =>
    this.unsatisfiedChecks().filter((c) => c.severity === 'warning'),
  );

  readonly actionableBlockers = computed(() =>
    this.unsatisfiedChecks().filter(
      (c) => c.severity !== 'warning' && (c.blocked_by ?? 'vendix') === 'vendix',
    ),
  );

  readonly dianPendingChecks = computed(() =>
    this.unsatisfiedChecks().filter(
      (c) => c.severity !== 'warning' && c.blocked_by === 'dian',
    ),
  );

  readonly satisfiedChecks = computed(
    () => this.readiness()?.checks.filter((c) => c.satisfied) ?? [],
  );

  /**
   * Temporizadores del asistente, como suscripciones RxJS y no como
   * `setInterval`.
   *
   * POR QUÉ IMPORTA: un `setInterval` sólo muere si alguien se acuerda de
   * llamar a `clearInterval`. Aquí lo hacía `destroyRef.onDestroy`, pero el
   * asistente pasó a montarse también desde la consola de super admin, donde el
   * injector de la ruta se CACHEA y no se destruye al cambiar de tenant: un
   * temporizador superviviente seguiría interrogando a la DIAN por el
   * contribuyente que el operador ya cerró. `takeUntilDestroyed(destroyRef)`
   * ata el flujo al componente y no depende de que nadie recuerde nada.
   */
  private pollSubscription: Subscription | null = null;
  private tipSubscription: Subscription | null = null;

  constructor() {
    // Sync initial inputs → internal signals (react to changes from parent)
    effect(() => {
      const cfg = this.initialConfig();
      this.selectedConfig.set(cfg);
      if (cfg) {
        this.patchCredentialsForm(cfg);
        this.selectedEnvironment.set(cfg.environment);
        // Recover the real test-set state from the server instead of showing a
        // blank panel: a batch submitted in a previous session may still be
        // pending, or may already have been approved.
        this.loadTestResults(cfg.id);
      } else {
        this.resetForms();
      }
    });

    effect(() => {
      const step = this.initialStep();
      if (typeof step === 'number') this.activeStep.set(step);
    });

    // The certificate password only matters when a NEW file is being uploaded;
    // requiring it unconditionally blocked "Continuar" for tenants that already
    // have a certificate stored.
    effect(() => {
      const needsPassword = !!this.selectedFile();
      const control = this.certificatePasswordControl;
      if (needsPassword) control.setValidators([Validators.required]);
      else control.clearValidators();
      control.updateValueAndValidity({ emitEvent: false });
    });

    this.loadResolutions();
    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      this.stopTips();
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  isCertExpired(): boolean {
    const expiry = this.selectedConfig()?.certificate_expiry;
    if (!expiry) return false;
    const t = new Date(expiry).getTime();
    return !isNaN(t) && t < Date.now();
  }

  getEnablementStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      not_started: 'No iniciado',
      testing: 'En pruebas',
      test_set_passed: 'Set de pruebas aprobado',
      enabled: 'Habilitado',
      suspended: 'Suspendido',
      expired: 'Vencido',
    };
    return labels[status] || status;
  }

  getEnablementStatusClass(status: string): string {
    const classes: Record<string, string> = {
      not_started: 'bg-[var(--color-surface-secondary)] text-text-secondary',
      testing: 'bg-warning-light text-warning',
      test_set_passed: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      enabled: 'bg-success-light text-success',
      suspended: 'bg-error-light text-error',
      expired: 'bg-error-light text-error',
    };
    return classes[status] || 'bg-[var(--color-surface-secondary)] text-text-secondary';
  }

  private resetForms(): void {
    this.credentialsForm.reset({
      name: '',
      nit_type: 'NIT',
      nit: '',
      nit_dv: '',
      software_id: '',
      software_pin: '',
      test_set_id: '',
    });
    // Create mode requires a pin; restore validator (cleared on edit).
    this.softwarePinControl.setValidators([Validators.required]);
    this.softwarePinControl.updateValueAndValidity({ emitEvent: false });
    this.certificateForm.reset({ certificate_password: '' });
    this.selectedFile.set(null);
    this.selectedEnvironment.set('test');
    this.testResult.set(null);
    this.testSetResult.set(null);
    this.persistedTestResult.set(null);
    this.selectedResolutionId.set(null);
    this.auditLogs.set([]);
    // A fresh config has no batch in flight; drop any timer from the previous one.
    this.stopPolling();
    this.pollAttempts.set(0);
    this.pollExhausted.set(false);
    this.readiness.set(null);
  }

  private patchCredentialsForm(cfg: DianConfig): void {
    this.credentialsForm.patchValue({
      name: cfg.name,
      nit_type: cfg.nit_type,
      nit: cfg.nit,
      nit_dv: cfg.nit_dv || '',
      software_id: cfg.software_id,
      // Prefill the masked sentinel so the merchant SEES the PIN is stored
      // (a blank field read as "it wasn't saved" and invited a re-type).
      // `saveCredentials()` strips the sentinel, so the real secret is never
      // overwritten unless a new value is typed.
      software_pin: cfg.software_pin_encrypted ? MASKED_SECRET : '',
      test_set_id: cfg.test_set_id || '',
    });
    this.softwarePinControl.clearValidators();
    this.softwarePinControl.updateValueAndValidity({ emitEvent: false });
  }

  // ── Step 1: Save Credentials ──────────────────────────────
  saveCredentials(): void {
    if (this.credentialsForm.invalid) {
      this.credentialsForm.markAllAsTouched();
      return;
    }

    this.savingCredentials.set(true);
    const v = this.credentialsForm.getRawValue();
    const payload: Record<string, unknown> = {
      name: v.name,
      nit: v.nit,
      nit_type: v.nit_type,
      nit_dv: v.nit_dv || null,
      software_id: v.software_id,
      test_set_id: v.test_set_id || null,
    };
    // Only send software_pin when user actually entered one. The masked
    // sentinel '****' is what the backend returns on GET — never a real value.
    if (v.software_pin && v.software_pin !== MASKED_SECRET) {
      payload['software_pin'] = v.software_pin;
    }

    const cfg = this.selectedConfig();
    const request$ = cfg
      ? this.invoicingService.updateDianConfig(cfg.id, payload)
      : this.invoicingService.createDianConfig(payload);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const persisted: DianConfig = response?.data || response;
          this.selectedConfig.set(persisted);
          this.savingCredentials.set(false);
          this.toast.success(cfg ? 'Credenciales actualizadas' : 'Credenciales guardadas');
          this.saved.emit(persisted);
          this.activeStep.set(1);
        },
        error: (err: any) => {
          this.savingCredentials.set(false);
          this.toast.error(extractApiErrorMessage(err) || 'Error al guardar credenciales');
        },
      });
  }

  // ── Step 2: Certificate ───────────────────────────────────
  onFileSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    if (inputEl.files && inputEl.files.length > 0) {
      this.selectedFile.set(inputEl.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const f = event.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.name.endsWith('.p12') || f.name.endsWith('.pfx')) {
      this.selectedFile.set(f);
    } else {
      this.toast.error('Solo se permiten archivos .p12 o .pfx');
    }
  }

  uploadCertificate(): void {
    const file = this.selectedFile();
    const cfg = this.selectedConfig();
    if (!file || !cfg || this.certificateForm.invalid) return;

    this.uploadingCertificate.set(true);
    const password = this.certificateForm.controls.certificate_password.value;

    // The backend persists only the s3_key (see vendix-s3-storage skill).
    // We pass file + password; response.data.certificate_s3_key is the sanitized key.
    this.invoicingService.uploadDianCertificate(cfg.id, file, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const persisted: DianConfig = response?.data || response;
          this.selectedConfig.set(persisted);
          this.uploadingCertificate.set(false);
          this.selectedFile.set(null);
          this.certificateForm.reset({ certificate_password: '' });
          this.toast.success('Certificado subido correctamente');
          this.saved.emit(persisted);
          this.activeStep.set(2);
        },
        error: (err: any) => {
          this.uploadingCertificate.set(false);
          this.toast.error(extractApiErrorMessage(err) || 'Error al subir certificado');
        },
      });
  }

  // ── Step 3: Environment + production transition ───────────
  setEnvironment(env: 'test' | 'production'): void {
    // Production is not a free choice: DIAN only authorizes real emission after
    // the test set passes. Selecting it earlier would produce a 412 on save, so
    // the option is refused up front with the reason.
    if (env === 'production' && !this.testSetPassed()) {
      this.toast.error(
        'Primero debes aprobar el set de pruebas de la DIAN para pasar a producción.',
      );
      return;
    }
    this.selectedEnvironment.set(env);
    if (env === 'production') this.loadReadiness();
  }

  saveEnvironment(): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;

    if (this.selectedEnvironment() === cfg.environment) {
      this.activeStep.set(3);
      return;
    }

    this.savingEnvironment.set(true);
    this.invoicingService
      .updateDianConfig(cfg.id, { environment: this.selectedEnvironment() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const persisted: DianConfig = response?.data || response;
          this.selectedConfig.set(persisted);
          this.savingEnvironment.set(false);
          this.toast.success('Ambiente actualizado');
          this.saved.emit(persisted);
          this.activeStep.set(3);
        },
        error: (err: any) => {
          this.savingEnvironment.set(false);
          this.toast.error(extractApiErrorMessage(err) || 'Error al cambiar ambiente');
        },
      });
  }

  /** Loads the production checklist so the merchant sees what is still missing. */
  loadReadiness(): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.loadingReadiness.set(true);
    this.invoicingService
      .getDianProductionReadiness(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.readiness.set(response?.data ?? response ?? null);
          this.loadingReadiness.set(false);
        },
        error: () => {
          this.readiness.set(null);
          this.loadingReadiness.set(false);
        },
      });
  }

  /**
   * Switches the configuration to real emission. The backend re-checks every
   * prerequisite, so a stale checklist in the UI can never let this through.
   */
  promoteToProduction(): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.promoting.set(true);
    this.invoicingService
      .promoteDianToProduction(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const persisted: DianConfig = response?.data || response;
          this.selectedConfig.set(persisted);
          this.selectedEnvironment.set('production');
          this.promoting.set(false);
          this.toast.success(
            'Facturación electrónica activada en producción. Ya puedes emitir facturas reales.',
          );
          this.saved.emit(persisted);
          this.loadReadiness();
        },
        error: (err: any) => {
          this.promoting.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo pasar a producción: revisa los requisitos pendientes.',
          );
          // Refresh the checklist so the reason is visible, not just a toast.
          this.loadReadiness();
        },
      });
  }

  // ── Step 4: Test connection ───────────────────────────────
  private loadResolutions(): void {
    this.invoicingService.getResolutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const list: InvoiceResolution[] = response?.data || [];
          this.resolutions.set(list);
          this.reconcileSelectedResolution();
        },
        error: () => this.resolutions.set([]),
      });
  }

  /**
   * Preselecciona la resolución del set de pruebas.
   *
   * POR QUÉ EXISTE: el selector arrancaba vacío salvo que hubiera exactamente una
   * resolución, así que con dos o más había que volver a elegirla en cada entrada
   * al wizard — y elegir mal quema un bloque de consecutivos autorizados que no se
   * recupera. La resolución del último envío ya está persistida en
   * `last_test_result.resolution_id`, así que la elección del usuario sobrevive
   * sin necesidad de columna nueva.
   *
   * Se llama desde las DOS cargas (resoluciones y resultados) porque son
   * asíncronas e independientes: cuál termina primero no debe cambiar el
   * resultado. Solo escribe si el selector está vacío, así que nunca pisa una
   * elección hecha a mano.
   */
  private reconcileSelectedResolution(): void {
    if (this.selectedResolutionId() !== null) return;

    const list = this.resolutions();
    if (list.length === 0) return;

    const remembered = this.testSetResult()?.resolution_id ?? null;
    if (remembered !== null && list.some((res) => res.id === remembered)) {
      this.selectedResolutionId.set(remembered);
      return;
    }

    // Con una sola candidata no hay nada que elegir: dejar el selector vacío solo
    // deshabilitaba el botón de ejecutar sin motivo.
    if (list.length === 1) {
      this.selectedResolutionId.set(list[0].id);
    }
  }

  /**
   * Rehydrates the test-set panel from the persisted `last_test_result`. Without
   * this the UI forgot every submission on reload — which is how a perfectly
   * healthy pending batch looked like "nothing happened".
   */
  private loadTestResults(configId: number): void {
    this.loadingTestSet.set(true);
    this.invoicingService
      .getDianTestResults(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const payload = response?.data ?? response;
          const persisted: PersistedTestResult | null =
            payload?.last_result ?? null;
          this.loadingTestSet.set(false);
          if (!persisted || !persisted.executed_at) {
            this.testSetResult.set(null);
            this.persistedTestResult.set(null);
            return;
          }
          const mapped = this.mapPersistedResult(persisted, payload?.environment);
          this.testSetResult.set(mapped);
          this.persistedTestResult.set(persisted);
          // La resolución del último envío ya está en el resultado persistido:
          // reconciliar aquí es lo que evita tener que volver a elegirla.
          this.reconcileSelectedResolution();
          if (mapped.pending) {
            // Resolve the verdict right away; DIAN may have finished while the
            // merchant was away.
            this.checkTestSetStatus(true);
          }
        },
        error: () => {
          this.loadingTestSet.set(false);
        },
      });
  }

  private mapPersistedResult(
    persisted: PersistedTestResult,
    environment?: string,
  ): DianTestResult {
    const dian = persisted.dian_response ?? {};
    const success = dian.success === true;
    const pending = persisted.pending === true;
    const rejected = persisted.rejected === true;
    return {
      success,
      pending,
      rejected,
      environment: environment ?? this.selectedConfig()?.environment ?? 'test',
      response_time_ms: 0,
      message: success
        ? 'La DIAN validó el set de pruebas.'
        : pending
          ? 'La DIAN recibió el set y sigue validándolo.'
          : `La DIAN rechazó el set de pruebas: ${dian.status_message ?? 'sin detalle'}`,
      dian_status: dian.status_code,
      status_message: dian.status_message,
      error_messages: dian.error_messages ?? [],
      tracking_id: persisted.tracking_id ?? persisted.zip_key ?? undefined,
      zip_key: persisted.zip_key ?? null,
      total_documents: persisted.total_documents ?? 50,
      invoices_count: persisted.invoices ?? 30,
      debit_notes_count: persisted.debit_notes ?? 10,
      credit_notes_count: persisted.credit_notes ?? 10,
      executed_at: persisted.executed_at ?? null,
      rechecked_at: persisted.rechecked_at ?? null,
      number_from: persisted.number_from ?? null,
      number_to: persisted.number_to ?? null,
      resolution_id: persisted.resolution_id ?? null,
      poll_history: persisted.poll_history,
    };
  }

  /**
   * Asks DIAN for the verdict of the batch already submitted. NEVER re-sends
   * documents, so it is safe to call on a timer and from a button.
   *
   * @param silent when true (automatic poll) only terminal outcomes raise toasts.
   */
  checkTestSetStatus(silent = false): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    if (this.checkingStatus()) return;

    this.checkingStatus.set(true);
    this.invoicingService
      .checkDianTestSetStatus(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const result: DianTestResult = response?.data ?? response;
          this.checkingStatus.set(false);
          this.applyTestSetOutcome(
            {
              ...this.testSetResult(),
              ...result,
              // The re-poll response carries no counts when the batch predates
              // this feature; keep whatever we already had.
              total_documents:
                result.total_documents ??
                this.testSetResult()?.total_documents ??
                50,
              invoices_count:
                result.invoices_count ?? this.testSetResult()?.invoices_count ?? 30,
              debit_notes_count:
                result.debit_notes_count ??
                this.testSetResult()?.debit_notes_count ??
                10,
              credit_notes_count:
                result.credit_notes_count ??
                this.testSetResult()?.credit_notes_count ??
                10,
            } as DianTestResult,
            silent,
          );
        },
        error: (err: any) => {
          this.checkingStatus.set(false);
          if (!silent) {
            this.toast.error(
              extractApiErrorMessage(err) || 'No se pudo consultar el estado en la DIAN',
            );
          }
        },
      });
  }

  /**
   * Single place where a test-set outcome updates the UI: keeps the toast, the
   * polling lifecycle and the config refresh consistent no matter whether the
   * outcome came from a run, an automatic poll or a manual re-check.
   */
  private applyTestSetOutcome(result: DianTestResult, silent: boolean): void {
    this.testSetResult.set(result);
    // Un envío nuevo cambia el ZipKey, y `technicalResult` oculta el snapshot en
    // cuanto deja de coincidir. Se re-lee para que el panel técnico hable del lote
    // que se acaba de mandar, que es justo cuando hace falta.
    this.loadTechnicalSnapshot();

    if (result.success) {
      this.stopPolling();
      this.toast.success('La DIAN aprobó el set de pruebas. Habilitación completa.');
      this.refreshConfig();
      return;
    }

    if (result.rejected) {
      this.stopPolling();
      this.toast.error(
        result.error_messages?.length
          ? `La DIAN rechazó el set: ${result.error_messages[0]}`
          : result.message || 'La DIAN rechazó el set de pruebas.',
      );
      this.refreshConfig();
      return;
    }

    // Pending, but the backend already decided the wait is no longer productive.
    // Polling a stalled batch can only ever repeat "en proceso", so the browser
    // timer stops and the card switches to the decision it actually needs.
    if (result.wait?.stalled) {
      this.stopPolling();
      this.pollExhausted.set(true);
      if (!silent) {
        this.toast.warning(
          result.wait.reason ??
            'La DIAN no emite veredicto para este lote. Diagnostica los documentos o descártalo y reenvía.',
        );
      }
      return;
    }

    // Still pending.
    if (!silent) {
      this.toast.info(
        'La DIAN sigue validando el set. Te avisamos en cuanto responda.',
      );
    }
    this.startPolling();
  }

  /**
   * Re-lee `last_test_result` SIN efectos: no toca el veredicto, no arranca el
   * sondeo, no lanza toasts.
   *
   * Separado de `loadTestResults` a propósito: ese método dispara
   * `checkTestSetStatus` cuando el lote está pendiente, y llamarlo desde
   * `applyTestSetOutcome` —que es a quien `checkTestSetStatus` le responde— cerraría
   * un ciclo de consultas a la DIAN sin fin.
   */
  private loadTechnicalSnapshot(): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.invoicingService
      .getDianTestResults(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const payload = response?.data ?? response;
          this.persistedTestResult.set(
            (payload?.last_result as PersistedTestResult) ?? null,
          );
        },
      });
  }

  private refreshConfig(): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.invoicingService
      .getDianConfigById(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const refreshed: DianConfig = response?.data || response;
          this.selectedConfig.set(refreshed);
          this.saved.emit(refreshed);
        },
      });
  }

  // ── Polling lifecycle ─────────────────────────────────────
  private startPolling(): void {
    this.startTips();
    if (this.pollSubscription || this.pollExhausted()) return;
    this.polling.set(true);
    this.pollSubscription = timer(POLL_INTERVAL_MS, POLL_INTERVAL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.pollAttempts() >= MAX_AUTO_POLLS) {
          // Stop pestering DIAN: the ZipKey is persisted, so the merchant can
          // come back whenever and resolve the verdict with one click.
          this.pollExhausted.set(true);
          this.stopPolling();
          return;
        }
        this.pollAttempts.update((n) => n + 1);
        this.checkTestSetStatus(true);
      });
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
    this.polling.set(false);
    this.stopTips();
  }

  /** Jumps to the Ambiente step and pulls the production checklist. */
  goToProduction(): void {
    this.activeStep.set(2);
    this.loadReadiness();
  }

  /** Restarts polling after the automatic window was exhausted. */
  resumePolling(): void {
    this.pollExhausted.set(false);
    this.pollAttempts.set(0);
    this.checkTestSetStatus(false);
  }

  /**
   * Asks DIAN, document by document, whether the batch reached its records.
   * Re-polling the ZipKey can only repeat "en proceso" forever; this is the
   * question that distinguishes a queued batch from one never classified.
   */
  diagnoseDocuments(): void {
    const config = this.selectedConfig();
    if (!config?.id || this.diagnosing()) return;

    this.diagnosing.set(true);
    this.invoicingService
      .getDianTestSetDocuments(config.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const data: TestSetDiagnosis = response?.data ?? response;
          this.diagnosis.set(data);
          this.diagnosing.set(false);
          if (data?.verdict === 'not_registered') {
            this.toast.error(
              'La DIAN no tiene registrado ninguno de los documentos: el lote nunca se clasificó.',
            );
          } else {
            this.toast.success(
              `La DIAN registró ${data?.registered_count} de ${data?.sampled} documentos consultados.`,
            );
          }
        },
        error: (err) => {
          this.diagnosing.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo diagnosticar el set de pruebas',
          );
        },
      });
  }

  /**
   * Discards a batch DIAN never judged so a new set can be sent. Without this
   * the re-send guard leaves the configuration stuck behind a dead ZipKey and
   * the only way out is editing the database by hand.
   */
  abandonBatch(): void {
    const config = this.selectedConfig();
    if (!config?.id || this.abandoning()) return;

    this.abandoning.set(true);
    this.invoicingService
      .abandonDianTestSet(config.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.abandoning.set(false);
          this.stopPolling();
          this.pollExhausted.set(false);
          this.pollAttempts.set(0);
          this.diagnosis.set(null);
          this.testSetResult.set(null);
          // El lote descartado deja de existir para la pantalla; su sobre SOAP y
          // sus nombres de archivo se van con él.
          this.persistedTestResult.set(null);
          this.toast.success(
            'Lote descartado. Ya puedes ejecutar un nuevo set de pruebas.',
          );
        },
        error: (err) => {
          this.abandoning.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo descartar el lote',
          );
        },
      });
  }

  private startTips(): void {
    if (this.tipSubscription) return;
    this.tipSubscription = timer(TIP_ROTATION_MS, TIP_ROTATION_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.tipIndex.update((i) => i + 1);
        this.nowTick.update((n) => n + 1);
      });
  }

  private stopTips(): void {
    this.tipSubscription?.unsubscribe();
    this.tipSubscription = null;
  }

  testConnection(): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.testingConnection.set(true);
    this.invoicingService.testDianConnection(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const result: DianTestResult = response?.data || response;
          this.testResult.set(result);
          this.testingConnection.set(false);
          if (result?.success) {
            this.toast.success('Conexion exitosa con la DIAN');
          } else {
            this.toast.error('Fallo la conexion con la DIAN');
          }
        },
        error: (err: any) => {
          this.testingConnection.set(false);
          this.testResult.set({
            success: false,
            environment: cfg.environment || 'test',
            response_time_ms: 0,
            message: extractApiErrorMessage(err) || 'Error al probar conexion',
          });
          this.toast.error('Error al probar conexion');
        },
      });
  }

  runTestSet(): void {
    const cfg = this.selectedConfig();
    const resId = this.selectedResolutionId();
    if (!cfg || !resId) return;
    // Guard in the UI too: a pending batch must be polled, never re-sent.
    if (this.testSetResult()?.pending) {
      this.toast.warning(
        'Ya hay un set de pruebas en validación. Consulta su estado en lugar de reenviarlo.',
      );
      return;
    }

    this.runningTestSet.set(true);
    this.testSetResult.set(null);
    this.persistedTestResult.set(null);
    this.pollExhausted.set(false);
    this.pollAttempts.set(0);
    this.startTips();

    // El POST solo ENCOLA (202 + job_id) y el resultado se sondea. Antes era
    // sincrónico y tardaba ~107 s, así que nginx lo cortaba a los 60 s con un 504
    // mientras el backend lo terminaba bien: el `next` no corría, la pantalla se
    // quedaba con el estado previo al envío y el toast decía «Error al ejecutar
    // set de pruebas» sobre un lote que sí había salido y ya había quemado su
    // bloque de consecutivos autorizados.
    this.invoicingService.runDianTestSet(cfg.id, resId)
      .pipe(
        switchMap((response: any) => {
          const jobId = String(response?.data?.job_id ?? response?.job_id ?? '');
          return pollAsyncJob(() =>
            this.invoicingService
              .getDianTestSetJob(cfg.id, jobId)
              .pipe(map((res: any) => res?.data ?? res)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (job: any) => {
          this.runningTestSet.set(false);
          if (job?.status === 'failed') {
            this.stopTips();
            this.toast.error(
              job?.error || 'El envío del set de pruebas falló',
            );
            this.checkTestSetStatus(true);
            return;
          }
          const result: DianTestResult = job?.result as DianTestResult;
          // A non-success response is NOT automatically an error: `pending`
          // means the batch is queued at DIAN. The old code showed no feedback
          // at all in that case, which is why a healthy submission looked silent.
          this.applyTestSetOutcome(result, false);
          if (result?.pending) {
            this.toast.info(
              `La DIAN recibió ${this.testSetDocumentsLabel()} y los está validando. Puedes esperar aquí o volver más tarde.`,
            );
          }
        },
        error: (err: any) => {
          this.runningTestSet.set(false);
          this.stopTips();
          // 409 = a batch is already in flight for this config. Surface the real
          // state instead of a dead-end error.
          if (err?.status === 409) {
            this.toast.warning(
              extractApiErrorMessage(err) ||
                'Ya hay un set de pruebas en validación en la DIAN.',
            );
            this.checkTestSetStatus(true);
            return;
          }
          // Nunca afirmar que no se ejecutó: si el worker ya arrancó, el lote
          // salió y quemó numeración que no se recupera. Se consulta el estado
          // real en vez de dejar a la vista creyendo que no pasó nada.
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo confirmar el envío. El lote puede haber salido: revisa el estado antes de reenviar.',
          );
          this.checkTestSetStatus(true);
        },
      });
  }

  // ── Step 5: Audit logs ────────────────────────────────────
  loadAuditLogs(): void {
    this.loadingAuditLogs.set(true);
    const configId = this.selectedConfig()?.id;
    this.invoicingService.getDianAuditLogs(this.auditLogPage(), 20, configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.auditLogs.set(response?.data || []);
          this.loadingAuditLogs.set(false);
        },
        error: () => {
          this.loadingAuditLogs.set(false);
        },
      });
  }

  prevAuditPage(): void {
    if (this.auditLogPage() > 1) {
      this.auditLogPage.update((p) => p - 1);
      this.loadAuditLogs();
    }
  }

  nextAuditPage(): void {
    this.auditLogPage.update((p) => p + 1);
    this.loadAuditLogs();
  }

  finish(): void {
    const cfg = this.selectedConfig();
    if (cfg) this.saved.emit(cfg);
    this.cancelled.emit();
  }
}
