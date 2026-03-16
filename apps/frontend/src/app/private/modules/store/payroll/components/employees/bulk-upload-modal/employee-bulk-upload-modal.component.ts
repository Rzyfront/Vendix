import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
import { PayrollService } from '../../../services/payroll.service';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../../shared/components';
import {
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../../shared/components/steps-line/steps-line.component';

@Component({
  selector: 'app-employee-bulk-upload-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent, StepsLineComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Carga Masiva de Empleados"
      (closed)="onCancel()"
      subtitle="Importa múltiples empleados desde un archivo Excel"
    >
      <!-- Steps Indicator -->
      <app-steps-line
        [steps]="steps"
        [currentStep]="currentStep"
        size="sm"
      ></app-steps-line>

      <!-- ═══ STEP 0: Cargar Datos ═══ -->
      <div *ngIf="currentStep === 0" class="space-y-5 mt-2">
        <!-- Template Download -->
        <div
          class="border-2 border-indigo-100 hover:border-indigo-500 bg-indigo-50 rounded-lg p-4 cursor-pointer transition-all shadow-sm hover:shadow-md group"
          (click)="downloadTemplate()"
        >
          <div class="flex items-center mb-2">
            <div class="p-2 bg-indigo-100 rounded-full text-indigo-600 mr-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <app-icon name="users" [size]="20"></app-icon>
            </div>
            <h4 class="font-bold text-indigo-900">Plantilla de Empleados</h4>
          </div>
          <p class="text-xs text-indigo-700 mb-3 leading-relaxed">
            Incluye: Nombre, Apellido, Documento, Salario, Contrato, Banco, EPS, Pensión y más. Con 10 ejemplos para guiarte.
          </p>
          <div class="flex items-center text-xs font-bold text-indigo-600 group-hover:text-indigo-800">
            <app-icon name="download" [size]="14" class="mr-1"></app-icon>
            DESCARGAR EXCEL
          </div>
        </div>

        <!-- File Upload Zone -->
        <div
          class="border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer"
          [class.border-blue-500]="isDragging"
          [class.bg-blue-50]="isDragging"
          [class.border-gray-300]="!isDragging"
          [class.hover:border-blue-500]="!isDragging"
          [class.hover:bg-blue-50]="!isDragging"
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
          <div *ngIf="!isProcessingFile">
            <app-icon
              name="upload-cloud"
              [size]="48"
              class="mx-auto text-gray-400 mb-4"
              [class.text-blue-500]="isDragging"
            ></app-icon>
            <p class="text-gray-900 font-medium">Arrastra tu archivo Excel (.xlsx) aquí</p>
            <p class="text-gray-500 text-sm mt-1">o haz clic para seleccionar</p>
            <p class="text-xs text-indigo-500 mt-2 font-medium">Máximo 1000 empleados por archivo</p>
          </div>
          <div *ngIf="isProcessingFile" class="animate-pulse flex flex-col items-center">
            <app-icon name="loader" [size]="48" class="text-primary mb-4 animate-spin"></app-icon>
            <p class="text-sm text-gray-500">Procesando archivo...</p>
          </div>
        </div>

        <!-- Error Messages -->
        <div *ngIf="uploadError" class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm">
          <div class="font-medium flex items-center mb-1">
            <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
            Error en la carga
          </div>
          <div *ngIf="isErrorMessageArray(); else singleError" class="mt-2">
            <ul class="list-disc list-inside space-y-1 max-h-40 overflow-y-auto">
              <li *ngFor="let msg of uploadError">{{ msg }}</li>
            </ul>
          </div>
          <ng-template #singleError>
            <p class="mt-1">{{ uploadError }}</p>
          </ng-template>
        </div>
      </div>

      <!-- ═══ STEP 1: Verificar ═══ -->
      <div *ngIf="currentStep === 1 && parsedData" class="space-y-4 mt-2">
        <div class="bg-green-50 p-4 rounded-lg border border-green-100 flex items-center justify-between">
          <div class="flex items-center">
            <app-icon name="check-circle" [size]="24" class="text-green-500 mr-3"></app-icon>
            <div>
              <h4 class="text-sm font-medium text-green-900">
                {{ parsedData.length }} empleados encontrados
              </h4>
              <p *ngIf="userCount > 0" class="text-xs text-blue-600 mt-0.5">
                {{ userCount }} marcados para crear/vincular como usuarios
              </p>
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
                <th class="px-3 py-2 text-left font-medium text-gray-500">Nombre</th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">Apellido</th>
                <th class="px-3 py-2 text-left font-medium text-gray-500">Documento</th>
                <th class="px-3 py-2 text-right font-medium text-gray-500">Salario</th>
                <th class="px-3 py-2 text-center font-medium text-gray-500">Usuario</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr *ngFor="let item of parsedData.slice(0, 5)">
                <td class="px-3 py-2 text-gray-900">{{ item.first_name || '-' }}</td>
                <td class="px-3 py-2 text-gray-700">{{ item.last_name || '-' }}</td>
                <td class="px-3 py-2 text-gray-500 font-mono text-xs">
                  {{ item.document_type || 'CC' }} {{ item.document_number || '-' }}
                </td>
                <td class="px-3 py-2 text-gray-900 text-right font-mono text-xs">
                  {{ formatSalary(item.base_salary) }}
                </td>
                <td class="px-3 py-2 text-center">
                  <span *ngIf="item.is_user" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Sí
                  </span>
                  <span *ngIf="!item.is_user" class="text-gray-400 text-xs">No</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div *ngIf="parsedData.length > 5" class="bg-gray-50 px-3 py-2 text-xs text-gray-500 text-center">
            ... y {{ parsedData.length - 5 }} más
          </div>
        </div>

        <!-- Warnings -->
        <div *ngIf="warnings.length > 0" class="bg-yellow-50 p-3 rounded-lg border border-yellow-100 text-yellow-800 text-xs">
          <div class="font-medium flex items-center mb-1">
            <app-icon name="alert-triangle" [size]="14" class="mr-1"></app-icon>
            Advertencias
          </div>
          <ul class="list-disc list-inside space-y-0.5">
            <li *ngFor="let w of warnings">{{ w }}</li>
          </ul>
        </div>
      </div>

      <!-- ═══ STEP 2: Resultados ═══ -->
      <div *ngIf="currentStep === 2" class="space-y-5 mt-2">
        <!-- Uploading state -->
        <div *ngIf="isUploading" class="py-12 flex flex-col items-center">
          <app-icon name="loader" [size]="48" class="text-primary mb-4 animate-spin"></app-icon>
          <p class="text-sm font-medium text-gray-700">Procesando {{ parsedData?.length }} empleados...</p>
          <p class="text-xs text-gray-500 mt-1">Esto puede tomar unos segundos</p>
        </div>

        <!-- Results -->
        <div *ngIf="!isUploading && uploadResults" class="space-y-5">
          <div class="bg-white border rounded-lg overflow-hidden">
            <div class="bg-gray-50 p-4 border-b flex justify-between items-center">
              <h4 class="font-medium text-gray-900">Resumen de Carga</h4>
              <span class="text-sm text-gray-500">
                Procesados: {{ uploadResults.total_processed || 0 }}
              </span>
            </div>
            <div class="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div class="bg-green-50 p-3 rounded border border-green-100">
                <div class="text-xs text-green-600 font-medium">Exitosos</div>
                <div class="text-2xl font-bold text-green-700">{{ uploadResults.successful || 0 }}</div>
              </div>
              <div class="bg-red-50 p-3 rounded border border-red-100">
                <div class="text-xs text-red-600 font-medium">Fallidos</div>
                <div class="text-2xl font-bold text-red-700">{{ uploadResults.failed || 0 }}</div>
              </div>
              <div class="bg-blue-50 p-3 rounded border border-blue-100">
                <div class="text-xs text-blue-600 font-medium">Usuarios Creados</div>
                <div class="text-2xl font-bold text-blue-700">{{ uploadResults.users_created || 0 }}</div>
              </div>
              <div class="bg-purple-50 p-3 rounded border border-purple-100">
                <div class="text-xs text-purple-600 font-medium">Usuarios Vinculados</div>
                <div class="text-2xl font-bold text-purple-700">{{ uploadResults.users_linked || 0 }}</div>
              </div>
            </div>
          </div>

          <!-- Error Detail -->
          <div *ngIf="uploadResults.failed > 0" class="border rounded-lg overflow-hidden">
            <div class="bg-red-50 p-3 border-b border-red-100 text-red-800 font-medium text-sm flex items-center">
              <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
              Detalle de Errores
            </div>
            <div class="max-h-60 overflow-y-auto bg-white">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Empleado</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  <ng-container *ngFor="let result of uploadResults.results; let i = index">
                    <tr *ngIf="result.status === 'error'">
                      <td class="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                        {{ parsedData?.[i]?.first_name || '' }} {{ parsedData?.[i]?.last_name || 'Fila ' + (i + 1) }}
                      </td>
                      <td class="px-4 py-2 text-sm text-red-600">{{ result.message }}</td>
                    </tr>
                  </ng-container>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex justify-between gap-3 pt-6 border-t border-gray-200 mt-6">
        <div>
          <app-button
            *ngIf="currentStep === 1"
            variant="ghost"
            size="sm"
            (clicked)="goToStep(0)"
            [disabled]="isUploading"
          >
            <app-icon name="arrow-left" [size]="14" slot="icon"></app-icon>
            Atrás
          </app-button>
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isUploading"
          >
            {{ currentStep === 2 && uploadResults ? 'Cerrar' : 'Cancelar' }}
          </app-button>
          <app-button
            *ngIf="currentStep === 1 && parsedData"
            variant="primary"
            (clicked)="confirmUpload()"
            [disabled]="isUploading"
            [loading]="isUploading"
          >
            <app-icon name="upload" [size]="16" slot="icon"></app-icon>
            Cargar {{ parsedData.length }} Empleados
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class EmployeeBulkUploadModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() uploadComplete = new EventEmitter<void>();

  // Steps
  steps: StepsLineItem[] = [
    { label: 'Cargar Datos' },
    { label: 'Verificar' },
    { label: 'Resultados' },
  ];
  currentStep = 0;

  // State
  isProcessingFile = false;
  isDragging = false;
  isUploading = false;
  uploadError: any = null;
  parsedData: any[] | null = null;
  uploadResults: any = null;
  warnings: string[] = [];
  userCount = 0;

  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);

  private readonly HEADER_MAP: Record<string, string> = {
    nombre: 'first_name',
    'first name': 'first_name',
    apellido: 'last_name',
    'last name': 'last_name',
    'tipo documento': 'document_type',
    'document type': 'document_type',
    'número documento': 'document_number',
    'numero documento': 'document_number',
    'document number': 'document_number',
    'fecha contratación': 'hire_date',
    'fecha contratacion': 'hire_date',
    'hire date': 'hire_date',
    'tipo contrato': 'contract_type',
    'contract type': 'contract_type',
    'salario base': 'base_salary',
    'base salary': 'base_salary',
    cargo: 'position',
    position: 'position',
    departamento: 'department',
    department: 'department',
    'frecuencia pago': 'payment_frequency',
    'payment frequency': 'payment_frequency',
    banco: 'bank_name',
    bank: 'bank_name',
    'número cuenta': 'bank_account_number',
    'numero cuenta': 'bank_account_number',
    'account number': 'bank_account_number',
    'tipo cuenta': 'bank_account_type',
    'account type': 'bank_account_type',
    eps: 'health_provider',
    'health provider': 'health_provider',
    'fondo pensión': 'pension_fund',
    'fondo pension': 'pension_fund',
    'pension fund': 'pension_fund',
    'nivel riesgo arl': 'arl_risk_level',
    'arl risk level': 'arl_risk_level',
    'fondo cesantías': 'severance_fund',
    'fondo cesantias': 'severance_fund',
    'severance fund': 'severance_fund',
    'caja compensación': 'compensation_fund',
    'caja compensacion': 'compensation_fund',
    'compensation fund': 'compensation_fund',
    '¿es usuario?': 'is_user',
    'es usuario': 'is_user',
    'is user': 'is_user',
    email: 'email',
    correo: 'email',
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
    this.currentStep = 0;
    this.isProcessingFile = false;
    this.isDragging = false;
    this.isUploading = false;
    this.uploadError = null;
    this.uploadResults = null;
    this.parsedData = null;
    this.warnings = [];
    this.userCount = 0;
  }

  goToStep(step: number) {
    if (step === 0) {
      this.parsedData = null;
      this.uploadError = null;
      this.warnings = [];
      this.userCount = 0;
      this.isProcessingFile = false;
    }
    this.currentStep = step;
  }

  downloadTemplate() {
    this.payrollService.getBulkEmployeeTemplate().subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plantilla-empleados.xlsx`;
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

    this.isProcessingFile = true;
    this.uploadError = null;
    this.warnings = [];

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
          this.isProcessingFile = false;
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

        const employees: any[] = [];
        const warnings: string[] = [];

        for (let i = 1; i < rawData.length; i++) {
          const row = rawData[i] as any[];
          if (!row || row.length === 0) continue;

          const employee: Record<string, any> = {};
          let hasData = false;

          row.forEach((cellValue, index) => {
            const key = headerMap[index];
            if (key) {
              const val = cellValue === undefined || cellValue === null ? '' : String(cellValue).trim();

              if (['base_salary', 'arl_risk_level'].includes(key)) {
                const num = parseFloat(val);
                employee[key] = isNaN(num) ? 0 : num;
              } else if (key === 'is_user') {
                const strVal = val.toLowerCase();
                employee[key] = strVal === 'si' || strVal === 'yes' || strVal === 'true' || strVal === '1';
              } else {
                employee[key] = val;
              }

              if (val !== '') hasData = true;
            }
          });

          if (hasData && employee['first_name'] && employee['document_number']) {
            if (employee['is_user'] && !employee['email']) {
              warnings.push(`Fila ${i + 1}: ${employee['first_name']} ${employee['last_name'] || ''} marcado como usuario pero sin email`);
            }
            employees.push(employee);
          }
        }

        this.isProcessingFile = false;

        if (employees.length === 0) {
          this.toastService.warning('No se encontraron empleados válidos en el archivo');
          return;
        }

        if (employees.length > 1000) {
          this.toastService.error(`El archivo excede el límite de 1000 empleados (tiene ${employees.length}).`);
          return;
        }

        this.parsedData = employees;
        this.warnings = warnings;
        this.userCount = employees.filter((e) => e.is_user).length;
        // Auto-advance to step 1
        this.currentStep = 1;
      } catch (err) {
        console.error('Error parsing file:', err);
        this.isProcessingFile = false;
        this.toastService.error('Error al procesar el archivo. Verifica el formato.');
      }
    };

    reader.readAsBinaryString(file);
  }

  confirmUpload() {
    if (!this.parsedData) return;

    this.currentStep = 2;
    this.isUploading = true;
    this.uploadError = null;

    this.payrollService.uploadBulkEmployeesJson(this.parsedData).subscribe({
      next: (response: any) => {
        this.isUploading = false;
        const data = response.data || response;
        this.uploadResults = data;

        if (data.failed > 0 || !data.success) {
          this.toastService.warning('La carga se completó con algunos errores.');
        } else {
          this.toastService.success(`${data.successful} empleados cargados exitosamente`);
          this.uploadComplete.emit();
        }
      },
      error: (error: any) => {
        this.isUploading = false;
        this.uploadError = error?.error?.message || 'Error en la carga masiva';

        if (error?.error?.details) {
          this.uploadResults = error.error.details;
        } else if (error?.error?.data) {
          this.uploadResults = error.error.data;
        }

        this.toastService.error('Error en la carga masiva');
      },
    });
  }

  formatSalary(val: any): string {
    if (!val) return '$0';
    return `$${Number(val).toLocaleString('es-CO')}`;
  }
}
