import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, of } from 'rxjs';
import { MAX_BULK_RECORDS } from '../../../../../../shared/utils/run-chunked';
import { BatchProgressClock } from '../../../../../../shared/utils/batch-progress-clock';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
// `import type` deja el namespace disponible para las anotaciones sin meter
// los 7,2 MB de xlsx en el chunk: el runtime llega por `await import('xlsx')`
// dentro del handler, que es el unico momento en que hay un archivo que leer.
import type * as XLSX from 'xlsx';
import { CustomersService } from '../../services/customers.service';
import { BulkUploadLogService } from '../../../bulk-uploads/services/bulk-upload-log.service';
import {
  BulkUploadJobService,
  isBulkUploadJobNotFound,
  isBulkUploadJobTerminal,
} from '../../../bulk-uploads/services/bulk-upload-job.service';
import {
  BulkUploadJobResultRow,
  BulkUploadJobView,
} from '../../../bulk-uploads/bulk-upload-log.interface';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
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

/**
 * Columnas que identifican al cliente: cada fila necesita al menos una para
 * ser útil. Los nombres son los encabezados de la plantilla descargable.
 */
const CUSTOMER_KEY_COLUMNS: ReadonlyArray<{ key: string; header: string }> = [
  { key: 'first_name', header: 'Nombre' },
  { key: 'legal_name', header: 'Razón Social' },
  { key: 'document_number', header: 'Documento' },
];

/** Encabezado de ejemplo (orden de la plantilla) para el mensaje de error. */
const CUSTOMER_HEADER_EXAMPLE = 'Correo | Nombre | Apellido | Documento | Tipo Documento | Teléfono';

/**
 * QUI-1049 P1 — explica por qué un archivo no dejó ningún cliente útil en vez
 * del genérico «No se encontraron clientes válidos». Distingue dos casos:
 *  - faltan las columnas que identifican al cliente: dice cuáles faltan, qué
 *    encabezados sí se reconocieron (y cuáles no) y un ejemplo correcto;
 *  - las columnas están pero ninguna fila tiene datos en ellas.
 *
 * `headerMap` es el mapa índice → clave del DTO que arma `processFile`.
 */
export function diagnoseEmptyCustomerFile(
  rawHeaders: unknown[],
  headerMap: Record<number, string>,
): string[] {
  const recognizedKeys = new Set(Object.values(headerMap));
  const recognized: string[] = [];
  const unrecognized: string[] = [];
  rawHeaders.forEach((h, index) => {
    const text = h === undefined || h === null ? '' : String(h).trim();
    if (!text) return;
    (headerMap[index] ? recognized : unrecognized).push(text);
  });

  const hasKeyColumn = CUSTOMER_KEY_COLUMNS.some((c) => recognizedKeys.has(c.key));
  const keyHeaders = CUSTOMER_KEY_COLUMNS.map((c) => c.header).join(', ');

  if (hasKeyColumn) {
    return [
      'El archivo no tiene filas con datos: todas las filas debajo del encabezado están vacías.',
      `Completa al menos una de estas columnas en cada cliente: ${keyHeaders}.`,
    ];
  }

  const messages = [
    `Faltan las columnas que identifican al cliente: ${keyHeaders} (se necesita al menos una).`,
    recognized.length
      ? `Encabezados reconocidos: ${recognized.join(', ')}.`
      : 'Ningún encabezado del archivo coincide con los de la plantilla.',
  ];
  if (unrecognized.length) {
    messages.push(`Encabezados no reconocidos: ${unrecognized.join(', ')}.`);
  }
  messages.push(
    `Ejemplo de encabezado correcto: ${CUSTOMER_HEADER_EXAMPLE}. Descarga la plantilla para ver todas las columnas.`,
  );
  return messages;
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

/**
 * Formato de correo coherente con `IsEmail` (validator.js) del backend:
 * parte local sin espacios ni puntos al borde/seguidos, dominio con TLD.
 */
const EMAIL_FORMAT =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export type CustomerRowIssueKind = 'invalid_email' | 'duplicate_email';

export interface CustomerRowIssue {
  row_number: number;
  /** Clave del cliente (la misma de `customerGroups`). */
  groupKey: string;
  name: string;
  kind: CustomerRowIssueKind;
  message: string;
}

/**
 * QUI-1048: filas que el servidor marcará fallidas por el correo, detectadas
 * antes de procesar. Correo vacío no es inválido (es una advertencia aparte).
 * Repetido = mismo correo (sin mayúsculas ni espacios) en otro cliente; la
 * primera aparición vale. Las filas con el mismo documento son ubicaciones
 * del mismo cliente y pueden repetir su correo.
 */
export function detectCustomerRowIssues(rows: Record<string, any>[]): CustomerRowIssue[] {
  const issues: CustomerRowIssue[] = [];
  const seenDocs = new Set<string>();
  const seenEmails = new Set<string>();
  for (const row of rows) {
    const docKey = customerDocKey(row);
    const isContinuation = !!docKey && seenDocs.has(docKey);
    if (docKey) seenDocs.add(docKey);

    const email = String(row['email'] ?? '').trim();
    if (!email) continue;
    const base = {
      row_number: Number(row['row_number'] ?? 0),
      groupKey: docKey ?? `row:${row['row_number']}`,
      name:
        row['legal_name'] ||
        [row['first_name'], row['last_name']].filter(Boolean).join(' ') ||
        'Sin nombre',
    };
    if (!EMAIL_FORMAT.test(email)) {
      issues.push({ ...base, kind: 'invalid_email', message: `correo "${email}" con formato inválido` });
      continue;
    }
    if (isContinuation) continue;
    const normalized = email.toLowerCase();
    if (seenEmails.has(normalized)) {
      issues.push({ ...base, kind: 'duplicate_email', message: `correo "${email}" repetido en el archivo` });
    } else {
      seenEmails.add(normalized);
    }
  }
  return issues;
}

/** Fila del resultado tal como la devuelve el servidor (forma de la página de clientes). */
interface CustomerUploadRow extends BulkUploadJobResultRow {
  row_number?: number | null;
  row_error?: { column?: string; value?: unknown; message?: string; suggestion?: string };
}

interface CustomerUploadResults {
  total_processed: number;
  successful: number;
  failed: number;
  locations_added: number;
  warnings: number;
  results: CustomerUploadRow[];
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
      @if (checkingResumable()) {
        <div class="flex flex-col items-center justify-center py-10 gap-3">
          <app-icon name="loader" [size]="36" class="text-primary animate-spin"></app-icon>
          <p class="text-sm text-gray-900 font-medium">Buscando cargas en curso…</p>
        </div>
      } @else if (currentStep() === 0) {
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
      @if (!checkingResumable() && currentStep() === 1 && parsedData()) {
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
                @if (rowIssues().length > 0) {
                  <p class="text-xs text-green-700">
                    {{ validCustomerCount() }} válidos · {{ invalidEmailCount() }} con correo inválido · {{ duplicateEmailCount() }} con correo duplicado
                  </p>
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

          @if (uploadError()) {
            <div class="bg-red-50 p-3 rounded-lg border border-red-100 text-red-700 text-sm" role="alert">
              {{ uploadError() }}
            </div>
          }

          <!-- QUI-1048: filas que fallarán al procesar -->
          @if (rowIssues().length > 0) {
            <div class="bg-red-50 p-3 rounded-lg border border-red-100 text-red-800 text-xs" role="alert">
              <div class="font-medium flex items-center mb-1">
                <app-icon name="alert-circle" [size]="14" class="mr-1"></app-icon>
                {{ rowIssues().length }} {{ rowIssues().length === 1 ? 'fila no se cargará' : 'filas no se cargarán' }}
              </div>
              <p class="mb-1 text-red-700">Corrige el archivo y vuelve a subirlo, o continúa: estas filas quedarán como fallidas con su motivo.</p>
              <ul class="list-disc list-inside space-y-0.5">
                @for (issue of rowIssues().slice(0, 10); track issue.row_number) {
                  <li>Fila {{ issue.row_number }}: {{ issue.name }} — {{ issue.message }}</li>
                }
              </ul>
              @if (rowIssues().length > 10) {
                <p class="mt-1 font-medium">… y {{ rowIssues().length - 10 }} más</p>
              }
            </div>
          }

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

      <!-- ═══ STEP 2: Progreso y resultados (trabajo del servidor) ═══ -->
      @if (!checkingResumable() && currentStep() === 2) {
        <div class="space-y-5 mt-2">
          <!-- En cola / en curso -->
          @if (isActive()) {
            <div class="flex flex-col items-center justify-center py-8 gap-3">
              <app-icon name="loader" [size]="36" class="text-primary animate-spin"></app-icon>
              <p class="text-sm text-gray-900 font-medium">{{ progressLabel() }}</p>
              @if (job()!.status === 'running') {
                <div class="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <div class="flex items-center justify-between text-[11px] text-gray-600">
                    <span>Guardando {{ job()!.processed_rows }} de {{ job()!.total_rows }}</span>
                    <span class="font-semibold text-primary">{{ progressPercent() }}%</span>
                  </div>
                  <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      class="h-full rounded-full bg-primary transition-all"
                      [style.width.%]="progressPercent()"
                    ></div>
                  </div>
                  <div class="mt-1.5 flex items-center justify-between text-[11px] text-gray-500">
                    <span class="flex items-center gap-1">
                      <app-icon name="timer" [size]="12"></app-icon>
                      Transcurrido {{ clock.elapsedLabel() }}
                    </span>
                    <span>
                      @if (clock.remainingLabel(); as remaining) {
                        Restante {{ remaining }}
                      } @else {
                        Calculando tiempo restante…
                      }
                    </span>
                  </div>
                </div>
              }
              <p class="text-xs text-gray-500 text-center">
                La carga sigue en el servidor; puedes cerrar esta ventana y volver luego.
              </p>
            </div>
          }

          <!-- Falló el trabajo: problema técnico (reintento manual con advertencia) o error de datos -->
          @if (job(); as j) {
            @if (j.status === 'failed' && j.error) {
              @if (j.error.kind === 'technical') {
                <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-100 text-yellow-800 text-sm space-y-2" role="alert">
                  <p class="font-medium flex items-center gap-2">
                    <app-icon name="alert-triangle" [size]="16"></app-icon>
                    Estamos revisando un problema técnico, tu carga no se perdió.
                  </p>
                  @if (j.incident_ticket_number) {
                    <p class="text-xs font-mono">Ticket {{ j.incident_ticket_number }}</p>
                  }
                  <p>
                    Se guardaron {{ j.processed_rows }} de {{ j.total_rows }} filas antes de detenerse.
                  </p>
                  @if (j.can_retry) {
                    <p class="text-xs">
                      No lo reintentamos solo: si el servidor alcanzó a guardar parte de ese lote,
                      reenviarlo puede duplicar los clientes sin correo ni documento, y los que sí los
                      tienen aparecerán como «ya existe». Revisa el listado de clientes antes de reintentar.
                    </p>
                  }
                  <div class="flex flex-wrap justify-end gap-2">
                    <app-button variant="outline" size="sm" (clicked)="discardJob()">
                      Subir otro archivo
                    </app-button>
                    @if (j.can_retry) {
                      <app-button variant="primary" size="sm" (clicked)="retryUpload()">
                        Reintentar lote
                      </app-button>
                    }
                  </div>
                </div>
              } @else {
                <div class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm space-y-2" role="alert">
                  <p class="font-medium flex items-center gap-2">
                    <app-icon name="alert-circle" [size]="16"></app-icon>
                    Corrige tu archivo: {{ j.error.message }}
                  </p>
                  <p class="text-xs">
                    Se guardaron {{ j.processed_rows }} de {{ j.total_rows }} filas. Reenviar el mismo
                    lote devuelve el mismo error: corrige esas filas y carga de nuevo solo las que faltan.
                  </p>
                </div>
              }
            }
          }

          <!-- Error al seguir el trabajo -->
          @if (!isActive() && uploadError()) {
            <div class="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700 text-sm">
              <div class="font-medium flex items-center mb-1">
                <app-icon name="alert-circle" [size]="16" class="mr-2"></app-icon>
                Error en la carga
              </div>
              <p class="mt-1">{{ uploadError() }}</p>
            </div>
          }

          <!-- Results -->
          @if (!isActive() && hasBulkResults()) {
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
                                    💡 {{ result.row_error?.suggestion }}
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
            {{ currentStep() === 2 ? 'Cerrar' : 'Cancelar' }}
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
              @if (problemCustomerCount() > 0) { ({{ problemCustomerCount() }} con problemas) }
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
  /** Solo mientras se encola el trabajo; el avance lo da `job()`. */
  isUploading = signal(false);
  /** Consultando si hay una carga en curso o sin mostrar al abrir. */
  readonly checkingResumable = signal(false);
  uploadError = signal<string | string[] | null>(null);
  parsedData = signal<Record<string, any>[] | null>(null);
  uploadResults = signal<CustomerUploadResults | null>(null);
  warnings = signal<string[]>([]);
  /** Última lectura del trabajo del servidor (QUI-1009). */
  readonly job = signal<BulkUploadJobView | null>(null);
  /** Cronómetro, estimado por ritmo real y «lote x/y» (QUI-1009). */
  readonly clock = new BatchProgressClock();
  readonly isActive = computed(() => {
    const j = this.job();
    return !!j && !isBulkUploadJobTerminal(j);
  });
  readonly progressLabel = computed(() => {
    const j = this.job();
    if (!j) return '';
    if (j.status === 'queued') return 'En cola…';
    const total = j.batch_total ?? 0;
    // Hasta terminar el primer lote el servidor no conoce el total.
    if (total === 0) return 'Preparando el primer lote…';
    const current = Math.min(j.batch_current + 1, total);
    return `Procesando lote ${current}/${total} (${j.processed_rows}/${j.total_rows})`;
  });
  readonly progressPercent = computed(() => {
    const j = this.job();
    return j && j.total_rows > 0 ? Math.round((j.processed_rows / j.total_rows) * 100) : 0;
  });
  // Una entrada por cliente: filas con el mismo documento = un cliente con N ubicaciones.
  readonly customerGroups = computed<CustomerGroup[]>(() =>
    groupCustomerRows(this.parsedData() ?? []),
  );
  // QUI-1048: filas que fallarán por el correo, visibles en «Verificar».
  readonly rowIssues = computed<CustomerRowIssue[]>(() =>
    detectCustomerRowIssues(this.parsedData() ?? []),
  );
  readonly invalidEmailCount = computed(
    () => this.rowIssues().filter((i) => i.kind === 'invalid_email').length,
  );
  readonly duplicateEmailCount = computed(
    () => this.rowIssues().filter((i) => i.kind === 'duplicate_email').length,
  );
  /** Clientes con al menos una fila problemática. */
  readonly problemCustomerCount = computed(
    () => new Set(this.rowIssues().map((i) => i.groupKey)).size,
  );
  readonly validCustomerCount = computed(
    () => this.customerGroups().length - this.problemCustomerCount(),
  );
  readonly totalLocations = computed(() =>
    this.customerGroups().reduce((sum, g) => sum + g.locations.length, 0),
  );
  readonly resultWarnings = computed<{ row_number: number; message: string }[]>(() => {
    const r = this.uploadResults();
    if (!r) return [];
    return r.results
      .filter((x) => x.status === 'warning')
      .map((x) => ({ row_number: x.row_number ?? 0, message: x.message ?? '' }));
  });
  private watchSub: Subscription | null = null;
  private resumeSub: Subscription | null = null;
  private clockStarted = false;
  private lastBatch = -1;

  // ¿Hay resultado de carga que pintar (con conteos o filas)?
  readonly hasBulkResults = computed<boolean>(() => this.uploadResults() !== null);

  private customersService = inject(CustomersService);
  private bulkUploadLog = inject(BulkUploadLogService);
  private jobs = inject(BulkUploadJobService);
  private dialog = inject(DialogService);
  // QUI-1004: the browser parses this file, so it computes the hash for the duplicate check.
  private fileName = '';
  private fileHashPromise: Promise<string | null> = Promise.resolve(null);
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

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.watchSub?.unsubscribe();
      this.resumeSub?.unsubscribe();
      this.clock.dispose();
    });
    // QUI-1009: al abrir, retoma la carga en curso (o el resultado sin ver).
    effect(() => {
      if (this.isOpen()) untracked(() => this.checkResumable());
    });
  }

  onCancel() {
    // Cerrar mientras corre solo deja de mirar: el trabajo sigue en el servidor.
    this.watchSub?.unsubscribe();
    this.watchSub = null;
    this.resumeSub?.unsubscribe();
    this.resumeSub = null;
    const j = this.job();
    // Un fallo técnico reanudable se conserva para ofrecer «Reintentar lote» al
    // volver; lo demás ya se mostró y se olvida.
    if (j && isBulkUploadJobTerminal(j) && !j.can_retry) {
      this.jobs.forget('customers');
    }
    this.isOpenChange.emit(false);
    this.resetState();
  }

  /**
   * «Subir otro archivo»: deja de ofrecer el fallo técnico recordado y vuelve
   * al inicio del modal sin reenviar nada. El trabajo sigue en el historial de
   * cargas; el servidor ya liberó el candado, así que se puede encolar otra.
   */
  discardJob() {
    this.watchSub?.unsubscribe();
    this.watchSub = null;
    this.resumeSub?.unsubscribe();
    this.resumeSub = null;
    this.jobs.forget('customers');
    this.resetState();
  }

  resetState() {
    this.currentStep.set(0);
    this.isProcessingFile.set(false);
    this.isDragging.set(false);
    this.isUploading.set(false);
    this.checkingResumable.set(false);
    this.uploadError.set(null);
    this.uploadResults.set(null);
    this.parsedData.set(null);
    this.warnings.set([]);
    this.job.set(null);
    this.clock.reset();
    this.clockStarted = false;
    this.lastBatch = -1;
    this.fileName = '';
    this.fileHashPromise = Promise.resolve(null);
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
    this.fileName = file.name;
    this.fileHashPromise = this.bulkUploadLog.fingerprint(file);

    const reader: FileReader = new FileReader();

    reader.onload = async (e: any) => {
      try {
        const bstr: string = e.target.result;
        const xlsx = await import('xlsx');
        const wb: XLSX.WorkBook = xlsx.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];

        const rawData = xlsx.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        // QUI-1049 P1: sin fila de encabezados el archivo está vacío; con solo
        // el encabezado sigue al diagnóstico de abajo, que dice si faltan
        // columnas o si faltan filas con datos.
        if (!rawData || rawData.length === 0) {
          this.uploadError.set('El archivo está vacío: no tiene encabezados ni filas con datos.');
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
          // QUI-1049 P1: el detalle queda en el modal, no en un toast efímero.
          this.uploadError.set(diagnoseEmptyCustomerFile(rawHeaders, headerMap));
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

  /** Al abrir: una carga en curso (o terminal lanzada desde este navegador) abre en el progreso. */
  private checkResumable() {
    if (this.job() || this.parsedData() || this.checkingResumable()) return;
    this.checkingResumable.set(true);
    this.resumeSub?.unsubscribe();
    this.resumeSub = this.jobs.findResumable('customers').subscribe({
      next: (view) => {
        this.checkingResumable.set(false);
        if (view) this.track(view);
      },
      // Sin respuesta se muestra el primer paso normal.
      error: () => this.checkingResumable.set(false),
    });
  }

  async confirmUpload() {
    const rows = this.parsedData();
    if (!rows || this.isUploading()) return;

    // QUI-1004: warn about a repeated file before uploading anything.
    const fileHash = await this.fileHashPromise;
    if (!(await this.bulkUploadLog.confirmFileIsNew('customers', fileHash))) return;

    // Sanear payload: las filas sin correo no deben enviar `email: ""`.
    // El backend valida el formato de email y `""` dispara un 400. Producimos
    // copias saneadas (no mutamos el signal `parsedData`): si el email está
    // vacío/espacios se elimina la clave; si tiene valor se recorta.
    const customers = rows.map((item) => {
      const sanitized: Record<string, any> = { ...item };
      const email = sanitized['email'];
      if (email == null || String(email).trim() === '') {
        delete sanitized['email'];
      } else {
        sanitized['email'] = String(email).trim();
      }
      return sanitized;
    });

    this.isUploading.set(true);
    this.uploadError.set(null);
    this.jobs
      .enqueue('customers', {
        customers,
        file_name: this.fileName,
        // Sin huella (el navegador no pudo calcularla) el servidor usa la de las filas.
        ...(fileHash ? { file_hash: fileHash } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => {
          this.isUploading.set(false);
          this.track(view);
        },
        error: (error: unknown) => {
          this.isUploading.set(false);
          this.onEnqueueError(error);
        },
      });
  }

  private onEnqueueError(error: unknown) {
    const parsed = parseApiError(error);
    if (parsed.errorCode !== 'BULK_JOB_ALREADY_ACTIVE') {
      this.uploadError.set(parsed.userMessage);
      return;
    }
    this.toastService.info('Ya hay una carga de clientes en curso');
    const rawId = Number((parsed.details as { job_id?: unknown } | null)?.job_id);
    const resumable$ = this.jobs.findResumable('customers');
    const load$ =
      Number.isInteger(rawId) && rawId > 0
        ? this.jobs.get(rawId).pipe(catchError(() => resumable$))
        : resumable$;
    load$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (view) => {
        if (view) this.track(view);
        else this.uploadError.set(parsed.userMessage);
      },
      error: () => this.uploadError.set(parsed.userMessage),
    });
  }

  /** Muestra el trabajo en el paso de progreso y, si sigue vivo, lo sigue hasta el final. */
  private track(view: BulkUploadJobView) {
    this.currentStep.set(2);
    this.job.set(view);
    this.watchSub?.unsubscribe();
    this.watchSub = null;
    if (isBulkUploadJobTerminal(view)) {
      this.finish(view, false);
      return;
    }
    this.syncClock(view);
    this.watchSub = this.jobs
      .watch(view.id, (v) => {
        this.job.set(v);
        this.syncClock(v);
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (final) => this.finish(final, true),
        error: (error: unknown) => {
          this.clock.stop();
          if (isBulkUploadJobNotFound(error)) this.jobs.forget('customers');
          this.job.set(null);
          this.uploadError.set(parseApiError(error).userMessage);
        },
      });
  }

  private syncClock(view: BulkUploadJobView) {
    if (view.status !== 'running') return;
    if (!this.clockStarted) {
      this.clockStarted = true;
      this.lastBatch = view.batch_current;
      this.clock.resumeFrom(
        Date.parse(view.started_at ?? view.created_at),
        view.batch_total ?? 0,
        view.batch_current,
      );
    } else if (view.batch_current !== this.lastBatch) {
      this.lastBatch = view.batch_current;
      this.clock.recordBatch(view.batch_current, view.batch_total ?? 0);
    }
  }

  /** Estado final: trae las filas guardadas y avisa a la página. */
  private finish(view: BulkUploadJobView, notify: boolean) {
    this.clock.stop();
    this.job.set(view);
    this.jobs
      .getResults(view.id)
      .pipe(
        catchError(() => {
          this.toastService.warning('No pudimos traer el detalle por fila de la carga.');
          return of([] as BulkUploadJobResultRow[]);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => {
        const results = rows as CustomerUploadRow[];
        this.uploadResults.set({
          total_processed: view.processed_rows,
          successful: view.successful_rows,
          failed: view.failed_rows,
          locations_added: results.filter((r) => r.status === 'location_added').length,
          warnings: results.filter((r) => r.status === 'warning').length,
          results,
        });
        if (view.successful_rows > 0) this.uploadComplete.emit();
        if (!notify) return;
        if (view.status === 'completed') {
          this.toastService.success(`${view.successful_rows} filas cargadas exitosamente`);
        } else if (view.status === 'partial') {
          this.toastService.warning('La carga se completó con algunos errores.');
        } else if (view.error?.kind === 'technical') {
          this.toastService.error(
            `Problema técnico de la plataforma. Se guardaron ${view.processed_rows} de ${view.total_rows}.`,
          );
        } else {
          this.toastService.error('Corrige el archivo: la carga fue rechazada por sus datos.');
        }
      });
  }

  /**
   * «Reintentar lote» tras un problema técnico. Nunca es automático: la carga
   * de clientes NO es idempotente (una fila sin correo ni documento se crea de
   * nuevo), así que lo decide la persona tras leer la advertencia.
   */
  async retryUpload() {
    const j = this.job();
    if (!j || !j.can_retry || j.error?.kind !== 'technical' || this.isUploading()) return;
    const confirmed = await this.dialog.confirm(
      {
        title: 'Reintentar lote',
        message:
          'Si el servidor alcanzó a guardar parte del lote que falló, reenviarlo puede duplicar los clientes sin correo ni documento. Revisa el listado de clientes antes de reintentar. ¿Reintentar de todos modos?',
        confirmText: 'Reintentar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      },
      { size: 'sm' },
    );
    if (!confirmed) return;
    this.isUploading.set(true);
    this.jobs
      .retry(j.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => {
          this.isUploading.set(false);
          this.uploadResults.set(null);
          this.uploadError.set(null);
          this.clock.reset();
          this.clockStarted = false;
          this.lastBatch = -1;
          this.track(view);
        },
        error: (error: unknown) => {
          this.isUploading.set(false);
          this.toastService.error(parseApiError(error).userMessage);
        },
      });
  }

  getCustomerLabel(result: CustomerUploadRow, index: number): string {
    // Buscar por número de fila: con lotes de 100 el índice del resultado no
    // coincide con la posición en el archivo a partir del segundo lote.
    const rows = this.parsedData() ?? [];
    const parsed =
      rows.find((r) => r['row_number'] === result.row_number) ?? rows[index];
    if (parsed) {
      const name = parsed['legal_name'] || [parsed['first_name'], parsed['last_name']].filter(Boolean).join(' ');
      if (name) return name;
    }
    return `Cliente ${result.row_number ?? index + 1}`;
  }
}
