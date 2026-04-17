import {
  Component,
  input,
  output,
  inject,
  effect,
  DestroyRef,
  signal,
  computed,
} from '@angular/core';
import { CurrencyPipe, NgClass } from '@angular/common';
import { PayrollService } from '../../../services/payroll.service';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../../shared/components';
import { SpinnerComponent } from '../../../../../../../shared/components/spinner/spinner.component';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../../shared/components/steps-line/steps-line.component';
import {
  BulkEmployeeAnalysisResult,
  BulkEmployeeUploadResult,
} from '../../../interfaces/bulk-employee-analysis.interface';

@Component({
  selector: 'app-employee-bulk-upload-modal',
  standalone: true,
  imports: [
    CurrencyPipe,
    NgClass,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
    SpinnerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Carga Masiva de Empleados"
      (closed)="onCancel()"
      subtitle="Importa múltiples empleados desde un archivo Excel o CSV"
    >
      <!-- INTRO SCREEN -->
      @if (showingIntro) {
        <div class="space-y-3">
          <!-- Header -->
          <div class="text-center">
            <div
              class="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full mb-2"
            >
              <app-icon
                name="users"
                [size]="24"
                class="text-primary"
              ></app-icon>
            </div>
            <h3 class="text-base font-semibold text-gray-900">
              Carga masiva de empleados
            </h3>
            <p class="text-xs text-gray-500 mt-0.5">
              Importa empleados de una sola vez
            </p>
          </div>

          <!-- Step-by-step guide -->
          <div class="space-y-2">
            <div
              class="flex items-start gap-2.5 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100"
            >
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0"
              >
                1
              </div>
              <div>
                <p class="text-xs font-medium text-blue-900">
                  Descarga la plantilla
                </p>
                <p class="text-[11px] text-blue-700">
                  Excel con columnas pre-configuradas para tus empleados.
                </p>
              </div>
            </div>
            <div
              class="flex items-start gap-2.5 px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-100"
            >
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold shrink-0"
              >
                2
              </div>
              <div>
                <p class="text-xs font-medium text-indigo-900">
                  Completa los datos
                </p>
                <p class="text-[11px] text-indigo-700">
                  Nombre, Documento, Salario, Cargo, Tipo de Contrato y más.
                </p>
              </div>
            </div>
            <div
              class="flex items-start gap-2.5 px-3 py-2 bg-violet-50 rounded-lg border border-violet-100"
            >
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-violet-600 text-white text-[10px] font-bold shrink-0"
              >
                3
              </div>
              <div>
                <p class="text-xs font-medium text-violet-900">
                  Sube el archivo
                </p>
                <p class="text-[11px] text-violet-700">
                  Excel (.xlsx, .xls) o CSV. Máx. 1000 empleados por archivo.
                </p>
              </div>
            </div>
            <div
              class="flex items-start gap-2.5 px-3 py-2 bg-green-50 rounded-lg border border-green-100"
            >
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-[10px] font-bold shrink-0"
              >
                4
              </div>
              <div>
                <p class="text-xs font-medium text-green-900">
                  Revisa y confirma
                </p>
                <p class="text-[11px] text-green-700">
                  Análisis empleado por empleado antes de confirmar la carga.
                </p>
              </div>
            </div>
          </div>

          <!-- Excel structure visual -->
          <div class="bg-gray-50 border rounded-lg px-3 py-2">
            <p class="text-[11px] font-medium text-gray-700 mb-1">
              Ejemplo de Excel:
            </p>
            <div class="overflow-x-auto">
              <table class="text-[10px] text-gray-500 font-mono">
                <thead>
                  <tr class="border-b border-gray-200">
                    <th class="px-2 py-0.5 text-left text-gray-600">Nombre</th>
                    <th class="px-2 py-0.5 text-left text-gray-600">
                      Documento
                    </th>
                    <th class="px-2 py-0.5 text-right text-gray-600">
                      Salario
                    </th>
                    <th class="px-2 py-0.5 text-left text-gray-600">Cargo</th>
                    <th class="px-2 py-0.5 text-left text-gray-600">
                      Tipo Contrato
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="px-2 py-0.5">Juan Pérez</td>
                    <td class="px-2 py-0.5">CC 12345678</td>
                    <td class="px-2 py-0.5 text-right">2500000</td>
                    <td class="px-2 py-0.5">Vendedor</td>
                    <td class="px-2 py-0.5">Término Indefinido</td>
                  </tr>
                  <tr>
                    <td class="px-2 py-0.5">María Gómez</td>
                    <td class="px-2 py-0.5">CC 87654321</td>
                    <td class="px-2 py-0.5 text-right">3200000</td>
                    <td class="px-2 py-0.5">Gerente</td>
                    <td class="px-2 py-0.5">Término Indefinido</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Auto-advance + don't show again -->
          <div
            class="flex items-center justify-between pt-1.5 border-t border-gray-100"
          >
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                [checked]="dontShowIntroAgain"
                (change)="toggleDontShowAgain()"
                class="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span class="text-[11px] text-gray-500">No volver a mostrar</span>
            </label>
            <div class="flex items-center gap-1.5">
              <div class="w-16 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary rounded-full transition-all duration-100"
                  [style.width.%]="introProgress"
                ></div>
              </div>
              <span class="text-[10px] text-gray-400"
                >{{ introCountdown }}s</span
              >
            </div>
          </div>
        </div>
      }

      <!-- WIZARD -->
      @if (!showingIntro) {
        <!-- Steps Line -->
        <div class="mb-4">
          <app-steps-line
            [steps]="steps"
            [currentStep]="currentStep"
            size="sm"
          ></app-steps-line>
        </div>

        <!-- STEP 0: Preparar -->
        @if (currentStep === 0) {
          <div class="space-y-3">
            <!-- Compact hint -->
            <div
              class="bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 flex items-start gap-2"
            >
              <app-icon
                name="info"
                [size]="14"
                class="text-blue-600 shrink-0 mt-0.5"
              ></app-icon>
              <p class="text-[11px] text-blue-800 leading-relaxed">
                <span class="font-medium">Descarga la plantilla</span>, completa
                los datos de tus empleados y sube el archivo. Formatos: .xlsx,
                .xls, .csv · Máx. 1000 empleados.
              </p>
            </div>

            <!-- Template Download (single card) -->
            <div>
              <p class="text-xs font-medium text-gray-700 mb-2">
                1. Descarga la plantilla
              </p>
              <div
                class="border border-indigo-200 hover:border-indigo-500 bg-indigo-50 rounded-lg px-3 py-2.5 cursor-pointer transition-all group flex items-center gap-3"
                (click)="downloadTemplate()"
              >
                <div
                  class="p-1.5 bg-indigo-100 rounded-full text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0"
                >
                  <app-icon name="users" [size]="16"></app-icon>
                </div>
                <div class="min-w-0">
                  <p class="font-semibold text-indigo-900 text-xs">
                    Plantilla de Empleados
                  </p>
                  <p class="text-[10px] text-indigo-600 truncate">
                    Nombre, Documento, Salario, Cargo, Tipo de Contrato, Banco,
                    EPS y más
                  </p>
                  <div
                    class="flex items-center text-[10px] font-bold text-indigo-600 group-hover:text-indigo-800 mt-1"
                  >
                    <app-icon
                      name="download"
                      [size]="12"
                      class="mr-1"
                    ></app-icon>
                    DESCARGAR EXCEL
                  </div>
                </div>
              </div>
            </div>

            <!-- File Upload -->
            <div>
              <p class="text-xs font-medium text-gray-700 mb-2">
                2. Sube tu archivo
              </p>
              <div
                class="border-2 border-dashed border-gray-300 rounded-lg p-5 text-center hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer"
                (dragover)="onDragOver($event)"
                (dragleave)="onDragLeave($event)"
                (drop)="onDrop($event)"
                (click)="fileInput.click()"
                [class.border-blue-500]="isDragging"
                [class.bg-blue-50]="isDragging"
              >
                <input
                  #fileInput
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  class="hidden"
                  (change)="onFileSelected($event)"
                />

                @if (!selectedFile) {
                  <app-icon
                    name="upload-cloud"
                    [size]="36"
                    class="mx-auto text-gray-400 mb-2"
                    [class.text-blue-500]="isDragging"
                  ></app-icon>
                  <p class="text-sm text-gray-900 font-medium">
                    Arrastra tu archivo Excel aquí
                  </p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    o haz clic para seleccionar · .xlsx, .xls, .csv · Máximo 5
                    MB
                  </p>
                }

                @if (selectedFile) {
                  <app-icon
                    name="file-spreadsheet"
                    [size]="36"
                    class="mx-auto text-green-500 mb-2"
                  ></app-icon>
                  <p class="text-sm text-gray-900 font-medium">
                    {{ selectedFile.name }}
                  </p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    {{ formatFileSize(selectedFile.size) }}
                  </p>
                }
              </div>

              @if (selectedFile) {
                <div class="flex justify-end mt-2">
                  <button
                    class="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
                    (click)="removeFile()"
                  >
                    <app-icon name="x" [size]="12"></app-icon>
                    Quitar archivo
                  </button>
                </div>
              }
            </div>

            <!-- Upload Error -->
            @if (uploadError) {
              <div
                class="bg-red-50 px-3 py-2 rounded-lg border border-red-100 text-red-700 text-xs flex items-start gap-2"
              >
                <app-icon
                  name="alert-circle"
                  [size]="14"
                  class="shrink-0 mt-0.5"
                ></app-icon>
                <p>{{ uploadError }}</p>
              </div>
            }
          </div>
        }

        <!-- STEP 1: Revisar -->
        @if (currentStep === 1) {
          <div class="space-y-3">
            <!-- Loading state -->
            @if (isAnalyzing) {
              <div class="py-8 flex flex-col items-center justify-center">
                <app-spinner
                  size="lg"
                  [center]="true"
                  class="mb-3"
                ></app-spinner>
                <p class="text-sm text-gray-900 font-medium">
                  Analizando archivo...
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  Verificando empleados, documentos y datos
                </p>
              </div>
            }

            <!-- Analysis results -->
            @if (analysisResult && !isAnalyzing) {
              <!-- Summary stats cards -->
              <div
                class="flex overflow-x-auto gap-2 pb-1 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible"
              >
                <div
                  class="min-w-[100px] bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 shrink-0"
                >
                  <div class="text-[10px] text-blue-600 font-medium">
                    Total Empleados
                  </div>
                  <div class="text-xl font-bold text-blue-700">
                    {{ analysisResult!.total_employees }}
                  </div>
                </div>
                <div
                  class="min-w-[100px] bg-green-50 px-3 py-2 rounded-lg border border-green-100 shrink-0"
                >
                  <div class="text-[10px] text-green-600 font-medium">
                    Listos
                  </div>
                  <div class="text-xl font-bold text-green-700">
                    {{ analysisResult!.ready }}
                  </div>
                </div>
                <div
                  class="min-w-[100px] bg-amber-50 px-3 py-2 rounded-lg border border-amber-100 shrink-0"
                >
                  <div class="text-[10px] text-amber-600 font-medium">
                    Advertencias
                  </div>
                  <div class="text-xl font-bold text-amber-700">
                    {{ analysisResult!.with_warnings }}
                  </div>
                </div>
                <div
                  class="min-w-[100px] bg-red-50 px-3 py-2 rounded-lg border border-red-100 shrink-0"
                >
                  <div class="text-[10px] text-red-600 font-medium">
                    Errores
                  </div>
                  <div class="text-xl font-bold text-red-700">
                    {{ analysisResult!.with_errors }}
                  </div>
                </div>
              </div>

              <!-- Detail table (desktop) -->
              <div
                class="hidden md:block border rounded-lg overflow-hidden mt-3"
              >
                <div class="max-h-52 overflow-y-auto">
                  <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50 sticky top-0">
                      <tr>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Nombre
                        </th>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Documento
                        </th>
                        <th
                          class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase"
                        >
                          Salario
                        </th>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Tipo Contrato
                        </th>
                        <th
                          class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase"
                        >
                          Acción
                        </th>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Estado
                        </th>
                      </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                      @for (
                        item of analysisResult!.employees;
                        track item.row_number
                      ) {
                        <tr>
                          <td
                            class="px-3 py-2 text-sm text-gray-900 max-w-[180px] truncate"
                          >
                            {{ item.name }} {{ item.last_name }}
                          </td>
                          <td
                            class="px-3 py-2 text-sm font-mono text-xs text-gray-600"
                          >
                            {{ item.document_type }} {{ item.document_number }}
                          </td>
                          <td
                            class="px-3 py-2 text-sm text-right text-gray-700"
                          >
                            {{
                              item.base_salary
                                | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                            }}
                          </td>
                          <td class="px-3 py-2 text-sm text-gray-600">
                            {{ item.contract_type || '—' }}
                          </td>
                          <td class="px-3 py-2 text-sm text-center">
                            <span
                              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [ngClass]="{
                                'bg-emerald-100 text-emerald-800':
                                  item.action === 'create',
                                'bg-sky-100 text-sky-800':
                                  item.action === 'update',
                                'bg-blue-100 text-blue-800':
                                  item.action === 'associate',
                              }"
                            >
                              {{
                                item.action === 'create'
                                  ? 'Crear'
                                  : item.action === 'update'
                                    ? 'Actualizar'
                                    : 'Vincular'
                              }}
                            </span>
                          </td>
                          <td class="px-3 py-2 text-sm">
                            <span
                              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [ngClass]="{
                                'bg-green-100 text-green-800':
                                  item.status === 'ready',
                                'bg-amber-100 text-amber-800':
                                  item.status === 'warning',
                                'bg-red-100 text-red-800':
                                  item.status === 'error',
                              }"
                            >
                              {{
                                item.status === 'ready'
                                  ? 'Listo'
                                  : item.status === 'warning'
                                    ? 'Advertencia'
                                    : 'Error'
                              }}
                            </span>
                          </td>
                        </tr>
                        <!-- Warnings/Errors expandable row -->
                        @if (
                          item.warnings.length > 0 || item.errors.length > 0
                        ) {
                          <tr class="bg-gray-50">
                            <td colspan="6" class="px-3 py-2">
                              @for (warning of item.warnings; track warning) {
                                <p
                                  class="text-xs text-amber-700 flex items-start gap-1"
                                >
                                  <app-icon
                                    name="alert-triangle"
                                    [size]="12"
                                    class="shrink-0 mt-0.5"
                                  ></app-icon>
                                  {{ warning }}
                                </p>
                              }
                              @for (error of item.errors; track error) {
                                <p
                                  class="text-xs text-red-700 flex items-start gap-1"
                                >
                                  <app-icon
                                    name="x-circle"
                                    [size]="12"
                                    class="shrink-0 mt-0.5"
                                  ></app-icon>
                                  {{ error }}
                                </p>
                              }
                            </td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Mobile cards -->
              <div
                class="block md:hidden space-y-2 mt-3 max-h-52 overflow-y-auto"
              >
                @for (
                  item of analysisResult!.employees;
                  track item.row_number
                ) {
                  <div class="border rounded-lg p-3 bg-white">
                    <div class="flex items-center justify-between mb-2">
                      <span
                        class="text-sm font-medium text-gray-900 truncate mr-2"
                        >{{ item.name }} {{ item.last_name }}</span
                      >
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
                        [ngClass]="{
                          'bg-green-100 text-green-800':
                            item.status === 'ready',
                          'bg-amber-100 text-amber-800':
                            item.status === 'warning',
                          'bg-red-100 text-red-800': item.status === 'error',
                        }"
                      >
                        {{
                          item.status === 'ready'
                            ? 'Listo'
                            : item.status === 'warning'
                              ? 'Advertencia'
                              : 'Error'
                        }}
                      </span>
                    </div>
                    <p class="text-xs text-gray-500 font-mono mb-2">
                      {{ item.document_type }} {{ item.document_number }}
                    </p>
                    <div class="flex gap-3 text-xs text-gray-600 mb-1">
                      <span>{{
                        item.base_salary
                          | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                      }}</span>
                      <span
                        class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                        [ngClass]="{
                          'bg-emerald-100 text-emerald-700':
                            item.action === 'create',
                          'bg-sky-100 text-sky-700': item.action === 'update',
                          'bg-blue-100 text-blue-700':
                            item.action === 'associate',
                        }"
                      >
                        {{
                          item.action === 'create'
                            ? 'Crear'
                            : item.action === 'update'
                              ? 'Actualizar'
                              : 'Vincular'
                        }}
                      </span>
                    </div>
                    @if (item.warnings.length > 0 || item.errors.length > 0) {
                      <div class="mt-2 pt-2 border-t border-gray-100 space-y-1">
                        @for (warning of item.warnings; track warning) {
                          <p
                            class="text-[11px] text-amber-700 flex items-start gap-1"
                          >
                            <span class="shrink-0">&#9888;</span> {{ warning }}
                          </p>
                        }
                        @for (error of item.errors; track error) {
                          <p
                            class="text-[11px] text-red-700 flex items-start gap-1"
                          >
                            <span class="shrink-0">&#10007;</span> {{ error }}
                          </p>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- STEP 2: Resultados -->
        @if (currentStep === 2) {
          <div class="space-y-3">
            <!-- Loading state -->
            @if (isUploading) {
              <div class="py-8 flex flex-col items-center justify-center">
                <app-spinner
                  size="lg"
                  [center]="true"
                  class="mb-3"
                ></app-spinner>
                <p class="text-sm text-gray-900 font-medium">
                  Cargando empleados...
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  Esto puede tomar unos momentos
                </p>
              </div>
            }

            <!-- Upload Error -->
            @if (uploadError && !isUploading) {
              <div
                class="bg-red-50 px-3 py-2 rounded-lg border border-red-100 text-red-700 text-xs flex items-start gap-2"
              >
                <app-icon
                  name="alert-circle"
                  [size]="14"
                  class="shrink-0 mt-0.5"
                ></app-icon>
                <p>{{ uploadError }}</p>
              </div>
            }

            <!-- Results -->
            @if (uploadResults && !isUploading) {
              <!-- Summary -->
              <div class="bg-white border rounded-lg overflow-hidden">
                <div
                  class="bg-gray-50 px-3 py-2 border-b flex justify-between items-center"
                >
                  <h4 class="text-sm font-medium text-gray-900">
                    Resumen de Carga
                  </h4>
                  <span class="text-xs text-gray-500"
                    >{{ uploadResults.total_processed || 0 }} empleados</span
                  >
                </div>
                <div class="p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div
                    class="bg-green-50 px-3 py-2 rounded border border-green-100"
                  >
                    <div class="text-[10px] text-green-600 font-medium">
                      Exitosos
                    </div>
                    <div class="text-xl font-bold text-green-700">
                      {{ uploadResults.successful || 0 }}
                    </div>
                  </div>
                  <div
                    class="bg-red-50 px-3 py-2 rounded border border-red-100"
                  >
                    <div class="text-[10px] text-red-600 font-medium">
                      Fallidos
                    </div>
                    <div class="text-xl font-bold text-red-700">
                      {{ uploadResults.failed || 0 }}
                    </div>
                  </div>
                  <div
                    class="bg-blue-50 px-3 py-2 rounded border border-blue-100"
                  >
                    <div class="text-[10px] text-blue-600 font-medium">
                      Usuarios Creados
                    </div>
                    <div class="text-xl font-bold text-blue-700">
                      {{ uploadResults.users_created || 0 }}
                    </div>
                  </div>
                  <div
                    class="bg-purple-50 px-3 py-2 rounded border border-purple-100"
                  >
                    <div class="text-[10px] text-purple-600 font-medium">
                      Usuarios Vinculados
                    </div>
                    <div class="text-xl font-bold text-purple-700">
                      {{ uploadResults.users_linked || 0 }}
                    </div>
                  </div>
                  @if (uploadResults.updated) {
                    <div
                      class="bg-sky-50 px-3 py-2 rounded border border-sky-100"
                    >
                      <div class="text-[10px] text-sky-600 font-medium">
                        Actualizados
                      </div>
                      <div class="text-xl font-bold text-sky-700">
                        {{ uploadResults.updated }}
                      </div>
                    </div>
                  }
                  @if (uploadResults.associated) {
                    <div
                      class="bg-indigo-50 px-3 py-2 rounded border border-indigo-100"
                    >
                      <div class="text-[10px] text-indigo-600 font-medium">
                        Vinculados
                      </div>
                      <div class="text-xl font-bold text-indigo-700">
                        {{ uploadResults.associated }}
                      </div>
                    </div>
                  }
                </div>
              </div>

              <!-- Detail Table -->
              <div class="border rounded-lg overflow-hidden">
                <div
                  class="bg-gray-50 px-3 py-2 border-b text-gray-800 font-medium text-xs flex items-center"
                >
                  <app-icon name="list" [size]="14" class="mr-1.5"></app-icon>
                  Detalle por Empleado
                </div>
                <div class="max-h-48 overflow-y-auto bg-white">
                  <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                      <tr>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Empleado
                        </th>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Documento
                        </th>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Estado
                        </th>
                        <th
                          class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          Detalle
                        </th>
                      </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                      @for (result of uploadResults.results; track $index) {
                        <tr>
                          <td
                            class="px-3 py-2 text-sm text-gray-900 max-w-[150px] truncate"
                          >
                            {{
                              result.employee_name ||
                                result.employee?.name ||
                                '—'
                            }}
                          </td>
                          <td
                            class="px-3 py-2 whitespace-nowrap text-sm font-mono text-xs text-gray-600"
                          >
                            {{ result.document_number || '—' }}
                          </td>
                          <td class="px-3 py-2 whitespace-nowrap text-sm">
                            <span
                              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [ngClass]="{
                                'bg-green-100 text-green-800':
                                  result.status === 'success',
                                'bg-red-100 text-red-800':
                                  result.status === 'error',
                              }"
                            >
                              {{
                                result.status === 'success'
                                  ? 'Exitoso'
                                  : 'Error'
                              }}
                            </span>
                          </td>
                          <td class="px-3 py-2 text-sm text-gray-600">
                            {{ result.message }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
          </div>
        }
      }
      <!-- end @if (!showingIntro) -->

      <!-- Footer -->
      <div
        slot="footer"
        class="flex justify-end gap-2 pt-4 border-t border-gray-200 mt-4"
      >
        @if (showingIntro) {
          <app-button variant="outline" (clicked)="onCancel()"
            >Cancelar</app-button
          >
          <app-button variant="primary" (clicked)="skipIntro()">
            Continuar
            <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
          </app-button>
        }
        <!-- Step 0 -->
        @if (!showingIntro && currentStep === 0) {
          <app-button variant="outline" (clicked)="onCancel()"
            >Cancelar</app-button
          >
          @if (selectedFile) {
            <app-button
              variant="primary"
              (clicked)="analyzeFile()"
              [disabled]="isAnalyzing"
            >
              <app-icon name="search" [size]="16" slot="icon"></app-icon>
              Analizar Archivo
            </app-button>
          }
        }
        <!-- Step 1 -->
        @if (!showingIntro && currentStep === 1 && !isAnalyzing) {
          <app-button variant="outline" (clicked)="prevStep()"
            >Atrás</app-button
          >
          <app-button variant="outline" (clicked)="onCancel()"
            >Cancelar</app-button
          >
          @if (analysisResult && canProceed) {
            <app-button variant="primary" (clicked)="proceedWithUpload()">
              <app-icon name="upload" [size]="16" slot="icon"></app-icon>
              Cargar {{ loadableCount }} Empleados
            </app-button>
          }
        }
        <!-- Step 2 -->
        @if (!showingIntro && currentStep === 2 && !isUploading) {
          <app-button variant="outline" (clicked)="onCancel()"
            >Cerrar</app-button
          >
        }
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class EmployeeBulkUploadModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly uploadComplete = output<void>();

  private static readonly INTRO_CACHE_KEY =
    'vendix_bulk_employee_intro_dismissed';
  private static readonly INTRO_DURATION = 20000;
  private static readonly INTRO_TICK = 100;

  // Intro state
  readonly showingIntro = signal(false);
  readonly dontShowIntroAgain = signal(false);
  readonly introProgress = signal(0);
  readonly introCountdown = signal(20);
  private introTimerId: ReturnType<typeof setInterval> | null = null;
  private introElapsed = 0;

  // Wizard state
  readonly steps: StepsLineItem[] = [
    { label: 'Preparar' },
    { label: 'Revisar' },
    { label: 'Resultados' },
  ];
  readonly currentStep = signal(0);

  // File state
  readonly selectedFile = signal<File | null>(null);
  readonly isDragging = signal(false);

  // Analysis state
  readonly isAnalyzing = signal(false);
  readonly analysisResult = signal<BulkEmployeeAnalysisResult | null>(null);
  readonly sessionId = signal<string | null>(null);

  // Upload state
  readonly isUploading = signal(false);
  readonly uploadResults = signal<BulkEmployeeUploadResult | null>(null);

  // Error state
  readonly uploadError = signal<string | null>(null);

  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // Computed properties
  readonly canProceed = computed(() => {
    const r = this.analysisResult();
    if (!r) return false;
    return r.ready > 0 || r.with_warnings > 0;
  });

  readonly loadableCount = computed(() => {
    const r = this.analysisResult();
    if (!r) return 0;
    return r.employees.filter((e) => e.status !== 'error').length;
  });

  // Lifecycle
  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.onModalOpen();
      } else {
        this.clearIntroTimer();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.clearIntroTimer();
    });
  }

  // Intro logic
  private onModalOpen() {
    const dismissed = localStorage.getItem(
      EmployeeBulkUploadModalComponent.INTRO_CACHE_KEY,
    );
    if (dismissed === 'true') {
      this.showingIntro.set(false);
      return;
    }
    this.showingIntro.set(true);
    this.introElapsed = 0;
    this.introProgress.set(0);
    this.introCountdown.set(Math.ceil(
      EmployeeBulkUploadModalComponent.INTRO_DURATION / 1000,
    );
    this.startIntroTimer();
  }

  private startIntroTimer() {
    this.clearIntroTimer();
    this.introTimerId = setInterval(() => {
      this.introElapsed += EmployeeBulkUploadModalComponent.INTRO_TICK;
      this.introProgress = Math.min(
        100,
        (this.introElapsed / EmployeeBulkUploadModalComponent.INTRO_DURATION) *
          100,
      );
      this.introCountdown = Math.max(
        0,
        Math.ceil(
          (EmployeeBulkUploadModalComponent.INTRO_DURATION -
            this.introElapsed) /
            1000,
        ),
      );

      if (
        this.introElapsed >= EmployeeBulkUploadModalComponent.INTRO_DURATION
      ) {
        this.skipIntro();
      }
    }, EmployeeBulkUploadModalComponent.INTRO_TICK);
  }

  private clearIntroTimer() {
    if (this.introTimerId) {
      clearInterval(this.introTimerId);
      this.introTimerId = null;
    }
  }

  skipIntro() {
    this.clearIntroTimer();
    if (this.dontShowIntroAgain) {
      localStorage.setItem(
        EmployeeBulkUploadModalComponent.INTRO_CACHE_KEY,
        'true',
      );
    }
    this.showingIntro.set(false);
  }

  toggleDontShowAgain() {
    this.dontShowIntroAgain.set(!this.dontShowIntroAgain());
  }

  // Navigation
  prevStep() {
    if (this.currentStep > 0) {
      this.currentStep.update(v => v - 1);
    }
  }

  // Cancel/Close
  onCancel() {
    if (this.sessionId() && !this.uploadResults()) {
      this.payrollService.cancelBulkEmployeeSession(this.sessionId()!).subscribe();
    }
    if ((this.uploadResults()?.successful ?? 0) > 0) {
      this.uploadComplete.emit();
    }
    this.isOpenChange.emit(false);
    this.resetState();
  }

  resetState() {
    this.clearIntroTimer();
    this.showingIntro.set(false);
    this.introProgress = 0;
    this.introElapsed = 0;
    this.currentStep.set(0);
    this.selectedFile.set(null);
    this.isDragging.set(false);
    this.isAnalyzing.set(false);
    this.analysisResult = null;
    this.sessionId = null;
    this.isUploading.set(false);
    this.uploadResults.set(null);
    this.uploadError.set(null);
  }

  // Step 0: File operations
  downloadTemplate() {
    this.payrollService.getBulkEmployeeTemplate().subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plantilla-empleados.xlsx`;
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.toastService.error('Error al descargar la plantilla');
      },
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.validateAndSetFile(files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.validateAndSetFile(input.files[0]);
    }
  }

  removeFile() {
    this.selectedFile.set(null);
    this.uploadError.set(null);
  }

  private validateAndSetFile(file: File) {
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      this.toastService.error(
        'Por favor selecciona un archivo válido (.xlsx, .xls o .csv)',
      );
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.toastService.error('El archivo excede el límite de 5 MB');
      return;
    }

    this.selectedFile = file;
    this.uploadError.set(null);
  }

  // Step 0 -> 1: Analyze
  analyzeFile() {
    if (!this.selectedFile) return;

    this.isAnalyzing.set(true);
    this.uploadError.set(null);
    this.currentStep.set(1);

    this.payrollService.analyzeBulkEmployees(this.selectedFile).subscribe({
      next: (result) => {
        this.isAnalyzing.set(false);
        this.analysisResult.set(result);
        this.sessionId.set(result.session_id);

        if (result.with_errors > 0) {
          this.toastService.warning(
            `${result.with_errors} empleado(s) con errores detectados`,
          );
        }
      },
      error: (error) => {
        this.isAnalyzing.set(false);
        this.currentStep.set(0);
        this.uploadError =
          typeof error === 'string' ? error : parseApiError(error).userMessage;
        this.toastService.error('Error al analizar el archivo');
      },
    });
  }

  // Step 1 -> 2: Upload
  proceedWithUpload() {
    if (!this.sessionId) return;

    this.isUploading.set(true);
    this.currentStep.set(2);

    this.payrollService
      .uploadBulkEmployeesFromSession(this.sessionId)
      .subscribe({
        next: (result) => {
          this.isUploading.set(false);
          this.uploadResults.set(result);

          if (result.failed > 0) {
            this.toastService.warning(
              'La carga se completó con algunos errores.',
            );
          } else {
            this.toastService.success(
              `${result.successful} empleado(s) cargados exitosamente`,
            );
          }
        },
        error: (error) => {
          this.isUploading.set(false);
          this.uploadError =
            typeof error === 'string'
              ? error
              : parseApiError(error).userMessage;
          this.toastService.error('Error en la carga masiva de empleados');
        },
      });
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
