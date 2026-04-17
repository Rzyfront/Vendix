import {Component, input, output, signal, computed, DestroyRef, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { switchMap, catchError } from 'rxjs';
import { of } from 'rxjs';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { SpinnerComponent } from '../../../../../../../shared/components/spinner/spinner.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { StepsLineComponent } from '../../../../../../../shared/components/steps-line/steps-line.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';

import { InvoiceScannerService } from '../../services/invoice-scanner.service';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  MatchedLineItem,
} from '../../interfaces/invoice-scanner.interface';

@Component({
  selector: 'app-invoice-scanner-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    SpinnerComponent,
    IconComponent,
    InputComponent,
    StepsLineComponent,
    CurrencyPipe,
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
            [class.border-border]="!isDragging()"
            [class.hover:border-primary/50]="!isDragging()"
            [class.hover:bg-muted/30]="!isDragging()"
          >
            @if (filePreviewUrl()) {
              <!-- File preview -->
              <div class="flex flex-col items-center gap-3">
                <img
                  [src]="filePreviewUrl()"
                  alt="Vista previa"
                  class="max-h-40 rounded-lg border border-border object-contain"
                />
                <p class="text-sm font-medium text-text-primary">
                  {{ selectedFile()?.name }}
                </p>
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
        </div>
      }

      <!-- Step 2: Processing -->
      @if (currentStep() === 2) {
        <div class="flex flex-col lg:flex-row gap-6 min-h-[300px]">
          <!-- Image preview -->
          @if (filePreviewUrl()) {
            <div class="lg:w-1/3 flex-shrink-0">
              <img
                [src]="filePreviewUrl()"
                alt="Factura"
                class="w-full max-h-64 lg:max-h-80 object-contain rounded-lg border border-border"
              />
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
          <!-- Supplier section -->
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
            <p class="text-base font-medium text-text-primary">
              {{ matchResult()!.supplier_match.name }}
            </p>
            @if (matchResult()!.supplier_match.tax_id) {
              <p class="text-xs text-text-secondary mt-0.5">
                NIT: {{ matchResult()!.supplier_match.tax_id }}
              </p>
            }
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
                        @if (item.match_status === 'matched' && item.candidates.length > 0) {
                          <span class="text-text-primary text-xs">
                            {{ item.candidates[0].name }}
                          </span>
                        } @else if (item.candidates.length > 0) {
                          <select
                            class="w-full px-2 py-1 text-xs border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary"
                            [value]="item.selected_product_id || ''"
                            (change)="selectProduct(i, $event)"
                          >
                            <option value="">Producto nuevo</option>
                            @for (candidate of item.candidates; track candidate.id) {
                              <option [value]="candidate.id">
                                {{ candidate.name }} ({{ candidate.sku }})
                              </option>
                            }
                          </select>
                        } @else {
                          <span class="text-xs text-text-secondary italic">Producto nuevo</span>
                        }
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
                  @if (item.candidates.length > 0 && item.match_status !== 'matched') {
                    <select
                      class="w-full px-2 py-1 text-xs border border-border rounded-md bg-surface text-text-primary"
                      [value]="item.selected_product_id || ''"
                      (change)="selectProduct(i, $event)"
                    >
                      <option value="">Producto nuevo</option>
                      @for (candidate of item.candidates; track candidate.id) {
                        <option [value]="candidate.id">
                          {{ candidate.name }} ({{ candidate.sku }})
                        </option>
                      }
                    </select>
                  }
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
  readonly isOpenChange = output<boolean>();
  readonly confirmed = output<{
    scanResult: InvoiceScanResult;
    matchResult: InvoiceMatchResult;
    editedItems: MatchedLineItem[];
    invoiceNumber?: string;
    invoiceDate?: string;
  }>();

  // Wizard state
  currentStep = signal<1 | 2 | 3>(1);
  selectedFile = signal<File | null>(null);
  filePreviewUrl = signal<string | null>(null);
  fileError = signal<string | null>(null);
  isDragging = signal(false);
  isScanning = signal(false);
  scanResult = signal<InvoiceScanResult | null>(null);
  matchResult = signal<InvoiceMatchResult | null>(null);
  // Editable items (mutable copy of match result items)
  editableItems = signal<MatchedLineItem[]>([]);

  // Editable invoice header
  editInvoiceNumber = '';
  editInvoiceDate = '';

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

  constructor(
    private invoiceScannerService: InvoiceScannerService,
    private toastService: ToastService,
  ) {}

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
      const reader = new FileReader();
      reader.onload = () => {
        this.filePreviewUrl.set(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      // PDF - no preview image
      this.filePreviewUrl.set(null);
    }
  }

  removeFile(): void {
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
  }

  // ============================================================
  // Scanning
  // ============================================================

  startScan(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.currentStep.set(2);
    this.isScanning.set(true);

    this.invoiceScannerService
      .scanInvoice(file)
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
          // Create editable copy of items
          this.editableItems.set(
            matchResponse.data.items.map((item) => ({ ...item })),
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

  selectProduct(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const items = [...this.editableItems()];
    const productId = value ? Number(value) : undefined;
    items[index] = {
      ...items[index],
      selected_product_id: productId,
      match_status: productId ? 'matched' : 'new',
    };
    this.editableItems.set(items);
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
    this.isScanning.set(false);
    this.scanResult.set(null);
    this.matchResult.set(null);
    this.editableItems.set([]);
    this.editInvoiceNumber = '';
    this.editInvoiceDate = '';
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.isOpenChange.emit(false);
  }
}
