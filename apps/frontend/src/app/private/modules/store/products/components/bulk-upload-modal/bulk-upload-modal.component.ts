import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
import { ProductsService } from '../../services/products.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
  StepsLineComponent,
} from '../../../../../../shared/components';
import { StepsLineItem } from '../../../../../../shared/components/steps-line/steps-line.component';

@Component({
  selector: 'app-bulk-upload-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent, StepsLineComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Carga Masiva de Productos"
      (closed)="onCancel()"
    >
      <!-- Steps Line -->
      <div class="mb-6">
        <app-steps-line [steps]="steps" [currentStep]="currentStep" size="sm"></app-steps-line>
      </div>

      <!-- Step 0: Cargar Datos -->
      <div *ngIf="currentStep === 0" class="space-y-6">
        <!-- Template Download Section -->
        <div>
          <h4 class="text-sm font-medium text-gray-700 mb-3">
            1. Descarga una plantilla
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Plantilla Rápida -->
            <div
              class="border-2 border-indigo-100 hover:border-indigo-500 bg-indigo-50 rounded-lg p-4 cursor-pointer transition-all shadow-sm hover:shadow-md group"
              (click)="downloadTemplate('quick')"
            >
              <div class="flex items-center mb-2">
                <div
                  class="p-2 bg-indigo-100 rounded-full text-indigo-600 mr-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors"
                >
                  <app-icon name="check-circle" [size]="20"></app-icon>
                </div>
                <h4 class="font-bold text-indigo-900">Plantilla Rápida</h4>
              </div>
              <p class="text-xs text-indigo-700 mb-3 leading-relaxed h-12">
                Solo campos indispensables: Nombre, SKU, Precio, Costo y Stock.
              </p>
              <div
                class="flex items-center text-xs font-bold text-indigo-600 group-hover:text-indigo-800"
              >
                <app-icon name="download" [size]="14" class="mr-1"></app-icon>
                DESCARGAR EXCEL
              </div>
            </div>

            <!-- Plantilla Completa -->
            <div
              class="border-2 border-teal-100 hover:border-teal-500 bg-teal-50 rounded-lg p-4 cursor-pointer transition-all shadow-sm hover:shadow-md group"
              (click)="downloadTemplate('complete')"
            >
              <div class="flex items-center mb-2">
                <div
                  class="p-2 bg-teal-100 rounded-full text-teal-600 mr-3 group-hover:bg-teal-600 group-hover:text-white transition-colors"
                >
                  <app-icon name="file-text" [size]="20"></app-icon>
                </div>
                <h4 class="font-bold text-teal-900">Plantilla Completa</h4>
              </div>
              <p class="text-xs text-teal-700 mb-3 leading-relaxed h-12">
                Todos los datos: Bodega, Descripción, Marca, Categorías, Peso,
                Ofertas, etc.
              </p>
              <div
                class="flex items-center text-xs font-bold text-teal-600 group-hover:text-teal-800"
              >
                <app-icon name="download" [size]="14" class="mr-1"></app-icon>
                DESCARGAR EXCEL
              </div>
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

            <div *ngIf="!isProcessingFile">
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
                Máximo 1000 productos por archivo
              </p>
            </div>

            <div *ngIf="isProcessingFile">
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

      <!-- Step 1: Verificar -->
      <div *ngIf="currentStep === 1" class="space-y-4">
        <!-- Success banner with counts -->
        <div class="bg-green-50 p-4 rounded-lg border border-green-100">
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <app-icon name="check-circle" [size]="24" class="text-green-500 mr-3"></app-icon>
              <div>
                <h4 class="text-sm font-medium text-green-900">Archivo procesado correctamente</h4>
                <p class="text-sm text-green-700">
                  Se encontraron <span class="font-semibold">{{ productCount }} productos</span>
                  <span *ngIf="serviceCount > 0"> y <span class="font-semibold">{{ serviceCount }} servicios</span></span>
                </p>
              </div>
            </div>
            <button (click)="goToStep(0)" class="text-sm text-red-500 hover:text-red-700 font-medium">Cambiar archivo</button>
          </div>
        </div>

        <!-- Warnings -->
        <div *ngIf="warnings.length > 0" class="bg-amber-50 p-4 rounded-lg border border-amber-200">
          <div class="font-medium flex items-center mb-2 text-amber-800 text-sm">
            <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
            Advertencias ({{ warnings.length }})
          </div>
          <ul class="list-disc list-inside space-y-1 text-sm text-amber-700 max-h-32 overflow-y-auto">
            <li *ngFor="let w of warnings">{{ w }}</li>
          </ul>
        </div>

        <!-- Desktop Preview Table (hidden on mobile) -->
        <div class="hidden md:block border rounded-md overflow-hidden">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-3 py-2 text-left font-medium text-gray-500">Producto</th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">Tipo</th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">SKU</th>
                <th class="px-3 py-2 text-right font-medium text-gray-500">Venta</th>
                <th class="px-3 py-2 text-right font-medium text-gray-500">Compra</th>
                <th class="px-3 py-2 text-right font-medium text-gray-500">Stock</th>
                <th *ngIf="hasWarehouseData()" class="px-3 py-2 text-left font-medium text-gray-500">Bodega</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr *ngFor="let item of parsedData!.slice(0, 10)">
                <td class="px-3 py-2 text-gray-900">{{ item.name || '-' }}</td>
                <td class="px-3 py-2">
                  <span [class]="item.product_type === 'service' ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800' : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800'">
                    {{ item.product_type === 'service' ? 'Servicio' : 'Producto' }}
                  </span>
                </td>
                <td class="px-3 py-2 text-gray-500 font-mono text-xs">{{ item.sku || '-' }}</td>
                <td class="px-3 py-2 text-right text-gray-700">{{ item.base_price | currency }}</td>
                <td class="px-3 py-2 text-right text-gray-700">{{ item.cost_price | currency }}</td>
                <td class="px-3 py-2 text-right text-gray-700">{{ item.stock_quantity }}</td>
                <td *ngIf="hasWarehouseData()" class="px-3 py-2 text-gray-500 text-xs">{{ item.warehouse_code || item.warehouse_name || 'Default' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="bg-gray-50 px-3 py-2 text-xs text-gray-500 text-center" *ngIf="parsedData!.length > 10">
            ... y {{ parsedData!.length - 10 }} más
          </div>
        </div>

        <!-- Mobile Preview Cards (shown only on mobile) -->
        <div class="block md:hidden space-y-3">
          <div *ngFor="let item of parsedData!.slice(0, 5)" class="border rounded-lg p-3 bg-white">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-medium text-gray-900 truncate mr-2">{{ item.name || '-' }}</span>
              <span [class]="item.product_type === 'service' ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0' : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 shrink-0'">
                {{ item.product_type === 'service' ? 'Servicio' : 'Producto' }}
              </span>
            </div>
            <p class="text-xs text-gray-500 font-mono mb-2">{{ item.sku || '-' }}</p>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div><span class="text-gray-500">Venta:</span> <span class="font-medium">{{ item.base_price | currency }}</span></div>
              <div><span class="text-gray-500">Compra:</span> <span class="font-medium">{{ item.cost_price | currency }}</span></div>
              <div><span class="text-gray-500">Stock:</span> <span class="font-medium">{{ item.stock_quantity }}</span></div>
              <div *ngIf="item.warehouse_code || item.warehouse_name"><span class="text-gray-500">Bodega:</span> <span class="font-medium">{{ item.warehouse_code || item.warehouse_name }}</span></div>
            </div>
          </div>
          <div class="text-xs text-gray-500 text-center py-2" *ngIf="parsedData!.length > 5">
            ... y {{ parsedData!.length - 5 }} más
          </div>
        </div>
      </div>

      <!-- Step 2: Resultados -->
      <div *ngIf="currentStep === 2" class="space-y-6">
        <!-- Uploading spinner -->
        <div *ngIf="isUploading" class="flex flex-col items-center py-12">
          <app-icon name="loader" [size]="48" class="text-primary mb-4 animate-spin"></app-icon>
          <p class="text-sm text-gray-500">Cargando productos...</p>
          <p class="text-xs text-gray-400 mt-1">Esto puede tomar unos momentos</p>
        </div>

        <!-- Results -->
        <ng-container *ngIf="!isUploading && uploadResults">
          <div class="bg-white border rounded-lg overflow-hidden">
            <div class="bg-gray-50 p-4 border-b flex justify-between items-center">
              <h4 class="font-medium text-gray-900">Resumen de Carga</h4>
              <span class="text-sm text-gray-500">Procesados: {{ uploadResults.total_processed || 0 }}</span>
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

          <!-- Error details table -->
          <div *ngIf="uploadResults.failed > 0" class="border rounded-lg overflow-hidden">
            <div class="bg-red-50 p-3 border-b border-red-100 text-red-800 font-medium text-sm flex items-center">
              <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
              Detalle de Errores
            </div>
            <div class="max-h-60 overflow-y-auto bg-white">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Línea/Producto</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  <ng-container *ngFor="let result of uploadResults.results; let i = index">
                    <tr *ngIf="result.status === 'error'">
                      <td class="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">{{ result.product?.name || 'Producto ' + (i + 1) }}</td>
                      <td class="px-4 py-2 text-sm text-red-600">{{ result.message }}</td>
                    </tr>
                  </ng-container>
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
        </ng-container>
      </div>

      <!-- Dynamic Footer -->
      <div slot="footer" class="flex justify-end gap-3 pt-6 border-t border-gray-200 mt-6">
        <!-- Step 0 footer: just Cancel -->
        <app-button *ngIf="currentStep === 0" variant="outline" (clicked)="onCancel()">Cancelar</app-button>

        <!-- Step 1 footer: Back + Cancel + Upload -->
        <ng-container *ngIf="currentStep === 1">
          <app-button variant="outline" (clicked)="goToStep(0)">Atrás</app-button>
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          <app-button variant="primary" (clicked)="confirmUpload()">
            <app-icon name="upload" [size]="16" slot="icon"></app-icon>
            Cargar {{ parsedData?.length }} Productos
          </app-button>
        </ng-container>

        <!-- Step 2 footer: just Close -->
        <app-button *ngIf="currentStep === 2 && !isUploading" variant="outline" (clicked)="onCancel()">Cerrar</app-button>
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

  steps: StepsLineItem[] = [
    { label: 'Cargar Datos' },
    { label: 'Verificar' },
    { label: 'Resultados' },
  ];
  currentStep = 0;
  isProcessingFile = false;
  isDragging = false;
  isUploading = false;
  uploadError: any = null;
  parsedData: any[] | null = null;
  uploadResults: any = null;
  warnings: string[] = [];
  productCount = 0;
  serviceCount = 0;
  selectedFile: File | null = null;

  private productsService = inject(ProductsService);
  private toastService = inject(ToastService);

  isErrorMessageArray(): boolean {
    return Array.isArray(this.uploadError);
  }

  hasWarehouseData(): boolean {
    return (
      this.parsedData?.some(
        (item) => item.warehouse_code || item.warehouse_name,
      ) ?? false
    );
  }

  onCancel() {
    this.isOpenChange.emit(false);
    this.resetState();
  }

  resetState() {
    this.selectedFile = null;
    this.isDragging = false;
    this.isProcessingFile = false;
    this.isUploading = false;
    this.uploadError = null;
    this.uploadResults = null;
    this.parsedData = null;
    this.warnings = [];
    this.productCount = 0;
    this.serviceCount = 0;
    this.currentStep = 0;
  }

  goToStep(step: number) {
    if (step === 0) {
      this.parsedData = null;
      this.uploadError = null;
      this.warnings = [];
      this.productCount = 0;
      this.serviceCount = 0;
      this.selectedFile = null;
      this.isProcessingFile = false;
    }
    this.currentStep = step;
  }

  downloadTemplate(type: 'quick' | 'complete') {
    this.productsService.getBulkUploadTemplate(type).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plantilla-productos-${type}.xlsx`;
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
    this.isProcessingFile = true;
    this.uploadError = null;
    this.uploadResults = null;

    const reader: FileReader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const bstr: string = e.target.result;
        const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json(ws);

        if (!rawData || rawData.length === 0) {
          this.toastService.error(
            'El archivo está vacío o tiene un formato incorrecto',
          );
          this.isProcessingFile = false;
          this.resetState();
          return;
        }

        if (rawData.length > 1000) {
          this.toastService.error(
            `El archivo excede el límite de 1000 productos (tiene ${rawData.length}). Por favor divídelo en varios archivos.`,
          );
          this.isProcessingFile = false;
          this.resetState();
          return;
        }

        // Mapeo de encabezados (similar al backend para consistencia)
        this.parsedData = rawData
          .map((item: any) => {
            const name = item['Nombre'] || item['name'];
            const sku = item['SKU'] || item['sku'];

            const base_price = parseFloat(
              item['Precio Venta'] || item['base_price'] || 0,
            );
            const cost_price = parseFloat(
              item['Precio Compra'] || item['Costo'] || item['cost_price'] || 0,
            );
            let profit_margin = parseFloat(
              item['Margen'] || item['profit_margin'] || 0,
            );
            // Auto-fix for decimal margins
            if (profit_margin > 0 && profit_margin < 1) {
              profit_margin = profit_margin * 100;
            }
            const stock_quantity = parseFloat(
              item['Cantidad Inicial'] ||
              item['Cantidad'] ||
              item['stock_quantity'] ||
              item['quantity'] ||
              0,
            );

            // Parse product_type
            const product_type_raw = item['Tipo'] || item['Type'] || item['product_type'] || 'Producto';
            const normalizedType = product_type_raw.toString().toLowerCase().trim();
            const isService = normalizedType === 'servicio' || normalizedType === 'service';
            const product_type = isService ? 'service' : 'physical';

            const description = item['Descripción'] || item['description'];
            const brand_id = item['Marca'] || item['brand_id'];
            const category_ids = item['Categorías'] || item['category_ids'];
            const state = item['Estado'] || item['state'];
            const available_for_ecommerce =
              item['Disponible Ecommerce'] || item['available_for_ecommerce'];
            const weight = parseFloat(item['Peso'] || item['weight'] || 0);
            const warehouse_code =
              item['Codigo Bodega'] || item['Código Bodega'] || item['warehouse_code'] || '';
            const warehouse_name =
              item['Nombre Bodega'] || item['warehouse_name'] || '';

            return {
              name,
              sku,
              base_price: isNaN(base_price) ? 0 : base_price,
              cost_price: isNaN(cost_price) ? 0 : cost_price,
              profit_margin: isNaN(profit_margin) ? 0 : profit_margin,
              stock_quantity: isNaN(stock_quantity) ? 0 : stock_quantity,
              product_type,
              description,
              brand_id,
              category_ids,
              state,
              available_for_ecommerce,
              weight: isNaN(weight) ? 0 : weight,
              ...(warehouse_code ? { warehouse_code } : {}),
              ...(warehouse_name ? { warehouse_name } : {}),
            };
          })
          .filter((item) => item.name || item.sku);

        if (this.parsedData.length === 0) {
          this.toastService.warning(
            'No se encontraron productos válidos en el archivo',
          );
          this.isProcessingFile = false;
          this.resetState();
          return;
        }

        // Generate warnings
        this.warnings = [];
        this.parsedData.forEach((p, idx) => {
          if (p.product_type === 'service' && p.stock_quantity > 0) {
            this.warnings.push(`Fila ${idx + 1}: "${p.name}" es un servicio pero tiene stock (${p.stock_quantity}). Se ignorará el stock.`);
          }
        });

        // Count by type
        this.productCount = this.parsedData.filter(p => p.product_type !== 'service').length;
        this.serviceCount = this.parsedData.filter(p => p.product_type === 'service').length;

        // Auto-advance to verification step
        this.isProcessingFile = false;
        this.currentStep = 1;
      } catch (err) {
        console.error('Error parsing file:', err);
        this.toastService.error(
          'Error al procesar el archivo. Verifica el formato.',
        );
        this.isProcessingFile = false;
        this.resetState();
      }
    };

    reader.readAsBinaryString(file);
  }

  confirmUpload() {
    if (!this.parsedData) return;
    this.currentStep = 2;
    this.isUploading = true;
    this.uploadError = null;

    this.productsService.uploadBulkProductsJson(this.parsedData).subscribe({
      next: (response: any) => {
        this.isUploading = false;
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

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
