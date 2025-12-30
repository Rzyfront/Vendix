import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductsService } from '../../services/products.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';

@Component({
  selector: 'app-bulk-upload-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [size]="'md'"
      title="Carga Masiva de Productos"
    >
        <!-- Initial State: Instructions & Upload -->
        <div *ngIf="!uploadResults" class="space-y-6">
          <!-- Template Download Section -->
          <div class="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <div class="flex items-start">
              <app-icon
                name="info"
                [size]="20"
                class="text-blue-500 mt-0.5 mr-3"
              ></app-icon>
              <div>
                <h4 class="text-sm font-medium text-blue-900">
                  Instrucciones
                </h4>
                <p class="text-sm text-blue-700 mt-1">
                  Descarga la plantilla, llénala con tus productos y súbela a
                  continuación (CSV o Excel). Asegúrate de no modificar los encabezados.
                </p>
                <button
                  (click)="downloadTemplate()"
                  class="mt-3 text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center"
                >
                  <app-icon name="download" [size]="16" class="mr-1"></app-icon>
                  Descargar plantilla CSV
                </button>
              </div>
            </div>
          </div>
  
          <!-- File Upload Section -->
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
              accept=".csv,.xlsx,.xls"
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
                Arrastra tu archivo CSV o Excel aquí
              </p>
              <p class="text-gray-500 text-sm mt-1">
                o haz clic para seleccionar
              </p>
            </div>
  
            <div *ngIf="selectedFile">
              <app-icon
                name="file-text"
                [size]="48"
                class="mx-auto text-green-500 mb-4"
              ></app-icon>
              <p class="text-gray-900 font-medium truncate">
                {{ selectedFile.name }}
              </p>
              <p class="text-gray-500 text-sm mt-1">
                {{ formatFileSize(selectedFile.size) }}
              </p>
              <button
                (click)="clearFile($event)"
                class="mt-4 text-red-500 text-sm hover:text-red-700 font-medium"
              >
                Eliminar archivo
              </button>
            </div>
          </div>
  
          <!-- Error Messages (Pre-upload) -->
          <div *ngIf="uploadError" class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm">
            <div class="font-medium flex items-center mb-1">
               <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
               Error en la carga
            </div>
            {{ uploadError }}
          </div>
        </div>

        <!-- Results View -->
        <div *ngIf="uploadResults" class="space-y-6">
           <div class="bg-white border rounded-lg overflow-hidden">
              <div class="bg-gray-50 p-4 border-b flex justify-between items-center">
                 <h4 class="font-medium text-gray-900">Resumen de Carga</h4>
                 <span class="text-sm text-gray-500">
                    Procesados: {{ uploadResults.total_processed || 0 }}
                 </span>
              </div>
              <div class="p-4 grid grid-cols-2 gap-4">
                 <div class="bg-green-50 p-3 rounded border border-green-100">
                    <div class="text-sm text-green-600 font-medium">Exitosos</div>
                    <div class="text-2xl font-bold text-green-700">{{ uploadResults.successful || 0 }}</div>
                 </div>
                 <div class="bg-red-50 p-3 rounded border border-red-100">
                    <div class="text-sm text-red-600 font-medium">Fallidos</div>
                    <div class="text-2xl font-bold text-red-700">{{ uploadResults.failed || 0 }}</div>
                 </div>
              </div>
           </div>

           <div *ngIf="uploadResults.failed > 0" class="border rounded-lg overflow-hidden">
              <div class="bg-red-50 p-3 border-b border-red-100 text-red-800 font-medium text-sm flex items-center">
                 <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
                 Detalle de Errores
              </div>
              <div class="max-h-60 overflow-y-auto bg-white">
                 <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                       <tr>
                          <th scope="col" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Línea/Producto</th>
                          <th scope="col" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Error</th>
                       </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                       <ng-container *ngFor="let result of uploadResults.results; let i = index">
                          <tr *ngIf="result.status === 'error'">
                             <td class="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                {{ result.product?.name || 'Producto ' + (i + 1) }}
                             </td>
                             <td class="px-4 py-2 text-sm text-red-600">
                                {{ result.message }}
                             </td>
                          </tr>
                       </ng-container>
                       <!-- If errors list exists directly (from validation) -->
                       <ng-container *ngIf="uploadResults.errors && !uploadResults.results">
                          <tr *ngFor="let error of uploadResults.errors">
                             <td class="px-4 py-2 text-sm text-gray-500">-</td>
                             <td class="px-4 py-2 text-sm text-red-600">{{ error }}</td>
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
          *ngIf="!uploadResults"
          variant="primary"
          (clicked)="uploadFile()"
          [disabled]="!selectedFile || isUploading"
          [loading]="isUploading"
        >
          <app-icon name="upload" [size]="16" slot="icon"></app-icon>
          Subir Productos
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
export class BulkUploadModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() uploadComplete = new EventEmitter<void>();

  selectedFile: File | null = null;
  isDragging = false;
  isUploading = false;
  uploadError: string | null = null;

  uploadResults: any = null;

  constructor(
    private productsService: ProductsService,
    private toastService: ToastService
  ) { }

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
  }

  downloadTemplate() {
    this.productsService.getBulkUploadTemplate().subscribe({
      next: (data) => {
        const blob = new Blob([data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'plantilla-productos.csv';
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
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
      this.handleFile(files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  handleFile(file: File) {
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const allowedTypes = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];

    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const isValidType = allowedTypes.includes(file.type);
    const isValidExtension = allowedExtensions.includes(fileExtension);
    // MIME types can be unreliable, trust extension if MIME fails or vice versa
    if (!isValidType && !isValidExtension) {
      // Just warn but let them try if they insist? No, block strictly for now as per prev issues.
      // Actually, .csv mime type often varies (application/octet-stream etc), so extension check is important.
      if (!isValidExtension) {
        this.toastService.error('Por favor selecciona un archivo válido (CSV o Excel)');
        return;
      }
    }
    this.selectedFile = file;
    this.uploadError = null;
    this.uploadResults = null;
  }

  clearFile(event: Event) {
    event.stopPropagation();
    this.selectedFile = null;
    this.uploadError = null;
  }

  uploadFile() {
    if (!this.selectedFile) return;

    this.isUploading = true;
    this.uploadError = null;

    this.productsService.uploadBulkProducts(this.selectedFile).subscribe({
      next: (response: any) => {
        this.isUploading = false;

        // Handle cases where response is wrapped in { success: ..., data: ... }
        const data = response.data || response;

        if (data.failed > 0 || !data.success) {
          this.uploadResults = data;
          this.toastService.warning('La carga se completó con algunos errores.');
        } else {
          this.toastService.success('Productos cargados exitosamente');
          this.uploadComplete.emit();
          this.onCancel();
        }
      },
      error: (error) => {
        this.isUploading = false;
        this.uploadError = typeof error === 'string' ? error : 'Error al procesar el archivo';
        // Check if error response contains detailed info (e.g. from 400 Bad Request)
        if (error.error && error.error.details) {
          this.uploadResults = error.error.details;
        } else if (error.error && error.error.data) {
          this.uploadResults = error.error.data;
        }

        this.toastService.error('Error en la carga masiva');
      },
    });
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
