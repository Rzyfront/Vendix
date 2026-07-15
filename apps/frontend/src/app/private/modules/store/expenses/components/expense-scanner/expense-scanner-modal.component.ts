import {Component, inject, signal, computed, input, output, DestroyRef} from '@angular/core';
import {takeUntilDestroyed, toSignal} from '@angular/core/rxjs-interop';
import {FormsModule} from '@angular/forms';
import {Store} from '@ngrx/store';
import {map} from 'rxjs';

import {loadExpenses, loadExpensesSummary, loadExpenseCategories} from '../../state/actions/expenses.actions';
import {selectActiveExpenseCategories} from '../../state/selectors/expenses.selectors';
import {Expense, ExpenseCategory, CreateExpenseDto} from '../../interfaces/expense.interface';
import {ExpenseLineItem, ExpenseScanResult} from '../../interfaces/expense-scanner.interface';
import {ExpensesService} from '../../services/expenses.service';
import {ExpenseScannerService} from '../../services/expense-scanner.service';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  IconComponent,
  StepsLineComponent,
  StepsLineItem,
  BadgeComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import {ExpenseCategoryQuickCreateComponent} from '../expense-category-quick-create.component';
import {CurrencyPipe} from '../../../../../../shared/pipes/currency/currency.pipe';
import {toLocalDateString} from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-expense-scanner-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    StepsLineComponent,
    BadgeComponent,
    SpinnerComponent,
    ExpenseCategoryQuickCreateComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      size="xl"
      title="Escanear Factura de Gasto"
      subtitle="Escanea una factura para registrar el gasto automáticamente"
    >
      <!-- Steps indicator -->
      <div class="mb-6">
        <app-steps-line
          [steps]="wizardSteps"
          [currentStep]="currentStep()"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- ============ Step 0: SUBIR ============ -->
      @if (currentStep() === 0) {
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
                Arrastra tu factura aquí
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

      <!-- ============ Step 1: ANALIZAR ============ -->
      @if (currentStep() === 1) {
        <div class="flex flex-col lg:flex-row gap-6 min-h-[300px]">
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

          <div class="flex-1 flex flex-col items-center justify-center gap-4">
            <app-spinner size="lg" text="Procesando factura con IA..."></app-spinner>
            <p class="text-sm text-text-secondary text-center">
              Extrayendo proveedor, items y totales de la factura...
            </p>
          </div>
        </div>
      }

      <!-- ============ Step 2: REVISAR / CONFIRMAR ============ -->
      @if (currentStep() === 2 && scanResult()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <!-- Confidence badge + extraction notes -->
          <div class="flex items-center gap-3 flex-wrap">
            <app-badge [variant]="confidenceVariant()" size="sm">
              Confianza: {{ scanResult()?.confidence ?? 0 }}%
            </app-badge>
            @if (scanResult()?.extraction_notes) {
              <div class="flex-1 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p class="text-xs font-semibold text-amber-800 mb-0.5">Notas de extracción</p>
                <p class="text-xs text-amber-700">{{ scanResult()?.extraction_notes }}</p>
              </div>
            }
          </div>

          <!-- Invoice header fields -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              label="Proveedor"
              [ngModel]="editSupplierName()"
              (ngModelChange)="editSupplierName.set($event)"
              name="supplierName"
              placeholder="Nombre del proveedor"
            ></app-input>
            <app-input
              label="No. Factura"
              [ngModel]="editInvoiceNumber()"
              (ngModelChange)="editInvoiceNumber.set($event)"
              name="invoiceNumber"
              placeholder="Ej: FV-001"
            ></app-input>
            <app-input
              label="Fecha Factura"
              type="date"
              [ngModel]="editInvoiceDate()"
              (ngModelChange)="editInvoiceDate.set($event)"
              name="invoiceDate"
            ></app-input>
            <app-input
              label="Moneda"
              [ngModel]="editCurrency()"
              (ngModelChange)="editCurrency.set($event)"
              name="currency"
              placeholder="COP"
            ></app-input>
          </div>

          <!-- Description -->
          <app-textarea
            label="Descripción"
            [ngModel]="editDescription()"
            (ngModelChange)="editDescription.set($event)"
            name="description"
            [rows]="2"
            placeholder="Descripción del gasto"
          ></app-textarea>

          <!-- Amount -->
          <app-input
            label="Monto Total"
            [ngModel]="editAmount()"
            (ngModelChange)="onAmountChange($event)"
            name="amount"
            [currency]="true"
            [prefixIcon]="true"
          >
            <span slot="prefix-icon" class="text-text-secondary">$</span>
          </app-input>

          <!-- Category with quick-create button -->
          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">Categoría</label>
            <div class="flex gap-2 items-end">
              <app-selector
                class="flex-1"
                [ngModel]="editCategoryId()"
                (ngModelChange)="onCategoryChange($event)"
                [options]="categoryOptions() || []"
                placeholder="Seleccione una categoría"
              ></app-selector>
              <button
                type="button"
                (click)="showCategoryQuickCreate.set(true)"
                class="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-surface hover:bg-primary/5 hover:border-primary text-text-secondary hover:text-primary transition-colors shrink-0"
                title="Crear categoría"
              >
                <app-icon name="plus" [size]="18"></app-icon>
              </button>
            </div>
            @if (matchedCategory()) {
              <p class="text-xs text-text-secondary mt-1">
                Categoría sugerida por IA:
                <span class="font-medium text-text-primary">{{ matchedCategory()?.name }}</span>
                ({{ matchedCategory()?.confidence }}%)
              </p>
            }
          </div>

          <!-- Notes -->
          <app-textarea
            label="Notas Adicionales"
            [ngModel]="editNotes()"
            (ngModelChange)="editNotes.set($event)"
            name="notes"
            [rows]="2"
            placeholder="Detalles adicionales..."
          ></app-textarea>

          <!-- Line items table -->
          @if (editableItems().length > 0) {
            <div>
              <h4 class="text-sm font-semibold text-text-primary mb-3">
                Items ({{ editableItems().length }})
              </h4>

              <!-- Desktop table -->
              <div class="hidden sm:block overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-border text-left">
                      <th class="pb-2 pr-3 text-text-secondary font-medium">Descripción</th>
                      <th class="pb-2 px-3 text-text-secondary font-medium w-20">Cant.</th>
                      <th class="pb-2 px-3 text-text-secondary font-medium w-28">P. Unit.</th>
                      <th class="pb-2 px-3 text-text-secondary font-medium w-24">Total</th>
                      <th class="pb-2 pl-3 text-text-secondary font-medium w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (item of editableItems(); track $index; let i = $index) {
                      <tr class="border-b border-border/50 hover:bg-muted/20">
                        <td class="py-2 pr-3">
                          <input
                            type="text"
                            [value]="item.description"
                            (change)="updateItemDescription(i, $event)"
                            class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                          />
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
                          {{ item.amount | currency: 0 }}
                        </td>
                        <td class="py-2 pl-3">
                          <button
                            type="button"
                            (click)="removeItem(i)"
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
                  <div class="bg-surface border border-border rounded-lg p-3 space-y-2">
                    <input
                      type="text"
                      [value]="item.description"
                      (change)="updateItemDescription(i, $event)"
                      class="w-full px-2 py-1 text-sm border border-border rounded-md bg-surface text-text-primary"
                      placeholder="Descripción"
                    />
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
                          {{ item.amount | currency: 0 }}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      (click)="removeItem(i)"
                      class="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Eliminar
                    </button>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Checkboxes -->
          <label class="flex items-start gap-3 p-3 bg-success/5 rounded-xl border border-success/20 cursor-pointer select-none">
            <input
              type="checkbox"
              [ngModel]="confirmApprove()"
              (ngModelChange)="confirmApprove.set($event)"
              name="confirmApprove"
              class="mt-0.5 w-4 h-4 rounded border-border text-success focus:ring-success"
            />
            <div>
              <p class="text-sm font-medium text-text-primary">Aprobar inmediatamente</p>
              <p class="text-xs text-text-secondary mt-0.5">
                El gasto se creará en estado "aprobado" directamente, omitiendo la revisión.
              </p>
            </div>
          </label>

          @if (confirmApprove()) {
            <label class="flex items-start gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20 cursor-pointer select-none">
              <input
                type="checkbox"
                [ngModel]="confirmPay()"
                (ngModelChange)="confirmPay.set($event)"
                name="confirmPay"
                class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <div>
                <p class="text-sm font-medium text-text-primary">Marcar como pagado</p>
                <p class="text-xs text-text-secondary mt-0.5">
                  Además de aprobar, el gasto se registrará como pagado inmediatamente.
                </p>
              </div>
            </label>
          }
        </div>
      }

      <!-- ============ Footer ============ -->
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
              [disabled]="!selectedFile()"
              (clicked)="startScan()"
            >
              Escanear
            </app-button>
          }
          @if (currentStep() === 2) {
            <app-button
              variant="outline"
              type="button"
              (clicked)="onSubmit('pending')"
              [loading]="submitting()"
              [disabled]="submitting()"
              customClasses="!rounded-xl font-bold"
            >
              <app-icon name="file-text" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Guardar
            </app-button>
            @if (confirmApprove() && !confirmPay()) {
              <app-button
                variant="primary"
                type="button"
                (clicked)="onSubmit('approved')"
                [loading]="submitting()"
                [disabled]="submitting()"
                customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
              >
                <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
                Guardar y Aprobar
              </app-button>
            }
            @if (confirmApprove() && confirmPay()) {
              <app-button
                variant="primary"
                type="button"
                (clicked)="onSubmit('paid')"
                [loading]="submitting()"
                [disabled]="submitting()"
                customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
              >
                <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
                Guardar y Pagar
              </app-button>
            }
          }
        </div>
      </div>
    </app-modal>

    <!-- Quick Create Category Modal (sibling to avoid nesting app-modal) -->
    <vendix-expense-category-quick-create
      [isOpen]="showCategoryQuickCreate()"
      (isOpenChange)="showCategoryQuickCreate.set($event)"
      (created)="onCategoryCreated($event)"
    ></vendix-expense-category-quick-create>
  `,
  styles: [
    `
      .line-clamp-1 {
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    `,
  ],
})
export class ExpenseScannerModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly created = output<Expense>();

  private expenseScannerService = inject(ExpenseScannerService);
  private expensesService = inject(ExpensesService);
  private store = inject(Store);
  private toastService = inject(ToastService);

  // Category options from store
  readonly categoryOptions = toSignal(
    this.store.select(selectActiveExpenseCategories).pipe(
      map(categories =>
        categories.map(cat => ({label: cat.name, value: cat.id})),
      ),
    ),
    {initialValue: [] as {label: string; value: number}[]},
  );

  // Wizard state
  readonly currentStep = signal(0); // 0=Subir, 1=Analizar, 2=Revisar
  readonly selectedFile = signal<File | null>(null);
  readonly filePreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly isScanning = signal(false);
  readonly isProcessingFile = signal(false);
  readonly submitting = signal(false);

  // Scan results
  readonly scanResult = signal<ExpenseScanResult | null>(null);
  readonly matchedCategory = signal<{
    id: number;
    name: string;
    confidence: number;
  } | null>(null);
  readonly editableItems = signal<ExpenseLineItem[]>([]);

  // Editable form fields (signals for zoneless reactivity)
  readonly editSupplierName = signal('');
  readonly editInvoiceNumber = signal('');
  readonly editInvoiceDate = signal('');
  readonly editCurrency = signal('COP');
  readonly editDescription = signal('');
  readonly editAmount = signal(0);
  readonly editCategoryId = signal<number | null>(null);
  readonly editNotes = signal('');

  // Checkboxes
  readonly confirmApprove = signal(false);
  readonly confirmPay = signal(false);
  readonly showCategoryQuickCreate = signal(false);

  // Steps config
  wizardSteps: StepsLineItem[] = [
    {label: 'Subir', completed: false},
    {label: 'Analizar', completed: false},
    {label: 'Revisar', completed: false},
  ];

  // Computed
  readonly isImageFile = computed(() => {
    const file = this.selectedFile();
    return file?.type?.startsWith('image/') ?? false;
  });

  readonly confidenceVariant = computed<'success' | 'warning' | 'error'>(() => {
    const c = this.scanResult()?.confidence ?? 0;
    if (c >= 80) return 'success';
    if (c >= 50) return 'warning';
    return 'error';
  });

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  // ============================================================
  // File handling (from invoice-scanner-modal pattern)
  // ============================================================

  triggerFileInput(): void {
    const el = document.querySelector(
      'app-expense-scanner-modal input[type="file"]:not([capture])',
    ) as HTMLInputElement;
    el?.click();
  }

  triggerCamera(): void {
    const el = document.querySelector(
      'app-expense-scanner-modal input[capture]',
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
    if (!file) return;

    this.currentStep.set(1);
    this.isScanning.set(true);

    this.expenseScannerService
      .scanInvoice(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          this.isScanning.set(false);
          if (!response.success || !response.data) {
            this.toastService.error(
              response.message || 'Error al escanear la factura',
            );
            this.currentStep.set(0);
            return;
          }

          const scan = response.data.scan;
          const matched = response.data.matched_category;

          this.scanResult.set(scan);
          this.matchedCategory.set(matched);

          // Pre-fill editable fields from scan
          this.editSupplierName.set(scan.supplier_name || '');
          this.editInvoiceNumber.set(scan.invoice_number || '');
          this.editInvoiceDate.set(scan.invoice_date || toLocalDateString());
          this.editCurrency.set(scan.currency || 'COP');
          this.editAmount.set(scan.total ?? 0);
          this.editCategoryId.set(matched?.id ?? null);

          // Build description from supplier + items summary
          const supplierName = scan.supplier_name || 'Factura de gasto';
          const allItems = scan.line_items || [];
          const itemsSummary = allItems
            .slice(0, 3)
            .map(it => it.description)
            .filter(Boolean)
            .join(', ');
          const more =
            allItems.length > 3
              ? ` y ${allItems.length - 3} ítem(s) más`
              : '';
          this.editDescription.set(
            itemsSummary ? `${supplierName} — ${itemsSummary}${more}` : supplierName,
          );

          // Editable items copy
          this.editableItems.set(
            allItems.map((it, idx) => ({
              description: it.description,
              quantity: Number(it.quantity) || 0,
              unit_price: Number(it.unit_price) || 0,
              amount: Number(it.amount) || Number(it.quantity) * Number(it.unit_price) || 0,
              line_index: it.line_index ?? idx,
            })),
          );

          // Reset checkboxes
          this.confirmApprove.set(false);
          this.confirmPay.set(false);

          // Advance to review step
          this.wizardSteps = this.wizardSteps.map((s, i) => ({
            ...s,
            completed: i < 1,
          }));
          this.currentStep.set(2);
        },
        error: err => {
          this.isScanning.set(false);
          this.toastService.error(
            err?.error?.message || err?.message || 'Error al procesar la factura',
          );
          this.currentStep.set(0);
        },
      });
  }

  // ============================================================
  // Item editing
  // ============================================================

  updateItemDescription(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const items = [...this.editableItems()];
    items[index] = {...items[index], description: value};
    this.editableItems.set(items);
  }

  updateItemQuantity(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0) return;
    const items = [...this.editableItems()];
    items[index] = {
      ...items[index],
      quantity: value,
      amount: value * items[index].unit_price,
    };
    this.editableItems.set(items);
  }

  updateItemPrice(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0) return;
    const items = [...this.editableItems()];
    items[index] = {
      ...items[index],
      unit_price: value,
      amount: items[index].quantity * value,
    };
    this.editableItems.set(items);
  }

  removeItem(index: number): void {
    const items = [...this.editableItems()];
    items.splice(index, 1);
    this.editableItems.set(items);
  }

  // ============================================================
  // Category
  // ============================================================

  onCategoryChange(value: any): void {
    this.editCategoryId.set(value ? Number(value) : null);
  }

  onAmountChange(value: any): void {
    this.editAmount.set(Number(value) || 0);
  }

  onCategoryCreated(category: ExpenseCategory): void {
    this.store.dispatch(loadExpenseCategories());
    this.editCategoryId.set(category.id);
    this.showCategoryQuickCreate.set(false);
  }

  // ============================================================
  // Submit (rewritten from expense-create onSubmit)
  // ============================================================

  onSubmit(targetState: 'pending' | 'approved' | 'paid'): void {
    if (!this.editDescription() || this.editAmount() <= 0) {
      this.toastService.error('Completa la descripción y el monto');
      return;
    }

    this.submitting.set(true);

    const createAndFinish = (receiptKey?: string) => {
      const payload: CreateExpenseDto = {
        description: this.editDescription(),
        amount: Number(this.editAmount()),
        currency: this.editCurrency() || 'COP',
        category_id: this.editCategoryId() ?? undefined,
        expense_date: this.editInvoiceDate() || toLocalDateString(),
        notes: this.editNotes() || undefined,
        receipt_url: receiptKey,
        items: this.editableItems().map((it, idx) => ({
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          amount: it.amount,
          line_index: idx,
        })),
      };

      this.expensesService
        .createExpense(payload)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: response => {
            const expense = response.data;
            const expenseId = expense?.id;
            if (!expenseId || targetState === 'pending') {
              this.finishSubmit(expense);
              return;
            }
            // Approve (required for both 'approved' and 'paid')
            this.expensesService
              .approveExpense(expenseId)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: () => {
                  if (targetState === 'paid') {
                    this.expensesService
                      .payExpense(expenseId)
                      .pipe(takeUntilDestroyed(this.destroyRef))
                      .subscribe({
                        next: () => this.finishSubmit(expense),
                        error: () => this.finishSubmit(expense),
                      });
                  } else {
                    this.finishSubmit(expense);
                  }
                },
                error: () => this.finishSubmit(expense),
              });
          },
          error: () => {
            this.submitting.set(false);
            this.toastService.error('Error al crear el gasto');
          },
        });
    };

    // Upload receipt first if file exists (use S3 key, not signed URL)
    const file = this.selectedFile();
    if (file) {
      this.expensesService
        .uploadReceipt(file)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result: {key: string; url: string}) =>
            createAndFinish(result.key),
          error: () => createAndFinish(),
        });
    } else {
      createAndFinish();
    }
  }

  private finishSubmit(expense?: Expense): void {
    this.store.dispatch(loadExpenses());
    this.store.dispatch(loadExpensesSummary());
    this.toastService.success('Gasto registrado exitosamente');
    this.submitting.set(false);
    if (expense) this.created.emit(expense);
    this.closeAndReset();
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
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
    this.isProcessingFile.set(false);
    this.isScanning.set(false);
    this.scanResult.set(null);
    this.matchedCategory.set(null);
    this.editableItems.set([]);
    this.editSupplierName.set('');
    this.editInvoiceNumber.set('');
    this.editInvoiceDate.set('');
    this.editCurrency.set('COP');
    this.editDescription.set('');
    this.editAmount.set(0);
    this.editCategoryId.set(null);
    this.editNotes.set('');
    this.confirmApprove.set(false);
    this.confirmPay.set(false);
    this.showCategoryQuickCreate.set(false);
    this.wizardSteps = [
      {label: 'Subir', completed: false},
      {label: 'Analizar', completed: false},
      {label: 'Revisar', completed: false},
    ];
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.isOpenChange.emit(false);
  }
}