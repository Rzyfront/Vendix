import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductsService } from '../../services/products.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';

@Component({
  selector: 'app-bulk-image-upload-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Carga Masiva de Imágenes"
      (closed)="onCancel()"
      subtitle="Asigna imágenes a múltiples productos usando un archivo ZIP"
    >
      <!-- State 1: Instructions + Upload -->
      <div *ngIf="!isUploading && !uploadResults" class="space-y-6">
        <!-- Instructions -->
        <div class="bg-blue-50 p-4 rounded-lg border border-blue-100">
          <h4 class="text-sm font-medium text-blue-900 mb-2 flex items-center">
            <app-icon name="info" [size]="16" class="mr-2"></app-icon>
            ¿Cómo funciona?
          </h4>
          <ol class="text-xs text-blue-800 space-y-1 list-decimal list-inside leading-relaxed">
            <li>Crea una carpeta por cada producto, nombrada con su <strong>SKU</strong>.</li>
            <li>Coloca las imágenes dentro de cada carpeta (máx. 5 por producto).</li>
            <li>Comprime todo en un archivo <strong>.zip</strong> y súbelo aquí.</li>
          </ol>
        </div>

        <!-- Template Downloads -->
        <div>
          <h4 class="text-sm font-medium text-gray-700 mb-3">
            1. Descarga una plantilla
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <!-- Example Template -->
            <div
              class="border-2 border-indigo-100 hover:border-indigo-500 bg-indigo-50 rounded-lg p-4 cursor-pointer transition-all shadow-sm hover:shadow-md group"
              (click)="downloadTemplate('example')"
            >
              <div class="flex items-center mb-2">
                <div class="p-2 bg-indigo-100 rounded-full text-indigo-600 mr-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <app-icon name="file-text" [size]="18"></app-icon>
                </div>
                <h4 class="font-bold text-indigo-900 text-sm">Plantilla Ejemplo</h4>
              </div>
              <p class="text-xs text-indigo-700 mb-3 leading-relaxed">
                ZIP con instrucciones y carpetas de ejemplo para entender la estructura.
              </p>
              <div class="flex items-center text-xs font-bold text-indigo-600 group-hover:text-indigo-800">
                <app-icon name="download" [size]="14" class="mr-1"></app-icon>
                DESCARGAR
              </div>
            </div>

            <!-- Store SKUs Template -->
            <div
              class="border-2 border-green-100 hover:border-green-500 bg-green-50 rounded-lg p-4 cursor-pointer transition-all shadow-sm hover:shadow-md group"
              (click)="downloadTemplate('store-skus')"
            >
              <div class="flex items-center mb-2">
                <div class="p-2 bg-green-100 rounded-full text-green-600 mr-3 group-hover:bg-green-600 group-hover:text-white transition-colors">
                  <app-icon name="package" [size]="18"></app-icon>
                </div>
                <h4 class="font-bold text-green-900 text-sm">SKUs de tu Tienda</h4>
              </div>
              <p class="text-xs text-green-700 mb-3 leading-relaxed">
                ZIP con carpetas vacías nombradas con los SKUs reales de tus productos activos.
              </p>
              <div class="flex items-center text-xs font-bold text-green-600 group-hover:text-green-800">
                <app-icon name="download" [size]="14" class="mr-1"></app-icon>
                DESCARGAR
              </div>
            </div>
          </div>
        </div>

        <!-- File Upload Section -->
        <div>
          <h4 class="text-sm font-medium text-gray-700 mb-3">
            2. Sube tu archivo ZIP
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
              accept=".zip"
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
                Arrastra tu archivo .zip aquí
              </p>
              <p class="text-gray-500 text-sm mt-1">
                o haz clic para seleccionar
              </p>
              <p class="text-xs text-gray-400 mt-2">
                Máximo 100 MB
              </p>
            </div>

            <div *ngIf="selectedFile">
              <app-icon name="file" [size]="48" class="mx-auto text-blue-500 mb-4"></app-icon>
              <p class="text-gray-900 font-medium">{{ selectedFile.name }}</p>
              <p class="text-gray-500 text-sm mt-1">
                {{ formatFileSize(selectedFile.size) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Upload Error -->
        <div
          *ngIf="uploadError"
          class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm"
        >
          <div class="font-medium flex items-center mb-1">
            <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
            Error
          </div>
          <p class="mt-1">{{ uploadError }}</p>
        </div>
      </div>

      <!-- State 2: Processing -->
      <div *ngIf="isUploading && !uploadResults" class="py-12 text-center">
        <div class="animate-pulse flex flex-col items-center">
          <app-icon
            name="loader"
            [size]="48"
            class="text-primary mb-4 animate-spin"
          ></app-icon>
          <p class="text-gray-900 font-medium">Procesando imágenes...</p>
          <p class="text-gray-500 text-sm mt-2">
            Esto puede tomar unos momentos dependiendo del tamaño del archivo.
          </p>
        </div>
      </div>

      <!-- State 3: Results -->
      <div *ngIf="uploadResults" class="space-y-6">
        <!-- Summary -->
        <div class="bg-white border rounded-lg overflow-hidden">
          <div class="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h4 class="font-medium text-gray-900">Resumen de Carga</h4>
            <span class="text-sm text-gray-500">
              SKUs procesados: {{ uploadResults.total_skus_processed || 0 }}
            </span>
          </div>
          <div class="p-4 grid grid-cols-3 gap-3">
            <div class="bg-green-50 p-3 rounded border border-green-100">
              <div class="text-xs text-green-600 font-medium">Exitosos</div>
              <div class="text-2xl font-bold text-green-700">
                {{ uploadResults.successful || 0 }}
              </div>
            </div>
            <div class="bg-red-50 p-3 rounded border border-red-100">
              <div class="text-xs text-red-600 font-medium">Fallidos</div>
              <div class="text-2xl font-bold text-red-700">
                {{ uploadResults.failed || 0 }}
              </div>
            </div>
            <div class="bg-amber-50 p-3 rounded border border-amber-100">
              <div class="text-xs text-amber-600 font-medium">Omitidos</div>
              <div class="text-2xl font-bold text-amber-700">
                {{ uploadResults.skipped || 0 }}
              </div>
            </div>
          </div>
        </div>

        <!-- Detail Table -->
        <div class="border rounded-lg overflow-hidden">
          <div class="bg-gray-50 p-3 border-b text-gray-800 font-medium text-sm flex items-center">
            <app-icon name="list" [size]="16" class="mr-2"></app-icon>
            Detalle por SKU
          </div>
          <div class="max-h-60 overflow-y-auto bg-white">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detalle</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr *ngFor="let result of uploadResults.results">
                  <td class="px-4 py-2 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                    {{ result.sku }}
                  </td>
                  <td class="px-4 py-2 whitespace-nowrap text-sm">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      [ngClass]="{
                        'bg-green-100 text-green-800': result.status === 'success',
                        'bg-red-100 text-red-800': result.status === 'error',
                        'bg-amber-100 text-amber-800': result.status === 'skipped'
                      }"
                    >
                      {{ result.status === 'success' ? 'Exitoso' : result.status === 'error' ? 'Error' : 'Omitido' }}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-sm text-gray-600">
                    {{ result.message }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Footer -->
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
          *ngIf="selectedFile && !isUploading && !uploadResults"
          variant="primary"
          (clicked)="uploadFile()"
        >
          <app-icon name="upload" [size]="16" slot="icon"></app-icon>
          Subir Imágenes
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
export class BulkImageUploadModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() uploadComplete = new EventEmitter<void>();

  selectedFile: File | null = null;
  isDragging = false;
  isUploading = false;
  uploadError: string | null = null;
  uploadResults: any = null;

  private productsService = inject(ProductsService);
  private toastService = inject(ToastService);

  onCancel() {
    if (this.uploadResults?.successful > 0) {
      this.uploadComplete.emit();
    }
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

  downloadTemplate(type: 'example' | 'store-skus') {
    this.productsService.getBulkImageUploadTemplate(type).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download =
          type === 'store-skus'
            ? `plantilla_imagenes_skus.zip`
            : `plantilla_imagenes_ejemplo.zip`;
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
      this.validateAndSetFile(files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.validateAndSetFile(input.files[0]);
    }
  }

  private validateAndSetFile(file: File) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (ext !== '.zip') {
      this.toastService.error('Por favor selecciona un archivo .zip');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      this.toastService.error('El archivo excede el límite de 100 MB');
      return;
    }

    this.selectedFile = file;
    this.uploadError = null;
  }

  uploadFile() {
    if (!this.selectedFile) return;

    this.isUploading = true;
    this.uploadError = null;

    this.productsService.uploadBulkImages(this.selectedFile).subscribe({
      next: (response: any) => {
        this.isUploading = false;
        const data = response.data || response;
        this.uploadResults = data;

        if (data.failed > 0 || data.skipped > 0) {
          this.toastService.warning(
            'La carga se completó con algunos errores u omisiones.',
          );
        } else {
          this.toastService.success(
            `${data.successful} producto(s) actualizados exitosamente`,
          );
        }
      },
      error: (error: any) => {
        this.isUploading = false;
        this.uploadError =
          typeof error === 'string'
            ? error
            : error?.error?.message || error?.message || 'Error en la carga';
        this.toastService.error('Error en la carga masiva de imágenes');
      },
    });
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
