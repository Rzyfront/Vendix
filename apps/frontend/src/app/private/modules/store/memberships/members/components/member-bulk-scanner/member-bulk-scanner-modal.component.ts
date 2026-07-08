import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, of, switchMap, tap } from 'rxjs';

import {
  BadgeComponent,
  BadgeVariant,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SpinnerComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';

import { MemberBulkScannerService } from '../../services/member-bulk-scanner.service';
import {
  AnalyzedMember,
  AnalyzedMemberStatus,
  CommitMemberDto,
  CommitMemberRosterDto,
  CommitPlanDto,
  MemberRosterAnalysis,
  PlanCandidate,
  PlanMatch,
  RosterScanResult,
} from '../../interfaces/member-bulk-scanner.interface';
import { GymMembershipStatus } from '../../interfaces/membership.interface';

// ============================================================================
// Constants (file-scope: used in the template AND the template type checker
// can resolve module-level constants, unlike helper functions).
// ============================================================================

/**
 * Maximum upload size — mirrors the backend `MEMBER_SCAN_INVALID_FILE` guard.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ACCEPTED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

// ============================================================================
// Component
// ============================================================================

/**
 * Bulk-import wizard for member rosters.
 *
 * 3-step modal mirroring the Invoice Scanner pattern:
 *   1. Upload  — dropzone / camera capture (≤10 MB, image or PDF).
 *   2. Analyze — spinner while `scanRoster` + `analyzeRoster` run.
 *   3. Review  — editable plans + members grids; Confirmar emits the DTO.
 *
 * Outputs:
 *   - `(confirmed)` — emits a fully-validated `CommitMemberRosterDto` built
 *     from the user edits. Parent responsible for invoking
 *     `MemberBulkScannerService.commitRoster(...)`.
 *   - `(close)`     — modal closed/cancelled; parent toggles visibility.
 *
 * Inputs:
 *   - `[isOpen]`    — controls modal visibility (model-based, see
 *                     `vendix-frontend-modal`).
 */
@Component({
  selector: 'app-member-bulk-scanner-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    SpinnerComponent,
    StepsLineComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      size="xl"
      title="Carga masiva de socios"
      subtitle="Sube una planilla, foto o PDF y deja que la IA extraiga los miembros y planes."
    >
      <!-- Steps indicator -->
      <div class="mb-5">
        <app-steps-line
          [steps]="wizardSteps"
          [currentStep]="currentStep() - 1"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- ===================== STEP 1: Upload ===================== -->
      @if (currentStep() === 1) {
        <div class="space-y-4">
          <!-- Mobile camera shortcut -->
          <div class="sm:hidden">
            <button
              type="button"
              (click)="triggerCamera()"
              class="w-full flex items-center justify-center gap-3 p-4 bg-primary text-white rounded-xl shadow-md active:scale-[0.98]"
            >
              <app-icon name="camera" [size]="24"></app-icon>
              <span class="text-base font-semibold">Tomar foto</span>
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
            [class.bg-primary/5]="isDragging()"
            [class.border-border]="!isDragging() && !selectedFile()"
            [class.hover:border-primary/50]="!isDragging()"
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
                  <div class="p-4 bg-primary/10 rounded-lg">
                    <app-icon name="file-text" [size]="48" class="text-primary"></app-icon>
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
                  class="text-xs text-primary hover:underline font-medium"
                  (click)="removeFile(); $event.stopPropagation()"
                >
                  Cambiar archivo
                </button>
              </div>
            } @else {
              <div class="p-3 bg-primary/10 rounded-full mb-3 group-hover:scale-110 transition-transform">
                <app-icon name="scan-line" [size]="32" class="text-primary"></app-icon>
              </div>
              <p class="text-sm font-semibold text-text-primary mb-1">
                Arrastra la planilla o carnés aquí
              </p>
              <p class="text-xs text-text-secondary">
                JPG, PNG, WebP o PDF — máximo 10MB
              </p>
            }
          </div>

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

          <!-- Hint chip: what types of documents work best -->
          <div class="bg-muted/30 border border-border rounded-lg p-3">
            <div class="flex items-start gap-3">
              <app-icon name="info" [size]="16" class="text-text-secondary mt-0.5"></app-icon>
              <div class="text-xs text-text-secondary space-y-1">
                <p class="font-semibold text-text-primary">Tip:</p>
                <p>
                  Funciona mejor con planillas impresas, listados fotografiados,
                  contratos de adhesión firmados o carnés de membresía.
                </p>
                <p>
                  Solo se procesa la primera página de PDFs. Documentos
                  ilegibles pueden requerir carga manual.
                </p>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- ===================== STEP 2: Analyze ===================== -->
      @if (currentStep() === 2) {
        <div class="flex flex-col lg:flex-row gap-6 min-h-[300px]">
          @if (filePreviewUrl() && isImageFile()) {
            <div class="lg:w-1/3 flex-shrink-0">
              <img
                [src]="filePreviewUrl()"
                alt="Documento"
                class="w-full max-h-64 lg:max-h-80 object-contain rounded-lg border border-border"
              />
            </div>
          } @else if (selectedFile()) {
            <div class="lg:w-1/3 flex-shrink-0 flex items-center justify-center p-8 bg-muted/30 rounded-lg border border-border">
              <div class="flex flex-col items-center gap-3">
                <app-icon name="file-text" [size]="64" class="text-primary"></app-icon>
                <p class="text-sm font-medium text-text-primary text-center">
                  {{ selectedFile()!.name }}
                </p>
              </div>
            </div>
          }
          <div class="flex-1 flex flex-col items-center justify-center gap-4">
            <app-spinner size="lg" text="Analizando documento..."></app-spinner>
            <p class="text-sm text-text-secondary text-center max-w-sm">
              La IA extrae socios y planes, los cruza contra los existentes y
              clasifica cada fila como <strong>OK</strong>, <strong>Revisar</strong>
              o <strong>Error</strong>.
            </p>
          </div>
        </div>
      }

      <!-- ===================== STEP 3: Review ===================== -->
      @if (currentStep() === 3 && analysis()) {
        <div class="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <!-- Global banner: low confidence / top warnings -->
          @if (analysis()!.global_warnings.length > 0) {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              <p class="text-xs font-semibold text-amber-800 flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="14"></app-icon>
                Advertencias globales ({{ analysis()!.global_warnings.length }})
              </p>
              @for (warn of analysis()!.global_warnings; track warn) {
                <p class="text-xs text-amber-700">• {{ warn }}</p>
              }
            </div>
          }

          @if (scanResult()?.confidence != null && scanResult()!.confidence < 60) {
            <div class="bg-red-50 border border-red-200 rounded-lg p-3">
              <p class="text-xs font-semibold text-red-800">
                Confianza del OCR baja ({{ scanResult()!.confidence }}%).
                Revisa los datos con cuidado antes de confirmar.
              </p>
            </div>
          }

          <!-- Counters strip -->
          <div class="flex flex-wrap gap-2 text-xs">
            <app-badge variant="success" size="xsm">
              {{ analysis()!.ready_count }} listos
            </app-badge>
            <app-badge variant="warning" size="xsm">
              {{ analysis()!.with_warnings_count }} por revisar
            </app-badge>
            <app-badge variant="error" size="xsm">
              {{ analysis()!.with_errors_count }} con error
            </app-badge>
            <app-badge variant="neutral" size="xsm">
              {{ includedCount() }} de {{ editableMembers().length }} a crear
            </app-badge>
          </div>

          <!-- (a) Plans detected -->
          <section>
            <h4 class="text-sm font-semibold text-text-primary mb-2">
              Planes detectados ({{ analysis()!.plans.length }})
            </h4>
            <div class="space-y-3">
              @for (p of editablePlans(); track p.ref_index) {
                <app-card [responsive]="true">
                  <div class="space-y-3">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-text-primary truncate">
                          {{ p.matched_plan_name || ('Plan #' + p.ref_index) }}
                        </p>
                        @if (p.duration_days) {
                          <p class="text-xs text-text-secondary">
                            {{ p.duration_days }} días
                            @if (p.price != null) {
                              · {{ p.price | currency: 0 }}
                            }
                          </p>
                        }
                      </div>
                      <app-badge [variant]="badgeForPlanStatus(p.status)" size="xsm">
                        {{ p.status === 'existing' ? 'Existente' : (p.status === 'partial' ? 'Parcial' : 'Nuevo') }}
                      </app-badge>
                    </div>

                    @if (p.status === 'existing') {
                      <p class="text-xs text-text-secondary">
                        Se reutilizará el plan existente (id #{{ p.matched_plan_id }}).
                      </p>
                    } @else {
                      <!-- Edit fields for new/partial plans -->
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <app-input
                          label="Código"
                          [(ngModel)]="p.code"
                          [name]="'plan_code_' + p.ref_index"
                          placeholder="ej: MENSUAL-30"
                        ></app-input>
                        <app-input
                          label="Nombre"
                          [(ngModel)]="p.name"
                          [name]="'plan_name_' + p.ref_index"
                          placeholder="ej: Mensual Básico"
                        ></app-input>
                        <app-input
                          label="Precio"
                          type="number"
                          [(ngModel)]="p.price"
                          [name]="'plan_price_' + p.ref_index"
                          placeholder="0"
                          min="0"
                        ></app-input>
                        <app-input
                          label="Duración (días)"
                          type="number"
                          [(ngModel)]="p.duration_days"
                          [name]="'plan_dur_' + p.ref_index"
                          placeholder="30"
                          min="1"
                        ></app-input>
                      </div>

                      @if (p.candidates.length > 0) {
                        <div class="flex items-center gap-2">
                          <span class="text-xs text-text-secondary">¿Mapear a existente?</span>
                          <select
                            class="text-xs border border-border rounded px-2 py-1 bg-surface"
                            [ngModel]="p.matched_plan_id ?? ''"
                            (ngModelChange)="onPlanCandidateChange(p, $event)"
                            [name]="'plan_candidate_' + p.ref_index"
                          >
                            <option value="">— Crear nuevo —</option>
                            @for (c of p.candidates; track c.id) {
                              <option [value]="c.id">
                                #{{ c.id }} · {{ c.name }} ({{ c.duration_days }} d.)
                              </option>
                            }
                          </select>
                        </div>
                      }
                    }
                  </div>
                </app-card>
              }
            </div>
          </section>

          <!-- (b) Members detected — editable per-row cards -->
          <section>
            <h4 class="text-sm font-semibold text-text-primary mb-2">
              Socios detectados ({{ editableMembers().length }})
            </h4>

            @if (editableMembers().length === 0) {
              <div class="text-sm text-text-secondary p-4 border border-dashed border-border rounded-lg text-center">
                No se detectaron socios en el documento.
              </div>
            }

            <div class="space-y-3">
              @for (m of editableMembers(); track m.row_number) {
                <app-card [responsive]="true">
                  <div class="space-y-3" [class.opacity-50]="m.excluded">
                    <!-- Row header: name summary + status + exclude -->
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-text-primary truncate">
                          {{ memberName(m) }}
                        </p>
                        <p class="text-xs text-text-secondary truncate">
                          @if (m.document_number) {
                            {{ m.document_type || '?' }} {{ m.document_number }}
                          } @else {
                            Sin documento
                          }
                          @if (m.email) { · {{ m.email }} }
                        </p>
                      </div>
                      <div class="flex items-center gap-2 flex-shrink-0">
                        <app-badge
                          [variant]="m.status === 'ready' ? 'success' : (m.status === 'warning' ? 'warning' : 'error')"
                          size="xsm"
                        >
                          {{ m.status === 'ready' ? 'OK' : (m.status === 'warning' ? 'Revisar' : 'Error') }}
                        </app-badge>
                        <label class="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
                          <input
                            type="checkbox"
                            [checked]="m.excluded"
                            (change)="onMemberExcludeToggle(m, $any($event.target).checked)"
                          />
                          Excluir
                        </label>
                      </div>
                    </div>

                    @if (!m.excluded) {
                      <!-- Editable name -->
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <app-input
                          label="Nombres"
                          [ngModel]="m.first_name"
                          (ngModelChange)="updateMemberName(m, 'first_name', $event)"
                          [name]="'m_first_' + m.row_number"
                          placeholder="Nombres"
                        ></app-input>
                        <app-input
                          label="Apellidos"
                          [ngModel]="m.last_name"
                          (ngModelChange)="updateMemberName(m, 'last_name', $event)"
                          [name]="'m_last_' + m.row_number"
                          placeholder="Apellidos"
                        ></app-input>
                      </div>

                      <!-- Plan / status / dates -->
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label class="block text-xs font-medium text-text-secondary mb-1">Plan</label>
                          <select
                            class="w-full text-xs border border-border rounded px-2 py-2 bg-surface"
                            [ngModel]="m.plan_ref ?? ''"
                            (ngModelChange)="onMemberPlanRefChange(m, $event)"
                            [name]="'m_plan_' + m.row_number"
                          >
                            <option value="">— Sin plan —</option>
                            @for (p of editablePlans(); track p.ref_index) {
                              <option [value]="p.ref_index">
                                {{ p.name || p.matched_plan_name || ('Plan #' + p.ref_index) }}
                              </option>
                            }
                          </select>
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-text-secondary mb-1">Estado</label>
                          <select
                            class="w-full text-xs border border-border rounded px-2 py-2 bg-surface"
                            [ngModel]="m.resolved_status"
                            (ngModelChange)="onMemberStatusChange(m, $event)"
                            [name]="'m_status_' + m.row_number"
                          >
                            <option value="active">Activa</option>
                            <option value="expired">Vencida</option>
                            <option value="pending_payment">Pendiente de pago</option>
                          </select>
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-text-secondary mb-1">Inicio</label>
                          <input
                            type="date"
                            class="w-full text-xs border border-border rounded px-2 py-2 bg-surface"
                            [ngModel]="m.period_start"
                            (ngModelChange)="onMemberPeriodStartChange(m, $event)"
                            [name]="'m_start_' + m.row_number"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-text-secondary mb-1">Fin</label>
                          <input
                            type="date"
                            class="w-full text-xs border border-border rounded px-2 py-2 bg-surface"
                            [ngModel]="m.period_end"
                            (ngModelChange)="onMemberPeriodEndChange(m, $event)"
                            [name]="'m_end_' + m.row_number"
                          />
                        </div>
                      </div>

                      <!-- Per-row warnings / errors -->
                      @if (m.errors.length > 0 || m.warnings.length > 0) {
                        <div class="space-y-1">
                          @for (e of m.errors; track e) {
                            <p class="text-xs text-red-600">• {{ e }}</p>
                          }
                          @for (w of m.warnings; track w) {
                            <p class="text-xs text-amber-600">• {{ w }}</p>
                          }
                        </div>
                      }
                    }
                  </div>
                </app-card>
              }
            </div>
          </section>
        </div>
      }

      <!-- ===================== Footer ===================== -->
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
              Analizar documento
            </app-button>
          }
          @if (currentStep() === 3) {
            <app-button
              variant="primary"
              [disabled]="!canCommit()"
              (clicked)="onConfirm()"
            >
              Confirmar y crear
            </app-button>
          }
        </div>
      </div>
    </app-modal>

    <!-- Hidden camera binding for scanner form (kept here so the template
         stays a single root component). -->
    <ng-container></ng-container>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class MemberBulkScannerModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(MemberBulkScannerService);
  private readonly toast = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly close = output<void>();
  readonly confirmed = output<CommitMemberRosterDto>();

  // Wizard steps
  readonly wizardSteps = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
  ];

  // ------------------------------------------------------------------------
  // State (signals only — zoneless-safe)
  // ------------------------------------------------------------------------

  /** 1 = upload, 2 = analyze, 3 = review. */
  readonly currentStep = signal<1 | 2 | 3>(1);

  /** Phase-1 upload state. */
  readonly selectedFile = signal<File | null>(null);
  readonly filePreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly isProcessingFile = signal(false);

  /** Phase-1+2 results. */
  readonly scanResult = signal<RosterScanResult | null>(null);
  readonly analysis = signal<MemberRosterAnalysis | null>(null);

  /** Phase-3 mutable edits. Both signals mirror backend rows 1:1. */
  readonly editablePlans = signal<EditablePlan[]>([]);
  readonly editableMembers = signal<EditableMember[]>([]);

  readonly isImageFile = computed(() => {
    const file = this.selectedFile();
    return file?.type?.startsWith('image/') ?? false;
  });

  /** Rows that will actually be sent to the backend (not excluded). */
  readonly includedCount = computed(
    () => this.editableMembers().filter((m) => !m.excluded).length,
  );

  /**
   * Enable Confirmar only when there is at least one non-excluded row AND
   * none of the included rows is in `error`. Excluded rows are ignored — the
   * user can drop bad rows via the "Excluir" toggle and still commit the rest.
   */
  readonly canCommit = computed(() => {
    const included = this.editableMembers().filter((m) => !m.excluded);
    if (included.length === 0) return false;
    return included.every((m) => m.status !== 'error');
  });

  /**
   * Plan status → Badge variant. Exposed as a class method because the
   * Angular template type-checker can't reach top-level `function`s from
   * the same file (they aren't class members); it CAN reach module-level
   * `const` values, so the label helper stays at module scope.
   */
  badgeForPlanStatus(status: PlanMatch['status']): BadgeVariant {
    if (status === 'existing') return 'success';
    if (status === 'partial') return 'warning';
    return 'primary';
  }

  // ------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------

  constructor() {
    // Reset wizard when modal opens (re-mounting data avoids stale rows).
    effect(() => {
      const open = this.isOpen();
      if (open) {
        this.resetWizard();
      }
    });
  }

  // ------------------------------------------------------------------------
  // File upload (Step 1)
  // ------------------------------------------------------------------------

  triggerFileInput(): void {
    const input = document.querySelector(
      'app-member-bulk-scanner-modal input[type="file"]:not([capture])',
    ) as HTMLInputElement;
    input?.click();
  }

  triggerCamera(): void {
    const input = document.querySelector(
      'app-member-bulk-scanner-modal input[capture]',
    ) as HTMLInputElement;
    input?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) {
      this.handleFile(file);
    }
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

    if (!ACCEPTED_MIMETYPES.includes(file.type)) {
      this.fileError.set(
        'Formato no soportado. Usa JPG, PNG, WebP o PDF.',
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
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

  // ------------------------------------------------------------------------
  // Scan + Analyze (Step 2)
  // ------------------------------------------------------------------------

  startScan(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.currentStep.set(2);

    this.service
      .scanRoster(file)
      .pipe(
        switchMap((res) => {
          if (!res.success || !res.data) {
            throw new Error(res.message || 'Error al escanear el documento');
          }
          this.scanResult.set(res.data);
          return this.service.analyzeRoster(res.data);
        }),
        tap((res) => {
          if (!res.success || !res.data) {
            throw new Error(res.message || 'Error al analizar el documento');
          }
          this.seedEditableState(res.data);
          this.currentStep.set(3);
        }),
        catchError((err: unknown) => {
          const message =
            (err as { error?: { message?: string | string[] } })?.error?.message ??
            (err instanceof Error ? err.message : null) ??
            'Error al procesar el documento';
          const display =
            typeof message === 'string'
              ? message
              : Array.isArray(message)
                ? message.join(', ')
                : 'Error al procesar el documento';
          this.toast.error(display);
          this.currentStep.set(1);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  /**
   * Mirror the backend analysis result into the editable plan/member signals.
   * This is the single conversion point — every other template path mutates
   * the editable signals via per-row helpers below.
   */
  private seedEditableState(a: MemberRosterAnalysis): void {
    this.editablePlans.set(
      a.plans.map((p, idx): EditablePlan => {
        const extracted = this.scanResult()?.detected_plans?.[idx];
        const userChoice =
          p.status === 'existing' && p.matched_plan_id != null
            ? p.matched_plan_id
            : null;
        return {
          ref_index: p.ref_index,
          status: p.status,
          // Name from the candidate if mapped, else the OCR'd plan name.
          matched_plan_name:
            p.status === 'existing'
              ? p.candidates.find((c) => c.id === p.matched_plan_id)?.name ??
                extracted?.name ??
                null
              : extracted?.name ?? null,
          matched_plan_id: userChoice,
          code: extracted?.name ?? '',
          name: extracted?.name ?? '',
          price: extracted?.price ?? null,
          currency: extracted?.currency ?? null,
          duration_days: extracted?.duration_days ?? null,
          candidates: p.candidates,
        };
      }),
    );

    this.editableMembers.set(
      a.members.map((m) => this.toEditableMember(m)),
    );

    this.analysis.set(a);
  }

  /**
   * Snapshots an `AnalyzedMember` into an `EditableMember` — shallow copy
   * with string-friendly defaults for the inline-editable inputs.
   */
  private toEditableMember(m: AnalyzedMember): EditableMember {
    return {
      row_number: m.row_number,
      action: m.action,
      existing_customer_id: m.existing_customer_id,
      plan_ref: m.plan_ref,
      first_name: m.first_name ?? '',
      last_name: m.last_name ?? '',
      document_type: m.document_type ?? null,
      document_number: m.document_number ?? null,
      email: m.email ?? null,
      phone: m.phone ?? null,
      date_of_birth: m.date_of_birth ?? null,
      gender: m.gender ?? null,
      emergency_contact_name: m.emergency_contact_name ?? null,
      emergency_contact_phone: m.emergency_contact_phone ?? null,
      medical_notes: m.medical_notes ?? null,
      goals: m.goals ?? null,
      height_cm: m.height_cm ?? null,
      weight_kg: m.weight_kg ?? null,
      resolved_status: m.resolved_status,
      resolved_period_start: m.resolved_period_start ?? null,
      resolved_period_end: m.resolved_period_end ?? null,
      period_start: m.resolved_period_start ?? null,
      period_end: m.resolved_period_end ?? null,
      status: m.status,
      warnings: m.warnings ?? [],
      errors: m.errors ?? [],
      excluded: !!m.excluded,
    };
  }

  // ------------------------------------------------------------------------
  // Re-mapping helpers (Step 3)
  // ------------------------------------------------------------------------

  /**
   * User picked an existing candidate for a "new"/"partial" plan → reuse it
   * instead of creating a new one. Mirrors `chooseProduct` in the invoice
   * scanner modal.
   */
  onPlanCandidateChange(plan: EditablePlan, candidateId: string): void {
    const id = candidateId ? Number(candidateId) : null;
    const updated: EditablePlan = { ...plan };
    if (id != null && !Number.isNaN(id)) {
      const candidate = plan.candidates.find((c) => c.id === id);
      if (candidate) {
        updated.status = 'existing';
        updated.matched_plan_id = candidate.id;
        updated.matched_plan_name = candidate.name;
        updated.code = candidate.code;
        updated.name = candidate.name;
        updated.price = Number(candidate.price);
        updated.currency = candidate.currency;
        updated.duration_days = candidate.duration_days;
      }
    } else {
      updated.status = 'new';
      updated.matched_plan_id = null;
      updated.matched_plan_name = null;
    }

    this.editablePlans.update((list) =>
      list.map((p) => (p.ref_index === plan.ref_index ? updated : p)),
    );
  }

  /**
   * Change the plan assignment of a member (e.g. after the user noticed the
   * wrong mapping from the analyze phase). Updates the row in place.
   */
  onMemberPlanRefChange(member: EditableMember, refString: string): void {
    const ref = refString ? Number(refString) : null;
    const next: EditableMember = {
      ...member,
      plan_ref: ref != null && !Number.isNaN(ref) ? ref : null,
    };
    // If a plan is now assigned and there was no resolution error, drop
    // the warning so the row becomes ready.
    if (next.plan_ref != null && next.warnings.some((w) => /plan/i.test(w))) {
      next.warnings = next.warnings.filter((w) => !/plan/i.test(w));
      next.status = next.errors.length > 0 ? 'error' : 'ready';
    }
    this.replaceMember(next);
  }

  /** Editable inline name (first/last). */
  updateMemberName(member: EditableMember, field: 'first_name' | 'last_name', value: string): void {
    const next: EditableMember = { ...member, [field]: value };
    // After name edits, if the row was in error due to missing name (and
    // there's now at least one of the two), drop that error.
    this.recomputeRowStatus(next);
    this.replaceMember(next);
  }

  /** Editable status override. */
  onMemberStatusChange(member: EditableMember, status: GymMembershipStatus): void {
    const next: EditableMember = { ...member, resolved_status: status };
    this.replaceMember(next);
  }

  /** Editable period start (YYYY-MM-DD). */
  onMemberPeriodStartChange(member: EditableMember, value: string): void {
    this.replaceMember({ ...member, period_start: value || null });
  }

  /** Editable period end (YYYY-MM-DD). */
  onMemberPeriodEndChange(member: EditableMember, value: string): void {
    this.replaceMember({ ...member, period_end: value || null });
  }

  /** Toggle the per-row excluded flag (skipped during commit). */
  onMemberExcludeToggle(member: EditableMember, excluded: boolean): void {
    const next: EditableMember = { ...member, excluded };
    this.replaceMember(next);
  }

  /**
   * Patch in a recomputed row status without thrashing reference identity
   * unnecessarily. Idempotent.
   */
  private recomputeRowStatus(member: EditableMember): void {
    // If name is still empty AND no document, the row stays in error. We
    // don't deep-clone the analyzer; the row's name is what matters here.
    const hasName =
      (member.first_name ?? '').trim() !== '' ||
      (member.last_name ?? '').trim() !== '';
    const hasDoc =
      !!member.document_number && (member.document_number ?? '').trim() !== '';
    if (!hasName && !hasDoc) {
      return;
    }
    if (member.errors.length === 0 && member.warnings.length === 0) {
      member.status = 'ready';
    } else if (member.errors.length > 0) {
      member.status = 'error';
    } else {
      member.status = 'warning';
    }
  }

  private replaceMember(next: EditableMember): void {
    this.editableMembers.update((list) =>
      list.map((m) => (m.row_number === next.row_number ? next : m)),
    );
  }

  // ------------------------------------------------------------------------
  // Display helpers (used by ResponsiveDataView transforms)
  // ------------------------------------------------------------------------

  memberName(row: EditableMember): string {
    return (
      `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() ||
      row.email ||
      `Socio #${row.row_number}`
    );
  }

  planLabelForRow(row: EditableMember): string {
    if (row.plan_ref == null) return 'Sin plan';
    const plan = this.editablePlans().find((p) => p.ref_index === row.plan_ref);
    return plan?.name || plan?.matched_plan_name || `Plan #${row.plan_ref}`;
  }

  // ------------------------------------------------------------------------
  // Confirm (Step 3 → emit)
  // ------------------------------------------------------------------------

  /**
   * Builds the final `CommitMemberRosterDto` from the editable signals and
   * hands it to the parent via `(confirmed)`. The parent (list page) is
   * responsible for calling `commitRoster(...)` and surfacing the toast
   * because only it owns the memberships list refresh.
   */
  onConfirm(): void {
    const plans = this.editablePlans();
    const members = this.editableMembers();
    if (members.length === 0) return;

    const commitPlans: CommitPlanDto[] = plans
      .filter((p) => p.status !== 'existing' || p.matched_plan_id != null)
      .map((p) =>
        p.status === 'existing' && p.matched_plan_id != null
          ? {
              ref_index: p.ref_index,
              status: 'existing' as const,
              plan_id: p.matched_plan_id,
            }
          : {
              ref_index: p.ref_index,
              status: 'new' as const,
              code: p.code || `AUTO-${p.ref_index}`,
              name: p.name || `Plan ${p.ref_index}`,
              price: p.price ?? 0,
              currency: p.currency ?? undefined,
              duration_days: p.duration_days ?? 30,
            },
      );

    // Excluded rows are dropped here (the backend has no `excluded` field —
    // sending it would trip forbidNonWhitelisted). Filtering client-side is
    // the contract: only the rows we send get created.
    const commitMembers: CommitMemberDto[] = members
      .filter((m) => !m.excluded)
      .map((m) => ({
        row_number: m.row_number,
        plan_ref_index: m.plan_ref ?? null,
        existing_customer_id: m.existing_customer_id,
        first_name: m.first_name,
        last_name: m.last_name,
        document_type: m.document_type,
        document_number: m.document_number,
        email: m.email,
        phone: m.phone,
        date_of_birth: m.date_of_birth,
        gender: m.gender,
        emergency_contact_name: m.emergency_contact_name,
        emergency_contact_phone: m.emergency_contact_phone,
        medical_notes: m.medical_notes,
        goals: m.goals,
        height_cm: m.height_cm,
        weight_kg:
          typeof m.weight_kg === 'number'
            ? m.weight_kg
            : m.weight_kg != null && m.weight_kg !== ''
              ? Number(m.weight_kg)
              : null,
        status: m.resolved_status,
        period_start: m.period_start ?? null,
        period_end: m.period_end ?? null,
      }));

    this.confirmed.emit({ plans: commitPlans, members: commitMembers });
    this.closeAfterCommit();
  }

  // ------------------------------------------------------------------------
  // Modal lifecycle
  // ------------------------------------------------------------------------

  onOpenChange(open: boolean): void {
    if (!open) {
      this.resetWizard();
      this.close.emit();
    }
  }

  onCancel(): void {
    this.resetWizard();
    this.close.emit();
  }

  resetWizard(): void {
    this.currentStep.set(1);
    this.selectedFile.set(null);
    this.filePreviewUrl.set(null);
    this.fileError.set(null);
    this.isProcessingFile.set(false);
    this.scanResult.set(null);
    this.analysis.set(null);
    this.editablePlans.set([]);
    this.editableMembers.set([]);
  }

  private closeAfterCommit(): void {
    // Parent owns visibility via the `isOpen` input — emit close and let
    // the parent toggle its own signal.
    this.close.emit();
    this.resetWizard();
  }
}

// ============================================================================
// Local types (the editable shapes the modal works with).
// These live alongside the component (not in interfaces/) because they're
// implementation detail — they mirror backend rows but expose mutable
// properties for ngModel two-way binding.
// ============================================================================

interface EditablePlan {
  ref_index: number;
  status: PlanMatch['status'];
  /** When `existing`: backend id. When `new`: the user's chosen candidate id. */
  matched_plan_id: number | null;
  /** Display label used in templates & member card subtitles. */
  matched_plan_name: string | null;
  code: string;
  name: string;
  price: number | null;
  currency: string | null;
  duration_days: number | null;
  candidates: PlanCandidate[];
}

interface EditableMember {
  row_number: number;
  action: AnalyzedMember['action'];
  existing_customer_id: number | undefined;
  plan_ref: number | null;
  first_name: string;
  last_name: string;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: 'masculino' | 'femenino' | 'otro' | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  goals: string | null;
  height_cm: number | null;
  weight_kg: number | string | null;
  resolved_status: GymMembershipStatus;
  /** Original resolved value (for reference; user edits go into `period_*`). */
  resolved_period_start: string | null;
  resolved_period_end: string | null;
  /** User-editable copy (used for commit). */
  period_start: string | null;
  period_end: string | null;
  status: AnalyzedMemberStatus;
  warnings: string[];
  errors: string[];
  excluded: boolean;
}
