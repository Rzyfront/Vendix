import { Component, input, output, inject, effect, DestroyRef } from '@angular/core';
import { NgClass, CurrencyPipe } from '@angular/common';
import * as XLSX from 'xlsx';
import { ProductsService } from '../../../products/services/products.service';
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

interface AnalyzedItem {
  name: string;
  sku: string;
  unit_cost: number;
  quantity: number;
  cost_price: number;
  stock_quantity: number;
  base_price: number;
  profit_margin: number;
  description?: string;
  brand_id?: string;
  category_ids?: string;
  state?: string;
  available_for_ecommerce?: string;
  weight: number;
  status: 'ready' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

interface AnalysisResult {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  items: AnalyzedItem[];
}

@Component({
  selector: 'app-pop-bulk-data-modal',
  standalone: true,
  imports: [NgClass, CurrencyPipe, ModalComponent, ButtonComponent, IconComponent, StepsLineComponent, SpinnerComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Carga Masiva al Pedido"
      (closed)="onCancel()"
      subtitle="Importa productos desde un archivo Excel al pedido de compra"
    >
      <!-- INTRO SCREEN -->
      @if (showingIntro) {
        <div class="space-y-3">
          <div class="text-center">
            <div class="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full mb-2">
              <app-icon name="shopping-cart" [size]="24" class="text-primary"></app-icon>
            </div>
            <h3 class="text-base font-semibold text-gray-900">Carga masiva al pedido</h3>
            <p class="text-xs text-gray-500 mt-0.5">Importa productos desde un archivo Excel al pedido de compra</p>
          </div>

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
                <p class="text-[11px] text-indigo-700">Nombre, SKU, Precio Compra, Cantidad y más.</p>
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
                <p class="text-[11px] text-green-700">Vista previa producto por producto antes de importar al pedido.</p>
              </div>
            </div>
          </div>

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
            <div class="bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 flex items-start gap-2">
              <app-icon name="info" [size]="14" class="text-blue-600 shrink-0 mt-0.5"></app-icon>
              <p class="text-[11px] text-blue-800 leading-relaxed">
                <span class="font-medium">Descarga la plantilla</span>, completa los datos de tus productos y sube el archivo.
                Formatos: .xlsx, .xls, .csv · Máx. 1000 productos.
              </p>
            </div>

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

            <div class="bg-amber-50 px-3 py-2 rounded-lg border border-amber-100 flex items-start gap-2">
              <app-icon name="alert-triangle" [size]="14" class="text-amber-600 shrink-0 mt-0.5"></app-icon>
              <p class="text-[11px] text-amber-800 leading-relaxed">
                <span class="font-medium">Importante:</span> Los productos se cargarán temporalmente en la orden.
                Si contienen nuevas marcas o categorías, estas se crearán automáticamente al confirmar.
              </p>
            </div>

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
            @if (isProcessing) {
              <div class="py-8 flex flex-col items-center justify-center">
                <app-spinner size="lg" [center]="true" class="mb-3"></app-spinner>
                <p class="text-sm text-gray-900 font-medium">Procesando archivo...</p>
                <p class="text-xs text-gray-500 mt-1">Verificando productos y datos</p>
              </div>
            }

            @if (analysisResult && !isProcessing) {
              <div class="flex overflow-x-auto gap-2 pb-1 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible">
                <div class="min-w-[100px] bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 shrink-0">
                  <div class="text-[10px] text-blue-600 font-medium">Total</div>
                  <div class="text-xl font-bold text-blue-700">{{ analysisResult.total }}</div>
                </div>
                <div class="min-w-[100px] bg-green-50 px-3 py-2 rounded-lg border border-green-100 shrink-0">
                  <div class="text-[10px] text-green-600 font-medium">Listos</div>
                  <div class="text-xl font-bold text-green-700">{{ analysisResult.valid }}</div>
                </div>
                <div class="min-w-[100px] bg-amber-50 px-3 py-2 rounded-lg border border-amber-100 shrink-0">
                  <div class="text-[10px] text-amber-600 font-medium">Advertencias</div>
                  <div class="text-xl font-bold text-amber-700">{{ analysisResult.warnings }}</div>
                </div>
                <div class="min-w-[100px] bg-red-50 px-3 py-2 rounded-lg border border-red-100 shrink-0">
                  <div class="text-[10px] text-red-600 font-medium">Errores</div>
                  <div class="text-xl font-bold text-red-700">{{ analysisResult.errors }}</div>
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
                        <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                        <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">P. Compra</th>
                        <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">P. Venta</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                      </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                      @for (item of analysisResult.items; track $index) {
                        <tr>
                          <td class="px-3 py-2 text-sm text-gray-900 max-w-[180px] truncate">{{ item.name || '—' }}</td>
                          <td class="px-3 py-2 text-sm font-mono text-xs text-gray-600">{{ item.sku || '—' }}</td>
                          <td class="px-3 py-2 text-sm text-right text-gray-700">{{ item.quantity }}</td>
                          <td class="px-3 py-2 text-sm text-right text-gray-700">{{ item.cost_price | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                          <td class="px-3 py-2 text-sm text-right text-gray-700">{{ item.base_price | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
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
                        @if (item.warnings.length > 0 || item.errors.length > 0) {
                          <tr class="bg-gray-50">
                            <td colspan="6" class="px-3 py-2">
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
                @for (item of analysisResult.items; track $index) {
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
                    <div class="flex gap-3 text-xs text-gray-600">
                      <span>Cant: {{ item.quantity }}</span>
                      <span>Compra: {{ item.cost_price | currency:'COP':'symbol-narrow':'1.0-0' }}</span>
                      <span>Venta: {{ item.base_price | currency:'COP':'symbol-narrow':'1.0-0' }}</span>
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

        <!-- STEP 2: Confirmar -->
        @if (currentStep === 2) {
          <div class="space-y-3">
            <div class="bg-white border rounded-lg overflow-hidden">
              <div class="bg-gray-50 px-3 py-2 border-b flex justify-between items-center">
                <h4 class="text-sm font-medium text-gray-900">Resumen de Importación</h4>
                <span class="text-xs text-gray-500">{{ importedItems.length }} productos</span>
              </div>
              <div class="p-3">
                <div class="bg-green-50 px-4 py-3 rounded-lg border border-green-100 flex items-center gap-3">
                  <app-icon name="check-circle" [size]="24" class="text-green-500"></app-icon>
                  <div>
                    <h4 class="text-sm font-medium text-green-900">Productos importados al pedido</h4>
                    <p class="text-xs text-green-700">Se agregaron {{ importedItems.length }} productos al pedido de compra.</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="border rounded-lg overflow-hidden">
              <div class="bg-gray-50 px-3 py-2 border-b text-gray-800 font-medium text-xs flex items-center">
                <app-icon name="list" [size]="14" class="mr-1.5"></app-icon>
                Productos Importados
              </div>
              <div class="max-h-48 overflow-y-auto bg-white">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                      <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                      <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">P. Compra</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    @for (item of importedItems; track $index) {
                      <tr>
                        <td class="px-3 py-2 text-sm text-gray-900 max-w-[150px] truncate">{{ item.name || '—' }}</td>
                        <td class="px-3 py-2 whitespace-nowrap text-sm font-mono text-xs text-gray-600">{{ item.sku || '—' }}</td>
                        <td class="px-3 py-2 text-sm text-right text-gray-700">{{ item.quantity }}</td>
                        <td class="px-3 py-2 text-sm text-right text-gray-700">{{ item.cost_price | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        }
      }

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-2 pt-4 border-t border-gray-200 mt-4">
        @if (showingIntro) {
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          <app-button variant="primary" (clicked)="skipIntro()">
            Continuar
            <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
          </app-button>
        }
        @if (!showingIntro && currentStep === 0) {
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          @if (selectedFile) {
            <app-button variant="primary" (clicked)="analyzeFile()">
              <app-icon name="search" [size]="16" slot="icon"></app-icon>
              Analizar Archivo
            </app-button>
          }
        }
        @if (!showingIntro && currentStep === 1 && !isProcessing) {
          <app-button variant="outline" (clicked)="goBack()">Atrás</app-button>
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          @if (analysisResult && totalValidItems > 0) {
            <app-button variant="primary" (clicked)="confirmImport()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Importar {{ totalValidItems }} Productos al Pedido
            </app-button>
          }
        }
        @if (!showingIntro && currentStep === 2) {
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
export class PopBulkDataModalComponent {
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly close = output<void>();
  readonly dataLoaded = output<any[]>();

  private static readonly INTRO_CACHE_KEY = 'vendix_bulk_pop_intro_dismissed';
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
    { label: 'Confirmar' },
  ];
  currentStep = 0;

  // File state
  selectedFile: File | null = null;
  isDragging = false;

  // Analysis state (client-side)
  isProcessing = false;
  analysisResult: AnalysisResult | null = null;

  // Import state
  importedItems: any[] = [];

  // Error state
  uploadError: string | null = null;

  private productsService = inject(ProductsService);
  private toastService = inject(ToastService);

  get totalValidItems(): number {
    if (!this.analysisResult) return 0;
    return this.analysisResult.items.filter(i => i.status !== 'error').length;
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearIntroTimer());
    effect(() => {
      if (this.isOpen()) {
        this.onModalOpen();
      } else {
        this.clearIntroTimer();
      }
    });
  }

  // Intro logic
  private onModalOpen() {
    const dismissed = localStorage.getItem(PopBulkDataModalComponent.INTRO_CACHE_KEY);
    if (dismissed === 'true') {
      this.showingIntro = false;
      return;
    }
    this.showingIntro = true;
    this.introElapsed = 0;
    this.introProgress = 0;
    this.introCountdown = Math.ceil(PopBulkDataModalComponent.INTRO_DURATION / 1000);
    this.startIntroTimer();
  }

  private startIntroTimer() {
    this.clearIntroTimer();
    this.introTimerId = setInterval(() => {
      this.introElapsed += PopBulkDataModalComponent.INTRO_TICK;
      this.introProgress = Math.min(100, (this.introElapsed / PopBulkDataModalComponent.INTRO_DURATION) * 100);
      this.introCountdown = Math.max(0, Math.ceil((PopBulkDataModalComponent.INTRO_DURATION - this.introElapsed) / 1000));

      if (this.introElapsed >= PopBulkDataModalComponent.INTRO_DURATION) {
        this.skipIntro();
      }
    }, PopBulkDataModalComponent.INTRO_TICK);
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
      localStorage.setItem(PopBulkDataModalComponent.INTRO_CACHE_KEY, 'true');
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

  onCancel() {
    this.close.emit();
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
    this.isProcessing = false;
    this.analysisResult = null;
    this.importedItems = [];
    this.uploadError = null;
  }

  // Step 0: File operations
  downloadTemplate(type: 'quick' | 'complete') {
    this.productsService.getBulkUploadTemplate(type).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plantilla-pedido-${type}.xlsx`;
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

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Step 0 -> 1: Analyze file client-side
  analyzeFile() {
    if (!this.selectedFile) return;

    this.isProcessing = true;
    this.uploadError = null;
    this.currentStep = 1;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const bstr: string = e.target.result;
        const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (!data || data.length === 0) {
          this.toastService.error('El archivo está vacío o tiene un formato incorrecto');
          this.isProcessing = false;
          this.currentStep = 0;
          return;
        }

        if (data.length > 1000) {
          this.toastService.error(`El archivo excede el límite de 1000 items (tiene ${data.length})`);
          this.isProcessing = false;
          this.currentStep = 0;
          return;
        }

        const items: AnalyzedItem[] = data.map((row: any) => {
          const name = row['Nombre'] || row['name'] || '';
          const sku = row['SKU'] || row['sku'] || '';
          const cost = parseFloat(row['Precio Compra'] || row['Costo'] || row['cost_price'] || row['unit_cost'] || 0);
          const qty = parseFloat(row['Cantidad'] || row['Cantidad Inicial'] || row['stock_quantity'] || row['quantity'] || row['qty'] || 0);
          const base_price = parseFloat(row['Precio Venta'] || row['base_price'] || 0);
          let profit_margin = parseFloat(row['Margen'] || row['profit_margin'] || 0);
          if (profit_margin > 0 && profit_margin < 1) {
            profit_margin = profit_margin * 100;
          }
          const description = row['Descripción'] || row['description'];
          const brand_id = row['Marca'] || row['brand_id'];
          const category_ids = row['Categorías'] || row['category_ids'];
          const state = row['Estado'] || row['state'];
          const available_for_ecommerce = row['Disponible Ecommerce'] || row['available_for_ecommerce'];
          const weight = parseFloat(row['Peso'] || row['weight'] || 0);

          const warnings: string[] = [];
          const errors: string[] = [];

          if (!name && !sku) {
            errors.push('Falta nombre y SKU');
          }
          if (!name && sku) {
            warnings.push('Falta el nombre del producto');
          }
          if (name && !sku) {
            warnings.push('Falta el SKU');
          }
          if (isNaN(qty) || qty <= 0) {
            warnings.push('Cantidad no especificada o inválida');
          }
          if (isNaN(cost) || cost <= 0) {
            warnings.push('Precio de compra no especificado');
          }

          let status: 'ready' | 'warning' | 'error' = 'ready';
          if (errors.length > 0) {
            status = 'error';
          } else if (warnings.length > 0) {
            status = 'warning';
          }

          return {
            name,
            sku,
            unit_cost: isNaN(cost) ? 0 : cost,
            quantity: isNaN(qty) ? 0 : qty,
            cost_price: isNaN(cost) ? 0 : cost,
            stock_quantity: isNaN(qty) ? 0 : qty,
            base_price: isNaN(base_price) ? 0 : base_price,
            profit_margin: isNaN(profit_margin) ? 0 : profit_margin,
            description,
            brand_id,
            category_ids,
            state,
            available_for_ecommerce,
            weight: isNaN(weight) ? 0 : weight,
            status,
            warnings,
            errors,
          };
        });

        const valid = items.filter(i => i.status === 'ready').length;
        const withWarnings = items.filter(i => i.status === 'warning').length;
        const withErrors = items.filter(i => i.status === 'error').length;

        this.analysisResult = {
          total: items.length,
          valid,
          warnings: withWarnings,
          errors: withErrors,
          items,
        };

        this.isProcessing = false;

        if (withErrors > 0) {
          this.toastService.warning(`${withErrors} producto(s) con errores detectados`);
        }
      } catch (err) {
        console.error('Error parsing file:', err);
        this.uploadError = 'Error al procesar el archivo. Verifica el formato.';
        this.toastService.error('Error al procesar el archivo');
        this.isProcessing = false;
        this.currentStep = 0;
      }
    };

    reader.readAsBinaryString(this.selectedFile);
  }

  // Step 1 -> 2: Confirm import
  confirmImport() {
    if (!this.analysisResult) return;

    const validItems = this.analysisResult.items
      .filter(i => i.status !== 'error')
      .map(({ status, warnings, errors, ...item }) => item);

    this.importedItems = validItems;
    this.currentStep = 2;
    this.dataLoaded.emit(validItems);
    this.toastService.success(`${validItems.length} producto(s) importados al pedido`);
  }
}
