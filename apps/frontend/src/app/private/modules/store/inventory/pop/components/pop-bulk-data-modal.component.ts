import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
import { ProductsService } from '../../../products/services/products.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';

@Component({
  selector: 'app-pop-bulk-data-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Carga Masiva de Productos al Pedido"
      subtitle="Importa múltiples productos desde un archivo Excel"
    >
      <div class="space-y-6">
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
                Solo campos indispensables: Nombre, SKU, Precio, Costo y
                Cantidad.
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
                Todos los datos: Descripción, Marca, Categorías, Peso, Ofertas,
                etc.
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

        <!-- Persistence Warning -->
        <div
          class="bg-amber-50 p-4 rounded-lg border border-amber-100 flex items-start"
        >
          <app-icon
            name="alert-triangle"
            [size]="20"
            class="text-amber-600 mt-0.5 mr-3"
          ></app-icon>
          <div>
            <h4 class="text-sm font-medium text-amber-900">
              Información Importante
            </h4>
            <p class="text-sm text-amber-800 mt-1">
              Los productos se cargarán temporalmente en la orden. Si contienen
              nuevas marcas o categorías, estas se crearán automáticamente al
              confirmar.
            </p>
          </div>
        </div>

        <!-- File Upload Area -->
        <div
          *ngIf="!parsedData"
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
              Arrastra tu archivo Excel aquí
            </p>
            <p class="text-gray-500 text-sm mt-1">
              o haz clic para seleccionar
            </p>
            <p class="text-xs text-indigo-500 mt-2 font-medium">
              Máximo 1000 items por archivo
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

        <!-- Preview / Summary -->
        <div *ngIf="parsedData" class="space-y-4">
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
                  Se encontraron {{ parsedData.length }} productos válidos.
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

          <!-- Simple Preview Table (First 5 items) -->
          <div
            class="border rounded-md overflow-hidden"
            *ngIf="parsedData.length > 0"
          >
            <table class="min-w-full divide-y divide-gray-200 text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left font-medium text-gray-500">
                    Producto
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-gray-500">
                    Cantidad
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-gray-500">
                    Compra
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-gray-500">
                    Venta
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr *ngFor="let item of parsedData.slice(0, 5)">
                  <td class="px-3 py-2 text-gray-900">
                    {{ item['name'] || '-' }}
                  </td>
                  <td class="px-3 py-2 text-right text-gray-700">
                    {{ item['quantity'] || 0 }}
                  </td>
                  <td class="px-3 py-2 text-right text-gray-700">
                    {{ item['cost_price'] | currency }}
                  </td>
                  <td class="px-3 py-2 text-right text-gray-700">
                    {{ item['base_price'] | currency }}
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
      </div>

      <!-- Actions -->
      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
          <app-button variant="outline" (clicked)="onCancel()">
            Cancelar
          </app-button>
          <app-button
            *ngIf="parsedData && parsedData.length > 0"
            variant="primary"
            (clicked)="confirmImport()"
          >
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Importar {{ parsedData.length }} Productos
          </app-button>
        </div>
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
export class PopBulkDataModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() close = new EventEmitter<void>();
  @Output() dataLoaded = new EventEmitter<any[]>();

  selectedFile: File | null = null;
  isDragging = false;
  parsedData: any[] | null = null;

  private productsService = inject(ProductsService);
  private toastService = inject(ToastService);

  onCancel() {
    this.close.emit();
    this.resetState();
  }

  resetState() {
    this.selectedFile = null;
    this.parsedData = null;
    this.isDragging = false;
  }

  downloadTemplate(type: 'quick' | 'complete') {
    this.productsService.getBulkUploadTemplate(type).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plantilla-pedido-${type}.xlsx`;
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error: any) => {
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
    this.selectedFile = file;
    const reader: FileReader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const bstr: string = e.target.result;
        const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (!data || data.length === 0) {
          this.toastService.error(
            'El archivo está vacío o tiene un formato incorrecto',
          );
          this.resetState();
          return;
        }

        if (data.length > 1000) {
          this.toastService.error(
            `El archivo excede el límite de 1000 items (tiene ${data.length})`,
          );
          this.resetState();
          return;
        }

        // Normalizar claves de español a inglés para POP
        this.parsedData = data
          .map((item: any) => {
            // Claves en español de la plantilla oficial
            const name = item['Nombre'] || item['name'];
            const sku = item['SKU'] || item['sku'];

            // En POP usamos 'unit_cost' y 'quantity'
            const cost = parseFloat(
              item['Precio Compra'] ||
              item['Costo'] ||
              item['cost_price'] ||
              item['unit_cost'] ||
              0,
            );
            const qty = parseFloat(
              item['Cantidad'] ||
              item['Cantidad Inicial'] ||
              item['stock_quantity'] ||
              item['quantity'] ||
              item['qty'] ||
              0,
            );

            const base_price = parseFloat(
              item['Precio Venta'] || item['base_price'] || 0,
            );
            let profit_margin = parseFloat(
              item['Margen'] || item['profit_margin'] || 0,
            );
            // Auto-fix for decimal margins
            if (profit_margin > 0 && profit_margin < 1) {
              profit_margin = profit_margin * 100;
            }
            const description = item['Descripción'] || item['description'];
            const brand_id = item['Marca'] || item['brand_id'];
            const category_ids = item['Categorías'] || item['category_ids'];
            const state = item['Estado'] || item['state'];
            const available_for_ecommerce =
              item['Disponible Ecommerce'] || item['available_for_ecommerce'];
            const weight = parseFloat(item['Peso'] || item['weight'] || 0);

            return {
              name,
              sku,
              unit_cost: isNaN(cost) ? 0 : cost,
              quantity: isNaN(qty) ? 0 : qty,
              cost_price: isNaN(cost) ? 0 : cost,
              stock_quantity: isNaN(qty) ? 0 : qty,
              base_price: isNaN(base_price) ? 0 : base_price,
              profit_margin: isNaN(profit_margin) ? 0 : profit_margin,
              description,
              brand_id,
              category_ids,
              state,
              available_for_ecommerce,
              weight: isNaN(weight) ? 0 : weight,
            };
          })
          .filter((item) => item.name || item.sku);
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

  confirmImport() {
    if (this.parsedData) {
      this.dataLoaded.emit(this.parsedData);
      this.onCancel();
    }
  }
}
