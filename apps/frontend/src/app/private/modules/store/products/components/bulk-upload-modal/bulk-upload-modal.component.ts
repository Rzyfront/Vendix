import {Component, inject, input, output, effect, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass, CurrencyPipe } from '@angular/common';
import { ProductsService } from '../../services/products.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../shared/components/steps-line/steps-line.component';
import {
  BulkProductAnalysisResult,
  BulkProductUploadResult,
} from '../../interfaces/bulk-product-analysis.interface';

@Component({
  selector: 'app-bulk-upload-modal',
  standalone: true,
  imports: [NgClass, CurrencyPipe, ModalComponent, ButtonComponent, IconComponent, StepsLineComponent, SpinnerComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Carga Masiva de Productos"
      (closed)="onCancel()"
      subtitle="Importa múltiples productos desde un archivo Excel o CSV"
    >
      <!-- INTRO SCREEN -->
      @if (showingIntro) {
        <div class="space-y-3">
          <!-- Header -->
          <div class="text-center">
            <div class="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full mb-2">
              <app-icon name="package" [size]="24" class="text-primary"></app-icon>
            </div>
            <h3 class="text-base font-semibold text-gray-900">Carga masiva de productos</h3>
            <p class="text-xs text-gray-500 mt-0.5">Importa productos y servicios de una sola vez</p>
          </div>

          <!-- Step-by-step guide -->
          <div class="space-y-2">
            <div class="flex items-start gap-2.5 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">1</div>
              <div>
                <p class="text-xs font-medium text-blue-900">Descarga la plantilla</p>
                <p class="text-[11px] text-blue-700">Excel con columnas pre-configuradas para tus productos.</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold shrink-0">2</div>
              <div>
                <p class="text-xs font-medium text-indigo-900">Completa los datos</p>
                <p class="text-[11px] text-indigo-700">Nombre, SKU, Precio, Costo, Stock y más. Rápida o Completa.</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 px-3 py-2 bg-violet-50 rounded-lg border border-violet-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-violet-600 text-white text-[10px] font-bold shrink-0">3</div>
              <div>
                <p class="text-xs font-medium text-violet-900">Sube el archivo</p>
                <p class="text-[11px] text-violet-700">Excel (.xlsx, .xls) o CSV. Máx. 1000 productos por archivo.</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 px-3 py-2 bg-green-50 rounded-lg border border-green-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-[10px] font-bold shrink-0">4</div>
              <div>
                <p class="text-xs font-medium text-green-900">Revisa y confirma</p>
                <p class="text-[11px] text-green-700">Análisis producto por producto antes de confirmar la carga.</p>
              </div>
            </div>
          </div>

          <!-- Excel structure visual -->
          <div class="bg-gray-50 border rounded-lg px-3 py-2">
            <p class="text-[11px] font-medium text-gray-700 mb-1">Ejemplo de Excel:</p>
            <div class="overflow-x-auto">
              <table class="text-[10px] text-gray-500 font-mono">
                <thead>
                  <tr class="border-b border-gray-200">
                    <th class="px-2 py-0.5 text-left text-gray-600">Nombre</th>
                    <th class="px-2 py-0.5 text-left text-gray-600">SKU</th>
                    <th class="px-2 py-0.5 text-left text-gray-600">Tipo</th>
                    <th class="px-2 py-0.5 text-right text-gray-600">Precio Venta</th>
                    <th class="px-2 py-0.5 text-right text-gray-600">Precio Compra</th>
                    <th class="px-2 py-0.5 text-right text-gray-600">Cantidad Inicial</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td class="px-2 py-0.5">Camiseta Básica Blanca</td><td class="px-2 py-0.5">CAM-BAS-BLA-001</td><td class="px-2 py-0.5">Producto</td><td class="px-2 py-0.5 text-right">15000</td><td class="px-2 py-0.5 text-right">8000</td><td class="px-2 py-0.5 text-right">50</td></tr>
                  <tr><td class="px-2 py-0.5">Pantalón Jean Clásico</td><td class="px-2 py-0.5">PAN-JEA-CLA-032</td><td class="px-2 py-0.5">Producto</td><td class="px-2 py-0.5 text-right">45000</td><td class="px-2 py-0.5 text-right">22000</td><td class="px-2 py-0.5 text-right">30</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Auto-advance + don't show again -->
          <div class="flex items-center justify-between pt-1.5 border-t border-gray-100">
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
              <span class="text-[10px] text-gray-400">{{ introCountdown }}s</span>
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
            <div class="bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 flex items-start gap-2">
              <app-icon name="info" [size]="14" class="text-blue-600 shrink-0 mt-0.5"></app-icon>
              <p class="text-[11px] text-blue-800 leading-relaxed">
                <span class="font-medium">Descarga la plantilla</span>, completa los datos de tus productos y sube el archivo.
                Formatos: .xlsx, .xls, .csv · Máx. 1000 productos.
              </p>
            </div>

            <!-- Template Downloads -->
            <div>
              <p class="text-xs font-medium text-gray-700 mb-2">1. Descarga una plantilla</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div
                  class="border border-indigo-200 hover:border-indigo-500 bg-indigo-50 rounded-lg px-3 py-2.5 cursor-pointer transition-all group flex items-center gap-3"
                  (click)="downloadTemplate('quick')"
                >
                  <div class="p-1.5 bg-indigo-100 rounded-full text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                    <app-icon name="check-circle" [size]="16"></app-icon>
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-indigo-900 text-xs">Plantilla Rápida</p>
                    <p class="text-[10px] text-indigo-600 truncate">Solo campos indispensables: Nombre, SKU, Tipo, Precio Venta, Precio Compra y Cantidad Inicial</p>
                    <div class="flex items-center text-[10px] font-bold text-indigo-600 group-hover:text-indigo-800 mt-1">
                      <app-icon name="download" [size]="12" class="mr-1"></app-icon>
                      DESCARGAR EXCEL
                    </div>
                  </div>
                </div>
                <div
                  class="border border-green-200 hover:border-green-500 bg-green-50 rounded-lg px-3 py-2.5 cursor-pointer transition-all group flex items-center gap-3"
                  (click)="downloadTemplate('complete')"
                >
                  <div class="p-1.5 bg-green-100 rounded-full text-green-600 group-hover:bg-green-600 group-hover:text-white transition-colors shrink-0">
                    <app-icon name="file-text" [size]="16"></app-icon>
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-green-900 text-xs">Plantilla Completa</p>
                    <p class="text-[10px] text-green-600 truncate">Todos los datos: Bodega, Marca, Categorías, Peso, Ofertas, etc.</p>
                    <div class="flex items-center text-[10px] font-bold text-green-600 group-hover:text-green-800 mt-1">
                      <app-icon name="download" [size]="12" class="mr-1"></app-icon>
                      DESCARGAR EXCEL
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- File Upload -->
            <div>
              <p class="text-xs font-medium text-gray-700 mb-2">2. Sube tu archivo</p>
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
                  <p class="text-sm text-gray-900 font-medium">Arrastra tu archivo Excel aquí</p>
                  <p class="text-xs text-gray-500 mt-0.5">o haz clic para seleccionar · .xlsx, .xls, .csv · Máximo 5 MB</p>
                }

                @if (selectedFile) {
                  <app-icon name="file-spreadsheet" [size]="36" class="mx-auto text-green-500 mb-2"></app-icon>
                  <p class="text-sm text-gray-900 font-medium">{{ selectedFile.name }}</p>
                  <p class="text-xs text-gray-500 mt-0.5">{{ formatFileSize(selectedFile.size) }}</p>
                }
              </div>
            </div>

            <!-- Upload Error -->
            @if (uploadError) {
              <div class="bg-red-50 px-3 py-2 rounded-lg border border-red-100 text-red-700 text-xs flex items-start gap-2">
                <app-icon name="alert-circle" [size]="14" class="shrink-0 mt-0.5"></app-icon>
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
                <app-spinner size="lg" [center]="true" class="mb-3"></app-spinner>
                <p class="text-sm text-gray-900 font-medium">Analizando archivo...</p>
                <p class="text-xs text-gray-500 mt-1">Verificando productos, marcas y categorías</p>
              </div>
            }

            <!-- Analysis results -->
            @if (analysisResult && !isAnalyzing) {
              <!-- Summary stats cards -->
              <div class="flex overflow-x-auto gap-2 pb-1 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible">
                <div class="min-w-[100px] bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 shrink-0">
                  <div class="text-[10px] text-blue-600 font-medium">Total Productos</div>
                  <div class="text-xl font-bold text-blue-700">{{ analysisResult!.total_products }}</div>
                </div>
                <div class="min-w-[100px] bg-green-50 px-3 py-2 rounded-lg border border-green-100 shrink-0">
                  <div class="text-[10px] text-green-600 font-medium">Listos</div>
                  <div class="text-xl font-bold text-green-700">{{ analysisResult!.ready }}</div>
                </div>
                <div class="min-w-[100px] bg-amber-50 px-3 py-2 rounded-lg border border-amber-100 shrink-0">
                  <div class="text-[10px] text-amber-600 font-medium">Advertencias</div>
                  <div class="text-xl font-bold text-amber-700">{{ analysisResult!.with_warnings }}</div>
                </div>
                <div class="min-w-[100px] bg-red-50 px-3 py-2 rounded-lg border border-red-100 shrink-0">
                  <div class="text-[10px] text-red-600 font-medium">Errores</div>
                  <div class="text-xl font-bold text-red-700">{{ analysisResult!.with_errors }}</div>
                </div>
              </div>

              <!-- Detail table (desktop) -->
              <div class="hidden md:block border rounded-lg overflow-hidden mt-3">
                <div class="max-h-52 overflow-y-auto">
                  <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50 sticky top-0">
                      <tr>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                        <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Controla Inventario</th>
                        <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Precio</th>
                        <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Acción</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                      </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                      @for (item of analysisResult!.products; track item.row_number) {
                        <tr>
                          <td class="px-3 py-2 text-sm text-gray-900 max-w-[180px] truncate">{{ item.name || '—' }}</td>
                          <td class="px-3 py-2 text-sm font-mono text-xs text-gray-600">{{ item.sku || '—' }}</td>
                          <td class="px-3 py-2 text-sm">
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [ngClass]="{
                                'bg-blue-100 text-blue-800': item.product_type === 'service',
                                'bg-green-100 text-green-800': item.product_type === 'physical'
                              }">
                              {{ item.product_type === 'service' ? 'Servicio' : 'Producto' }}
                            </span>
                          </td>
                          <td class="px-3 py-2 text-sm text-center">
                            @if (item.product_type === 'service') {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">No</span>
                            } @else if (item.track_inventory === true) {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Sí</span>
                            } @else if (item.track_inventory === false) {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">No</span>
                            } @else {
                              <span class="text-xs text-gray-400">—</span>
                            }
                          </td>
                          <td class="px-3 py-2 text-sm text-right text-gray-700">{{ item.base_price | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                          <td class="px-3 py-2 text-sm text-center">
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [ngClass]="{
                                'bg-emerald-100 text-emerald-800': item.action === 'create',
                                'bg-sky-100 text-sky-800': item.action === 'update'
                              }">
                              {{ item.action === 'create' ? 'Crear' : 'Actualizar' }}
                            </span>
                          </td>
                          <td class="px-3 py-2 text-sm">
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [ngClass]="{
                                'bg-green-100 text-green-800': item.status === 'ready',
                                'bg-amber-100 text-amber-800': item.status === 'warning',
                                'bg-red-100 text-red-800': item.status === 'error'
                              }">
                              {{ item.status === 'ready' ? 'Listo' : item.status === 'warning' ? 'Advertencia' : 'Error' }}
                            </span>
                          </td>
                        </tr>
                        <!-- Warnings/Errors expandable row -->
                        @if (item.warnings.length > 0 || item.errors.length > 0) {
                          <tr class="bg-gray-50">
                            <td colspan="7" class="px-3 py-2">
                              @for (warning of item.warnings; track warning) {
                                <p class="text-xs text-amber-700 flex items-start gap-1">
                                  <app-icon name="alert-triangle" [size]="12" class="shrink-0 mt-0.5"></app-icon>
                                  {{ warning }}
                                </p>
                              }
                              @for (error of item.errors; track error) {
                                <p class="text-xs text-red-700 flex items-start gap-1">
                                  <app-icon name="x-circle" [size]="12" class="shrink-0 mt-0.5"></app-icon>
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
              <div class="block md:hidden space-y-2 mt-3 max-h-52 overflow-y-auto">
                @for (item of analysisResult!.products; track item.row_number) {
                  <div class="border rounded-lg p-3 bg-white">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm font-medium text-gray-900 truncate mr-2">{{ item.name || '—' }}</span>
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
                        [ngClass]="{
                          'bg-green-100 text-green-800': item.status === 'ready',
                          'bg-amber-100 text-amber-800': item.status === 'warning',
                          'bg-red-100 text-red-800': item.status === 'error'
                        }">
                        {{ item.status === 'ready' ? 'Listo' : item.status === 'warning' ? 'Advertencia' : 'Error' }}
                      </span>
                    </div>
                    <p class="text-xs text-gray-500 font-mono mb-2">{{ item.sku || '—' }}</p>
                    <div class="flex flex-wrap gap-2 text-xs text-gray-600 mb-1">
                      <span>{{ item.base_price | currency:'COP':'symbol-narrow':'1.0-0' }}</span>
                      <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                        [ngClass]="{
                          'bg-emerald-100 text-emerald-700': item.action === 'create',
                          'bg-sky-100 text-sky-700': item.action === 'update'
                        }">
                        {{ item.action === 'create' ? 'Crear' : 'Actualizar' }}
                      </span>
                      <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                        [ngClass]="{
                          'bg-blue-100 text-blue-700': item.product_type === 'service',
                          'bg-green-100 text-green-700': item.product_type === 'physical'
                        }">
                        {{ item.product_type === 'service' ? 'Servicio' : 'Producto' }}
                      </span>
                    </div>
                    <div class="flex items-center gap-1.5 text-[11px] text-gray-600 mt-1">
                      <span class="font-medium text-gray-500">Inventario:</span>
                      @if (item.product_type === 'service') {
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">No</span>
                      } @else if (item.track_inventory === true) {
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Sí</span>
                      } @else if (item.track_inventory === false) {
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">No</span>
                      } @else {
                        <span class="text-gray-400">—</span>
                      }
                    </div>
                    @if (item.warnings.length > 0 || item.errors.length > 0) {
                      <div class="mt-2 pt-2 border-t border-gray-100 space-y-1">
                        @for (warning of item.warnings; track warning) {
                          <p class="text-[11px] text-amber-700 flex items-start gap-1">
                            <span class="shrink-0">⚠</span> {{ warning }}
                          </p>
                        }
                        @for (error of item.errors; track error) {
                          <p class="text-[11px] text-red-700 flex items-start gap-1">
                            <span class="shrink-0">✗</span> {{ error }}
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
                <app-spinner size="lg" [center]="true" class="mb-3"></app-spinner>
                <p class="text-sm text-gray-900 font-medium">Cargando productos...</p>
                <p class="text-xs text-gray-500 mt-1">Esto puede tomar unos momentos</p>
              </div>
            }

            <!-- Upload Error -->
            @if (uploadError && !isUploading) {
              <div class="bg-red-50 px-3 py-2 rounded-lg border border-red-100 text-red-700 text-xs flex items-start gap-2">
                <app-icon name="alert-circle" [size]="14" class="shrink-0 mt-0.5"></app-icon>
                <p>{{ uploadError }}</p>
              </div>
            }

            <!-- Results -->
            @if (uploadResults && !isUploading) {
              <!-- Summary -->
              <div class="bg-white border rounded-lg overflow-hidden">
                <div class="bg-gray-50 px-3 py-2 border-b flex justify-between items-center">
                  <h4 class="text-sm font-medium text-gray-900">Resumen de Carga</h4>
                  <span class="text-xs text-gray-500">{{ uploadResults.total_processed || 0 }} productos</span>
                </div>
                <div class="p-3 grid grid-cols-3 gap-2">
                  <div class="bg-green-50 px-3 py-2 rounded border border-green-100">
                    <div class="text-[10px] text-green-600 font-medium">Exitosos</div>
                    <div class="text-xl font-bold text-green-700">{{ uploadResults.successful || 0 }}</div>
                  </div>
                  <div class="bg-red-50 px-3 py-2 rounded border border-red-100">
                    <div class="text-[10px] text-red-600 font-medium">Fallidos</div>
                    <div class="text-xl font-bold text-red-700">{{ uploadResults.failed || 0 }}</div>
                  </div>
                  <div class="bg-amber-50 px-3 py-2 rounded border border-amber-100">
                    <div class="text-[10px] text-amber-600 font-medium">Omitidos</div>
                    <div class="text-xl font-bold text-amber-700">{{ uploadResults.skipped || 0 }}</div>
                  </div>
                </div>
              </div>

              <!-- Detail Table -->
              <div class="border rounded-lg overflow-hidden">
                <div class="bg-gray-50 px-3 py-2 border-b text-gray-800 font-medium text-xs flex items-center">
                  <app-icon name="list" [size]="14" class="mr-1.5"></app-icon>
                  Detalle por Producto
                </div>
                <div class="max-h-48 overflow-y-auto bg-white">
                  <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                      <tr>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detalle</th>
                      </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                      @for (result of uploadResults.results; track result.sku) {
                        <tr>
                          <td class="px-3 py-2 text-sm text-gray-900 max-w-[150px] truncate">
                            {{ result.product_name || result.product?.name || '—' }}
                          </td>
                          <td class="px-3 py-2 whitespace-nowrap text-sm font-mono text-xs text-gray-600">
                            {{ result.sku || '—' }}
                          </td>
                          <td class="px-3 py-2 whitespace-nowrap text-sm">
                            <span
                              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              [ngClass]="{
                                'bg-green-100 text-green-800': result.status === 'success',
                                'bg-red-100 text-red-800': result.status === 'error',
                                'bg-amber-100 text-amber-800': result.status === 'skipped'
                              }"
                            >
                              {{ result.status === 'success' ? 'Exitoso' : result.status === 'error' ? 'Error' : 'Omitido' }}
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
      } <!-- end @if (!showingIntro) -->

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-2 pt-4 border-t border-gray-200 mt-4">
        @if (showingIntro) {
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          <app-button variant="primary" (clicked)="skipIntro()">
            Continuar
            <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
          </app-button>
        }
        <!-- Step 0 -->
        @if (!showingIntro && currentStep === 0) {
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          @if (selectedFile) {
            <app-button variant="primary" (clicked)="analyzeFile()" [disabled]="isAnalyzing">
              <app-icon name="search" [size]="16" slot="icon"></app-icon>
              Analizar Archivo
            </app-button>
          }
        }
        <!-- Step 1 -->
        @if (!showingIntro && currentStep === 1 && !isAnalyzing) {
          <app-button variant="outline" (clicked)="goBack()">Atrás</app-button>
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          @if (analysisResult && canProceed) {
            <app-button variant="primary" (clicked)="proceedWithUpload()">
              <app-icon name="upload" [size]="16" slot="icon"></app-icon>
              Cargar {{ totalProductsToUpload }} Productos
            </app-button>
          }
        }
        <!-- Step 2 -->
        @if (!showingIntro && currentStep === 2 && !isUploading) {
          <app-button variant="outline" (clicked)="onCancel()">Cerrar</app-button>
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
export class BulkUploadModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly uploadComplete = output<void>();

  private static readonly INTRO_CACHE_KEY = 'vendix_bulk_product_intro_dismissed';
  private static readonly INTRO_DURATION = 20000;
  private static readonly INTRO_TICK = 100;

  // Intro state
  showingIntro = false;
  dontShowIntroAgain = false;
  introProgress = 0;
  introCountdown = 20;
  private introTimerId: ReturnType<typeof setInterval> | null = null;
  private introElapsed = 0;

  // Wizard state
  steps: StepsLineItem[] = [
    { label: 'Preparar' },
    { label: 'Revisar' },
    { label: 'Resultados' },
  ];
  currentStep = 0;

  // File state
  selectedFile: File | null = null;
  isDragging = false;

  // Analysis state
  isAnalyzing = false;
  analysisResult: BulkProductAnalysisResult | null = null;
  sessionId: string | null = null;

  // Upload state
  isUploading = false;
  uploadResults: BulkProductUploadResult | null = null;

  // Error state
  uploadError: string | null = null;

  private productsService = inject(ProductsService);
  private toastService = inject(ToastService);

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open) {
        this.onModalOpen();
      } else {
        this.clearIntroTimer();
      }
    });
  }

  // Computed properties
  get canProceed(): boolean {
    if (!this.analysisResult) return false;
    return this.analysisResult.ready > 0 || this.analysisResult.with_warnings > 0;
  }

  get totalProductsToUpload(): number {
    if (!this.analysisResult) return 0;
    return this.analysisResult.products.filter(p => p.status !== 'error').length;
  }

  // Intro logic
  private onModalOpen() {
    const dismissed = localStorage.getItem(BulkUploadModalComponent.INTRO_CACHE_KEY);
    if (dismissed === 'true') {
      this.showingIntro = false;
      return;
    }
    this.showingIntro = true;
    this.introElapsed = 0;
    this.introProgress = 0;
    this.introCountdown = Math.ceil(BulkUploadModalComponent.INTRO_DURATION / 1000);
    this.startIntroTimer();
  }

  private startIntroTimer() {
    this.clearIntroTimer();
    this.introTimerId = setInterval(() => {
      this.introElapsed += BulkUploadModalComponent.INTRO_TICK;
      this.introProgress = Math.min(100, (this.introElapsed / BulkUploadModalComponent.INTRO_DURATION) * 100);
      this.introCountdown = Math.max(0, Math.ceil((BulkUploadModalComponent.INTRO_DURATION - this.introElapsed) / 1000));

      if (this.introElapsed >= BulkUploadModalComponent.INTRO_DURATION) {
        this.skipIntro();
      }
    }, BulkUploadModalComponent.INTRO_TICK);
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
      localStorage.setItem(BulkUploadModalComponent.INTRO_CACHE_KEY, 'true');
    }
    this.showingIntro = false;
  }

  toggleDontShowAgain() {
    this.dontShowIntroAgain = !this.dontShowIntroAgain;
  }

  // Navigation
  goBack() {
    if (this.currentStep > 0) {
      this.currentStep--;
    }
  }

  // Cancel/Close
  onCancel() {
    if (this.sessionId && !this.uploadResults) {
      this.productsService.cancelBulkProductSession(this.sessionId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
    if ((this.uploadResults?.successful ?? 0) > 0) {
      this.uploadComplete.emit();
    }
    this.isOpenChange.emit(false);
    this.resetState();
  }

  resetState() {
    this.clearIntroTimer();
    this.showingIntro = false;
    this.introProgress = 0;
    this.introElapsed = 0;
    this.currentStep = 0;
    this.selectedFile = null;
    this.isDragging = false;
    this.isAnalyzing = false;
    this.analysisResult = null;
    this.sessionId = null;
    this.isUploading = false;
    this.uploadResults = null;
    this.uploadError = null;
  }

  // Step 0: File operations
  downloadTemplate(type: 'quick' | 'complete') {
    this.productsService.getBulkUploadTemplate(type).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plantilla-productos-${type}.xlsx`;
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
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

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

  private validateAndSetFile(file: File) {
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      this.toastService.error('Por favor selecciona un archivo válido (.xlsx, .xls o .csv)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.toastService.error('El archivo excede el límite de 5 MB');
      return;
    }

    this.selectedFile = file;
    this.uploadError = null;
  }

  // Step 0 -> 1: Analyze
  analyzeFile() {
    if (!this.selectedFile) return;

    this.isAnalyzing = true;
    this.uploadError = null;
    this.currentStep = 1;

    this.productsService.analyzeBulkProducts(this.selectedFile).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.isAnalyzing = false;
        this.analysisResult = result;
        this.sessionId = result.session_id;

        if (result.with_errors > 0) {
          this.toastService.warning(`${result.with_errors} producto(s) con errores detectados`);
        }
      },
      error: (error) => {
        this.isAnalyzing = false;
        this.currentStep = 0;
        this.uploadError = typeof error === 'string' ? error : error?.error?.message || error?.message || 'Error al analizar el archivo';
        this.toastService.error('Error al analizar el archivo');
      },
    });
  }

  // Step 1 -> 2: Upload
  proceedWithUpload() {
    if (!this.sessionId) return;

    this.isUploading = true;
    this.currentStep = 2;

    this.productsService.uploadBulkProductsFromSession(this.sessionId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.isUploading = false;
        this.uploadResults = result;

        if (result.failed > 0 || result.skipped > 0) {
          this.toastService.warning('La carga se completó con algunos errores u omisiones.');
        } else {
          this.toastService.success(`${result.successful} producto(s) cargados exitosamente`);
        }
      },
      error: (error) => {
        this.isUploading = false;
        this.uploadError = typeof error === 'string' ? error : error?.error?.message || error?.message || 'Error en la carga';
        this.toastService.error('Error en la carga masiva de productos');
      },
    });
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
