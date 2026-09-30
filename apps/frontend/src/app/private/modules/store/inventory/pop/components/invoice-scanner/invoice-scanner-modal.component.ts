import {Component, input, output, signal, computed, effect, viewChild, DestroyRef, Injector, afterNextRender, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap, catchError, of, Subject, Subscription } from 'rxjs';

import { AiReviewAckComponent } from '../../../../../../../shared/components/ai-review-ack/ai-review-ack.component';
import {
  AiDiscardToggleComponent,
  AI_DISCARDED_ROW_CLASSES,
} from '../../../../../../../shared/components/ai-discard-toggle/ai-discard-toggle.component';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { SpinnerComponent } from '../../../../../../../shared/components/spinner/spinner.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { TextareaComponent } from '../../../../../../../shared/components/textarea/textarea.component';
import { InputsearchComponent } from '../../../../../../../shared/components/inputsearch/inputsearch.component';
import { StepsLineComponent } from '../../../../../../../shared/components/steps-line/steps-line.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { LineTaxesEditorComponent, taxTypeLabel } from '../line-taxes-editor/line-taxes-editor.component';

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
  InvoiceRevalidateDivergence,
  InvoiceRevalidateResult,
  ScanAttachmentInfo,
  ScanLineTax,
} from '../../interfaces/invoice-scanner.interface';
import type { PopLineTax } from '../../interfaces/pop-cart.interface';
import {
  mapScanTaxesToPopLineTaxes,
  popLineTaxesToScanTaxes,
  scanLineHasTaxes,
} from '../../utils/scan-line-to-cart.util';
import {
  buildRevalidateConsolidated,
  mergeRevalidatedLines,
} from '../../utils/revalidate-merge.util';
import {
  editedHeaderDiscountFields,
  seedHeaderDiscount,
} from '../../utils/scan-header-discount.util';
import {
  deriveLineTax,
  derivePurchaseTotals,
  prorateHeaderDiscount,
  PurchaseLineTaxInput,
} from '../../utils/purchase-line-tax.util';

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
    TextareaComponent,
    InputsearchComponent,
    StepsLineComponent,
    CurrencyPipe,
    PopSupplierQuickCreateComponent,
    AiReviewAckComponent,
    AiDiscardToggleComponent,
    LineTaxesEditorComponent,
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
       @if (revalidateView() === 'review') {
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
          <div id="pop-scan-lines" tabindex="-1" class="outline-none">
            <h4 class="text-sm font-semibold text-text-primary mb-3">
              Productos ({{ editableItems().length }})
            </h4>

            <!-- Desktop table -->
            <div class="hidden sm:block overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border text-left">
                    <th class="pb-2 pr-3 text-text-secondary font-medium">Descripcion</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-16">Cant.</th>
                    <!--
                      El precio que viaja al carrito y a la orden es el NETO: el
                      backend ya aplanó el bruto impreso. La etiqueta lo dice
                      para que el operador no busque en esta columna la cifra
                      del papel — esa se pinta debajo del input cuando la
                      factura venía con IVA incluido.
                    -->
                    <th class="pb-2 px-3 text-text-secondary font-medium w-28">P. Unit.</th>
                    <!--
                      Espejo del backend: P. Neto Unit. = unit_price_net
                      que deriva deriveLineTax (util compartido). Es el precio
                      unitario TRAS el descuento de línea y el prorrateo del
                      descuento de cabecera. Misma cifra que el backend va a
                      persistir. Solo se pinta si hay descuento (unit_price_net
                      < unit_price); sin ruido en líneas limpias.
                    -->
                    <th class="pb-2 px-3 text-text-secondary font-medium w-24">P. Neto Unit.</th>
                    <!--
                      Descuento en DINERO y en PORCENTAJE, sincronizados: el
                      monto es la fuente de verdad (es lo que persiste y lo que
                      lee la contabilidad) y el porcentaje es la cifra que la
                      factura imprime. Editar cualquiera de los dos reescribe el
                      otro, así que no pueden contradecirse en pantalla.
                    -->
                    <th class="pb-2 px-3 text-text-secondary font-medium w-28">Dcto %</th>
                    <!--
                      F3 IVA lifecycle: la tasa de IVA que asignó la IA baja
                      base gravable, IVA descontable y costo capitalizado; el
                      operador tiene que poder verla y corregirla ANTES de
                      confirmar, o se queda arrastrando el error hasta anular
                      la orden.
                    -->
                    <th class="pb-2 px-3 text-text-secondary font-medium w-44">Impuestos</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-24">Subtotal</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-24">Total</th>
                    <th class="pb-2 px-3 text-text-secondary font-medium w-20">Estado</th>
                    <th class="pb-2 pl-3 text-text-secondary font-medium">Producto</th>
                    <th class="pb-2 pl-3 text-text-secondary font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of editableItems(); track $index; let i = $index) {
                    <!--
                      QUI-644: la fila descartada se tacha y se atenúa en vez de
                      desaparecer. Sigue visible a propósito: el usuario tiene
                      que poder verificar QUÉ está dejando fuera y devolverlo si
                      se equivocó, y una fila que se esfuma parece un borrado.
                    -->
                    <tr class="border-b border-border/50 hover:bg-muted/20"
                        [class]="isDiscarded(i) ? discardedRowClasses : ''"
                        [class.bg-primary/5]="item.revalidation === 'changed'"
                        [class.bg-amber-50]="item.revalidation === 'missing'">
                      <td class="py-2 pr-3">
                        <span class="text-text-primary line-clamp-1" [title]="item.description">
                          {{ item.description }}
                        </span>
                        <!--
                          Los dos ejes van PEGADOS al renglón y COEXISTEN: una
                          línea puede venir de un producto archivado Y traer la
                          cantidad convertida. En una lista suelta arriba, el
                          operador tendría que adivinar de qué renglón habla
                          cada aviso.
                        -->
                        @if (matchNote(item); as note) {
                          <span class="block text-[11px] text-amber-600 leading-snug">{{ note }}</span>
                        }
                        @if (quantityNote(item); as note) {
                          <span class="block text-[11px] text-text-secondary leading-snug">{{ note }}</span>
                        }
                        <ng-container
                          [ngTemplateOutlet]="revalidationTag"
                          [ngTemplateOutletContext]="{ item: item }"
                        ></ng-container>
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
                          [value]="linePrice(item)"
                          (change)="updateItemPrice(i, $event)"
                          class="w-24 px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                          min="0"
                          step="0.01"
                        />
                        <!--
                          Cotejo contra el papel: solo cuando la factura venía
                          con IVA incluido el bruto impreso difiere del neto que
                          se edita arriba. En facturas con IVA por fuera los dos
                          números son el mismo y pintarlo sería ruido.
                        -->
                        @if (!isGrossLine(item) && invoicePrintedWithTax() && (item.unit_price_gross ?? 0) > 0) {
                          <span class="block mt-0.5 text-[10px] text-text-secondary">
                            impreso {{ item.unit_price_gross | currency: 0 }}
                          </span>
                        }
                      </td>
                      <!--
                        P. Neto Unit. del deriveLineTax util compartido:
                        unit_price_net = (unit_price × qty - descuento línea
                        - prorrateo cabecera) / qty, con base gravable
                        corregida si los precios incluyen IVA. Solo se pinta
                        cuando hay descuento efectivo (neto < bruto); sin ruido
                        en líneas limpias, donde repetiría P. Unit.
                      -->
                      @if (
                        lineTaxRows()[i]?.unit_price_net != null &&
                        lineTaxRows()[i]!.unit_price_net < linePrice(item)
                      ) {
                        <td class="py-2 px-3 text-text-primary">
                          {{ lineTaxRows()[i]!.unit_price_net | currency: 0 }}
                        </td>
                      } @else {
                        <td class="py-2 px-3 text-text-secondary">—</td>
                      }
                      <!--
                        QUI-661 Fase 4: el descuento que extrajo la IA es
                        editable ANTES de confirmar. Es el punto donde el
                        usuario lo verifica: una vez confirmado baja la base
                        gravable, el IVA descontable y el costo capitalizado, y
                        corregirlo después implica anular la orden.
                      -->
                      <td class="py-2 px-3">
                        <div class="flex items-center gap-1">
                          <input
                            type="number"
                            [value]="linePercentDiscount(item)"
                            (change)="updateItemDiscountPercent(i, $event)"
                            class="w-16 px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                            min="0"
                            max="100"
                            step="1"
                            aria-label="Descuento en porcentaje"
                          />
                          <span class="text-[10px] text-text-secondary">%</span>
                        </div>
                      </td>
                      <!--
                        Tasa de IVA: el scanner la emite como fracción (0.19);
                        el input la muestra en PORCENTAJE (19) que es como la
                        piensa el operador. El handler convierte al guardar.
                      -->
                      <td class="py-2 px-3">
                        <ng-container
                          [ngTemplateOutlet]="taxChipsButton"
                          [ngTemplateOutletContext]="{ i: i }"
                        ></ng-container>
                      </td>
                      <!-- Subtotal = base gravable de la línea (neto tras descuento,
                           prorrateo de cabecera aplicado). Espejo del backend. -->
                      <td class="py-2 px-3 text-text-primary">
                        {{ lineTaxRows()[i]?.net_line || 0 | currency: 0 }}
                      </td>
                      <!-- Total = base gravable + IVA. Sustituye al qty × unit_price
                           que ignoraba descuento, IVA y prorrateo. -->
                      <td class="py-2 px-3 text-text-primary font-medium">
                        {{ lineTaxRows()[i]?.total_line || 0 | currency: 0 }}
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
                      <td class="py-2 pl-3">
                        <app-ai-discard-toggle
                          [discarded]="isDiscarded(i)"
                          [label]="item.description"
                          size="sm"
                          (toggled)="toggleDiscard(i)"
                        ></app-ai-discard-toggle>
                      </td>
                    </tr>
                    @if (expandedTaxRow() === i) {
                      <tr class="border-b border-border/50 bg-muted/10">
                        <td colspan="11" class="px-3 py-3">
                          <ng-container
                            [ngTemplateOutlet]="taxPanel"
                            [ngTemplateOutletContext]="{ i: i }"
                          ></ng-container>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>

            <!-- Mobile cards -->
            <div class="sm:hidden space-y-3">
              @for (item of editableItems(); track $index; let i = $index) {
                <div class="bg-surface border border-border rounded-lg p-3 space-y-2"
                     [class]="isDiscarded(i) ? discardedRowClasses : ''"
                     [class.border-l-4]="!!item.revalidation"
                     [class.border-l-primary]="item.revalidation === 'changed' || item.revalidation === 'new'"
                     [class.border-l-amber-500]="item.revalidation === 'missing'">
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
                    <app-ai-discard-toggle
                      [discarded]="isDiscarded(i)"
                      [label]="item.description"
                      size="sm"
                      (toggled)="toggleDiscard(i)"
                    ></app-ai-discard-toggle>
                  </div>
                  @if (matchNote(item); as note) {
                    <p class="text-[11px] text-amber-600 leading-snug">{{ note }}</p>
                  }
                  @if (quantityNote(item); as note) {
                    <p class="text-[11px] text-text-secondary leading-snug">{{ note }}</p>
                  }
                  <ng-container
                    [ngTemplateOutlet]="revalidationTag"
                    [ngTemplateOutletContext]="{ item: item }"
                  ></ng-container>
                  <div class="grid grid-cols-2 gap-2">
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
                      <label class="text-[10px] text-text-secondary">{{ isGrossLine(item) ? 'P. Unit.' : 'P. Unit. neto' }}</label>
                      <input
                        type="number"
                        [value]="linePrice(item)"
                        (change)="updateItemPrice(i, $event)"
                        class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary"
                        min="0"
                        step="0.01"
                      />
                      @if (!isGrossLine(item) && invoicePrintedWithTax() && (item.unit_price_gross ?? 0) > 0) {
                        <span class="block mt-0.5 text-[10px] text-text-secondary">
                          impreso {{ item.unit_price_gross | currency: 0 }}
                        </span>
                      }
                    </div>
                    <!-- Móvil a paridad con desktop: descuento en PORCENTAJE y
                         tasa de IVA, editables. Sin ellos el operador móvil no
                         puede corregir lo que la IA asignó antes de confirmar. -->
                    <div>
                      <label class="text-[10px] text-text-secondary">Dcto %</label>
                      <input
                        type="number"
                        [value]="linePercentDiscount(item)"
                        (change)="updateItemDiscountPercent(i, $event)"
                        class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary"
                        min="0"
                        max="100"
                        step="1"
                        aria-label="Descuento en porcentaje"
                      />
                    </div>
                    <div>
                      <label class="text-[10px] text-text-secondary">Impuestos</label>
                      <ng-container
                        [ngTemplateOutlet]="taxChipsButton"
                        [ngTemplateOutletContext]="{ i: i }"
                      ></ng-container>
                    </div>
                  </div>
                  @if (expandedTaxRow() === i) {
                    <ng-container
                      [ngTemplateOutlet]="taxPanel"
                      [ngTemplateOutletContext]="{ i: i }"
                    ></ng-container>
                  }
                  <!-- Desglose: subtotal / IVA / total, derivado igual que
                       desktop. Reemplaza al qty × unit_price que ignoraba
                       descuento e IVA en móvil. -->
                  <div class="border-t border-border/50 pt-2 space-y-1 text-xs">
                    <div class="flex justify-between">
                      <span class="text-text-secondary">Subtotal</span>
                      <span class="text-text-primary">
                        {{ lineTaxRows()[i]?.net_line || 0 | currency: 0 }}
                      </span>
                    </div>
                    <!--
                      Espejo del backend, a paridad con la columna P. Neto
                      Unit. del desktop: precio unitario TRAS descuento de
                      línea y prorrateo de cabecera. Misma condición que
                      desktop (neto < bruto) para no repetir P. Unit. en
                      líneas limpias, más qty > 0: con cantidad 0 el neto
                      no es divisible y solo pintaría un cero engañoso.
                    -->
                    @if (
                      (item.quantity || 0) > 0 &&
                      lineTaxRows()[i]?.unit_price_net != null &&
                      lineTaxRows()[i]!.unit_price_net < linePrice(item)
                    ) {
                      <div class="flex justify-between">
                        <span class="text-text-secondary">P. Neto Unit.</span>
                        <span class="text-text-primary">
                          {{ lineTaxRows()[i]!.unit_price_net | currency: 0 }}
                        </span>
                      </div>
                    }
                    <div class="flex justify-between">
                      <span class="text-text-secondary">Impuestos</span>
                      <span class="text-text-primary">
                        {{ lineTaxRows()[i]?.tax_amount || 0 | currency: 0 }}
                      </span>
                    </div>
                    <div class="flex justify-between font-semibold">
                      <span class="text-text-primary">Total</span>
                      <span class="text-text-primary">
                        {{ lineTaxRows()[i]?.total_line || 0 | currency: 0 }}
                      </span>
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

          <!--
            Pie de totales derivado por derivePurchaseTotals sobre las
            líneas que sobrevivan al descarte — MISMO algoritmo que el backend
            va a persistir. Antes era qty × unit_price sumado a mano + el
            tax_amount crudo del scan; eso contradecía a las filas y dejaba
            el IVA rancio cuando el operador tocaba cantidad/precio/descuento.
            Las filas de descuento solo se pintan si hay valor (>0): sin ruido
            cuando no hay descuento.
          -->
          <div class="bg-muted/30 rounded-lg p-4 border border-border">
            <div class="space-y-2 text-sm">
              <!--
                "Base antes de descuento" y no "Subtotal bruto": la cifra es la
                suma de los netos de línea antes de restar descuentos, no el
                bruto impreso en la factura. La etiqueta anterior invitaba a
                cotejarla contra el papel y nunca iba a coincidir en una
                factura con IVA incluido.
              -->
              <div class="flex justify-between">
                <span class="text-text-secondary">Base antes de descuento</span>
                <span class="text-text-primary">{{ purchaseTotals().gross_subtotal | currency: 0 }}</span>
              </div>
              @if (purchaseTotals().line_discount > 0) {
                <div class="flex justify-between">
                  <span class="text-text-secondary">(-) Descuento línea</span>
                  <span class="text-text-primary">-{{ purchaseTotals().line_discount | currency: 0 }}</span>
                </div>
              }
              <!--
                Descuento de pie EDITABLE. La IA lo lee mal igual que lee mal
                una línea, y hasta ahora era la única cifra del cálculo que el
                operador no podía corregir sin anular la orden después. El util
                lo prorratea por línea con el mismo algoritmo del backend, así
                que el efecto se ve en el total al instante.
              -->
              <div class="flex justify-between items-center gap-2">
                <span class="text-text-secondary">(-) Descuento general</span>
                <div class="flex items-center gap-1">
                  <span class="text-text-secondary">-</span>
                  <input
                    type="number"
                    [value]="headerDiscount()"
                    (change)="updateHeaderDiscount($event)"
                    class="w-28 px-2 py-1 text-sm text-right border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                    min="0"
                    step="0.01"
                    aria-label="Descuento general de la factura"
                  />
                </div>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">Base gravable</span>
                <span class="text-text-primary font-medium">
                  {{ purchaseTotals().subtotal | currency: 0 }}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-secondary">(+) IVA</span>
                <span class="text-text-primary">
                  {{ purchaseTotals().tax_amount | currency: 0 }}
                </span>
              </div>
              <div class="flex justify-between border-t border-border pt-2">
                <span class="text-text-primary font-semibold">Total</span>
                <span class="text-text-primary font-bold text-base">
                  {{ purchaseTotals().total | currency: 0 }}
                </span>
              </div>

              <!--
                Bloque informativo, separado del costo: el pronto pago es
                financiero, NO entra al costo del inventario. Se pinta solo
                si la factura lo traía. El total de la IA va siempre como
                contraste para detectar drift de OCR.
              -->
              <div class="border-t border-border pt-2 mt-2 space-y-1 text-xs text-text-secondary">
                @if (earlyPaymentDiscount() > 0) {
                  <div class="flex justify-between">
                    <span>Descuento pronto pago (informativo)</span>
                    <span>-{{ earlyPaymentDiscount() | currency: 0 }}</span>
                  </div>
                }
              </div>

              <!--
                Conciliación contra el papel. Tres cifras derivadas frente a las
                tres que la IA leyó impresas en la factura, con su diferencia.
                Antes solo se mostraba el total: el subtotal y el IVA impresos
                llegaban en el payload y la UI los tiraba, así que un IVA mal
                clasificado por línea podía cuadrar el total y aun así mandar
                una base gravable equivocada a la declaración.
              -->
              <div class="border-t border-border pt-3 mt-2">
                <p class="text-[11px] font-semibold text-text-secondary mb-1">
                  Cotejo contra la factura
                </p>
                <table class="w-full text-xs">
                  <thead>
                    <tr class="text-text-secondary">
                      <th class="text-left font-medium pb-1"></th>
                      <th class="text-right font-medium pb-1">Derivado</th>
                      <th class="text-right font-medium pb-1">Impreso</th>
                      <th class="text-right font-medium pb-1">Dif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of printedVsDerived(); track row.label) {
                      <tr>
                        <td class="text-text-secondary py-0.5">{{ row.label }}</td>
                        <td class="text-right text-text-primary py-0.5">
                          {{ row.derived | currency: 0 }}
                        </td>
                        <td class="text-right text-text-secondary py-0.5">
                          @if (row.hasPrinted) {
                            {{ row.printed | currency: 0 }}
                          } @else {
                            <span>—</span>
                          }
                        </td>
                        <td
                          class="text-right py-0.5"
                          [class]="
                            row.hasPrinted && (row.diff > 1 || row.diff < -1)
                              ? 'text-amber-600 font-semibold'
                              : 'text-text-secondary'
                          "
                        >
                          @if (row.hasPrinted) {
                            {{ row.diff | currency: 0 }}
                          } @else {
                            <span>—</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!--
            Aviso NO bloqueante: si el total derivado se aparta más del 2%
            del total impreso por la IA (misma tolerancia que TOTALS_TOLERANCE
            en el backend) se enciende este banner. Avisa, NO bloquea — el
            operador decide si corrige o confirma de todas formas.
          -->
          @if (totalsDriftWarning() !== null) {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p class="text-xs font-semibold text-amber-800">
                Diferencia con el total de la factura
              </p>
              <p class="text-xs text-amber-700 mt-1">
                El total derivado ({{ purchaseTotals().total | currency: 0 }})
                se aparta un {{ driftPercent() }}% del total impreso por la IA
                ({{ scanResult()?.total || 0 | currency: 0 }}). Verifica
                cantidades, precios, descuentos y tasas de IVA antes de
                confirmar.
              </p>
            </div>
          }

          <!--
            QUI-855: resumen compacto de impuestos por línea. Sustituye a la
            columna «% IVA»: una línea puede llevar IVA + INC / ICUI / IBUA y un
            solo input no los expresa. El clic expande el editor completo.
          -->
          <ng-template #taxChipsButton let-i="i">
            <button
              type="button"
              class="flex w-full flex-wrap items-center gap-1 rounded-md border border-border px-1.5 py-1 text-left hover:border-primary hover:bg-primary/5"
              (click)="toggleTaxPanel(i)"
              [attr.aria-expanded]="expandedTaxRow() === i"
              aria-label="Editar impuestos de la línea"
            >
              @for (chip of taxChips()[i]; track chip.key) {
                <span
                  class="inline-flex whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >
                  {{ chip.label }}
                  @if (chip.fixed !== null) {
                    &nbsp;{{ chip.fixed | currency: 0 }}/u
                  }
                </span>
              }
              <app-icon
                [name]="expandedTaxRow() === i ? 'chevron-up' : 'chevron-down'"
                [size]="12"
                class="ml-auto text-text-secondary"
              ></app-icon>
            </button>
          </ng-template>

          <!-- QUI-855: panel expandido de una línea (descuento en dinero + editor). -->
          <ng-template #taxPanel let-i="i">
            @if (taxPanelData()[i]; as d) {
              <div class="flex flex-col gap-2">
                <div class="flex flex-wrap items-center gap-2 text-[10px]">
                  <span class="text-text-secondary">Descuento $</span>
                  <input
                    type="number"
                    [value]="d.discount_money"
                    (change)="updateItemDiscountAmount(i, $event)"
                    class="w-24 px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                    min="0"
                    step="0.01"
                    aria-label="Descuento en dinero"
                  />
                </div>
                <app-line-taxes-editor
                  [taxes]="d.rows"
                  [unitPrice]="d.unit_price"
                  [quantity]="d.quantity"
                  [discountAmount]="d.discount_money"
                  [pricesIncludeTax]="d.include"
                  (taxesChange)="onLineTaxesChange(i, $event)"
                  (pricesIncludeTaxChange)="onLineIncludeChange(i, $event)"
                ></app-line-taxes-editor>
              </div>
            }
          </ng-template>

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

          <!-- QUI-855 paso 8b: etiqueta de la línea tras revalidar con IA. -->
          <ng-template #revalidationTag let-item="item">
            @if (item.revalidation === 'changed') {
              <span class="mt-0.5 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <app-icon name="sparkles" [size]="10"></app-icon>
                Revalidado
              </span>
            } @else if (item.revalidation === 'new') {
              <span class="mt-0.5 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <app-icon name="plus" [size]="10"></app-icon>
                Nueva (revalidación)
              </span>
            } @else if (item.revalidation === 'missing') {
              <span class="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                <app-icon name="alert-triangle" [size]="10"></app-icon>
                No encontrada en el documento
              </span>
            }
          </ng-template>

          <!-- QUI-855 paso 8b: revalidación opcional con IA contra el documento original. -->
          <div class="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-muted/20">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-text-primary">
                Revalidar datos consolidados con IA
              </p>
              @if (canRevalidate()) {
                <p class="text-xs text-text-secondary mt-0.5">
                  La IA releerá el documento original y lo comparará con lo que
                  ves en pantalla. Podrás decidir qué conservar.
                </p>
              } @else {
                <p class="text-xs text-amber-700 mt-0.5" data-testid="revalidate-disabled-hint">
                  El documento original no se guardó; no se puede revalidar
                </p>
              }
            </div>
            <app-toggle
              [checked]="revalidateChecked()"
              [disabled]="!canRevalidate()"
              (changed)="onRevalidateToggle($event)"
              ariaLabel="Revalidar datos consolidados con IA"
            ></app-toggle>
          </div>

          <!-- Verificación obligatoria de los datos precargados por la IA
               (se exige tras revalidar o al agregar sin revalidar). -->
          @if (!revalidateChecked()) {
            <app-ai-review-ack
              #ackBlock
              [(acknowledged)]="aiAck"
              [itemCount]="editableItems().length"
              entityLabel="ítems de la factura"
            ></app-ai-review-ack>
          }
        </div>
       } @else {
        <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-1" data-testid="revalidate-panel">
          @switch (revalidateView()) {
            @case ('summary') {
              <div class="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
                <h4 class="text-sm font-semibold text-text-primary">Se enviará a revalidar</h4>
                <div class="flex justify-between gap-3">
                  <span class="text-text-secondary">Líneas</span>
                  <span class="text-text-primary font-medium" data-testid="revalidate-summary-lines">{{ keptCount() }}</span>
                </div>
                <div class="flex justify-between gap-3">
                  <span class="text-text-secondary">Total consolidado</span>
                  <span class="text-text-primary font-medium">{{ purchaseTotals().total | currency: 0 }}</span>
                </div>
                <div class="flex justify-between gap-3">
                  <span class="text-text-secondary">Documento</span>
                  <span class="text-text-primary font-medium truncate" data-testid="revalidate-summary-file">{{ scanResult()?.scan_attachment?.file_name }}</span>
                </div>
              </div>
              <app-textarea
                label="Nota para la IA (opcional)"
                placeholder="Ej: la cantidad de la línea 3 es 12 cajas, no 12 unidades"
                [rows]="4"
                [ngModel]="revalidateNote()"
                (ngModelChange)="onRevalidateNoteChange($event)"
                name="revalidateNote"
              ></app-textarea>
              <p class="text-[11px] text-text-secondary text-right">
                {{ revalidateNote().length }} / {{ REVALIDATE_NOTE_MAX }}
              </p>
            }
            @case ('loading') {
              <div class="flex flex-col items-center justify-center gap-4 min-h-[240px]" data-testid="revalidate-loading">
                <app-spinner size="lg"></app-spinner>
                <p class="text-sm text-text-secondary text-center">
                  La IA está releyendo el documento original…
                </p>
              </div>
            }
            @case ('error') {
              <div class="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3" data-testid="revalidate-error">
                <app-icon name="alert-circle" [size]="20" class="text-red-600 shrink-0"></app-icon>
                <div>
                  <p class="text-sm font-semibold text-red-800">No se pudo revalidar</p>
                  <p class="text-xs text-red-700 mt-1">{{ revalidateError() }}</p>
                </div>
              </div>
            }
            @case ('result') {
              @if (revalidateResult(); as res) {
                <div class="rounded-lg border border-border bg-muted/30 p-4 space-y-2" data-testid="revalidate-result">
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-sm font-semibold text-text-primary">Resultado de la revalidación</h4>
                    <app-badge [variant]="confidenceVariant(res.report.confidence)" size="xsm">
                      {{ confidenceLabel(res.report.confidence) }}
                    </app-badge>
                  </div>
                  <p class="text-sm text-text-primary">{{ res.report.summary }}</p>
                </div>

                @if (res.report.red_flags.length > 0) {
                  <div class="rounded-lg border border-red-300 bg-red-50 p-3 space-y-1.5" data-testid="revalidate-red-flags">
                    <p class="text-xs font-semibold text-red-800 flex items-center gap-1">
                      <app-icon name="alert-triangle" [size]="14"></app-icon>
                      Alertas
                    </p>
                    @for (flag of res.report.red_flags; track $index) {
                      <p class="text-xs text-red-700">
                        @if (flag.line_index !== null) {
                          <span class="font-semibold">Línea {{ lineNumber(flag.line_index) }}:</span>
                        }
                        {{ flag.message }}
                      </p>
                    }
                  </div>
                }

                @if (res.report.findings.length > 0) {
                  <div class="rounded-lg border border-border p-3 space-y-1.5" data-testid="revalidate-findings">
                    <p class="text-xs font-semibold text-text-primary">Hallazgos</p>
                    @for (f of res.report.findings; track $index) {
                      <p class="text-xs flex items-start gap-1.5" [class]="f.severity === 'warning' ? 'text-amber-700' : 'text-text-secondary'">
                        <app-icon [name]="f.severity === 'warning' ? 'alert-triangle' : 'info'" [size]="12" class="mt-0.5 shrink-0"></app-icon>
                        <span>{{ f.message }}</span>
                      </p>
                    }
                  </div>
                }

                <div data-testid="revalidate-divergences">
                  <h4 class="text-sm font-semibold text-text-primary mb-2">
                    Divergencias ({{ res.report.divergences.length }})
                  </h4>
                  @if (res.report.divergences.length === 0) {
                    <p class="text-xs text-text-secondary">
                      La IA no encontró diferencias con los datos consolidados.
                    </p>
                  } @else {
                    <div class="hidden sm:block overflow-x-auto">
                      <table class="w-full text-xs">
                        <thead>
                          <tr class="border-b border-border text-left text-text-secondary">
                            <th class="pb-2 pr-3 font-medium">Línea</th>
                            <th class="pb-2 px-3 font-medium">Campo</th>
                            <th class="pb-2 px-3 font-medium">Consolidado</th>
                            <th class="pb-2 px-3 font-medium">En el documento</th>
                            <th class="pb-2 px-3 font-medium">Revalidado</th>
                            <th class="pb-2 pl-3 font-medium">Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (d of res.report.divergences; track $index) {
                            <tr class="border-b border-border/50 bg-amber-50/60">
                              <td class="py-2 pr-3 font-semibold">{{ d.line_index === null ? '—' : lineNumber(d.line_index) }}</td>
                              <td class="py-2 px-3">{{ d.field }}</td>
                              <td class="py-2 px-3 text-text-secondary">{{ formatValue(d.consolidated_value) }}</td>
                              <td class="py-2 px-3 text-text-secondary">{{ formatValue(d.document_value) }}</td>
                              <td class="py-2 px-3 font-semibold text-primary">{{ formatValue(d.revalidated_value) }}</td>
                              <td class="py-2 pl-3 text-text-secondary">{{ d.reason }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <div class="sm:hidden space-y-2">
                      @for (d of res.report.divergences; track $index) {
                        <div class="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1 text-xs">
                          <p class="font-semibold text-text-primary">
                            {{ d.line_index === null ? 'General' : 'Línea ' + lineNumber(d.line_index) }} · {{ d.field }}
                          </p>
                          <p><span class="text-text-secondary">Consolidado:</span> {{ formatValue(d.consolidated_value) }}</p>
                          <p><span class="text-text-secondary">En el documento:</span> {{ formatValue(d.document_value) }}</p>
                          <p><span class="text-text-secondary">Revalidado:</span> <span class="font-semibold text-primary">{{ formatValue(d.revalidated_value) }}</span></p>
                          <p class="text-text-secondary">{{ d.reason }}</p>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            }
          }
        </div>
       }
      }

      <!-- Footer Actions -->
      <div slot="footer" class="flex justify-between gap-3">
        <div>
          @if (currentStep() === 3 && revalidateView() === 'review') {
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
          @if (currentStep() === 3 && revalidateView() === 'summary') {
            <app-button variant="outline" (clicked)="backToReview()">
              Volver
            </app-button>
            <app-button variant="primary" (clicked)="sendRevalidate()">
              Enviar a revalidar
            </app-button>
          }
          @if (currentStep() === 3 && revalidateView() === 'error') {
            <app-button variant="outline" (clicked)="backToReview()">
              Volver a la precarga
            </app-button>
            <app-button variant="primary" (clicked)="sendRevalidate()">
              Reintentar
            </app-button>
          }
          @if (currentStep() === 3 && revalidateView() === 'result') {
            <app-button variant="outline" (clicked)="editManually()">
              Editar manualmente
            </app-button>
            <app-button variant="outline" (clicked)="keepPreload()">
              Mantener precarga
            </app-button>
            <app-button variant="primary" (clicked)="useRevalidation()">
              Usar revalidación
            </app-button>
          }
          @if (currentStep() === 3 && revalidateView() === 'review' && revalidateChecked()) {
            <app-button
              variant="primary"
              [disabled]="editableItems().length === 0 || allDiscarded() || !canRevalidate()"
              (clicked)="openRevalidateSummary()"
            >
              Revalidar
            </app-button>
          }
          @if (currentStep() === 3 && revalidateView() === 'review' && !revalidateChecked()) {
            <!--
              QUI-644: el contador refleja SOLO los activos, y el botón se
              deshabilita si todo quedó descartado — confirmar una carga vacía
              no es una operación, es un no-op disfrazado de éxito.
            -->
            <app-button
              variant="primary"
              [disabled]="editableItems().length === 0 || allDiscarded()"
              (clicked)="onConfirm()"
            >
              @if (keptCount() < editableItems().length) {
                Agregar {{ keptCount() }} de {{ editableItems().length }}
              } @else {
                Agregar al Carrito
              }
            </app-button>
          }
        </div>
      </div>
    </app-modal>

    <!-- Punto 2: quick-create de proveedor, montado como hermano del modal
         para evitar anidar app-modal dentro de app-modal. -->
    <app-pop-supplier-quick-create
      [(isOpen)]="showSupplierCreate"
      [preload]="supplierCreatePreload() ?? null"
      (supplierCreated)="onSupplierCreated($event)"
      (close)="onSupplierCreateClosed()"
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
  private injector = inject(Injector);
  readonly isOpen = input(false);
  /**
   * Fase 4: scan profile selector. Defaults to `retail`. The parent
   * (`pop.component.ts`) passes `'ingredient'` when the cart already
   * contains a pure-ingredient line (so the AI extracts UoM hints too).
   */
  readonly orderType = input<'retail' | 'ingredient'>('retail');
  /**
   * Proveedor ACTUAL del carrito (null si no hay). Fix revisión QUI-845: el
   * quick-create solo debe abrirse cuando NO hay proveedor en ninguno de los
   * dos lados. Si el carrito ya tiene uno y el OCR marca `is_new`, `onConfirm`
   * emite `supplierId: null` y `pop.component` conserva el actual
   * («null = no cambiar») en vez de forzar a crear/duplicar proveedor.
   */
  readonly currentSupplierId = input<number | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly confirmed = output<{
    scanResult: InvoiceScanResult;
    matchResult: InvoiceMatchResult;
    editedItems: MatchedLineItem[];
    invoiceNumber?: string;
    invoiceDate?: string;
    supplierId?: number | null;
    /** QUI-855: la factura subida por el scan (null si no se pudo subir). */
    scanAttachment?: ScanAttachmentInfo | null;
  }>();

  // Wizard state
  currentStep = signal<1 | 2 | 3>(1);

  /**
   * Verificación obligatoria de los datos precargados por la IA. El botón de
   * confirmar sigue habilitado: si esto es false, `onConfirm` desvía el clic a
   * `requestAttention()` en vez de emitir la orden de compra.
   */
  readonly aiAck = signal(false);
  private readonly ackBlock = viewChild<AiReviewAckComponent>('ackBlock');

  // ===== QUI-644: descarte de ítems de la precarga =====
  /**
   * Índices de `editableItems()` que el usuario marcó para NO cargar.
   *
   * Se indexa por posición y no por id porque las líneas escaneadas no tienen
   * uno estable: la IA devuelve texto libre y varias líneas de una factura
   * pueden describir el mismo producto. El conjunto se reinicia junto con el
   * wizard — obligatorio, porque el contenido proyectado en `app-modal` NO se
   * destruye al cerrar (precedente QUI-438) y el descarte sobreviviría al
   * siguiente escaneo.
   */
  readonly discardedIndexes = signal<Set<number>>(new Set());

  /** Clases de la fila descartada, compartidas con las otras superficies. */
  protected readonly discardedRowClasses = AI_DISCARDED_ROW_CLASSES;

  /**
   * D.1 — por qué esta línea no fue al producto que dice el papel.
   *
   * El backend ya manda el motivo tipado y, cuando aplica, el producto
   * archivado. Se pinta con nombre y SKU para que el operador no tenga que
   * cruzar la lista de avisos con veinte renglones.
   */
  matchNote(item: MatchedLineItem): string | null {
    const archived = item.archived_candidate;
    switch (item.match_reason) {
      case 'archived_candidate':
        return archived
          ? `El catálogo tiene «${archived.name}»${archived.sku ? ` (SKU ${archived.sku})` : ''}, pero está ARCHIVADO y no se seleccionó: su costo y su stock no cuentan para esta compra. Reactívalo o crea un producto nuevo desde esta línea.`
          : 'Había un producto archivado que no se seleccionó a propósito.';
      case 'archived_sku_reassigned':
        return archived
          ? `El SKU impreso pertenece a «${archived.name}», que está ARCHIVADO. Se propuso otro producto en su lugar: verifica que sea el correcto antes de confirmar.`
          : 'El SKU impreso pertenece a un producto archivado; se propuso otro en su lugar.';
      case 'no_catalog_match':
        return 'Sin coincidencias en el catálogo: se creará como producto nuevo.';
      case 'lookup_failed':
        return 'No se pudo consultar el catálogo para esta línea; revísala a mano antes de confirmar.';
      default:
        return null;
    }
  }

  /**
   * C.8 — la cantidad que se va a cargar NO es la que imprime la factura.
   *
   * Se muestran las DOS cifras (la del papel y la aplicada) porque el total de
   * la línea NO se recalcula al redondear: enseñar sólo la aplicada al lado de
   * un total intacto haría ver 30.000 junto a 3 × 12.000.
   */
  quantityNote(item: MatchedLineItem): string | null {
    const adj = item.quantity_adjustment;
    if (!adj) return null;
    const original = this.trimNumber(adj.original_quantity);
    const applied = this.trimNumber(adj.applied_quantity);
    if (adj.reason === 'converted_to_stock_units') {
      const purchase = adj.purchase_unit ? ` ${adj.purchase_unit}` : '';
      const stock = adj.stock_unit ? ` ${adj.stock_unit}` : '';
      const factor = adj.packaging_factor
        ? ` (× ${this.trimNumber(adj.packaging_factor)})`
        : '';
      return `La factura trae ${original}${purchase}${factor} y se cargan ${applied}${stock} a ${this.trimNumber(adj.applied_unit_price)} c/u. El total de la línea no cambia.`;
    }
    return `La factura trae ${original} y la orden guarda cantidades enteras: se cargan ${applied} al mismo costo unitario (${this.trimNumber(adj.applied_unit_price)}). El total impreso de la línea no se recalculó.`;
  }

  /** Número legible sin decimales de relleno (3 en vez de 3,000). */
  private trimNumber(value: number | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
  }

  isDiscarded(index: number): boolean {
    return this.discardedIndexes().has(index);
  }

  toggleDiscard(index: number): void {
    const next = new Set(this.discardedIndexes());
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    this.discardedIndexes.set(next);
  }

  /** Ítems que SÍ se van a cargar. Es lo único que viaja al backend. */
  readonly keptItems = computed(() =>
    this.editableItems().filter((_, i) => !this.discardedIndexes().has(i)),
  );

  /** Cuántos quedan activos, para el contador del footer. */
  readonly keptCount = computed(() => this.keptItems().length);

  /** Todo descartado: no hay nada que cargar. */
  readonly allDiscarded = computed(
    () => this.editableItems().length > 0 && this.keptCount() === 0,
  );

  // ===== QUI-855 paso 8b: revalidación con IA =====
  readonly REVALIDATE_NOTE_MAX = 2000;
  /** Checkbox «Revalidar datos consolidados con IA» de la vista de revisión. */
  readonly revalidateChecked = signal(false);
  /** Vista del paso 3: la precarga o alguna etapa de la revalidación. */
  readonly revalidateView = signal<
    'review' | 'summary' | 'loading' | 'error' | 'result'
  >('review');
  readonly revalidateNote = signal('');
  readonly revalidateResult = signal<InvoiceRevalidateResult | null>(null);
  readonly revalidateError = signal<string | null>(null);
  private revalidateSub: Subscription | null = null;
  /** Posición en `editableItems()` de cada línea enviada (las no descartadas). */
  private revalidateSentIndexes: number[] = [];

  /** Sin `scan_attachment` (la subida a S3 falló) no hay documento que releer. */
  readonly canRevalidate = computed(
    () => !!this.scanResult()?.scan_attachment?.key,
  );

  onRevalidateToggle(value: boolean): void {
    if (value && !this.canRevalidate()) return;
    this.revalidateChecked.set(value);
  }

  onRevalidateNoteChange(value: string | null): void {
    this.revalidateNote.set((value ?? '').slice(0, this.REVALIDATE_NOTE_MAX));
  }

  openRevalidateSummary(): void {
    if (!this.canRevalidate() || this.keptCount() === 0) return;
    this.revalidateView.set('summary');
  }

  backToReview(): void {
    this.cancelRevalidateRequest();
    this.revalidateError.set(null);
    this.revalidateView.set('review');
  }

  /** Estado EDITADO actual → consolidado → cola de revalidación → polling. */
  sendRevalidate(): void {
    const scan = this.scanResult();
    const key = scan?.scan_attachment?.key;
    if (!scan || !key) return;

    const items = this.editableItems();
    const discarded = this.discardedIndexes();
    const indexes = items.map((_, i) => i).filter((i) => !discarded.has(i));
    if (indexes.length === 0) return;
    this.revalidateSentIndexes = indexes;

    const rows = this.lineTaxRows();
    const totals = this.purchaseTotals();
    const consolidated = buildRevalidateConsolidated({
      scan,
      items: indexes.map((i) => items[i]),
      invoiceNumber: this.editInvoiceNumber,
      invoiceDate: this.editInvoiceDate,
      headerDiscount: this.headerDiscount(),
      headerDiscountGross: this.headerDiscountGross(),
      totals: {
        subtotal: totals.subtotal,
        tax_amount: totals.tax_amount,
        total: totals.total,
      },
      lineTotals: indexes.map((i) => rows[i]?.total_line ?? 0),
    });
    const note = this.revalidateNote().trim();

    this.cancelRevalidateRequest();
    this.revalidateError.set(null);
    this.revalidateView.set('loading');
    this.revalidateSub = this.invoiceScannerService
      .revalidateAndWait({
        scan_attachment_key: key,
        order_type: this.scanProfile(),
        consolidated,
        ...(note ? { note } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.revalidateResult.set(result);
          this.revalidateView.set('result');
        },
        error: (err: unknown) => {
          this.revalidateError.set(
            (err as Error)?.message || 'No se pudo revalidar la factura.',
          );
          this.revalidateView.set('error');
        },
      });
  }

  /** Aplica la revalidación (líneas por índice + cabecera) y vuelve a revisión. */
  useRevalidation(): void {
    const res = this.revalidateResult();
    if (!res) return;
    const items = this.editableItems();
    const indexes = this.revalidateSentIndexes;
    const sent = indexes.map((i) => items[i]).filter(Boolean);
    const c = res.consolidated;
    const merged = mergeRevalidatedLines(
      sent,
      c.line_items ?? [],
      c.prices_include_tax,
    );
    const next = [...items];
    indexes.forEach((editableIdx, k) => {
      if (merged.items[k]) next[editableIdx] = merged.items[k];
    });
    next.push(...merged.items.slice(sent.length));
    this.editableItems.set(next);

    const scan = this.scanResult();
    if (scan) {
      this.scanResult.set({
        ...scan,
        prices_include_tax: c.prices_include_tax ?? scan.prices_include_tax,
        subtotal: c.subtotal ?? scan.subtotal,
        tax_amount: c.tax_amount ?? scan.tax_amount,
        total: c.total ?? scan.total,
        ...(c.discount_amount != null || c.discount_amount_printed != null
          ? {
              discount_amount: c.discount_amount ?? null,
              discount_amount_printed: c.discount_amount_printed ?? null,
            }
          : {}),
      });
    }
    if (c.invoice_number) this.editInvoiceNumber = c.invoice_number;
    if (c.invoice_date) this.editInvoiceDate = c.invoice_date;
    if (c.discount_amount != null || c.discount_amount_printed != null) {
      // Misma regla de unidad que en la siembra, sobre las líneas ya fusionadas.
      const discarded = this.discardedIndexes();
      const seeded = seedHeaderDiscount(
        c,
        next.filter((_, i) => !discarded.has(i)),
      );
      this.headerDiscount.set(seeded.value);
      this.headerDiscountGross.set(seeded.gross);
      this.headerDiscountSeed = seeded.value;
    }
    this.finishRevalidation(false);
  }

  keepPreload(): void {
    this.finishRevalidation(false);
  }

  editManually(): void {
    this.finishRevalidation(true);
  }

  /**
   * Cierre común de los tres caminos: se desmarca el checkbox, se RESETEA el
   * ack (el flujo termina en el único ack existente) y se vuelve a revisión.
   */
  private finishRevalidation(focusLines: boolean): void {
    this.cancelRevalidateRequest();
    this.revalidateResult.set(null);
    this.revalidateError.set(null);
    this.revalidateNote.set('');
    this.revalidateChecked.set(false);
    this.aiAck.set(false);
    this.revalidateView.set('review');
    if (focusLines) {
      afterNextRender(
        () => {
          const el = document.getElementById('pop-scan-lines');
          el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          el?.focus?.({ preventScroll: true });
        },
        { injector: this.injector },
      );
    }
  }

  private cancelRevalidateRequest(): void {
    this.revalidateSub?.unsubscribe();
    this.revalidateSub = null;
  }

  /** Nº de línea (base 1) tal como la ve el operador en la tabla. */
  lineNumber(index: number | null): number | string {
    if (index === null || index === undefined) return '—';
    const mapped = this.revalidateSentIndexes[index];
    return (mapped ?? index) + 1;
  }

  confidenceLabel(c: 'high' | 'medium' | 'low'): string {
    return c === 'high'
      ? 'Confianza alta'
      : c === 'medium'
        ? 'Confianza media'
        : 'Confianza baja';
  }

  confidenceVariant(c: 'high' | 'medium' | 'low'): 'success' | 'warning' | 'error' {
    return c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'error';
  }

  formatValue(v: InvoiceRevalidateDivergence['consolidated_value']): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return String(Math.round(v * 10000) / 10000);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

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
  /** QUI-845: snapshot del proveedor OCR para precargar el quick-create. */
  readonly supplierCreatePreload = signal<{
    name?: string;
    tax_id?: string;
    phone?: string;
  } | null>(null);
  /** True cuando el quick-create fue abierto desde `onConfirm` (is_new): al
   *  crearse el proveedor la confirmación continúa automáticamente. */
  private pendingSupplierConfirm = false;
  /** True cuando el usuario canceló el quick-create durante el flujo de confirm
   *  (is_new sin proveedor en ningún lado). Re-confirmar no debe reabrir el
   *  modal: confirma con `supplierId: null` (proveedor sin cambiar). Se
   *  reinicia con cada escaneo nuevo y al elegir/crear un proveedor. */
  private supplierConfirmDeclined = false;
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

  // ============================================================
  // Derivación fiscal espejo del backend (F3 IVA lifecycle)
  // ============================================================
  //
  // Toda esta sección consume el util compartido `purchase-line-tax.util.ts`
  // —el mismo que ejecuta `purchase-orders.service.ts` al persistir—. Si el
  // modal muestra una cifra y el backend muestra otra, el operador aprueba
  // un cálculo que la base de datos va a contradecir, y corregirlo después
  // implica anular la orden. Por eso la conversión fracción→porcentaje de
  // `tax_rate` ocurre UNA vez, al construir el input que se le pasa al util.

  /**
   * Cabecera que el util necesita. Va SIEMPRE en `false` y no es un descuido:
   * el payload que este modal tiene en mano ya está en NETO —
   * `normalizeOcrResponse` aplanó `unit_price` y `discount_amount` con
   * `/(1 + tasa)` y guardó el bruto impreso en `unit_price_gross`—. Declarar
   * `true` aquí afirma que el IVA está dentro de un número que ya no lo tiene,
   * y `deriveLineTax` lo vuelve a restar: era la brecha del 19% entre lo que
   * el operador aprobaba en la precarga y lo que el carrito y la orden
   * registraban. El modo declarado por la factura se muestra como dato de
   * cotejo (`unit_price_gross`), no se usa como base de cálculo.
   */
  private readonly invoiceHeader = computed(() => ({
    prices_include_tax: false,
  }));

  /**
   * ¿La factura imprimía los precios con IVA incluido? Solo dirige la columna
   * de cotejo contra el papel; no entra a ningún cálculo.
   */
  readonly invoicePrintedWithTax = computed(
    () => this.scanResult()?.prices_include_tax === true,
  );

  /**
   * Descuento COMERCIAL de pie de factura, en NETO. Es señal ESCRIBIBLE y no
   * un `computed` del scan: la IA lee mal el pie igual que lee mal una línea,
   * y sin poder corregirlo el operador solo tenía la opción de anular la orden
   * después. Se siembra al terminar el escaneo y viaja al carrito dentro del
   * `scanResult` que emite `onConfirm`.
   */
  readonly headerDiscount = signal(0);

  /**
   * Unidad del descuento general: BRUTO (impreso) cuando hay líneas
   * multi-impuesto y la factura trae el impreso; NETO si no (ver
   * `scan-header-discount.util`). Se fija al sembrar / al usar la
   * revalidación, y `onConfirm` emite la cifra editada en ESA unidad.
   */
  readonly headerDiscountGross = signal(false);

  /** Cifra con que se sembró el descuento (para saber si hubo edición). */
  private headerDiscountSeed = 0;

  /**
   * Descuento por PRONTO PAGO — sólo se muestra, NO se aplica. Es financiero:
   * va a cuenta de resultado y se decide al registrar el pago (QUI-647).
   * Nunca entra al costo del inventario ni al prorrateo.
   */
  readonly earlyPaymentDiscount = computed(
    () => Number(this.scanResult()?.early_payment_discount ?? 0) || 0,
  );

  /**
   * Prorrateo del descuento de cabecera sobre las líneas que SÍ van a la
   * orden. El util exige el cálculo conjunto: si lo moviéramos dentro de
   * cada `deriveLineTax`, no podríamos garantizar `Σ prorrateado ===
   * headerDiscount` exacto y el total derivaría un centavo contra lo que
   * facturó el proveedor.
   */
  private readonly keptHeaderShares = computed(() =>
    prorateHeaderDiscount(
      this.keptItems().map((i) => this.toTaxUtilItem(i)),
      this.headerDiscount(),
    ),
  );

  /**
   * Adaptador al shape que el util espera. La única conversión real es
   * `tax_rate` de fracción (0.19) a porcentaje (19); el resto son campos
   * que ya viven en `MatchedLineItem` con nombres coincidentes.
   *
   * `prices_include_tax` se omite a propósito: vive en `InvoiceScanResult`,
   * no en la línea, y el util cae al header de la factura.
   *
   * `discount_amount` se omite DELIBERADAMENTE aunque la línea lo traiga. El
   * descuento de esta pantalla se expresa en PORCENTAJE y nada más, y el monto
   * gana por precedencia en `deriveLineTax`: si viajara, el número que se
   * aplica dejaría de ser el que el operador ve y edita en el input. El monto
   * de la IA ya se convirtió a porcentaje una sola vez, al recibir el escaneo.
   */
  private toTaxUtilItem = (item: MatchedLineItem): PurchaseLineTaxInput => {
    // QUI-855 — camino multi-impuesto: la línea se trabaja en BRUTO (precio y
    // descuento impresos), con el modo de precios de la línea y sus filas; el
    // kernel deriva el neto. Aquí el monto SÍ viaja (gana por precedencia): el
    // editor lo escribe y limpia el % cuando el operador teclea uno.
    if (scanLineHasTaxes(item)) {
      const printed = Number(item.discount_amount_printed) || 0;
      return {
        unit_price: this.linePrice(item),
        quantity: item.quantity,
        discount_percentage: item.discount_percentage,
        ...(printed > 0 ? { discount_amount: printed } : {}),
        prices_include_tax: this.lineInclude(item),
        taxes: mapScanTaxesToPopLineTaxes(item.taxes!),
      };
    }
    return {
      unit_price: item.unit_price,
      quantity: item.quantity,
      tax_rate: (Number(item.tax_rate ?? 0) || 0) * 100,
      discount_percentage: item.discount_percentage,
    };
  };

  // ============================================================
  // QUI-855: multi-impuesto por línea
  // ============================================================

  /** ¿La línea trabaja en bruto con sus filas de impuestos? */
  isGrossLine(item: MatchedLineItem): boolean {
    return scanLineHasTaxes(item);
  }

  /** Precio unitario que el operador edita: bruto impreso o neto legacy. */
  linePrice(item: MatchedLineItem): number {
    return this.isGrossLine(item)
      ? Number(item.unit_price_gross ?? item.unit_price) || 0
      : item.unit_price;
  }

  /** Modo de precios de la línea. Legacy: siempre neto (ya aplanado). */
  private lineInclude(item: MatchedLineItem): boolean {
    if (!this.isGrossLine(item)) return false;
    return item.prices_include_tax ?? this.scanResult()?.prices_include_tax === true;
  }

  /** Descuento propio de la línea en DINERO (el monto gana sobre el %). */
  private ownDiscountMoney(item: MatchedLineItem): number {
    const gross = this.linePrice(item) * (Number(item.quantity) || 0);
    if (this.isGrossLine(item)) {
      const printed = Number(item.discount_amount_printed) || 0;
      if (printed > 0) return this.round2(Math.min(printed, gross));
    }
    const pct = Math.min(100, Math.max(0, Number(item.discount_percentage) || 0));
    return this.round2(gross * (pct / 100));
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Filas del editor: las de la línea o, si es legacy, su IVA (tasa ×100). */
  private taxRowsOf(item: MatchedLineItem): PopLineTax[] {
    if (this.isGrossLine(item)) return mapScanTaxesToPopLineTaxes(item.taxes!);
    return [
      {
        tax_type: 'iva',
        tax_rate: this.displayPercent((Number(item.tax_rate ?? 0) || 0) * 100),
        calc_mode: 'percent',
        add_to_cost: false,
      },
    ];
  }

  /** Línea del expandido: estable hasta que cambia una línea (no recrea el editor). */
  readonly taxPanelData = computed(() =>
    this.editableItems().map((item) => ({
      rows: this.taxRowsOf(item),
      unit_price: this.linePrice(item),
      quantity: item.quantity,
      discount_money: this.ownDiscountMoney(item),
      include: this.lineInclude(item),
    })),
  );

  /** Chips del resumen: «IVA 19 %», «ICUI 20 %», «IBUA $68/u». */
  readonly taxChips = computed(() =>
    this.editableItems().map((item) =>
      this.taxRowsOf(item).map((t) => ({
        key: t.tax_type,
        label:
          t.calc_mode === 'fixed_per_unit'
            ? taxTypeLabel(t.tax_type)
            : `${taxTypeLabel(t.tax_type)} ${this.displayPercent(t.tax_rate)} %`,
        fixed:
          t.calc_mode === 'fixed_per_unit'
            ? Number(t.fixed_amount_per_unit) || 0
            : null,
      })),
    ),
  );

  /** Línea con su panel de impuestos abierto (una a la vez). */
  readonly expandedTaxRow = signal<number | null>(null);

  toggleTaxPanel(index: number): void {
    this.expandedTaxRow.update((cur) => (cur === index ? null : index));
  }

  /**
   * El editor emitió las filas de la línea. Una línea legacy (neta) que sólo
   * cambió la tasa del IVA sigue en el camino legacy; con cualquier otra cosa
   * (otro impuesto, monto fijo, modo incluido, al costo…) pasa al camino
   * multi-impuesto, conservando el precio neto como su base.
   */
  onLineTaxesChange(index: number, rows: PopLineTax[]): void {
    const items = [...this.editableItems()];
    const item = items[index];
    if (!item) return;
    if (this.isGrossLine(item)) {
      items[index] = { ...item, taxes: popLineTaxesToScanTaxes(rows) };
    } else if (this.isSimpleIvaRow(rows)) {
      const pct = Math.min(100, Math.max(0, Number(rows[0].tax_rate) || 0));
      items[index] = { ...item, tax_rate: pct / 100 };
    } else {
      items[index] = this.toGrossLine(item, popLineTaxesToScanTaxes(rows), false);
    }
    this.editableItems.set(items);
  }

  /** Toggle de modo (incluido/agregado) de LA LÍNEA; las filas vuelven a heredarlo. */
  onLineIncludeChange(index: number, value: boolean): void {
    const items = [...this.editableItems()];
    const item = items[index];
    if (!item) return;
    if (this.isGrossLine(item)) {
      items[index] = {
        ...item,
        prices_include_tax: value,
        taxes: item.taxes!.map((t) => ({ ...t, is_inclusive: undefined })),
      };
    } else {
      // Legacy ya es «agregado»: sólo «incluido» cambia algo.
      if (!value) return;
      items[index] = this.toGrossLine(
        item,
        popLineTaxesToScanTaxes(this.taxRowsOf(item)),
        true,
      );
    }
    this.editableItems.set(items);
  }

  private isSimpleIvaRow(rows: PopLineTax[]): boolean {
    if (rows.length !== 1) return false;
    const r = rows[0];
    return (
      r.tax_type === 'iva' &&
      r.calc_mode !== 'fixed_per_unit' &&
      r.amount_override == null &&
      !r.add_to_cost &&
      r.is_inclusive === undefined &&
      r.base_mode === undefined
    );
  }

  /** Pasa una línea neta legacy al camino multi-impuesto (su neto es su base). */
  private toGrossLine(
    item: MatchedLineItem,
    taxes: ScanLineTax[],
    include: boolean,
  ): MatchedLineItem {
    return {
      ...item,
      taxes,
      unit_price_gross: item.unit_price,
      prices_include_tax: include,
      discount_amount_printed: null,
    };
  }

  /**
   * Descuento en DINERO tecleado. Sincroniza el %: línea multi-impuesto guarda
   * el monto impreso (gana en el carrito y el backend); legacy sólo guarda el %.
   */
  updateItemDiscountAmount(index: number, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const items = [...this.editableItems()];
    const item = items[index];
    if (!item) return;
    const gross = this.linePrice(item) * (Number(item.quantity) || 0);
    const money = Math.min(Math.max(0, Number.isFinite(raw) ? raw : 0), gross);
    const pct = gross > 0 ? Math.min(100, (money / gross) * 100) : 0;
    items[index] = this.isGrossLine(item)
      ? {
          ...item,
          discount_amount_printed: money > 0 ? money : null,
          discount_percentage: pct,
          discount_amount: null,
        }
      : { ...item, discount_percentage: pct, discount_amount: null };
    this.editableItems.set(items);
  }

  /**
   * Porcentaje para pintar en pantalla. Los porcentajes se muestran en ENTERO
   * (20% ⇒ `20`); solo se cae a decimales cuando el valor realmente no es
   * entero, para no falsear un 12,5% que la factura sí imprime. Sin esto,
   * `0.19 * 100` pinta `19.000000000000002` en el input.
   */
  displayPercent(value: number | null | undefined): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return 0;
    const rounded = Math.round(n);
    return Math.abs(n - rounded) < 0.01 ? rounded : Math.round(n * 100) / 100;
  }

  /**
   * Porcentaje de descuento con el que arranca una línea recién escaneada.
   *
   * Prefiere el porcentaje que la IA leyó del papel: es la cifra impresa y es
   * invariante a la base (un 20% es 20% con IVA o sin él). Sólo cuando no hay
   * porcentaje se deriva del monto, contra el bruto de la línea. Con bruto 0
   * (línea bonificada) no hay porcentaje posible y queda en 0 — dividir por
   * cero pintaría NaN en el input.
   */
  private resolveLineDiscountPercent(item: MatchedLineItem): number {
    const printedPct = Number(item.discount_percentage);
    if (Number.isFinite(printedPct) && printedPct > 0) {
      return Math.min(100, printedPct);
    }
    const money = Number(item.discount_amount) || 0;
    const gross = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
    if (money > 0 && gross > 0) return Math.min(100, (money / gross) * 100);
    return 0;
  }

  /**
   * QUI-855 — % inicial de una línea multi-impuesto: el impreso; si la factura
   * sólo trae pesos, se deriva del monto BRUTO impreso contra el bruto de la
   * línea.
   */
  private resolveGrossDiscountPercent(item: MatchedLineItem): number {
    const printedPct = Number(item.discount_percentage);
    if (Number.isFinite(printedPct) && printedPct > 0) {
      return Math.min(100, printedPct);
    }
    const money = Number(item.discount_amount_printed) || 0;
    const gross =
      (Number(item.quantity) || 0) *
      (Number(item.unit_price_gross ?? item.unit_price) || 0);
    if (money > 0 && gross > 0) return Math.min(100, (money / gross) * 100);
    return 0;
  }

  /**
   * Descuento de la línea, en %. Lee UNA sola fuente: `discount_percentage`.
   * La normalización desde el monto que emitió la IA ocurre una vez, al
   * recibir el escaneo, no en cada repintado — así el número del input es
   * estable aunque el operador cambie la cantidad o el precio.
   */
  linePercentDiscount(item: MatchedLineItem): number {
    return this.displayPercent(item.discount_percentage);
  }

  /**
   * Deriva por línea, en una sola pasada, todo lo que la tabla desktop, las
   * tarjetas móviles y el footer necesitan. Reemplaza a `lineTotal()` y a
   * la multiplicación cruda `qty × unit_price` que la tarjeta móvil usaba.
   *
   * Para líneas descartadas el `share` de cabecera es 0 (no entran al cálculo
   * fiscal) pero la línea SIGUE derivándose: el operador ve "cuánto valdría"
   * esa fila si la devolviera, y los números no le saltan al togglear.
   */
  readonly lineTaxRows = computed(() => {
    const header = this.invoiceHeader();
    const shares = this.keptHeaderShares();
    const discarded = this.discardedIndexes();
    let keptCursor = 0;
    return this.editableItems().map((item, i) => {
      const isKept = !discarded.has(i);
      const share = isKept ? shares[keptCursor++] ?? 0 : 0;
      return deriveLineTax(this.toTaxUtilItem(item), header, share);
    });
  });

  /**
   * Totales de la compra, calculados con el MISMO algoritmo que el backend
   * va a persistir. El footer consume esto: lo que ve el operador al
   * confirmar es exactamente lo que va a quedar registrado — sin sorpresas
   * en el costo capitalizado, el IVA descontable ni la base gravable.
   */
  readonly purchaseTotals = computed(() =>
    derivePurchaseTotals(
      this.keptItems().map((i) => this.toTaxUtilItem(i)),
      this.invoiceHeader(),
      this.headerDiscount(),
      0, // el escáner no modela envío
    ),
  );

  /**
   * Cotejo contra el papel: lo DERIVADO frente a lo IMPRESO por la factura.
   *
   * `scanResult.subtotal` y `scanResult.tax_amount` ya llegaban del OCR y la UI
   * los descartaba: el operador solo veía el total. Mostrar las tres cifras
   * lado a lado convierte la confirmación en una conciliación —tres números
   * contra tres números del papel— en vez de un acto de fe sobre el cálculo.
   * La diferencia se pinta con signo: positivo = derivamos MÁS que lo impreso.
   */
  readonly printedVsDerived = computed(() => {
    const scan = this.scanResult();
    const derived = this.purchaseTotals();
    const printedSubtotal = Number(scan?.subtotal ?? 0) || 0;
    const printedTax = Number(scan?.tax_amount ?? 0) || 0;
    const printedTotal = Number(scan?.total ?? 0) || 0;
    return [
      {
        label: 'Base gravable',
        derived: derived.subtotal,
        printed: printedSubtotal,
        diff: derived.subtotal - printedSubtotal,
        hasPrinted: printedSubtotal > 0,
      },
      {
        label: 'IVA',
        derived: derived.tax_amount,
        printed: printedTax,
        diff: derived.tax_amount - printedTax,
        hasPrinted: printedTax > 0,
      },
      {
        label: 'Total',
        derived: derived.total,
        printed: printedTotal,
        diff: derived.total - printedTotal,
        hasPrinted: printedTotal > 0,
      },
    ];
  });

  /**
   * Aviso NO bloqueante: el total derivado se aparta más del 2% del total
   * impreso por la IA. Misma tolerancia que `TOTALS_TOLERANCE` en
   * `apps/backend/src/ai-engine/utils/ocr-money.util.ts`. Devuelve el GAP
   * (0.0–1.0) si supera el umbral, null si cuadra.
   */
  readonly totalsDriftWarning = computed(() => {
    const scanTotal = Number(this.scanResult()?.total ?? 0);
    const derived = this.purchaseTotals().total;
    if (scanTotal <= 0) return null;
    const gap = Math.abs(derived - scanTotal) / scanTotal;
    return gap > 0.02 ? gap : null;
  });

  /** GAP formateado como porcentaje con un decimal — listo para el banner. */
  readonly driftPercent = computed(() => {
    const gap = this.totalsDriftWarning();
    return gap == null ? '0' : (gap * 100).toFixed(1);
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
            .getSuppliers({ state: 'active' as const, limit: 20, search: q })
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
    // Escaneo nuevo ⇒ el confirm vuelve a poder pedir el quick-create si el
    // OCR detecta proveedor nuevo y no hay proveedor en ningún lado.
    this.supplierConfirmDeclined = false;
    this.pendingSupplierConfirm = false;

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
          // El `message` del backend es el devMessage en inglés
          // («AI OCR response parsed but is missing required fields»), que
          // llegaba tal cual al toast. parseApiError aplica la aduana de
          // idioma y cae al copy curado por `error_code`.
          this.toastService.error(parseApiError(err).userMessage);
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
              const hasTaxes = scanLineHasTaxes(item);
              return {
                ...item,
                purchase_uom_id,
                stock_uom_id,
                // QUI-855: la línea multi-impuesto conserva el bruto impreso y
                // el descuento impreso (no se aplanan por IVA).
                ...(hasTaxes
                  ? {
                      unit_price_gross: item.unit_price_gross ?? item.unit_price,
                      discount_amount_printed:
                        Number(item.discount_amount_printed) > 0
                          ? Number(item.discount_amount_printed)
                          : null,
                    }
                  : {}),
                // Única conversión monto → porcentaje de todo el flujo, y ocurre
                // acá: al recibir el escaneo, una sola vez. De aquí en adelante
                // el descuento es un porcentaje y nada más — se pinta así, se
                // edita así y así entra al carrito.
                //
                // Hay facturas que sólo imprimen la rebaja en pesos, sin el "%"
                // al lado. Si no se normalizara, esa rebaja no tendría cómo
                // expresarse y desaparecería de la orden sin aviso.
                discount_percentage: hasTaxes
                  ? this.resolveGrossDiscountPercent(item)
                  : this.resolveLineDiscountPercent(item),
                // El monto se descarta a propósito: gana por precedencia en
                // `deriveLineTax`, así que dejarlo vivo haría que el porcentaje
                // que el operador ve y edita no fuera el que se aplica.
                discount_amount: null,
              };
            }),
          );
          // Pre-fill invoice header
          const scan = this.scanResult();
          if (scan) {
            this.editInvoiceNumber = scan.invoice_number || '';
            this.editInvoiceDate = scan.invoice_date || '';
            // Siembra del descuento de pie. Es una señal escribible, así que
            // hay que sembrarla explícitamente en cada escaneo: si se dejara
            // al valor anterior, el segundo escaneo heredaría el descuento del
            // primero (el contenido proyectado en `app-modal` no se destruye).
            // QUI-855: en la unidad de las líneas (bruto impreso si hay líneas
            // multi-impuesto y la factura trae el impreso; neto si no).
            const discarded = this.discardedIndexes();
            const seeded = seedHeaderDiscount(
              scan,
              this.editableItems().filter((_, i) => !discarded.has(i)),
            );
            this.headerDiscount.set(seeded.value);
            this.headerDiscountGross.set(seeded.gross);
            this.headerDiscountSeed = seeded.value;
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

  /**
   * Descuento de la línea tecleado en PORCENTAJE (0-100) — el caso que motivó
   * el hotfix: la factura dice "-20%", la IA lo dejó en 0 y el operador tiene
   * que poder escribir `20` y ver el total recalcularse antes de confirmar.
   *
   * El porcentaje se acota a 0-100: un descuento negativo es un recargo, y uno
   * mayor que la línea dejaría el costo negativo y envenenaría la capa FIFO
   * que crea la recepción.
   *
   * NO se deriva un monto. El monto se limpia en la misma escritura porque
   * gana por precedencia en `deriveLineTax`: dejarlo con el valor del escaneo
   * haría que teclear un porcentaje no moviera ninguna cifra — el input
   * cambia, el total no, y el operador no tiene forma de saber por qué.
   */
  updateItemDiscountPercent(index: number, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const pct = Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0));
    const items = [...this.editableItems()];
    items[index] = {
      ...items[index],
      discount_percentage: pct,
      discount_amount: null,
      // QUI-855: el monto impreso gana por precedencia; al teclear un %
      // se limpia para que el % sea el que se aplica.
      discount_amount_printed: null,
    };
    this.editableItems.set(items);
  }

  /**
   * Descuento COMERCIAL de pie de factura, en dinero. Se acota a 0 y al bruto
   * de la orden: el util lo prorratea entre las líneas y un pie mayor que la
   * orden no tiene a qué agarrarse.
   */
  updateHeaderDiscount(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const gross = this.purchaseTotals().gross_subtotal;
    this.headerDiscount.set(Math.min(Math.max(0, raw || 0), gross || 0));
  }

  /**
   * F3 IVA lifecycle — tasa de IVA por línea. El scanner la emite como
   * FRACCIÓN decimal (0.19); el input la muestra en PORCENTAJE (19) que es
   * como la piensa el operador. El util compartido vuelve a dividir por 100
   * al derivar, así que guardar en fracción mantiene paridad 1:1 con el
   * payload que el backend recibió del OCR.
   */
  updateItemTaxRate(index: number, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    // El input trabaja en PORCENTAJE 0-100. Acotarlo acá evita que un tecleo
    // como `1900` mande una tasa del 1.900% al costeo y a la declaración.
    const pct = Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0));
    const fraction = pct / 100;
    const items = [...this.editableItems()];
    items[index] = { ...items[index], tax_rate: fraction };
    this.editableItems.set(items);
  }

  updateItemPrice(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value < 0) return;
    const items = [...this.editableItems()];
    items[index] = this.isGrossLine(items[index])
      ? { ...items[index], unit_price_gross: value }
      : { ...items[index], unit_price: value };
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
      .getSuppliers({ state: 'active' as const, limit: 50 })
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
    // Un proveedor recién creado/escogido resuelve el decline previo: la
    // confirmación vuelve a poder seguir normal.
    this.supplierConfirmDeclined = false;
    // Añade el proveedor recién creado al pool y lo selecciona.
    this.suppliers.update((list) => [
      supplier,
      ...list.filter((s) => s.id !== supplier.id),
    ]);
    this.selectedSupplierId.set(supplier.id);
    this.selectedSupplierName.set(supplier.name);
    this.supplierDropdownOpen.set(false);
    this.showSupplierCreate.set(false);

    // QUI-845: si el quick-create se abrió desde el confirm (is_new), el
    // proveedor ya existe → completar la emisión que quedó pendiente.
    if (this.pendingSupplierConfirm) {
      this.pendingSupplierConfirm = false;
      this.supplierCreatePreload.set(null);
      this.onConfirm();
    }
  }

  /** QUI-845: al cancelar el quick-create, el confirm vuelve a comportamiento
   *  manual (el proveedor se deja sin cambiar). Si se canceló desde el flujo de
   *  confirm (is_new sin proveedor en ningún lado), marca el decline para que
   *  un re-confirm no vuelva a abrir el modal: confirma con `supplierId: null`.
   *  También limpia la precarga: un quick-create abierto a mano después no debe
   *  arrastrar datos del escaneo que se descartó. */
  onSupplierCreateClosed(): void {
    const wasPending = this.pendingSupplierConfirm;
    this.pendingSupplierConfirm = false;
    this.supplierCreatePreload.set(null);
    if (wasPending) {
      this.supplierConfirmDeclined = true;
    }
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
    // Este early-return también actúa como guard de doble clic: `closeAndReset`
    // limpia `matchResult`, así que un segundo clic no puede volver a emitir.
    if (!match || !scan) return;

    // El botón sigue habilitado a propósito: en vez de quedar inerte, el clic
    // lleva al usuario a la casilla de verificación y la resalta.
    if (!this.aiAck()) {
      this.ackBlock()?.requestAttention();
      return;
    }

    // QUI-644: el filtrado ocurre acá, en el submit del consumidor. El backend
    // no se entera de los descartados — nunca los recibe. Si el usuario
    // descartó todo, no hay nada que cargar y el clic no debe emitir.
    const kept = this.keptItems();
    if (kept.length === 0) return;

    // QUI-845: proveedor nuevo del OCR sin seleccionar. El quick-create solo
    // se abre cuando NO hay proveedor en ninguno de los dos lados: si el
    // carrito ya trae proveedor (currentSupplierId), se emite `supplierId:
    // null` y pop.component conserva el actual (regresión de revisión). Y si el
    // usuario ya canceló el quick-create en este flujo (supplierConfirmDeclined),
    // re-confirmar no debe volver a abrirlo: confirma sin proveedor (null).
    const supplierMatch = match.supplier_match;
    if (
      supplierMatch.is_new &&
      !this.selectedSupplierId() &&
      !this.currentSupplierId() &&
      !this.supplierConfirmDeclined
    ) {
      this.supplierCreatePreload.set({
        name: scan.supplier?.name || supplierMatch.name,
        tax_id: scan.supplier?.tax_id || supplierMatch.tax_id,
        phone: scan.supplier?.phone,
      });
      this.pendingSupplierConfirm = true;
      this.showSupplierCreate.set(true);
      return;
    }

    this.confirmed.emit({
      // El descuento de pie viaja EDITADO. `pop.component` lee
      // `scanResult.discount_amount` para fijar el descuento general del
      // carrito, así que emitir el `scan` crudo descartaría en silencio la
      // corrección que el operador acaba de hacer en la precarga — y con ella
      // el prorrateo por línea que el backend aplica sobre esa cifra.
      //
      // QUI-855: se emite en el campo de SU unidad (bruto ⇒ `_printed`; neto ⇒
      // `discount_amount` y `_printed` null) para que `pop.component`
      // (`resolveCartHeaderDiscount`) entregue al carrito lo que el operador ve.
      scanResult: {
        ...scan,
        ...editedHeaderDiscountFields(
          scan,
          this.headerDiscount(),
          this.headerDiscountGross(),
          this.headerDiscountSeed,
        ),
      },
      matchResult: match,
      editedItems: kept,
      invoiceNumber: this.editInvoiceNumber || undefined,
      invoiceDate: this.editInvoiceDate || undefined,
      // Punto 2: proveedor elegido por el usuario (null = no cambiar).
      supplierId: this.selectedSupplierId(),
      scanAttachment: scan.scan_attachment ?? null,
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
    this.expandedTaxRow.set(null);
    this.headerDiscount.set(0);
    this.headerDiscountGross.set(false);
    this.headerDiscountSeed = 0;
    // QUI-644: obligatorio. El contenido proyectado en `app-modal` no se
    // destruye al cerrar (QUI-438), así que sin esto el descarte del escaneo
    // anterior se aplicaría a las líneas del siguiente.
    this.discardedIndexes.set(new Set());
    this.editInvoiceNumber = '';
    this.editInvoiceDate = '';
    // Punto 2 + 3/4: limpia estado de proveedor y del picker de productos.
    this.selectedSupplierId.set(null);
    this.selectedSupplierName.set(null);
    this.showSupplierCreate.set(false);
    this.supplierDropdownOpen.set(false);
    this.supplierCreatePreload.set(null);
    this.pendingSupplierConfirm = false;
    this.supplierConfirmDeclined = false;
    this.supplierSearchResults.set([]);
    this.supplierSearchLoading.set(false);
    this.supplierSearchTerm.set('');
    this.productSearchIndex.set(null);
    this.productSearchResults.set([]);
    this.productSearchLoading.set(false);
    // Obligatorio: el contenido proyectado en app-modal no se destruye al
    // cerrar, así que sin este reset la segunda apertura traería el check ya
    // marcado y el guard quedaría anulado.
    this.aiAck.set(false);
    // QUI-855 paso 8b: el estado de la revalidación tampoco sobrevive al cierre.
    this.cancelRevalidateRequest();
    this.revalidateChecked.set(false);
    this.revalidateView.set('review');
    this.revalidateNote.set('');
    this.revalidateResult.set(null);
    this.revalidateError.set(null);
    this.revalidateSentIndexes = [];
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.isOpenChange.emit(false);
  }
}
