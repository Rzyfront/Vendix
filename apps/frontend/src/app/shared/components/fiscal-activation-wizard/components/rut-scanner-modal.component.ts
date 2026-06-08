import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { ModalComponent } from '../../modal/modal.component';
import { ButtonComponent } from '../../button/button.component';
import { BadgeComponent } from '../../badge/badge.component';
import { IconComponent } from '../../icon/icon.component';
import { StepsLineComponent } from '../../steps-line/steps-line.component';
import { ToastService } from '../../toast/toast.service';

import { RutScannerService } from '../services/rut-scanner.service';
import {
  RutScanResult,
  RutScannerScope,
} from '../interfaces/rut-scan-result.interface';

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
              class="w-full flex items-center justify-center gap-3 p-4 bg-primary-600 text-white rounded-xl shadow-md active:scale-[0.98] transition-transform"
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
            [class.border-primary-600]="isDragging()"
            [class.border-border]="!isDragging() && !selectedFile()"
            [class.hover:border-primary-600]="!isDragging()"
            [class.border-emerald-500]="selectedFile() && !isProcessingFile()"
            [class.bg-emerald-50]="selectedFile() && !isProcessingFile()"
          >
            @if (filePreviewUrl() || selectedFile()) {
              <!-- File preview -->
              <div class="flex flex-col items-center gap-3 w-full">
                @if (isProcessingFile()) {
                  <app-icon
                    name="loader-2"
                    [size]="32"
                    class="text-primary-600"
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
                  <div class="p-4 bg-primary-50 rounded-lg">
                    <app-icon
                      name="file-text"
                      [size]="48"
                      class="text-primary-600"
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
                  <div class="flex items-center gap-2 text-emerald-600">
                    <app-icon name="check-circle" [size]="16"></app-icon>
                    <span class="text-xs font-medium">Archivo listo</span>
                  </div>
                }
                <button
                  type="button"
                  class="text-xs text-primary-600 hover:underline font-medium"
                  (click)="removeFile(); $event.stopPropagation()"
                >
                  Cambiar archivo
                </button>
              </div>
            } @else {
              <!-- Empty state -->
              <div
                class="p-3 bg-primary-50 rounded-full mb-3 group-hover:scale-110 transition-transform"
              >
                <app-icon
                  name="scan-line"
                  [size]="32"
                  class="text-primary-600"
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
            <p class="text-sm text-red-600">{{ fileError() }}</p>
          }
        </div>
      }

      <!-- Step 2: AI Analyzing (holographic) -->
      @if (currentStep() === 2) {
        <div
          class="ai-stage is-analyzing relative overflow-hidden rounded-2xl border border-border min-h-[320px] flex flex-col items-center justify-center gap-4 p-6"
        >
          <!-- Holographic background layers -->
          <div class="ai-holo-aurora"></div>
          <div class="ai-holo-grid"></div>
          <div class="ai-stage__halo"></div>
          <div class="ai-stage__scan"></div>
          <div class="ai-stage__shimmer"></div>
          <span class="ai-sparkle ai-sparkle--a"></span>
          <span class="ai-sparkle ai-sparkle--b"></span>
          <span class="ai-sparkle ai-sparkle--c"></span>
          <span class="ai-sparkle ai-sparkle--d"></span>
          <span class="ai-sparkle ai-sparkle--e"></span>

          <!-- Foreground content -->
          <div class="ai-stage__icon">
            <app-icon name="sparkles" [size]="32"></app-icon>
          </div>
          <p class="ai-stage__title relative z-10 text-base font-semibold text-text-primary">
            Analizando tu RUT con IA...
          </p>
          <p class="ai-stage__caption relative z-10 max-w-[280px] text-center text-sm">
            Extrayendo NIT, razón social, régimen y responsabilidades fiscales.
          </p>
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
                  <app-badge variant="info" size="xsm">{{ resp }}</app-badge>
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
              class="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3"
            >
              <app-icon
                name="info"
                [size]="16"
                class="text-amber-600 mt-0.5"
              ></app-icon>
              <p class="text-xs text-amber-800">
                {{ result()!.extraction_notes }}
              </p>
            </div>
          }
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
  styles: [
    `
      .ai-stage.is-analyzing {
        isolation: isolate;
        background:
          radial-gradient(
            circle at 50% 50%,
            color-mix(in oklab, var(--color-primary) 10%, transparent),
            transparent 70%
          ),
          var(--color-surface-muted, #f8fafc);
        animation: ai-breathe 2.4s ease-in-out infinite;
      }

      .ai-stage__icon {
        position: relative;
        z-index: 6;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 72px;
        height: 72px;
        border-radius: 9999px;
        color: var(--color-primary);
        background: color-mix(in oklab, var(--color-primary) 12%, transparent);
        box-shadow:
          0 0 0 1px color-mix(in oklab, var(--color-primary) 25%, transparent),
          0 0 30px color-mix(in oklab, var(--color-primary) 35%, transparent);
        animation: ai-icon-breathe 3s ease-in-out infinite;
      }

      .ai-stage__caption {
        position: relative;
        z-index: 6;
        color: var(--color-text-secondary, #64748b);
        animation: ai-soft-pulse 2.4s ease-in-out infinite;
      }

      .ai-stage__halo {
        position: absolute;
        inset: 50% auto auto 50%;
        width: 280px;
        height: 280px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: conic-gradient(
          from 0deg,
          color-mix(in oklab, var(--color-primary) 35%, transparent),
          color-mix(in oklab, var(--color-info, #6366f1) 25%, transparent),
          color-mix(in oklab, var(--color-success, #10b981) 25%, transparent),
          color-mix(in oklab, var(--color-primary) 35%, transparent)
        );
        filter: blur(40px);
        opacity: 0.45;
        z-index: 0;
        animation: ai-halo-spin 6s linear infinite;
      }

      .ai-stage__shimmer,
      .ai-stage__scan {
        position: absolute;
        pointer-events: none;
      }

      .ai-stage__shimmer {
        inset: 0;
        z-index: 3;
        background: linear-gradient(
          110deg,
          transparent 30%,
          color-mix(in oklab, white 30%, transparent) 50%,
          transparent 70%
        );
        background-size: 200% 100%;
        background-position: 200% 0;
        animation: ai-shimmer-sweep 2.4s ease-in-out infinite;
        mix-blend-mode: overlay;
      }

      .ai-stage__scan {
        left: 0;
        right: 0;
        top: 0;
        height: 2px;
        z-index: 4;
        background: linear-gradient(
          90deg,
          transparent,
          color-mix(in oklab, var(--color-primary) 75%, transparent),
          transparent
        );
        box-shadow: 0 0 14px
          color-mix(in oklab, var(--color-primary) 55%, transparent);
        animation: ai-scan-vertical 2.6s ease-in-out infinite;
      }

      .ai-holo-grid {
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image:
          linear-gradient(
            color-mix(in oklab, var(--color-primary) 18%, transparent) 1px,
            transparent 1px
          ),
          linear-gradient(
            90deg,
            color-mix(in oklab, var(--color-primary) 18%, transparent) 1px,
            transparent 1px
          );
        background-size: 36px 36px;
        background-position: 0 0;
        mask-image: radial-gradient(
          circle at 50% 50%,
          rgba(0, 0, 0, 0.9),
          rgba(0, 0, 0, 0) 70%
        );
        opacity: 0.55;
        animation: ai-holo-grid-drift 8s linear infinite;
      }

      .ai-holo-aurora {
        position: absolute;
        inset: -20%;
        z-index: 0;
        background:
          radial-gradient(
            circle at 30% 30%,
            color-mix(in oklab, var(--color-info, #6366f1) 45%, transparent),
            transparent 55%
          ),
          radial-gradient(
            circle at 70% 60%,
            color-mix(in oklab, var(--color-primary) 40%, transparent),
            transparent 55%
          ),
          radial-gradient(
            circle at 50% 80%,
            color-mix(in oklab, var(--color-success, #10b981) 30%, transparent),
            transparent 55%
          );
        filter: blur(48px);
        opacity: 0.5;
        animation: ai-holo-aurora-shift 9s ease-in-out infinite;
      }

      .ai-sparkle {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: color-mix(in oklab, var(--color-primary) 80%, white);
        box-shadow: 0 0 12px
          color-mix(in oklab, var(--color-primary) 80%, transparent);
        opacity: 0;
        z-index: 2;
      }

      .ai-sparkle--a {
        top: 18%;
        left: 22%;
        animation: ai-sparkle-twinkle 3s ease-in-out infinite;
      }
      .ai-sparkle--b {
        top: 32%;
        right: 18%;
        animation: ai-sparkle-twinkle 3.5s ease-in-out 0.4s infinite;
      }
      .ai-sparkle--c {
        bottom: 24%;
        left: 30%;
        animation: ai-sparkle-twinkle 4s ease-in-out 0.8s infinite;
      }
      .ai-sparkle--d {
        bottom: 18%;
        right: 28%;
        animation: ai-sparkle-twinkle 3.2s ease-in-out 1.2s infinite;
      }
      .ai-sparkle--e {
        top: 50%;
        left: 12%;
        animation: ai-sparkle-twinkle 3.8s ease-in-out 1.6s infinite;
      }

      @keyframes ai-breathe {
        0%,
        100% {
          box-shadow:
            inset 0 0 38px rgba(var(--color-primary-rgb), 0.09),
            0 0 0 rgba(var(--color-primary-rgb), 0);
        }
        50% {
          box-shadow:
            inset 0 0 48px rgba(var(--color-primary-rgb), 0.16),
            0 18px 48px rgba(var(--color-primary-rgb), 0.18);
        }
      }

      @keyframes ai-soft-pulse {
        0%,
        100% {
          opacity: 0.82;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.05);
        }
      }

      @keyframes ai-icon-breathe {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.08);
        }
      }

      @keyframes ai-halo-spin {
        from {
          transform: translate(-50%, -50%) rotate(0deg);
        }
        to {
          transform: translate(-50%, -50%) rotate(360deg);
        }
      }

      @keyframes ai-shimmer-sweep {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      @keyframes ai-scan-vertical {
        0% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(300px);
        }
        100% {
          transform: translateY(0);
        }
      }

      @keyframes ai-sparkle-twinkle {
        0%,
        100% {
          opacity: 0;
          transform: scale(0.6);
        }
        50% {
          opacity: 1;
          transform: scale(1.2);
        }
      }

      @keyframes ai-holo-grid-drift {
        0% {
          background-position: 0 0;
        }
        100% {
          background-position: 36px 36px;
        }
      }

      @keyframes ai-holo-aurora-shift {
        0%,
        100% {
          transform: translate(0, 0) scale(1);
        }
        50% {
          transform: translate(2%, -2%) scale(1.05);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ai-stage.is-analyzing,
        .ai-stage__caption,
        .ai-stage__icon,
        .ai-stage__halo,
        .ai-stage__shimmer,
        .ai-stage__scan,
        .ai-holo-grid,
        .ai-holo-aurora,
        .ai-sparkle {
          animation: none !important;
        }
      }
    `,
  ],
})
export class RutScannerModalComponent {
  private readonly rutScannerService = inject(RutScannerService);
  private readonly toastService = inject(ToastService);
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
  readonly selectedFile = signal<File | null>(null);
  readonly filePreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly isScanning = signal(false);
  readonly isProcessingFile = signal(false);
  readonly result = signal<RutScanResult | null>(null);

  readonly isImageFile = computed(() => {
    const file = this.selectedFile();
    return file?.type?.startsWith('image/') ?? false;
  });

  readonly confidencePercent = computed(() => {
    const value = this.result()?.confidence ?? 0;
    return Math.round(Math.min(Math.max(value, 0), 1) * 100);
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
    this.isScanning.set(true);

    this.rutScannerService
      .scanRut(file, this.scope())
      .pipe(
        catchError((err: unknown) => {
          this.toastService.error(
            this.extractErrorMessage(err),
          );
          this.currentStep.set(1);
          this.isScanning.set(false);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.isScanning.set(false);
        if (!response) return;

        if (response.success && response.data) {
          this.result.set(response.data);
          this.currentStep.set(3);
        } else {
          this.toastService.error(
            response.message || 'No se pudieron extraer los datos del RUT.',
          );
          this.currentStep.set(1);
        }
      });
  }

  private extractErrorMessage(err: unknown): string {
    const fallback = 'No se pudo analizar el RUT. Inténtalo de nuevo.';
    if (err && typeof err === 'object') {
      const e = err as {
        error?: { message?: string };
        message?: string;
      };
      return e.error?.message || e.message || fallback;
    }
    return fallback;
  }

  // ============================================================
  // Confirm
  // ============================================================

  onConfirm(): void {
    const data = this.result();
    if (!data) return;

    this.confirmed.emit(data);
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
    this.isScanning.set(false);
    this.result.set(null);
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.isOpenChange.emit(false);
  }
}
