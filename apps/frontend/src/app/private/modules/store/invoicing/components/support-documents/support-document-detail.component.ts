import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subscription, switchMap } from 'rxjs';

import {
  DianRejection,
  describeApiFailure,
  formatReason,
  readDianRejection,
  readPersistedDianRejection,
} from '../../utils/invoicing-errors.util';
import { InvoicingService } from '../../services/invoicing.service';
import { fiscalStatusCells, toneClasses } from '../invoice-detail/invoice-fiscal-status.util';
import type { FiscalStatusCell } from '../invoice-detail/invoice-fiscal-status.util';
import {
  canDownloadSupportPdf,
  canEmitSupportDocument,
  downloadSupportXml,
  supportStatusLabel,
  supportStatusVariant,
  supportTypeLabel,
} from './support-document-status.util';
import type { RelatedNote } from '../../interfaces/invoice.interface';
import { SupportDocumentService } from '../../services/support-document.service';
import type {
  SupportDocumentAdjustmentSource,
  SupportDocumentDetail,
  SupportDocumentDianStatus,
  SupportDocumentRow,
} from '../../interfaces/support-document.interface';
import {
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  ModalComponent,
} from '../../../../../../shared/components/index';
import type { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

/** Tipos que se corrigen con nota de ajuste una vez aceptados (no la nota misma). */
const ADJUSTABLE_TYPES: ReadonlySet<string> = new Set([
  'support_document',
  'purchase_invoice',
]);

const DIAN_RESULT: Record<
  SupportDocumentDianStatus['dian_status'],
  { label: string; variant: BadgeVariant; hint: string }
> = {
  accepted: {
    label: 'Aceptado por la DIAN',
    variant: 'success',
    hint: 'La DIAN tiene este documento como válido.',
  },
  rejected: {
    label: 'No válido en la DIAN',
    variant: 'error',
    hint: 'La DIAN no reconoce este documento como válido. Revisa las reglas que reporta.',
  },
  pending: {
    label: 'En proceso en la DIAN',
    variant: 'warning',
    hint: 'La DIAN todavía no termina de procesar el documento. Consulta de nuevo en unos minutos.',
  },
  unavailable: {
    label: 'La DIAN no respondió',
    variant: 'neutral',
    hint: 'No fue posible leer la respuesta de la DIAN. Esto no es un rechazo: intenta de nuevo en unos minutos.',
  },
};

interface DetailLine {
  key: number | string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  total_amount: number;
}

/**
 * Detalle de un documento soporte (QUI-683).
 *
 * Reemplaza el toast «Detalle en construcción» de la pestaña. No reutiliza
 * `invoice-detail`: ese componente está acoplado a NgRx, RADIAN, notas
 * crédito/débito y envío por correo, que no aplican a un documento soporte.
 *
 * Acciones según el estado (política de producto del ticket):
 * - Aceptado con CUDS → «Nota de ajuste»: un soporte aceptado NO se anula, se
 *   corrige con nota de ajuste (tipo 95) que referencia su CUDS.
 * - Rechazado → «Anular» (el backend solo anula lo que la DIAN rechazó).
 * - Borrador / validado → «Descartar» (nunca salió hacia la DIAN).
 * - Con CUDS → «Consultar en DIAN»: lectura en vivo, no cambia el estado local.
 * - Borrador / validado → «Emitir a la DIAN»: validar y enviar, igual que la factura.
 *
 * QUI-684: muestra la OC de origen, las notas de ajuste, los estados fiscales
 * y el rechazo persistido de la DIAN con los mismos helpers que la factura, y
 * descarga PDF (solo documento soporte) y XML.
 */
@Component({
  selector: 'app-support-document-detail',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, BadgeComponent, CurrencyPipe, RouterLink],
  template: `
    <app-modal
      [(isOpen)]="isOpenModel"
      (cancel)="onClose()"
      [title]="title()"
      size="lg"
      [dialog]="true"
      [canClose]="canCloseModal"
    >
      <div class="space-y-4 p-4">
        @if (loading()) {
          <p class="text-sm text-text-secondary" role="status">Cargando documento…</p>
        } @else if (loadError(); as error) {
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">
            <span>{{ error }}</span>
            <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
          </div>
        } @else if (document(); as doc) {
          <!-- Datos del documento -->
          <section class="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Datos del documento">
            <div>
              <p class="text-xs text-text-secondary">Tipo</p>
              <p class="text-sm font-medium text-text-primary" data-testid="doc-type">{{ typeLabel() }}</p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Estado</p>
              <app-badge [variant]="statusVariant()" size="sm" data-testid="doc-status">{{ statusLabel() }}</app-badge>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Fecha de emisión</p>
              <p class="text-sm text-text-primary">{{ issueDate() }}</p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Proveedor</p>
              <p class="text-sm text-text-primary">{{ supplierName() }}</p>
              @if (supplierTaxId(); as taxId) {
                <p class="text-xs text-text-secondary">NIT / documento: {{ taxId }}</p>
              }
            </div>
            @if (doc.related_invoice_id) {
              <div class="sm:col-span-2">
                <p class="text-xs text-text-secondary">Documento soporte que corrige</p>
                <button
                  type="button"
                  class="text-sm font-medium text-primary hover:underline"
                  data-testid="related-link"
                  (click)="openDocument(doc.related_invoice_id)"
                >
                  Ver documento (ID {{ doc.related_invoice_id }})
                </button>
              </div>
            }
            @if (doc.purchase_order; as po) {
              <div class="sm:col-span-2">
                <p class="text-xs text-text-secondary">Orden de compra de origen</p>
                <a
                  class="text-sm font-medium text-primary hover:underline"
                  data-testid="po-link"
                  [routerLink]="['/admin/orders/purchase-orders', po.id]"
                  (click)="onClose()"
                >
                  {{ po.order_number }}
                </a>
              </div>
            }
          </section>

          @if (rejection(); as rej) {
            <div role="alert" class="space-y-2 rounded-lg border border-error bg-error-light p-3" data-testid="dian-rejection">
              <div class="flex items-start gap-2">
                <app-icon name="alert-triangle" [size]="16" class="text-error"></app-icon>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold text-error">La DIAN rechazó el documento</p>
                  <p class="text-sm text-error">{{ rej.headline }}</p>
                </div>
              </div>
              @if (rej.reasons.length) {
                <ul class="list-disc space-y-1 pl-6">
                  @for (reason of rej.reasons; track reason.message) {
                    <li class="text-sm text-error">
                      {{ describeReason(reason) }}
                      @if (reason.severity === 'warning') {
                        <span class="ml-1 text-xs opacity-70">(advertencia)</span>
                      }
                    </li>
                  }
                </ul>
              }
              @if (rej.statusDescription || rej.statusCode) {
                <p class="text-xs text-error">
                  Estado DIAN: {{ rej.statusDescription || rej.statusCode }}
                  @if (rej.statusDescription && rej.statusCode) {
                    <span> ({{ rej.statusCode }})</span>
                  }
                </p>
              }
              @if (rej.trackingId) {
                <p class="break-all text-xs text-error">Tracking DIAN: <code>{{ rej.trackingId }}</code></p>
              }
            </div>
          }

          @if (fiscalCells().length > 0) {
            <section class="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Estados fiscales" data-testid="fiscal-cells">
              @for (cell of fiscalCells(); track cell.label) {
                <div class="rounded-lg border border-border p-2">
                  <p class="text-xs text-text-secondary">{{ cell.label }}</p>
                  <span class="mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium" [class]="tone(cell.tone)">{{ cell.text }}</span>
                  @if (cell.hint) {
                    <p class="mt-1 text-xs text-text-secondary">{{ cell.hint }}</p>
                  }
                </div>
              }
            </section>
          }

          <!-- CUDS -->
          <section class="rounded-lg border border-border p-3" aria-label="CUDS">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-medium text-text-secondary">CUDS</p>
              @if (cuds()) {
                <app-button variant="ghost" size="sm" (clicked)="copyCuds()" ariaLabel="Copiar CUDS">
                  <app-icon slot="icon" name="copy" [size]="14"></app-icon>
                  Copiar
                </app-button>
              }
            </div>
            @if (cuds(); as key) {
              <p class="mt-1 break-all font-mono text-xs text-text-primary" data-testid="doc-cuds">{{ key }}</p>
            } @else {
              <p class="mt-1 text-sm text-text-secondary">Sin CUDS: el documento todavía no se ha transmitido a la DIAN.</p>
            }
          </section>

          <!-- Ítems y totales -->
          <section class="space-y-2" aria-label="Ítems">
            <h4 class="text-sm font-medium text-text-primary">Ítems</h4>
            @if (lines().length === 0) {
              <p class="text-sm text-text-secondary">Sin ítems.</p>
            } @else {
              <ul class="divide-y divide-border rounded-lg border border-border">
                @for (line of lines(); track line.key) {
                  <li class="flex items-start justify-between gap-3 p-3 text-sm">
                    <div class="min-w-0">
                      <p class="text-text-primary">{{ line.description }}</p>
                      <p class="text-xs text-text-secondary">{{ line.quantity }} × {{ line.unit_price | currency }}</p>
                    </div>
                    <p class="shrink-0 font-medium text-text-primary">{{ line.total_amount | currency }}</p>
                  </li>
                }
              </ul>
            }
            <dl class="space-y-1 text-sm">
              <div class="flex justify-between"><dt class="text-text-secondary">Subtotal</dt><dd>{{ amount(doc.subtotal_amount) | currency }}</dd></div>
              <div class="flex justify-between"><dt class="text-text-secondary">Impuestos</dt><dd>{{ amount(doc.tax_amount) | currency }}</dd></div>
              @if (amount(doc.withholding_amount) > 0) {
                <div class="flex justify-between"><dt class="text-text-secondary">Retenciones</dt><dd>{{ amount(doc.withholding_amount) | currency }}</dd></div>
              }
              <div class="flex justify-between font-semibold"><dt>Total</dt><dd>{{ amount(doc.total_amount) | currency }}</dd></div>
            </dl>
          </section>

          <!-- Estado DIAN -->
          <section class="space-y-2 rounded-lg border border-border p-3" aria-label="Estado en la DIAN">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-sm font-medium text-text-primary">Estado en la DIAN</h4>
              @if (canQueryDian()) {
                <app-button
                  variant="outline"
                  size="sm"
                  data-testid="action-query-dian"
                  [loading]="dianChecking()"
                  [disabled]="dianChecking() || acting()"
                  (clicked)="queryDian()"
                >
                  <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                  Consultar en DIAN
                </app-button>
              }
            </div>

            @if (!canQueryDian()) {
              <p class="text-sm text-text-secondary">Se podrá consultar cuando el documento tenga CUDS.</p>
            } @else if (dianError(); as error) {
              <p class="text-sm text-error" role="alert">{{ error }}</p>
            } @else if (dianResult(); as result) {
              <div class="space-y-1" role="status" data-testid="dian-result">
                <app-badge [variant]="result.variant" size="sm">{{ result.label }}</app-badge>
                <p class="text-sm text-text-secondary">{{ result.hint }}</p>
                @if (result.code) {
                  <p class="text-xs text-text-secondary">Código DIAN: {{ result.code }}</p>
                }
                @if (result.message) {
                  <p class="text-sm text-text-primary">{{ result.message }}</p>
                }
                @if (result.rules.length > 0) {
                  <ul class="list-disc space-y-1 pl-5 text-xs text-text-secondary">
                    @for (rule of result.rules; track rule.code + rule.text) {
                      <li><span class="font-mono">{{ rule.code }}</span> — {{ rule.text }}</li>
                    }
                  </ul>
                }
                <p class="text-xs text-text-secondary">Consultado: {{ result.checkedAt }}</p>
              </div>
            } @else {
              <p class="text-sm text-text-secondary">Consulta el estado real del documento en la DIAN con su CUDS.</p>
            }
          </section>

          <!-- Descargas -->
          <section class="space-y-2 rounded-lg border border-border p-3" aria-label="Documentos">
            <h4 class="text-sm font-medium text-text-primary">Documentos</h4>
            <div class="flex flex-wrap items-center gap-2">
              @if (canDownloadPdf()) {
                <app-button variant="outline" size="sm" data-testid="action-pdf" [loading]="pdfLoading()" [disabled]="pdfLoading()" (clicked)="downloadPdf()">
                  <app-icon slot="icon" name="download" [size]="14"></app-icon>
                  Descargar PDF
                </app-button>
              }
              @if (doc.xml_document) {
                <app-button variant="outline" size="sm" data-testid="action-xml" (clicked)="downloadXml()">
                  <app-icon slot="icon" name="file-text" [size]="14"></app-icon>
                  Descargar XML
                </app-button>
              } @else {
                <p class="text-xs text-text-secondary">El XML firmado existe después de transmitir el documento a la DIAN.</p>
              }
            </div>
          </section>

          <!-- Notas de ajuste del documento -->
          @if (showNotes()) {
            <section class="space-y-2" aria-label="Notas de ajuste" data-testid="notes-section">
              <h4 class="text-sm font-medium text-text-primary">Notas de ajuste</h4>
              @if (notesLoading()) {
                <p class="text-sm text-text-secondary" role="status">Cargando notas…</p>
              } @else if (notesError(); as error) {
                <p class="text-sm text-error" role="alert">{{ error }}</p>
              } @else if (notes().length === 0) {
                <p class="text-sm text-text-secondary">Este documento no tiene notas de ajuste.</p>
              } @else {
                <ul class="divide-y divide-border rounded-lg border border-border">
                  @for (note of notes(); track note.id) {
                    <li class="flex items-center justify-between gap-3 p-3 text-sm" data-testid="note-row">
                      <div class="min-w-0">
                        <p class="font-medium text-text-primary">{{ note.invoice_number || 'Sin número' }}</p>
                        <app-badge [variant]="noteVariant(note.status)" size="sm">{{ noteLabel(note.status) }}</app-badge>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <span class="font-medium text-text-primary">{{ amount(note.total_amount) | currency }}</span>
                        <app-button variant="ghost" size="sm" data-testid="note-open" (clicked)="openDocument(note.id)">Ver detalle</app-button>
                      </div>
                    </li>
                  }
                </ul>
              }
            </section>
          }

          @if (isAcceptedSupport()) {
            <p class="text-xs text-text-secondary" role="note">
              Un documento soporte aceptado por la DIAN no se anula: se corrige con una nota de ajuste que referencia su CUDS.
            </p>
          }

          @if (actionError(); as error) {
            <div class="flex items-start gap-2 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">
              <app-icon name="alert-circle" [size]="16"></app-icon>
              <span>{{ error }}</span>
            </div>
          }
        }
      </div>

      <div slot="footer">
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <app-button customClasses="w-full sm:w-auto" variant="outline" [disabled]="acting()" (clicked)="onClose()">
            Cerrar
          </app-button>
          @if (canEmit()) {
            <app-button
              customClasses="w-full sm:w-auto"
              variant="primary"
              data-testid="action-emit"
              [loading]="acting()"
              [disabled]="acting()"
              (clicked)="emitToDian()"
            >
              Emitir a la DIAN
            </app-button>
          }
          @if (canDiscard()) {
            <app-button
              customClasses="w-full sm:w-auto"
              variant="danger"
              data-testid="action-discard"
              [loading]="acting()"
              [disabled]="acting()"
              (clicked)="discard()"
            >
              Descartar
            </app-button>
          }
          @if (canVoid()) {
            <app-button
              customClasses="w-full sm:w-auto"
              variant="danger"
              data-testid="action-void"
              [loading]="acting()"
              [disabled]="acting()"
              (clicked)="voidDocument()"
            >
              Anular
            </app-button>
          }
          @if (canAdjust()) {
            <app-button
              customClasses="w-full sm:w-auto"
              variant="primary"
              data-testid="action-adjust"
              [disabled]="acting()"
              (clicked)="requestAdjustment()"
            >
              Nota de ajuste
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class SupportDocumentDetailComponent {
  readonly isOpen = model.required<boolean>();

  /** Id del documento a mostrar; el detalle se hidrata con `GET :id` al abrir. */
  readonly documentId = input<number | null>(null);

  /** Pide abrir el form de nota de ajuste prellenado con este original. */
  readonly adjust = output<SupportDocumentAdjustmentSource>();

  /** El documento cambió de estado (anulado o descartado): el listado recarga. */
  readonly changed = output<SupportDocumentRow>();

  /** Pide al padre abrir otro documento (nota de ajuste u original). */
  readonly openRelated = output<number>();

  private service = inject(SupportDocumentService);
  private invoicing = inject(InvoicingService);
  private dialog = inject(DialogService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly document = signal<SupportDocumentDetail | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly dianStatus = signal<SupportDocumentDianStatus | null>(null);
  readonly dianChecking = signal(false);
  readonly dianError = signal<string | null>(null);
  readonly acting = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly pdfLoading = signal(false);
  readonly notes = signal<RelatedNote[]>([]);
  readonly notesLoading = signal(false);
  readonly notesError = signal<string | null>(null);
  /** Rechazo de la DIAN devuelto por el último intento de emisión (sobrevive hasta recargar). */
  private readonly liveRejection = signal<DianRejection | null>(null);

  readonly tone = toneClasses;
  readonly noteLabel = supportStatusLabel;
  readonly noteVariant = supportStatusVariant;

  readonly canCloseModal = (): boolean => !this.acting();

  private loadRequest?: Subscription;
  private dianRequest?: Subscription;
  private notesRequest?: Subscription;
  private requestGeneration = 0;

  readonly status = computed(() => this.document()?.status ?? null);
  readonly cuds = computed(() => this.document()?.cufe || null);
  readonly title = computed(() => {
    const doc = this.document();
    return doc ? `${this.typeLabel()} ${doc.invoice_number}` : 'Documento soporte';
  });
  readonly typeLabel = computed(() => supportTypeLabel(this.document()?.invoice_type));
  readonly statusLabel = computed(() => supportStatusLabel(this.status()));
  readonly statusVariant = computed<BadgeVariant>(() => supportStatusVariant(this.status()));
  readonly issueDate = computed(() => {
    const value = this.document()?.issue_date;
    return value ? formatDateOnlyUTC(String(value)) : '—';
  });
  readonly supplierName = computed(() => {
    const doc = this.document();
    return doc?.supplier?.name || doc?.customer_name || '—';
  });
  readonly supplierTaxId = computed(() => {
    const doc = this.document();
    return doc?.supplier?.tax_id || doc?.customer_tax_id || null;
  });
  readonly lines = computed<DetailLine[]>(() => {
    const doc = this.document();
    const items = doc?.invoice_items ?? doc?.items ?? [];
    return items.map((item, index) => ({
      key: item.id ?? index,
      description: item.description || item.product_name || 'Ítem',
      quantity: this.amount(item.quantity),
      unit_price: this.amount(item.unit_price),
      tax_amount: this.amount(item.tax_amount),
      total_amount: this.amount(item.total_amount),
    }));
  });

  readonly isAcceptedSupport = computed(() => {
    const doc = this.document();
    return !!doc && doc.status === 'accepted' && ADJUSTABLE_TYPES.has(String(doc.invoice_type));
  });
  readonly canQueryDian = computed(() => !!this.cuds());
  readonly canEmit = computed(() => canEmitSupportDocument(this.status()));
  readonly canDownloadPdf = computed(() => canDownloadSupportPdf(this.document()?.invoice_type));
  /** Las notas cuelgan del documento soporte; una nota de ajuste no tiene notas propias. */
  readonly showNotes = computed(
    () => String(this.document()?.invoice_type ?? '') === 'support_document',
  );
  readonly fiscalCells = computed<FiscalStatusCell[]>(() => {
    const doc = this.document();
    return doc ? fiscalStatusCells(doc) : [];
  });
  readonly rejection = computed<DianRejection | null>(() => {
    const doc = this.document();
    if (!doc) return null;
    const live = this.liveRejection();
    if (live && (live.invoiceId == null || live.invoiceId === doc.id)) return live;
    return readPersistedDianRejection(doc);
  });
  readonly canAdjust = computed(() => this.isAcceptedSupport() && !!this.cuds());
  readonly canVoid = computed(() => this.status() === 'rejected');
  readonly canDiscard = computed(() => {
    const status = this.status();
    return status === 'draft' || status === 'validated';
  });

  readonly dianResult = computed(() => {
    const status = this.dianStatus();
    if (!status) return null;
    const meta = DIAN_RESULT[status.dian_status] ?? DIAN_RESULT.unavailable;
    return {
      ...meta,
      code: status.dian_status_code,
      message: status.message,
      rules: status.rules ?? [],
      checkedAt: new Date(status.checked_at).toLocaleString('es-CO'),
    };
  });

  constructor() {
    let wasOpen = false;
    effect(() => {
      const open = this.isOpen();
      const id = this.documentId();
      untracked(() => {
        if (open && id != null) {
          if (!wasOpen || this.document()?.id !== id) this.load(id);
        } else if (!open && wasOpen) {
          this.clear();
        }
        wasOpen = open;
      });
    });
  }

  /** Prisma serializa `Decimal` como string: se normaliza una sola vez aquí. */
  amount(value: number | string | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  describeReason(reason: Parameters<typeof formatReason>[0]): string {
    return formatReason(reason);
  }

  openDocument(id: number | null | undefined): void {
    if (id == null || this.acting()) return;
    this.openRelated.emit(id);
  }

  /** Valida (solo borrador) y envía a la DIAN con las mismas llamadas que la factura. */
  emitToDian(): void {
    const doc = this.document();
    if (!doc || !this.canEmit() || this.acting()) return;
    const id = doc.id;
    const validate$ =
      doc.status === 'draft'
        ? this.invoicing.validateInvoice(id).pipe(switchMap(() => this.invoicing.sendInvoice(id)))
        : this.invoicing.sendInvoice(id);
    this.acting.set(true);
    this.actionError.set(null);
    this.liveRejection.set(null);
    validate$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.acting.set(false);
        this.toast.success('Documento enviado a la DIAN.');
        if (response?.data) this.changed.emit(response.data);
        this.load(id);
      },
      error: (error: unknown) => {
        this.acting.set(false);
        const failure = describeApiFailure(error);
        this.liveRejection.set(readDianRejection(failure));
        this.actionError.set(failure.message ?? 'No se pudo emitir el documento a la DIAN.');
        this.load(id);
      },
    });
  }

  downloadPdf(): void {
    const doc = this.document();
    if (!doc || !this.canDownloadPdf() || this.pdfLoading()) return;
    this.pdfLoading.set(true);
    this.invoicing
      .getInvoicePdfUrl(doc.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.pdfLoading.set(false);
          const url = response?.data?.url;
          if (!url) {
            this.toast.error('El servidor no devolvió la URL del PDF');
            return;
          }
          if (!window.open(url, '_blank', 'noopener')) {
            this.toast.warning(
              'El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para este sitio.',
            );
          }
        },
        error: (error: unknown) => {
          this.pdfLoading.set(false);
          this.toast.error(describeApiFailure(error).message);
        },
      });
  }

  downloadXml(): void {
    const doc = this.document();
    if (!doc?.xml_document) return;
    downloadSupportXml(doc.invoice_number, doc.xml_document);
  }

  reload(): void {
    const id = this.documentId();
    if (id != null) this.load(id);
  }

  queryDian(): void {
    const doc = this.document();
    if (!doc || !this.canQueryDian() || this.dianChecking()) return;
    this.dianRequest?.unsubscribe();
    const generation = this.requestGeneration;
    this.dianChecking.set(true);
    this.dianError.set(null);
    this.dianRequest = this.service
      .getDianStatus(doc.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (generation !== this.requestGeneration) return;
          this.dianChecking.set(false);
          this.dianStatus.set(response?.data ?? null);
        },
        error: (error: unknown) => {
          if (generation !== this.requestGeneration) return;
          this.dianChecking.set(false);
          this.dianError.set(
            describeApiFailure(error).message ?? 'No fue posible consultar el estado en la DIAN.',
          );
        },
      });
  }

  requestAdjustment(): void {
    const doc = this.document();
    if (!doc || !this.canAdjust() || this.acting()) return;
    this.adjust.emit({
      id: doc.id,
      invoice_number: doc.invoice_number,
      supplier_id: doc.supplier_id ?? doc.supplier?.id ?? null,
    });
    this.isOpen.set(false);
  }

  async voidDocument(): Promise<void> {
    const doc = this.document();
    if (!doc || !this.canVoid() || this.acting()) return;
    const confirmed = await this.dialog.confirm({
      title: 'Anular documento soporte',
      message: `La DIAN rechazó el documento ${doc.invoice_number}. Al anularlo queda fuera de la operación y su consecutivo no se reutiliza.`,
      confirmText: 'Anular',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.runAction(this.service.voidDocument(doc.id), 'Documento anulado.', 'No se pudo anular el documento.');
  }

  async discard(): Promise<void> {
    const doc = this.document();
    if (!doc || !this.canDiscard() || this.acting()) return;
    const confirmed = await this.dialog.confirm({
      title: 'Descartar documento soporte',
      message: `El documento ${doc.invoice_number} nunca se envió a la DIAN. Al descartarlo queda cancelado.`,
      confirmText: 'Descartar',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.runAction(this.service.cancelDocument(doc.id), 'Documento descartado.', 'No se pudo descartar el documento.');
  }

  async copyCuds(): Promise<void> {
    const key = this.cuds();
    if (!key) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(key);
      this.toast.success('CUDS copiado.');
    } catch {
      this.toast.error('No se pudo copiar el CUDS.');
    }
  }

  onClose(): void {
    if (this.acting()) return;
    this.isOpen.set(false);
  }

  get isOpenModel(): typeof this.isOpen {
    return this.isOpen;
  }

  private runAction(
    request: ReturnType<SupportDocumentService['voidDocument']>,
    successMessage: string,
    fallbackError: string,
  ): void {
    const id = this.document()?.id;
    if (id == null) return;
    this.acting.set(true);
    this.actionError.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.acting.set(false);
        this.toast.success(successMessage);
        if (response?.data) this.changed.emit(response.data);
        this.load(id);
      },
      error: (error: unknown) => {
        this.acting.set(false);
        this.actionError.set(describeApiFailure(error).message ?? fallbackError);
      },
    });
  }

  private load(id: number): void {
    this.loadRequest?.unsubscribe();
    this.dianRequest?.unsubscribe();
    this.notesRequest?.unsubscribe();
    this.notesLoading.set(false);
    const generation = ++this.requestGeneration;
    this.loading.set(true);
    this.loadError.set(null);
    this.dianStatus.set(null);
    this.dianError.set(null);
    this.dianChecking.set(false);
    this.loadRequest = this.service
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (generation !== this.requestGeneration) return;
          this.loading.set(false);
          this.document.set(response?.data ?? null);
          this.loadNotes(response?.data ?? null, generation);
        },
        error: (error: unknown) => {
          if (generation !== this.requestGeneration) return;
          this.loading.set(false);
          this.document.set(null);
          this.loadError.set(
            describeApiFailure(error).message ?? 'No se pudo cargar el documento soporte.',
          );
        },
      });
  }

  private loadNotes(doc: SupportDocumentDetail | null, generation: number): void {
    this.notesRequest?.unsubscribe();
    this.notes.set([]);
    this.notesError.set(null);
    if (!doc || String(doc.invoice_type) !== 'support_document') return;
    this.notesLoading.set(true);
    this.notesRequest = this.invoicing
      .listNotes(doc.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (generation !== this.requestGeneration) return;
          this.notesLoading.set(false);
          this.notes.set(response?.data ?? []);
        },
        error: (error: unknown) => {
          if (generation !== this.requestGeneration) return;
          this.notesLoading.set(false);
          this.notesError.set(
            describeApiFailure(error).message ?? 'No se pudieron cargar las notas de ajuste.',
          );
        },
      });
  }

  private clear(): void {
    this.requestGeneration++;
    this.loadRequest?.unsubscribe();
    this.dianRequest?.unsubscribe();
    this.notesRequest?.unsubscribe();
    this.notes.set([]);
    this.notesLoading.set(false);
    this.notesError.set(null);
    this.liveRejection.set(null);
    this.document.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    this.dianStatus.set(null);
    this.dianError.set(null);
    this.dianChecking.set(false);
    this.actionError.set(null);
  }
}
