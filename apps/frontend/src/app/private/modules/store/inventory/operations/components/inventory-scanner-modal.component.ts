import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, switchMap, catchError, map, of } from 'rxjs';

import {
  ModalComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
  IconComponent,
  StepsLineComponent,
  StepsLineItem,
  BadgeComponent,
  SpinnerComponent,
  InputsearchComponent,
  ToastService,
} from '../../../../../../shared/components';

import { InventoryService, InventoryScannerService } from '../../services';
import {
  InventoryCountScanResponse,
  MatchedCountProduct,
  BatchCreateAdjustmentsRequest,
  AdjustableProduct,
  AdjustmentType,
} from '../../interfaces';

/**
 * Copia editable de `MatchedCountProduct` con un campo extra `note`
 * (descripción del ajuste, default "Reconteo por IA"). Se nombra `note`
 * y no `description` para no chocar con `MatchedCountProduct.description`
 * (texto OCR del item contado, ya usado como etiqueta del producto).
 */
interface EditableCountRow extends MatchedCountProduct {
  note: string;
}

@Component({
  selector: 'app-inventory-scanner-modal',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    ModalComponent,
    ButtonComponent,
    SelectorComponent,
    IconComponent,
    StepsLineComponent,
    BadgeComponent,
    SpinnerComponent,
    InputsearchComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      (closed)="closed.emit()"
      size="xl"
      title="Escanear Reconteo de Inventario"
      subtitle="Escanea una hoja de conteo físico para ajustar el inventario"
    >
      <!-- Steps indicator -->
      <div class="mb-6">
        <app-steps-line
          [steps]="wizardSteps"
          [currentStep]="currentStep()"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- ============ Paso 0: SUBIR ============ -->
      @if (currentStep() === 0) {
        <div class="space-y-4">
          <!-- Ubicación (requerida) -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Ubicación *
            </label>
            <app-selector
              [options]="locations()"
              [ngModel]="selectedLocationId()"
              placeholder="Seleccionar ubicación"
              (ngModelChange)="onLocationChange($event)"
            ></app-selector>
          </div>

          <!-- Camera button for mobile -->
          <div class="sm:hidden">
            <button
              type="button"
              (click)="triggerCamera()"
              class="w-full flex items-center justify-center gap-3 p-4 bg-primary text-white rounded-xl shadow-md active:scale-[0.98] transition-transform"
            >
              <app-icon name="camera" [size]="24"></app-icon>
              <span class="text-base font-semibold">Tomar Foto</span>
            </button>
          </div>

          <!-- Dropzone -->
          <div
            (click)="triggerFileInput()"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
            class="group relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[200px]"
            [class.border-primary]="isDragging()"
            [class.bg-primary/5]="isDragging()"
            [class.border-border]="!isDragging() && !selectedFile()"
            [class.hover:border-primary/50]="!isDragging()"
            [class.hover:bg-muted/30]="!isDragging()"
            [class.border-emerald-500]="selectedFile() && !isProcessingFile()"
            [class.bg-emerald-50]="selectedFile() && !isProcessingFile()"
          >
            @if (filePreviewUrl() || selectedFile()) {
              <div class="flex flex-col items-center gap-3 w-full">
                @if (isProcessingFile()) {
                  <app-spinner size="md" text="Cargando archivo..."></app-spinner>
                } @else if (isImageFile()) {
                  <img
                    [src]="filePreviewUrl()"
                    alt="Vista previa"
                    class="max-h-40 rounded-lg border border-border object-contain"
                  />
                } @else {
                  <div class="p-4 bg-primary/10 rounded-lg">
                    <app-icon name="file-text" [size]="48" class="text-primary"></app-icon>
                  </div>
                }
                <p class="text-sm font-medium text-text-primary">
                  {{ selectedFile()?.name }}
                </p>
                @if (selectedFile()?.size) {
                  <p class="text-xs text-text-secondary">
                    {{ formatFileSize(selectedFile()!.size) }}
                  </p>
                }
                @if (!isProcessingFile()) {
                  <div class="flex items-center gap-2 text-emerald-600">
                    <app-icon name="check-circle" [size]="16"></app-icon>
                    <span class="text-xs font-medium">Archivo listo</span>
                  </div>
                }
                <button
                  type="button"
                  class="text-xs text-primary hover:underline font-medium"
                  (click)="removeFile(); $event.stopPropagation()"
                >
                  Cambiar archivo
                </button>
              </div>
            } @else {
              <div class="p-3 bg-primary/10 rounded-full mb-3 group-hover:scale-110 transition-transform">
                <app-icon name="scan-line" [size]="32" class="text-primary"></app-icon>
              </div>
              <p class="text-sm font-semibold text-text-primary mb-1">
                Arrastra tu hoja de conteo aquí
              </p>
              <p class="text-xs text-text-secondary">
                JPG, PNG, WebP o PDF — Máx 10MB
              </p>
            }
          </div>

          <!-- Hidden file inputs -->
          <input
            #fileInput
            type="file"
            class="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            (change)="onFileSelected($event)"
          />
          <input
            #cameraInput
            type="file"
            class="hidden"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            (change)="onFileSelected($event)"
          />

          @if (fileError()) {
            <p class="text-sm text-red-600">{{ fileError() }}</p>
          }
        </div>
      }

      <!-- ============ Paso 1: ANALIZAR ============ -->
      @if (currentStep() === 1) {
        <div class="flex flex-col lg:flex-row gap-6 min-h-[300px]">
          @if (filePreviewUrl() && isImageFile()) {
            <div class="lg:w-1/3 flex-shrink-0">
              <img
                [src]="filePreviewUrl()"
                alt="Hoja de reconteo"
                class="w-full max-h-64 lg:max-h-80 object-contain rounded-lg border border-border"
              />
            </div>
          } @else if (selectedFile()) {
            <div class="lg:w-1/3 flex-shrink-0 flex items-center justify-center p-8 bg-muted/30 rounded-lg border border-border">
              <div class="flex flex-col items-center gap-3">
                <app-icon name="file-text" [size]="64" class="text-primary"></app-icon>
                <p class="text-sm font-medium text-text-primary text-center">
                  {{ selectedFile()!.name }}
                </p>
              </div>
            </div>
          }

          <div class="flex-1 flex flex-col items-center justify-center gap-4">
            <app-spinner size="lg" text="Procesando hoja de reconteo con IA..."></app-spinner>
            <p class="text-sm text-text-secondary text-center">
              Extrayendo productos contados y comparando contra el stock actual...
            </p>
          </div>
        </div>
      }

      <!-- ============ Paso 2: REVISAR ============ -->
      @if (currentStep() === 2 && scanResponse()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <!-- Confidence badge + extraction notes -->
          <div class="flex items-center gap-3 flex-wrap">
            <app-badge [variant]="confidenceVariant()" size="sm">
              Confianza: {{ scanResponse()!.scan.confidence }}%
            </app-badge>
            @if (scanResponse()!.scan.extraction_notes) {
              <div class="flex-1 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p class="text-xs font-semibold text-amber-800 mb-0.5">Notas de extracción</p>
                <p class="text-xs text-amber-700">{{ scanResponse()!.scan.extraction_notes }}</p>
              </div>
            }
          </div>

          <!-- Warnings del matching -->
          @if (scanResponse()!.warnings.length > 0) {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p class="text-xs font-semibold text-amber-800 mb-1">Advertencias</p>
              @for (warn of scanResponse()!.warnings; track warn) {
                <p class="text-xs text-amber-700">{{ warn }}</p>
              }
            </div>
          }

          <!-- Excluded rows notice -->
          @if (excludedCount() > 0) {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p class="text-xs text-amber-800">
                {{ excludedCount() }} fila(s) sin producto seleccionado serán excluidas del reconteo.
              </p>
            </div>
          }

          <!-- Items table -->
          <div>
            <h4 class="text-sm font-semibold text-text-primary mb-3">
              Productos contados ({{ editableItems().length }})
            </h4>

            <!-- Desktop table -->
            <div class="hidden sm:block overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border text-left">
                    <th class="pb-2 pr-3 text-text-secondary font-medium">Producto</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-20">Contado</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-24">Stock actual</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-20">Delta</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-24">Estado</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium">Descripción</th>
                    <th class="pb-2 pl-3 text-text-secondary font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of editableItems(); track $index; let i = $index) {
                    <tr
                      class="border-b border-border/50 hover:bg-muted/20"
                      [class.bg-amber-50]="item.match_status === 'new'"
                    >
                      <td class="py-2 pr-3">
                        <ng-container
                          [ngTemplateOutlet]="productPicker"
                          [ngTemplateOutletContext]="{ item: item, i: i }"
                        ></ng-container>
                        <p class="text-[10px] text-text-secondary mt-1 line-clamp-1" [title]="item.description">
                          {{ item.description }}
                        </p>
                      </td>
                      <td class="py-2 px-3">
                        <input
                          type="number"
                          [value]="item.counted_quantity"
                          (change)="updateCountedQuantity(i, $event)"
                          class="w-16 px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                          min="0"
                          step="1"
                        />
                      </td>
                      <td class="py-2 px-3 text-text-secondary">
                        {{ item.stock_on_hand ?? '—' }}
                      </td>
                      <td class="py-2 px-3">
                        <span class="font-semibold" [class]="getDeltaClass(item)">
                          {{ getDelta(item) > 0 ? '+' : '' }}{{ getDelta(item) }}
                        </span>
                      </td>
                      <td class="py-2 px-3">
                        <app-badge
                          [variant]="item.match_status === 'matched' ? 'success' : (item.match_status === 'partial' ? 'warning' : 'error')"
                          size="xsm"
                        >
                          {{ item.match_status === 'matched' ? 'Encontrado' : (item.match_status === 'partial' ? 'Parcial' : 'Nuevo') }}
                        </app-badge>
                      </td>
                      <td class="py-2 px-3">
                        <input
                          type="text"
                          [value]="item.note"
                          (change)="updateNote(i, $event)"
                          class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                        />
                      </td>
                      <td class="py-2 pl-3">
                        <button
                          type="button"
                          (click)="removeRow(i)"
                          class="text-red-500 hover:text-red-700 p-1"
                          title="Eliminar"
                        >
                          <app-icon name="trash-2" [size]="14"></app-icon>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Mobile cards -->
            <div class="sm:hidden space-y-3">
              @for (item of editableItems(); track $index; let i = $index) {
                <div
                  class="bg-surface border border-border rounded-lg p-3 space-y-2"
                  [class.bg-amber-50]="item.match_status === 'new'"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <ng-container
                        [ngTemplateOutlet]="productPicker"
                        [ngTemplateOutletContext]="{ item: item, i: i }"
                      ></ng-container>
                      <p class="text-[10px] text-text-secondary mt-1 line-clamp-2">
                        {{ item.description }}
                      </p>
                    </div>
                    <app-badge
                      [variant]="item.match_status === 'matched' ? 'success' : (item.match_status === 'partial' ? 'warning' : 'error')"
                      size="xsm"
                    >
                      {{ item.match_status === 'matched' ? 'OK' : (item.match_status === 'partial' ? '~' : 'Nuevo') }}
                    </app-badge>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <div>
                      <label class="text-[10px] text-text-secondary">Contado</label>
                      <input
                        type="number"
                        [value]="item.counted_quantity"
                        (change)="updateCountedQuantity(i, $event)"
                        class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary"
                        min="0"
                      />
                    </div>
                    <div>
                      <label class="text-[10px] text-text-secondary">Stock actual</label>
                      <p class="px-2 py-1 text-sm text-text-secondary">
                        {{ item.stock_on_hand ?? '—' }}
                      </p>
                    </div>
                    <div>
                      <label class="text-[10px] text-text-secondary">Delta</label>
                      <p class="px-2 py-1 text-sm font-semibold" [class]="getDeltaClass(item)">
                        {{ getDelta(item) > 0 ? '+' : '' }}{{ getDelta(item) }}
                      </p>
                    </div>
                  </div>
                  <div>
                    <label class="text-[10px] text-text-secondary">Descripción</label>
                    <input
                      type="text"
                      [value]="item.note"
                      (change)="updateNote(i, $event)"
                      class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary"
                    />
                  </div>
                  <button
                    type="button"
                    (click)="removeRow(i)"
                    class="text-xs text-red-500 hover:text-red-700 font-medium"
                  >
                    Eliminar
                  </button>
                </div>
              }
            </div>
          </div>

          <!-- Punto: picker de producto por línea, reusado en desktop y mobile.
               Sugeridos = candidates del backend (sin stock propio → se
               resuelve on-demand); Catálogo = búsqueda server-side vía
               InventoryService.searchAdjustableProducts (misma llamada que
               adjustment-create-modal, ya trae stock_at_location real). -->
          <ng-template #productPicker let-item="item" let-i="i">
            <div class="relative">
              <button
                type="button"
                (click)="toggleProductSearch(i)"
                class="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs border border-border rounded-md bg-surface text-left hover:border-primary"
              >
                <span
                  class="truncate"
                  [class.text-text-secondary]="!item.selected_product_id"
                >
                  {{ selectedProductLabel(item) }}
                </span>
                <app-icon
                  [name]="productSearchIndex() === i ? 'chevron-up' : 'chevron-down'"
                  [size]="14"
                ></app-icon>
              </button>

              @if (productSearchIndex() === i) {
                <div
                  class="absolute z-[10000] mt-1 w-full min-w-[220px] bg-surface border border-border shadow-lg rounded-lg max-h-64 overflow-auto"
                >
                  <div class="p-2 border-b border-border sticky top-0 bg-surface">
                    <app-inputsearch
                      size="sm"
                      placeholder="Buscar en el catálogo..."
                      [debounceTime]="300"
                      (searchChange)="onProductSearch($event)"
                    ></app-inputsearch>
                  </div>
                  <div class="py-1">
                    <button
                      type="button"
                      (click)="chooseNewProduct(i)"
                      class="w-full px-3 py-2 text-left text-xs hover:bg-primary-50 flex items-center gap-2"
                      [class.font-semibold]="!item.selected_product_id"
                    >
                      <app-icon name="plus" [size]="14"></app-icon>
                      Producto nuevo
                    </button>

                    @if (item.candidates.length > 0) {
                      <p class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-secondary">
                        Sugeridos
                      </p>
                      @for (c of item.candidates; track c.id) {
                        <button
                          type="button"
                          (click)="chooseCandidate(i, c)"
                          class="w-full px-3 py-2 text-left text-xs hover:bg-primary-50 flex items-center justify-between gap-2"
                          [class.bg-primary-50]="item.selected_product_id === c.id"
                        >
                          <span class="truncate">{{ c.name }}</span>
                          <span class="text-[10px] text-text-secondary shrink-0">{{ c.sku }}</span>
                        </button>
                      }
                    }

                    @if (productSearchLoading()) {
                      <p class="px-3 py-2 text-xs text-text-secondary">Buscando...</p>
                    } @else if (productSearchResults().length > 0) {
                      <p class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-secondary">
                        Catálogo
                      </p>
                      @for (r of productSearchResults(); track r.id) {
                        <button
                          type="button"
                          (click)="chooseSearchResult(i, r)"
                          class="w-full px-3 py-2 text-left text-xs hover:bg-primary-50 flex items-center justify-between gap-2"
                          [class.bg-primary-50]="item.selected_product_id === r.id"
                        >
                          <span class="truncate">{{ r.name }}</span>
                          <span class="text-[10px] text-text-secondary shrink-0">
                            Stock: {{ r.stock_at_location.quantity_on_hand }}
                          </span>
                        </button>
                      }
                    }
                  </div>
                </div>
              }
            </div>
          </ng-template>
        </div>
      }

      <!-- Footer Actions -->
      <div slot="footer" class="flex justify-between gap-3">
        <div>
          @if (currentStep() === 2) {
            <app-button variant="outline" type="button" (clicked)="resetWizard()">
              Escanear otra
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button variant="outline" type="button" (clicked)="onCancel()">
            Cancelar
          </app-button>
          @if (currentStep() === 0) {
            <app-button
              variant="primary"
              type="button"
              [disabled]="!selectedFile() || !selectedLocationId()"
              (clicked)="startScan()"
            >
              Escanear reconteo
            </app-button>
          }
          @if (currentStep() === 2) {
            <app-button
              variant="outline"
              type="button"
              [disabled]="!hasValidItems() || submitting()"
              [loading]="submitting()"
              (clicked)="onSubmit('draft')"
            >
              Crear Borrador
            </app-button>
            <app-button
              variant="primary"
              type="button"
              [disabled]="!hasValidItems() || submitting()"
              [loading]="submitting()"
              (clicked)="onSubmit('apply')"
            >
              Crear y Aplicar
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .line-clamp-1 {
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .line-clamp-2 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    `,
  ],
})
export class InventoryScannerModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly inventoryScannerService = inject(InventoryScannerService);
  private readonly inventoryService = inject(InventoryService);
  private readonly toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly created = output<void>();
  readonly closed = output<void>();

  /**
   * Ubicaciones del store. Se recibe como input (no se hace fetch interno),
   * misma convención que `adjustment-create-modal`/`bulk-adjustment-modal`
   * en esta misma carpeta: el contenedor (Sección 8) ya mantiene la lista
   * cargada para alimentar varios modales hermanos.
   */
  readonly locations = input<SelectorOption[]>([]);

  // Wizard state (0=Subir, 1=Analizar, 2=Revisar — misma convención 0-index
  // que expense-scanner-modal).
  readonly currentStep = signal(0);
  readonly selectedLocationId = signal<number | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly filePreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly isScanning = signal(false);
  readonly isProcessingFile = signal(false);
  readonly submitting = signal(false);

  readonly scanResponse = signal<InventoryCountScanResponse | null>(null);
  readonly editableItems = signal<EditableCountRow[]>([]);

  // Product picker (una búsqueda abierta a la vez)
  readonly productSearchIndex = signal<number | null>(null);
  readonly productSearchResults = signal<AdjustableProduct[]>([]);
  readonly productSearchLoading = signal(false);
  private readonly productSearch$ = new Subject<string>();

  wizardSteps: StepsLineItem[] = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
  ];

  readonly isImageFile = computed(() => {
    const file = this.selectedFile();
    return file?.type?.startsWith('image/') ?? false;
  });

  readonly confidenceVariant = computed<'success' | 'warning' | 'error'>(() => {
    const c = this.scanResponse()?.scan.confidence ?? 0;
    if (c >= 80) return 'success';
    if (c >= 50) return 'warning';
    return 'error';
  });

  readonly excludedCount = computed(
    () => this.editableItems().filter((item) => item.selected_product_id == null).length,
  );

  readonly hasValidItems = computed(() =>
    this.editableItems().some((item) => item.selected_product_id != null),
  );

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  constructor() {
    // Búsqueda de catálogo por línea (cancelable con switchMap), misma
    // llamada HTTP que usa el picker de adjustment-create-modal
    // (InventoryService.searchAdjustableProducts) — no se duplica endpoint.
    this.productSearch$
      .pipe(
        switchMap((term) => {
          const q = (term ?? '').trim();
          const locationId = this.selectedLocationId();
          if (!q || !locationId) {
            this.productSearchLoading.set(false);
            return of<AdjustableProduct[]>([]);
          }
          this.productSearchLoading.set(true);
          return this.inventoryService.searchAdjustableProducts(q, locationId).pipe(
            map((res) => res.data ?? []),
            catchError(() => of<AdjustableProduct[]>([])),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => {
        this.productSearchResults.set(list);
        this.productSearchLoading.set(false);
      });
  }

  // ============================================================
  // Location
  // ============================================================

  onLocationChange(value: string | number | null): void {
    let id: number | null = null;
    if (value !== null && value !== undefined && value !== '') {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(parsed)) id = parsed;
    }
    this.selectedLocationId.set(id);
  }

  // ============================================================
  // File handling (clonado de expense-scanner-modal)
  // ============================================================

  triggerFileInput(): void {
    const el = document.querySelector(
      'app-inventory-scanner-modal input[type="file"]:not([capture])',
    ) as HTMLInputElement;
    el?.click();
  }

  triggerCamera(): void {
    const el = document.querySelector(
      'app-inventory-scanner-modal input[capture]',
    ) as HTMLInputElement;
    el?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) this.handleFile(file);
    if (input) input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  private handleFile(file: File): void {
    this.fileError.set(null);
    const validTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!validTypes.includes(file.type)) {
      this.fileError.set('Formato no soportado. Usa JPG, PNG, WebP o PDF.');
      return;
    }
    if (file.size > this.MAX_FILE_SIZE) {
      this.fileError.set('El archivo excede el límite de 10MB.');
      return;
    }
    this.selectedFile.set(file);
    if (file.type.startsWith('image/')) {
      this.isProcessingFile.set(true);
      const reader = new FileReader();
      reader.onload = () => {
        this.filePreviewUrl.set(reader.result as string);
        this.isProcessingFile.set(false);
      };
      reader.onerror = () => this.isProcessingFile.set(false);
      reader.readAsDataURL(file);
    } else {
      this.filePreviewUrl.set(null);
      this.isProcessingFile.set(false);
    }
  }

  removeFile(): void {
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
    this.isProcessingFile.set(false);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  // ============================================================
  // Scanning
  // ============================================================

  startScan(): void {
    const file = this.selectedFile();
    const locationId = this.selectedLocationId();
    if (!file || !locationId) return;

    this.currentStep.set(1);
    this.isScanning.set(true);

    this.inventoryScannerService
      .scanCount(file, locationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.isScanning.set(false);
          if (!response.success || !response.data) {
            this.toastService.error(
              response.message || 'Error al escanear la hoja de reconteo',
            );
            this.currentStep.set(0);
            return;
          }

          this.scanResponse.set(response.data);
          this.editableItems.set(
            response.data.matched_products.map((item) => ({
              ...item,
              note: 'Reconteo por IA',
            })),
          );
          this.currentStep.set(2);
        },
        error: (err) => {
          this.isScanning.set(false);
          // Nota: InventoryScannerService.handleError hace
          // `throwError(() => error_message)` con error_message ya como
          // STRING (no un HttpErrorResponse), a diferencia de
          // Invoice/ExpenseScannerService. Se maneja ambos casos por
          // robustez, pero el shape real esperado aquí es string.
          const message =
            typeof err === 'string'
              ? err
              : err?.error?.message || err?.message || 'Error al procesar la hoja de reconteo';
          this.toastService.error(message);
          this.currentStep.set(0);
        },
      });
  }

  // ============================================================
  // Review step: edición de filas
  // ============================================================

  updateCountedQuantity(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value) || value < 0) return;
    const items = [...this.editableItems()];
    items[index] = { ...items[index], counted_quantity: value };
    this.editableItems.set(items);
  }

  updateNote(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const items = [...this.editableItems()];
    items[index] = { ...items[index], note: value };
    this.editableItems.set(items);
  }

  removeRow(index: number): void {
    const items = [...this.editableItems()];
    items.splice(index, 1);
    this.editableItems.set(items);
  }

  /**
   * Delta = contado - stock actual. `stock_on_hand` puede venir `null`
   * (producto sin registro de stock en esa ubicación) → se trata como 0
   * para el cálculo de vista previa.
   */
  getDelta(item: EditableCountRow): number {
    return item.counted_quantity - (item.stock_on_hand ?? 0);
  }

  /**
   * Criterio visual: verde cuando el conteo coincide con el stock (delta
   * 0), rojo ante cualquier variación (positiva o negativa) — coincide con
   * el enunciado funcional de este wizard (toda discrepancia se marca para
   * revisión), a diferencia del criterio por signo que usa
   * adjustment-create-modal (positivo=verde/negativo=rojo), donde un
   * incremento es una categoría de ajuste distinta (no una discrepancia de
   * conteo).
   */
  getDeltaClass(item: EditableCountRow): string {
    return this.getDelta(item) === 0 ? 'text-success' : 'text-error';
  }

  selectedProductLabel(item: EditableCountRow): string {
    if (item.selected_product_id && item.selected_product_name) {
      return item.selected_product_name;
    }
    return 'Producto nuevo';
  }

  // ============================================================
  // Product picker
  // ============================================================

  toggleProductSearch(index: number): void {
    if (this.productSearchIndex() === index) {
      this.productSearchIndex.set(null);
      return;
    }
    this.productSearchIndex.set(index);
    this.productSearchResults.set([]);
    this.productSearchLoading.set(false);
  }

  onProductSearch(term: string): void {
    this.productSearch$.next(term);
  }

  /**
   * Selección desde resultados de catálogo: ya trae stock_at_location real
   * y `product_variant_id` real de esa fila de `stock_levels` (backend
   * `search-products` corregido — ver `AdjustableProduct.product_variant_id`).
   */
  chooseSearchResult(index: number, product: AdjustableProduct): void {
    this.applySelection(index, {
      id: product.id,
      name: product.name,
      stock_on_hand: product.stock_at_location.quantity_on_hand,
      product_variant_id: product.product_variant_id ?? null,
    });
  }

  /**
   * Selección desde "Sugeridos" (candidates del backend): el candidato ya
   * trae `product_variant_id` resuelto por `InventoryCountScannerService`
   * cuando no hay ambigüedad (0 o 1 fila de stock en esta location). Se
   * complementa con una consulta puntual reusando el MISMO
   * `searchAdjustableProducts` (sin duplicar endpoint) solo para el stock
   * mostrado; si no aparece en el resultado (p.ej. sin stock en esta
   * ubicación), se asume 0.
   */
  chooseCandidate(
    index: number,
    candidate: {
      id: number;
      name: string;
      sku: string | null;
      confidence: number;
      product_variant_id?: number | null;
    },
  ): void {
    const locationId = this.selectedLocationId();
    if (!locationId) return;

    this.inventoryService
      .searchAdjustableProducts(candidate.name, locationId, 5)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const match = (res.data ?? []).find((p) => p.id === candidate.id);
          this.applySelection(index, {
            id: candidate.id,
            name: candidate.name,
            stock_on_hand: match?.stock_at_location.quantity_on_hand ?? 0,
            product_variant_id: candidate.product_variant_id ?? match?.product_variant_id ?? null,
          });
        },
        error: () => {
          this.applySelection(index, {
            id: candidate.id,
            name: candidate.name,
            stock_on_hand: 0,
            product_variant_id: candidate.product_variant_id ?? null,
          });
        },
      });
  }

  private applySelection(
    index: number,
    selection: {
      id: number;
      name: string;
      stock_on_hand: number;
      product_variant_id: number | null;
    },
  ): void {
    const items = [...this.editableItems()];
    items[index] = {
      ...items[index],
      selected_product_id: selection.id,
      selected_product_name: selection.name,
      selected_product_variant_id: selection.product_variant_id,
      stock_on_hand: selection.stock_on_hand,
      match_status: 'matched',
    };
    this.editableItems.set(items);
    this.productSearchIndex.set(null);
  }

  chooseNewProduct(index: number): void {
    const items = [...this.editableItems()];
    items[index] = {
      ...items[index],
      selected_product_id: null,
      selected_product_name: null,
      selected_product_variant_id: null,
      match_status: 'new',
    };
    this.editableItems.set(items);
    this.productSearchIndex.set(null);
  }

  // ============================================================
  // Submit
  // ============================================================

  onSubmit(mode: 'apply' | 'draft'): void {
    const locationId = this.selectedLocationId();
    if (!locationId) return;

    const validItems = this.editableItems().filter(
      (item) => item.selected_product_id != null,
    );
    if (validItems.length === 0) {
      this.toastService.error('Selecciona al menos un producto para continuar');
      return;
    }

    const dto: BatchCreateAdjustmentsRequest = {
      location_id: locationId,
      items: validItems.map((item) => ({
        product_id: item.selected_product_id!,
        type: 'count_variance' as AdjustmentType,
        quantity_after: item.counted_quantity,
        // Propaga la variante ya resuelta (auto-match sin ambigüedad, o
        // elegida manualmente vía el picker) — evita el 404 INV_FIND_001
        // cuando el producto tiene variantes con stock en esta location.
        ...(item.selected_product_variant_id != null
          ? { product_variant_id: item.selected_product_variant_id }
          : {}),
        ...(item.note?.trim() ? { description: item.note.trim() } : {}),
      })),
    };

    this.submitting.set(true);
    const request$ =
      mode === 'apply'
        ? this.inventoryService.batchCreateAndComplete(dto)
        : this.inventoryService.batchCreateAdjustments(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitting.set(false);
        this.toastService.success(
          mode === 'apply'
            ? 'Reconteo aplicado correctamente'
            : 'Borrador de reconteo creado correctamente',
        );
        this.created.emit();
        this.closeAndReset();
      },
      error: (err) => {
        this.submitting.set(false);
        const message =
          typeof err === 'string'
            ? err
            : err?.error?.message || err?.message || 'Error al guardar el reconteo';
        this.toastService.error(message);
      },
    });
  }

  // ============================================================
  // Modal lifecycle
  // ============================================================

  onOpenChange(open: boolean): void {
    if (!open) this.closeAndReset();
    this.isOpenChange.emit(open);
  }

  onCancel(): void {
    this.closeAndReset();
  }

  resetWizard(): void {
    this.currentStep.set(0);
    this.selectedLocationId.set(null);
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
    this.isProcessingFile.set(false);
    this.isScanning.set(false);
    this.submitting.set(false);
    this.scanResponse.set(null);
    this.editableItems.set([]);
    this.productSearchIndex.set(null);
    this.productSearchResults.set([]);
    this.productSearchLoading.set(false);
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.isOpenChange.emit(false);
  }
}
