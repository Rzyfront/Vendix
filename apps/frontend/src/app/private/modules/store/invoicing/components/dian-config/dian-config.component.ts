import { Component, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
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
    NgClass,
    DatePipe,
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    SpinnerComponent,
    StepsLineComponent
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
        <div class="flex items-center gap-2">
          @if (viewMode() === 'list') {
            <app-button
              [variant]="showDashboard() ? 'outline' : 'ghost'"
              size="sm"
              (clicked)="toggleDashboard()"
              >
              <app-icon slot="icon" name="bar-chart-2" [size]="14"></app-icon>
              {{ showDashboard() ? 'Configuraciones' : 'Dashboard' }}
            </app-button>
          }
          @if (viewMode() === 'detail') {
            <app-button
              variant="outline"
              size="sm"
              (clicked)="backToList()"
              >
              <app-icon slot="icon" name="arrow-left" [size]="14"></app-icon>
              Volver al listado
            </app-button>
          }
        </div>
      </div>
    
      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- DASHBOARD VIEW                                         -->
      <!-- ═══════════════════════════════════════════════════════ -->
      @if (!loading() && viewMode() === 'list' && showDashboard()) {
        <div class="space-y-4">
          @if (loadingDashboard()) {
            <div class="flex justify-center py-12">
              <app-spinner size="lg"></app-spinner>
            </div>
          }
          @if (!loadingDashboard() && dashboardData()) {
            <div class="space-y-4">
              <!-- Stats Cards -->
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div class="border border-border rounded-xl p-4 bg-white">
                  <div class="text-xs text-text-secondary mb-1">Total Enviados</div>
                  <div class="text-2xl font-bold text-text-primary">{{ dashboardData()!.stats.total_sent }}</div>
                </div>
                <div class="border border-border rounded-xl p-4 bg-white">
                  <div class="text-xs text-text-secondary mb-1">Exitosos</div>
                  <div class="text-2xl font-bold text-green-600">{{ dashboardData()!.stats.total_success }}</div>
                </div>
                <div class="border border-border rounded-xl p-4 bg-white">
                  <div class="text-xs text-text-secondary mb-1">Errores</div>
                  <div class="text-2xl font-bold text-red-600">{{ dashboardData()!.stats.total_errors }}</div>
                </div>
                <div class="border border-border rounded-xl p-4 bg-white">
                  <div class="text-xs text-text-secondary mb-1">Tasa de Exito</div>
                  <div class="text-2xl font-bold text-text-primary">{{ dashboardData()!.stats.success_rate }}%</div>
                  <div class="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-500"
                  [ngClass]="{
                    'bg-green-500': dashboardData()!.stats.success_rate >= 90,
                    'bg-yellow-500': dashboardData()!.stats.success_rate >= 70 && dashboardData()!.stats.success_rate < 90,
                    'bg-red-500': dashboardData()!.stats.success_rate < 70
                  }"
                      [style.width.%]="dashboardData()!.stats.success_rate"
                    ></div>
                  </div>
                </div>
              </div>
              <!-- Certificate Indicator -->
              @if (dashboardData()!.certificate_status) {
                <div class="border border-border rounded-xl p-4 bg-white">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <app-icon name="shield" [size]="18"
                  [ngClass]="{
                    'text-green-600': dashboardData()!.certificate_status.status === 'valid',
                    'text-yellow-600': dashboardData()!.certificate_status.status === 'expiring_soon',
                    'text-red-600': dashboardData()!.certificate_status.status === 'expired',
                    'text-gray-400': dashboardData()!.certificate_status.status === 'not_configured'
                  }"
                      ></app-icon>
                      <span class="text-sm font-medium text-text-primary">Certificado Digital</span>
                    </div>
                    <span class="px-2 py-0.5 text-xs rounded-full font-medium"
                [ngClass]="{
                  'bg-green-100 text-green-700': dashboardData()!.certificate_status.status === 'valid',
                  'bg-yellow-100 text-yellow-700': dashboardData()!.certificate_status.status === 'expiring_soon',
                  'bg-red-100 text-red-700': dashboardData()!.certificate_status.status === 'expired',
                  'bg-gray-100 text-gray-600': dashboardData()!.certificate_status.status === 'not_configured'
                }"
                      >
                      {{ getCertStatusLabel(dashboardData()!.certificate_status.status) }}
                    </span>
                  </div>
                  @if (dashboardData()!.certificate_status.expires) {
                    <div class="mt-2 text-xs text-text-secondary">
                      Expira: {{ dashboardData()!.certificate_status.expires | date:'dd/MM/yyyy' }}
                      @if (dashboardData()!.certificate_status.days_remaining !== null) {
                        <span>
                          ({{ dashboardData()!.certificate_status.days_remaining }} dias restantes)
                        </span>
                      }
                    </div>
                  }
                </div>
              }
              <!-- Recent Submissions Table -->
              <div class="border border-border rounded-xl p-4 bg-white">
                <h3 class="text-sm font-semibold text-text-primary mb-3">Ultimos 20 Envios</h3>
                <div class="overflow-x-auto">
                  @if (dashboardData()!.recent_submissions.length > 0) {
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
                        @for (log of dashboardData()!.recent_submissions; track log) {
                          <tr class="border-b border-border/50 hover:bg-gray-50">
                            <td class="py-2 px-3">
                              <div class="text-text-primary">{{ log.action }}</div>
                              @if (log.error_message) {
                                <div class="text-xs text-red-500 mt-0.5 max-w-[200px] truncate">{{ log.error_message }}</div>
                              }
                            </td>
                            <td class="py-2 px-3 hidden md:table-cell">
                              @if (log.document_number) {
                                <span class="text-text-primary">{{ log.document_type }} {{ log.document_number }}</span>
                              }
                              @if (!log.document_number) {
                                <span class="text-text-secondary">-</span>
                              }
                            </td>
                            <td class="py-2 px-3 text-center">
                              <span class="px-1.5 py-0.5 text-xs rounded-full"
                        [ngClass]="{
                          'bg-green-100 text-green-700': log.status === 'success',
                          'bg-red-100 text-red-700': log.status === 'error',
                          'bg-gray-100 text-gray-600': log.status !== 'success' && log.status !== 'error'
                        }"
                              >{{ log.status }}</span>
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
                  }
                  @if (dashboardData()!.recent_submissions.length === 0) {
                    <div class="py-8 text-center">
                      <app-icon name="bar-chart-2" [size]="32" class="text-gray-400 mx-auto mb-2"></app-icon>
                      <p class="text-text-secondary text-sm">No hay envios registrados</p>
                    </div>
                  }
                </div>
              </div>
            </div>
          }
        </div>
      }
    
      <!-- Loading State -->
      @if (loading()) {
        <div class="flex justify-center py-12">
          <app-spinner size="lg"></app-spinner>
        </div>
      }
    
      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- LIST VIEW                                              -->
      <!-- ═══════════════════════════════════════════════════════ -->
      @if (!loading() && viewMode() === 'list' && !showDashboard()) {
        <div class="space-y-4">
          <!-- Add Button -->
          <div class="flex justify-end">
            <app-button variant="primary" size="sm" (clicked)="startNewConfig()">
              <app-icon slot="icon" name="plus" [size]="14"></app-icon>
              Agregar Configuracion
            </app-button>
          </div>
          <!-- Config Cards -->
          @if (configs().length > 0) {
            <div class="space-y-3">
              @for (cfg of configs(); track cfg) {
                <div
                  class="border border-border rounded-xl p-4 bg-white hover:shadow-sm transition-shadow"
                  >
                  <div class="flex items-start justify-between gap-3">
                    <!-- Left: Info -->
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <h3 class="text-sm font-semibold text-text-primary truncate">{{ cfg.name }}</h3>
                        @if (cfg.is_default) {
                          <span
                            class="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary whitespace-nowrap"
                            >
                            Predeterminada
                          </span>
                        }
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
                      @if (getNextStep(cfg) < 4) {
                        <app-button
                          variant="outline"
                          size="sm"
                          (clicked)="continueConfig(cfg)"
                          title="Continuar configuracion"
                          >
                          <app-icon slot="icon" name="arrow-right" [size]="14"></app-icon>
                          Continuar
                        </app-button>
                      }
                      @if (!cfg.is_default) {
                        <app-button
                          variant="ghost"
                          size="sm"
                          (clicked)="markAsDefault(cfg)"
                          title="Marcar como predeterminada"
                          >
                          <app-icon name="star" [size]="14"></app-icon>
                        </app-button>
                      }
                      <app-button variant="ghost" size="sm" (clicked)="editConfig(cfg)" title="Editar">
                        <app-icon name="pencil" [size]="14"></app-icon>
                      </app-button>
                      <app-button
                        variant="ghost"
                        size="sm"
                        (clicked)="confirmDelete(cfg)"
                        title="Eliminar"
                        [disabled]="deletingId() === cfg.id"
                        >
                        <app-icon name="trash-2" [size]="14" class="text-red-500"></app-icon>
                      </app-button>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
          <!-- Empty State -->
          @if (configs().length === 0) {
            <div class="py-12 text-center border border-dashed border-border rounded-xl">
              <app-icon name="shield" [size]="40" class="text-gray-300 mx-auto mb-3"></app-icon>
              <h3 class="text-sm font-medium text-text-primary mb-1">Sin configuraciones DIAN</h3>
              <p class="text-xs text-text-secondary mb-4">Agregue una configuracion para habilitar la facturacion electronica</p>
              <app-button variant="primary" size="sm" (clicked)="startNewConfig()">
                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                Agregar Primera Configuracion
              </app-button>
            </div>
          }
        </div>
      }
    
      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- DETAIL VIEW (Stepper Wizard)                           -->
      <!-- ═══════════════════════════════════════════════════════ -->
      @if (!loading() && viewMode() === 'detail') {
        <div>
          <!-- Stepper Navigation -->
          <app-steps-line
            [steps]="stepsConfig"
            [currentStep]="activeStep()"
            [clickable]="true"
            size="md"
            (stepClicked)="activeStep.set($event)"
          ></app-steps-line>
          <div class="mt-6">
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
                          <div class="mt-1 text-xs">
                            Expira: {{ selectedConfig()!.certificate_expiry | date:'dd/MM/yyyy' }}
                          </div>
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
                        [control]="certificateForm.get('certificate_password')"
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
                        @for (res of resolutions(); track res) {
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
                    <!-- Navigation buttons -->
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
                          @for (log of auditLogs(); track log) {
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
                                }
                                @if (!log.document_number) {
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
                    }
                    @if (auditLogs().length === 0) {
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
              </div>
            }
          </div>
        </div>
      }
    
    </div>
    `,
})
export class DianConfigComponent {
  private invoicingService = inject(InvoicingService);
  private fb = inject(FormBuilder);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // State
  readonly loading = signal(true);
  readonly configs = signal<DianConfig[]>([]);
  readonly selectedConfig = signal<DianConfig | null>(null);
  readonly viewMode = signal<'list' | 'detail'>('list');
  readonly activeStep = signal(0);
  readonly deletingId = signal<number | null>(null);

  // Dashboard
  readonly showDashboard = signal(false);
  readonly loadingDashboard = signal(false);
  readonly dashboardData = signal<any>(null);

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
  readonly savingCredentials = signal(false);

  // Step 2: Certificate
  certificateForm: FormGroup;
  readonly selectedFile = signal<File | null>(null);
  readonly uploadingCertificate = signal(false);

  // Step 3: Environment
  readonly selectedEnvironment = signal<'test' | 'production'>('test');
  readonly savingEnvironment = signal(false);

  // Step 4: Test Connection
  readonly testingConnection = signal(false);
  readonly runningTestSet = signal(false);
  readonly testResult = signal<DianTestResult | null>(null);
  readonly resolutions = signal<any[]>([]);
  readonly selectedResolutionId = signal<number | null>(null);
  readonly testSetResult = signal<any>(null);

  // Step 5: Audit Logs
  readonly auditLogs = signal<DianAuditLog[]>([]);
  readonly loadingAuditLogs = signal(false);
  readonly auditLogPage = signal(1);

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

    this.loadConfigs();
    this.loadResolutions();
  }

  // ── Data Loading ──────────────────────────────────────────

  loadConfigs(): void {
    this.loading.set(true);
    this.invoicingService.getDianConfigs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.configs.set(response?.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.configs.set([]);
          this.loading.set(false);
        },
      });
  }

  // ── Dashboard ─────────────────────────────────────────────

  toggleDashboard(): void {
    const current = this.showDashboard();
    this.showDashboard.set(!current);
    if (!current && !this.dashboardData()) {
      this.loadDashboard();
    }
  }

  loadDashboard(): void {
    this.loadingDashboard.set(true);
    this.invoicingService.getDianDashboard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.dashboardData.set(response?.data || null);
          this.loadingDashboard.set(false);
        },
        error: () => {
          this.dashboardData.set(null);
          this.loadingDashboard.set(false);
        },
      });
  }

  getCertStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      valid: 'Vigente',
      expiring_soon: 'Proximo a vencer',
      expired: 'Vencido',
      not_configured: 'No configurado',
    };
    return labels[status] || status;
  }

  // ── View Navigation ───────────────────────────────────────

  startNewConfig(): void {
    this.selectedConfig.set(null);
    this.resetForms();
    this.activeStep.set(0);
    this.viewMode.set('detail');
  }

  editConfig(cfg: DianConfig): void {
    this.selectedConfig.set(cfg);
    this.patchCredentialsForm();
    this.selectedEnvironment.set(cfg.environment);
    this.testResult.set(null);
    this.testSetResult.set(null);
    this.activeStep.set(0);
    this.viewMode.set('detail');
  }

  continueConfig(cfg: DianConfig): void {
    this.selectedConfig.set(cfg);
    this.patchCredentialsForm();
    this.selectedEnvironment.set(cfg.environment);
    this.testResult.set(null);
    this.testSetResult.set(null);
    this.activeStep.set(this.getNextStep(cfg));
    this.viewMode.set('detail');
  }

  getNextStep(cfg: DianConfig): number {
    // Step 0: Credentials — always done if config exists
    // Step 1: Certificate — done if certificate_s3_key exists
    if (!cfg.certificate_s3_key) return 1;
    // Step 2: Environment — done if enablement_status moved past not_started
    if (cfg.enablement_status === 'not_started') return 2;
    // Step 3: Test — done if enablement_status is enabled
    if (cfg.enablement_status !== 'enabled') return 3;
    // All done — go to audit logs
    return 4;
  }

  backToList(): void {
    this.viewMode.set('list');
    this.selectedConfig.set(null);
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

    this.deletingId.set(cfg.id);
    this.invoicingService.deleteDianConfig(cfg.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success(`Configuracion "${cfg.name}" eliminada`);
          this.deletingId.set(null);
          this.loadConfigs();
        },
        error: (err: any) => {
          this.deletingId.set(null);
          this.toast.error(err?.error?.message || 'Error al eliminar configuracion');
        },
      });
  }

  // ── Form Helpers ──────────────────────────────────────────

  private resetForms(): void {
    this.credentialsForm.reset({ name: '', nit_type: 'NIT', nit: '', nit_dv: '', software_id: '', software_pin: '', test_set_id: '' });
    this.certificateForm.reset();
    this.selectedFile.set(null);
    this.selectedEnvironment.set('test');
    this.testResult.set(null);
    this.testSetResult.set(null);
    this.selectedResolutionId.set(null);
    this.auditLogs.set([]);
  }

  private patchCredentialsForm(): void {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.credentialsForm.patchValue({
      name: cfg.name,
      nit_type: cfg.nit_type,
      nit: cfg.nit,
      nit_dv: cfg.nit_dv || '',
      software_id: cfg.software_id,
      software_pin: cfg.software_pin_encrypted,
      test_set_id: cfg.test_set_id || '',
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

    this.savingCredentials.set(true);
    const payload = {
      name: this.credentialsForm.value.name,
      nit: this.credentialsForm.value.nit,
      nit_type: this.credentialsForm.value.nit_type,
      nit_dv: this.credentialsForm.value.nit_dv || null,
      software_id: this.credentialsForm.value.software_id,
      software_pin: this.credentialsForm.value.software_pin,
      test_set_id: this.credentialsForm.value.test_set_id || null,
    };

    const cfg = this.selectedConfig();
    const request$ = cfg
      ? this.invoicingService.updateDianConfig(cfg.id, payload)
      : this.invoicingService.createDianConfig(payload);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const saved = response.data || response;
          this.selectedConfig.set(saved);
          this.savingCredentials.set(false);
          this.toast.success(cfg ? 'Credenciales actualizadas' : 'Credenciales guardadas');
          this.activeStep.set(1);
        },
        error: (err: any) => {
          this.savingCredentials.set(false);
          this.toast.error(err?.error?.message || 'Error al guardar credenciales');
        },
      });
  }

  // ── Step 2: Certificate Upload ────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile.set(input.files[0]);
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
        this.selectedFile.set(file);
      } else {
        this.toast.error('Solo se permiten archivos .p12 o .pfx');
      }
    }
  }

  uploadCertificate(): void {
    const file = this.selectedFile();
    const cfg = this.selectedConfig();
    if (!file || !cfg || this.certificateForm.invalid) return;

    this.uploadingCertificate.set(true);
    const password = this.certificateForm.value.certificate_password;

    this.invoicingService.uploadDianCertificate(cfg.id, file, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.selectedConfig.set(response.data || response);
          this.uploadingCertificate.set(false);
          this.selectedFile.set(null);
          this.certificateForm.reset();
          this.toast.success('Certificado subido correctamente');
          this.activeStep.set(2);
        },
        error: (err: any) => {
          this.uploadingCertificate.set(false);
          this.toast.error(err?.error?.message || 'Error al subir certificado');
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

    // If environment hasn't changed, just advance to next step
    if (this.selectedEnvironment() === cfg.environment) {
      this.activeStep.set(3);
      return;
    }

    this.savingEnvironment.set(true);
    this.invoicingService.updateDianConfig(cfg.id, { environment: this.selectedEnvironment() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.selectedConfig.set(response.data || response);
          this.savingEnvironment.set(false);
          this.toast.success('Ambiente actualizado');
          this.activeStep.set(3);
        },
        error: (err: any) => {
          this.savingEnvironment.set(false);
          this.toast.error(err?.error?.message || 'Error al cambiar ambiente');
        },
      });
  }

  // ── Step 4: Test Connection ───────────────────────────────

  loadResolutions(): void {
    this.invoicingService.getResolutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.resolutions.set(response?.data || []);
        },
        error: () => {
          this.resolutions.set([]);
        },
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
          const result = response.data || response;
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
            message: err?.error?.message || 'Error al probar conexion',
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
          const result = response.data || response;
          this.testSetResult.set(result);
          this.runningTestSet.set(false);
          if (result.success) {
            this.toast.success('Set de pruebas enviado exitosamente');
            // Reload config to reflect updated enablement_status
            this.invoicingService.getDianConfigById(cfg.id)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (cfgResponse: any) => {
                  this.selectedConfig.set(cfgResponse.data || cfgResponse);
                },
              });
          }
        },
        error: (err: any) => {
          this.runningTestSet.set(false);
          this.toast.error(err?.error?.message || 'Error al ejecutar set de pruebas');
        },
      });
  }

  // ── Step 5: Audit Logs ────────────────────────────────────

  loadAuditLogs(): void {
    this.loadingAuditLogs.set(true);
    const config_id = this.selectedConfig()?.id;
    this.invoicingService.getDianAuditLogs(this.auditLogPage(), 20, config_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.auditLogs.set(response.data || []);
          this.loadingAuditLogs.set(false);
        },
        error: () => {
          this.loadingAuditLogs.set(false);
        },
      });
  }

  prevAuditPage(): void {
    if (this.auditLogPage() > 1) {
      this.auditLogPage.update(p => p - 1);
      this.loadAuditLogs();
    }
  }

  nextAuditPage(): void {
    this.auditLogPage.update(p => p + 1);
    this.loadAuditLogs();
  }
}
