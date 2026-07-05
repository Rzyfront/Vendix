import {Component, input, output, signal, computed, effect, DestroyRef, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap, catchError, of, Subject } from 'rxjs';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { SpinnerComponent } from '../../../../../../../shared/components/spinner/spinner.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { InputsearchComponent } from '../../../../../../../shared/components/inputsearch/inputsearch.component';
import { StepsLineComponent } from '../../../../../../../shared/components/steps-line/steps-line.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';

import { InvoiceScannerService } from '../../services/invoice-scanner.service';
import { UomService, UnitOfMeasure } from '../../../services/uom.service';
import { SuppliersService } from '../../../services/suppliers.service';
import { ProductsService } from '../../../../products/services/products.service';
import { Supplier } from '../../../interfaces';
import { PopSupplierQuickCreateComponent } from '../pop-supplier-quick-create.component';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  MatchedLineItem,
  ProductCandidate,
} from '../../interfaces/invoice-scanner.interface';

@Component({
  selector: 'app-invoice-scanner-modal',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    SpinnerComponent,
    IconComponent,
    InputComponent,
    ToggleComponent,
    InputsearchComponent,
    StepsLineComponent,
    CurrencyPipe,
    PopSupplierQuickCreateComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      size="xl"
      title="Escanear Factura de Compra"
      subtitle="Escanea una factura para agregar productos al carrito"
    >
      <!-- Steps indicator -->
      <div class="mb-6">
        <app-steps-line
          [steps]="wizardSteps"
          [currentStep]="currentStep() - 1"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- Step 1: Upload -->
      @if (currentStep() === 1) {
        <div class="space-y-4">
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
              <!-- File preview -->
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
                  <!-- PDF / non-image -->
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
              <!-- Empty state -->
              <div class="p-3 bg-primary/10 rounded-full mb-3 group-hover:scale-110 transition-transform">
                <app-icon name="scan-line" [size]="32" class="text-primary"></app-icon>
              </div>
              <p class="text-sm font-semibold text-text-primary mb-1">
                Arrastra tu factura aqui
              </p>
              <p class="text-xs text-text-secondary">
                JPG, PNG, WebP o PDF - Max 10MB
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

          <!-- Punto 1: selector de perfil de escaneo (retail vs insumos).
               Define el prompt OCR del backend (invoice_ocr vs
               invoice_ocr_ingredient). Se prellena con la sugerencia del
               orquestador (carrito + industria) pero el usuario manda. -->
          <div
            class="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-muted/20"
          >
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-text-primary">
                Factura de insumos / ingredientes
              </p>
              <p class="text-xs text-text-secondary mt-0.5">
                Actívalo para materias primas o insumos: la IA extraerá también
                unidades de medida (L, kg, ml, unidad...).
              </p>
            </div>
            <app-toggle
              [checked]="scanProfile() === 'ingredient'"
              (changed)="onScanProfileToggle($event)"
              ariaLabel="Factura de insumos o ingredientes"
            ></app-toggle>
          </div>
        </div>
      }

      <!-- Step 2: Processing -->
      @if (currentStep() === 2) {
        <div class="flex flex-col lg:flex-row gap-6 min-h-[300px]">
          <!-- Image preview -->
          @if (filePreviewUrl() && isImageFile()) {
            <div class="lg:w-1/3 flex-shrink-0">
              <img
                [src]="filePreviewUrl()"
                alt="Factura"
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

          <!-- Processing indicator -->
          <div class="flex-1 flex flex-col items-center justify-center gap-4">
            <app-spinner size="lg" text="Analizando factura..."></app-spinner>
            <p class="text-sm text-text-secondary text-center">
              Extrayendo datos y buscando coincidencias con tus productos...
            </p>
          </div>
        </div>
      }

      <!-- Step 3: Review & Confirm -->
      @if (currentStep() === 3 && matchResult()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <!-- Punto 2: proveedor con paridad (preseleccionado + editable). -->
          <div class="bg-muted/30 rounded-lg p-4 border border-border">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-sm font-semibold text-text-primary">Proveedor</h4>
              <app-badge
                [variant]="matchResult()!.supplier_match.is_new ? 'warning' : (matchResult()!.supplier_match.confidence >= 80 ? 'success' : 'warning')"
                size="xsm"
              >
                {{ matchResult()!.supplier_match.is_new ? 'Nuevo' : (matchResult()!.supplier_match.confidence >= 80 ? 'Encontrado' : 'Parcial') }}
              </app-badge>
            </div>

            <!-- Nombre/NIT detectado por el OCR como ayuda -->
            @if (matchResult()!.supplier_match.name) {
              <p class="text-xs text-text-secondary mb-2">
                Detectado:
                <span class="font-medium text-text-primary">{{ matchResult()!.supplier_match.name }}</span>
                @if (matchResult()!.supplier_match.tax_id) {
                  <span> · NIT: {{ matchResult()!.supplier_match.tax_id }}</span>
                }
              </p>
            }

            <div class="flex items-end gap-2">
              <div class="flex-1 min-w-0 relative">
                <button
                  type="button"
                  (click)="toggleSupplierDropdown()"
                  class="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-border rounded-lg bg-surface hover:border-primary text-left"
                >
                  <span
                    class="truncate"
                    [class.text-text-secondary]="!selectedSupplierId()"
                  >
                    {{ selectedSupplierLabel() }}
                  </span>
                  <app-icon
                    [name]="supplierDropdownOpen() ? 'chevron-up' : 'chevron-down'"
                    [size]="14"
                  ></app-icon>
                </button>

                @if (supplierDropdownOpen()) {
                  <div
                    class="absolute z-[10000] mt-1 w-full bg-surface border border-border shadow-lg rounded-lg max-h-64 overflow-auto"
                  >
                    <div class="p-2 border-b border-border sticky top-0 bg-surface">
                      <app-inputsearch
                        size="sm"
                        placeholder="Buscar proveedor..."
                        [debounceTime]="300"
                        (searchChange)="onSupplierSearch($event)"
                      ></app-inputsearch>
                    </div>
                    <div class="py-1">
                      @if (supplierSearchLoading()) {
                        <p class="px-3 py-2 text-xs text-text-secondary">Buscando...</p>
                      } @else if (supplierDisplayList().length > 0) {
                        @for (s of supplierDisplayList(); track s.id) {
                          <button
                            type="button"
                            (click)="chooseSupplier(s)"
                            class="w-full px-3 py-2 text-left text-xs hover:bg-primary-50 flex items-center justify-between gap-2"
                            [class.bg-primary-50]="selectedSupplierId() === s.id"
                          >
                            <span class="truncate">{{ s.name }}</span>
                            @if (s.tax_id) {
                              <span class="text-[10px] text-text-secondary shrink-0">NIT: {{ s.tax_id }}</span>
                            }
                          </button>
                        }
                      } @else {
                        <p class="px-3 py-2 text-xs text-text-secondary">Sin resultados</p>
                      }
                    </div>
                  </div>
                }
              </div>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="openSupplierCreate()"
              >
                <app-icon slot="icon" name="plus" [size]="16"></app-icon>
                Crear
              </app-button>
            </div>
          </div>

          <!-- Invoice header fields -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              label="No. Factura"
              [(ngModel)]="editInvoiceNumber"
              name="invoiceNumber"
              placeholder="Ej: FV-001"
            ></app-input>
            <app-input
              label="Fecha Factura"
              type="date"
              [(ngModel)]="editInvoiceDate"
              name="invoiceDate"
            ></app-input>
          </div>

          <!-- Warnings -->
          @if (matchResult()!.warnings.length > 0) {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p class="text-xs font-semibold text-amber-800 mb-1">Advertencias</p>
              @for (warn of matchResult()!.warnings; track warn) {
                <p class="text-xs text-amber-700">{{ warn }}</p>
              }
            </div>
          }

          <!-- Line items table -->
          <div>
            <h4 class="text-sm font-semibold text-text-primary mb-3">
              Productos ({{ editableItems().length }})
            </h4>

            <!-- Desktop table -->
            <div class="hidden sm:block overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border text-left">
                    <th class="pb-2 pr-3 text-text-secondary font-medium">Descripcion</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-20">Cant.</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-28">P. Unit.</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-24">Total</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-24">Estado</th>
                    <th class="pb-2 pl-3 text-text-secondary font-medium">Producto</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of editableItems(); track $index; let i = $index) {
                    <tr class="border-b border-border/50 hover:bg-muted/20">
                      <td class="py-2 pr-3">
                        <span class="text-text-primary line-clamp-1" [title]="item.description">
                          {{ item.description }}
                        </span>
                      </td>
                      <td class="py-2 px-3">
                        <input
                          type="number"
                          [value]="item.quantity"
                          (change)="updateItemQuantity(i, $event)"
                          class="w-16 px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                          min="0"
                          step="1"
                        />
                      </td>
                      <td class="py-2 px-3">
                        <input
                          type="number"
                          [value]="item.unit_price"
                          (change)="updateItemPrice(i, $event)"
                          class="w-24 px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                          min="0"
                          step="0.01"
                        />
                      </td>
                      <td class="py-2 px-3 text-text-primary font-medium">
                        {{ item.quantity * item.unit_price | currency: 0 }}
                      </td>
                      <td class="py-2 px-3">
                        <app-badge
                          [variant]="item.match_status === 'matched' ? 'success' : (item.match_status === 'partial' ? 'warning' : 'error')"
                          size="xsm"
                        >
                          {{ item.match_status === 'matched' ? 'Encontrado' : (item.match_status === 'partial' ? 'Parcial' : 'Nuevo') }}
                        </app-badge>
                      </td>
                      <td class="py-2 pl-3">
                        <ng-container
                          [ngTemplateOutlet]="productPicker"
                          [ngTemplateOutletContext]="{ item: item, i: i }"
                        ></ng-container>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Mobile cards -->
            <div class="sm:hidden space-y-3">
              @for (item of editableItems(); track $index; let i = $index) {
                <div class="bg-surface border border-border rounded-lg p-3 space-y-2">
                  <div class="flex items-start justify-between gap-2">
                    <span class="text-sm font-medium text-text-primary line-clamp-2 flex-1">
                      {{ item.description }}
                    </span>
                    <app-badge
                      [variant]="item.match_status === 'matched' ? 'success' : (item.match_status === 'partial' ? 'warning' : 'error')"
                      size="xsm"
                    >
                      {{ item.match_status === 'matched' ? 'OK' : (item.match_status === 'partial' ? '~' : 'Nuevo') }}
                    </app-badge>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <div>
                      <label class="text-[10px] text-text-secondary">Cant.</label>
                      <input
                        type="number"
                        [value]="item.quantity"
                        (change)="updateItemQuantity(i, $event)"
                        class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary"
                        min="0"
                      />
                    </div>
                    <div>
                      <label class="text-[10px] text-text-secondary">P. Unit.</label>
                      <input
                        type="number"
                        [value]="item.unit_price"
                        (change)="updateItemPrice(i, $event)"
                        class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label class="text-[10px] text-text-secondary">Total</label>
                      <p class="px-2 py-1 text-sm font-medium text-text-primary">
                        {{ item.quantity * item.unit_price | currency: 0 }}
                      </p>
                    </div>
                  </div>
                  <div>
                    <label class="text-[10px] text-text-secondary">Producto</label>
                    <ng-container
                      [ngTemplateOutlet]="productPicker"
                      [ngTemplateOutletContext]="{ item: item, i: i }"
                    ></ng-container>
                  </div>
                </div>
              }
            </div>
          </div>

          <!-- Totals -->
          <div class="bg-muted/30 rounded-lg p-4 border border-border">
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-text-secondary">Subtotal</span>
                <span class="text-text-primary font-medium">{{ calculatedSubtotal() | currency: 0 }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">Impuestos</span>
                <span class="text-text-primary">{{ scanResult()?.tax_amount || 0 | currency: 0 }}</span>
              </div>
              <div class="flex justify-between border-t border-border pt-2">
                <span class="text-text-primary font-semibold">Total</span>
                <span class="text-text-primary font-bold text-base">
                  {{ calculatedSubtotal() + (scanResult()?.tax_amount || 0) | currency: 0 }}
                </span>
              </div>
            </div>
          </div>

          <!-- Punto 3+4: picker de producto por línea, SIEMPRE editable.
               Une candidatos sugeridos + búsqueda de catálogo server-side +
               "Producto nuevo". Reutilizado en desktop y mobile. -->
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
                  class="absolute z-[10000] mt-1 w-full min-w-[220px] right-0 bg-surface border border-border shadow-lg rounded-lg max-h-64 overflow-auto"
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
                          (click)="chooseProduct(i, c)"
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
                          (click)="chooseProduct(i, r)"
                          class="w-full px-3 py-2 text-left text-xs hover:bg-primary-50 flex items-center justify-between gap-2"
                          [class.bg-primary-50]="item.selected_product_id === r.id"
                        >
                          <span class="truncate">{{ r.name }}</span>
                          <span class="text-[10px] text-text-secondary shrink-0">{{ r.sku }}</span>
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
          @if (currentStep() === 3) {
            <app-button variant="outline" (clicked)="resetWizard()">
              Escanear otra
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button variant="outline" (clicked)="onCancel()">
            Cancelar
          </app-button>
          @if (currentStep() === 1) {
            <app-button
              variant="primary"
              [disabled]="!selectedFile()"
              (clicked)="startScan()"
            >
              Analizar Factura
            </app-button>
          }
          @if (currentStep() === 3) {
            <app-button
              variant="primary"
              [disabled]="editableItems().length === 0"
              (clicked)="onConfirm()"
            >
              Agregar al Carrito
            </app-button>
          }
        </div>
      </div>
    </app-modal>

    <!-- Punto 2: quick-create de proveedor, montado como hermano del modal
         para evitar anidar app-modal dentro de app-modal. -->
    <app-pop-supplier-quick-create
      [(isOpen)]="showSupplierCreate"
      (supplierCreated)="onSupplierCreated($event)"
    ></app-pop-supplier-quick-create>
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
export class InvoiceScannerModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input(false);
  /**
   * Fase 4: scan profile selector. Defaults to `retail`. The parent
   * (`pop.component.ts`) passes `'ingredient'` when the cart already
   * contains a pure-ingredient line (so the AI extracts UoM hints too).
   */
  readonly orderType = input<'retail' | 'ingredient'>('retail');
  readonly isOpenChange = output<boolean>();
  readonly confirmed = output<{
    scanResult: InvoiceScanResult;
    matchResult: InvoiceMatchResult;
    editedItems: MatchedLineItem[];
    invoiceNumber?: string;
    invoiceDate?: string;
    supplierId?: number | null;
  }>();

  // Wizard state
  currentStep = signal<1 | 2 | 3>(1);
  selectedFile = signal<File | null>(null);
  filePreviewUrl = signal<string | null>(null);
  fileError = signal<string | null>(null);
  isDragging = signal(false);
  isScanning = signal(false);
  isProcessingFile = signal(false);

  readonly isImageFile = computed(() => {
    const file = this.selectedFile();
    return file?.type?.startsWith('image/') ?? false;
  });
  scanResult = signal<InvoiceScanResult | null>(null);
  matchResult = signal<InvoiceMatchResult | null>(null);
  // Editable items (mutable copy of match result items)
  editableItems = signal<MatchedLineItem[]>([]);

  // Editable invoice header
  editInvoiceNumber = '';
  editInvoiceDate = '';

  // Punto 1: perfil de escaneo elegido en el modal (semilla = input orderType).
  readonly scanProfile = signal<'retail' | 'ingredient'>('retail');
  /** Guard para inicializar el modal (perfil + proveedores) UNA vez por
   *  apertura, sin pisar la elección manual del usuario en re-renders. */
  private modalInitialized = false;

  // Punto 2: proveedor preseleccionado + editable con búsqueda server-side
  // (paridad con el picker de productos: dropdown + app-inputsearch + switchMap).
  readonly selectedSupplierId = signal<number | null>(null);
  readonly selectedSupplierName = signal<string | null>(null);
  readonly showSupplierCreate = signal(false);
  readonly supplierDropdownOpen = signal(false);
  private readonly suppliers = signal<Supplier[]>([]);
  readonly supplierSearchResults = signal<Supplier[]>([]);
  readonly supplierSearchLoading = signal(false);
  private readonly supplierSearchTerm = signal('');
  private readonly supplierSearch$ = new Subject<string>();
  /** Lista mostrada en el dropdown: resultados de servidor cuando hay término
   *  de búsqueda, si no el pool inicial de activos precargado al abrir. */
  readonly supplierDisplayList = computed<Supplier[]>(() =>
    this.supplierSearchTerm().trim()
      ? this.supplierSearchResults()
      : this.suppliers(),
  );
  /** Etiqueta del botón del selector de proveedor. */
  readonly selectedSupplierLabel = computed<string>(
    () => this.selectedSupplierName() ?? 'Selecciona un proveedor',
  );

  // Punto 3+4: búsqueda de catálogo por línea (un dropdown abierto a la vez).
  readonly productSearchIndex = signal<number | null>(null);
  readonly productSearchResults = signal<ProductCandidate[]>([]);
  readonly productSearchLoading = signal(false);
  private readonly productSearch$ = new Subject<string>();

  // Steps config
  wizardSteps = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
  ];

  // Computed subtotal from editable items
  calculatedSubtotal = computed(() => {
    return this.editableItems().reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0,
    );
  });

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Fase 4: catálogo UoM global (cacheado por `UomService` vía
   * shareReplay). Se carga cuando el modal arranca un escaneo en modo
   * `ingredient`. Lo usamos para resolver `uom_hint` → `purchase_uom_id`
   * y derivar el `stock_uom_id` base. Vacío hasta que llega la respuesta;
   * la resolución es no-fatal (si falla, los items quedan sin preselección).
   */
  private readonly uomCatalog = signal<UnitOfMeasure[]>([]);

  constructor(
    private invoiceScannerService: InvoiceScannerService,
    private uomService: UomService,
    private toastService: ToastService,
    private suppliersService: SuppliersService,
    private productsService: ProductsService,
  ) {
    // Punto 1 + 2: al abrir el modal, sembrar el perfil sugerido y precargar
    // el pool de proveedores. El guard evita re-sembrar en cada render, así
    // se respeta la elección manual del usuario mientras el modal siga abierto.
    effect(() => {
      const open = this.isOpen();
      if (open && !this.modalInitialized) {
        this.modalInitialized = true;
        this.scanProfile.set(this.orderType());
        this.loadSuppliers();
      } else if (!open) {
        this.modalInitialized = false;
      }
    });

    // Punto 3+4: stream de búsqueda de catálogo (cancelable con switchMap).
    // El debounce lo aplica app-inputsearch; aquí solo cancelamos in-flight.
    this.productSearch$
      .pipe(
        switchMap((term) => {
          const q = (term ?? '').trim();
          if (!q) {
            this.productSearchLoading.set(false);
            this.productSearchResults.set([]);
            return of<any>({ data: [] });
          }
          this.productSearchLoading.set(true);
          return this.productsService
            .getProducts({ page: 1, limit: 10, state: 'active', search: q } as any)
            .pipe(catchError(() => of<any>({ data: [] })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res: any) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        this.productSearchResults.set(
          list.map((p: any) => ({
            id: p.id,
            name: p.name,
            sku: p.sku ?? p.code ?? '',
            cost_price: p.cost_price != null ? Number(p.cost_price) : undefined,
            confidence: 0,
          })),
        );
        this.productSearchLoading.set(false);
      });

    // Punto 2: stream de búsqueda de proveedores (server-side, cancelable con
    // switchMap). Da paridad con el picker de productos: alcanza cualquier
    // proveedor por nombre/NIT sin importar cuántos haya (no cap de 50).
    this.supplierSearch$
      .pipe(
        switchMap((term) => {
          const q = (term ?? '').trim();
          this.supplierSearchTerm.set(q);
          if (!q) {
            this.supplierSearchLoading.set(false);
            this.supplierSearchResults.set([]);
            return of<any>({ data: [] });
          }
          this.supplierSearchLoading.set(true);
          return this.suppliersService
            .getSuppliers({ is_active: true, limit: 20, search: q })
            .pipe(catchError(() => of<any>({ data: [] })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res: any) => {
        this.supplierSearchResults.set(Array.isArray(res?.data) ? res.data : []);
        this.supplierSearchLoading.set(false);
      });
  }

  // ============================================================
  // Fase 4: UoM hint resolution (ingredient flow only)
  // ============================================================

  /**
   * Carga el catálogo UoM solo en flujo `ingredient`. El servicio cachea
   * internamente (shareReplay), así que llamarlo varias veces no re-pega
   * al backend. Errores son no-fatales: el scanner sigue sin preselección.
   */
  private loadUomCatalog(): void {
    if (this.scanProfile() !== 'ingredient') return;
    this.uomService
      .getCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.uomCatalog.set(Array.isArray(res?.data) ? res.data : []);
        },
        error: () => {
          this.uomCatalog.set([]);
        },
      });
  }

  /**
   * Resuelve las UoM sugeridas para un item insumo a partir de su
   * `uom_hint`. Solo aplica en flujo `ingredient`. Devuelve un par
   * `{ purchase_uom_id, stock_uom_id }`:
   *  - `purchase_uom_id`: la UoM cuyo `code` hace match case-insensitive
   *    con el `uom_hint` (ej "L" → la UoM con code "L"). Sin match → null.
   *  - `stock_uom_id`: la unidad BASE (`is_base === true`) de la MISMA
   *    dimensión que la unidad de compra (ej compra "L" → stock "ml").
   *    Sin unidad de compra resuelta → null.
   * Es una SUGERENCIA: el usuario la confirma/ajusta luego en el modal
   * de config del POP. Nunca inventa.
   */
  private resolveUomForHint(hint?: string | null): {
    purchase_uom_id: number | null;
    stock_uom_id: number | null;
  } {
    const empty = { purchase_uom_id: null, stock_uom_id: null };
    if (this.scanProfile() !== 'ingredient') return empty;
    const normalized = (hint ?? '').trim().toLowerCase();
    if (!normalized) return empty;

    const catalog = this.uomCatalog();
    const purchase = catalog.find(
      (u) => (u.code ?? '').trim().toLowerCase() === normalized,
    );
    if (!purchase) return empty;

    const base = catalog.find(
      (u) => u.dimension === purchase.dimension && u.is_base === true,
    );

    return {
      purchase_uom_id: purchase.id,
      stock_uom_id: base?.id ?? null,
    };
  }

  // ============================================================
  // File handling
  // ============================================================

  triggerFileInput(): void {
    const input = document.querySelector(
      'app-invoice-scanner-modal input[type="file"]:not([capture])',
    ) as HTMLInputElement;
    input?.click();
  }

  triggerCamera(): void {
    const input = document.querySelector(
      'app-invoice-scanner-modal input[capture]',
    ) as HTMLInputElement;
    input?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) {
      this.handleFile(file);
    }
    // Reset input so same file can be re-selected
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
    if (file) {
      this.handleFile(file);
    }
  }

  private handleFile(file: File): void {
    this.fileError.set(null);

    // Validate type
    const validTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!validTypes.includes(file.type)) {
      this.fileError.set(
        'Formato no soportado. Usa JPG, PNG, WebP o PDF.',
      );
      return;
    }

    // Validate size
    if (file.size > this.MAX_FILE_SIZE) {
      this.fileError.set('El archivo excede el limite de 10MB.');
      return;
    }

    this.selectedFile.set(file);

    // Generate preview
    if (file.type.startsWith('image/')) {
      this.isProcessingFile.set(true);
      const reader = new FileReader();
      reader.onload = () => {
        this.filePreviewUrl.set(reader.result as string);
        this.isProcessingFile.set(false);
      };
      reader.onerror = () => {
        this.isProcessingFile.set(false);
      };
      reader.readAsDataURL(file);
    } else {
      // PDF - no preview image
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
    if (!file) return;

    this.currentStep.set(2);
    this.isScanning.set(true);

    // Fase 4: precargar catálogo UoM en paralelo (solo flujo ingredient).
    // El servicio cachea, así que estará listo al construir editableItems.
    this.loadUomCatalog();

    this.invoiceScannerService
      .scanInvoice(file, this.scanProfile())
      .pipe(
        switchMap((scanResponse) => {
          if (!scanResponse.success || !scanResponse.data) {
            throw new Error(
              scanResponse.message || 'Error al escanear la factura',
            );
          }
          this.scanResult.set(scanResponse.data);
          return this.invoiceScannerService.matchProducts(scanResponse.data);
        }),
        catchError((err) => {
          this.toastService.error(
            err?.error?.message || err?.message || 'Error al procesar la factura',
          );
          this.currentStep.set(1);
          this.isScanning.set(false);
          return of(null);
        }),
      )
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe((matchResponse) => {
        this.isScanning.set(false);
        if (!matchResponse) return;

        if (matchResponse.success && matchResponse.data) {
          this.matchResult.set(matchResponse.data);
          // Punto 2: preselecciona el proveedor emparejado (editable luego).
          this.selectedSupplierId.set(
            matchResponse.data.supplier_match.matched_id ?? null,
          );
          this.selectedSupplierName.set(
            matchResponse.data.supplier_match.matched_id
              ? matchResponse.data.supplier_match.name
              : null,
          );
          // Create editable copy of items. Fase 4: en flujo ingredient,
          // resolvemos uom_hint → purchase/stock UoM como preselección.
          this.editableItems.set(
            matchResponse.data.items.map((item) => {
              const { purchase_uom_id, stock_uom_id } = this.resolveUomForHint(
                item.uom_hint,
              );
              return { ...item, purchase_uom_id, stock_uom_id };
            }),
          );
          // Pre-fill invoice header
          const scan = this.scanResult();
          if (scan) {
            this.editInvoiceNumber = scan.invoice_number || '';
            this.editInvoiceDate = scan.invoice_date || '';
          }
          this.currentStep.set(3);
        } else {
          this.toastService.error('No se pudieron emparejar los productos');
          this.currentStep.set(1);
        }
      });
  }

  // ============================================================
  // Review step actions
  // ============================================================

  updateItemQuantity(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value < 0) return;
    const items = [...this.editableItems()];
    items[index] = { ...items[index], quantity: value };
    this.editableItems.set(items);
  }

  updateItemPrice(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value < 0) return;
    const items = [...this.editableItems()];
    items[index] = { ...items[index], unit_price: value };
    this.editableItems.set(items);
  }

  // ============================================================
  // Punto 1: perfil de escaneo
  // ============================================================

  onScanProfileToggle(isIngredient: boolean): void {
    this.scanProfile.set(isIngredient ? 'ingredient' : 'retail');
  }

  // ============================================================
  // Punto 2: proveedor
  // ============================================================

  /** Precarga el pool inicial de proveedores activos que se muestra en el
   *  dropdown antes de teclear. La búsqueda por término va server-side vía
   *  `supplierSearch$` (ver constructor), sin el cap de 50 del pool inicial. */
  private loadSuppliers(): void {
    this.suppliersService
      .getSuppliers({ is_active: true, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.suppliers.set(Array.isArray(res?.data) ? res.data : []);
        },
        error: () => {
          this.suppliers.set([]);
        },
      });
  }

  toggleSupplierDropdown(): void {
    this.supplierDropdownOpen.update((v) => !v);
  }

  onSupplierSearch(term: string): void {
    this.supplierSearch$.next(term ?? '');
  }

  chooseSupplier(supplier: Supplier): void {
    this.selectedSupplierId.set(supplier.id);
    this.selectedSupplierName.set(supplier.name);
    this.supplierDropdownOpen.set(false);
  }

  openSupplierCreate(): void {
    this.showSupplierCreate.set(true);
  }

  onSupplierCreated(supplier: Supplier): void {
    // Añade el proveedor recién creado al pool y lo selecciona.
    this.suppliers.update((list) => [
      supplier,
      ...list.filter((s) => s.id !== supplier.id),
    ]);
    this.selectedSupplierId.set(supplier.id);
    this.selectedSupplierName.set(supplier.name);
    this.supplierDropdownOpen.set(false);
    this.showSupplierCreate.set(false);
  }

  // ============================================================
  // Punto 3+4: selector de producto por línea (siempre editable)
  // ============================================================

  /** Etiqueta mostrada en el botón del picker según la selección actual. */
  selectedProductLabel(item: MatchedLineItem): string {
    if (!item.selected_product_id) return 'Producto nuevo';
    const found = [...item.candidates, ...this.productSearchResults()].find(
      (c) => c.id === item.selected_product_id,
    );
    return found
      ? `${found.name}${found.sku ? ` (${found.sku})` : ''}`
      : 'Producto seleccionado';
  }

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
   * Elige un producto (candidato sugerido o resultado de catálogo) para la
   * línea. Lo añade a `candidates` para que persista visible aunque venga de
   * la búsqueda, y fija `selected_product_id` + `match_status='matched'`.
   */
  chooseProduct(index: number, candidate: ProductCandidate): void {
    const items = [...this.editableItems()];
    const current = items[index];
    const candidates = current.candidates.some((c) => c.id === candidate.id)
      ? current.candidates
      : [candidate, ...current.candidates];
    items[index] = {
      ...current,
      candidates,
      selected_product_id: candidate.id,
      match_status: 'matched',
    };
    this.editableItems.set(items);
    this.productSearchIndex.set(null);
  }

  /** Vuelve a "Producto nuevo" (limpia la selección → prebulk en el carrito). */
  chooseNewProduct(index: number): void {
    const items = [...this.editableItems()];
    items[index] = {
      ...items[index],
      selected_product_id: undefined,
      match_status: 'new',
    };
    this.editableItems.set(items);
    this.productSearchIndex.set(null);
  }

  // ============================================================
  // Confirm
  // ============================================================

  onConfirm(): void {
    const match = this.matchResult();
    const scan = this.scanResult();
    if (!match || !scan) return;

    this.confirmed.emit({
      scanResult: scan,
      matchResult: match,
      editedItems: this.editableItems(),
      invoiceNumber: this.editInvoiceNumber || undefined,
      invoiceDate: this.editInvoiceDate || undefined,
      // Punto 2: proveedor elegido por el usuario (null = no cambiar).
      supplierId: this.selectedSupplierId(),
    });

    this.closeAndReset();
  }

  // ============================================================
  // Modal lifecycle
  // ============================================================

  onOpenChange(open: boolean): void {
    if (!open) {
      this.closeAndReset();
    }
    this.isOpenChange.emit(open);
  }

  onCancel(): void {
    this.closeAndReset();
  }

  resetWizard(): void {
    this.currentStep.set(1);
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
    this.isProcessingFile.set(false);
    this.isScanning.set(false);
    this.scanResult.set(null);
    this.matchResult.set(null);
    this.editableItems.set([]);
    this.editInvoiceNumber = '';
    this.editInvoiceDate = '';
    // Punto 2 + 3/4: limpia estado de proveedor y del picker de productos.
    this.selectedSupplierId.set(null);
    this.selectedSupplierName.set(null);
    this.showSupplierCreate.set(false);
    this.supplierDropdownOpen.set(false);
    this.supplierSearchResults.set([]);
    this.supplierSearchLoading.set(false);
    this.supplierSearchTerm.set('');
    this.productSearchIndex.set(null);
    this.productSearchResults.set([]);
    this.productSearchLoading.set(false);
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.isOpenChange.emit(false);
  }
}
