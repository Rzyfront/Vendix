import {Component, inject, input, output, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { runChunked, ChunkProgress, MAX_BULK_RECORDS } from '../../../../../../shared/utils/run-chunked';
// `import type` deja el namespace disponible para las anotaciones sin meter
// los 7,2 MB de xlsx en el chunk: el runtime llega por `await import('xlsx')`
// dentro del handler, que es el unico momento en que hay un archivo que leer.
import type * as XLSX from 'xlsx';
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

interface CustomerGroupLocation {
  label: string;
  address: string;
  city: string;
}

interface CustomerGroup {
  key: string;
  name: string;
  document: string;
  isJuridica: boolean;
  locations: CustomerGroupLocation[];
}

/** Clave de agrupación por documento (NIT sin DV pegado); `null` si no hay documento. */
function customerDocKey(row: Record<string, any>): string | null {
  const raw = String(row['document_number'] ?? '').trim();
  if (!raw) return null;
  const isJuridica = String(row['person_type'] ?? '').toUpperCase() === 'JURIDICA';
  const type = String(row['document_type'] || (isJuridica ? 'NIT' : 'CC')).trim().toUpperCase();
  const base = type === 'NIT' ? raw.split('-')[0] : raw;
  const number = base.toUpperCase().replace(/[\s\-.]/g, '');
  return number ? `${type}:${number}` : null;
}

/** Agrupa filas parseadas: mismo documento = un cliente con varias ubicaciones. */
function groupCustomerRows(rows: Record<string, any>[]): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>();
  for (const row of rows) {
    const docKey = customerDocKey(row);
    const key = docKey ?? `row:${row['row_number']}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name:
          row['legal_name'] ||
          [row['first_name'], row['last_name']].filter(Boolean).join(' ') ||
          'Sin nombre',
        document: row['document_number'] || '',
        isJuridica: String(row['person_type'] ?? '').toUpperCase() === 'JURIDICA',
        locations: [],
      };
      groups.set(key, group);
    }
    if (row['address_line_1']) {
      group.locations.push({
        label: row['location_name'] || '',
        address: row['address_line_1'],
        city: row['city'] || '',
      });
    }
  }
  return [...groups.values()];
}

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
            Incluye: Correo (opcional), Nombre, Apellido, Documento, Tipo Documento, Teléfono,
            Tipo Persona, Razón Social, DV y los datos de la ubicación (Nombre Sede, Dirección, Ciudad...).
            Repite el mismo documento en varias filas para cargar varias ubicaciones de un cliente.
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
              <p class="text-xs text-indigo-500 mt-2 font-medium">Máximo 10.000 clientes por archivo</p>
            </div>
          }
          @if (isProcessingFile()) {
            <div class="flex flex-col items-center justify-center py-8 gap-3">
              <app-icon name="loader" [size]="36" class="text-primary animate-spin"></app-icon>
              <p class="text-sm text-gray-900 font-medium">Procesando archivo...</p>
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
          <div class="bg-green-50 p-4 rounded-lg border border-green-100 flex items-center justify-between gap-3">
            <div class="flex items-center">
              <app-icon name="check-circle" [size]="24" class="text-green-500 mr-3"></app-icon>
              <div>
                <h4 class="text-sm font-medium text-green-900">
                  {{ customerGroups().length }} clientes encontrados
                </h4>
                @if (totalLocations() > 0) {
                  <p class="text-xs text-green-700">{{ totalLocations() }} ubicaciones en total</p>
                }
              </div>
            </div>
            <button (click)="goToStep(0)" class="text-xs text-red-500 hover:text-red-700 font-medium">
              Cambiar archivo
            </button>
          </div>

          <!-- Preview: una tarjeta por cliente -->
          <div class="space-y-2">
            @for (group of customerGroups().slice(0, 5); track group.key) {
              <div class="rounded-lg border border-border bg-surface p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-text-primary truncate">{{ group.name }}</div>
                    <div class="text-xs text-text-secondary font-mono">
                      {{ group.document || 'Sin documento' }}
                      @if (group.isJuridica) { <span class="font-sans"> · Persona jurídica</span> }
                    </div>
                  </div>
                  @if (group.locations.length > 0) {
                    <span class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {{ group.locations.length }} {{ group.locations.length === 1 ? 'ubicación' : 'ubicaciones' }}
                    </span>
                  }
                </div>
                @if (group.locations.length > 0) {
                  <ul class="mt-2 space-y-1">
                    @for (loc of group.locations; track $index) {
                      <li class="flex items-start gap-1.5 text-xs text-text-secondary">
                        <app-icon name="map-pin" [size]="12" class="mt-0.5 shrink-0"></app-icon>
                        <span class="min-w-0">
                          @if (loc.label) { <span class="font-medium text-text-primary">{{ loc.label }} · </span> }
                          {{ loc.address }}{{ loc.city ? ', ' + loc.city : '' }}
                        </span>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
            @if (customerGroups().length > 5) {
              <div class="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500 text-center">
                ... y {{ customerGroups().length - 5 }} clientes más
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
            <div class="flex flex-col items-center justify-center py-8 gap-3">
              <app-icon name="loader" [size]="36" class="text-primary animate-spin"></app-icon>
              <p class="text-sm text-gray-900 font-medium">Procesando {{ customerGroups().length }} clientes...</p>
              @if (uploadProgress().total > 0) {
                <div class="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <div class="flex items-center justify-between text-[11px] text-gray-600">
                    <span>Guardando {{ uploadProgress().processed }} de {{ uploadProgress().total }}</span>
                    <span class="font-semibold text-primary">{{ progressPercent() }}%</span>
                  </div>
                  <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      class="h-full rounded-full bg-primary transition-all"
                      [style.width.%]="progressPercent()"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Lote fallido: resumen parcial + reintento -->
          @if (!isUploading() && failedAt() !== null) {
            <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-100 text-yellow-800 text-sm flex items-center justify-between gap-3">
              <span>Se guardaron {{ uploadProgress().processed }} de {{ uploadProgress().total }}. El envío se interrumpió en la fila {{ failedAt()! + 1 }} de la lista.</span>
              <app-button variant="primary" size="sm" (clicked)="retryUpload()">
                Reintentar desde la fila {{ failedAt()! + 1 }}
              </app-button>
            </div>
          }

          <!-- Results -->
          @if (!isUploading() && hasBulkResults()) {
            <div class="space-y-5">
              <div class="bg-surface border rounded-lg overflow-hidden">
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
                  @if (uploadResults()!.locations_added > 0) {
                    <div class="bg-blue-50 p-3 rounded border border-blue-100">
                      <div class="text-xs text-blue-600 font-medium">Ubicaciones agregadas</div>
                      <div class="text-2xl font-bold text-blue-700">{{ uploadResults()!.locations_added }}</div>
                    </div>
                  }
                  @if (uploadResults()!.warnings > 0) {
                    <div class="bg-yellow-50 p-3 rounded border border-yellow-100">
                      <div class="text-xs text-yellow-700 font-medium">Advertencias</div>
                      <div class="text-2xl font-bold text-yellow-800">{{ uploadResults()!.warnings }}</div>
                    </div>
                  }
                </div>
              </div>

              <!-- Advertencias (p. ej. ubicación ya registrada) -->
              @if (resultWarnings().length > 0) {
                <div class="border rounded-lg overflow-hidden">
                  <div class="bg-yellow-50 p-3 border-b border-yellow-100 text-yellow-800 font-medium text-sm flex items-center">
                    <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
                    Advertencias
                  </div>
                  <ul class="max-h-48 overflow-y-auto bg-surface divide-y divide-gray-100 text-sm">
                    @for (w of resultWarnings(); track $index) {
                      <li class="px-3 py-2 text-yellow-800">
                        <span class="font-medium">Fila {{ w.row_number }}:</span> {{ w.message }}
                      </li>
                    }
                  </ul>
                </div>
              }

              <!-- Error Detail -->
              @if (uploadResults()!.failed > 0) {
                <div class="border rounded-lg overflow-hidden">
                  <div class="bg-red-50 p-3 border-b border-red-100 text-red-800 font-medium text-sm flex items-center">
                    <app-icon name="alert-triangle" [size]="16" class="mr-2"></app-icon>
                    Detalle de Errores
                  </div>
                  <div class="max-h-72 overflow-y-auto bg-surface">
                    <table class="min-w-full divide-y divide-gray-200">
                      <thead class="bg-gray-50">
                        <tr>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fila</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Columna</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Valor</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Motivo</th>
                        </tr>
                      </thead>
                      <tbody class="bg-surface divide-y divide-gray-200">
                        @for (result of uploadResults()!.results; track result; let i = $index) {
                          @if (result.status === 'error') {
                            <tr>
                              <td class="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900 align-top">
                                <div class="text-xs text-gray-400">Fila</div>
                                <div>{{ result.row_number || (i + 1) }}</div>
                                <div class="text-xs text-gray-500 mt-1">{{ getCustomerLabel(result, i) }}</div>
                              </td>
                              <td class="px-3 py-2 text-sm align-top">
                                <span class="inline-block bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs font-medium">
                                  {{ result.row_error?.column || 'General' }}
                                </span>
                              </td>
                              <td class="px-3 py-2 text-sm text-gray-700 align-top font-mono text-xs break-all max-w-[160px]">
                                {{ result.row_error?.value || '—' }}
                              </td>
                              <td class="px-3 py-2 text-sm text-red-700 align-top">
                                <div>{{ result.row_error?.message || result.message }}</div>
                                @if (result.row_error?.suggestion) {
                                  <div class="mt-1 text-xs text-gray-600 italic">
                                    💡 {{ result.row_error.suggestion }}
                                  </div>
                                }
                              </td>
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

          <!-- Validation / generic error (no renderable results, e.g. 400) -->
          @if (!isUploading() && !hasBulkResults() && stepErrorMessages().length > 0) {
            <div class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm">
              <div class="font-medium flex items-center mb-1">
                <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
                Error en la carga
              </div>
              <div class="mt-2">
                <ul class="list-disc list-inside space-y-1 max-h-60 overflow-y-auto">
                  @for (msg of stepErrorMessages(); track msg) {
                    <li>{{ msg }}</li>
                  }
                </ul>
              </div>
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
              <app-icon name="arrow-left" [size]="14" slot="icon" ></app-icon>
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
              <app-icon name="upload" [size]="16" slot="icon" ></app-icon>
              Cargar {{ customerGroups().length }} Clientes
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
  private destroyRef = inject(DestroyRef);
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
  uploadProgress = signal<{ processed: number; total: number }>({ processed: 0, total: 0 });
  failedAt = signal<number | null>(null);
  readonly progressPercent = computed(() => {
    const p = this.uploadProgress();
    return p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
  });
  // Una entrada por cliente: filas con el mismo documento = un cliente con N ubicaciones.
  readonly customerGroups = computed<CustomerGroup[]>(() =>
    groupCustomerRows(this.parsedData() ?? []),
  );
  readonly totalLocations = computed(() =>
    this.customerGroups().reduce((sum, g) => sum + g.locations.length, 0),
  );
  readonly resultWarnings = computed<{ row_number: number; message: string }[]>(() => {
    const r = this.uploadResults();
    if (!r || !Array.isArray(r.results)) return [];
    return r.results
      .filter((x: any) => x?.status === 'warning')
      .map((x: any) => ({ row_number: x.row_number, message: x.message }));
  });
  private uploadSub: Subscription | null = null;
  private payload: Record<string, any>[] = [];
  private accumulated: any = null;

  // ¿La respuesta tiene forma de resultado de carga masiva (con conteos o results[])?
  // Distingue una respuesta real (éxito total o parcial) de un payload de error de
  // validación 400 (`{ validationErrors: [...] }`) que NO debe pintar el resumen 0/0/0.
  readonly hasBulkResults = computed<boolean>(() => {
    const r = this.uploadResults();
    if (!r) return false;
    return (
      Array.isArray(r.results) ||
      typeof r.total_processed === 'number' ||
      typeof r.successful === 'number' ||
      typeof r.failed === 'number'
    );
  });

  // Mensajes de error legibles para el paso Resultados cuando NO hay results[]:
  // prioriza los validationErrors del backend, si no cae al mensaje de uploadError.
  // Formato: "Fila N — Columna: <col> — Motivo: <msg> — 💡 <suggestion>".
  readonly stepErrorMessages = computed<string[]>(() => {
    const r = this.uploadResults();
    const ve = r?.validationErrors;
    if (Array.isArray(ve) && ve.length > 0) {
      return ve.map((e: any) => {
        if (typeof e === 'string') return e;
        const row = e?.row ? `Fila ${e.row}` : 'Fila ?';
        const column = e?.column ? `Columna: ${e.column}` : null;
        const value = e?.value != null && e.value !== '' ? `Valor: "${e.value}"` : null;
        const reason = e?.message ?? 'Error';
        const suggestion = e?.suggestion ? `💡 ${e.suggestion}` : null;
        return [row, column, value, reason, suggestion]
          .filter(Boolean)
          .join(' — ');
      });
    }
    const err = this.uploadError();
    if (Array.isArray(err)) return err.map((e: any) => String(e));
    if (err) return [String(err)];
    return [];
  });

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
    'tipo persona': 'person_type',
    'tipo de persona': 'person_type',
    person_type: 'person_type',
    'razón social': 'legal_name',
    'razon social': 'legal_name',
    legal_name: 'legal_name',
    dv: 'verification_digit',
    verification_digit: 'verification_digit',
    'nombre sede': 'location_name',
    sede: 'location_name',
    location_name: 'location_name',
    label: 'location_name',
    dirección: 'address_line_1',
    direccion: 'address_line_1',
    address: 'address_line_1',
    address_line_1: 'address_line_1',
    'dirección 2': 'address_line_2',
    'direccion 2': 'address_line_2',
    address_line_2: 'address_line_2',
    ciudad: 'city',
    city: 'city',
    departamento: 'state',
    state: 'state',
    'código dane': 'municipality_code',
    'codigo dane': 'municipality_code',
    dane: 'municipality_code',
    municipality_code: 'municipality_code',
    país: 'country',
    pais: 'country',
    country: 'country',
    'teléfono sede': 'location_phone',
    'telefono sede': 'location_phone',
    location_phone: 'location_phone',
  };

  isErrorMessageArray(): boolean {
    return Array.isArray(this.uploadError());
  }

  onCancel() {
    this.uploadSub?.unsubscribe();
    this.uploadSub = null;
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
    this.uploadProgress.set({ processed: 0, total: 0 });
    this.failedAt.set(null);
    this.payload = [];
    this.accumulated = null;
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
    this.customersService.getBulkUploadTemplate().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

    reader.onload = async (e: any) => {
      try {
        const bstr: string = e.target.result;
        const xlsx = await import('xlsx');
        const wb: XLSX.WorkBook = xlsx.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];

        const rawData = xlsx.utils.sheet_to_json(ws, { header: 1 }) as any[][];

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
        const seenDocs = new Set<string>();

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
          if (hasData && (customer['first_name'] || customer['legal_name'] || customer['document_number'])) {
            customer['row_number'] = i + 1; // fila Excel (1-based + header)

            // Filas adicionales del mismo documento son otras ubicaciones del
            // mismo cliente: no repiten advertencias de correo/documento.
            const docKey = customerDocKey(customer);
            const isContinuation = !!docKey && seenDocs.has(docKey);
            if (docKey) seenDocs.add(docKey);
            const displayName = customer['legal_name'] || customer['first_name'] || 'Sin nombre';

            // Generar warnings
            if (!customer['email'] && !isContinuation) {
              warnings.push(`Fila ${i + 1}: ${displayName} ${customer['last_name'] || ''} — sin correo electrónico`);
            }
            if (!customer['document_number']) {
              warnings.push(`Fila ${i + 1}: ${displayName} ${customer['last_name'] || ''} — sin número de documento`);
            }
            if (customer['person_type'] && String(customer['person_type']).toUpperCase() === 'JURIDICA' && !customer['legal_name']) {
              warnings.push(`Fila ${i + 1}: persona jurídica sin razón social`);
            }
            if (customer['address_line_1'] && !customer['city']) {
              warnings.push(`Fila ${i + 1}: la dirección no tiene ciudad`);
            }

            customers.push(customer);
          }
        }

        this.isProcessingFile.set(false);

        if (customers.length === 0) {
          this.toastService.warning('No se encontraron clientes válidos en el archivo');
          return;
        }

        if (customers.length > MAX_BULK_RECORDS) {
          this.toastService.error(`El archivo excede el límite de 10.000 clientes (tiene ${customers.length}).`);
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

    // Sanear payload: las filas sin correo no deben enviar `email: ""`.
    // El backend valida el formato de email y `""` dispara un 400. Producimos
    // copias saneadas (no mutamos el signal `parsedData`): si el email está
    // vacío/espacios se elimina la clave; si tiene valor se recorta.
    const sanitizedData = this.parsedData()!.map((item) => {
      const sanitized: Record<string, any> = { ...item };
      const email = sanitized['email'];
      if (email == null || String(email).trim() === '') {
        delete sanitized['email'];
      } else {
        sanitized['email'] = String(email).trim();
      }
      return sanitized;
    });

    this.payload = sanitizedData;
    this.accumulated = { success: true, total_processed: 0, successful: 0, failed: 0, locations_added: 0, warnings: 0, results: [] };
    this.failedAt.set(null);
    this.uploadProgress.set({ processed: 0, total: sanitizedData.length });
    this.runUpload(0);
  }

  retryUpload() {
    const offset = this.failedAt();
    if (offset === null || this.isUploading()) return;
    this.failedAt.set(null);
    this.uploadError.set(null);
    this.isUploading.set(true);
    this.runUpload(offset);
  }

  // Envía payload.slice(base) en lotes de 100 (en serie) y acumula resultados.
  private runUpload(base: number) {
    const items = this.payload.slice(base);
    const acc = this.accumulated;
    let lastCount = 0;
    this.uploadSub?.unsubscribe();
    this.uploadSub = runChunked(items, (chunk) =>
      this.customersService.uploadBulkCustomersJson(chunk),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p: ChunkProgress<any>) => {
        // Acumula solo los lotes nuevos de este progreso
        for (const r of p.results.slice(lastCount)) {
          const d = r?.data || r;
          acc.successful += d?.successful || 0;
          acc.failed += d?.failed || 0;
          acc.locations_added += d?.locations_added || 0;
          acc.warnings += d?.warnings || 0;
          acc.total_processed += d?.total_processed || 0;
          if (Array.isArray(d?.results)) acc.results.push(...d.results);
        }
        lastCount = p.results.length;
        this.uploadProgress.set({ processed: base + p.processed, total: this.payload.length });
        this.uploadResults.set({ ...acc, results: [...acc.results] });
        if (!p.done) return;

        this.isUploading.set(false);
        if (p.failedAt !== undefined) {
          const err: any = p.error;
          this.failedAt.set(base + p.failedAt);
          this.uploadError.set(err?.error?.message || 'Error en la carga masiva');
          this.toastService.error(
            `Se guardaron ${base + p.processed} de ${this.payload.length}. Puedes reintentar.`,
          );
        } else if (acc.failed > 0) {
          this.toastService.warning('La carga se completó con algunos errores.');
        } else {
          const locs = acc.locations_added > 0 ? ` (${acc.locations_added} ubicaciones)` : '';
          this.toastService.success(`${acc.successful} filas cargadas exitosamente${locs}`);
          this.uploadComplete.emit();
        }
      });
  }

  getCustomerLabel(result: any, index: number): string {
    // Buscar por número de fila: con lotes de 100 el índice del resultado no
    // coincide con la posición en el archivo a partir del segundo lote.
    const rows = this.parsedData() ?? [];
    const parsed =
      rows.find((r: any) => r?.row_number === result?.row_number) ?? rows[index];
    if (parsed) {
      const name = parsed.legal_name || [parsed.first_name, parsed.last_name].filter(Boolean).join(' ');
      if (name) return name;
    }
    return `Cliente ${index + 1}`;
  }
}
