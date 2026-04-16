import { Component, inject, input, output, signal } from '@angular/core';
import * as XLSX from 'xlsx';
import { CustomersService } from '../../services/customers.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../shared/components/steps-line/steps-line.component';

@Component({
  selector: 'app-customer-bulk-upload-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, StepsLineComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Carga Masiva de Clientes"
      (closed)="onCancel()"
      subtitle="Importa múltiples clientes desde un archivo Excel"
    >
      <!-- Steps Indicator -->
      <app-steps-line
        [steps]="steps"
        [currentStep]="currentStep()"
        size="sm"
      ></app-steps-line>

      <!-- ═══ STEP 0: Cargar Datos ═══ -->
      @if (currentStep() === 0) {
      <div class="space-y-5 mt-2">
        <!-- Template Download -->
        <div
          class="border-2 border-indigo-100 hover:border-indigo-500 bg-indigo-50 rounded-lg p-4 cursor-pointer transition-all shadow-sm hover:shadow-md group"
          (click)="downloadTemplate()"
        >
          <div class="flex items-center mb-2">
            <div class="p-2 bg-indigo-100 rounded-full text-indigo-600 mr-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <app-icon name="users" [size]="20"></app-icon>
            </div>
            <h4 class="font-bold text-indigo-900">Plantilla de Clientes</h4>
          </div>
          <p class="text-xs text-indigo-700 mb-3 leading-relaxed">
            Incluye: Correo (opcional), Nombre, Apellido, Documento, Tipo Documento y Teléfono.
            Con 10 ejemplos para guiarte.
          </p>
          <div class="flex items-center text-xs font-bold text-indigo-600 group-hover:text-indigo-800">
            <app-icon name="download" [size]="14" class="mr-1"></app-icon>
            DESCARGAR EXCEL
          </div>
        </div>

        <!-- File Upload Zone -->
        <div
          class="border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer"
          [class.border-blue-500]="isDragging()"
          [class.bg-blue-50]="isDragging()"
          [class.border-gray-300]="!isDragging()"
          [class.hover:border-blue-500]="!isDragging()"
          [class.hover:bg-blue-50]="!isDragging()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
          (click)="fileInput.click()"
        >
          <input
            #fileInput
            type="file"
            accept=".xlsx,.xls,.csv"
            class="hidden"
            (change)="onFileSelected($event)"
          />
          @if (!isProcessingFile()) {
            <div>
              <app-icon
                name="upload-cloud"
                [size]="48"
                class="mx-auto text-gray-400 mb-4"
                [class.text-blue-500]="isDragging()"
              ></app-icon>
              <p class="text-gray-900 font-medium">Arrastra tu archivo Excel (.xlsx) aquí</p>
              <p class="text-gray-500 text-sm mt-1">o haz clic para seleccionar</p>
              <p class="text-xs text-indigo-500 mt-2 font-medium">Máximo 1000 clientes por archivo</p>
            </div>
          }
          @if (isProcessingFile()) {
            <div class="animate-pulse flex flex-col items-center">
              <app-icon name="loader" [size]="48" class="text-primary mb-4 animate-spin"></app-icon>
              <p class="text-sm text-gray-500">Procesando archivo...</p>
            </div>
          }
        </div>

        <!-- Error Messages -->
        @if (uploadError()) {
          <div class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm">
            <div class="font-medium flex items-center mb-1">
              <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
              Error en la carga
            </div>
            @if (isErrorMessageArray()) {
              <div class="mt-2">
                <ul class="list-disc list-inside space-y-1 max-h-40 overflow-y-auto">
                  @for (msg of uploadError(); track msg) {
                    <li>{{ msg }}</li>
                  }
                </ul>
              </div>
            } @else {
              <p class="mt-1">{{ uploadError() }}</p>
            }
          </div>
        }
      </div>
      }  <!-- end @if step 0 -->

      <!-- ═══ STEP 1: Verificar ═══ -->
      @if (currentStep() === 1 && parsedData()) {
        <div class="space-y-4 mt-2">
          <div class="bg-green-50 p-4 rounded-lg border border-green-100 flex items-center justify-between">
            <div class="flex items-center">
              <app-icon name="check-circle" [size]="24" class="text-green-500 mr-3"></app-icon>
              <div>
                <h4 class="text-sm font-medium text-green-900">
                  {{ parsedData()!.length }} clientes encontrados
                </h4>
              </div>
            </div>
            <button (click)="goToStep(0)" class="text-xs text-red-500 hover:text-red-700 font-medium">
              Cambiar archivo
            </button>
          </div>

          <!-- Preview Table -->
          <div class="border rounded-md overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left font-medium text-gray-500">Fila</th>
                  <th class="px-3 py-2 text-left font-medium text-gray-500">Correo</th>
                  <th class="px-3 py-2 text-left font-medium text-gray-500">Nombre</th>
                  <th class="px-3 py-2 text-left font-medium text-gray-500">Apellido</th>
                  <th class="px-3 py-2 text-left font-medium text-gray-500">Documento</th>
                  <th class="px-3 py-2 text-left font-medium text-gray-500">Teléfono</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                @for (item of parsedData()!.slice(0, 5); track item.row_number) {
                  <tr>
                    <td class="px-3 py-2 text-gray-400 text-xs">{{ item.row_number }}</td>
                    <td class="px-3 py-2 text-gray-900 text-xs">{{ item.email || '-' }}</td>
                    <td class="px-3 py-2 text-gray-700">{{ item.first_name || '-' }}</td>
                    <td class="px-3 py-2 text-gray-700">{{ item.last_name || '-' }}</td>
                    <td class="px-3 py-2 text-gray-500 font-mono text-xs">{{ item.document_number || '-' }}</td>
                    <td class="px-3 py-2 text-gray-500 text-xs">{{ item.phone || '-' }}</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (parsedData()!.length > 5) {
              <div class="bg-gray-50 px-3 py-2 text-xs text-gray-500 text-center">
                ... y {{ parsedData()!.length - 5 }} más
              </div>
            }
          </div>

          <!-- Warnings -->
          @if (warnings().length > 0) {
            <div class="bg-yellow-50 p-3 rounded-lg border border-yellow-100 text-yellow-800 text-xs">
              <div class="font-medium flex items-center mb-1">
                <app-icon name="alert-triangle" [size]="14" class="mr-1"></app-icon>
                Advertencias
              </div>
              <ul class="list-disc list-inside space-y-0.5 max-h-32 overflow-y-auto">
                @for (w of warnings(); track w) {
                  <li>{{ w }}</li>
                }
              </ul>
            </div>
          }
        </div>
      }

      <!-- ═══ STEP 2: Resultados ═══ -->
      @if (currentStep() === 2) {
        <div class="space-y-5 mt-2">
          <!-- Uploading state -->
          @if (isUploading()) {
            <div class="py-12 flex flex-col items-center">
              <app-icon name="loader" [size]="48" class="text-primary mb-4 animate-spin"></app-icon>
              <p class="text-sm font-medium text-gray-700">Procesando {{ parsedData()?.length }} clientes...</p>
              <p class="text-xs text-gray-500 mt-1">Esto puede tomar unos segundos</p>
            </div>
          }

          <!-- Results -->
          @if (!isUploading() && uploadResults()) {
            <div class="space-y-5">
              <div class="bg-white border rounded-lg overflow-hidden">
                <div class="bg-gray-50 p-4 border-b flex justify-between items-center">
                  <h4 class="font-medium text-gray-900">Resumen de Carga</h4>
                  <span class="text-sm text-gray-500">
                    Procesados: {{ uploadResults()!.total_processed || 0 }}
                  </span>
                </div>
                <div class="p-4 grid grid-cols-2 gap-4">
                  <div class="bg-green-50 p-3 rounded border border-green-100">
                    <div class="text-xs text-green-600 font-medium">Exitosos</div>
                    <div class="text-2xl font-bold text-green-700">{{ uploadResults()!.successful || 0 }}</div>
                  </div>
                  <div class="bg-red-50 p-3 rounded border border-red-100">
                    <div class="text-xs text-red-600 font-medium">Fallidos</div>
                    <div class="text-2xl font-bold text-red-700">{{ uploadResults()!.failed || 0 }}</div>
                  </div>
                </div>
              </div>

              <!-- Error Detail -->
              @if (uploadResults()!.failed > 0) {
                <div class="border rounded-lg overflow-hidden">
                  <div class="bg-red-50 p-3 border-b border-red-100 text-red-800 font-medium text-sm flex items-center">
                    <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
                    Detalle de Errores
                  </div>
                  <div class="max-h-60 overflow-y-auto bg-white">
                    <table class="min-w-full divide-y divide-gray-200">
                      <thead class="bg-gray-50">
                        <tr>
                          <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                          <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                        </tr>
                      </thead>
                      <tbody class="bg-white divide-y divide-gray-200">
                        @for (result of uploadResults()!.results; track result; let i = $index) {
                          @if (result.status === 'error') {
                            <tr>
                              <td class="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                Fila {{ result.row_number || (i + 1) }}:
                                {{ getCustomerLabel(result, i) }}
                              </td>
                              <td class="px-4 py-2 text-sm text-red-600">{{ result.message }}</td>
                            </tr>
                          }
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Footer -->
      <div slot="footer" class="flex justify-between gap-3 pt-6 border-t border-gray-200 mt-6">
        <div>
          @if (currentStep() === 1) {
            <app-button
              variant="ghost"
              size="sm"
              (clicked)="goToStep(0)"
              [disabled]="isUploading()"
            >
              <app-icon name="arrow-left" [size]="14" slot="icon"></app-icon>
              Atrás
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isUploading()"
          >
            {{ currentStep() === 2 && uploadResults() ? 'Cerrar' : 'Cancelar' }}
          </app-button>
          @if (currentStep() === 1 && parsedData()) {
            <app-button
              variant="primary"
              (clicked)="confirmUpload()"
              [disabled]="isUploading()"
              [loading]="isUploading()"
            >
              <app-icon name="upload" [size]="16" slot="icon"></app-icon>
              Cargar {{ parsedData()!.length }} Clientes
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class CustomerBulkUploadModalComponent {
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly uploadComplete = output<void>();

  // Steps
  steps: StepsLineItem[] = [
    { label: 'Cargar Datos' },
    { label: 'Verificar' },
    { label: 'Resultados' },
  ];
  currentStep = signal(0);

  // State
  isProcessingFile = signal(false);
  isDragging = signal(false);
  isUploading = signal(false);
  uploadError = signal<any>(null);
  parsedData = signal<any[] | null>(null);
  uploadResults = signal<any>(null);
  warnings = signal<string[]>([]);

  private customersService = inject(CustomersService);
  private toastService = inject(ToastService);

  // Mapeo de encabezados en español a claves del DTO
  private readonly HEADER_MAP: Record<string, string> = {
    correo: 'email',
    email: 'email',
    nombre: 'first_name',
    first_name: 'first_name',
    apellido: 'last_name',
    last_name: 'last_name',
    documento: 'document_number',
    document_number: 'document_number',
    'tipo documento': 'document_type',
    document_type: 'document_type',
    teléfono: 'phone',
    telefono: 'phone',
    phone: 'phone',
  };

  isErrorMessageArray(): boolean {
    return Array.isArray(this.uploadError());
  }

  onCancel() {
    this.isOpenChange.emit(false);
    this.resetState();
  }

  resetState() {
    this.currentStep.set(0);
    this.isProcessingFile.set(false);
    this.isDragging.set(false);
    this.isUploading.set(false);
    this.uploadError.set(null);
    this.uploadResults.set(null);
    this.parsedData.set(null);
    this.warnings.set([]);
  }

  goToStep(step: number) {
    if (step === 0) {
      this.parsedData.set(null);
      this.uploadError.set(null);
      this.warnings.set([]);
      this.isProcessingFile.set(false);
    }
    this.currentStep.set(step);
  }

  downloadTemplate() {
    this.customersService.getBulkUploadTemplate().subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plantilla-clientes.xlsx`;
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.toastService.error('Error al descargar la plantilla');
      },
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processFile(files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processFile(input.files[0]);
    }
  }

  processFile(file: File) {
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      this.toastService.error('Por favor selecciona un archivo válido (.xlsx o .csv)');
      return;
    }

    this.isProcessingFile.set(true);
    this.uploadError.set(null);
    this.warnings.set([]);

    const reader: FileReader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const bstr: string = e.target.result;
        const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];

        const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        if (!rawData || rawData.length < 2) {
          this.toastService.error('El archivo debe contener al menos una fila de encabezados y una fila de datos');
          this.isProcessingFile.set(false);
          return;
        }

        const rawHeaders = rawData[0] as string[];
        const headerMap: Record<number, string> = {};

        rawHeaders.forEach((h, index) => {
          if (!h) return;
          const normalized = h.toString().trim().toLowerCase();
          const dtoKey = this.HEADER_MAP[normalized];
          if (dtoKey) {
            headerMap[index] = dtoKey;
          }
        });

        const customers: any[] = [];
        const warnings: string[] = [];

        for (let i = 1; i < rawData.length; i++) {
          const row = rawData[i] as any[];
          if (!row || row.length === 0) continue;

          const customer: Record<string, any> = {};
          let hasData = false;

          row.forEach((cellValue, index) => {
            const key = headerMap[index];
            if (key) {
              const val =
                cellValue === undefined || cellValue === null
                  ? ''
                  : String(cellValue).trim();
              customer[key] = val;
              if (val !== '') hasData = true;
            }
          });

          // Fix: no requerir email — solo nombre O documento
          if (hasData && (customer['first_name'] || customer['document_number'])) {
            customer['row_number'] = i + 1; // fila Excel (1-based + header)

            // Generar warnings
            if (!customer['email']) {
              warnings.push(`Fila ${i + 1}: ${customer['first_name'] || 'Sin nombre'} ${customer['last_name'] || ''} — sin correo electrónico`);
            }
            if (!customer['document_number']) {
              warnings.push(`Fila ${i + 1}: ${customer['first_name'] || 'Sin nombre'} ${customer['last_name'] || ''} — sin número de documento`);
            }

            customers.push(customer);
          }
        }

        this.isProcessingFile.set(false);

        if (customers.length === 0) {
          this.toastService.warning('No se encontraron clientes válidos en el archivo');
          return;
        }

        if (customers.length > 1000) {
          this.toastService.error(`El archivo excede el límite de 1000 clientes (tiene ${customers.length}).`);
          return;
        }

        this.parsedData.set(customers);
        this.warnings.set(warnings);
        // Auto-advance to step 1
        this.currentStep.set(1);
      } catch (err) {
        console.error('Error parsing file:', err);
        this.isProcessingFile.set(false);
        this.toastService.error('Error al procesar el archivo. Verifica el formato.');
      }
    };

    reader.readAsBinaryString(file);
  }

  confirmUpload() {
    if (!this.parsedData()) return;

    this.currentStep.set(2);
    this.isUploading.set(true);
    this.uploadError.set(null);

    this.customersService.uploadBulkCustomersJson(this.parsedData()!).subscribe({
      next: (response: any) => {
        this.isUploading.set(false);
        const data = response.data || response;
        this.uploadResults.set(data);

        if (data.failed > 0 || !data.success) {
          this.toastService.warning('La carga se completó con algunos errores.');
        } else {
          this.toastService.success(`${data.successful} clientes cargados exitosamente`);
          this.uploadComplete.emit();
        }
      },
      error: (error: any) => {
        this.isUploading.set(false);
        this.uploadError.set(error?.error?.message || 'Error en la carga masiva');

        if (error?.error?.details) {
          this.uploadResults.set(error.error.details);
        } else if (error?.error?.data) {
          this.uploadResults.set(error.error.data);
        }

        this.toastService.error('Error en la carga masiva');
      },
    });
  }

  getCustomerLabel(result: any, index: number): string {
    const parsed = this.parsedData()?.[index];
    if (parsed) {
      const name = [parsed.first_name, parsed.last_name].filter(Boolean).join(' ');
      if (name) return name;
    }
    return `Cliente ${index + 1}`;
  }
}
