import { Component, signal, inject, input, output, DestroyRef, computed } from '@angular/core';
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
} from '../../../../../../shared/components/index';

import { InventoryService } from '../../services';

interface BulkResultItem {
  row_number: number;
  sku: string;
  product_name?: string;
  status: 'success' | 'error';
  message?: string;
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
    IconComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Ajuste Masivo de Inventario"
      subtitle="Suba un archivo Excel o CSV para ajustar el inventario de múltiples productos"
      size="lg"
    >
      <div class="p-4 md:p-6">
        <!-- Step Indicator -->
        <div class="flex items-center justify-center gap-2 mb-6">
          @for (s of [1, 2, 3, 4]; track s) {
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors"
              [class.bg-primary]="step() >= s"
              [class.text-white]="step() >= s"
              [class.bg-gray-200]="step() < s"
              [class.text-gray-500]="step() < s"
            >{{ s }}</div>
            @if (s < 4) {
              <div
                class="w-12 h-0.5 transition-colors"
                [class.bg-primary]="step() > s"
                [class.bg-gray-200]="step() <= s"
              ></div>
            }
          }
        </div>

        <!-- Step 1: Configuration -->
        @if (step() === 1) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-gray-800">Configuración</h3>

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

            <app-textarea
              label="Descripción general (opcional)"
              [ngModel]="description()"
              (ngModelChange)="description.set($event)"
              placeholder="Ej: Conteo físico mensual de marzo"
              [rows]="2"
            ></app-textarea>

            <div class="pt-2">
              <app-button
                variant="outline"
                size="sm"
                [disabled]="!selectedLocationId() || isDownloading()"
                [loading]="isDownloading()"
                (clicked)="downloadTemplate()"
              >
                <div class="flex items-center gap-2">
                  <app-icon slot="icon" name="download" [size]="16"></app-icon>
                  <span>Descargar plantilla</span>
                </div>
              </app-button>
              <p class="text-xs text-gray-500 mt-1">
                La plantilla incluirá los productos con stock en la ubicación seleccionada
              </p>
            </div>
          </div>
        }

        <!-- Step 2: File Upload -->
        @if (step() === 2) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-gray-800">Subir archivo</h3>

            <!-- Drop zone -->
            <div
              class="border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer"
              [class.border-gray-300]="!selectedFile()"
              [class.border-primary]="selectedFile()"
              [class.bg-primary-50]="selectedFile()"
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
                <app-icon name="upload-cloud" [size]="40" class="mx-auto mb-3 text-gray-400"></app-icon>
                <p class="text-sm text-gray-600 font-medium">
                  Haga clic o arrastre un archivo aquí
                </p>
                <p class="text-xs text-gray-400 mt-1">
                  Formatos aceptados: Excel (.xlsx, .xls) o CSV · Máx. 10.000 filas · 20 MB
                </p>
              } @else {
                <app-icon name="file-spreadsheet" [size]="40" class="mx-auto mb-3 text-primary"></app-icon>
                <p class="text-sm font-medium text-gray-800">{{ selectedFile()!.name }}</p>
                <p class="text-xs text-gray-500 mt-1">
                  {{ formatFileSize(selectedFile()!.size) }}
                </p>
                <button
                  class="text-xs text-red-500 hover:text-red-700 mt-2 underline"
                  (click)="removeFile($event)"
                >
                  Eliminar archivo
                </button>
              }
            </div>
          </div>
        }

        <!-- Step 3: Review analysis -->
        @if (step() === 3 && analysis()) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-gray-800">Revisión</h3>
            <div class="grid grid-cols-3 gap-3">
              <div class="bg-gray-50 rounded-lg p-3 text-center">
                <p class="text-2xl font-bold text-gray-800">{{ analysis()!.total }}</p>
                <p class="text-xs text-gray-500">Filas</p>
              </div>
              <div class="bg-green-50 rounded-lg p-3 text-center">
                <p class="text-2xl font-bold text-green-600">{{ analysis()!.valid }}</p>
                <p class="text-xs text-gray-500">Válidas</p>
              </div>
              <div class="bg-red-50 rounded-lg p-3 text-center">
                <p class="text-2xl font-bold text-red-600">{{ analysis()!.failed }}</p>
                <p class="text-xs text-gray-500">Con errores</p>
              </div>
            </div>
            @if (analysis()!.errors.length > 0) {
              <div class="max-h-48 overflow-y-auto bg-red-50 border border-red-200 rounded-lg p-3">
                <p class="text-sm font-medium text-red-800 mb-2">Errores por fila:</p>
                @for (e of analysis()!.errors; track $index) {
                  <p class="text-xs text-red-700">
                    Fila {{ e.row_number }} ({{ e.sku || '-' }}): {{ e.message }}
                  </p>
                }
              </div>
            }
            <p class="text-xs text-gray-500">
              Se aplicarán las {{ analysis()!.valid }} filas válidas en lotes de {{ pageSize }}.
            </p>
          </div>
        }

        <!-- Step 4: Results -->
        @if (step() === 4) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-gray-800">Resultado</h3>

            @if (isUploading()) {
              <div class="flex flex-col items-center justify-center py-8 gap-3">
                <app-icon
                  name="loader"
                  [size]="36"
                  class="text-primary animate-spin"
                ></app-icon>
                <p class="text-sm text-gray-900 font-medium">
                  Guardando {{ progress().doneRows }} de {{ progress().totalRows }}
                </p>
                <div class="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <div class="flex items-center justify-between text-[11px] text-gray-600">
                    <span>Lotes de {{ pageSize }} filas</span>
                    <span class="font-semibold text-primary">{{ progressPercent() }}%</span>
                  </div>
                  <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      class="h-full rounded-full bg-primary transition-all"
                      [style.width.%]="progressPercent()"
                    ></div>
                  </div>
                </div>
              </div>
            }

            @if (uploadError() && !isUploading()) {
              <div class="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-xs text-red-700">
                <p class="flex-1">{{ uploadError() }}</p>
                @if (retryOffset() !== null) {
                  <app-button variant="outline" size="sm" (clicked)="retryUpload()">
                    Reintentar desde la fila {{ retryOffset()! + 2 }}
                  </app-button>
                }
              </div>
            }

            @if (uploadResult() && !isUploading()) {
              <!-- Summary -->
              <div class="grid grid-cols-3 gap-3">
                <div class="bg-gray-50 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-gray-800">{{ uploadResult()!.total_processed }}</p>
                  <p class="text-xs text-gray-500">Total</p>
                </div>
                <div class="bg-green-50 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-green-600">{{ uploadResult()!.successful }}</p>
                  <p class="text-xs text-gray-500">Exitosos</p>
                </div>
                <div class="bg-red-50 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-red-600">{{ uploadResult()!.failed }}</p>
                  <p class="text-xs text-gray-500">Fallidos</p>
                </div>
              </div>

              <!-- Results Table -->
              <div class="max-h-64 overflow-y-auto border rounded-lg">
                <table class="w-full text-xs">
                  <thead class="bg-gray-50 sticky top-0">
                    <tr>
                      <th class="px-3 py-2 text-left font-medium text-gray-600">Fila</th>
                      <th class="px-3 py-2 text-left font-medium text-gray-600">SKU</th>
                      <th class="px-3 py-2 text-left font-medium text-gray-600">Producto</th>
                      <th class="px-3 py-2 text-center font-medium text-gray-600">Cambio</th>
                      <th class="px-3 py-2 text-center font-medium text-gray-600">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (item of uploadResult()!.results; track item.row_number) {
                      <tr
                        class="border-t"
                        [class.bg-red-50]="item.status === 'error'"
                      >
                        <td class="px-3 py-2 text-gray-500">{{ item.row_number }}</td>
                        <td class="px-3 py-2 font-mono">{{ item.sku }}</td>
                        <td class="px-3 py-2">{{ item.product_name || '-' }}</td>
                        <td class="px-3 py-2 text-center">
                          @if (item.status === 'success' && item.quantity_change !== undefined) {
                            <span [class.text-green-600]="item.quantity_change! > 0" [class.text-red-600]="item.quantity_change! < 0" [class.text-gray-400]="item.quantity_change === 0">
                              {{ item.quantity_change! > 0 ? '+' : '' }}{{ item.quantity_change }}
                            </span>
                          } @else {
                            <span class="text-gray-400">-</span>
                          }
                        </td>
                        <td class="px-3 py-2 text-center">
                          @if (item.status === 'success') {
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">OK</span>
                          } @else {
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800" [title]="item.message || ''">Error</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              @if (uploadResult()!.failed > 0) {
                <!-- Error details -->
                <div class="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p class="text-sm font-medium text-red-800 mb-2">Errores encontrados:</p>
                  @for (item of failedItems(); track item.row_number) {
                    <p class="text-xs text-red-700">
                      Fila {{ item.row_number }} ({{ item.sku }}): {{ item.message }}
                    </p>
                  }
                </div>
              }
            }
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <div>
            @if (step() > 1 && step() < 4 && !isAnalyzing()) {
              <app-button variant="outline" (clicked)="previousStep()">
                Atrás
              </app-button>
            }
          </div>
          <div class="flex items-center gap-3">
            <app-button variant="outline" [disabled]="isUploading()" (clicked)="onClose()">
              {{ step() === 4 && !isUploading() ? 'Cerrar' : 'Cancelar' }}
            </app-button>

            @if (step() === 1) {
              <app-button
                variant="primary"
                [disabled]="!selectedLocationId()"
                (clicked)="nextStep()"
              >
                Siguiente
              </app-button>
            }

            @if (step() === 2) {
              <app-button
                variant="primary"
                [disabled]="!selectedFile() || isAnalyzing()"
                [loading]="isAnalyzing()"
                (clicked)="analyzeFile()"
              >
                Analizar archivo
              </app-button>
            }

            @if (step() === 3) {
              <app-button
                variant="primary"
                [disabled]="!analysis() || analysis()!.valid === 0"
                (clicked)="confirmUpload()"
              >
                Aplicar {{ analysis()?.valid || 0 }} ajustes
              </app-button>
            }
          </div>
        </div>
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
  readonly isDownloading = signal(false);
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
    }
    if (this.step() > 1) this.step.set(this.step() - 1);
  }

  downloadTemplate(): void {
    this.isDownloading.set(true);
    const locId = this.selectedLocationId();
    const location_id = locId !== null && locId !== '' ? Number(locId) : undefined;

    this.inventory_service.downloadAdjustmentTemplate(location_id)
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
          this.sessionId = null; // el backend ya borró el archivo (done)
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
    this.uploadError.set(null);
    this.retryOffset.set(null);
    this.progressState.set({ doneRows: 0, totalRows: 0 });
    this.isAnalyzing.set(false);
    this.isUploading.set(false);
    this.isDownloading.set(false);
    this.description.set('');
  }

}
