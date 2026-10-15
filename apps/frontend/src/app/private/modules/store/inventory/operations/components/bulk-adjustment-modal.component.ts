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
        <ol class="flex items-center justify-center mb-6" aria-label="Progreso">
          @for (s of stepLabels; track s.n; let last = $last) {
            <li class="flex items-center" [attr.aria-current]="step() === s.n ? 'step' : null">
              <div class="flex flex-col items-center gap-1 w-16 sm:w-20">
                <span
                  class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border transition-colors"
                  [class]="step() >= s.n ? 'bg-primary border-primary text-white' : 'bg-surface border-border text-text-secondary'"
                >
                  @if (step() > s.n) {
                    <app-icon name="check" [size]="16"></app-icon>
                  } @else {
                    {{ s.n }}
                  }
                </span>
                <span
                  class="text-[11px] leading-tight text-center"
                  [class]="step() === s.n ? 'text-text-primary font-medium' : 'text-text-secondary'"
                >{{ s.label }}</span>
              </div>
              @if (!last) {
                <span
                  class="h-0.5 w-6 sm:w-12 -mt-5 rounded transition-colors"
                  [class]="step() > s.n ? 'bg-primary' : 'bg-border'"
                ></span>
              }
            </li>
          }
        </ol>

        <!-- Step 1: Configuration -->
        @if (step() === 1) {
          <div class="space-y-5">
            <h3 class="text-base font-semibold text-text-primary">Configuración</h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div class="space-y-3 pt-4 border-t border-border">
              <p class="text-sm font-medium text-text-primary" id="bulk-adj-template-label">Plantilla</p>
              <div
                class="grid grid-cols-1 sm:grid-cols-2 gap-3"
                role="radiogroup"
                aria-labelledby="bulk-adj-template-label"
              >
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="templateMode() === 'existing'"
                  class="flex items-start gap-3 text-left rounded-lg border p-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                  [class]="templateMode() === 'existing' ? 'border-primary bg-primary/5' : 'border-border bg-surface hover:border-primary/40'"
                  (click)="templateMode.set('existing')"
                >
                  <app-icon
                    name="package-search"
                    [size]="20"
                    class="mt-0.5 shrink-0"
                    [class]="templateMode() === 'existing' ? 'text-primary' : 'text-text-secondary'"
                  ></app-icon>
                  <span class="min-w-0">
                    <span class="block text-sm font-medium text-text-primary">Productos existentes</span>
                    <span class="block text-xs text-text-secondary mt-0.5">Con el stock actual de la ubicación.</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="templateMode() === 'example'"
                  class="flex items-start gap-3 text-left rounded-lg border p-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                  [class]="templateMode() === 'example' ? 'border-primary bg-primary/5' : 'border-border bg-surface hover:border-primary/40'"
                  (click)="templateMode.set('example')"
                >
                  <app-icon
                    name="file-text"
                    [size]="20"
                    class="mt-0.5 shrink-0"
                    [class]="templateMode() === 'example' ? 'text-primary' : 'text-text-secondary'"
                  ></app-icon>
                  <span class="min-w-0">
                    <span class="block text-sm font-medium text-text-primary">Plantilla de ejemplo</span>
                    <span class="block text-xs text-text-secondary mt-0.5">Filas de muestra para ver el formato.</span>
                  </span>
                </button>
              </div>

              <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                <app-button
                  variant="outline"
                  size="sm"
                  [disabled]="isDownloading() || (templateMode() === 'existing' && !selectedLocationId())"
                  [loading]="isDownloading()"
                  (clicked)="downloadTemplate()"
                >
                  <div class="flex items-center gap-2">
                    <app-icon slot="icon" name="download" [size]="16"></app-icon>
                    <span>Descargar plantilla</span>
                  </div>
                </app-button>
                @if (templateMode() === 'existing' && !selectedLocationId()) {
                  <span class="text-xs text-text-secondary">Seleccione una ubicación para habilitar la descarga.</span>
                }
              </div>

              <p class="text-xs text-text-secondary leading-relaxed">
                @if (templateMode() === 'existing') {
                  Edite «Cantidad Nueva». Para crear productos nuevos agregue filas con Nombre, Precio Venta y Precio Compra (deje el SKU vacío para generarlo).
                } @else {
                  Archivo con filas de ejemplo para ver el formato esperado.
                }
              </p>
            </div>
          </div>
        }

        <!-- Step 2: File Upload -->
        @if (step() === 2) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-text-primary">Subir archivo</h3>

            <!-- Drop zone -->
            <div
              class="border-2 border-dashed rounded-lg p-6 sm:p-8 text-center transition-colors cursor-pointer bg-surface hover:border-primary hover:bg-primary/5"
              [class]="selectedFile() ? 'border-primary bg-primary/5' : 'border-border'"
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
                <app-icon name="upload-cloud" [size]="36" class="mx-auto mb-3 text-text-secondary"></app-icon>
                <p class="text-sm text-text-primary font-medium">
                  Haga clic o arrastre un archivo aquí
                </p>
                <p class="text-xs text-text-secondary mt-1">
                  Excel (.xlsx, .xls) o CSV · Máx. 10.000 filas · 20 MB
                </p>
              } @else {
                <app-icon name="file-spreadsheet" [size]="36" class="mx-auto mb-3 text-primary"></app-icon>
                <p class="text-sm font-medium text-text-primary break-all">{{ selectedFile()!.name }}</p>
                <p class="text-xs text-text-secondary mt-1">
                  {{ formatFileSize(selectedFile()!.size) }}
                </p>
                <button
                  type="button"
                  class="text-xs text-text-secondary hover:text-[var(--color-error,#dc2626)] mt-2 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
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
            <h3 class="text-base font-semibold text-text-primary">Revisión</h3>
            <div class="grid grid-cols-3 gap-3">
              <div class="bg-surface border border-border rounded-lg p-3 text-center">
                <p class="text-2xl font-semibold text-text-primary tabular-nums">{{ analysis()!.total }}</p>
                <p class="text-xs text-text-secondary mt-0.5">Total</p>
              </div>
              <div class="bg-surface border border-border rounded-lg p-3 text-center">
                <p class="text-2xl font-semibold text-text-primary tabular-nums">{{ analysis()!.valid }}</p>
                <p class="text-xs text-text-secondary mt-0.5">Válidas</p>
              </div>
              <div class="bg-surface border border-border rounded-lg p-3 text-center">
                <p
                  class="text-2xl font-semibold tabular-nums"
                  [class]="analysis()!.failed > 0 ? 'text-[var(--color-error,#dc2626)]' : 'text-text-primary'"
                >{{ analysis()!.failed }}</p>
                <p class="text-xs text-text-secondary mt-0.5">Con errores</p>
              </div>
            </div>
            @if (analysis()!.errors.length > 0) {
              <div class="max-h-60 overflow-y-auto bg-surface border border-border rounded-lg p-3">
                <p class="text-sm font-medium text-text-primary mb-2">Errores por fila</p>
                <ul class="space-y-1">
                  @for (e of analysis()!.errors; track $index) {
                    <li class="text-xs text-text-secondary">
                      <span class="font-medium text-text-primary">Fila {{ e.row_number }}</span>
                      <span class="font-mono"> ({{ e.sku || '-' }})</span>: {{ e.message }}
                    </li>
                  }
                </ul>
              </div>
            }
            @if (analysis()!.requires_initial_load_ack) {
              <app-alert-banner
                variant="warning"
                tone="token"
                heading="Este ajuste contiene productos nuevos"
              >
                {{ analysis()!.new_products }} productos no existen y se crearán
                ({{ analysis()!.auto_sku }} con SKU generado automáticamente). Su
                stock se registrará como Carga inicial e incrementará el costo de
                inventario.
                @if (newProductPreview().length > 0) {
                  <ul class="mt-3 divide-y divide-border rounded-md border border-border bg-surface text-text-primary">
                    @for (r of newProductPreview(); track r.row_number) {
                      <li class="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span class="flex-1 min-w-0 truncate">{{ r.name }}</span>
                        <span class="tabular-nums font-medium">{{ r.quantity }}</span>
                        @if (!r.sku) {
                          <span class="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-text-secondary">SKU auto</span>
                        }
                      </li>
                    }
                  </ul>
                  @if (newProductsExtra() > 0) {
                    <p class="mt-1.5 text-xs">y {{ newProductsExtra() }} más</p>
                  }
                }
              </app-alert-banner>
              <div class="pt-1">
                <app-ai-review-ack
                  #initialLoadAckBlock
                  [(acknowledged)]="initialLoadAck"
                  [message]="'Estoy de acuerdo con crear estos productos y registrar su stock como carga inicial.'"
                />
              </div>
            }
            <p class="text-xs text-text-secondary">
              Se aplicarán las {{ analysis()!.valid }} filas válidas en lotes de {{ pageSize }}.
            </p>
          </div>
        }

        <!-- Step 4: Results -->
        @if (step() === 4) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-text-primary">Resultado</h3>

            @if (isUploading()) {
              <div class="flex flex-col items-center justify-center py-8 gap-3">
                <app-icon
                  name="loader"
                  [size]="36"
                  class="text-primary animate-spin"
                ></app-icon>
                <p class="text-sm text-text-primary font-medium">
                  Guardando {{ progress().doneRows }} de {{ progress().totalRows }}
                </p>
                <div class="w-full rounded-lg border border-border bg-surface px-3 py-2">
                  <div class="flex items-center justify-between text-[11px] text-text-secondary">
                    <span>Lotes de {{ pageSize }} filas</span>
                    <span class="font-semibold text-primary">{{ progressPercent() }}%</span>
                  </div>
                  <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      class="h-full rounded-full bg-primary transition-all"
                      [style.width.%]="progressPercent()"
                    ></div>
                  </div>
                </div>
              </div>
            }

            @if (uploadError() && !isUploading()) {
              <div class="bg-surface border border-[var(--color-error,#dc2626)] rounded-lg p-3 flex flex-col sm:flex-row sm:items-start gap-2 text-xs text-text-primary">
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
                <div class="bg-surface border border-border rounded-lg p-3 text-center">
                  <p class="text-2xl font-semibold text-text-primary tabular-nums">{{ uploadResult()!.total_processed }}</p>
                  <p class="text-xs text-text-secondary mt-0.5">Total</p>
                </div>
                <div class="bg-surface border border-border rounded-lg p-3 text-center">
                  <p class="text-2xl font-semibold text-text-primary tabular-nums">{{ uploadResult()!.successful }}</p>
                  <p class="text-xs text-text-secondary mt-0.5">Exitosos</p>
                </div>
                <div class="bg-surface border border-border rounded-lg p-3 text-center">
                  <p
                    class="text-2xl font-semibold tabular-nums"
                    [class]="uploadResult()!.failed > 0 ? 'text-[var(--color-error,#dc2626)]' : 'text-text-primary'"
                  >{{ uploadResult()!.failed }}</p>
                  <p class="text-xs text-text-secondary mt-0.5">Fallidos</p>
                </div>
              </div>

              <!-- Results Table -->
              <div class="max-h-64 overflow-auto border border-border rounded-lg">
                <table class="w-full text-xs">
                  <thead class="bg-surface sticky top-0">
                    <tr>
                      <th class="px-3 py-2 text-left font-medium text-text-secondary">Fila</th>
                      <th class="px-3 py-2 text-left font-medium text-text-secondary">SKU</th>
                      <th class="px-3 py-2 text-left font-medium text-text-secondary">Producto</th>
                      <th class="px-3 py-2 text-center font-medium text-text-secondary">Cambio</th>
                      <th class="px-3 py-2 text-center font-medium text-text-secondary">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (item of uploadResult()!.results; track item.row_number) {
                      <tr class="border-t border-border text-text-primary">
                        <td class="px-3 py-2 text-text-secondary">{{ item.row_number }}</td>
                        <td class="px-3 py-2 font-mono">{{ item.sku }}</td>
                        <td class="px-3 py-2">{{ item.product_name || '-' }}</td>
                        <td class="px-3 py-2 text-center tabular-nums">
                          @if (item.status === 'success' && item.quantity_change !== undefined) {
                            <span>{{ item.quantity_change! > 0 ? '+' : '' }}{{ item.quantity_change }}</span>
                          } @else {
                            <span class="text-text-secondary">-</span>
                          }
                        </td>
                        <td class="px-3 py-2 text-center">
                          @if (item.status === 'success') {
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border border-border text-text-secondary">OK</span>
                          } @else {
                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border border-[var(--color-error,#dc2626)] text-[var(--color-error,#dc2626)]" [title]="item.message || ''">Error</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              @if (uploadResult()!.failed > 0) {
                <!-- Error details -->
                <div class="max-h-60 overflow-y-auto bg-surface border border-border rounded-lg p-3">
                  <p class="text-sm font-medium text-text-primary mb-2">Errores encontrados</p>
                  <ul class="space-y-1">
                    @for (item of failedItems(); track item.row_number) {
                      <li class="text-xs text-text-secondary">
                        <span class="font-medium text-text-primary">Fila {{ item.row_number }}</span>
                        <span class="font-mono"> ({{ item.sku }})</span>: {{ item.message }}
                      </li>
                    }
                  </ul>
                </div>
              }
            }
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 p-3 bg-surface rounded-b-xl border-t border-border">
          <div class="flex flex-col sm:flex-row">
            @if (step() > 1 && step() < 4 && !isAnalyzing()) {
              <app-button variant="outline" (clicked)="previousStep()">
                Atrás
              </app-button>
            }
          </div>
          <div class="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3">
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
                [disabled]="!analysis() || analysis()!.valid === 0 || (!!analysis()!.requires_initial_load_ack && !initialLoadAck())"
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
  readonly stepLabels = [
    { n: 1, label: 'Config.' },
    { n: 2, label: 'Archivo' },
    { n: 3, label: 'Revisión' },
    { n: 4, label: 'Resultado' },
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
