import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { AiReviewAckComponent } from '../ai-review-ack/ai-review-ack.component';
import { BadgeComponent, BadgeVariant } from '../badge/badge.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { ModalComponent } from '../modal/modal.component';
import { StepsLineComponent } from '../steps-line/steps-line.component';
import { ToastService } from '../toast/toast.service';

import {
  DianHabilitationScanResult,
  HABILITATION_SCAN_FIELD_LABELS,
  HABILITATION_SCAN_SECTIONS,
  HabilitationScanField,
  HabilitationScanFieldKey,
  HabilitationScannerScope,
  SCANNED_ENVIRONMENT_LABELS,
} from './interfaces/habilitation-scan-result.interface';
import {
  HabilitationScannerService,
  MAX_HABILITATION_SCAN_FILES,
} from './services/habilitation-scanner.service';

type ScannerStep = 1 | 2 | 3;

/** Un archivo elegido, con su vista previa ya resuelta. */
interface PickedFile {
  file: File;
  previewUrl: string | null;
}

/** Veredicto por campo, ya traducido a algo que se puede pintar. */
interface ReviewRow {
  key: HabilitationScanFieldKey;
  label: string;
  display: string;
  badgeLabel: string;
  badgeVariant: BadgeVariant;
  warning: string | null;
  missing: boolean;
}

interface ReviewSection {
  title: string;
  rows: ReviewRow[];
}

/**
 * Escáner IA de la habilitación DIAN (software + set de pruebas + resolución de
 * pruebas).
 *
 * Tres pasos: subir → analizar → **revisar campo por campo**. Acepta hasta
 * {@link MAX_HABILITATION_SCAN_FILES} documentos en un solo escaneo porque los
 * datos del formulario viven repartidos entre dos pantallas distintas del
 * portal DIAN: la del software (SoftwareID, PIN, TestSetId) y la de la
 * resolución de pruebas (prefijo SETP, rango, clave técnica).
 *
 * La clave técnica y el PIN aparecen SIEMPRE como "confírmalo", incluso leídos
 * perfectos: alimentan el CUFE y el CUDE, y un solo carácter mal leído produce
 * documentos que la DIAN rechaza uno por uno sin decir por qué.
 *
 * Guardar no ocurre aquí: `confirmed` entrega el resultado y el padre decide
 * qué precarga.
 */
@Component({
  selector: 'app-dian-habilitation-scanner-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    StepsLineComponent,
    AiReviewAckComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      size="lg"
      title="Escanear habilitación DIAN con IA"
      subtitle="Sube el set de pruebas y la IA llenará software, PIN, set de pruebas y resolución"
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
              [disabled]="isFull()"
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
            class="group relative border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[160px]"
            [class.border-primary]="isDragging()"
            [class.border-border]="!isDragging() && files().length === 0"
            [class.hover:border-primary]="!isDragging()"
            [class.border-success]="files().length > 0"
            [class.bg-success-light]="files().length > 0"
            [class.opacity-60]="isFull()"
          >
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
              @if (isFull()) {
                Máximo {{ maxFiles }} documentos
              } @else if (files().length > 0) {
                Agrega otro documento
              } @else {
                Arrastra aquí el set de pruebas
              }
            </p>
            <p class="text-xs text-text-secondary text-center">
              JPG, PNG, WebP o PDF — máx 10MB cada uno, hasta
              {{ maxFiles }} documentos
            </p>
          </div>

          <!-- Documentos elegidos -->
          @if (files().length > 0) {
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              @for (picked of files(); track picked.file.name + picked.file.size; let i = $index) {
                <div
                  class="relative rounded-lg border border-border p-3 flex flex-col items-center gap-2"
                >
                  @if (picked.previewUrl) {
                    <img
                      [src]="picked.previewUrl"
                      [alt]="'Vista previa de ' + picked.file.name"
                      class="max-h-24 w-full rounded object-contain"
                    />
                  } @else {
                    <div class="p-3 bg-[var(--color-primary-light)] rounded-lg">
                      <app-icon
                        name="file-text"
                        [size]="28"
                        class="text-[var(--color-primary)]"
                      ></app-icon>
                    </div>
                  }
                  <p
                    class="text-xs font-medium text-text-primary truncate w-full text-center"
                    [title]="picked.file.name"
                  >
                    {{ picked.file.name }}
                  </p>
                  <p class="text-[11px] text-text-secondary">
                    {{ formatFileSize(picked.file.size) }}
                  </p>
                  <button
                    type="button"
                    class="text-xs text-[var(--color-primary)] hover:underline font-medium"
                    (click)="removeFile(i)"
                  >
                    Quitar
                  </button>
                </div>
              }
            </div>
          }

          <input
            type="file"
            class="hidden"
            multiple
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
              Sube la pantalla del software (SoftwareID, PIN y set de pruebas) y,
              si la tienes, la resolución de pruebas: la IA las lee juntas. Nada
              se guarda hasta que revises los campos y pulses Guardar en el
              formulario.
            </p>
          </div>
        </div>
      }

      <!-- Paso 2: analizando -->
      @if (currentStep() === 2) {
        <div
          class="scan-stage relative overflow-hidden rounded-2xl border border-border min-h-[280px] flex flex-col items-center justify-center gap-4 p-6"
        >
          <div class="scan-stage__line"></div>
          <div class="scan-stage__icon">
            <app-icon name="sparkles" [size]="32"></app-icon>
          </div>
          <p class="relative z-10 text-base font-semibold text-text-primary">
            Leyendo la habilitación...
          </p>
          <p
            class="relative z-10 max-w-[320px] text-center text-sm text-text-secondary"
          >
            Extrayendo Software ID, PIN, Test Set ID, NIT y la resolución de
            pruebas.
          </p>
        </div>
      }

      <!-- Paso 3: revisar -->
      @if (currentStep() === 3 && result()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-text-primary">
              Datos extraídos
              <span class="text-xs font-normal text-text-secondary">
                ({{ result()!.documents_scanned }}
                {{ result()!.documents_scanned === 1 ? 'documento' : 'documentos' }})
              </span>
            </h4>
            <app-badge [variant]="overallVariant()" size="sm">
              <span class="inline-flex items-center gap-1">
                <app-icon name="sparkles" [size]="12"></app-icon>
                Legibilidad {{ result()!.confidence }}%
              </span>
            </app-badge>
          </div>

          @if (missingLabels().length > 0) {
            <div class="rounded-lg border border-border bg-surface-secondary p-3">
              <div class="flex items-center gap-2 mb-1">
                <app-icon
                  name="info"
                  [size]="16"
                  class="text-text-secondary"
                ></app-icon>
                <p class="text-xs font-semibold text-text-primary">
                  Estos campos no venían en los documentos
                </p>
              </div>
              <p class="text-xs text-text-secondary">
                {{ missingLabels().join(', ') }}. Los tendrás que escribir a
                mano; el resto se precarga.
              </p>
            </div>
          }

          @for (section of reviewSections(); track section.title) {
            <div class="space-y-2">
              <p class="text-xs font-semibold text-text-secondary uppercase">
                {{ section.title }}
              </p>
              <div class="rounded-lg border border-border divide-y divide-border">
                @for (row of section.rows; track row.key) {
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
            </div>
          }

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
            entityLabel="datos de la habilitación DIAN"
          ></app-ai-review-ack>
        </div>
      }

      <div slot="footer" class="flex justify-between gap-3">
        <div>
          @if (currentStep() === 3) {
            <app-button variant="outline" (clicked)="resetWizard()">
              Escanear otros
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
              [disabled]="files().length === 0"
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
  styles: [
    `
      .scan-stage {
        background:
          radial-gradient(
            circle at 50% 50%,
            color-mix(in oklab, var(--color-primary) 10%, transparent),
            transparent 70%
          ),
          var(--color-surface-secondary);
      }

      .scan-stage__icon {
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
        animation: scan-icon-breathe 3s ease-in-out infinite;
      }

      .scan-stage__line {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 2px;
        z-index: 4;
        pointer-events: none;
        background: linear-gradient(
          90deg,
          transparent,
          color-mix(in oklab, var(--color-primary) 75%, transparent),
          transparent
        );
        box-shadow: 0 0 14px
          color-mix(in oklab, var(--color-primary) 55%, transparent);
        animation: scan-line-sweep 2.6s ease-in-out infinite;
      }

      @keyframes scan-icon-breathe {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.08);
        }
      }

      @keyframes scan-line-sweep {
        0% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(260px);
        }
        100% {
          transform: translateY(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .scan-stage__icon,
        .scan-stage__line {
          animation: none !important;
        }
      }
    `,
  ],
})
export class DianHabilitationScannerModalComponent {
  private readonly scanner = inject(HabilitationScannerService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  /**
   * Obligatorio: el asistente corre bajo `store` o bajo `organization` según el
   * app type, y deducirlo dentro del componente es lo que hizo que el escáner
   * de RUT respondiera 404 en un scope.
   */
  readonly scope = input.required<HabilitationScannerScope>();

  readonly isOpenChange = output<boolean>();
  readonly confirmed = output<DianHabilitationScanResult>();

  readonly currentStep = signal<ScannerStep>(1);
  readonly files = signal<PickedFile[]>([]);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly isScanning = signal(false);
  readonly result = signal<DianHabilitationScanResult | null>(null);

  /** Verificación obligatoria de lo que precargó la IA. */
  readonly aiAck = signal(false);
  private readonly ackBlock = viewChild<AiReviewAckComponent>('ackBlock');

  readonly maxFiles = MAX_HABILITATION_SCAN_FILES;
  readonly wizardSteps = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
  ];

  readonly isFull = computed(() => this.files().length >= this.maxFiles);

  readonly overallVariant = computed<BadgeVariant>(() => {
    const pct = this.result()?.confidence ?? 0;
    if (pct >= 80) return 'success';
    if (pct >= 50) return 'warning';
    return 'error';
  });

  /**
   * Un renglón por campo, agrupado igual que las secciones del formulario. Se
   * arma en un `computed` y no en la plantilla porque el estado de un campo
   * depende de tres cosas (valor, `verified`, confianza) y repetir esa lógica
   * en el template la haría divergir del backend.
   */
  readonly reviewSections = computed<ReviewSection[]>(() => {
    const data = this.result();
    if (!data) return [];

    return HABILITATION_SCAN_SECTIONS.map((section) => ({
      title: section.title,
      rows: section.keys.map((key) => {
        const field = data[key] as HabilitationScanField<unknown>;
        const missing = field.value === null;
        const needsConfirmation =
          data.requires_manual_confirmation.includes(key);

        return {
          key,
          label: HABILITATION_SCAN_FIELD_LABELS[key],
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
      }),
    }));
  });

  /** Etiquetas de lo que ningún documento traía, para el aviso del paso 3. */
  readonly missingLabels = computed(() => {
    const data = this.result();
    if (!data) return [];
    return data.missing_fields
      .map(
        (key) =>
          HABILITATION_SCAN_FIELD_LABELS[key as HabilitationScanFieldKey] ??
          key,
      )
      .filter(Boolean);
  });

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;
  private readonly VALID_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  // ============================================================
  // Archivos
  // ============================================================

  triggerFileInput(): void {
    if (this.isFull()) return;
    const input = document.querySelector(
      'app-dian-habilitation-scanner-modal input[type="file"]:not([capture])',
    ) as HTMLInputElement | null;
    input?.click();
  }

  triggerCamera(): void {
    if (this.isFull()) return;
    const input = document.querySelector(
      'app-dian-habilitation-scanner-modal input[capture]',
    ) as HTMLInputElement | null;
    input?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input?.files ?? []);
    this.addFiles(picked);
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
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  removeFile(index: number): void {
    this.files.update((current) => current.filter((_, i) => i !== index));
    this.fileError.set(null);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  /**
   * Agrega lo que se pueda y dice qué quedó fuera.
   *
   * Aceptar en silencio solo los primeros y descartar el resto es lo que hace
   * que el usuario crea que subió la resolución y luego no entienda por qué la
   * clave técnica llegó vacía.
   */
  private addFiles(incoming: File[]): void {
    if (incoming.length === 0) return;
    this.fileError.set(null);

    const problems: string[] = [];
    const accepted: PickedFile[] = [];
    let room = this.maxFiles - this.files().length;

    for (const file of incoming) {
      if (room <= 0) {
        problems.push(`${file.name}: máximo ${this.maxFiles} documentos.`);
        continue;
      }
      if (!this.VALID_TYPES.includes(file.type)) {
        problems.push(`${file.name}: formato no soportado.`);
        continue;
      }
      if (file.size > this.MAX_FILE_SIZE) {
        problems.push(`${file.name}: excede 10MB.`);
        continue;
      }
      accepted.push({ file, previewUrl: null });
      room--;
    }

    if (accepted.length > 0) {
      this.files.update((current) => [...current, ...accepted]);
      for (const picked of accepted) {
        this.loadPreview(picked);
      }
    }
    if (problems.length > 0) {
      this.fileError.set(problems.join(' '));
    }
  }

  /**
   * La vista previa se resuelve por archivo y se escribe de vuelta en la señal
   * buscando por identidad del `File`: el índice puede haber cambiado si el
   * usuario quitó otro documento mientras el `FileReader` iba a mitad.
   */
  private loadPreview(picked: PickedFile): void {
    if (!picked.file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      this.files.update((current) =>
        current.map((item) =>
          item.file === picked.file ? { ...item, previewUrl: url } : item,
        ),
      );
    };
    reader.readAsDataURL(picked.file);
  }

  // ============================================================
  // Escaneo
  // ============================================================

  startScan(): void {
    const picked = this.files();
    if (picked.length === 0) return;

    this.currentStep.set(2);
    this.isScanning.set(true);

    this.scanner
      .scanHabilitation(
        picked.map((item) => item.file),
        this.scope(),
      )
      .pipe(
        catchError((err: unknown) => {
          this.toast.error(this.extractErrorMessage(err));
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
          this.toast.error(
            response.message ||
              'No se pudieron extraer los datos de la habilitación.',
          );
          this.currentStep.set(1);
        }
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
    this.files.set([]);
    this.fileError.set(null);
    this.isScanning.set(false);
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

  private displayValue(key: HabilitationScanFieldKey, value: unknown): string {
    if (key === 'environment') {
      return SCANNED_ENVIRONMENT_LABELS[String(value)] ?? String(value);
    }
    if (key === 'resolution_range_from' || key === 'resolution_range_to') {
      return Number(value).toLocaleString('es-CO');
    }
    return String(value);
  }

  private extractErrorMessage(err: unknown): string {
    const fallback = 'No se pudo analizar la habilitación. Inténtalo de nuevo.';
    if (err && typeof err === 'object') {
      const e = err as { error?: { message?: string }; message?: string };
      return e.error?.message || e.message || fallback;
    }
    return fallback;
  }
}
