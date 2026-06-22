import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { of, switchMap, catchError } from 'rxjs';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { StepsLineComponent } from '../../../../../../shared/components/steps-line/steps-line.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import {
  ConfirmRouteSheetDto,
  ConfirmRouteSheetResult,
  ConfirmRouteSheetStopDto,
  DispatchRoute,
  RouteSheetMatchResult,
  RouteSheetMatchedStop,
  RouteSheetScanResult,
} from '../../interfaces/planilla.interface';

/** Stop statuses that are already settled/terminal and cannot be re-settled. */
const TERMINAL_STOP_STATUSES = ['delivered', 'partial', 'rejected', 'released'];

/**
 * Editable per-stop review row. Built from each `RouteSheetMatchedStop`:
 * the human confirms `delivered` / `collected_amount` / `payment_method` /
 * `notes` before anything is persisted ("proponer y revisar").
 */
interface EditableStopDecision {
  /** Resolved real stop id; null rows cannot be confirmed (skipped). */
  stop_id: number | null;
  stop_sequence: number | null;
  remision_number: string | null;
  match_method: RouteSheetMatchedStop['match_method'];
  /** Net amount expected for this stop (from `current.grand_total`). */
  net_total: number;
  current_collected: number;
  /**
   * Current persisted status of the resolved stop (from `current.status`).
   * When this is terminal (delivered/partial/rejected/released) the row is
   * already settled: it is excluded from the confirm payload and rendered as
   * "ya liquidada (conciliada)" instead of being editable.
   */
  current_status: string | null;
  already_settled: boolean;
  // Editable fields
  delivered: boolean;
  collected_amount: number;
  payment_method: string;
  notes: string;
}

@Component({
  selector: 'app-route-sheet-scanner-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    SpinnerComponent,
    IconComponent,
    InputComponent,
    StepsLineComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      size="xl"
      title="Cargar planilla escaneada"
      subtitle="Escanea la planilla física para liquidar la ruta"
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
            [class.hover:border-primary-400]="!isDragging()"
            [class.hover:bg-muted/30]="!isDragging()"
            [class.border-emerald-500]="selectedFile() && !isProcessingFile()"
            [class.bg-emerald-50]="selectedFile() && !isProcessingFile()"
          >
            @if (filePreviewUrl() || selectedFile()) {
              <div class="flex flex-col items-center gap-3 w-full">
                @if (isProcessingFile()) {
                  <app-spinner size="md" text="Cargando archivo..."></app-spinner>
                } @else if (isImageFile()) {
                  <img
                    [src]="filePreviewUrl()"
                    alt="Vista previa"
                    class="max-h-40 rounded-lg border border-border object-contain"
                  />
                } @else {
                  <div class="p-4 bg-primary-50 rounded-lg">
                    <app-icon name="file-text" [size]="48" class="text-primary-600"></app-icon>
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
              <div class="p-3 bg-primary-50 rounded-full mb-3 group-hover:scale-110 transition-transform">
                <app-icon name="scan-line" [size]="32" class="text-primary-600"></app-icon>
              </div>
              <p class="text-sm font-semibold text-text-primary mb-1">
                Arrastra tu planilla aquí
              </p>
              <p class="text-xs text-text-secondary">
                JPG, PNG, WebP o PDF - Máx 10MB
              </p>
            }
          </div>

          <!-- Hidden file inputs -->
          <input
            #fileInput
            type="file"
            class="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            (change)="onFileSelected($event)"
          />
          <input
            #cameraInput
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

      <!-- Step 2: Processing -->
      @if (currentStep() === 2) {
        <div class="flex flex-col lg:flex-row gap-6 min-h-[300px]">
          @if (filePreviewUrl() && isImageFile()) {
            <div class="lg:w-1/3 flex-shrink-0">
              <img
                [src]="filePreviewUrl()"
                alt="Planilla"
                class="w-full max-h-64 lg:max-h-80 object-contain rounded-lg border border-border"
              />
            </div>
          } @else if (selectedFile()) {
            <div class="lg:w-1/3 flex-shrink-0 flex items-center justify-center p-8 bg-muted/30 rounded-lg border border-border">
              <div class="flex flex-col items-center gap-3">
                <app-icon name="file-text" [size]="64" class="text-primary-600"></app-icon>
                <p class="text-sm font-medium text-text-primary text-center">
                  {{ selectedFile()!.name }}
                </p>
              </div>
            </div>
          }

          <div class="flex-1 flex flex-col items-center justify-center gap-4">
            <app-spinner size="lg" text="Analizando planilla..."></app-spinner>
            <p class="text-sm text-text-secondary text-center">
              Extrayendo recaudos y buscando coincidencias con las paradas de la ruta...
            </p>
          </div>
        </div>
      }

      <!-- Step 3: Review & Confirm -->
      @if (currentStep() === 3 && matchResult()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <!-- Confidence summary -->
          <div class="bg-muted/30 rounded-lg p-4 border border-border flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <app-icon name="scan-line" [size]="18" class="text-primary-600"></app-icon>
              <span class="text-sm font-semibold text-text-primary">
                Confianza del escaneo
              </span>
            </div>
            <app-badge [variant]="confidenceVariant(matchResult()!.confidence)" size="sm">
              {{ matchResult()!.confidence }}%
            </app-badge>
          </div>

          <!-- Warnings -->
          @if (matchResult()!.warnings.length > 0) {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p class="text-xs font-semibold text-amber-800 mb-1">Advertencias</p>
              @for (warn of matchResult()!.warnings; track warn) {
                <p class="text-xs text-amber-700">{{ warn }}</p>
              }
            </div>
          }

          <!-- Stops review -->
          <div>
            <h4 class="text-sm font-semibold text-text-primary mb-3">
              Paradas ({{ confirmableCount() }} de {{ editableStops().length }} liquidables)
              @if (alreadySettledCount() > 0) {
                <span class="text-xs font-normal text-text-secondary">
                  · {{ alreadySettledCount() }} ya liquidada(s) (conciliada)
                </span>
              }
            </h4>

            <div class="space-y-3">
              @for (stop of editableStops(); track $index; let i = $index) {
                <div
                  class="rounded-lg border p-3 space-y-3"
                  [class.border-border]="stop.stop_id !== null && !stop.already_settled"
                  [class.bg-surface]="stop.stop_id !== null && !stop.already_settled"
                  [class.border-red-200]="stop.stop_id === null"
                  [class.bg-red-50]="stop.stop_id === null"
                  [class.border-emerald-200]="stop.already_settled"
                  [class.bg-emerald-50]="stop.already_settled"
                >
                  <!-- Header row -->
                  <div class="flex items-start justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                        #{{ stop.stop_sequence ?? stop.remision_number ?? '?' }}
                      </span>
                      @if (stop.remision_number) {
                        <span class="font-mono text-sm">{{ stop.remision_number }}</span>
                      }
                      <app-badge [variant]="matchMethodVariant(stop.match_method)" size="xsm">
                        {{ matchMethodLabel(stop.match_method) }}
                      </app-badge>
                      @if (stop.already_settled) {
                        <app-badge variant="success" size="xsm">
                          Ya liquidada (conciliada)
                        </app-badge>
                      }
                    </div>
                    @if (stop.net_total > 0) {
                      <span class="text-sm font-semibold text-text-primary">
                        {{ stop.net_total | currency }}
                      </span>
                    }
                  </div>

                  @if (stop.stop_id === null) {
                    <p class="text-xs text-red-700">
                      No se pudo emparejar esta fila con una parada real; se omitirá.
                    </p>
                  } @else if (stop.already_settled) {
                    <p class="text-xs text-emerald-700">
                      Esta parada ya está
                      <strong>{{ settledStatusLabel(stop.current_status) }}</strong
                      >; se conciliará automáticamente y no se volverá a liquidar.
                    </p>
                  } @else {
                    <!-- Editable fields -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <!-- Delivered toggle -->
                      <label class="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          [checked]="stop.delivered"
                          (change)="updateDelivered(i, $event)"
                          class="h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-600"
                        />
                        <span class="text-sm text-text-primary">Entregado (cobro total)</span>
                      </label>

                      <!-- Collected amount (currency input) -->
                      <app-input
                        label="Recaudado"
                        [currency]="true"
                        [ngModel]="stop.collected_amount"
                        (ngModelChange)="updateCollected(i, $event)"
                        [name]="'collected_' + i"
                      ></app-input>
                    </div>

                    @if (isUndercollected(stop)) {
                      <p class="text-xs text-red-700">
                        El monto recaudado no cubre el total
                        ({{ stop.net_total | currency }}). No se permiten pagos
                        parciales: cobra el total o desmarca "Entregado".
                      </p>
                    }

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <!-- Payment method selector -->
                      <div>
                        <label class="block text-xs font-medium text-text-secondary mb-1">
                          Método de pago
                        </label>
                        <select
                          class="w-full px-2 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:ring-1 focus:ring-primary-600 focus:border-primary-600"
                          [value]="stop.payment_method"
                          (change)="updatePaymentMethod(i, $event)"
                        >
                          @for (pm of paymentMethods; track pm.value) {
                            <option [value]="pm.value">{{ pm.label }}</option>
                          }
                        </select>
                      </div>

                      <!-- Notes -->
                      <app-input
                        label="Notas"
                        [ngModel]="stop.notes"
                        (ngModelChange)="updateNotes(i, $event)"
                        [name]="'notes_' + i"
                        placeholder="Opcional"
                      ></app-input>
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Totals -->
          <div class="bg-muted/30 rounded-lg p-4 border border-border">
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Total a recaudar (liquidable)</span>
              <span class="text-text-primary font-medium">
                {{ totalNet() | currency }}
              </span>
            </div>
            <div class="flex justify-between text-sm mt-2">
              <span class="text-text-primary font-semibold">Total recaudado (capturado)</span>
              <span class="text-text-primary font-bold text-base text-green-600">
                {{ totalCollected() | currency }}
              </span>
            </div>
          </div>
        </div>
      }

      <!-- Footer Actions -->
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
          @if (currentStep() === 1) {
            <app-button
              variant="primary"
              [disabled]="!selectedFile()"
              (clicked)="startScan()"
            >
              Analizar Planilla
            </app-button>
          }
          @if (currentStep() === 3) {
            <app-button
              variant="primary"
              [loading]="isConfirming()"
              [disabled]="!canConfirm() || isConfirming()"
              (clicked)="onConfirm()"
            >
              Confirmar y liquidar
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class RouteSheetScannerModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);

  // Inputs / outputs
  readonly routeId = input.required<number>();
  readonly isOpen = input(false);
  readonly route = input<DispatchRoute | null>(null);

  readonly closed = output<void>();
  /**
   * Emits the fully-updated route returned by `/scan/confirm` so the parent
   * can refresh the detail without a second round-trip to `GET :id`.
   */
  readonly confirmed = output<DispatchRoute>();

  /**
   * ViewChild refs for the hidden file inputs. Using `viewChild()` (zoneless
   * signal-based) instead of `document.querySelector` keeps the scanner
   * robust to multiple instances on the same page and aligns with the
   * `vendix-zoneless-signals` CORE rule.
   */
  readonly fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  readonly cameraInputRef = viewChild<ElementRef<HTMLInputElement>>('cameraInput');

  // Wizard state
  readonly currentStep = signal<1 | 2 | 3>(1);
  readonly selectedFile = signal<File | null>(null);
  readonly filePreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly isScanning = signal(false);
  readonly isProcessingFile = signal(false);
  readonly isConfirming = signal(false);

  readonly scanResult = signal<RouteSheetScanResult | null>(null);
  readonly matchResult = signal<RouteSheetMatchResult | null>(null);
  readonly editableStops = signal<EditableStopDecision[]>([]);

  readonly isImageFile = computed(() => {
    const file = this.selectedFile();
    return file?.type?.startsWith('image/') ?? false;
  });

  /**
   * Stops that can actually be confirmed: resolved to a real stop AND not
   * already settled. Already-settled stops are reconciled by the backend and
   * must NOT be re-sent in the confirm payload.
   */
  readonly confirmableCount = computed(
    () =>
      this.editableStops().filter(
        (s) => s.stop_id !== null && !s.already_settled,
      ).length,
  );

  /** Count of rows that are already settled (shown as "conciliada"). */
  readonly alreadySettledCount = computed(
    () => this.editableStops().filter((s) => s.already_settled).length,
  );

  readonly totalNet = computed(() =>
    this.editableStops()
      .filter((s) => s.stop_id !== null && !s.already_settled)
      .reduce((sum, s) => sum + (s.net_total || 0), 0),
  );

  readonly totalCollected = computed(() =>
    this.editableStops()
      .filter((s) => s.stop_id !== null && !s.already_settled)
      .reduce((sum, s) => sum + (s.collected_amount || 0), 0),
  );

  /**
   * True when at least one editable (non-settled) row is marked delivered but
   * its collected amount does not cover the net total. Blocks confirm to keep
   * the "pago total o no pago" rule (no partial payments).
   */
  readonly hasUndercollectedDelivery = computed(() =>
    this.editableStops().some(
      (s) =>
        s.stop_id !== null &&
        !s.already_settled &&
        s.delivered &&
        (s.net_total || 0) > 0 &&
        (s.collected_amount || 0) < (s.net_total || 0),
    ),
  );

  /** Per-row helper: a delivered row whose collected amount is below total. */
  isUndercollected(stop: EditableStopDecision): boolean {
    return (
      !stop.already_settled &&
      stop.delivered &&
      (stop.net_total || 0) > 0 &&
      (stop.collected_amount || 0) < (stop.net_total || 0)
    );
  }

  /** Confirm enabled only when there is something to settle and no under-collection. */
  readonly canConfirm = computed(
    () => this.confirmableCount() > 0 && !this.hasUndercollectedDelivery(),
  );

  readonly wizardSteps = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
  ];

  readonly paymentMethods: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'transfer', label: 'Transferencia' },
    { value: 'card', label: 'Tarjeta' },
  ];

  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  // ============================================================
  // File handling
  // ============================================================

  triggerFileInput(): void {
    this.fileInputRef()?.nativeElement.click();
  }

  triggerCamera(): void {
    this.cameraInputRef()?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) this.handleFile(file);
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

  private handleFile(file: File): void {
    this.fileError.set(null);

    const validTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!validTypes.includes(file.type)) {
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
  // Scanning (scan → match)
  // ============================================================

  startScan(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.currentStep.set(2);
    this.isScanning.set(true);

    this.service
      .scanSheet(this.routeId(), file)
      .pipe(
        switchMap((scan) => {
          this.scanResult.set(scan);
          return this.service.matchStops(this.routeId(), scan);
        }),
        catchError((err: any) => {
          // Distinguish the most common operator-facing failure: no AI provider
          // configured for the org. Show a clear, actionable message instead of
          // the raw error string.
          const code = err?.error?.error_code || err?.error_code;
          const msg =
            code === 'AI_PROVIDER_002'
              ? 'No hay un proveedor de IA configurado para tu organización. Pide al administrador que configure uno (OpenAI, Anthropic, etc.) antes de usar el escaneo de planillas.'
              : err?.message || 'Error al procesar la planilla';
          this.toast.error(msg);
          this.currentStep.set(1);
          this.isScanning.set(false);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((match) => {
        this.isScanning.set(false);
        if (!match) return;
        this.matchResult.set(match);
        this.editableStops.set(match.stops.map((s) => this.toEditable(s)));
        this.currentStep.set(3);
      });
  }

  /** Build an editable review row from a backend matched stop. */
  private toEditable(s: RouteSheetMatchedStop): EditableStopDecision {
    const ex = s.extracted;
    const currentStatus = s.current?.status ?? null;
    const alreadySettled =
      s.stop_id !== null &&
      currentStatus !== null &&
      TERMINAL_STOP_STATUSES.includes(currentStatus);
    return {
      stop_id: s.stop_id,
      stop_sequence: s.stop_sequence,
      remision_number: s.remision_number ?? ex.remision_number,
      match_method: s.match_method,
      net_total: s.current?.grand_total ?? 0,
      current_collected: s.current?.collected_amount ?? 0,
      current_status: currentStatus,
      already_settled: alreadySettled,
      delivered: ex.delivered,
      collected_amount: ex.collected_amount ?? 0,
      payment_method: ex.payment_method ?? 'cash',
      notes: ex.notes ?? '',
    };
  }

  /** Spanish label for a terminal stop status (shown in the conciliada chip). */
  settledStatusLabel(status: string | null): string {
    switch (status) {
      case 'delivered':
        return 'Entregada';
      case 'rejected':
        return 'Rechazada';
      case 'released':
        return 'Liberada';
      case 'partial':
        return 'Liquidada';
      default:
        return 'Liquidada';
    }
  }

  // ============================================================
  // Review step actions (humano siempre confirma antes de persistir)
  // ============================================================

  updateDelivered(index: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.patchStop(index, { delivered: checked });
  }

  updateCollected(index: number, value: number | null): void {
    const amount = value == null || value < 0 ? 0 : Number(value);
    this.patchStop(index, { collected_amount: amount });
  }

  updatePaymentMethod(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.patchStop(index, { payment_method: value });
  }

  updateNotes(index: number, value: string): void {
    this.patchStop(index, { notes: value });
  }

  private patchStop(index: number, patch: Partial<EditableStopDecision>): void {
    const stops = [...this.editableStops()];
    stops[index] = { ...stops[index], ...patch };
    this.editableStops.set(stops);
  }

  // ============================================================
  // Confirm
  // ============================================================

  onConfirm(): void {
    const file = this.selectedFile();
    const scan = this.scanResult();
    if (!file) return;

    // Guard: never submit an under-collected delivery (no partial payments).
    if (this.hasUndercollectedDelivery()) {
      this.toast.error(
        'Hay paradas marcadas como entregadas cuyo monto no cubre el total. Cobra el total o desmarca "Entregado": no se permiten pagos parciales.',
      );
      return;
    }

    // Only send resolved, NOT-yet-settled stops. Already-terminal stops are
    // reconciled by the backend (returned in `skipped`); re-sending them is
    // unnecessary and was the source of the previous 400.
    const stops: ConfirmRouteSheetStopDto[] = this.editableStops()
      .filter((s) => s.stop_id !== null && !s.already_settled)
      .map((s) => ({
        stop_id: s.stop_id as number,
        delivered: s.delivered,
        collected_amount: s.collected_amount,
        payment_method: s.payment_method || undefined,
        notes: s.notes || undefined,
      }));

    if (stops.length === 0) {
      this.toast.error(
        'No hay paradas pendientes de liquidar en el escaneo (todas ya están liquidadas).',
      );
      return;
    }

    const dto: ConfirmRouteSheetDto = {
      stops,
      scan_result: scan ?? undefined,
    };

    this.isConfirming.set(true);
    this.service
      .confirmScan(this.routeId(), file, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isConfirming.set(false);
          this.showConfirmSummary(res);
          // Hand the fully-updated route back to the parent so it can refresh
          // the detail without a second GET round-trip.
          this.confirmed.emit(res.route);
          this.closeAndReset();
        },
        error: (err: any) => {
          this.isConfirming.set(false);
          this.toast.error(this.mapConfirmError(err));
        },
      });
  }

  /**
   * Summarize the idempotent settle response: how many stops were settled,
   * how many were reconciled (already settled / not in route), and list any
   * per-stop errors so the operator can react instead of seeing a raw toast.
   */
  private showConfirmSummary(res: ConfirmRouteSheetResult): void {
    const settled = res.settled?.length ?? 0;
    const skipped = res.skipped?.length ?? 0;
    const errors = res.errors ?? [];

    const summary = `Liquidadas: ${settled} / Conciliadas: ${skipped} / Errores: ${errors.length}`;

    if (errors.length > 0) {
      const detail = errors
        .map((e) => `Parada #${e.stop_id}: ${e.message}`)
        .join('\n');
      // Keep the summary visible and surface the failing stops explicitly.
      this.toast.warning(`${summary}\n${detail}`);
    } else if (skipped > 0) {
      this.toast.success(`${summary} (paradas ya liquidadas conciliadas)`);
    } else {
      this.toast.success(summary);
    }
  }

  /**
   * Map known backend error codes to clear Spanish messages. In particular,
   * `DISPATCH_ROUTE_PARTIAL_DISABLED` is the 400 the backend returns if a
   * partial result ever reaches it — surface it instead of the raw string.
   */
  private mapConfirmError(err: any): string {
    const code = err?.error?.error_code || err?.error_code;
    if (code === 'DISPATCH_ROUTE_PARTIAL_DISABLED') {
      return 'No se permiten pagos parciales en una ruta: cada parada debe cobrarse completa o quedar como rechazada/liberada.';
    }
    return err?.message || 'Error al liquidar la planilla';
  }

  // ============================================================
  // Confidence / match badges
  // ============================================================

  confidenceVariant(confidence: number): 'success' | 'warning' | 'error' {
    if (confidence >= 80) return 'success';
    if (confidence >= 50) return 'warning';
    return 'error';
  }

  matchMethodLabel(method: RouteSheetMatchedStop['match_method']): string {
    switch (method) {
      case 'remision':
        return 'Por remisión';
      case 'sequence':
        return 'Por secuencia';
      default:
        return 'Sin emparejar';
    }
  }

  matchMethodVariant(
    method: RouteSheetMatchedStop['match_method'],
  ): 'success' | 'warning' | 'error' {
    switch (method) {
      case 'remision':
        return 'success';
      case 'sequence':
        return 'warning';
      default:
        return 'error';
    }
  }

  // ============================================================
  // Modal lifecycle
  // ============================================================

  onOpenChange(open: boolean): void {
    if (!open) this.closeAndReset();
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
    this.isConfirming.set(false);
    this.scanResult.set(null);
    this.matchResult.set(null);
    this.editableStops.set([]);
  }

  private closeAndReset(): void {
    this.resetWizard();
    this.closed.emit();
  }
}
