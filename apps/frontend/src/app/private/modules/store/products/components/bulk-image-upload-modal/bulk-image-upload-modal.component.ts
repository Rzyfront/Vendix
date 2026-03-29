import { Component, EventEmitter, Input, Output, inject, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductsService } from '../../services/products.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../shared/components/steps-line/steps-line.component';
import {
  BulkImageAnalysisResult,
  BulkImageUploadResult,
} from '../../interfaces/bulk-image-analysis.interface';

@Component({
  selector: 'app-bulk-image-upload-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent, StepsLineComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Carga Masiva de Imágenes"
      (closed)="onCancel()"
      subtitle="Asigna imágenes a múltiples productos usando un archivo ZIP"
    >
      <!-- INTRO SCREEN (before wizard) -->
      @if (showingIntro) {
        <div class="space-y-3">
          <!-- Header -->
          <div class="text-center">
            <div class="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full mb-2">
              <app-icon name="images" [size]="24" class="text-primary"></app-icon>
            </div>
            <h3 class="text-base font-semibold text-gray-900">Carga masiva de imágenes</h3>
            <p class="text-xs text-gray-500 mt-0.5">Sube imágenes para múltiples productos de una sola vez</p>
          </div>

          <!-- Step-by-step guide -->
          <div class="space-y-2">
            <div class="flex items-start gap-2.5 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">1</div>
              <div>
                <p class="text-xs font-medium text-blue-900">Descarga la plantilla</p>
                <p class="text-[11px] text-blue-700">ZIP con carpetas vacías nombradas con los SKUs de tus productos.</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold shrink-0">2</div>
              <div>
                <p class="text-xs font-medium text-indigo-900">Agrega las imágenes</p>
                <p class="text-[11px] text-indigo-700">Hasta 5 por carpeta SKU. Acepta JPG, PNG, WebP, HEIC, GIF, TIFF, AVIF y SVG.</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 px-3 py-2 bg-violet-50 rounded-lg border border-violet-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-violet-600 text-white text-[10px] font-bold shrink-0">3</div>
              <div>
                <p class="text-xs font-medium text-violet-900">Comprime y sube</p>
                <p class="text-[11px] text-violet-700">Comprime en .zip (máx. 100 MB). El sistema analiza antes de cargar.</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 px-3 py-2 bg-green-50 rounded-lg border border-green-100">
              <div class="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-[10px] font-bold shrink-0">4</div>
              <div>
                <p class="text-xs font-medium text-green-900">Revisa y confirma</p>
                <p class="text-[11px] text-green-700">Análisis SKU por SKU antes de confirmar. Todo se optimiza a WebP.</p>
              </div>
            </div>
          </div>

          <!-- Folder structure visual (compact) -->
          <div class="bg-gray-50 border rounded-lg px-3 py-2">
            <p class="text-[11px] font-medium text-gray-700 mb-1">Estructura del ZIP:</p>
            <pre class="text-[10px] text-gray-500 font-mono leading-snug">📦 archivo.zip
├── 📁 SKU-001/  (01-frente.jpg, 02-lateral.png)
├── 📁 SKU-002/  (foto.heic)
└── 📁 SKU-003/  (img-1.avif, img-2.svg)</pre>
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

      <!-- WIZARD (after intro) -->
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
                <span class="font-medium">Descarga la plantilla</span>, coloca imágenes en carpetas por SKU,
                comprime en .zip y súbelo.
                Formatos: {{ supportedFormats.join(', ') }} · Máx. 5/producto · 100 MB.
              </p>
            </div>

            <!-- Template Downloads -->
            <div>
              <p class="text-xs font-medium text-gray-700 mb-2">1. Descarga una plantilla</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div
                  class="border border-indigo-200 hover:border-indigo-500 bg-indigo-50 rounded-lg px-3 py-2.5 cursor-pointer transition-all group flex items-center gap-3"
                  (click)="downloadTemplate('example')"
                >
                  <div class="p-1.5 bg-indigo-100 rounded-full text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                    <app-icon name="file-text" [size]="16"></app-icon>
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-indigo-900 text-xs">Plantilla Ejemplo</p>
                    <p class="text-[10px] text-indigo-600 truncate">ZIP con instrucciones y carpetas de ejemplo</p>
                  </div>
                </div>
                <div
                  class="border border-green-200 hover:border-green-500 bg-green-50 rounded-lg px-3 py-2.5 cursor-pointer transition-all group flex items-center gap-3"
                  (click)="downloadTemplate('store-skus')"
                >
                  <div class="p-1.5 bg-green-100 rounded-full text-green-600 group-hover:bg-green-600 group-hover:text-white transition-colors shrink-0">
                    <app-icon name="package" [size]="16"></app-icon>
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-green-900 text-xs">SKUs de tu Tienda</p>
                    <p class="text-[10px] text-green-600 truncate">Carpetas con los SKUs reales de tus productos</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- File Upload Section -->
            <div>
              <p class="text-xs font-medium text-gray-700 mb-2">2. Sube tu archivo ZIP</p>
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
                  accept=".zip"
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
                  <p class="text-sm text-gray-900 font-medium">Arrastra tu archivo .zip aquí</p>
                  <p class="text-xs text-gray-500 mt-0.5">o haz clic para seleccionar · Máximo 100 MB</p>
                }

                @if (selectedFile) {
                  <app-icon name="file" [size]="36" class="mx-auto text-blue-500 mb-2"></app-icon>
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
            <div class="py-8 text-center">
              <app-icon name="loader" [size]="36" class="text-primary mb-3 animate-spin"></app-icon>
              <p class="text-sm text-gray-900 font-medium">Analizando archivo ZIP...</p>
              <p class="text-xs text-gray-500 mt-1">Verificando SKUs y formatos de imagen</p>
            </div>
          }

          <!-- Analysis results -->
          @if (analysisResult && !isAnalyzing) {
            <!-- Summary stats cards -->
            <div class="flex overflow-x-auto gap-2 pb-1 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible">
              <div class="min-w-[100px] bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 shrink-0">
                <div class="text-[10px] text-blue-600 font-medium">Total SKUs</div>
                <div class="text-xl font-bold text-blue-700">{{ analysisResult!.total_skus }}</div>
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
                      <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                      <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                      <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Imágenes</th>
                      <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Actuales</th>
                      <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">A Subir</th>
                      <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    @for (sku of analysisResult!.skus; track sku.sku) {
                      <tr>
                        <td class="px-4 py-2 text-sm font-mono font-medium text-gray-900">{{ sku.sku }}</td>
                        <td class="px-4 py-2 text-sm text-gray-600 max-w-[200px] truncate">
                          {{ sku.product_name || '—' }}
                        </td>
                        <td class="px-4 py-2 text-sm text-center text-gray-600">{{ sku.valid_images }}/{{ sku.images_in_zip }}</td>
                        <td class="px-4 py-2 text-sm text-center text-gray-600">{{ sku.current_image_count }}/5</td>
                        <td class="px-4 py-2 text-sm text-center font-medium text-gray-900">{{ sku.images_to_upload }}</td>
                        <td class="px-4 py-2 text-sm">
                          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                            [ngClass]="{
                              'bg-green-100 text-green-800': sku.status === 'ready',
                              'bg-amber-100 text-amber-800': sku.status === 'warning',
                              'bg-red-100 text-red-800': sku.status === 'error'
                            }">
                            {{ sku.status === 'ready' ? 'Listo' : sku.status === 'warning' ? 'Advertencia' : 'Error' }}
                          </span>
                        </td>
                      </tr>
                      <!-- Warnings/Errors expandable row -->
                      @if (sku.warnings.length > 0 || sku.errors.length > 0) {
                        <tr class="bg-gray-50">
                          <td colspan="6" class="px-4 py-2">
                            @for (warning of sku.warnings; track warning) {
                              <p class="text-xs text-amber-700 flex items-start gap-1">
                                <app-icon name="alert-triangle" [size]="12" class="shrink-0 mt-0.5"></app-icon>
                                {{ warning }}
                              </p>
                            }
                            @for (error of sku.errors; track error) {
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
              @for (sku of analysisResult!.skus; track sku.sku) {
                <div class="border rounded-lg p-3 bg-white">
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-mono text-sm font-medium text-gray-900">{{ sku.sku }}</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      [ngClass]="{
                        'bg-green-100 text-green-800': sku.status === 'ready',
                        'bg-amber-100 text-amber-800': sku.status === 'warning',
                        'bg-red-100 text-red-800': sku.status === 'error'
                      }">
                      {{ sku.status === 'ready' ? 'Listo' : sku.status === 'warning' ? 'Advertencia' : 'Error' }}
                    </span>
                  </div>
                  @if (sku.product_name) {
                    <p class="text-xs text-gray-500 mb-2 truncate">{{ sku.product_name }}</p>
                  }
                  <div class="flex gap-4 text-xs text-gray-600">
                    <span>ZIP: {{ sku.valid_images }}/{{ sku.images_in_zip }}</span>
                    <span>Actuales: {{ sku.current_image_count }}/5</span>
                    <span class="font-medium text-gray-900">Subir: {{ sku.images_to_upload }}</span>
                  </div>
                  @if (sku.warnings.length > 0 || sku.errors.length > 0) {
                    <div class="mt-2 pt-2 border-t border-gray-100 space-y-1">
                      @for (warning of sku.warnings; track warning) {
                        <p class="text-[11px] text-amber-700">⚠ {{ warning }}</p>
                      }
                      @for (error of sku.errors; track error) {
                        <p class="text-[11px] text-red-700">✗ {{ error }}</p>
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
            <div class="py-8 text-center">
              <app-icon name="loader" [size]="36" class="text-primary mb-3 animate-spin"></app-icon>
              <p class="text-sm text-gray-900 font-medium">Subiendo imágenes...</p>
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
                <span class="text-xs text-gray-500">{{ uploadResults.total_skus_processed || 0 }} SKUs</span>
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
                Detalle por SKU
              </div>
              <div class="max-h-48 overflow-y-auto bg-white">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                      <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                      <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detalle</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    @for (result of uploadResults.results; track result.sku) {
                      <tr>
                        <td class="px-4 py-2 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                          {{ result.sku }}
                        </td>
                        <td class="px-4 py-2 whitespace-nowrap text-sm">
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
                        <td class="px-4 py-2 text-sm text-gray-600">
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
              Proceder con Carga ({{ totalImagesToUpload }} imágenes)
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
export class BulkImageUploadModalComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() uploadComplete = new EventEmitter<void>();

  private static readonly INTRO_CACHE_KEY = 'vendix_bulk_image_intro_dismissed';
  private static readonly INTRO_DURATION = 20000; // 20 seconds
  private static readonly INTRO_TICK = 100; // progress bar tick interval

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
  analysisResult: BulkImageAnalysisResult | null = null;
  sessionId: string | null = null;

  // Upload state
  isUploading = false;
  uploadResults: BulkImageUploadResult | null = null;

  // Error state
  uploadError: string | null = null;

  // Supported formats for display
  supportedFormats = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.heic', '.heif', '.avif', '.svg'];

  private productsService = inject(ProductsService);
  private toastService = inject(ToastService);

  // Computed properties
  get canProceed(): boolean {
    if (!this.analysisResult) return false;
    return this.analysisResult.ready > 0 || this.analysisResult.with_warnings > 0;
  }

  get totalImagesToUpload(): number {
    if (!this.analysisResult) return 0;
    return this.analysisResult.skus
      .filter(s => s.status !== 'error')
      .reduce((sum, s) => sum + s.images_to_upload, 0);
  }

  // Lifecycle
  ngOnChanges(changes: SimpleChanges) {
    if (changes['isOpen'] && this.isOpen) {
      this.onModalOpen();
    }
    if (changes['isOpen'] && !this.isOpen) {
      this.clearIntroTimer();
    }
  }

  ngOnDestroy() {
    this.clearIntroTimer();
  }

  // Intro logic
  private onModalOpen() {
    const dismissed = localStorage.getItem(BulkImageUploadModalComponent.INTRO_CACHE_KEY);
    if (dismissed === 'true') {
      this.showingIntro = false;
      return;
    }
    this.showingIntro = true;
    this.introElapsed = 0;
    this.introProgress = 0;
    this.introCountdown = Math.ceil(BulkImageUploadModalComponent.INTRO_DURATION / 1000);
    this.startIntroTimer();
  }

  private startIntroTimer() {
    this.clearIntroTimer();
    this.introTimerId = setInterval(() => {
      this.introElapsed += BulkImageUploadModalComponent.INTRO_TICK;
      this.introProgress = Math.min(100, (this.introElapsed / BulkImageUploadModalComponent.INTRO_DURATION) * 100);
      this.introCountdown = Math.max(0, Math.ceil((BulkImageUploadModalComponent.INTRO_DURATION - this.introElapsed) / 1000));

      if (this.introElapsed >= BulkImageUploadModalComponent.INTRO_DURATION) {
        this.skipIntro();
      }
    }, BulkImageUploadModalComponent.INTRO_TICK);
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
      localStorage.setItem(BulkImageUploadModalComponent.INTRO_CACHE_KEY, 'true');
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
  downloadTemplate(type: 'example' | 'store-skus') {
    this.productsService.getBulkImageUploadTemplate(type).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download =
          type === 'store-skus'
            ? `plantilla_imagenes_skus.zip`
            : `plantilla_imagenes_ejemplo.zip`;
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
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (ext !== '.zip') {
      this.toastService.error('Por favor selecciona un archivo .zip');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      this.toastService.error('El archivo excede el límite de 100 MB');
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

    this.productsService.analyzeBulkImages(this.selectedFile).subscribe({
      next: (result) => {
        this.isAnalyzing = false;
        this.analysisResult = result;
        this.sessionId = result.session_id;

        if (result.with_errors > 0) {
          this.toastService.warning(`${result.with_errors} SKU(s) con errores detectados`);
        }
      },
      error: (error) => {
        this.isAnalyzing = false;
        this.currentStep = 0;
        this.uploadError = typeof error === 'string' ? error : error?.error?.message || error?.message || 'Error al analizar el archivo';
        this.toastService.error('Error al analizar el archivo ZIP');
      },
    });
  }

  // Step 1 -> 2: Upload
  proceedWithUpload() {
    if (!this.sessionId) return;

    this.isUploading = true;
    this.currentStep = 2;

    this.productsService.uploadBulkImagesFromSession(this.sessionId).subscribe({
      next: (result) => {
        this.isUploading = false;
        this.uploadResults = result;

        if (result.failed > 0 || result.skipped > 0) {
          this.toastService.warning('La carga se completó con algunos errores u omisiones.');
        } else {
          this.toastService.success(`${result.successful} producto(s) actualizados exitosamente`);
        }
      },
      error: (error) => {
        this.isUploading = false;
        this.uploadError = typeof error === 'string' ? error : error?.error?.message || error?.message || 'Error en la carga';
        this.toastService.error('Error en la carga masiva de imágenes');
      },
    });
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
