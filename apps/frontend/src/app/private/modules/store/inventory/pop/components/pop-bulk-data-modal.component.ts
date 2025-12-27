import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
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
      [size]="'md'"
      title="Carga Masiva de Productos al Pedido"
      [isOpen]="isOpen"
      (closed)="onCancel()"
    >
      <div class="space-y-6">
        <!-- Instructions -->
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
                Sube un archivo Excel o CSV con los productos que deseas agregar a la orden.
                <br>
                Columnas requeridas: <strong>Nombre, SKU/Código, Costo, Cantidad</strong>.
              </p>
              <button
                (click)="downloadTemplate()"
                class="mt-3 text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center"
              >
                <app-icon name="download" [size]="16" class="mr-1"></app-icon>
                Descargar plantilla de ejemplo
              </button>
            </div>
          </div>
        </div>

        <!-- Persistence Warning -->
        <div class="bg-amber-50 p-4 rounded-lg border border-amber-100 flex items-start">
           <app-icon name="alert-triangle" [size]="20" class="text-amber-600 mt-0.5 mr-3"></app-icon>
           <div>
              <h4 class="text-sm font-medium text-amber-900">Información Importante</h4>
              <p class="text-sm text-amber-800 mt-1">
                 Los datos cargados aquí <strong>NO se guardarán en el catálogo del comercio</strong> hasta que confirmes la orden.
                 Estos productos se tratan como ítems temporales o nuevos hasta la finalización del proceso.
              </p>
           </div>
        </div>

        <!-- File Upload Area -->
        <div *ngIf="!parsedData"
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
              Arrastra tu archivo aquí
            </p>
            <p class="text-gray-500 text-sm mt-1">
              o haz clic para seleccionar (CSV, Excel)
            </p>
          </div>

          <div *ngIf="selectedFile">
             <div class="animate-pulse flex flex-col items-center">
                <app-icon name="loader" [size]="48" class="text-primary mb-4 animate-spin"></app-icon>
                <p class="text-sm text-gray-500">Procesando archivo...</p>
             </div>
          </div>
        </div>

        <!-- Preview / Summary -->
        <div *ngIf="parsedData" class="space-y-4">
           <div class="bg-green-50 p-4 rounded-lg border border-green-100 flex items-center justify-between">
              <div class="flex items-center">
                 <app-icon name="check-circle" [size]="24" class="text-green-500 mr-3"></app-icon>
                 <div>
                    <h4 class="text-sm font-medium text-green-900">Archivo procesado correctamente</h4>
                    <p class="text-sm text-green-700">Se encontraron {{ parsedData.length }} productos válidos.</p>
                 </div>
              </div>
              <button (click)="resetState()" class="text-sm text-red-500 hover:text-red-700 font-medium">
                 Cambiar archivo
              </button>
           </div>
           
           <!-- Simple Preview Table (First 5 items) -->
           <div class="border rounded-md overflow-hidden" *ngIf="parsedData.length > 0">
              <table class="min-w-full divide-y divide-gray-200 text-sm">
                 <thead class="bg-gray-50">
                    <tr>
                       <th class="px-3 py-2 text-left font-medium text-gray-500">Producto</th>
                       <th class="px-3 py-2 text-right font-medium text-gray-500">Cantidad</th>
                       <th class="px-3 py-2 text-right font-medium text-gray-500">Costo</th>
                    </tr>
                 </thead>
                 <tbody class="bg-white divide-y divide-gray-200">
                    <tr *ngFor="let item of parsedData.slice(0, 5)">
                       <td class="px-3 py-2 text-gray-900">{{ item['name'] || item['Nombre'] || '-' }}</td>
                       <td class="px-3 py-2 text-right text-gray-700">{{ item['quantity'] || item['qty'] || item['cantidad'] || 0 }}</td>
                       <td class="px-3 py-2 text-right text-gray-700">{{ item['unit_cost'] || item['costo'] || item['cost'] || 0 }}</td>
                    </tr>
                 </tbody>
              </table>
              <div class="bg-gray-50 px-3 py-2 text-xs text-gray-500 text-center" *ngIf="parsedData.length > 5">
                 ... y {{ parsedData.length - 5 }} más
              </div>
           </div>
        </div>

      </div>

      <!-- Actions -->
      <div class="flex justify-end space-x-3 pt-6 border-t border-gray-200 mt-6">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
        >
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
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class PopBulkDataModalComponent {
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() dataLoaded = new EventEmitter<any[]>();

  selectedFile: File | null = null;
  isDragging = false;
  parsedData: any[] | null = null;

  constructor(private toastService: ToastService) { }

  onCancel() {
    this.close.emit();
    this.resetState();
  }

  resetState() {
    this.selectedFile = null;
    this.parsedData = null;
    this.isDragging = false;
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
          this.toastService.error('El archivo está vacío o tiene un formato incorrecto');
          this.resetState();
          return;
        }

        // Basic validation or normalization could happen here
        this.parsedData = data;

      } catch (err) {
        console.error('Error parsing file:', err);
        this.toastService.error('Error al procesar el archivo. Verifica el formato.');
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

  downloadTemplate() {
    // Simple client-side CSV generation
    const headers = ['Nombre', 'SKU', 'Costo', 'Cantidad', 'Notas'];
    const example = ['Producto Ejemplo', 'SKU-123', '10.50', '5', 'Nota opcional'];

    const csvContent =
      headers.join(',') + '\n' +
      example.join(',');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "plantilla_importacion_orden.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
