import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { InvoicingService } from '../../services/invoicing.service';
import { DianConfig, DianNitType, DianTestResult, DianAuditLog } from '../../interfaces/invoice.interface';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { StepsLineComponent, StepsLineItem } from '../../../../../../shared/components/steps-line/steps-line.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'vendix-dian-config',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    SpinnerComponent,
    StepsLineComponent,
  ],
  template: `
    <div class="w-full max-w-4xl mx-auto p-4 md:p-6 space-y-6">

      <!-- Page Header -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-primary/10">
            <app-icon name="shield" [size]="24" class="text-primary"></app-icon>
          </div>
          <div>
            <h1 class="text-lg font-semibold text-text-primary">Configuraciones DIAN</h1>
            <p class="text-sm text-text-secondary">Administre sus configuraciones de facturacion electronica</p>
          </div>
        </div>
        <app-button
          *ngIf="viewMode === 'detail'"
          variant="outline"
          size="sm"
          (clicked)="backToList()"
        >
          <app-icon slot="icon" name="arrow-left" [size]="14"></app-icon>
          Volver al listado
        </app-button>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="flex justify-center py-12">
        <app-spinner size="lg"></app-spinner>
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- LIST VIEW                                              -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div *ngIf="!loading && viewMode === 'list'" class="space-y-4">

        <!-- Add Button -->
        <div class="flex justify-end">
          <app-button variant="primary" size="sm" (clicked)="startNewConfig()">
            <app-icon slot="icon" name="plus" [size]="14"></app-icon>
            Agregar Configuracion
          </app-button>
        </div>

        <!-- Config Cards -->
        <div *ngIf="configs.length > 0" class="space-y-3">
          <div
            *ngFor="let cfg of configs"
            class="border border-border rounded-xl p-4 bg-white hover:shadow-sm transition-shadow"
          >
            <div class="flex items-start justify-between gap-3">
              <!-- Left: Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="text-sm font-semibold text-text-primary truncate">{{ cfg.name }}</h3>
                  <span
                    *ngIf="cfg.is_default"
                    class="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary whitespace-nowrap"
                  >
                    Predeterminada
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                  <span>{{ getNitTypeLabel(cfg.nit_type) }}: {{ cfg.nit }}{{ cfg.nit_dv ? '-' + cfg.nit_dv : '' }}</span>
                  <span class="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    [ngClass]="{
                      'bg-yellow-100 text-yellow-700': cfg.environment === 'test',
                      'bg-green-100 text-green-700': cfg.environment === 'production'
                    }"
                  >
                    {{ cfg.environment === 'test' ? 'Pruebas' : 'Produccion' }}
                  </span>
                  <span class="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    [ngClass]="getEnablementStatusClass(cfg.enablement_status)"
                  >
                    {{ getEnablementStatusLabel(cfg.enablement_status) }}
                  </span>
                </div>
              </div>

              <!-- Right: Actions -->
              <div class="flex items-center gap-1 shrink-0">
                <app-button
                  *ngIf="!cfg.is_default"
                  variant="ghost"
                  size="sm"
                  (clicked)="markAsDefault(cfg)"
                  title="Marcar como predeterminada"
                >
                  <app-icon name="star" [size]="14"></app-icon>
                </app-button>
                <app-button variant="ghost" size="sm" (clicked)="editConfig(cfg)" title="Editar">
                  <app-icon name="pencil" [size]="14"></app-icon>
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  (clicked)="confirmDelete(cfg)"
                  title="Eliminar"
                  [disabled]="deletingId === cfg.id"
                >
                  <app-icon name="trash-2" [size]="14" class="text-red-500"></app-icon>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="configs.length === 0" class="py-12 text-center border border-dashed border-border rounded-xl">
          <app-icon name="shield" [size]="40" class="text-gray-300 mx-auto mb-3"></app-icon>
          <h3 class="text-sm font-medium text-text-primary mb-1">Sin configuraciones DIAN</h3>
          <p class="text-xs text-text-secondary mb-4">Agregue una configuracion para habilitar la facturacion electronica</p>
          <app-button variant="primary" size="sm" (clicked)="startNewConfig()">
            <app-icon slot="icon" name="plus" [size]="14"></app-icon>
            Agregar Primera Configuracion
          </app-button>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- DETAIL VIEW (Stepper Wizard)                           -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div *ngIf="!loading && viewMode === 'detail'">

        <!-- Stepper Navigation -->
        <app-steps-line
          [steps]="stepsConfig"
          [currentStep]="activeStep"
          [clickable]="true"
          size="md"
          (stepClicked)="activeStep = $event"
        ></app-steps-line>

        <div class="mt-6">

          <!-- ═══ Step 1: Credentials ═══ -->
          <div *ngIf="activeStep === 0" class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
            <div class="flex items-center gap-2 mb-2">
              <app-icon name="key" [size]="18" class="text-primary"></app-icon>
              <h2 class="text-base font-semibold text-text-primary">Credenciales DIAN</h2>
            </div>
            <p class="text-sm text-text-secondary mb-4">
              Ingrese los datos de su empresa y credenciales del software de facturacion electronica.
            </p>

            <form [formGroup]="credentialsForm" class="space-y-4">
              <!-- Name + NIT Type (new fields) -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  label="Nombre de la configuracion"
                  formControlName="name"
                  [control]="credentialsForm.get('name')"
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
                  [control]="credentialsForm.get('nit')"
                  placeholder="Ej: 900123456"
                  [required]="true"
                ></app-input>

                <app-input
                  label="Digito de Verificacion (DV)"
                  formControlName="nit_dv"
                  [control]="credentialsForm.get('nit_dv')"
                  placeholder="Ej: 7"
                ></app-input>
              </div>

              <app-input
                label="Software ID"
                formControlName="software_id"
                [control]="credentialsForm.get('software_id')"
                placeholder="ID del software registrado en la DIAN"
                [required]="true"
              ></app-input>

              <app-input
                label="PIN del Software"
                type="password"
                formControlName="software_pin"
                [control]="credentialsForm.get('software_pin')"
                placeholder="PIN secreto del software"
                [required]="true"
              ></app-input>

              <app-input
                label="Test Set ID"
                formControlName="test_set_id"
                [control]="credentialsForm.get('test_set_id')"
                placeholder="ID del set de pruebas (opcional)"
              ></app-input>
            </form>

            <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <app-button
                variant="primary"
                (clicked)="saveCredentials()"
                [disabled]="credentialsForm.invalid || savingCredentials"
                [loading]="savingCredentials"
              >
                {{ selectedConfig ? 'Actualizar' : 'Guardar' }} Credenciales
              </app-button>
            </div>
          </div>

          <!-- ═══ Step 2: Certificate ═══ -->
          <div *ngIf="activeStep === 1" class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
            <div class="flex items-center gap-2 mb-2">
              <app-icon name="upload" [size]="18" class="text-primary"></app-icon>
              <h2 class="text-base font-semibold text-text-primary">Certificado Digital</h2>
            </div>
            <p class="text-sm text-text-secondary mb-4">
              Suba su certificado digital (.p12) para firmar las facturas electronicas.
            </p>

            <div *ngIf="!selectedConfig" class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Primero debe guardar las credenciales en el Paso 1.
              </div>
            </div>

            <div *ngIf="selectedConfig" class="space-y-4">
              <div *ngIf="selectedConfig.certificate_s3_key" class="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                <div class="flex items-center gap-2">
                  <app-icon name="check-circle" [size]="16"></app-icon>
                  <span>Certificado cargado</span>
                </div>
                <div *ngIf="selectedConfig.certificate_expiry" class="mt-1 text-xs">
                  Expira: {{ selectedConfig.certificate_expiry | date:'dd/MM/yyyy' }}
                </div>
              </div>

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
                    {{ selectedFile ? selectedFile.name : 'Haga clic o arrastre su archivo .p12 aqui' }}
                  </p>
                  <p *ngIf="!selectedFile" class="text-xs text-gray-400 mt-1">Solo archivos .p12</p>
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
                  [control]="certificateForm.get('certificate_password')"
                  placeholder="Contrasena del archivo .p12"
                  [required]="true"
                ></app-input>
              </form>

              <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <app-button
                  variant="primary"
                  (clicked)="uploadCertificate()"
                  [disabled]="!selectedFile || certificateForm.invalid || uploadingCertificate"
                  [loading]="uploadingCertificate"
                >
                  Subir Certificado
                </app-button>
              </div>
            </div>
          </div>

          <!-- ═══ Step 3: Environment ═══ -->
          <div *ngIf="activeStep === 2" class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
            <div class="flex items-center gap-2 mb-2">
              <app-icon name="globe" [size]="18" class="text-primary"></app-icon>
              <h2 class="text-base font-semibold text-text-primary">Ambiente</h2>
            </div>
            <p class="text-sm text-text-secondary mb-4">
              Seleccione el ambiente de facturacion electronica.
            </p>

            <div *ngIf="!selectedConfig" class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Primero debe guardar las credenciales en el Paso 1.
              </div>
            </div>

            <div *ngIf="selectedConfig" class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  (click)="setEnvironment('test')"
                  class="p-4 rounded-lg border-2 text-left transition-all"
                  [ngClass]="{
                    'border-primary bg-primary/5': selectedEnvironment === 'test',
                    'border-border hover:border-primary/30': selectedEnvironment !== 'test'
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      [ngClass]="{
                        'border-primary': selectedEnvironment === 'test',
                        'border-gray-300': selectedEnvironment !== 'test'
                      }"
                    >
                      <div *ngIf="selectedEnvironment === 'test'" class="w-2 h-2 rounded-full bg-primary"></div>
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
                    'border-primary bg-primary/5': selectedEnvironment === 'production',
                    'border-border hover:border-primary/30': selectedEnvironment !== 'production'
                  }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      [ngClass]="{
                        'border-primary': selectedEnvironment === 'production',
                        'border-gray-300': selectedEnvironment !== 'production'
                      }"
                    >
                      <div *ngIf="selectedEnvironment === 'production'" class="w-2 h-2 rounded-full bg-primary"></div>
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
                    [ngClass]="getEnablementStatusClass(selectedConfig.enablement_status)"
                  >
                    {{ getEnablementStatusLabel(selectedConfig.enablement_status) }}
                  </span>
                </div>
                <div class="flex items-center justify-between mt-2">
                  <span class="text-text-secondary">Ambiente actual:</span>
                  <span class="text-text-primary font-medium">{{ selectedConfig.environment === 'test' ? 'Pruebas' : 'Produccion' }}</span>
                </div>
              </div>

              <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <app-button
                  variant="primary"
                  (clicked)="saveEnvironment()"
                  [disabled]="selectedEnvironment === selectedConfig.environment || savingEnvironment"
                  [loading]="savingEnvironment"
                >
                  Guardar Ambiente
                </app-button>
              </div>
            </div>
          </div>

          <!-- ═══ Step 4: Test Connection ═══ -->
          <div *ngIf="activeStep === 3" class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
            <div class="flex items-center gap-2 mb-2">
              <app-icon name="zap" [size]="18" class="text-primary"></app-icon>
              <h2 class="text-base font-semibold text-text-primary">Probar Conexion</h2>
            </div>
            <p class="text-sm text-text-secondary mb-4">
              Verifique la conexion con la DIAN y ejecute el set de pruebas de habilitacion.
            </p>

            <div *ngIf="!selectedConfig" class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Primero debe completar los pasos anteriores.
              </div>
            </div>

            <div *ngIf="selectedConfig" class="space-y-4">
              <div class="flex items-center gap-3">
                <app-button
                  variant="outline"
                  (clicked)="testConnection()"
                  [disabled]="testingConnection"
                  [loading]="testingConnection"
                >
                  <app-icon slot="icon" name="wifi" [size]="14"></app-icon>
                  Probar Conexion
                </app-button>

                <app-button
                  variant="primary"
                  (clicked)="runTestSet()"
                  [disabled]="runningTestSet"
                  [loading]="runningTestSet"
                >
                  <app-icon slot="icon" name="play" [size]="14"></app-icon>
                  Ejecutar Set de Pruebas
                </app-button>
              </div>

              <div *ngIf="testResult" class="p-4 rounded-lg border"
                [ngClass]="{
                  'bg-green-50 border-green-200': testResult.success,
                  'bg-red-50 border-red-200': !testResult.success
                }"
              >
                <div class="flex items-center gap-2 mb-2">
                  <app-icon
                    [name]="testResult.success ? 'check-circle' : 'x-circle'"
                    [size]="18"
                    [class]="testResult.success ? 'text-green-600' : 'text-red-600'"
                  ></app-icon>
                  <span class="text-sm font-medium" [class]="testResult.success ? 'text-green-700' : 'text-red-700'">
                    {{ testResult.success ? 'Conexion exitosa' : 'Error de conexion' }}
                  </span>
                </div>
                <div class="text-xs space-y-1 pl-6" [class]="testResult.success ? 'text-green-600' : 'text-red-600'">
                  <div>{{ testResult.message }}</div>
                  <div>Ambiente: {{ testResult.environment === 'test' ? 'Pruebas' : 'Produccion' }}</div>
                  <div>Tiempo de respuesta: {{ testResult.response_time_ms }}ms</div>
                  <div *ngIf="testResult.dian_status">Estado DIAN: {{ testResult.dian_status }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- ═══ Step 5: Audit Logs ═══ -->
          <div *ngIf="activeStep === 4" class="border border-border rounded-xl p-4 md:p-6 space-y-4 bg-white">
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
                [loading]="loadingAuditLogs"
              >
                <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                Actualizar
              </app-button>
            </div>

            <div *ngIf="loadingAuditLogs" class="py-6 text-center">
              <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>

            <div *ngIf="!loadingAuditLogs" class="overflow-x-auto">
              <table *ngIf="auditLogs.length > 0" class="w-full text-sm">
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
                  <tr *ngFor="let log of auditLogs" class="border-b border-border/50 hover:bg-gray-50">
                    <td class="py-2 px-3">
                      <div class="text-text-primary">{{ log.action }}</div>
                      <div *ngIf="log.error_message" class="text-xs text-red-500 mt-0.5 max-w-[200px] truncate">
                        {{ log.error_message }}
                      </div>
                    </td>
                    <td class="py-2 px-3 hidden md:table-cell">
                      <span *ngIf="log.document_number" class="text-text-primary">{{ log.document_type }} {{ log.document_number }}</span>
                      <span *ngIf="!log.document_number" class="text-text-secondary">-</span>
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
                </tbody>
              </table>

              <div *ngIf="auditLogs.length === 0" class="py-8 text-center">
                <app-icon name="file-text" [size]="32" class="text-gray-400 mx-auto mb-2"></app-icon>
                <p class="text-text-secondary text-sm">No hay registros de operaciones</p>
              </div>
            </div>

            <div *ngIf="auditLogs.length > 0" class="flex items-center justify-between pt-3 border-t border-border">
              <span class="text-xs text-text-secondary">Pagina {{ auditLogPage }}</span>
              <div class="flex gap-2">
                <app-button variant="outline" size="sm" (clicked)="prevAuditPage()" [disabled]="auditLogPage <= 1">
                  Anterior
                </app-button>
                <app-button variant="outline" size="sm" (clicked)="nextAuditPage()">
                  Siguiente
                </app-button>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  `,
})
export class DianConfigComponent implements OnInit {
  private invoicingService = inject(InvoicingService);
  private fb = inject(FormBuilder);
  private toast = inject(ToastService);

  // State
  loading = true;
  configs: DianConfig[] = [];
  selectedConfig: DianConfig | null = null;
  viewMode: 'list' | 'detail' = 'list';
  activeStep = 0;
  deletingId: number | null = null;

  // NIT types for selector
  nitTypeOptions: SelectorOption[] = [
    { value: 'NIT', label: 'NIT' },
    { value: 'CC', label: 'Cedula de Ciudadania (CC)' },
    { value: 'CE', label: 'Cedula de Extranjeria (CE)' },
    { value: 'TI', label: 'Tarjeta de Identidad (TI)' },
    { value: 'PP', label: 'Pasaporte (PP)' },
    { value: 'NIT_EXTRANJERIA', label: 'NIT Extranjeria' },
  ];

  // Step 1: Credentials
  credentialsForm: FormGroup;
  savingCredentials = false;

  // Step 2: Certificate
  certificateForm: FormGroup;
  selectedFile: File | null = null;
  uploadingCertificate = false;

  // Step 3: Environment
  selectedEnvironment: 'test' | 'production' = 'test';
  savingEnvironment = false;

  // Step 4: Test Connection
  testingConnection = false;
  runningTestSet = false;
  testResult: DianTestResult | null = null;

  // Step 5: Audit Logs
  auditLogs: DianAuditLog[] = [];
  loadingAuditLogs = false;
  auditLogPage = 1;

  stepsConfig: StepsLineItem[] = [
    { label: 'Credenciales' },
    { label: 'Certificado' },
    { label: 'Ambiente' },
    { label: 'Prueba' },
    { label: 'Registros' },
  ];

  constructor() {
    this.credentialsForm = this.fb.group({
      name: ['', [Validators.required]],
      nit_type: ['NIT'],
      nit: ['', [Validators.required]],
      nit_dv: [''],
      software_id: ['', [Validators.required]],
      software_pin: ['', [Validators.required]],
      test_set_id: [''],
    });

    this.certificateForm = this.fb.group({
      certificate_password: ['', [Validators.required]],
    });
  }

  ngOnInit(): void {
    this.loadConfigs();
  }

  // ── Data Loading ──────────────────────────────────────────

  loadConfigs(): void {
    this.loading = true;
    this.invoicingService.getDianConfigs().subscribe({
      next: (response: any) => {
        this.configs = response?.data || [];
        this.loading = false;
      },
      error: () => {
        this.configs = [];
        this.loading = false;
      },
    });
  }

  // ── View Navigation ───────────────────────────────────────

  startNewConfig(): void {
    this.selectedConfig = null;
    this.resetForms();
    this.activeStep = 0;
    this.viewMode = 'detail';
  }

  editConfig(cfg: DianConfig): void {
    this.selectedConfig = cfg;
    this.patchCredentialsForm();
    this.selectedEnvironment = cfg.environment;
    this.testResult = null;
    this.activeStep = 0;
    this.viewMode = 'detail';
  }

  backToList(): void {
    this.viewMode = 'list';
    this.selectedConfig = null;
    this.resetForms();
    this.loadConfigs();
  }

  // ── List Actions ──────────────────────────────────────────

  markAsDefault(cfg: DianConfig): void {
    this.invoicingService.setDefaultDianConfig(cfg.id).subscribe({
      next: () => {
        this.toast.success(`"${cfg.name}" marcada como predeterminada`);
        this.loadConfigs();
      },
      error: (err: any) => {
        this.toast.error(err?.error?.message || 'Error al cambiar configuracion predeterminada');
      },
    });
  }

  confirmDelete(cfg: DianConfig): void {
    if (!confirm(`Eliminar la configuracion "${cfg.name}"? Esta accion no se puede deshacer.`)) return;

    this.deletingId = cfg.id;
    this.invoicingService.deleteDianConfig(cfg.id).subscribe({
      next: () => {
        this.toast.success(`Configuracion "${cfg.name}" eliminada`);
        this.deletingId = null;
        this.loadConfigs();
      },
      error: (err: any) => {
        this.deletingId = null;
        this.toast.error(err?.error?.message || 'Error al eliminar configuracion');
      },
    });
  }

  // ── Form Helpers ──────────────────────────────────────────

  private resetForms(): void {
    this.credentialsForm.reset({ name: '', nit_type: 'NIT', nit: '', nit_dv: '', software_id: '', software_pin: '', test_set_id: '' });
    this.certificateForm.reset();
    this.selectedFile = null;
    this.selectedEnvironment = 'test';
    this.testResult = null;
    this.auditLogs = [];
  }

  private patchCredentialsForm(): void {
    if (!this.selectedConfig) return;
    this.credentialsForm.patchValue({
      name: this.selectedConfig.name,
      nit_type: this.selectedConfig.nit_type,
      nit: this.selectedConfig.nit,
      nit_dv: this.selectedConfig.nit_dv || '',
      software_id: this.selectedConfig.software_id,
      software_pin: this.selectedConfig.software_pin_encrypted,
      test_set_id: this.selectedConfig.test_set_id || '',
    });
  }

  // ── Label Helpers ─────────────────────────────────────────

  getNitTypeLabel(type: DianNitType): string {
    const labels: Record<DianNitType, string> = {
      NIT: 'NIT',
      CC: 'CC',
      CE: 'CE',
      TI: 'TI',
      PP: 'PP',
      NIT_EXTRANJERIA: 'NIT Ext.',
    };
    return labels[type] || type;
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

  // ── Step 1: Save Credentials ──────────────────────────────

  saveCredentials(): void {
    if (this.credentialsForm.invalid) {
      this.credentialsForm.markAllAsTouched();
      return;
    }

    this.savingCredentials = true;
    const payload = {
      name: this.credentialsForm.value.name,
      nit: this.credentialsForm.value.nit,
      nit_type: this.credentialsForm.value.nit_type,
      nit_dv: this.credentialsForm.value.nit_dv || null,
      software_id: this.credentialsForm.value.software_id,
      software_pin: this.credentialsForm.value.software_pin,
      test_set_id: this.credentialsForm.value.test_set_id || null,
    };

    const request$ = this.selectedConfig
      ? this.invoicingService.updateDianConfig(this.selectedConfig.id, payload)
      : this.invoicingService.createDianConfig(payload);

    request$.subscribe({
      next: (response: any) => {
        this.selectedConfig = response.data || response;
        this.savingCredentials = false;
        this.toast.success(this.selectedConfig ? 'Credenciales actualizadas' : 'Credenciales guardadas');
        this.activeStep = 1;
      },
      error: (err: any) => {
        this.savingCredentials = false;
        this.toast.error(err?.error?.message || 'Error al guardar credenciales');
      },
    });
  }

  // ── Step 2: Certificate Upload ────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (file.name.endsWith('.p12') || file.name.endsWith('.pfx')) {
        this.selectedFile = file;
      } else {
        this.toast.error('Solo se permiten archivos .p12 o .pfx');
      }
    }
  }

  uploadCertificate(): void {
    if (!this.selectedFile || !this.selectedConfig || this.certificateForm.invalid) return;

    this.uploadingCertificate = true;
    const password = this.certificateForm.value.certificate_password;

    this.invoicingService.uploadDianCertificate(this.selectedConfig.id, this.selectedFile, password).subscribe({
      next: (response: any) => {
        this.selectedConfig = response.data || response;
        this.uploadingCertificate = false;
        this.selectedFile = null;
        this.certificateForm.reset();
        this.toast.success('Certificado subido correctamente');
        this.activeStep = 2;
      },
      error: (err: any) => {
        this.uploadingCertificate = false;
        this.toast.error(err?.error?.message || 'Error al subir certificado');
      },
    });
  }

  // ── Step 3: Environment ───────────────────────────────────

  setEnvironment(env: 'test' | 'production'): void {
    this.selectedEnvironment = env;
  }

  saveEnvironment(): void {
    if (!this.selectedConfig) return;

    this.savingEnvironment = true;
    this.invoicingService.updateDianConfig(this.selectedConfig.id, { environment: this.selectedEnvironment }).subscribe({
      next: (response: any) => {
        this.selectedConfig = response.data || response;
        this.savingEnvironment = false;
        this.toast.success('Ambiente actualizado');
        this.activeStep = 3;
      },
      error: (err: any) => {
        this.savingEnvironment = false;
        this.toast.error(err?.error?.message || 'Error al cambiar ambiente');
      },
    });
  }

  // ── Step 4: Test Connection ───────────────────────────────

  testConnection(): void {
    if (!this.selectedConfig) return;
    this.testingConnection = true;
    this.invoicingService.testDianConnection(this.selectedConfig.id).subscribe({
      next: (response: any) => {
        this.testResult = response.data || response;
        this.testingConnection = false;
        if (this.testResult?.success) {
          this.toast.success('Conexion exitosa con la DIAN');
        } else {
          this.toast.error('Fallo la conexion con la DIAN');
        }
      },
      error: (err: any) => {
        this.testingConnection = false;
        this.testResult = {
          success: false,
          environment: this.selectedConfig?.environment || 'test',
          response_time_ms: 0,
          message: err?.error?.message || 'Error al probar conexion',
        };
        this.toast.error('Error al probar conexion');
      },
    });
  }

  runTestSet(): void {
    if (!this.selectedConfig) return;
    this.runningTestSet = true;
    this.invoicingService.runDianTestSet(this.selectedConfig.id).subscribe({
      next: (response: any) => {
        this.testResult = response.data || response;
        this.runningTestSet = false;
        if (this.testResult?.success) {
          this.toast.success('Set de pruebas completado exitosamente');
        } else {
          this.toast.error('El set de pruebas tuvo errores');
        }
      },
      error: (err: any) => {
        this.runningTestSet = false;
        this.toast.error(err?.error?.message || 'Error al ejecutar set de pruebas');
      },
    });
  }

  // ── Step 5: Audit Logs ────────────────────────────────────

  loadAuditLogs(): void {
    this.loadingAuditLogs = true;
    const config_id = this.selectedConfig?.id;
    this.invoicingService.getDianAuditLogs(this.auditLogPage, 20, config_id).subscribe({
      next: (response: any) => {
        this.auditLogs = response.data || [];
        this.loadingAuditLogs = false;
      },
      error: () => {
        this.loadingAuditLogs = false;
      },
    });
  }

  prevAuditPage(): void {
    if (this.auditLogPage > 1) {
      this.auditLogPage--;
      this.loadAuditLogs();
    }
  }

  nextAuditPage(): void {
    this.auditLogPage++;
    this.loadAuditLogs();
  }
}
