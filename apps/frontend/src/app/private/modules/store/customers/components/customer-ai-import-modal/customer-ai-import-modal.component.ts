import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, catchError, of, switchMap, tap } from 'rxjs';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  AiDiscardToggleComponent,
  AiReviewAckComponent,
  AI_DISCARDED_ROW_CLASSES,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SpinnerComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  AnalyzedImportCustomer,
  CommitCustomerImportResult,
  CommitCustomerItem,
  CommitCustomerOutcome,
  CustomerAiImportService,
  CustomerImportAnalysis,
  ImportCommitAction,
  ImportCustomerMatch,
  ImportLocation,
  ImportPersonType,
} from '../../services/customer-ai-import.service';
import { BulkUploadLogService } from '../../../bulk-uploads/services/bulk-upload-log.service';
import {
  BulkUploadFileInfo,
  toBulkUploadFileInfo,
} from '../../../bulk-uploads/bulk-upload-log.interface';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_SHEET_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
const SHEET_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
];
const SHEET_EXTENSIONS = ['xlsx', 'xls', 'csv'];
const ACCEPT_ATTR =
  'image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.csv';

const DOCUMENT_TYPES = ['CC', 'CE', 'NIT', 'TI', 'PA', 'PEP', 'PPT', 'RC'];

const MATCH_ACTIONS: { value: ImportCommitAction; label: string }[] = [
  { value: 'add_locations', label: 'Agregar ubicaciones' },
  {
    value: 'update_and_add_locations',
    label: 'Actualizar datos y agregar ubicaciones',
  },
  { value: 'skip', label: 'Omitir' },
];

const OUTCOME_LABEL: Record<CommitCustomerOutcome, string> = {
  created: 'Creado',
  updated: 'Actualizado',
  locations_added: 'Ubicaciones agregadas',
  skipped: 'Omitido',
  failed: 'Con error',
};

/** Ubicación editable en la precarga. */
interface EditableLocation extends ImportLocation {
  uid: number;
  already_registered: boolean;
}

/** Cliente editable en la precarga (un cliente = un documento). */
interface EditableCustomer {
  uid: number;
  person_type: ImportPersonType | null;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  email: string | null;
  phone: string | null;
  locations: EditableLocation[];
  match: ImportCustomerMatch | null;
  /** Acción elegida cuando el cliente ya existe. */
  matchAction: ImportCommitAction;
  included: boolean;
}

/**
 * Carga de clientes con IA (S7).
 *
 * 4 pasos: subir -> analizar -> revisar (precarga editable) -> resultados.
 * Nada se persiste hasta "Crear lote". Salidas: `(close)` y `(imported)` cuando
 * el lote creó o modificó algo (el padre recarga la lista).
 */
@Component({
  selector: 'app-customer-ai-import-modal',
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
    AiReviewAckComponent,
    AiDiscardToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      size="xl"
      title="Cargar clientes con IA"
      subtitle="Sube un documento o una hoja de cálculo y la IA extrae los clientes con sus ubicaciones."
    >
      <div class="mb-5">
        <app-steps-line
          [steps]="wizardSteps"
          [currentStep]="currentStep() - 1"
          size="sm"
        ></app-steps-line>
      </div>

      <!-- ============ Paso 1: subir ============ -->
      @if (currentStep() === 1) {
        <div class="space-y-4">
          <div
            (click)="fileInput.click()"
            (keydown.enter)="fileInput.click()"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
            tabindex="0"
            role="button"
            aria-label="Seleccionar documento"
            class="group relative border-2 border-dashed rounded-xl p-6 sm:p-8 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[200px]"
            [class.border-primary]="isDragging()"
            [class.bg-primary/5]="isDragging()"
            [class.border-border]="!isDragging() && !selectedFile()"
            [class.border-emerald-500]="selectedFile()"
          >
            @if (selectedFile()) {
              <div class="flex flex-col items-center gap-3 w-full">
                <div class="p-4 bg-primary/10 rounded-lg">
                  <app-icon name="file-text" [size]="40" class="text-primary"></app-icon>
                </div>
                <p class="text-sm font-medium text-text-primary text-center break-all">
                  {{ selectedFile()!.name }}
                </p>
                <p class="text-xs text-text-secondary">
                  {{ formatFileSize(selectedFile()!.size) }}
                </p>
                <button
                  type="button"
                  class="text-xs text-primary hover:underline font-medium"
                  (click)="removeFile(); $event.stopPropagation()"
                >
                  Cambiar archivo
                </button>
              </div>
            } @else {
              <div class="p-3 bg-primary/10 rounded-full mb-3">
                <app-icon name="upload" [size]="28" class="text-primary"></app-icon>
              </div>
              <p class="text-sm font-semibold text-text-primary mb-1 text-center">
                Arrastra el documento aquí o toca para elegirlo
              </p>
              <p class="text-xs text-text-secondary text-center">
                Imagen (JPG, PNG, WebP) o PDF hasta 10 MB · Excel (.xlsx, .xls) o CSV hasta 5 MB
              </p>
            }
          </div>

          <input
            #fileInput
            type="file"
            class="hidden"
            [accept]="acceptAttr"
            (change)="onFileSelected($event)"
          />

          @if (fileError()) {
            <p class="text-sm text-red-600" role="alert">{{ fileError() }}</p>
          }

          <div class="bg-muted/30 border border-border rounded-lg p-3 flex items-start gap-3">
            <app-icon name="info" [size]="16" class="text-text-secondary mt-0.5"></app-icon>
            <p class="text-xs text-text-secondary">
              Funciona con listados de clientes, catálogos, RUT o contratos. Las filas
              del mismo NIT o cédula se agrupan en un solo cliente con varias ubicaciones.
              Nada se crea hasta que confirmes el lote.
            </p>
          </div>
        </div>
      }

      <!-- ============ Paso 2: analizando ============ -->
      @if (currentStep() === 2) {
        <div class="flex flex-col items-center justify-center gap-4 min-h-[260px]">
          <app-spinner size="lg" text="Analizando documento..."></app-spinner>
          <p class="text-sm text-text-secondary text-center max-w-sm">
            La IA extrae los clientes y sus ubicaciones y los cruza con los que ya existen.
          </p>
          <p class="text-xs text-text-secondary text-center max-w-sm">
            @if (scanStalled()) {
              Está tardando más de lo normal; seguimos procesando.
            } @else {
              Esto puede tardar unos minutos. No cierres la ventana.
            }
          </p>
        </div>
      }

      <!-- ============ Paso 3: revisar ============ -->
      @if (currentStep() === 3 && analysis()) {
        <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          @if (analysis()!.warnings.length > 0) {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              <p class="text-xs font-semibold text-amber-800 flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="14"></app-icon>
                Advertencias del documento
              </p>
              @for (w of analysis()!.warnings; track w) {
                <p class="text-xs text-amber-700">• {{ w }}</p>
              }
            </div>
          }

          <div class="flex flex-wrap gap-2 text-xs">
            <app-badge variant="neutral" size="xsm">{{ customers().length }} clientes</app-badge>
            <app-badge variant="neutral" size="xsm">{{ totalLocations() }} ubicaciones</app-badge>
            <app-badge variant="warning" size="xsm">{{ existingCount() }} ya existen</app-badge>
            <app-badge [variant]="errorCount() > 0 ? 'error' : 'success'" size="xsm">
              {{ errorCount() }} con errores
            </app-badge>
          </div>

          @if (customers().length === 0) {
            <div class="text-sm text-text-secondary p-4 border border-dashed border-border rounded-lg text-center">
              No quedan clientes en la precarga.
            </div>
          }

          @for (c of customers(); track c.uid) {
            <app-card [responsive]="true">
              <div class="space-y-3" [class]="c.included ? '' : discardedRowClasses">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-text-primary truncate">
                      {{ customerLabel(c) }}
                    </p>
                    @if (c.match) {
                      <app-badge variant="warning" size="xsm">
                        Ya existe: {{ c.match.display_name }}
                      </app-badge>
                      @if (c.match.matched_by?.length) {
                        <p class="mt-1 text-xs text-text-secondary">
                          Coincide por {{ matchFieldsLabel(c.match.matched_by) }}
                        </p>
                      }
                      @for (o of c.match.other_matches ?? []; track o.id) {
                        <p class="text-xs text-warning">
                          También coincide {{ o.display_name }} por
                          {{ matchFieldsLabel(o.matched_by) }}
                        </p>
                      }
                    } @else {
                      <app-badge variant="success" size="xsm">Nuevo</app-badge>
                    }
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <app-ai-discard-toggle
                      [discarded]="!c.included"
                      [label]="customerLabel(c)"
                      size="sm"
                      (toggled)="patchCustomer(c.uid, { included: !c.included })"
                    ></app-ai-discard-toggle>
                    <button
                      type="button"
                      aria-label="Eliminar cliente"
                      title="Eliminar cliente"
                      class="p-1.5 rounded-lg text-text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                      (click)="removeCustomer(c.uid)"
                    >
                      <app-icon name="trash-2" [size]="16"></app-icon>
                    </button>
                  </div>
                </div>

                @if (c.match) {
                  <div class="space-y-1">
                    <label class="text-xs font-medium text-text-secondary" [for]="'action-' + c.uid">
                      ¿Qué hacemos con este cliente?
                    </label>
                    <select
                      [id]="'action-' + c.uid"
                      class="w-full text-sm border border-border rounded-lg px-3 py-2 bg-surface"
                      [ngModel]="c.matchAction"
                      (ngModelChange)="patchCustomer(c.uid, { matchAction: $event })"
                    >
                      @for (a of matchActions; track a.value) {
                        <option [value]="a.value">{{ a.label }}</option>
                      }
                    </select>
                    <p class="text-xs text-text-secondary">
                      Tiene {{ c.match.existing_locations.length }}
                      ubicación(es) registrada(s) en esta tienda.
                      @if (!c.match.in_store) {
                        Pertenece a la organización y se vinculará a esta tienda.
                      }
                    </p>
                  </div>
                }

                @if (c.included && (!c.match || c.matchAction !== 'skip')) {
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="sm:col-span-2 flex gap-2" role="group" aria-label="Tipo de persona">
                      <button
                        type="button"
                        class="px-3 py-1.5 text-xs rounded-lg border"
                        [class]="personTypeClass(c, 'NATURAL')"
                        (click)="patchCustomer(c.uid, { person_type: 'NATURAL' })"
                      >
                        Persona natural
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1.5 text-xs rounded-lg border"
                        [class]="personTypeClass(c, 'JURIDICA')"
                        (click)="patchCustomer(c.uid, { person_type: 'JURIDICA' })"
                      >
                        Persona jurídica
                      </button>
                    </div>

                    @if (c.person_type === 'JURIDICA') {
                      <app-input
                        class="sm:col-span-2"
                        label="Razón social"
                        [ngModel]="c.legal_name"
                        (ngModelChange)="patchCustomer(c.uid, { legal_name: $event })"
                        [required]="!c.match"
                      ></app-input>
                    } @else {
                      <app-input
                        label="Nombres"
                        [ngModel]="c.first_name"
                        (ngModelChange)="patchCustomer(c.uid, { first_name: $event })"
                        [required]="!c.match"
                      ></app-input>
                      <app-input
                        label="Apellidos"
                        [ngModel]="c.last_name"
                        (ngModelChange)="patchCustomer(c.uid, { last_name: $event })"
                      ></app-input>
                    }

                    <div class="space-y-1">
                      <label class="text-xs font-medium text-text-secondary" [for]="'doctype-' + c.uid">
                        Tipo de documento
                      </label>
                      <select
                        [id]="'doctype-' + c.uid"
                        class="w-full text-sm border border-border rounded-lg px-3 py-2 bg-surface"
                        [ngModel]="c.document_type ?? ''"
                        (ngModelChange)="patchCustomer(c.uid, { document_type: $event || null })"
                      >
                        <option value="">—</option>
                        @for (t of documentTypes; track t) {
                          <option [value]="t">{{ t }}</option>
                        }
                      </select>
                    </div>
                    <app-input
                      label="Número de documento"
                      [ngModel]="c.document_number"
                      (ngModelChange)="patchCustomer(c.uid, { document_number: $event })"
                    ></app-input>
                    <app-input
                      label="Correo"
                      type="email"
                      [ngModel]="c.email"
                      (ngModelChange)="patchCustomer(c.uid, { email: $event })"
                    ></app-input>
                    <app-input
                      label="Teléfono"
                      type="tel"
                      [ngModel]="c.phone"
                      (ngModelChange)="patchCustomer(c.uid, { phone: $event })"
                    ></app-input>
                  </div>

                  <!-- Ubicaciones -->
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <p class="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                        <app-icon name="map-pin" [size]="14"></app-icon>
                        Ubicaciones ({{ c.locations.length }})
                      </p>
                      <button
                        type="button"
                        class="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1"
                        (click)="addLocation(c.uid)"
                      >
                        <app-icon name="plus" [size]="12"></app-icon>
                        Agregar ubicación
                      </button>
                    </div>

                    @for (l of c.locations; track l.uid) {
                      <div class="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex items-center gap-2 min-w-0">
                            <span class="text-xs font-medium text-text-primary truncate">
                              {{ l.label || 'Ubicación' }}
                            </span>
                            @if (l.already_registered) {
                              <app-badge variant="neutral" size="xsm">Ya registrada</app-badge>
                            }
                            @if (locationError(l)) {
                              <app-badge variant="error" size="xsm">{{ locationError(l) }}</app-badge>
                            }
                          </div>
                          <button
                            type="button"
                            aria-label="Eliminar ubicación"
                            title="Eliminar ubicación"
                            class="p-1 rounded-lg text-text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                            (click)="removeLocation(c.uid, l.uid)"
                          >
                            <app-icon name="trash-2" [size]="14"></app-icon>
                          </button>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <app-input
                            label="Nombre de la sede"
                            [ngModel]="l.label"
                            (ngModelChange)="patchLocation(c.uid, l.uid, { label: $event })"
                          ></app-input>
                          <app-input
                            label="Teléfono"
                            type="tel"
                            [ngModel]="l.phone"
                            (ngModelChange)="patchLocation(c.uid, l.uid, { phone: $event })"
                          ></app-input>
                          <app-input
                            label="Dirección"
                            [required]="true"
                            [ngModel]="l.address_line_1"
                            (ngModelChange)="patchLocation(c.uid, l.uid, { address_line_1: $event, already_registered: false })"
                          ></app-input>
                          <app-input
                            label="Complemento"
                            [ngModel]="l.address_line_2"
                            (ngModelChange)="patchLocation(c.uid, l.uid, { address_line_2: $event })"
                          ></app-input>
                          <app-input
                            label="Ciudad"
                            [required]="true"
                            [ngModel]="l.city"
                            (ngModelChange)="patchLocation(c.uid, l.uid, { city: $event, already_registered: false })"
                          ></app-input>
                          <app-input
                            label="Departamento"
                            [ngModel]="l.state"
                            (ngModelChange)="patchLocation(c.uid, l.uid, { state: $event })"
                          ></app-input>
                        </div>
                      </div>
                    }
                  </div>
                }

                @if (isActive(c) && customerError(c); as err) {
                  <p class="text-xs text-red-600 flex items-center gap-1.5" role="alert">
                    <app-icon name="alert-triangle" [size]="12"></app-icon>
                    {{ err }}
                  </p>
                }
              </div>
            </app-card>
          }

          <app-ai-review-ack
            #ackBlock
            [(acknowledged)]="aiAck"
            [itemCount]="customers().length"
            entityLabel="clientes"
          ></app-ai-review-ack>
        </div>
      }

      <!-- ============ Paso 4: resultados ============ -->
      @if (currentStep() === 4 && commitResult()) {
        <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div class="flex flex-wrap gap-2 text-xs">
            <app-badge variant="success" size="xsm">{{ commitResult()!.created }} creados</app-badge>
            <app-badge variant="success" size="xsm">{{ commitResult()!.updated }} actualizados</app-badge>
            <app-badge variant="success" size="xsm">{{ commitResult()!.locations_added }} ubicaciones agregadas</app-badge>
            <app-badge variant="neutral" size="xsm">
              {{ commitResult()!.locations_already_registered }} ya registradas
            </app-badge>
            <app-badge variant="neutral" size="xsm">{{ commitResult()!.skipped }} omitidos</app-badge>
            <app-badge [variant]="commitResult()!.failed > 0 ? 'error' : 'neutral'" size="xsm">
              {{ commitResult()!.failed }} con error
            </app-badge>
          </div>

          <div class="space-y-2">
            @for (r of commitResult()!.results; track r.index) {
              <div class="border border-border rounded-lg p-3 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-medium text-text-primary truncate">{{ r.display_name }}</p>
                  <app-badge [variant]="outcomeVariant(r.outcome)" size="xsm">
                    {{ outcomeLabel(r.outcome) }}
                  </app-badge>
                </div>
                @if (r.locations_added || r.locations_already_registered) {
                  <p class="text-xs text-text-secondary">
                    {{ r.locations_added }} ubicación(es) agregada(s) ·
                    {{ r.locations_already_registered }} ya registrada(s)
                  </p>
                }
                @if (r.error) {
                  <p class="text-xs text-red-600">{{ r.error }}</p>
                }
                @for (e of r.location_errors; track e) {
                  <p class="text-xs text-red-600">• {{ e }}</p>
                }
              </div>
            }
          </div>
        </div>
      }

      <!-- ============ Pie ============ -->
      <div slot="footer" class="flex flex-wrap justify-between gap-3">
        <div>
          @if (currentStep() === 3) {
            <app-button variant="outline" (clicked)="resetWizard()">Empezar de nuevo</app-button>
          }
        </div>
        <div class="flex gap-3">
          @if (currentStep() !== 4) {
            <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          }
          @if (currentStep() === 1) {
            <app-button variant="primary" [disabled]="!selectedFile()" (clicked)="startScan()">
              Analizar documento
            </app-button>
          }
          @if (currentStep() === 3) {
            <app-button
              variant="primary"
              [disabled]="!canCommit()"
              [loading]="committing()"
              (clicked)="onCommit()"
            >
              Crear lote
            </app-button>
          }
          @if (currentStep() === 4) {
            <app-button variant="primary" (clicked)="onCancel()">Cerrar</app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class CustomerAiImportModalComponent {
  matchFieldsLabel(fields: readonly string[] | undefined): string {
    return (fields ?? [])
      .map((f) => (f === 'email' ? 'correo' : 'identificación'))
      .join(' y ');
  }

  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(CustomerAiImportService);
  private readonly toast = inject(ToastService);
  private readonly bulkUploadLog = inject(BulkUploadLogService);
  /** QUI-1004 — huella del archivo escaneado y carga anterior, si la hay. */
  private fileInfo: BulkUploadFileInfo = {};

  readonly isOpen = input<boolean>(false);
  readonly close = output<void>();
  readonly imported = output<void>();

  readonly wizardSteps = [
    { label: 'Subir' },
    { label: 'Analizar' },
    { label: 'Revisar' },
    { label: 'Resultado' },
  ];
  readonly acceptAttr = ACCEPT_ATTR;
  readonly documentTypes = DOCUMENT_TYPES;
  readonly matchActions = MATCH_ACTIONS;
  protected readonly discardedRowClasses = AI_DISCARDED_ROW_CLASSES;

  /** 1 = subir, 2 = analizar, 3 = revisar, 4 = resultado. */
  readonly currentStep = signal<1 | 2 | 3 | 4>(1);
  readonly selectedFile = signal<File | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly isDragging = signal(false);
  readonly scanStalled = signal(false);
  readonly analysis = signal<{ warnings: string[] } | null>(null);
  readonly customers = signal<EditableCustomer[]>([]);
  readonly committing = signal(false);
  readonly commitResult = signal<CommitCustomerImportResult | null>(null);

  /** Verificación obligatoria de lo que precargó la IA. */
  readonly aiAck = signal(false);
  private readonly ackBlock = viewChild<AiReviewAckComponent>('ackBlock');

  private scanSub: Subscription | null = null;
  private uidSeq = 0;

  readonly totalLocations = computed(() =>
    this.customers().reduce(
      (n, c) => n + (this.isActive(c) ? c.locations.length : 0),
      0,
    ),
  );
  readonly existingCount = computed(
    () => this.customers().filter((c) => c.match).length,
  );
  readonly errorCount = computed(
    () =>
      this.customers().filter((c) => this.isActive(c) && !!this.customerError(c))
        .length,
  );
  readonly activeCount = computed(
    () => this.customers().filter((c) => this.isActive(c)).length,
  );
  readonly canCommit = computed(
    () =>
      this.currentStep() === 3 &&
      !this.committing() &&
      this.activeCount() > 0 &&
      this.errorCount() === 0,
  );

  constructor() {
    effect(() => {
      if (this.isOpen()) this.resetWizard();
    });
  }

  // ---------------------------------------------------------------- archivo

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
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    const isSheet =
      SHEET_MIMETYPES.includes(file.type) || SHEET_EXTENSIONS.includes(ext);
    const isDocument = DOCUMENT_MIMETYPES.includes(file.type);

    if (!isSheet && !isDocument) {
      this.fileError.set(
        'Formato no soportado. Usa JPG, PNG, WebP, PDF, Excel o CSV.',
      );
      return;
    }
    if (isSheet && file.size > MAX_SHEET_BYTES) {
      this.fileError.set('Las hojas de cálculo no pueden superar 5 MB.');
      return;
    }
    if (!isSheet && file.size > MAX_DOCUMENT_BYTES) {
      this.fileError.set('Las imágenes y PDF no pueden superar 10 MB.');
      return;
    }
    this.selectedFile.set(file);
  }

  removeFile(): void {
    this.selectedFile.set(null);
    this.fileError.set(null);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  // ---------------------------------------------------------- escaneo + análisis

  startScan(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.currentStep.set(2);
    this.scanSub?.unsubscribe();
    this.scanStalled.set(false);

    let scanWarnings: string[] = [];
    this.fileInfo = {};
    this.scanSub = this.service
      .scan(file, {
        onStall: () => this.scanStalled.set(true),
        onEnqueued: (data) => (this.fileInfo = toBulkUploadFileInfo(data)),
      })
      .pipe(
        switchMap((res) => {
          if (!res.success || !res.data) {
            throw new Error(res.message || 'Error al escanear el documento');
          }
          scanWarnings = res.data.warnings ?? [];
          if (!res.data.customers?.length) {
            throw new Error('No se detectaron clientes en el documento.');
          }
          return this.service.analyze(res.data.customers);
        }),
        tap((res) => {
          if (!res.success || !res.data) {
            throw new Error(res.message || 'Error al analizar el documento');
          }
          this.seedEditableState(res.data, scanWarnings);
          this.currentStep.set(3);
        }),
        catchError((err: unknown) => {
          const display =
            err instanceof HttpErrorResponse
              ? parseApiError(err).userMessage
              : (err as Error | null)?.message ||
                'Error al procesar el documento';
          this.toast.error(display);
          this.currentStep.set(1);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private seedEditableState(a: CustomerImportAnalysis, warnings: string[]): void {
    this.analysis.set({ warnings });
    this.customers.set(
      a.customers.map((c) => this.toEditable(c)),
    );
    this.aiAck.set(false);
  }

  private toEditable(c: AnalyzedImportCustomer): EditableCustomer {
    return {
      uid: ++this.uidSeq,
      person_type: c.person_type,
      first_name: c.first_name,
      last_name: c.last_name,
      legal_name: c.legal_name,
      document_type: c.document_type,
      document_number: c.document_number,
      verification_digit: c.verification_digit,
      email: c.email,
      phone: c.phone,
      match: c.match,
      matchAction: 'add_locations',
      included: true,
      locations: c.locations.map((l) => ({
        uid: ++this.uidSeq,
        label: l.label,
        address_line_1: l.address_line_1,
        address_line_2: l.address_line_2,
        city: l.city,
        state: l.state,
        municipality_code: l.municipality_code,
        phone: l.phone,
        already_registered: l.already_registered,
      })),
    };
  }

  // ------------------------------------------------------------- edición

  patchCustomer(uid: number, patch: Partial<EditableCustomer>): void {
    this.customers.update((list) =>
      list.map((c) => (c.uid === uid ? { ...c, ...patch } : c)),
    );
  }

  removeCustomer(uid: number): void {
    this.customers.update((list) => list.filter((c) => c.uid !== uid));
  }

  patchLocation(
    customerUid: number,
    locationUid: number,
    patch: Partial<EditableLocation>,
  ): void {
    this.customers.update((list) =>
      list.map((c) =>
        c.uid === customerUid
          ? {
              ...c,
              locations: c.locations.map((l) =>
                l.uid === locationUid ? { ...l, ...patch } : l,
              ),
            }
          : c,
      ),
    );
  }

  removeLocation(customerUid: number, locationUid: number): void {
    this.customers.update((list) =>
      list.map((c) =>
        c.uid === customerUid
          ? { ...c, locations: c.locations.filter((l) => l.uid !== locationUid) }
          : c,
      ),
    );
  }

  addLocation(customerUid: number): void {
    const blank: EditableLocation = {
      uid: ++this.uidSeq,
      label: null,
      address_line_1: null,
      address_line_2: null,
      city: null,
      state: null,
      municipality_code: null,
      phone: null,
      already_registered: false,
    };
    this.customers.update((list) =>
      list.map((c) =>
        c.uid === customerUid ? { ...c, locations: [...c.locations, blank] } : c,
      ),
    );
  }

  // ------------------------------------------------------------ presentación

  customerLabel(c: EditableCustomer): string {
    const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
    const name =
      c.person_type === 'JURIDICA'
        ? c.legal_name || person
        : person || c.legal_name;
    const doc = c.document_number
      ? ` · ${c.document_type ?? 'Doc.'} ${c.document_number}`
      : '';
    return `${name || 'Cliente sin nombre'}${doc}`;
  }

  personTypeClass(c: EditableCustomer, type: ImportPersonType): string {
    return c.person_type === type
      ? 'bg-primary text-white border-primary'
      : 'bg-surface text-text-secondary border-border hover:border-primary/50';
  }

  locationError(l: EditableLocation): string | null {
    if (!l.address_line_1?.trim()) return 'Falta la dirección';
    if (!l.city?.trim()) return 'Falta la ciudad';
    return null;
  }

  /** Mensaje de error bloqueante del cliente (null si está listo). */
  customerError(c: EditableCustomer): string | null {
    if (!c.match) {
      if (c.person_type === 'JURIDICA') {
        if (!c.legal_name?.trim()) return 'Falta la razón social.';
      } else if (!c.first_name?.trim()) {
        return 'Falta el nombre.';
      }
    }
    if (c.locations.some((l) => this.locationError(l))) {
      return 'Hay ubicaciones con datos faltantes: complétalas o elimínalas.';
    }
    return null;
  }

  outcomeLabel(outcome: CommitCustomerOutcome): string {
    return OUTCOME_LABEL[outcome];
  }

  outcomeVariant(
    outcome: CommitCustomerOutcome,
  ): 'success' | 'error' | 'neutral' {
    if (outcome === 'failed') return 'error';
    if (outcome === 'skipped') return 'neutral';
    return 'success';
  }

  /** Acción efectiva que se enviará al backend. */
  private effectiveAction(c: EditableCustomer): ImportCommitAction {
    if (!c.included) return 'skip';
    return c.match ? c.matchAction : 'create';
  }

  protected isActive(c: EditableCustomer): boolean {
    return this.effectiveAction(c) !== 'skip';
  }

  // ---------------------------------------------------------------- commit

  async onCommit(): Promise<void> {
    if (!this.aiAck()) {
      this.ackBlock()?.requestAttention();
      return;
    }
    if (!this.canCommit()) return;
    // QUI-1004 — aviso de archivo repetido; Cancelar no carga nada.
    if (!(await this.bulkUploadLog.confirmDuplicate(this.fileInfo.duplicate_of))) {
      return;
    }

    const payload = this.customers().map((c) => this.toCommitItem(c));
    this.committing.set(true);
    this.service
      .commit(payload, this.fileInfo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.committing.set(false);
          if (!res.success || !res.data) {
            this.toast.error(res.message || 'No se pudo crear el lote');
            return;
          }
          this.commitResult.set(res.data);
          this.currentStep.set(4);
          const r = res.data;
          if (r.created || r.updated || r.locations_added) {
            this.imported.emit();
          }
          if (r.failed > 0) {
            this.toast.warning(`${r.failed} cliente(s) con error. Revisa el resultado.`);
          } else {
            this.toast.success('Lote creado correctamente');
          }
        },
        error: (err: unknown) => {
          this.committing.set(false);
          this.toast.error(
            err instanceof HttpErrorResponse
              ? parseApiError(err).userMessage
              : 'No se pudo crear el lote',
          );
        },
      });
  }

  private toCommitItem(c: EditableCustomer): CommitCustomerItem {
    const n = (v: string | null | undefined): string | null => {
      const t = (v ?? '').trim();
      return t ? t : null;
    };
    return {
      action: this.effectiveAction(c),
      existing_customer_id: c.match?.existing_customer_id ?? null,
      person_type: c.person_type,
      first_name: n(c.first_name),
      last_name: n(c.last_name),
      legal_name: n(c.legal_name),
      document_type: n(c.document_type),
      document_number: n(c.document_number),
      verification_digit: n(c.verification_digit),
      email: n(c.email),
      phone: n(c.phone),
      locations: c.locations.map((l) => ({
        label: n(l.label),
        address_line_1: n(l.address_line_1),
        address_line_2: n(l.address_line_2),
        city: n(l.city),
        state: n(l.state),
        municipality_code: n(l.municipality_code),
        phone: n(l.phone),
      })),
    };
  }

  // ----------------------------------------------------------------- ciclo

  onOpenChange(open: boolean): void {
    if (!open) this.onCancel();
  }

  onCancel(): void {
    this.resetWizard();
    this.close.emit();
  }

  resetWizard(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = null;
    this.scanStalled.set(false);
    this.currentStep.set(1);
    this.selectedFile.set(null);
    this.fileError.set(null);
    this.isDragging.set(false);
    this.analysis.set(null);
    this.customers.set([]);
    this.committing.set(false);
    this.commitResult.set(null);
    // El contenido proyectado en app-modal no se destruye al cerrar: sin este
    // reset la segunda apertura traería la verificación ya marcada.
    this.aiAck.set(false);
  }
}
