import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  effect,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';

import { injectAiJobProgress } from '../../utils/ai-job-progress';
import { AiJobProgressComponent } from '../ai-job-progress/ai-job-progress.component';

import { AiReviewAckComponent } from '../ai-review-ack/ai-review-ack.component';
import { BadgeComponent, BadgeVariant } from '../badge/badge.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { ModalComponent } from '../modal/modal.component';
import { StepsLineComponent } from '../steps-line/steps-line.component';

import {
  DianResolutionScanResult,
  RESOLUTION_SCAN_FIELD_KEYS,
  RESOLUTION_SCAN_FIELD_LABELS,
  ResolutionScanField,
  ResolutionScanFieldKey,
  ResolutionScanApiResponse,
  ResolutionScannerScope,
  SCANNED_DOCUMENT_TYPE_LABELS,
  SCANNED_ENVIRONMENT_LABELS,
} from './interfaces/resolution-scan-result.interface';
import { ResolutionScannerService } from './services/resolution-scanner.service';

type ScannerStep = 1 | 2 | 3;

/** Veredicto por campo, ya traducido a algo que se puede pintar. */
interface ReviewRow {
  key: ResolutionScanFieldKey;
  label: string;
  display: string;
  badgeLabel: string;
  badgeVariant: BadgeVariant;
  warning: string | null;
  missing: boolean;
}

/**
 * Escáner IA de resoluciones de numeración DIAN.
 *
 * Tres pasos: subir → analizar → **revisar campo por campo**. El tercer paso es
 * la razón de existir del componente: la resolución autoriza numeración legal,
 * así que la IA nunca "llena el formulario y listo" — cada campo llega con su
 * veredicto (verificado / confírmalo / no leído) y el usuario acepta con un
 * check explícito antes de que el padre precargue nada.
 *
 * La clave técnica siempre aparece como "confírmalo", incluso cuando la IA la
 * leyó perfecta: son 40 caracteres hexadecimales que alimentan el CUFE, y un
 * solo carácter mal leído produce facturas que la DIAN rechaza sin decir por
 * qué.
 *
 * Guardar no ocurre aquí: `confirmed` entrega el resultado y el padre decide
 * qué campos de su formulario precarga.
 */
@Component({
  selector: 'app-dian-resolution-scanner-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    StepsLineComponent,
    AiReviewAckComponent,
    AiJobProgressComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      size="lg"
      title="Escanear resolución DIAN con IA"
      subtitle="Sube la resolución de numeración y la IA extraerá prefijo, rango y vigencia"
    >
      <div class="mb-6">
        <app-steps-line
          [steps]="wizardSteps"
          [currentStep]="currentStep() - 1"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- Paso 1: subir -->
      @if (currentStep() === 1) {
        <div class="space-y-4">
          <div class="sm:hidden">
            <button
              type="button"
              (click)="triggerCamera()"
              class="w-full flex items-center justify-center gap-3 p-4 bg-primary text-[var(--color-text-on-primary)] rounded-xl shadow-md active:scale-[0.98] transition-transform"
            >
              <app-icon name="camera" [size]="24"></app-icon>
              <span class="text-base font-semibold">Tomar foto</span>
            </button>
          </div>

          <div
            (click)="triggerFileInput()"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
            class="group relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[200px]"
            [class.border-primary]="isDragging()"
            [class.border-border]="!isDragging() && !selectedFile()"
            [class.hover:border-primary]="!isDragging()"
            [class.border-success]="selectedFile() && !isProcessingFile()"
            [class.bg-success-light]="selectedFile() && !isProcessingFile()"
          >
            @if (filePreviewUrl() || selectedFile()) {
              <div class="flex flex-col items-center gap-3 w-full">
                @if (isProcessingFile()) {
                  <app-icon
                    name="loader-2"
                    [size]="32"
                    class="text-[var(--color-primary)]"
                    [spin]="true"
                  ></app-icon>
                  <p class="text-sm text-text-secondary">Cargando archivo...</p>
                } @else if (isImageFile()) {
                  <img
                    [src]="filePreviewUrl()"
                    alt="Vista previa de la resolución"
                    class="max-h-40 rounded-lg border border-border object-contain"
                  />
                } @else {
                  <div class="p-4 bg-[var(--color-primary-light)] rounded-lg">
                    <app-icon
                      name="file-text"
                      [size]="48"
                      class="text-[var(--color-primary)]"
                    ></app-icon>
                  </div>
                }
                <p class="text-sm font-medium text-text-primary">
                  {{ selectedFile()?.name }}
                </p>
                @if (selectedFile()?.size) {
                  <p class="text-xs text-text-secondary">
                    {{ formatFileSize(selectedFile()!.size) }}
                  </p>
                }
                <button
                  type="button"
                  class="text-xs text-[var(--color-primary)] hover:underline font-medium"
                  (click)="removeFile(); $event.stopPropagation()"
                >
                  Cambiar archivo
                </button>
              </div>
            } @else {
              <div
                class="p-3 bg-[var(--color-primary-light)] rounded-full mb-3 group-hover:scale-110 transition-transform"
              >
                <app-icon
                  name="scan-line"
                  [size]="32"
                  class="text-[var(--color-primary)]"
                ></app-icon>
              </div>
              <p class="text-sm font-semibold text-text-primary mb-1">
                Arrastra la resolución aquí
              </p>
              <p class="text-xs text-text-secondary">
                JPG, PNG, WebP o PDF — máx 10MB
              </p>
            }
          </div>

          <input
            type="file"
            class="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            (change)="onFileSelected($event)"
          />
          <input
            type="file"
            class="hidden"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            (change)="onFileSelected($event)"
          />

          @if (fileError()) {
            <p class="text-sm text-error">{{ fileError() }}</p>
          }

          <div
            class="flex items-start gap-2 rounded-lg border border-border bg-surface-secondary p-3"
          >
            <app-icon
              name="info"
              [size]="16"
              class="text-text-secondary mt-0.5"
            ></app-icon>
            <p class="text-xs text-text-secondary">
              La IA solo precarga el formulario. Ningún dato se guarda hasta que
              revises cada campo y pulses Guardar.
            </p>
          </div>
        </div>
      }

      <!-- Paso 2: barra de progreso de IA (QUI-1020) -->
      @if (currentStep() === 2) {
        <div class="min-h-[200px] flex flex-col justify-center gap-3 p-2">
          <app-ai-job-progress
            [progress]="aiProgress"
            [showRetry]="hasInput()"
            (retry)="startScan()"
          />
          @if (aiProgress.running()) {
            <p class="text-center text-xs text-text-secondary">
              Extrayendo prefijo, número, rango autorizado, vigencia y clave técnica. No cierres la ventana.
            </p>
          }
        </div>
      }

      <!-- Paso 3: revisar -->
      @if (currentStep() === 3 && result()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-text-primary">
              Datos extraídos
            </h4>
            <app-badge [variant]="overallVariant()" size="sm">
              <span class="inline-flex items-center gap-1">
                <app-icon name="sparkles" [size]="12"></app-icon>
                Legibilidad {{ result()!.confidence }}%
              </span>
            </app-badge>
          </div>

          @if (result()!.blocking_issues.length > 0) {
            <div class="rounded-lg border border-error bg-error-light p-3">
              <div class="flex items-center gap-2 mb-1">
                <app-icon
                  name="circle-alert"
                  [size]="16"
                  class="text-error"
                ></app-icon>
                <p class="text-xs font-semibold text-error">
                  Faltan datos obligatorios de la resolución
                </p>
              </div>
              <ul class="list-disc pl-6 space-y-0.5">
                @for (issue of result()!.blocking_issues; track issue) {
                  <li class="text-xs text-error">{{ issue }}</li>
                }
              </ul>
              <p class="text-xs text-error mt-1">
                Puedes usar lo leído y completar el resto a mano.
              </p>
            </div>
          }

          <div class="rounded-lg border border-border divide-y divide-border">
            @for (row of reviewRows(); track row.key) {
              <div class="p-3 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-xs text-text-secondary">{{ row.label }}</p>
                  <p
                    class="text-sm font-medium break-all"
                    [class.text-text-primary]="!row.missing"
                    [class.text-text-secondary]="row.missing"
                  >
                    {{ row.display }}
                  </p>
                  @if (row.warning) {
                    <p class="text-xs text-warning mt-1">{{ row.warning }}</p>
                  }
                </div>
                <app-badge [variant]="row.badgeVariant" size="xsm">
                  {{ row.badgeLabel }}
                </app-badge>
              </div>
            }
          </div>

          @if (result()!.extraction_notes) {
            <div
              class="flex items-start gap-2 bg-warning-light border border-warning rounded-lg p-3"
            >
              <app-icon
                name="info"
                [size]="16"
                class="text-warning mt-0.5"
              ></app-icon>
              <p class="text-xs text-warning">
                {{ result()!.extraction_notes }}
              </p>
            </div>
          }

          <app-ai-review-ack
            #ackBlock
            [(acknowledged)]="aiAck"
            entityLabel="datos de la resolución DIAN"
          ></app-ai-review-ack>
        </div>
      }

      <div slot="footer" class="flex justify-between gap-3">
        <div>
          @if (currentStep() === 3) {
            <app-button variant="outline" (clicked)="resetWizard()">
              Escanear otra
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button variant="outline" (clicked)="onCancel()">
            Cancelar
          </app-button>
          @if (currentStep() === 2 && !aiProgress.running()) {
            <app-button variant="outline" (clicked)="backToUpload()">
              Cambiar archivo
            </app-button>
          }
          @if (currentStep() === 1) {
            <app-button
              variant="primary"
              [disabled]="!selectedFile()"
              (clicked)="startScan()"
            >
              <span class="inline-flex items-center gap-2">
                <app-icon name="sparkles" [size]="16"></app-icon>
                Analizar con IA
              </span>
            </app-button>
          }
          @if (currentStep() === 3) {
            <app-button variant="primary" (clicked)="onConfirm()">
              Precargar el formulario
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class DianResolutionScannerModalComponent {
  private readonly scanner = inject(ResolutionScannerService);
  /** Shared progress bar state of the scan (QUI-1020). */
  readonly aiProgress = injectAiJobProgress({ kind: 'dian_resolution' });
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  /**
   * Obligatorio: los namespaces de tienda y plataforma no comparten prefijo, y
   * deducirlo del app type es exactamente lo que hizo que el escáner de RUT
   * devolviera 404 para super-admin.
   */
  readonly scope = input.required<ResolutionScannerScope>();

  readonly isOpenChange = output<boolean>();
  readonly confirmed = output<DianResolutionScanResult>();

  readonly currentStep = signal<ScannerStep>(1);
  readonly selectedFile = signal<File | null>(null);
  readonly filePreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  /** true cuando el job lleva más de ~60 s sin terminar. */
  private scanSub: Subscription | null = null;
  readonly isProcessingFile = signal(false);
  readonly result = signal<DianResolutionScanResult | null>(null);

  /** Verificación obligatoria de lo que precargó la IA. */
  readonly aiAck = signal(false);
  private readonly ackBlock = viewChild<AiReviewAckComponent>('ackBlock');

  readonly wizardSteps = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
  ];

  readonly isImageFile = computed(
    () => this.selectedFile()?.type?.startsWith('image/') ?? false,
  );

  readonly overallVariant = computed<BadgeVariant>(() => {
    const pct = this.result()?.confidence ?? 0;
    if (pct >= 80) return 'success';
    if (pct >= 50) return 'warning';
    return 'error';
  });

  /**
   * Un renglón por campo, con su veredicto ya resuelto. Se arma en un `computed`
   * y no en la plantilla porque el estado de un campo depende de tres cosas
   * (valor, `verified`, confianza) y repetir esa lógica en el template la haría
   * divergir del backend.
   */
  readonly reviewRows = computed<ReviewRow[]>(() => {
    const data = this.result();
    if (!data) return [];

    return RESOLUTION_SCAN_FIELD_KEYS.map((key) => {
      const field = data[key] as ResolutionScanField<unknown>;
      const missing = field.value === null;
      const needsConfirmation = data.requires_manual_confirmation.includes(key);

      return {
        key,
        label: RESOLUTION_SCAN_FIELD_LABELS[key],
        display: missing ? 'No leído' : this.displayValue(key, field.value),
        badgeLabel: missing
          ? 'No leído'
          : needsConfirmation
            ? 'Confírmalo'
            : 'Verificado',
        badgeVariant: missing
          ? 'neutral'
          : needsConfirmation
            ? 'warning'
            : 'success',
        warning: field.warning,
        missing,
      } satisfies ReviewRow;
    });
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) untracked(() => this.tryResume());
    });
  }

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;
  private readonly VALID_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  // ============================================================
  // Archivo
  // ============================================================

  triggerFileInput(): void {
    const input = document.querySelector(
      'app-dian-resolution-scanner-modal input[type="file"]:not([capture])',
    ) as HTMLInputElement | null;
    input?.click();
  }

  triggerCamera(): void {
    const input = document.querySelector(
      'app-dian-resolution-scanner-modal input[capture]',
    ) as HTMLInputElement | null;
    input?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) this.handleFile(file);
    // Reset para que el mismo archivo se pueda volver a elegir.
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
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  removeFile(): void {
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
    this.isProcessingFile.set(false);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  private handleFile(file: File): void {
    this.fileError.set(null);

    if (!this.VALID_TYPES.includes(file.type)) {
      this.fileError.set('Formato no soportado. Usa JPG, PNG, WebP o PDF.');
      return;
    }
    if (file.size > this.MAX_FILE_SIZE) {
      this.fileError.set('El archivo excede el límite de 10MB.');
      return;
    }

    this.selectedFile.set(file);

    if (file.type.startsWith('image/')) {
      this.isProcessingFile.set(true);
      const reader = new FileReader();
      reader.onload = () => {
        this.filePreviewUrl.set(reader.result as string);
        this.isProcessingFile.set(false);
      };
      reader.onerror = () => this.isProcessingFile.set(false);
      reader.readAsDataURL(file);
    } else {
      this.filePreviewUrl.set(null);
      this.isProcessingFile.set(false);
    }
  }

  // ============================================================
  // Escaneo
  // ============================================================

  startScan(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.currentStep.set(2);
    this.aiProgress.reset();
    this.listen(
      this.scanner.scanResolution(file, this.scope(), {
        progress: this.aiProgress,
        resumeKey: this.resumeKey(),
      }),
    );
  }

  hasInput(): boolean {
    return this.selectedFile() !== null;
  }

  /** Back to the upload step keeping the chosen file (retry without re-upload). */
  backToUpload(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.aiProgress.reset();
    this.currentStep.set(1);
  }

  private resumeKey(): string {
    return `dian_resolution:${this.scope()}`;
  }

  /** Re-attach to a scan that was running when the screen was closed or reloaded. */
  private tryResume(): void {
    if (this.scanSub || this.currentStep() !== 1 || this.result()) return;
    const resumed = this.scanner.resume(this.scope(), {
      progress: this.aiProgress,
    });
    if (!resumed) return;
    this.currentStep.set(2);
    this.listen(resumed);
  }

  private listen(source: Observable<ResolutionScanApiResponse>): void {
    this.scanSub?.unsubscribe();
    this.scanSub = source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.result.set(response.data);
          this.currentStep.set(3);
        }
      },
      // The classified error is shown by the progress bar and the selected
      // file is kept so the user can retry.
      error: () => undefined,
    });
  }

  // ============================================================
  // Confirmar
  // ============================================================

  onConfirm(): void {
    const data = this.result();
    // También actúa como guard de doble clic: `closeAndReset` limpia `result`.
    if (!data) return;

    // El botón queda habilitado a propósito: en vez de un botón inerte, el clic
    // lleva al usuario al check y lo resalta.
    if (!this.aiAck()) {
      this.ackBlock()?.requestAttention();
      return;
    }

    this.confirmed.emit(data);
    this.closeAndReset();
  }

  // ============================================================
  // Ciclo de vida del modal
  // ============================================================

  onOpenChange(open: boolean): void {
    if (!open) this.resetWizard();
    this.isOpenChange.emit(open);
  }

  onCancel(): void {
    this.closeAndReset();
  }

  resetWizard(): void {
    this.currentStep.set(1);
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
    this.isProcessingFile.set(false);
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.aiProgress.reset();
    this.result.set(null);
    // Obligatorio: el contenido proyectado en app-modal no se destruye al
    // cerrar, así que sin este reset la segunda apertura traería el check ya
    // marcado y el guard quedaría anulado.
    this.aiAck.set(false);
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.isOpenChange.emit(false);
  }

  private displayValue(key: ResolutionScanFieldKey, value: unknown): string {
    if (key === 'document_type') {
      return SCANNED_DOCUMENT_TYPE_LABELS[String(value)] ?? String(value);
    }
    if (key === 'environment') {
      return SCANNED_ENVIRONMENT_LABELS[String(value)] ?? String(value);
    }
    if (key === 'range_from' || key === 'range_to') {
      return Number(value).toLocaleString('es-CO');
    }
    return String(value);
  }
}
