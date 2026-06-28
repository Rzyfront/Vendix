import {
  Component,
  signal,
  inject,
  input,
  output,
  DestroyRef,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  TextareaComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';

import {
  SerialNumbersService,
  BulkBackfillItem,
  BulkBackfillResult,
} from '../../services/serial-numbers.service';

/**
 * QUI-431 — Reusable bulk serial-load modal.
 *
 * Two consumption modes (driven by the `mode` input):
 *  - `backfill`  → posts the parsed serials to the backend bulk endpoint and
 *                  shows a results step (created / failed). Requires
 *                  `productId()` + `locationId()`. Emits `completed` on success.
 *  - `collect`   → does NOT call the API. Emits the parsed items via
 *                  `collected` and closes; the parent persists them (e.g. while
 *                  capturing serials during a purchase receipt).
 *
 * Two input tabs:
 *  - "Pegar lista" → one serial per line in a textarea.
 *  - "Importar CSV" → drag/drop or pick a CSV with header
 *    `serial_number,cost,warranty_expiry,notes`. A client-side template
 *    download is provided (no backend call).
 *
 * Fully zoneless: every template-observed value is a signal, no legacy
 * event emitters, no legacy zone wrappers. Inputs are read by invoking
 * them, e.g. `this.isOpen()`.
 */
type LoadTab = 'paste' | 'csv';

@Component({
  selector: 'app-serial-bulk-load-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalOpenChange($event)"
      (cancel)="onClose()"
      [title]="mode() === 'collect' ? 'Capturar seriales' : 'Cargar seriales'"
      [subtitle]="
        mode() === 'collect'
          ? 'Pegue o importe los números de serie recibidos'
          : 'Pegue o importe los números de serie para asociarlos al producto'
      "
      size="lg"
    >
      <div class="p-4 md:p-6">
        @if (!showResults()) {
          <!-- Tabs -->
          <div class="flex items-center gap-1 mb-5 border-b border-gray-200">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
              [class.border-primary]="activeTab() === 'paste'"
              [class.text-primary]="activeTab() === 'paste'"
              [class.border-transparent]="activeTab() !== 'paste'"
              [class.text-gray-500]="activeTab() !== 'paste'"
              (click)="activeTab.set('paste')"
            >
              <span class="inline-flex items-center gap-2">
                <app-icon name="clipboard-list" [size]="16"></app-icon>
                Pegar lista
              </span>
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
              [class.border-primary]="activeTab() === 'csv'"
              [class.text-primary]="activeTab() === 'csv'"
              [class.border-transparent]="activeTab() !== 'csv'"
              [class.text-gray-500]="activeTab() !== 'csv'"
              (click)="activeTab.set('csv')"
            >
              <span class="inline-flex items-center gap-2">
                <app-icon name="upload-cloud" [size]="16"></app-icon>
                Importar CSV
              </span>
            </button>
          </div>

          <!-- Tab: Paste list -->
          @if (activeTab() === 'paste') {
            <div class="space-y-3">
              <app-textarea
                label="Números de serie (uno por línea)"
                [ngModel]="pasteText()"
                (ngModelChange)="pasteText.set($event)"
                placeholder="SN-0001&#10;SN-0002&#10;SN-0003"
                [rows]="8"
              ></app-textarea>
            </div>
          }

          <!-- Tab: CSV -->
          @if (activeTab() === 'csv') {
            <div class="space-y-4">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <p class="text-xs text-gray-500">
                  Columnas:
                  <span class="font-mono"
                    >serial_number, cost, warranty_expiry, notes</span
                  >
                </p>
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="downloadTemplate()"
                >
                  <div class="flex items-center gap-2">
                    <app-icon
                      slot="icon"
                      name="download"
                      [size]="16"
                    ></app-icon>
                    <span>Descargar plantilla</span>
                  </div>
                </app-button>
              </div>

              <!-- Drop zone -->
              <div
                class="border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer"
                [class.border-gray-300]="!csvFileName()"
                [class.border-primary]="!!csvFileName()"
                [class.bg-primary-50]="!!csvFileName()"
                (click)="fileInput.click()"
                (dragover)="onDragOver($event)"
                (drop)="onDrop($event)"
              >
                <input
                  #fileInput
                  type="file"
                  accept=".csv,text/csv"
                  class="hidden"
                  (change)="onFileSelected($event)"
                />

                @if (!csvFileName()) {
                  <app-icon
                    name="upload-cloud"
                    [size]="40"
                    class="mx-auto mb-3 text-gray-400"
                  ></app-icon>
                  <p class="text-sm text-gray-600 font-medium">
                    Haga clic o arrastre un archivo CSV aquí
                  </p>
                  <p class="text-xs text-gray-400 mt-1">Formato aceptado: CSV</p>
                } @else {
                  <app-icon
                    name="file-spreadsheet"
                    [size]="40"
                    class="mx-auto mb-3 text-primary"
                  ></app-icon>
                  <p class="text-sm font-medium text-gray-800">
                    {{ csvFileName() }}
                  </p>
                  <button
                    type="button"
                    class="text-xs text-red-500 hover:text-red-700 mt-2 underline"
                    (click)="removeCsv($event)"
                  >
                    Eliminar archivo
                  </button>
                }
              </div>
            </div>
          }

          <!-- Parsed counter / warning -->
          <div class="mt-5 space-y-2">
            <div class="flex items-center gap-2 text-sm">
              <app-icon
                name="hash"
                [size]="16"
                class="text-gray-400"
              ></app-icon>
              <span class="text-gray-700">
                {{ parsedItems().length }}
                {{ parsedItems().length === 1 ? 'serial' : 'seriales' }}
                detectado{{ parsedItems().length === 1 ? '' : 's' }}
              </span>
            </div>

            @if (exceedsMax()) {
              <div
                class="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="16"
                  class="text-amber-500 mt-0.5"
                ></app-icon>
                <p class="text-xs text-amber-700">
                  Detectaste {{ parsedItems().length }} seriales pero la cantidad
                  esperada es {{ maxCount() }}. Verifica antes de continuar.
                </p>
              </div>
            }

            @if (parseWarning()) {
              <div
                class="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="16"
                  class="text-amber-500 mt-0.5"
                ></app-icon>
                <p class="text-xs text-amber-700">{{ parseWarning() }}</p>
              </div>
            }
          </div>
        }

        <!-- Results step (backfill only) -->
        @if (showResults()) {
          <div class="space-y-4">
            <h3 class="text-base font-semibold text-gray-800">Resultado</h3>

            @if (isSubmitting()) {
              <div class="flex flex-col items-center justify-center py-8 gap-3">
                <app-icon
                  name="loader"
                  [size]="36"
                  class="text-primary animate-spin"
                ></app-icon>
                <p class="text-sm text-gray-900 font-medium">
                  Cargando seriales...
                </p>
              </div>
            }

            @if (result()) {
              <!-- Summary -->
              <div class="grid grid-cols-3 gap-3">
                <div class="bg-gray-50 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-gray-800">
                    {{ result()!.created + result()!.failed.length }}
                  </p>
                  <p class="text-xs text-gray-500">Total</p>
                </div>
                <div class="bg-green-50 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-green-600">
                    {{ result()!.created }}
                  </p>
                  <p class="text-xs text-gray-500">Creados</p>
                </div>
                <div class="bg-red-50 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-red-600">
                    {{ result()!.failed.length }}
                  </p>
                  <p class="text-xs text-gray-500">Fallidos</p>
                </div>
              </div>

              @if (result()!.failed.length > 0) {
                <div class="max-h-64 overflow-y-auto border rounded-lg">
                  <table class="w-full text-xs">
                    <thead class="bg-gray-50 sticky top-0">
                      <tr>
                        <th
                          class="px-3 py-2 text-left font-medium text-gray-600"
                        >
                          Serial
                        </th>
                        <th
                          class="px-3 py-2 text-left font-medium text-gray-600"
                        >
                          Motivo
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (f of result()!.failed; track f.serial_number) {
                        <tr class="border-t bg-red-50">
                          <td class="px-3 py-2 font-mono">
                            {{ f.serial_number }}
                          </td>
                          <td class="px-3 py-2 text-red-700">
                            {{ f.reason }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <div
                  class="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3"
                >
                  <app-icon
                    name="check-circle"
                    [size]="16"
                    class="text-green-600"
                  ></app-icon>
                  <p class="text-sm text-green-700">
                    Todos los seriales se cargaron correctamente.
                  </p>
                </div>
              }
            }
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
          <app-button variant="outline" (clicked)="onClose()">
            {{ showResults() ? 'Cerrar' : 'Cancelar' }}
          </app-button>

          @if (!showResults()) {
            @if (mode() === 'collect') {
              <app-button
                variant="primary"
                [disabled]="parsedItems().length === 0"
                (clicked)="onCollect()"
              >
                Agregar
              </app-button>
            } @else {
              <app-button
                variant="primary"
                [disabled]="!canSubmitBackfill() || isSubmitting()"
                [loading]="isSubmitting()"
                (clicked)="onBackfill()"
              >
                Cargar
              </app-button>
            }
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class SerialBulkLoadModalComponent {
  // --- Inputs ---
  readonly isOpen = input(false);
  readonly mode = input<'backfill' | 'collect'>('backfill');
  readonly productId = input<number | null>(null);
  readonly productVariantId = input<number | null>(null);
  readonly locationId = input<number | null>(null);
  readonly maxCount = input<number | null>(null);

  // --- Outputs ---
  readonly isOpenChange = output<boolean>();
  /** backfill: emitted after a successful POST so the parent reloads its table. */
  readonly completed = output<void>();
  /** collect: emitted with the parsed items so the parent can persist them. */
  readonly collected = output<BulkBackfillItem[]>();

  private readonly serialNumbersService = inject(SerialNumbersService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // --- UI state (all signals) ---
  readonly activeTab = signal<LoadTab>('paste');
  readonly pasteText = signal<string>('');
  readonly csvItems = signal<BulkBackfillItem[]>([]);
  readonly csvFileName = signal<string | null>(null);
  readonly parseWarning = signal<string>('');
  readonly isSubmitting = signal(false);
  readonly showResults = signal(false);
  readonly result = signal<BulkBackfillResult | null>(null);

  /** Items derived from whichever tab is active (deduped, trimmed). */
  readonly parsedItems = computed<BulkBackfillItem[]>(() => {
    if (this.activeTab() === 'csv') {
      return this.csvItems();
    }
    return this.parsePastedSerials(this.pasteText());
  });

  /** Soft hint: parsed count differs from the expected (maxCount) quantity. */
  readonly exceedsMax = computed<boolean>(() => {
    const max = this.maxCount();
    return max != null && this.parsedItems().length > max;
  });

  readonly canSubmitBackfill = computed<boolean>(
    () =>
      this.productId() != null &&
      this.locationId() != null &&
      this.parsedItems().length > 0,
  );

  // --- Parsing helpers ---

  /** One serial per line: trim, drop blanks, dedup (case-sensitive). */
  private parsePastedSerials(text: string): BulkBackfillItem[] {
    const seen = new Set<string>();
    const items: BulkBackfillItem[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const serial_number = raw.trim();
      if (!serial_number || seen.has(serial_number)) continue;
      seen.add(serial_number);
      items.push({ serial_number });
    }
    return items;
  }

  // --- CSV handling ---

  downloadTemplate(): void {
    const header = 'serial_number,cost,warranty_expiry,notes';
    const sample = 'SN-0001,1000,2026-12-31,Ejemplo';
    const csv = `${header}\n${sample}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_seriales.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.readCsvFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (file) this.readCsvFile(file);
  }

  removeCsv(event: Event): void {
    event.stopPropagation();
    this.csvFileName.set(null);
    this.csvItems.set([]);
    this.parseWarning.set('');
  }

  private readCsvFile(file: File): void {
    this.csvFileName.set(file.name);
    this.parseWarning.set('');
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const { items, warning } = this.parseCsv(text);
      this.csvItems.set(items);
      if (warning) this.parseWarning.set(warning);
    };
    reader.onerror = () => {
      this.parseWarning.set('No se pudo leer el archivo.');
      this.csvItems.set([]);
    };
    reader.readAsText(file);
  }

  /**
   * Client-side CSV parse. First row = header; columns are matched by name
   * (serial_number, cost, warranty_expiry, notes). Blank serials are dropped
   * and serials are deduped.
   */
  private parseCsv(text: string): {
    items: BulkBackfillItem[];
    warning: string;
  } {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return { items: [], warning: 'El archivo CSV está vacío.' };
    }

    const header = this.splitCsvLine(lines[0]).map((h) =>
      h.trim().toLowerCase(),
    );
    const idxSerial = header.indexOf('serial_number');
    const idxCost = header.indexOf('cost');
    const idxWarranty = header.indexOf('warranty_expiry');
    const idxNotes = header.indexOf('notes');

    if (idxSerial === -1) {
      return {
        items: [],
        warning:
          'El CSV no tiene la columna "serial_number" en la primera fila.',
      };
    }

    const seen = new Set<string>();
    const items: BulkBackfillItem[] = [];
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = this.splitCsvLine(lines[i]);
      const serial_number = (cols[idxSerial] ?? '').trim();
      if (!serial_number || seen.has(serial_number)) {
        if (serial_number) skipped++;
        continue;
      }
      seen.add(serial_number);

      const item: BulkBackfillItem = { serial_number };

      if (idxCost !== -1) {
        const rawCost = (cols[idxCost] ?? '').trim();
        if (rawCost) {
          const cost = Number(rawCost);
          if (!Number.isNaN(cost)) item.cost = cost;
        }
      }
      if (idxWarranty !== -1) {
        const warranty = (cols[idxWarranty] ?? '').trim();
        if (warranty) item.warranty_expiry = warranty;
      }
      if (idxNotes !== -1) {
        const notes = (cols[idxNotes] ?? '').trim();
        if (notes) item.notes = notes;
      }

      items.push(item);
    }

    let warning = '';
    if (items.length === 0) {
      warning = 'No se encontraron seriales válidos en el archivo.';
    } else if (skipped > 0) {
      warning = `Se omitieron ${skipped} fila(s) duplicada(s).`;
    }

    return { items, warning };
  }

  /** Minimal CSV splitter with double-quote support for a single line. */
  private splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current);
    return out;
  }

  // --- Actions ---

  /** collect mode: emit parsed items to the parent and close (no API call). */
  onCollect(): void {
    const items = this.parsedItems();
    if (items.length === 0) {
      this.toast.warning('No hay seriales para agregar');
      return;
    }
    this.collected.emit(items);
    this.onClose();
  }

  /** backfill mode: POST to the bulk endpoint and show the results step. */
  onBackfill(): void {
    const product_id = this.productId();
    const location_id = this.locationId();
    const items = this.parsedItems();

    if (product_id == null || location_id == null) {
      this.toast.error('Faltan producto o ubicación para cargar seriales');
      return;
    }
    if (items.length === 0) {
      this.toast.warning('No hay seriales para cargar');
      return;
    }

    const variantId = this.productVariantId();
    const payload = {
      product_id,
      location_id,
      items,
      ...(variantId != null ? { product_variant_id: variantId } : {}),
    };

    this.isSubmitting.set(true);
    this.showResults.set(true);

    this.serialNumbersService
      .bulkCreate(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.isSubmitting.set(false);
          if (res.failed.length === 0) {
            this.toast.success(`${res.created} seriales cargados`);
          } else {
            this.toast.warning(
              `${res.created} cargados, ${res.failed.length} con errores`,
            );
          }
          this.completed.emit();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.showResults.set(false);
          this.toast.error(err || 'Error al cargar los seriales');
        },
      });
  }

  /** Modal chrome close (backdrop/escape/x): keep parent state in sync. */
  onModalOpenChange(open: boolean): void {
    if (!open) {
      this.onClose();
    } else {
      this.isOpenChange.emit(true);
    }
  }

  onClose(): void {
    this.resetState();
    this.isOpenChange.emit(false);
  }

  private resetState(): void {
    this.activeTab.set('paste');
    this.pasteText.set('');
    this.csvItems.set([]);
    this.csvFileName.set(null);
    this.parseWarning.set('');
    this.isSubmitting.set(false);
    this.showResults.set(false);
    this.result.set(null);
  }
}
