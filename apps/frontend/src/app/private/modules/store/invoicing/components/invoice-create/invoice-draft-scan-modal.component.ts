import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { ERROR_MESSAGES } from '../../../../../../core/utils/error-messages';
import { injectAiJobProgress } from '../../../../../../shared/utils/ai-job-progress';
import { AiJobProgressComponent } from '../../../../../../shared/components/ai-job-progress/ai-job-progress.component';

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
  invoiceDraftResumeKey,
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
 * Cerrar el modal deja el job en curso: al reabrirlo se reengancha y entrega el
 * resultado (QUI-1020). «Cancelar análisis» sí lo descarta.
 */
@Component({
  selector: 'vendix-invoice-draft-scan-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    AlertBannerComponent,
    AiJobProgressComponent,
  ],
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
      @if (!showProgress()) {
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
              heading="No se pueden analizar los documentos"
            >
              {{ scanError() }}
            </app-alert-banner>
          }
        </div>
      } @else {
        <!-- Analizando: barra de progreso compartida de IA (QUI-1020). -->
        <div
          class="flex min-h-[200px] flex-col justify-center gap-3 p-2"
          data-testid="facturia-progress"
        >
          <app-ai-job-progress
            [progress]="aiProgress"
            [showRetry]="files().length > 0"
            (retry)="startScan()"
          />
          @if (aiProgress.running()) {
            <p class="text-center text-xs text-[var(--color-text-secondary)]">
              Factur<span class="vx-ai-text">IA</span> está analizando
              {{ files().length === 0 ? 'tus documentos' : files().length === 1 ? '1 documento' : files().length + ' documentos' }}.
              Puedes cerrar esta ventana: el análisis continúa.
            </p>
          }
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        @if (scanning()) {
          <app-button variant="outline" (clicked)="cancelScan()">
            Cancelar análisis
          </app-button>
        } @else if (failed()) {
          <app-button variant="outline" (clicked)="backToFiles()">
            Cambiar documentos
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
  /** Shared progress bar state of the analysis (QUI-1020). */
  readonly aiProgress = injectAiJobProgress({ kind: 'invoice_draft' });

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
  /** The last analysis failed: the bar shows the error and the files stay. */
  readonly failed = signal(false);
  readonly showProgress = computed(() => this.scanning() || this.failed());

  readonly isFull = computed(() => this.files().length >= this.maxFiles);

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
    this.destroyRef.onDestroy(() => this.scanSub?.unsubscribe());
    // Re-attach to an analysis still running when the modal is reopened.
    effect(() => {
      if (this.isOpen()) untracked(() => this.tryResume());
    });
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

    this.scanError.set(null);
    this.failed.set(false);
    this.aiProgress.reset();
    this.aiProgress.setSize(files.length);
    this.listen(
      this.scanner.scanDraft(
        files,
        this.note(),
        {
          progress: this.aiProgress,
          resumeKey: invoiceDraftResumeKey(this.endpoint()),
        },
        this.endpoint(),
      ),
    );
  }

  private tryResume(): void {
    if (this.scanSub || this.scanning()) return;
    const resumed = this.scanner.resume(this.endpoint(), {
      progress: this.aiProgress,
    });
    if (!resumed) return;
    this.failed.set(false);
    this.listen(resumed);
  }

  private listen(source: Observable<InvoiceDraftScanResult>): void {
    this.scanSub?.unsubscribe();
    this.scanning.set(true);
    this.scanSub = source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.scanning.set(false);
        this.scanSub = null;
        this.scanned.emit(result);
        // `closed` de app-modal dispara `reset()`.
        this.isOpen.set(false);
      },
      // The classified error is shown by the progress bar; files and note stay.
      error: () => {
        this.scanning.set(false);
        this.failed.set(true);
        this.scanSub = null;
      },
    });
  }

  /** Explicit cancel: stops the poll and discards the remembered job. */
  cancelScan(): void {
    this.detach();
    this.scanner.forget(this.endpoint());
    this.aiProgress.reset();
  }

  /** Back to the file list after a failure, keeping files and note. */
  backToFiles(): void {
    this.failed.set(false);
    this.aiProgress.reset();
  }

  /** Stops listening without discarding the job (it can be resumed). */
  private detach(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.scanning.set(false);
  }

  /** Estado limpio al cerrar: el contenido de app-modal no se destruye. */
  reset(): void {
    this.detach();
    this.aiProgress.reset();
    this.failed.set(false);
    this.files.set([]);
    this.note.set('');
    this.fileError.set(null);
    this.scanError.set(null);
    this.isDragging.set(false);
  }
}
