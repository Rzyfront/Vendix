import { Component, Input, Output, EventEmitter, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  StepsLineComponent,
  ToastService,
  FileUploadDropzoneComponent,
} from '../../../../../../shared/components';
import type { SelectorOption, StepsLineItem } from '../../../../../../shared/components';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { BankAccount, ColumnMappingConfig } from '../../interfaces/accounting.interface';

@Component({
  selector: 'vendix-statement-import-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    StepsLineComponent,
    FileUploadDropzoneComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Importar Extracto Bancario"
    >
      <!-- Steps Line -->
      <div class="mb-6">
        <app-steps-line [steps]="steps" [currentStep]="currentStep()" size="sm"></app-steps-line>
      </div>

      <!-- Step 0: Seleccionar cuenta + Subir archivo -->
      @if (currentStep() === 0) {
        <div class="space-y-6">
          <!-- Seleccionar cuenta bancaria -->
          <div>
            <h4 class="text-sm font-medium text-gray-700 mb-3">1. Selecciona la cuenta bancaria</h4>
            <app-selector
              placeholder="Seleccionar cuenta bancaria..."
              [options]="bankAccountOptions()"
              [(ngModel)]="selectedAccountId"
            ></app-selector>
          </div>

          <!-- Subir archivo -->
          <div>
            <h4 class="text-sm font-medium text-gray-700 mb-3">2. Sube el extracto bancario</h4>
            <app-file-upload-dropzone
              #dropzone
              label="Arrastra tu extracto aqui"
              helperText="Formatos aceptados: .csv, .txt, .ofx, .qfx"
              accept=".csv,.txt,.ofx,.qfx"
              icon="upload-cloud"
              (fileSelected)="onFileSelected($event)"
              (fileRemoved)="onFileRemoved()"
            ></app-file-upload-dropzone>
          </div>

          <!-- Error -->
          @if (error()) {
            <div class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm">
              <div class="font-medium flex items-center mb-1">
                <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
                Error
              </div>
              <p class="mt-1">{{ error() }}</p>
            </div>
          }
        </div>
      }

      <!-- Step 1: Mapeo de columnas (solo CSV/TXT) -->
      @if (currentStep() === 1) {
        <div class="space-y-4">
          <div class="bg-blue-50 p-3 rounded-lg border border-blue-100 text-blue-700 text-sm flex items-center">
            <app-icon name="info" [size]="16" class="mr-2 shrink-0"></app-icon>
            Asigna cada columna del archivo a su campo correspondiente. Vista previa de las primeras filas.
          </div>

          <!-- Preview Table -->
          @if (previewRows().length > 0) {
            <div class="border rounded-lg overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50">
                  <tr>
                    @for (header of previewHeaders(); track header) {
                      <th class="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{{ header }}</th>
                    }
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  @for (row of previewRows().slice(0, 5); track $index) {
                    <tr>
                      @for (header of previewHeaders(); track header) {
                        <td class="px-3 py-2 text-gray-700 whitespace-nowrap text-xs">{{ row[header] || '-' }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Column Mapping -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-selector
              label="Columna de Fecha *"
              placeholder="Seleccionar..."
              [options]="columnOptions()"
              [(ngModel)]="columnMapping.date_column"
            ></app-selector>
            <app-selector
              label="Columna de Descripcion *"
              placeholder="Seleccionar..."
              [options]="columnOptions()"
              [(ngModel)]="columnMapping.description_column"
            ></app-selector>
            <app-selector
              label="Columna de Monto (unica)"
              placeholder="Seleccionar..."
              [options]="columnOptionsWithEmpty()"
              [(ngModel)]="columnMapping.amount_column"
            ></app-selector>
            <app-selector
              label="Columna de Debito"
              placeholder="Seleccionar..."
              [options]="columnOptionsWithEmpty()"
              [(ngModel)]="columnMapping.debit_column"
            ></app-selector>
            <app-selector
              label="Columna de Credito"
              placeholder="Seleccionar..."
              [options]="columnOptionsWithEmpty()"
              [(ngModel)]="columnMapping.credit_column"
            ></app-selector>
            <app-selector
              label="Columna de Referencia"
              placeholder="Seleccionar..."
              [options]="columnOptionsWithEmpty()"
              [(ngModel)]="columnMapping.reference_column"
            ></app-selector>
            <app-selector
              label="Formato de Fecha"
              [options]="dateFormatOptions"
              [(ngModel)]="columnMapping.date_format"
            ></app-selector>
            <app-selector
              label="Separador Decimal"
              [options]="decimalSeparatorOptions"
              [(ngModel)]="columnMapping.decimal_separator"
            ></app-selector>
          </div>
        </div>
      }

      <!-- Step 2: Preview + Resultados -->
      @if (currentStep() === 2) {
        <div class="space-y-4">
          @if (importing()) {
            <div class="flex flex-col items-center py-12">
              <app-icon name="loader" [size]="48" class="text-primary mb-4 animate-spin"></app-icon>
              <p class="text-sm text-gray-500">Importando transacciones...</p>
              <p class="text-xs text-gray-400 mt-1">Esto puede tomar unos momentos</p>
            </div>
          } @else if (importResult()) {
            <!-- Results -->
            <div class="bg-white border rounded-lg overflow-hidden">
              <div class="bg-gray-50 p-4 border-b">
                <h4 class="font-medium text-gray-900">Resumen de Importacion</h4>
              </div>
              <div class="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                <div class="bg-green-50 p-3 rounded border border-green-100">
                  <div class="text-sm text-green-600 font-medium">Importadas</div>
                  <div class="text-2xl font-bold text-green-700">{{ importResult()!.imported }}</div>
                </div>
                <div class="bg-amber-50 p-3 rounded border border-amber-100">
                  <div class="text-sm text-amber-600 font-medium">Duplicados</div>
                  <div class="text-2xl font-bold text-amber-700">{{ importResult()!.duplicates_skipped }}</div>
                </div>
                @if (importResult()!.errors.length) {
                  <div class="bg-red-50 p-3 rounded border border-red-100">
                    <div class="text-sm text-red-600 font-medium">Errores</div>
                    <div class="text-2xl font-bold text-red-700">{{ importResult()!.errors.length }}</div>
                  </div>
                }
              </div>
            </div>

            @if (importResult()!.errors.length) {
              <div class="border rounded-lg overflow-hidden">
                <div class="bg-red-50 p-3 border-b border-red-100 text-red-800 font-medium text-sm flex items-center">
                  <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
                  Detalle de Errores
                </div>
                <div class="max-h-40 overflow-y-auto bg-white p-3">
                  <ul class="list-disc list-inside space-y-1 text-sm text-red-600">
                    @for (err of importResult()!.errors; track $index) {
                      <li>{{ err }}</li>
                    }
                  </ul>
                </div>
              </div>
            }
          } @else {
            <!-- Pre-import preview -->
            <div class="bg-green-50 p-4 rounded-lg border border-green-100">
              <div class="flex items-center">
                <app-icon name="check-circle" [size]="24" class="text-green-500 mr-3"></app-icon>
                <div>
                  <h4 class="text-sm font-medium text-green-900">Archivo listo para importar</h4>
                  <p class="text-sm text-green-700">
                    Se procesaran las transacciones del extracto bancario.
                  </p>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-3 pt-4 border-t border-gray-200 mt-4">
        @if (currentStep() === 0) {
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          <app-button variant="primary" (clicked)="goToStep1()" [disabled]="!canAdvanceStep0()">
            Siguiente
          </app-button>
        }

        @if (currentStep() === 1) {
          <app-button variant="outline" (clicked)="currentStep.set(0)">Atras</app-button>
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          <app-button variant="primary" (clicked)="goToStep2()" [disabled]="!canAdvanceStep1()">
            Siguiente
          </app-button>
        }

        @if (currentStep() === 2 && !importing()) {
          @if (importResult()) {
            <app-button variant="outline" (clicked)="onCancel()">Cerrar</app-button>
          } @else {
            <app-button variant="outline" (clicked)="currentStep.set(isCSV() ? 1 : 0)">Atras</app-button>
            <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
            <app-button variant="primary" (clicked)="executeImport()">
              <app-icon name="upload" [size]="16" slot="icon"></app-icon>
              Importar
            </app-button>
          }
        }
      </div>
    </app-modal>
  `,
})
export class StatementImportModalComponent {
  @Input() isOpen = false;
  @Input() bankAccounts: BankAccount[] = [];
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() importComplete = new EventEmitter<void>();

  @ViewChild('dropzone') dropzoneRef!: FileUploadDropzoneComponent;

  private reconciliationService = inject(BankReconciliationService);
  private toastService = inject(ToastService);

  steps: StepsLineItem[] = [
    { label: 'Archivo' },
    { label: 'Mapeo' },
    { label: 'Importar' },
  ];

  currentStep = signal(0);
  selectedAccountId: number | null = null;
  selectedFile = signal<File | null>(null);
  error = signal<string | null>(null);
  importing = signal(false);
  importResult = signal<{ imported: number; duplicates_skipped: number; errors: string[] } | null>(null);

  // CSV preview data
  previewHeaders = signal<string[]>([]);
  previewRows = signal<Record<string, string>[]>([]);

  columnMapping: ColumnMappingConfig = {
    date_column: '',
    description_column: '',
    amount_column: '',
    debit_column: '',
    credit_column: '',
    reference_column: '',
    date_format: 'YYYY-MM-DD',
    decimal_separator: '.',
  };

  dateFormatOptions: SelectorOption[] = [
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
    { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY' },
  ];

  decimalSeparatorOptions: SelectorOption[] = [
    { value: '.', label: 'Punto (.)' },
    { value: ',', label: 'Coma (,)' },
  ];

  bankAccountOptions = computed(() =>
    this.bankAccounts
      .filter((a) => a.status === 'active')
      .map((a) => ({
        value: a.id,
        label: `${a.name} - ${a.bank_name} (${a.account_number})`,
      })),
  );

  columnOptions = computed(() =>
    this.previewHeaders().map((h) => ({
      value: h,
      label: h,
    })),
  );

  columnOptionsWithEmpty = computed(() => [
    { value: '', label: '-- No asignar --' },
    ...this.columnOptions(),
  ]);

  isCSV = computed(() => {
    const file = this.selectedFile();
    if (!file) return false;
    const ext = file.name.split('.').pop()?.toLowerCase();
    return ext === 'csv' || ext === 'txt';
  });

  canAdvanceStep0 = computed(() => {
    return this.selectedAccountId !== null && this.selectedFile() !== null;
  });

  canAdvanceStep1 = computed(() => {
    return !!this.columnMapping.date_column && !!this.columnMapping.description_column &&
      (!!this.columnMapping.amount_column || (!!this.columnMapping.debit_column && !!this.columnMapping.credit_column));
  });

  onFileSelected(file: File): void {
    const allowedExtensions = ['.csv', '.txt', '.ofx', '.qfx'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      this.toastService.error('Formato no soportado. Usa .csv, .txt, .ofx o .qfx');
      return;
    }
    this.selectedFile.set(file);
    this.error.set(null);

    // If CSV/TXT, parse preview
    if (ext === '.csv' || ext === '.txt') {
      this.parseCSVPreview(file);
    }
  }

  onFileRemoved(): void {
    this.selectedFile.set(null);
    this.previewHeaders.set([]);
    this.previewRows.set([]);
  }

  private parseCSVPreview(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter((l) => l.trim());
        if (lines.length < 2) {
          this.error.set('El archivo no tiene suficientes filas');
          return;
        }

        // Detect separator
        const firstLine = lines[0];
        const separator = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';

        const headers = firstLine.split(separator).map((h) => h.trim().replace(/^"|"$/g, ''));
        this.previewHeaders.set(headers);

        const rows: Record<string, string>[] = [];
        for (let i = 1; i < Math.min(lines.length, 6); i++) {
          const values = lines[i].split(separator).map((v) => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
          });
          rows.push(row);
        }
        this.previewRows.set(rows);

        // Auto-detect columns
        this.autoDetectColumns(headers);
      } catch {
        this.error.set('Error al leer el archivo CSV');
      }
    };
    reader.readAsText(file);
  }

  private autoDetectColumns(headers: string[]): void {
    const lower = headers.map((h) => h.toLowerCase());

    const dateIdx = lower.findIndex((h) => h.includes('fecha') || h.includes('date'));
    if (dateIdx >= 0) this.columnMapping.date_column = headers[dateIdx];

    const descIdx = lower.findIndex((h) => h.includes('descripcion') || h.includes('description') || h.includes('concepto') || h.includes('detalle'));
    if (descIdx >= 0) this.columnMapping.description_column = headers[descIdx];

    const amountIdx = lower.findIndex((h) => h.includes('monto') || h.includes('amount') || h.includes('valor'));
    if (amountIdx >= 0) this.columnMapping.amount_column = headers[amountIdx];

    const debitIdx = lower.findIndex((h) => h.includes('debito') || h.includes('debit') || h.includes('cargo'));
    if (debitIdx >= 0) this.columnMapping.debit_column = headers[debitIdx];

    const creditIdx = lower.findIndex((h) => h.includes('credito') || h.includes('credit') || h.includes('abono'));
    if (creditIdx >= 0) this.columnMapping.credit_column = headers[creditIdx];

    const refIdx = lower.findIndex((h) => h.includes('referencia') || h.includes('reference') || h.includes('ref'));
    if (refIdx >= 0) this.columnMapping.reference_column = headers[refIdx];
  }

  goToStep1(): void {
    if (!this.canAdvanceStep0()) return;

    if (this.isCSV()) {
      this.currentStep.set(1);
    } else {
      // OFX/QFX — skip column mapping, go directly to import preview
      this.currentStep.set(2);
    }
  }

  goToStep2(): void {
    if (!this.canAdvanceStep1()) {
      this.toastService.error('Asigna al menos fecha, descripcion y monto (o debito/credito)');
      return;
    }
    this.currentStep.set(2);
  }

  executeImport(): void {
    const file = this.selectedFile();
    if (!file || !this.selectedAccountId) return;

    this.importing.set(true);
    this.reconciliationService.importStatement(this.selectedAccountId, file).subscribe({
      next: (res) => {
        this.importing.set(false);
        this.importResult.set(res.data);
        if (res.data.errors?.length === 0) {
          this.toastService.success(`${res.data.imported} transacciones importadas`);
          this.importComplete.emit();
        } else {
          this.toastService.warning('Importacion completada con advertencias');
        }
      },
      error: (err) => {
        this.importing.set(false);
        this.error.set(err?.error?.message || 'Error al importar el extracto');
        this.toastService.error('Error al importar el extracto bancario');
      },
    });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetState();
  }

  private resetState(): void {
    this.currentStep.set(0);
    this.selectedAccountId = null;
    this.selectedFile.set(null);
    this.error.set(null);
    this.importing.set(false);
    this.importResult.set(null);
    this.previewHeaders.set([]);
    this.previewRows.set([]);
    this.columnMapping = {
      date_column: '',
      description_column: '',
      amount_column: '',
      debit_column: '',
      credit_column: '',
      reference_column: '',
      date_format: 'YYYY-MM-DD',
      decimal_separator: '.',
    };
  }
}
