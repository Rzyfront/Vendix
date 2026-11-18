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

import { injectAiJobProgress } from '../../../utils/ai-job-progress';
import { AiJobProgressComponent } from '../../ai-job-progress/ai-job-progress.component';

import { AiReviewAckComponent } from '../../ai-review-ack/ai-review-ack.component';
import { ModalComponent } from '../../modal/modal.component';
import { ButtonComponent } from '../../button/button.component';
import { BadgeComponent } from '../../badge/badge.component';
import { IconComponent } from '../../icon/icon.component';
import { StepsLineComponent } from '../../steps-line/steps-line.component';

import { RutScannerService } from '../services/rut-scanner.service';
import { RutScanApiResponse } from '../interfaces/rut-scan-result.interface';
import {
  RutScanResult,
  RutScannerScope,
} from '../interfaces/rut-scan-result.interface';
import {
  getFiscalResponsibilityLabel,
  normalizeFiscalResponsibilityCode,
} from '../../../constants/fiscal-responsibilities.constants';

type RutScannerStep = 1 | 2 | 3;

const PERSON_TYPE_LABELS: Record<string, string> = {
  NATURAL: 'Persona Natural',
  JURIDICA: 'Persona Jurídica',
};

const TAX_REGIME_LABELS: Record<string, string> = {
  COMUN: 'Régimen Común',
  SIMPLIFICADO: 'Régimen Simplificado',
  GRAN_CONTRIBUYENTE: 'Gran Contribuyente',
};

/**
 * AI-powered RUT scanner modal for the fiscal activation wizard.
 *
 * Three-step flow: upload (drag&drop + camera + file input) → AI scan
 * (holographic "analyzing" panel) → review extracted fiscal data. Emits a
 * {@link RutScanResult} through `confirmed` when the user accepts the data.
 *
 * Wiring into the legal-data step is done by the parent; this component only
 * exposes the `isOpen` input, `isOpenChange`/`confirmed` outputs and an
 * optional `scope` to override the tenant namespace.
 */
@Component({
  selector: 'app-rut-scanner-modal',
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
      title="Escanear RUT con IA"
      subtitle="Sube tu RUT y la IA extraerá tus datos fiscales automáticamente"
    >
      <!-- Steps indicator -->
      <div class="mb-6">
        <app-steps-line
          [steps]="wizardSteps"
          [currentStep]="currentStep() - 1"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- Step 1: Upload -->
      @if (currentStep() === 1) {
        <div class="space-y-4">
          <!-- Camera button for mobile -->
          <div class="sm:hidden">
            <button
              type="button"
              (click)="triggerCamera()"
              class="w-full flex items-center justify-center gap-3 p-4 bg-primary text-[var(--color-text-on-primary)] rounded-xl shadow-md active:scale-[0.98] transition-transform"
            >
              <app-icon name="camera" [size]="24"></app-icon>
              <span class="text-base font-semibold">Tomar Foto</span>
            </button>
          </div>

          <!-- Dropzone -->
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
              <!-- File preview -->
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
                    alt="Vista previa del RUT"
                    class="max-h-40 rounded-lg border border-border object-contain"
                  />
                } @else {
                  <!-- PDF / non-image -->
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
                @if (!isProcessingFile()) {
                  <div class="flex items-center gap-2 text-success">
                    <app-icon name="check-circle" [size]="16"></app-icon>
                    <span class="text-xs font-medium">Archivo listo</span>
                  </div>
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
              <!-- Empty state -->
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
                Arrastra tu RUT aquí
              </p>
              <p class="text-xs text-text-secondary">
                JPG, PNG, WebP o PDF - Máx 10MB
              </p>
            }
          </div>

          <!-- Hidden file inputs -->
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
        </div>
      }

      <!-- Step 2: AI progress bar (QUI-1020) -->
      @if (currentStep() === 2) {
        <div class="min-h-[200px] flex flex-col justify-center gap-3 p-2">
          <app-ai-job-progress
            [progress]="aiProgress"
            [showRetry]="!!selectedFile()"
            (retry)="startScan()"
          />
          @if (aiProgress.running()) {
            <p class="text-center text-xs text-text-secondary">
              Extrayendo NIT, razón social, régimen y responsabilidades
              fiscales. No cierres la ventana.
            </p>
          }
        </div>
      }

      <!-- Step 3: Review extracted data -->
      @if (currentStep() === 3 && result()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <!-- Confidence badge -->
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-text-primary">
              Datos extraídos
            </h4>
            <app-badge [variant]="confidenceVariant()" size="sm">
              <span class="inline-flex items-center gap-1">
                <app-icon name="sparkles" [size]="12"></app-icon>
                Confianza {{ confidencePercent() }}%
              </span>
            </app-badge>
          </div>

          <!-- Identity card -->
          <div class="bg-surface border border-border rounded-lg p-4 space-y-3">
            <div>
              <p class="text-xs text-text-secondary">Razón social</p>
              <p class="text-base font-medium text-text-primary">
                {{ result()!.legal_name || '—' }}
              </p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p class="text-xs text-text-secondary">NIT - DV</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ result()!.nit
                  }}{{ result()!.nit_dv ? ' - ' + result()!.nit_dv : '' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">Tipo de persona</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ personTypeLabel() }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">Régimen tributario</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ taxRegimeLabel() }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">CIIU</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ result()!.ciiu || '—' }}
                </p>
              </div>
            </div>
          </div>

          <!-- Location card -->
          <div class="bg-surface border border-border rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2">
              <app-icon
                name="map-pin"
                [size]="14"
                class="text-text-secondary"
              ></app-icon>
              <p class="text-xs font-semibold text-text-secondary uppercase">
                Ubicación
              </p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Dirección fiscal</p>
              <p class="text-sm font-medium text-text-primary">
                {{ result()!.fiscal_address || '—' }}
              </p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p class="text-xs text-text-secondary">País</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ result()!.country || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">Departamento</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ result()!.department || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">Ciudad</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ result()!.city || '—' }}
                </p>
              </div>
            </div>
          </div>

          <!-- Tax responsibilities -->
          <div class="bg-surface border border-border rounded-lg p-4 space-y-2">
            <p class="text-xs font-semibold text-text-secondary uppercase">
              Responsabilidades tributarias
            </p>
            @if (result()!.tax_responsibilities.length > 0) {
              <div class="flex flex-wrap gap-2">
                @for (
                  resp of result()!.tax_responsibilities;
                  track resp
                ) {
                  <app-badge variant="info" size="xsm">{{
                    getResponsibilityBadgeText(resp)
                  }}</app-badge>
                }
              </div>
            } @else {
              <p class="text-sm text-text-secondary">
                No se detectaron responsabilidades.
              </p>
            }
            @if (result()!.tax_scheme) {
              <p class="text-xs text-text-secondary pt-1">
                Esquema: {{ result()!.tax_scheme }}
              </p>
            }
          </div>

          <!-- Extraction notes -->
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

          <!-- Verificación obligatoria de los datos precargados por la IA -->
          <app-ai-review-ack
            #ackBlock
            [(acknowledged)]="aiAck"
            entityLabel="datos del RUT"
          ></app-ai-review-ack>
        </div>
      }

      <!-- Footer Actions -->
      <div slot="footer" class="flex justify-between gap-3">
        <div>
          @if (currentStep() === 3) {
            <app-button variant="outline" (clicked)="resetWizard()">
              Escanear otro
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
            <app-button
              variant="primary"
              [disabled]="!result()"
              (clicked)="onConfirm()"
            >
              Usar estos datos
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class RutScannerModalComponent {
  private readonly rutScannerService = inject(RutScannerService);
  /** Shared progress bar state of the scan (QUI-1020). */
  readonly aiProgress = injectAiJobProgress({ kind: 'rut' });
  private readonly destroyRef = inject(DestroyRef);

  /** Controls modal visibility. */
  readonly isOpen = input(false);
  /** Optional explicit tenant scope; falls back to the active app type. */
  readonly scope = input<RutScannerScope | undefined>(undefined);

  /** Two-way visibility binding partner. */
  readonly isOpenChange = output<boolean>();
  /** Emitted with the extracted fiscal data when the user accepts it. */
  readonly confirmed = output<RutScanResult>();

  // Wizard state
  readonly currentStep = signal<RutScannerStep>(1);

  /**
   * Verificación obligatoria de los datos precargados por la IA. El botón de
   * confirmar sigue habilitado: si esto es false, `onConfirm` desvía el clic a
   * `requestAttention()` en vez de emitir los datos fiscales extraídos.
   */
  readonly aiAck = signal(false);
  private readonly ackBlock = viewChild<AiReviewAckComponent>('ackBlock');
  readonly selectedFile = signal<File | null>(null);
  readonly filePreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  private scanSub: Subscription | null = null;
  readonly isProcessingFile = signal(false);
  readonly result = signal<RutScanResult | null>(null);

  readonly isImageFile = computed(() => {
    const file = this.selectedFile();
    return file?.type?.startsWith('image/') ?? false;
  });

  /**
   * El backend ya normaliza `confidence` a 0-100 (`normalizeRutResponse` la
   * acota con `Math.min(100, ...)`). El cálculo anterior asumía 0-1 y hacía
   * `min(value, 1) * 100`, así que cualquier confianza real ≥ 1 se aplastaba a
   * 1 y el badge marcaba **100%** siempre — justo lo contrario de avisar que la
   * lectura fue dudosa.
   */
  readonly confidencePercent = computed(() => {
    const value = this.result()?.confidence ?? 0;
    return Math.round(Math.min(Math.max(value, 0), 100));
  });

  readonly confidenceVariant = computed<'success' | 'warning' | 'error'>(() => {
    const pct = this.confidencePercent();
    if (pct >= 80) return 'success';
    if (pct >= 50) return 'warning';
    return 'error';
  });

  readonly personTypeLabel = computed(() => {
    const value = this.result()?.person_type;
    return value ? (PERSON_TYPE_LABELS[value] ?? value) : '—';
  });

  readonly taxRegimeLabel = computed(() => {
    const value = this.result()?.tax_regime;
    return value ? (TAX_REGIME_LABELS[value] ?? value) : '—';
  });

  readonly wizardSteps = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
  ];

  constructor() {
    effect(() => {
      if (this.isOpen()) untracked(() => this.tryResume());
    });
  }

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly VALID_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  // ============================================================
  // File handling
  // ============================================================

  triggerFileInput(): void {
    const input = document.querySelector(
      'app-rut-scanner-modal input[type="file"]:not([capture])',
    ) as HTMLInputElement | null;
    input?.click();
  }

  triggerCamera(): void {
    const input = document.querySelector(
      'app-rut-scanner-modal input[capture]',
    ) as HTMLInputElement | null;
    input?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) {
      this.handleFile(file);
    }
    // Reset input so the same file can be re-selected.
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
    if (file) {
      this.handleFile(file);
    }
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
      reader.onerror = () => {
        this.isProcessingFile.set(false);
      };
      reader.readAsDataURL(file);
    } else {
      // PDF - no preview image.
      this.filePreviewUrl.set(null);
      this.isProcessingFile.set(false);
    }
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

  // ============================================================
  // Scanning
  // ============================================================

  startScan(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.currentStep.set(2);
    this.aiProgress.reset();
    this.listen(
      this.rutScannerService.scanRut(file, this.scope(), {
        progress: this.aiProgress,
        resumeKey: this.resumeKey(),
      }),
    );
  }

  /** Back to the upload step keeping the chosen file (retry without re-upload). */
  backToUpload(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.aiProgress.reset();
    this.currentStep.set(1);
  }

  private resumeKey(): string {
    return `rut:${this.scope() ?? 'auto'}`;
  }

  /**
   * Re-attach to a scan that was running when the screen was closed or
   * reloaded. Same handlers as a fresh scan.
   */
  private tryResume(): void {
    if (this.scanSub || this.currentStep() !== 1 || this.result()) return;
    const resumed = this.rutScannerService.resume(this.scope(), {
      progress: this.aiProgress,
    });
    if (!resumed) return;
    this.currentStep.set(2);
    this.listen(resumed);
  }

  private listen(source: Observable<RutScanApiResponse>): void {
    this.scanSub?.unsubscribe();
    this.scanSub = source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.result.set(response.data);
          this.currentStep.set(3);
        }
      },
      // The classified error is already shown by the progress bar and the
      // selected file is kept so the user can retry.
      error: () => undefined,
    });
  }

  /**
   * Traduce el código de la casilla 53 a una etiqueta legible para el badge de revisión.
   */
  getResponsibilityBadgeText(code: string): string {
    const label = getFiscalResponsibilityLabel(code);
    if (!label || label === code) return code;
    return `${code} - ${label}`;
  }

  // ============================================================
  // Confirm
  // ============================================================

  onConfirm(): void {
    const data = this.result();
    // Este early-return también actúa como guard de doble clic: `closeAndReset`
    // limpia `result`, así que un segundo clic no puede volver a emitir.
    if (!data) return;

    // El botón sigue habilitado a propósito: en vez de quedar inerte, el clic
    // lleva al usuario a la casilla de verificación y la resalta.
    if (!this.aiAck()) {
      this.ackBlock()?.requestAttention();
      return;
    }

    // Normaliza códigos de responsabilidades (ej: '48' -> 'O-48', '05' -> 'O-05')
    // y tax_scheme antes de emitir al formulario padre (ADR-03).
    const normalizedData: RutScanResult = {
      ...data,
      tax_responsibilities: (data.tax_responsibilities ?? []).map((r) =>
        normalizeFiscalResponsibilityCode(r),
      ),
      tax_scheme: data.tax_scheme
        ? normalizeFiscalResponsibilityCode(data.tax_scheme)
        : '',
    };

    this.confirmed.emit(normalizedData);
    this.closeAndReset();
  }

  // ============================================================
  // Modal lifecycle
  // ============================================================

  onOpenChange(open: boolean): void {
    if (!open) {
      this.resetWizard();
    }
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
}
