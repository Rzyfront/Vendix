import { Component, inject, input, output, signal, effect, DestroyRef } from '@angular/core';
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
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  DianAuditLog,
  DianConfig,
  DianTestResult,
  InvoiceResolution,
} from '../../interfaces/invoice.interface';
import { InvoicingService } from '../../services/invoicing.service';
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
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
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
              placeholder="PIN secreto del software"
              [required]="true"
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
      }

      <!-- ═══ Step 2: Certificate ═══ -->
      @if (activeStep() === 1) {
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="upload" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Certificado Digital</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Suba su certificado digital (.p12) para firmar las facturas electronicas.
          </p>
          @if (!selectedConfig()) {
            <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Primero debe guardar las credenciales en el Paso 1.
              </div>
            </div>
          }
          @if (selectedConfig()) {
            <div class="space-y-4">
              @if (selectedConfig()!.certificate_s3_key) {
                <div class="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                  <div class="flex items-center gap-2">
                    <app-icon name="check-circle" [size]="16"></app-icon>
                    <span>Certificado cargado</span>
                  </div>
                  @if (selectedConfig()!.certificate_expiry) {
                    @if (isCertExpired()) {
                      <div class="mt-1 text-xs text-red-600 font-medium">
                        Vencido el {{ selectedConfig()!.certificate_expiry | date:'dd/MM/yyyy' }}
                      </div>
                    } @else {
                      <div class="mt-1 text-xs">
                        Expira: {{ selectedConfig()!.certificate_expiry | date:'dd/MM/yyyy' }}
                      </div>
                    }
                  }
                </div>
              }
              <div class="space-y-3">
                <label class="block text-sm font-medium text-text-primary">Archivo del certificado (.p12)</label>
                <div
                  class="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  (click)="fileInput.click()"
                  (dragover)="onDragOver($event)"
                  (drop)="onDrop($event)"
                >
                  <app-icon name="upload-cloud" [size]="32" class="text-gray-400 mx-auto mb-2"></app-icon>
                  <p class="text-sm text-text-secondary">
                    {{ selectedFile() ? selectedFile()!.name : 'Haga clic o arrastre su archivo .p12 aqui' }}
                  </p>
                  @if (!selectedFile()) {
                    <p class="text-xs text-gray-400 mt-1">Solo archivos .p12</p>
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
                  [required]="true"
                ></app-input>
              </form>
              <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <app-button
                  variant="primary"
                  (clicked)="uploadCertificate()"
                  [disabled]="!selectedFile() || certificateForm.invalid || uploadingCertificate()"
                  [loading]="uploadingCertificate()"
                >
                  Subir Certificado
                </app-button>
              </div>
            </div>
          }
        </div>
      }

      <!-- ═══ Step 3: Environment ═══ -->
      @if (activeStep() === 2) {
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="globe" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Ambiente</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Seleccione el ambiente de facturacion electronica.
          </p>
          @if (!selectedConfig()) {
            <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
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
                    'border-primary bg-primary/5': selectedEnvironment() === 'test',
                    'border-border hover:border-primary/30': selectedEnvironment() !== 'test'
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      [ngClass]="{
                        'border-primary': selectedEnvironment() === 'test',
                        'border-gray-300': selectedEnvironment() !== 'test'
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
                  class="p-4 rounded-lg border-2 text-left transition-all"
                  [ngClass]="{
                    'border-primary bg-primary/5': selectedEnvironment() === 'production',
                    'border-border hover:border-primary/30': selectedEnvironment() !== 'production'
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      [ngClass]="{
                        'border-primary': selectedEnvironment() === 'production',
                        'border-gray-300': selectedEnvironment() !== 'production'
                      }"
                    >
                      @if (selectedEnvironment() === 'production') {
                        <div class="w-2 h-2 rounded-full bg-primary"></div>
                      }
                    </div>
                    <span class="text-sm font-medium text-text-primary">Produccion</span>
                  </div>
                  <p class="text-xs text-text-secondary pl-6">
                    Envia facturas reales a la DIAN. Solo active despues de completar la habilitacion.
                  </p>
                </button>
              </div>
              <div class="p-3 rounded-lg bg-gray-50 border border-border text-sm">
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
                  <span class="text-text-primary font-medium">{{ selectedConfig()!.environment === 'test' ? 'Pruebas' : 'Produccion' }}</span>
                </div>
              </div>
              <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
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
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="zap" [size]="18" class="text-primary"></app-icon>
            <h2 class="text-base font-semibold text-text-primary">Probar Conexion</h2>
          </div>
          <p class="text-sm text-text-secondary mb-4">
            Verifique la conexion con la DIAN y ejecute el set de pruebas de habilitacion.
          </p>
          @if (!selectedConfig()) {
            <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
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
                  class="w-full px-3 py-2 border border-border rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none"
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
              <div class="flex items-center gap-3">
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
                  [disabled]="runningTestSet() || !selectedResolutionId()"
                  [loading]="runningTestSet()"
                >
                  <app-icon slot="icon" name="play" [size]="14"></app-icon>
                  Ejecutar Set de Pruebas
                </app-button>
              </div>
              @if (testResult()) {
                <div class="p-4 rounded-lg border"
                  [ngClass]="{
                    'bg-green-50 border-green-200': testResult()!.success,
                    'bg-red-50 border-red-200': !testResult()!.success
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <app-icon
                      [name]="testResult()!.success ? 'check-circle' : 'x-circle'"
                      [size]="18"
                      [class]="testResult()!.success ? 'text-green-600' : 'text-red-600'"
                    ></app-icon>
                    <span class="text-sm font-medium" [class]="testResult()!.success ? 'text-green-700' : 'text-red-700'">
                      {{ testResult()!.success ? 'Conexion exitosa' : 'Error de conexion' }}
                    </span>
                  </div>
                  <div class="text-xs space-y-1 pl-6" [class]="testResult()!.success ? 'text-green-600' : 'text-red-600'">
                    <div>{{ testResult()!.message }}</div>
                    <div>Ambiente: {{ testResult()!.environment === 'test' ? 'Pruebas' : 'Produccion' }}</div>
                    <div>Tiempo de respuesta: {{ testResult()!.response_time_ms }}ms</div>
                    @if (testResult()!.dian_status) {
                      <div>Estado DIAN: {{ testResult()!.dian_status }}</div>
                    }
                  </div>
                </div>
              }
              @if (testSetResult()) {
                <div class="p-4 rounded-lg border"
                  [ngClass]="{
                    'bg-green-50 border-green-200': testSetResult()!.success,
                    'bg-blue-50 border-blue-200': !testSetResult()!.success
                  }"
                >
                  <div class="flex items-center gap-2 mb-3">
                    <app-icon
                      [name]="testSetResult()!.success ? 'check-circle' : 'info'"
                      [size]="18"
                      [class]="testSetResult()!.success ? 'text-green-600' : 'text-blue-600'"
                    ></app-icon>
                    <span class="text-sm font-medium" [class]="testSetResult()!.success ? 'text-green-700' : 'text-blue-700'">
                      {{ testSetResult()!.message }}
                    </span>
                  </div>
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div class="p-2 bg-white rounded border border-border text-center">
                      <div class="text-text-secondary">Total</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.total_documents }}</div>
                    </div>
                    <div class="p-2 bg-white rounded border border-border text-center">
                      <div class="text-text-secondary">Facturas</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.invoices_count }}</div>
                    </div>
                    <div class="p-2 bg-white rounded border border-border text-center">
                      <div class="text-text-secondary">Notas Debito</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.debit_notes_count }}</div>
                    </div>
                    <div class="p-2 bg-white rounded border border-border text-center">
                      <div class="text-text-secondary">Notas Credito</div>
                      <div class="text-lg font-semibold text-text-primary">{{ testSetResult()!.credit_notes_count }}</div>
                    </div>
                  </div>
                  @if (testSetResult()!.tracking_id && testSetResult()!.tracking_id !== 's:Sender') {
                    <div class="mt-3 text-xs text-text-secondary">
                      Tracking ID: <span class="font-mono">{{ testSetResult()!.tracking_id }}</span>
                    </div>
                  }
                  @if (testSetResult()!.dian_status === 's:Sender') {
                    <div class="mt-3 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-700">
                      <strong>Nota:</strong> Los 50 documentos se generaron y firmaron correctamente. La DIAN requiere WS-Security en el envelope SOAP para procesar el set. Esta funcionalidad esta en desarrollo.
                    </div>
                  }
                </div>
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
        <div class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
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
                      <tr class="border-b border-border/50 hover:bg-gray-50">
                        <td class="py-2 px-3">
                          <div class="text-text-primary">{{ log.action }}</div>
                          @if (log.error_message) {
                            <div class="text-xs text-red-500 mt-0.5 max-w-[200px] truncate">
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
                              'bg-green-100 text-green-700': log.status === 'success',
                              'bg-red-100 text-red-700': log.status === 'error',
                              'bg-yellow-100 text-yellow-700': log.status === 'pending',
                              'bg-gray-100 text-gray-600': log.status !== 'success' && log.status !== 'error' && log.status !== 'pending'
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
                  <app-icon name="file-text" [size]="32" class="text-gray-400 mx-auto mb-2"></app-icon>
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
  private readonly invoicingService = inject(InvoicingService);
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

  // Step 5
  readonly auditLogs = signal<DianAuditLog[]>([]);
  readonly loadingAuditLogs = signal(false);
  readonly auditLogPage = signal(1);

  // ── Typed Forms ───────────────────────────────────────────
  readonly credentialsForm: FormGroup<CredentialsForm> = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    nit_type: ['NIT'],
    nit: ['', [Validators.required]],
    nit_dv: [''],
    software_id: ['', [Validators.required]],
    software_pin: ['', [Validators.required]],
    test_set_id: [''],
  });

  readonly certificateForm: FormGroup<CertificateForm> = this.fb.nonNullable.group({
    certificate_password: ['', [Validators.required]],
  });

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

  constructor() {
    // Sync initial inputs → internal signals (react to changes from parent)
    effect(() => {
      const cfg = this.initialConfig();
      this.selectedConfig.set(cfg);
      if (cfg) {
        this.patchCredentialsForm(cfg);
        this.selectedEnvironment.set(cfg.environment);
      } else {
        this.resetForms();
      }
    });

    effect(() => {
      const step = this.initialStep();
      if (typeof step === 'number') this.activeStep.set(step);
    });

    this.loadResolutions();
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
      enabled: 'Habilitado',
      suspended: 'Suspendido',
    };
    return labels[status] || status;
  }

  getEnablementStatusClass(status: string): string {
    const classes: Record<string, string> = {
      not_started: 'bg-gray-100 text-gray-600',
      testing: 'bg-yellow-100 text-yellow-700',
      enabled: 'bg-green-100 text-green-700',
      suspended: 'bg-red-100 text-red-700',
    };
    return classes[status] || 'bg-gray-100 text-gray-600';
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
    this.selectedResolutionId.set(null);
    this.auditLogs.set([]);
  }

  private patchCredentialsForm(cfg: DianConfig): void {
    this.credentialsForm.patchValue({
      name: cfg.name,
      nit_type: cfg.nit_type,
      nit: cfg.nit,
      nit_dv: cfg.nit_dv || '',
      software_id: cfg.software_id,
      // On edit: leave empty so user enters only to change. Validator below
      // is cleared to allow saving other fields without re-entering the pin.
      software_pin: '',
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
    if (v.software_pin && v.software_pin !== '****') {
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

  // ── Step 3: Environment ───────────────────────────────────
  setEnvironment(env: 'test' | 'production'): void {
    this.selectedEnvironment.set(env);
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

  // ── Step 4: Test connection ───────────────────────────────
  private loadResolutions(): void {
    this.invoicingService.getResolutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => this.resolutions.set(response?.data || []),
        error: () => this.resolutions.set([]),
      });
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
    this.runningTestSet.set(true);
    this.testSetResult.set(null);
    this.invoicingService.runDianTestSet(cfg.id, resId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const result: DianTestResult = response?.data || response;
          this.testSetResult.set(result);
          this.runningTestSet.set(false);
          if (result.success) {
            this.toast.success('Set de pruebas enviado exitosamente');
            // Reload config to reflect updated enablement_status
            this.invoicingService.getDianConfigById(cfg.id)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (cfgResponse: any) => {
                  const refreshed: DianConfig = cfgResponse?.data || cfgResponse;
                  this.selectedConfig.set(refreshed);
                  this.saved.emit(refreshed);
                },
              });
          }
        },
        error: (err: any) => {
          this.runningTestSet.set(false);
          this.toast.error(extractApiErrorMessage(err) || 'Error al ejecutar set de pruebas');
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
