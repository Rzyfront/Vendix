import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
import { CustomersService } from '../../services/customers.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';

@Component({
  selector: 'app-customer-bulk-upload-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Carga Masiva de Clientes"
      (closed)="onCancel()"
      subtitle="Importa múltiples clientes desde un archivo Excel"
    >
      <!-- Initial State: Instructions & Upload -->
      <div *ngIf="!uploadResults && !parsedData" class="space-y-6">
        <!-- Template Download Section -->
        <div>
          <h4 class="text-sm font-medium text-gray-700 mb-3">
            1. Descarga la plantilla
          </h4>
          <div
            class="border-2 border-indigo-100 hover:border-indigo-500 bg-indigo-50 rounded-lg p-4 cursor-pointer transition-all shadow-sm hover:shadow-md group"
            (click)="downloadTemplate()"
          >
            <div class="flex items-center mb-2">
              <div
                class="p-2 bg-indigo-100 rounded-full text-indigo-600 mr-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors"
              >
                <app-icon name="users" [size]="20"></app-icon>
              </div>
              <h4 class="font-bold text-indigo-900">Plantilla de Clientes</h4>
            </div>
            <p class="text-xs text-indigo-700 mb-3 leading-relaxed">
              Incluye: Correo, Nombre, Apellido, Documento, Tipo Documento y Teléfono.
              Con 10 ejemplos para guiarte.
            </p>
            <div
              class="flex items-center text-xs font-bold text-indigo-600 group-hover:text-indigo-800"
            >
              <app-icon name="download" [size]="14" class="mr-1"></app-icon>
              DESCARGAR EXCEL
            </div>
          </div>
        </div>

        <!-- File Upload Section -->
        <div>
          <h4 class="text-sm font-medium text-gray-700 mb-3">
            2. Sube tu archivo completo
          </h4>
          <div
            class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
            (click)="fileInput.click()"
            [class.border-blue-500]="isDragging"
            [class.bg-blue-50]="isDragging"
          >
            <input
              #fileInput
              type="file"
              accept=".xlsx,.xls,.csv"
              class="hidden"
              (change)="onFileSelected($event)"
            />

            <div *ngIf="!selectedFile">
              <app-icon
                name="upload-cloud"
                [size]="48"
                class="mx-auto text-gray-400 mb-4"
                [class.text-blue-500]="isDragging"
              ></app-icon>
              <p class="text-gray-900 font-medium">
                Arrastra tu archivo Excel (.xlsx) aquí
              </p>
              <p class="text-gray-500 text-sm mt-1">
                o haz clic para seleccionar
              </p>
              <p class="text-xs text-indigo-500 mt-2 font-medium">
                Máximo 1000 clientes por archivo
              </p>
            </div>

            <div *ngIf="selectedFile">
              <div class="animate-pulse flex flex-col items-center">
                <app-icon
                  name="loader"
                  [size]="48"
                  class="text-primary mb-4 animate-spin"
                ></app-icon>
                <p class="text-sm text-gray-500">Procesando archivo...</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Error Messages (Pre-upload) -->
        <div
          *ngIf="uploadError"
          class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm"
        >
          <div class="font-medium flex items-center mb-1">
            <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
            Error en la carga
          </div>
          <div *ngIf="isErrorMessageArray(); else singleError" class="mt-2">
            <ul
              class="list-disc list-inside space-y-1 max-h-40 overflow-y-auto"
            >
              <li *ngFor="let msg of uploadError">{{ msg }}</li>
            </ul>
          </div>
          <ng-template #singleError>
            <p class="mt-1">{{ uploadError }}</p>
          </ng-template>
        </div>
      </div>

      <!-- Preview State -->
      <div *ngIf="parsedData && !uploadResults" class="space-y-4">
        <div
          class="bg-green-50 p-4 rounded-lg border border-green-100 flex items-center justify-between"
        >
          <div class="flex items-center">
            <app-icon
              name="check-circle"
              [size]="24"
              class="text-green-500 mr-3"
            ></app-icon>
            <div>
              <h4 class="text-sm font-medium text-green-900">
                Archivo procesado correctamente
              </h4>
              <p class="text-sm text-green-700">
                Se encontraron {{ parsedData.length }} clientes para cargar.
              </p>
            </div>
          </div>
          <button
            (click)="resetState()"
            class="text-sm text-red-500 hover:text-red-700 font-medium"
          >
            Cambiar archivo
          </button>
        </div>

        <!-- Preview Table -->
        <div class="border rounded-md overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-3 py-2 text-left font-medium text-gray-500">
                  Correo
                </th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">
                  Nombre
                </th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">
                  Apellido
                </th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">
                  Documento
                </th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">
                  Teléfono
                </th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr *ngFor="let item of parsedData.slice(0, 5)">
                <td class="px-3 py-2 text-gray-900 text-xs">
                  {{ item.email || '-' }}
                </td>
                <td class="px-3 py-2 text-gray-700">
                  {{ item.first_name || '-' }}
                </td>
                <td class="px-3 py-2 text-gray-700">
                  {{ item.last_name || '-' }}
                </td>
                <td class="px-3 py-2 text-gray-500 font-mono text-xs">
                  {{ item.document_number || '-' }}
                </td>
                <td class="px-3 py-2 text-gray-500 text-xs">
                  {{ item.phone || '-' }}
                </td>
              </tr>
            </tbody>
          </table>
          <div
            class="bg-gray-50 px-3 py-2 text-xs text-gray-500 text-center"
            *ngIf="parsedData.length > 5"
          >
            ... y {{ parsedData.length - 5 }} más
          </div>
        </div>
      </div>

      <!-- Results View -->
      <div *ngIf="uploadResults" class="space-y-6">
        <div class="bg-white border rounded-lg overflow-hidden">
          <div
            class="bg-gray-50 p-4 border-b flex justify-between items-center"
          >
            <h4 class="font-medium text-gray-900">Resumen de Carga</h4>
            <span class="text-sm text-gray-500">
              Procesados: {{ uploadResults.total_processed || 0 }}
            </span>
          </div>
          <div class="p-4 grid grid-cols-2 gap-4">
            <div class="bg-green-50 p-3 rounded border border-green-100">
              <div class="text-sm text-green-600 font-medium">Exitosos</div>
              <div class="text-2xl font-bold text-green-700">
                {{ uploadResults.successful || 0 }}
              </div>
            </div>
            <div class="bg-red-50 p-3 rounded border border-red-100">
              <div class="text-sm text-red-600 font-medium">Fallidos</div>
              <div class="text-2xl font-bold text-red-700">
                {{ uploadResults.failed || 0 }}
              </div>
            </div>
          </div>
        </div>

        <div
          *ngIf="uploadResults.failed > 0"
          class="border rounded-lg overflow-hidden"
        >
          <div
            class="bg-red-50 p-3 border-b border-red-100 text-red-800 font-medium text-sm flex items-center"
          >
            <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
            Detalle de Errores
          </div>
          <div class="max-h-60 overflow-y-auto bg-white">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Cliente
                  </th>
                  <th
                    scope="col"
                    class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Error
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <ng-container
                  *ngFor="let result of uploadResults.results; let i = index"
                >
                  <tr *ngIf="result.status === 'error'">
                    <td
                      class="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900"
                    >
                      {{ parsedData?.[i]?.email || 'Cliente ' + (i + 1) }}
                    </td>
                    <td class="px-4 py-2 text-sm text-red-600">
                      {{ result.message }}
                    </td>
                  </tr>
                </ng-container>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        slot="footer"
        class="flex justify-end gap-3 pt-6 border-t border-gray-200 mt-6"
      >
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isUploading"
        >
          {{ uploadResults ? 'Cerrar' : 'Cancelar' }}
        </app-button>
        <app-button
          *ngIf="parsedData && !uploadResults"
          variant="primary"
          (clicked)="uploadData()"
          [disabled]="isUploading"
          [loading]="isUploading"
        >
          <app-icon name="upload" [size]="16" slot="icon"></app-icon>
          Iniciar Carga de {{ parsedData.length }} Clientes
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class CustomerBulkUploadModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() uploadComplete = new EventEmitter<void>();

  selectedFile: File | null = null;
  isDragging = false;
  isUploading = false;
  uploadError: any = null;
  parsedData: any[] | null = null;
  uploadResults: any = null;

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
    return Array.isArray(this.uploadError);
  }

  onCancel() {
    this.isOpenChange.emit(false);
    this.resetState();
  }

  resetState() {
    this.selectedFile = null;
    this.isDragging = false;
    this.isUploading = false;
    this.uploadError = null;
    this.uploadResults = null;
    this.parsedData = null;
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
      error: (error: Error) => {
        this.toastService.error('Error al descargar la plantilla');
        console.error(error);
      },
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

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
    const isValidExtension = allowedExtensions.includes(fileExtension);

    if (!isValidExtension) {
      this.toastService.error(
        'Por favor selecciona un archivo válido (.xlsx o .csv)',
      );
      return;
    }

    this.selectedFile = file;
    this.uploadError = null;
    this.uploadResults = null;

    const reader: FileReader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const bstr: string = e.target.result;
        const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];

        // Convertir a JSON array de arrays para inspeccionar encabezados
        const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        if (!rawData || rawData.length < 2) {
          this.toastService.error(
            'El archivo debe contener al menos una fila de encabezados y una fila de datos',
          );
          this.resetState();
          return;
        }

        // Procesar encabezados
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

        // Procesar datos
        const customers: any[] = [];
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

          if (hasData && customer['email']) {
            customers.push(customer);
          }
        }

        if (customers.length === 0) {
          this.toastService.warning(
            'No se encontraron clientes válidos en el archivo',
          );
          this.resetState();
          return;
        }

        if (customers.length > 1000) {
          this.toastService.error(
            `El archivo excede el límite de 1000 clientes (tiene ${customers.length}). Por favor divídelo en varios archivos.`,
          );
          this.resetState();
          return;
        }

        this.parsedData = customers;
      } catch (err) {
        console.error('Error parsing file:', err);
        this.toastService.error(
          'Error al procesar el archivo. Verifica el formato.',
        );
        this.resetState();
      }
    };

    reader.readAsBinaryString(file);
  }

  uploadData() {
    if (!this.parsedData) return;

    this.isUploading = true;
    this.uploadError = null;

    this.customersService.uploadBulkCustomersJson(this.parsedData).subscribe({
      next: (response: any) => {
        this.isUploading = false;
        const data = response.data || response;

        if (data.failed > 0 || !data.success) {
          this.uploadResults = data;
          this.toastService.warning(
            'La carga se completó con algunos errores.',
          );
        } else {
          this.toastService.success('Clientes cargados exitosamente');
          this.uploadComplete.emit();
          this.onCancel();
        }
      },
      error: (error: any) => {
        this.isUploading = false;
        this.uploadError = error;

        if (error?.error?.details) {
          this.uploadResults = error.error.details;
        } else if (error?.error?.data) {
          this.uploadResults = error.error.data;
        }

        this.toastService.error('Error en la carga masiva');
      },
    });
  }
}
