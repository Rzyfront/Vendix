import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { ERROR_MESSAGES } from '../../../../../../core/utils/error-messages';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

import {
  INVOICE_DRAFT_SCAN_ACCEPTED_TYPES,
  INVOICE_DRAFT_SCAN_MAX_FILES,
  INVOICE_DRAFT_SCAN_MAX_FILE_BYTES,
  INVOICE_DRAFT_SCAN_NOTE_MAX,
  InvoiceDraftScanResult,
} from '../../interfaces/invoice-draft-scan.interface';
import {
  INVOICE_DRAFT_SCAN_STORE_PATH,
  InvoiceDraftScannerService,
} from '../../services/invoice-draft-scanner.service';

/** Megas del tope por archivo, para los textos (15 MB). */
const MAX_FILE_MB = Math.round(INVOICE_DRAFT_SCAN_MAX_FILE_BYTES / (1024 * 1024));

/**
 * Word/Excel/CSV se nombran aparte: es lo primero que un comerciante intenta
 * subir (la cotización suele vivir en un .xlsx) y «formato no soportado» a
 * secas no le dice qué hacer.
 */
const OFFICE_EXTENSIONS = /\.(docx?|xlsx?|xlsm|csv|odt|ods|pptx?)$/i;

/**
 * Mensajes del progreso rotativo mientras FacturIA analiza (la cola no
 * informa porcentaje: se rota cada `FACTURIA_PROGRESS_INTERVAL_MS`).
 */
export const FACTURIA_PROGRESS_MESSAGES = [
  'Leyendo documentos…',
  'Identificando al adquiriente…',
  'Extrayendo líneas de cobro…',
  'Completando la factura…',
] as const;
export const FACTURIA_PROGRESS_INTERVAL_MS = 2200;

/**
 * FACTURIA — análisis inteligente de documentos de «Nueva factura».
 *
 * Un solo paso: elegir los documentos (cotización, orden de compra, contrato,
 * RUT del cliente…), escribir una nota opcional y «Analizar y autocompletar».
 * Todos viajan en UNA petición: el modelo arma un único resultado con lo que
 * haya en cada uno. Los textos visibles nunca dicen «borrador».
 *
 * NO precarga nada por su cuenta ni muestra una revisión campo por campo: el
 * resultado sale por `scanned` y la página lo vuelca al formulario con las
 * marcas «IA»/«Revisar». La revisión ocurre sobre el formulario real, que es
 * donde el operador corrige; una segunda pantalla de revisión sería otra copia
 * del mismo dato que se queda atrás.
 *
 * Cerrar el modal (o «Cancelar lectura») CANCELA el poll del job: la cola
 * termina igual en el servidor, pero su resultado ya no pisa el formulario.
 */
@Component({
  selector: 'vendix-invoice-draft-scan-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, ModalComponent, ButtonComponent, IconComponent, AlertBannerComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (closed)="reset()"
      size="lg"
      title="FacturIA · Análisis inteligente de documentos"
    >
      <span
        slot="header"
        class="vx-ai-badge inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg md:h-9 md:w-9"
        aria-hidden="true"
      >
        <app-icon name="sparkles" [size]="16" />
      </span>
      @if (!scanning()) {
        <div class="space-y-4">
          <p class="text-sm leading-relaxed text-[var(--color-text-secondary)]" data-testid="facturia-description">
            Sube RUT, cotizaciones, contratos u órdenes de compra.
            <span class="font-semibold text-text-primary">Factur<span class="vx-ai-text">IA</span></span>
            los analiza y completa automáticamente esta factura para que solo
            revises y emitas.
          </p>

          <!-- Zona de carga: clic o arrastrar, varios a la vez. -->
          <button
            type="button"
            class="group flex w-full min-h-[148px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            [ngClass]="dropzoneClass()"
            [attr.aria-disabled]="isFull()"
            aria-describedby="invoice-draft-scan-help"
            (click)="openFilePicker()"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
          >
            <span
              class="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]"
            >
              <app-icon name="upload-cloud" [size]="22" />
            </span>
            <span class="text-sm font-semibold text-text-primary">
              @if (isFull()) {
                Máximo {{ maxFiles }} documentos
              } @else if (files().length > 0) {
                Agrega otro documento
              } @else {
                Arrastra aquí los documentos o haz clic para elegirlos
              }
            </span>
            <span
              id="invoice-draft-scan-help"
              class="mt-1 text-xs text-[var(--color-text-secondary)]"
            >
              PDF, JPG, PNG o WebP · hasta {{ maxFiles }} documentos de
              {{ maxFileMb }} MB cada uno
            </span>
          </button>

          <input
            #fileInput
            type="file"
            class="hidden"
            multiple
            [accept]="acceptAttr"
            (change)="onFileSelected($event)"
          />

          @if (fileError()) {
            <p class="text-xs text-[var(--color-destructive)]" role="alert">
              {{ fileError() }}
            </p>
          }

          @if (files().length > 0) {
            <ul
              class="divide-y divide-border rounded-lg border border-border"
              aria-label="Documentos elegidos"
            >
              @for (file of files(); track file; let i = $index) {
                <li class="flex items-center gap-3 px-3 py-2">
                  <app-icon
                    [name]="file.type === 'application/pdf' ? 'file-text' : 'image'"
                    [size]="18"
                    class="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div class="min-w-0 flex-1">
                    <p
                      class="truncate text-sm text-text-primary"
                      [title]="file.name"
                    >
                      {{ file.name }}
                    </p>
                    <p class="text-[11px] text-[var(--color-text-secondary)]">
                      {{ formatFileSize(file.size) }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-destructive)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                    [attr.aria-label]="'Quitar ' + file.name"
                    (click)="removeFile(i)"
                  >
                    <app-icon name="x" [size]="16" />
                  </button>
                </li>
              }
            </ul>
          }

          <!-- Nota libre: cómo facturar lo que dicen los documentos. -->
          <div>
            <label
              for="invoice-draft-scan-note"
              class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
            >
              Indicaciones para FacturIA (opcional)
            </label>
            <textarea
              id="invoice-draft-scan-note"
              rows="3"
              class="w-full rounded-lg border border-border bg-[var(--color-surface)] px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              placeholder="Ej.: facturar el 50 % del anticipo, pago a 30 días"
              [attr.maxlength]="noteMax"
              [value]="note()"
              (input)="onNoteInput($event)"
            ></textarea>
            <p class="mt-1 text-right text-[11px] text-[var(--color-text-secondary)]">
              {{ note().length }} / {{ noteMax }}
            </p>
          </div>

          @if (scanError()) {
            <app-alert-banner
              variant="danger"
              icon="alert-triangle"
              tone="token"
              heading="FacturIA no pudo analizar los documentos"
            >
              {{ scanError() }}
            </app-alert-banner>
          }
        </div>
      } @else {
        <!-- Analizando: escena IA + progreso rotativo (la cola no informa
             porcentaje). El movimiento se apaga con reduced-motion desde el
             sistema global. -->
        <div
          class="vx-ai-stage is-analyzing relative flex min-h-[300px] flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border border-border p-6 text-center"
          role="status"
          aria-live="polite"
          data-testid="facturia-progress"
        >
          <div class="vx-ai-holo-aurora"></div>
          <div class="vx-ai-holo-grid"></div>
          <div class="vx-ai-stage__halo"></div>
          <div class="vx-ai-stage__scan"></div>
          <div class="vx-ai-stage__shimmer"></div>
          <span class="vx-ai-sparkle vx-ai-sparkle--a"></span>
          <span class="vx-ai-sparkle vx-ai-sparkle--b"></span>
          <span class="vx-ai-sparkle vx-ai-sparkle--c"></span>
          <span class="vx-ai-sparkle vx-ai-sparkle--d"></span>
          <span class="vx-ai-sparkle vx-ai-sparkle--e"></span>

          <div class="vx-ai-stage__icon">
            <app-icon name="sparkles" [size]="32" />
          </div>
          <p class="relative z-10 text-base font-semibold text-text-primary">
            Factur<span class="vx-ai-text">IA</span> está analizando
            {{ files().length }}
            {{ files().length === 1 ? 'documento' : 'documentos' }}
          </p>
          <p
            class="vx-ai-stage__caption relative z-10 max-w-[300px] text-sm"
            data-testid="facturia-progress-message"
          >
            {{ progressMessage() }}
          </p>
          <p class="relative z-10 max-w-sm text-xs text-[var(--color-text-secondary)]">
            @if (stalled()) {
              Está tardando más de lo normal; seguimos procesando. Puedes
              cancelar y capturar la factura a mano.
            } @else {
              Suele tardar menos de un minuto.
            }
          </p>
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        @if (scanning()) {
          <app-button variant="outline" (clicked)="cancelScan()">
            Cancelar análisis
          </app-button>
        } @else {
          <app-button variant="outline" (clicked)="isOpen.set(false)">
            Cancelar
          </app-button>
          <app-button
            variant="ai"
            [disabled]="files().length === 0"
            (clicked)="startScan()"
          >
            <app-icon slot="icon" name="sparkles" [size]="16" />
            Analizar y autocompletar
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class InvoiceDraftScanModalComponent {
  private readonly scanner = inject(InvoiceDraftScannerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  /**
   * Ruta del escáner (sin `apiUrl`). La tienda no la pasa; la «Nueva factura»
   * de plataforma pasa `INVOICE_DRAFT_SCAN_PLATFORM_PATH`.
   */
  readonly endpoint = input<string>(INVOICE_DRAFT_SCAN_STORE_PATH);
  /** Resultado del análisis. El modal ya se cerró cuando esto sale. */
  readonly scanned = output<InvoiceDraftScanResult>();

  readonly maxFiles = INVOICE_DRAFT_SCAN_MAX_FILES;
  readonly maxFileMb = MAX_FILE_MB;
  readonly noteMax = INVOICE_DRAFT_SCAN_NOTE_MAX;
  readonly acceptAttr = INVOICE_DRAFT_SCAN_ACCEPTED_TYPES.join(',');

  readonly files = signal<File[]>([]);
  readonly note = signal('');
  readonly fileError = signal<string | null>(null);
  readonly scanError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly scanning = signal(false);
  /** `true` si el job pasó el umbral de lentitud del servicio (~60 s). */
  readonly stalled = signal(false);

  readonly isFull = computed(() => this.files().length >= this.maxFiles);

  /** Paso del progreso rotativo mientras `scanning()`. */
  readonly progressIndex = signal(0);
  readonly progressMessage = computed(
    () =>
      FACTURIA_PROGRESS_MESSAGES[
        this.progressIndex() % FACTURIA_PROGRESS_MESSAGES.length
      ],
  );
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  /** Borde de la zona de carga: acento al arrastrar encima, neutro si no. */
  readonly dropzoneClass = computed(() => {
    if (this.isFull()) return 'border-border opacity-60 cursor-not-allowed';
    return this.isDragging()
      ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)]'
      : 'border-border hover:border-[var(--color-primary)]';
  });

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private scanSub: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.scanSub?.unsubscribe();
      this.stopProgress();
    });
  }

  // ── Progreso rotativo ───────────────────────────────────────

  private startProgress(): void {
    this.stopProgress();
    this.progressIndex.set(0);
    // Zoneless: la señal agenda la detección de cambios; no hace falta Zone.
    this.progressTimer = setInterval(
      () => this.progressIndex.update((i) => i + 1),
      FACTURIA_PROGRESS_INTERVAL_MS,
    );
  }

  private stopProgress(): void {
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  // ── Archivos ────────────────────────────────────────────────

  openFilePicker(): void {
    if (this.isFull()) return;
    this.fileInput()?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.addFiles(Array.from(input?.files ?? []));
    // Sin esto, volver a elegir el mismo archivo tras quitarlo no dispara `change`.
    if (input) input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  removeFile(index: number): void {
    this.files.update((current) => current.filter((_, i) => i !== index));
    this.fileError.set(null);
  }

  onNoteInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement | null)?.value ?? '';
    this.note.set(value.slice(0, this.noteMax));
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * Agrega lo que se pueda y NOMBRA lo que quedó fuera, con el motivo. Mismos
   * topes que el backend (`scan-draft`): validarlos aquí ahorra subir 90 MB
   * para recibir un 400.
   */
  private addFiles(incoming: File[]): void {
    if (incoming.length === 0) return;
    this.fileError.set(null);
    this.scanError.set(null);

    const problems: string[] = [];
    const accepted: File[] = [];
    let room = this.maxFiles - this.files().length;

    for (const file of incoming) {
      if (room <= 0) {
        problems.push(`${file.name}: máximo ${this.maxFiles} documentos.`);
        continue;
      }
      if (!INVOICE_DRAFT_SCAN_ACCEPTED_TYPES.includes(file.type)) {
        problems.push(
          OFFICE_EXTENSIONS.test(file.name)
            ? `${file.name}: Word y Excel no se aceptan; expórtalo a PDF.`
            : `${file.name}: formato no soportado (usa PDF, JPG, PNG o WebP).`,
        );
        continue;
      }
      if (file.size > INVOICE_DRAFT_SCAN_MAX_FILE_BYTES) {
        problems.push(`${file.name}: supera ${this.maxFileMb} MB.`);
        continue;
      }
      // El mismo archivo dos veces sólo duplica tokens.
      const duplicate = [...this.files(), ...accepted].some(
        (picked) =>
          picked.name === file.name &&
          picked.size === file.size &&
          picked.lastModified === file.lastModified,
      );
      if (duplicate) continue;
      accepted.push(file);
      room--;
    }

    if (accepted.length > 0) {
      this.files.update((current) => [...current, ...accepted]);
    }
    if (problems.length > 0) this.fileError.set(problems.join(' '));
  }

  // ── Lectura ─────────────────────────────────────────────────

  startScan(): void {
    const files = this.files();
    if (files.length === 0) {
      this.scanError.set(ERROR_MESSAGES['INVOICE_DRAFT_SCAN_NO_FILES']);
      return;
    }
    if (this.scanning()) return;

    this.scanSub?.unsubscribe();
    this.scanError.set(null);
    this.stalled.set(false);
    this.scanning.set(true);
    this.startProgress();

    this.scanSub = this.scanner
      .scanDraft(
        files,
        this.note(),
        { onStall: () => this.stalled.set(true) },
        this.endpoint(),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.stopProgress();
          this.scanning.set(false);
          this.scanSub = null;
          this.scanned.emit(result);
          // `closed` de app-modal dispara `reset()`.
          this.isOpen.set(false);
        },
        error: (err: unknown) => {
          this.stopProgress();
          this.scanning.set(false);
          this.stalled.set(false);
          this.scanSub = null;
          this.scanError.set(this.describeError(err));
        },
      });
  }

  /** Corta el poll; los archivos y la nota quedan para reintentar. */
  cancelScan(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.stopProgress();
    this.scanning.set(false);
    this.stalled.set(false);
  }

  /** Estado limpio al cerrar: el contenido de app-modal no se destruye. */
  reset(): void {
    this.cancelScan();
    this.files.set([]);
    this.note.set('');
    this.fileError.set(null);
    this.scanError.set(null);
    this.isDragging.set(false);
  }

  private describeError(err: unknown): string {
    if (err instanceof HttpErrorResponse) return parseApiError(err).userMessage;
    // Los fallos del job ya llegan traducidos con ERROR_MESSAGES por
    // AiScanJobService (`INVOICE_DRAFT_SCAN_*`).
    if (err instanceof Error && err.message) return err.message;
    return ERROR_MESSAGES['INVOICE_DRAFT_SCAN_AI_FAILED'];
  }
}
