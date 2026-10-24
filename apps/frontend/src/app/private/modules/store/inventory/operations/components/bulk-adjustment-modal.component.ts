import { Component, signal, inject, input, output, DestroyRef, computed, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, expand } from 'rxjs';

import { FormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  IconComponent,
  ToastService,
  AlertBannerComponent,
  AiReviewAckComponent,
} from '../../../../../../shared/components/index';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../shared/components/steps-line/steps-line.component';

import { InventoryService } from '../../services';

interface BulkResultItem {
  row_number: number;
  sku: string;
  product_name?: string;
  status: 'success' | 'error';
  message?: string;
  warnings?: string[];
  quantity_before?: number;
  quantity_after?: number;
  quantity_change?: number;
}

/** Máximo de filas por página del commit (contrato del backend). */
const BULK_ADJUSTMENT_PAGE_SIZE = 100;
const BULK_ADJUSTMENT_MAX_FILE_MB = 20;

interface BulkAnalysisResult {
  session_id: string;
  total: number;
  valid: number;
  failed: number;
  errors: { row_number: number; sku: string; message: string }[];
  warnings?: { row_number: number; sku: string; message: string }[];
  new_products?: number;
  auto_sku?: number;
  requires_initial_load_ack?: boolean;
  new_product_rows?: {
    row_number: number;
    sku: string | null;
    name: string;
    quantity: number;
  }[];
}

interface BulkUploadPage extends BulkUploadResult {
  total: number;
  offset: number;
  limit: number;
  done: boolean;
}

interface BulkUploadResult {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  results: BulkResultItem[];
}

@Component({
  selector: 'app-bulk-adjustment-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    AlertBannerComponent,
    AiReviewAckComponent,
    StepsLineComponent,
    SpinnerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [size]="'lg'"
      title="Ajuste Masivo de Inventario"
      subtitle="Ajusta el inventario de múltiples productos desde un archivo Excel o CSV"
    >
      <!-- Steps Line -->
      <div class="mb-4">
        <app-steps-line
          [steps]="steps"
          [currentStep]="step() - 1"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- STEP 1: Configuración -->
      @if (step() === 1) {
        <div class="space-y-3">
          <!-- Info banner -->
          <div
            class="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3"
          >
            <app-icon
              name="info"
              [size]="20"
              class="text-blue-600 shrink-0"
            ></app-icon>
            <p class="text-sm text-blue-800">
              Define la <strong>ubicación</strong> y el
              <strong>tipo de ajuste</strong> que se aplicará a todo el archivo.
              Solo las filas con SKU vacío crean productos nuevos. Un SKU
              escrito debe existir. Las entradas sin stock en la bodega se
              registran como <strong>Carga inicial</strong>.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <app-selector
              label="Ubicación / Bodega"
              [options]="locations()"
              [ngModel]="selectedLocationId()"
              (ngModelChange)="selectedLocationId.set($event)"
              placeholder="Seleccione una ubicación"
              [required]="true"
            ></app-selector>

            <app-selector
              label="Tipo de ajuste (global)"
              [options]="adjustmentTypeOptions"
              [ngModel]="selectedAdjustmentType()"
              (ngModelChange)="selectedAdjustmentType.set($event)"
            ></app-selector>

            <div class="sm:col-span-2">
              <app-textarea
                label="Descripción general (opcional)"
                [ngModel]="description()"
                (ngModelChange)="description.set($event)"
                placeholder="Ej: Conteo físico mensual de marzo"
                [rows]="2"
              ></app-textarea>
            </div>
          </div>

          <!-- Template selection -->
          <div>
            <p
              class="text-xs font-medium text-gray-700 mb-2"
              id="bulk-adj-template-label"
            >
              1. Elige y descarga una plantilla
            </p>
            <div
              class="grid grid-cols-1 sm:grid-cols-2 gap-2"
              role="radiogroup"
              aria-labelledby="bulk-adj-template-label"
            >
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="templateMode() === 'existing'"
                class="group text-left border rounded-lg px-3 py-2.5 transition-all flex items-center gap-3 bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                [class]="
                  templateMode() === 'existing'
                    ? 'border-primary ring-2 ring-primary/40 shadow-sm'
                    : 'border-indigo-200 hover:border-indigo-500'
                "
                (click)="templateMode.set('existing')"
              >
                <div
                  class="p-1.5 rounded-full shrink-0 transition-colors"
                  [class]="
                    templateMode() === 'existing'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white'
                  "
                >
                  <app-icon name="package-search" [size]="16"></app-icon>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-indigo-900 text-xs">
                    Productos existentes
                  </p>
                  <p class="text-[10px] text-indigo-600">
                    Con el stock actual de la ubicación
                  </p>
                </div>
                @if (templateMode() === 'existing') {
                  <app-icon
                    name="check-circle"
                    [size]="18"
                    class="text-primary shrink-0"
                  ></app-icon>
                }
              </button>
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="templateMode() === 'example'"
                class="group text-left border rounded-lg px-3 py-2.5 transition-all flex items-center gap-3 bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                [class]="
                  templateMode() === 'example'
                    ? 'border-primary ring-2 ring-primary/40 shadow-sm'
                    : 'border-green-200 hover:border-green-500'
                "
                (click)="templateMode.set('example')"
              >
                <div
                  class="p-1.5 rounded-full shrink-0 transition-colors"
                  [class]="
                    templateMode() === 'example'
                      ? 'bg-green-600 text-white'
                      : 'bg-green-100 text-green-600 group-hover:bg-green-600 group-hover:text-white'
                  "
                >
                  <app-icon name="file-text" [size]="16"></app-icon>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-green-900 text-xs">
                    Plantilla de ejemplo
                  </p>
                  <p class="text-[10px] text-green-600">
                    Filas de muestra para ver el formato
                  </p>
                </div>
                @if (templateMode() === 'example') {
                  <app-icon
                    name="check-circle"
                    [size]="18"
                    class="text-primary shrink-0"
                  ></app-icon>
                }
              </button>
            </div>

            <div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-3">
              <app-button
                variant="outline"
                size="sm"
                [disabled]="
                  isDownloading() ||
                  (templateMode() === 'existing' && !selectedLocationId())
                "
                [loading]="isDownloading()"
                (clicked)="downloadTemplate()"
              >
                <app-icon slot="icon" name="download" [size]="16"></app-icon>
                Descargar plantilla Excel
              </app-button>
              @if (templateMode() === 'existing' && !selectedLocationId()) {
                <span class="text-xs text-gray-500"
                  >Seleccione una ubicación para habilitar la descarga.</span
                >
              }
            </div>
          </div>

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
              @if (templateMode() === 'existing') {
                <span class="font-medium">Edita «Cantidad Nueva».</span> Para
                crear productos nuevos agrega filas con Nombre, Precio Venta y
                Precio Compra (deja el SKU vacío para generarlo).
              } @else {
                <span class="font-medium">Archivo con filas de ejemplo</span>
                para ver el formato esperado antes de cargar tus datos.
              }
            </p>
          </div>
        </div>
      }

      <!-- STEP 2: Archivo -->
      @if (step() === 2) {
        <div class="space-y-3">
          <p class="text-xs font-medium text-gray-700">2. Sube tu archivo</p>
          <div
            class="border-2 border-dashed rounded-lg p-5 text-center hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer"
            [class]="selectedFile() ? 'border-green-400 bg-green-50' : 'border-gray-300'"
            (click)="fileInput.click()"
            (dragover)="onDragOver($event)"
            (drop)="onDrop($event)"
          >
            <input
              #fileInput
              type="file"
              accept=".xlsx,.xls,.csv"
              class="hidden"
              (change)="onFileSelected($event)"
            />

            @if (!selectedFile()) {
              <app-icon
                name="upload-cloud"
                [size]="36"
                class="mx-auto text-gray-400 mb-2"
              ></app-icon>
              <p class="text-sm text-gray-900 font-medium">
                Arrastra tu archivo Excel aquí
              </p>
              <p class="text-xs text-gray-500 mt-0.5">
                o haz clic para seleccionar · .xlsx, .xls, .csv · Máx. 10.000
                filas · 20 MB
              </p>
            } @else {
              <app-icon
                name="file-spreadsheet"
                [size]="36"
                class="mx-auto text-green-500 mb-2"
              ></app-icon>
              <p class="text-sm text-gray-900 font-medium break-all">
                {{ selectedFile()!.name }}
              </p>
              <p class="text-xs text-gray-500 mt-0.5">
                {{ formatFileSize(selectedFile()!.size) }}
              </p>
              <button
                type="button"
                class="text-xs text-gray-500 hover:text-red-600 mt-2 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                (click)="removeFile($event)"
              >
                Eliminar archivo
              </button>
            }
          </div>

          @if (isAnalyzing()) {
            <div class="flex flex-col items-center justify-center py-4 gap-3">
              <app-spinner size="lg" [center]="true"></app-spinner>
              <p class="text-sm text-gray-900 font-medium">
                Analizando archivo...
              </p>
              <p class="text-xs text-gray-500">
                Verificando productos, cantidades y ubicación
              </p>
            </div>
          }
        </div>
      }

      <!-- STEP 3: Revisión -->
      @if (step() === 3 && analysis()) {
        <div class="space-y-3">
          <!-- Summary stats cards -->
          <div
            class="flex overflow-x-auto gap-2 pb-1 md:grid md:gap-3 md:overflow-visible"
            [class]="analysis()!.requires_initial_load_ack ? 'md:grid-cols-4' : 'md:grid-cols-3'"
          >
            <div
              class="min-w-[100px] bg-blue-50 px-3 py-2 rounded-lg border border-blue-100 shrink-0"
            >
              <div class="text-[10px] text-blue-600 font-medium">Total Filas</div>
              <div class="text-xl font-bold text-blue-700">
                {{ analysis()!.total }}
              </div>
            </div>
            <div
              class="min-w-[100px] bg-green-50 px-3 py-2 rounded-lg border border-green-100 shrink-0"
            >
              <div class="text-[10px] text-green-600 font-medium">Válidas</div>
              <div class="text-xl font-bold text-green-700">
                {{ analysis()!.valid }}
              </div>
            </div>
            @if (analysis()!.requires_initial_load_ack) {
              <div
                class="min-w-[100px] bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 shrink-0"
              >
                <div class="text-[10px] text-emerald-600 font-medium">
                  Nuevos
                </div>
                <div class="text-xl font-bold text-emerald-700">
                  {{ analysis()!.new_products || 0 }}
                </div>
              </div>
            }
            <div
              class="min-w-[100px] bg-red-50 px-3 py-2 rounded-lg border border-red-100 shrink-0"
            >
              <div class="text-[10px] text-red-600 font-medium">
                Con errores
              </div>
              <div class="text-xl font-bold text-red-700">
                {{ analysis()!.failed }}
              </div>
            </div>
          </div>

          <!-- Consentimiento de carga inicial -->
          @if (analysis()!.requires_initial_load_ack) {
            <div class="space-y-3">
              <app-alert-banner
                variant="warning"
                tone="token"
                heading="Este ajuste contiene productos nuevos"
              >
                {{ analysis()!.new_products }} productos no existen y se
                crearán ({{ analysis()!.auto_sku }} con SKU generado
                automáticamente). Su stock se registrará como Carga inicial e
                incrementará el costo de inventario.
                @if (newProductPreview().length > 0) {
                  <ul
                    class="mt-3 divide-y divide-border rounded-md border border-border bg-surface text-text-primary"
                  >
                    @for (r of newProductPreview(); track r.row_number) {
                      <li class="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span class="flex-1 min-w-0 truncate">{{ r.name }}</span>
                        <span class="tabular-nums font-medium">{{
                          r.quantity
                        }}</span>
                        @if (!r.sku) {
                          <span
                            class="shrink-0 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-medium"
                            >SKU auto</span
                          >
                        }
                      </li>
                    }
                  </ul>
                  @if (newProductsExtra() > 0) {
                    <p class="mt-1.5 text-xs">y {{ newProductsExtra() }} más</p>
                  }
                }
              </app-alert-banner>
              <app-ai-review-ack
                #initialLoadAckBlock
                [(acknowledged)]="initialLoadAck"
                [message]="
                  'Estoy de acuerdo con crear estos productos y registrar su stock como carga inicial.'
                "
              />
            </div>
          }

          @if ((analysis()!.warnings?.length ?? 0) > 0) {
            <app-alert-banner variant="warning" tone="token" heading="Advertencias antes de aplicar">
              <ul class="max-h-52 overflow-y-auto space-y-1">
                @for (warning of analysis()!.warnings; track $index) {
                  <li class="text-xs">
                    <strong>Fila {{ warning.row_number }}</strong>
                    {{ warning.sku ? '(' + warning.sku + ')' : '' }}: {{ warning.message }}
                  </li>
                }
              </ul>
            </app-alert-banner>
          }

          @if (analysis()!.errors.length > 0) {
            <div class="border border-red-100 rounded-lg overflow-hidden">
              <div
                class="bg-red-50 px-3 py-2 border-b border-red-100 text-red-800 font-medium text-xs flex items-center"
              >
                <app-icon
                  name="alert-circle"
                  [size]="14"
                  class="mr-1.5"
                ></app-icon>
                Errores por fila ({{ analysis()!.errors.length }})
              </div>
              <ul class="max-h-52 overflow-y-auto divide-y divide-red-100 bg-surface">
                @for (e of analysis()!.errors; track $index) {
                  <li class="px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                    <span
                      class="shrink-0 rounded-full bg-red-100 text-red-800 px-2 py-0.5 font-medium"
                      >Fila {{ e.row_number }}</span
                    >
                    <span class="font-mono text-gray-600 shrink-0">{{
                      e.sku || '-'
                    }}</span>
                    <span class="min-w-0">{{ e.message }}</span>
                  </li>
                }
              </ul>
            </div>
          }

          <p class="text-xs text-gray-500">
            Se aplicarán las {{ analysis()!.valid }} filas válidas en lotes de
            {{ pageSize }}.
          </p>
        </div>
      }

      <!-- STEP 4: Resultados -->
      @if (step() === 4) {
        <div class="space-y-3">
          @if (isUploading()) {
            <div class="flex flex-col items-center justify-center py-8 gap-3">
              <app-spinner size="lg" [center]="true"></app-spinner>
              <p class="text-sm text-gray-900 font-medium">
                Aplicando ajustes... {{ progress().doneRows }} de
                {{ progress().totalRows }}
              </p>
              <div
                class="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
              >
                <div
                  class="flex items-center justify-between text-[11px] text-gray-600"
                >
                  <span>Lotes de {{ pageSize }} filas</span>
                  <span class="font-semibold text-primary"
                    >{{ progressPercent() }}%</span
                  >
                </div>
                <div
                  class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                >
                  <div
                    class="h-full rounded-full bg-primary transition-all"
                    [style.width.%]="progressPercent()"
                  ></div>
                </div>
              </div>
              <p class="text-xs text-gray-500">
                Se procesa en lotes. Si cierras, los lotes ya confirmados quedan
                aplicados.
              </p>
            </div>
          }

          @if (uploadError() && !isUploading()) {
            <div
              class="bg-red-50 px-3 py-2 rounded-lg border border-red-100 text-red-700 text-xs flex flex-col sm:flex-row sm:items-start gap-2"
            >
              <div class="flex items-start gap-2 flex-1">
                <app-icon
                  name="alert-circle"
                  [size]="14"
                  class="shrink-0 mt-0.5"
                ></app-icon>
                <p>{{ uploadError() }}</p>
              </div>
              @if (retryOffset() !== null) {
                <app-button variant="outline" size="sm" (clicked)="retryUpload()">
                  Reintentar desde la fila {{ retryOffset()! + 2 }}
                </app-button>
              }
            </div>
          }

          @if (uploadResult() && !isUploading()) {
            <!-- Summary -->
            <div class="bg-surface border rounded-lg overflow-hidden">
              <div
                class="bg-gray-50 px-3 py-2 border-b flex justify-between items-center"
              >
                <h4 class="text-sm font-medium text-gray-900">
                  Resumen de Ajuste
                </h4>
                <span class="text-xs text-gray-500"
                  >{{ uploadResult()!.total_processed || 0 }} filas</span
                >
              </div>
              <div class="p-3 grid grid-cols-2 gap-2">
                <div class="bg-green-50 px-3 py-2 rounded border border-green-100">
                  <div class="text-[10px] text-green-600 font-medium">
                    Exitosos
                  </div>
                  <div class="text-xl font-bold text-green-700">
                    {{ uploadResult()!.successful || 0 }}
                  </div>
                </div>
                <div class="bg-red-50 px-3 py-2 rounded border border-red-100">
                  <div class="text-[10px] text-red-600 font-medium">
                    Fallidos
                  </div>
                  <div class="text-xl font-bold text-red-700">
                    {{ uploadResult()!.failed || 0 }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Detail Table -->
            <div class="border rounded-lg overflow-hidden">
              <div
                class="bg-gray-50 px-3 py-2 border-b text-gray-800 font-medium text-xs flex items-center"
              >
                <app-icon name="list" [size]="14" class="mr-1.5"></app-icon>
                Detalle por Producto
              </div>
              <div class="max-h-48 overflow-auto bg-surface">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50 sticky top-0">
                    <tr>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                      <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Cambio</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detalle</th>
                    </tr>
                  </thead>
                  <tbody class="bg-surface divide-y divide-gray-200">
                    @for (item of uploadResult()!.results; track item.row_number) {
                      <tr>
                        <td class="px-3 py-2 text-sm text-gray-900 max-w-[150px] truncate">
                          {{ item.product_name || '—' }}
                        </td>
                        <td class="px-3 py-2 whitespace-nowrap font-mono text-xs text-gray-600">
                          {{ item.sku || '—' }}
                        </td>
                        <td class="px-3 py-2 text-center text-sm tabular-nums">
                          @if (item.status === 'success' && item.quantity_change !== undefined) {
                            <span
                              class="font-medium"
                              [class]="item.quantity_change! < 0 ? 'text-red-600' : 'text-green-600'"
                              >{{ item.quantity_change! > 0 ? '+' : '' }}{{ item.quantity_change }}</span
                            >
                          } @else {
                            <span class="text-gray-400">—</span>
                          }
                        </td>
                        <td class="px-3 py-2 whitespace-nowrap text-sm">
                          <span
                            class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                            [class]="item.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'"
                          >
                            {{ item.status === 'success' ? 'Exitoso' : 'Error' }}
                          </span>
                        </td>
                        <td class="px-3 py-2 text-sm text-gray-600">
                          @if (item.status === 'success' && item.quantity_after !== undefined) {
                            {{ item.quantity_before }} → {{ item.quantity_after }}
                          } @else {
                            {{ item.message || '' }}
                          }
                          @for (warning of item.warnings ?? []; track $index) {
                            <p class="mt-1 text-xs text-amber-700">{{ warning }}</p>
                          }
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

      <!-- Footer -->
      <div
        slot="footer"
        class="flex justify-end gap-2 pt-4 border-t border-gray-200 mt-4"
      >
        @if (step() > 1 && step() < 4 && !isAnalyzing()) {
          <app-button variant="outline" (clicked)="previousStep()">Atrás</app-button>
        }
        @if (step() < 4 || !isUploading()) {
          <app-button variant="outline" (clicked)="onClose()">{{
            step() === 4 ? 'Cerrar' : 'Cancelar'
          }}</app-button>
        }

        @if (step() === 1) {
          <app-button
            variant="primary"
            [disabled]="!selectedLocationId()"
            (clicked)="nextStep()"
          >
            Siguiente
            <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
          </app-button>
        }

        @if (step() === 2) {
          <app-button
            variant="primary"
            [disabled]="!selectedFile() || isAnalyzing()"
            [loading]="isAnalyzing()"
            (clicked)="analyzeFile()"
          >
            <app-icon name="search" [size]="16" slot="icon"></app-icon>
            Analizar Archivo
          </app-button>
        }

        @if (step() === 3) {
          <app-button
            variant="primary"
            [disabled]="
              !analysis() ||
              analysis()!.valid === 0 ||
              (!!analysis()!.requires_initial_load_ack && !initialLoadAck())
            "
            (clicked)="confirmUpload()"
          >
            <app-icon name="upload" [size]="16" slot="icon"></app-icon>
            Aplicar {{ analysis()?.valid || 0 }} ajustes
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class BulkAdjustmentModalComponent {
  readonly isOpen = input(false);
  readonly locations = input<SelectorOption[]>([]);
  readonly isOpenChange = output<boolean>();
  readonly completed = output<void>();

  private inventory_service = inject(InventoryService);
  private toast_service = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly step = signal(1);
  readonly steps: StepsLineItem[] = [
    { label: 'Configurar' },
    { label: 'Archivo' },
    { label: 'Revisar' },
    { label: 'Resultados' },
  ];
  readonly isDownloading = signal(false);
  readonly templateMode = signal<'example' | 'existing'>('existing');
  readonly initialLoadAck = signal(false);
  private readonly initialLoadAckBlock = viewChild<AiReviewAckComponent>('initialLoadAckBlock');
  readonly newProductPreview = computed(() => (this.analysis()?.new_product_rows ?? []).slice(0, 5));
  readonly newProductsExtra = computed(() => Math.max(0, (this.analysis()?.new_products ?? this.analysis()?.new_product_rows?.length ?? 0) - this.newProductPreview().length));
  readonly isUploading = signal(false);

  readonly selectedLocationId = signal<string | number | null>(null);
  readonly selectedAdjustmentType = signal<string>('count_variance');
  readonly description = signal<string>('');
  readonly selectedFile = signal<File | null>(null);
  readonly uploadResult = signal<BulkUploadResult | null>(null);
  readonly isAnalyzing = signal(false);
  readonly analysis = signal<BulkAnalysisResult | null>(null);
  readonly uploadError = signal<string | null>(null);
  readonly pageSize = BULK_ADJUSTMENT_PAGE_SIZE;
  private readonly progressState = signal({ doneRows: 0, totalRows: 0 });
  readonly progress = this.progressState.asReadonly();
  readonly progressPercent = computed(() => {
    const p = this.progressState();
    return p.totalRows > 0
      ? Math.min(100, Math.round((p.doneRows / p.totalRows) * 100))
      : 0;
  });
  /** Offset (base 0) desde el que se puede reintentar tras una página fallida. */
  readonly retryOffset = signal<number | null>(null);
  private sessionId: string | null = null;

  readonly failedItems = computed<BulkResultItem[]>(() => {
    const r = this.uploadResult();
    return r?.results.filter((x) => x.status === 'error') || [];
  });

  readonly adjustmentTypeOptions: SelectorOption[] = [
    { value: 'count_variance', label: 'Varianza de conteo' },
    { value: 'manual_correction', label: 'Corrección manual' },
    { value: 'damage', label: 'Daño' },
    { value: 'loss', label: 'Pérdida' },
    { value: 'theft', label: 'Robo / Hurto' },
    { value: 'expiration', label: 'Vencimiento' },
  ];

  nextStep(): void {
    if (this.step() < 2) this.step.set(this.step() + 1);
  }

  previousStep(): void {
    if (this.step() === 3) {
      this.cancelSession();
      this.analysis.set(null);
      this.initialLoadAck.set(false);
    }
    if (this.step() > 1) this.step.set(this.step() - 1);
  }

  downloadTemplate(): void {
    this.isDownloading.set(true);
    const locId = this.selectedLocationId();
    const location_id = locId !== null && locId !== '' ? Number(locId) : undefined;

    this.inventory_service.downloadAdjustmentTemplate(location_id, this.templateMode())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `plantilla_ajuste_inventario_${new Date().toISOString().split('T')[0]}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.isDownloading.set(false);
          this.toast_service.success('Plantilla descargada');
        },
        error: (err) => {
          this.toast_service.error(err || 'Error al descargar plantilla');
          this.isDownloading.set(false);
        },
      });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.setFile(input.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer?.files.length) {
      this.setFile(event.dataTransfer.files[0]);
    }
  }

  removeFile(event: Event): void {
    event.stopPropagation();
    this.selectedFile.set(null);
  }

  private setFile(file: File): void {
    if (file.size > BULK_ADJUSTMENT_MAX_FILE_MB * 1024 * 1024) {
      this.toast_service.error(
        `El archivo excede el límite de ${BULK_ADJUSTMENT_MAX_FILE_MB} MB`,
      );
      return;
    }
    this.selectedFile.set(file);
  }

  /** Paso 2 -> 3: analiza el archivo y abre la sesión sin aplicar nada. */
  analyzeFile(): void {
    const file = this.selectedFile();
    const locId = this.selectedLocationId();
    if (!file || !locId) return;

    this.initialLoadAck.set(false);
    this.isAnalyzing.set(true);
    this.uploadError.set(null);

    this.inventory_service
      .analyzeBulkAdjustments(
        file,
        Number(locId),
        this.selectedAdjustmentType() || 'count_variance',
        this.description() || undefined,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const result = response.data as BulkAnalysisResult;
          if (result.total > 10000) {
            this.sessionId = result.session_id;
            this.cancelSession();
            this.toast_service.error('El archivo excede el límite de 10.000 filas');
            this.isAnalyzing.set(false);
            return;
          }
          this.sessionId = result.session_id;
          this.analysis.set(result);
          this.isAnalyzing.set(false);
          this.step.set(3);
        },
        error: (err) => {
          this.toast_service.error(err || 'Error al analizar el archivo');
          this.isAnalyzing.set(false);
        },
      });
  }

  /** Paso 3 -> 4: commit paginado de 100 en 100. */
  confirmUpload(): void {
    if (this.analysis()?.requires_initial_load_ack && !this.initialLoadAck()) {
      this.initialLoadAckBlock()?.requestAttention();
      return;
    }
    this.uploadResult.set(null);
    this.progressState.set({
      doneRows: 0,
      totalRows: this.analysis()?.total ?? 0,
    });
    this.runCommit(0);
  }

  retryUpload(): void {
    const offset = this.retryOffset();
    if (offset === null) return;
    this.runCommit(offset);
  }

  private runCommit(startOffset: number): void {
    const sessionId = this.sessionId;
    const locId = this.selectedLocationId();
    if (!sessionId || !locId) return;

    const location_id = Number(locId);
    const type = this.selectedAdjustmentType() || 'count_variance';
    const desc = this.description() || undefined;
    const initialLoadAck =
      this.analysis()?.requires_initial_load_ack === true ? true : undefined;
    const limit = BULK_ADJUSTMENT_PAGE_SIZE;
    let nextOffset = startOffset;
    let lastDone = false;

    this.isUploading.set(true);
    this.uploadError.set(null);
    this.retryOffset.set(null);
    this.step.set(4);

    const fetchPage = (offset: number) =>
      this.inventory_service.uploadBulkAdjustmentsSessionPage(
        sessionId,
        location_id,
        offset,
        limit,
        type,
        desc,
        initialLoadAck,
      );

    fetchPage(startOffset)
      .pipe(
        expand((response) => {
          const page = response.data as BulkUploadPage;
          return page.done ? EMPTY : fetchPage(page.offset + page.limit);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          const page = response.data as BulkUploadPage;
          lastDone = page.done;
          nextOffset = page.offset + page.limit;
          this.progressState.update((p) => ({
            totalRows: page.total > 0 ? page.total : p.totalRows,
            doneRows: Math.min(page.total, nextOffset),
          }));
          const prev = this.uploadResult();
          this.uploadResult.set({
            success: (prev?.success ?? true) && (page.failed ?? 0) === 0,
            total_processed:
              (prev?.total_processed ?? 0) + (page.total_processed ?? 0),
            successful: (prev?.successful ?? 0) + (page.successful ?? 0),
            failed: (prev?.failed ?? 0) + (page.failed ?? 0),
            results: [...(prev?.results ?? []), ...(page.results ?? [])],
          });
        },
        error: (err) => {
          this.isUploading.set(false);
          this.retryOffset.set(nextOffset);
          this.uploadError.set(
            `Se detuvo en la fila ${nextOffset + 2}: ${
              typeof err === 'string' ? err : err?.message || 'error de red'
            }`,
          );
          this.toast_service.error('Error al aplicar los ajustes');
          if ((this.uploadResult()?.successful ?? 0) > 0) this.completed.emit();
        },
        complete: () => {
          this.isUploading.set(false);
          const result = this.uploadResult();
          if (!lastDone) return;
          // Respuesta final recibida: ya no se necesita reintentar esta sesión.
          this.cancelSession();
          if (result?.failed === 0) {
            this.toast_service.success(
              `${result.successful} ajustes aplicados exitosamente`,
            );
          } else {
            this.toast_service.warning(
              `${result?.successful ?? 0} exitosos, ${result?.failed ?? 0} con errores`,
            );
          }
          this.completed.emit();
        },
      });
  }

  private cancelSession(): void {
    const id = this.sessionId;
    if (!id) return;
    this.sessionId = null;
    this.inventory_service
      .cancelBulkAdjustmentSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  getFailedItems(): BulkResultItem[] {
    return this.failedItems();
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  onClose(): void {
    // Cierre antes de confirmar o con reintento pendiente: libera el archivo temporal.
    this.cancelSession();
    this.resetState();
    this.isOpenChange.emit(false);
  }

  private resetState(): void {
    this.step.set(1);
    this.selectedFile.set(null);
    this.uploadResult.set(null);
    this.analysis.set(null);
    this.initialLoadAck.set(false);
    this.templateMode.set('existing');
    this.uploadError.set(null);
    this.retryOffset.set(null);
    this.progressState.set({ doneRows: 0, totalRows: 0 });
    this.isAnalyzing.set(false);
    this.isUploading.set(false);
    this.isDownloading.set(false);
    this.description.set('');
  }

}
