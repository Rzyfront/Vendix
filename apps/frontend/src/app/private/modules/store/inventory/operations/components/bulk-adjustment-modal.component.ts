import { Component, signal, inject, input, output, DestroyRef, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
          @for (s of [1, 2, 3]; track s) {
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors"
              [class.bg-primary]="step() >= s"
              [class.text-white]="step() >= s"
              [class.bg-gray-200]="step() < s"
              [class.text-gray-500]="step() < s"
            >{{ s }}</div>
            @if (s < 3) {
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
                  <app-icon name="download" [size]="16"></app-icon>
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
                  Formatos aceptados: Excel (.xlsx, .xls) o CSV
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

        <!-- Step 3: Results -->
        @if (step() === 3) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-gray-800">Resultado</h3>

            @if (isUploading()) {
              <div class="flex flex-col items-center justify-center py-8 gap-3">
                <app-icon
                  name="loader"
                  [size]="36"
                  class="text-primary animate-spin"
                ></app-icon>
                <p class="text-sm text-gray-900 font-medium">Procesando ajustes...</p>
              </div>
            }

            @if (uploadResult()) {
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
            @if (step() > 1 && step() < 3) {
              <app-button variant="outline" (clicked)="previousStep()">
                Atrás
              </app-button>
            }
          </div>
          <div class="flex items-center gap-3">
            <app-button variant="outline" (clicked)="onClose()">
              {{ step() === 3 ? 'Cerrar' : 'Cancelar' }}
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
                [disabled]="!selectedFile() || isUploading()"
                [loading]="isUploading()"
                (clicked)="uploadFile()"
              >
                Subir y Aplicar
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
    if (this.step() < 3) this.step.set(this.step() + 1);
  }

  previousStep(): void {
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
    if (event.dataTransfer?.files.length) {
      this.selectedFile.set(event.dataTransfer.files[0]);
    }
  }

  removeFile(event: Event): void {
    event.stopPropagation();
    this.selectedFile.set(null);
  }

  uploadFile(): void {
    const file = this.selectedFile();
    const locId = this.selectedLocationId();
    if (!file || !locId) return;

    this.isUploading.set(true);
    this.step.set(3);

    this.inventory_service.uploadBulkAdjustments(
      file,
      Number(locId),
      this.selectedAdjustmentType() || 'count_variance',
      this.description() || undefined,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const result = response.data as BulkUploadResult;
          this.uploadResult.set(result);
          this.isUploading.set(false);

          if (result?.failed === 0) {
            this.toast_service.success(
              `${result.successful} ajustes aplicados exitosamente`,
            );
          } else {
            this.toast_service.warning(
              `${result?.successful} exitosos, ${result?.failed} con errores`,
            );
          }

          this.completed.emit();
        },
        error: (err) => {
          this.toast_service.error(err || 'Error al procesar el archivo');
          this.isUploading.set(false);
          this.step.set(2);
        },
      });
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
    this.resetState();
    this.isOpenChange.emit(false);
  }

  private resetState(): void {
    this.step.set(1);
    this.selectedFile.set(null);
    this.uploadResult.set(null);
    this.isUploading.set(false);
    this.isDownloading.set(false);
    this.description.set('');
  }

}
