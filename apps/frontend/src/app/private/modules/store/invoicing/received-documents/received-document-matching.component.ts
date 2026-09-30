import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';
import { CardComponent } from '../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatDateOnlyUTC, formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type {
  ReceivedDocument,
  ReceivedDocumentItem,
  ReceivedDocumentMatchAllocation,
  ReceivedDocumentMatchAllocationsResponse,
  ReceivedDocumentMatchCandidate,
  ReceivedDocumentMatchCandidateLine,
  ReceivedDocumentsScope,
} from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

const WARNING_LABELS: Record<string, string> = {
  DOCUMENT_LINES_LIMIT_REACHED: 'Hay más líneas de las que se muestran; la comparación puede estar incompleta.',
  DOCUMENT_REQUIRES_REVIEW: 'El documento todavía requiere revisión de sus datos.',
  DOCUMENT_CURRENCY_NOT_COP: 'La moneda del documento no es COP; verifica la moneda antes de comparar importes.',
  PO_CURRENCY_NOT_STORED: 'La moneda de la orden de compra no está registrada; sus importes no se pueden validar por moneda.',
  EXPENSE_MATCH_REQUIRES_MANUAL_SELECTION: 'Los gastos sólo se pueden elegir manualmente en esta etapa.',
  ISSUER_TAX_ID_MISSING: 'El documento no informa NIT del proveedor.',
  SUPPLIER_LOOKUP_LIMIT_REACHED: 'La búsqueda de proveedores alcanzó su límite; no se generaron sugerencias parciales.',
  SUPPLIER_CATALOG_LIMIT_REACHED: 'El catálogo del proveedor superó el límite de búsqueda; algunos códigos no se compararon.',
  SUPPLIER_MATCH_AMBIGUOUS: 'Hay más de un proveedor con el mismo NIT; las sugerencias requieren revisión.',
  SUPPLIER_NOT_FOUND: 'No se encontró un proveedor con el NIT del documento.',
  NO_PO_CANDIDATES: 'No se encontraron órdenes de compra candidatas con el proveedor y contexto actuales.',
  PO_CANDIDATE_SEARCH_LIMIT_REACHED: 'La búsqueda de órdenes alcanzó su límite; puede haber otras órdenes candidatas.',
  PO_LINES_LIMIT_REACHED: 'La orden tiene más líneas de las que se muestran.',
  PO_LINE_CROSS_ORGANIZATION_PRODUCT_EXCLUDED: 'Se excluyeron líneas con productos de otra organización.',
  RECEPTIONS_LIMIT_REACHED: 'Hay más recepciones de las que se muestran.',
  RECEPTION_ITEMS_LIMIT_REACHED: 'Hay más líneas de recepción de las que se muestran.',
  UNIT_OF_MEASURE_REQUIRES_REVIEW: 'La unidad de medida no coincide; compara cantidades manualmente.',
  CENTRAL_LOCATION_REQUIRES_REVIEW: 'La orden va a una bodega central; confirma la tienda receptora.',
  NO_RECEIPT_RECORDED: 'La orden candidata aún no tiene recepción física registrada.',
  PARTIAL_RECEIPT: 'La orden tiene una recepción parcial.',
};

const REASON_LABELS: Record<string, string> = {
  EXACT_SUPPLIER_INVOICE_REFERENCE: 'La referencia de factura del proveedor coincide exactamente.',
  EXACT_SUPPLIER_OR_PRODUCT_CODE: 'Coincide el código del proveedor o del producto.',
  EXACT_SKU_OR_SUPPLIER_CODE: 'Coincide exactamente un SKU o código del proveedor.',
  EXACT_PRODUCT_ID: 'Coincide exactamente un producto del catálogo.',
  INVOICE_DATE_MATCH: 'La fecha de factura coincide con la fecha registrada.',
  ORDER_DATE_NEAR_INVOICE_WEAK: 'La fecha de orden está cerca de la fecha de factura; es una señal débil.',
  TOTAL_AMOUNT_MATCH_WEAK: 'El total coincide, pero el total por sí solo no confirma la relación.',
  TOTAL_AMOUNT_CLOSE_WEAK: 'El total es parecido; es una señal débil y la moneda de la orden no está confirmada.',
  CENTRAL_LOCATION_MANUAL_REVIEW: 'La orden va a una bodega central; confirma la tienda receptora.',
  SUPPLIER_INVOICE_REFERENCE_MISSING: 'La orden no tiene referencia de factura del proveedor.',
  DOCUMENT_REQUIRES_REVIEW: 'El documento requiere revisión antes de usar estas señales.',
  DOCUMENT_CURRENCY_NOT_COP: 'La moneda del documento no es COP.',
  PO_CURRENCY_NOT_STORED: 'La moneda de la orden de compra no está registrada.',
  MATCH_EVIDENCE_TRUNCATED_REQUIRES_REVIEW: 'Parte de la evidencia está truncada; revisa la orden completa.',
  DESCRIPTION_SIMILARITY_WEAK: 'La descripción se parece; es una señal débil.',
  DOCUMENT_UOM_MISSING: 'La línea del documento no informa unidad de medida.',
  UOM_REQUIRES_REVIEW: 'La unidad de medida requiere revisión manual.',
  SKU_OR_PRODUCT_MATCH_AMBIGUOUS: 'La coincidencia de producto no es única.',
  STORE_CONTEXT_MISMATCH: 'La tienda de la orden no coincide con el alcance operativo actual.',
};

@Component({
  selector: 'app-received-document-matching',
  standalone: true,
  imports: [CardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './received-document-matching.component.html',
})
export class ReceivedDocumentMatchingComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ReceivedDocumentsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly storeSettings = inject(StoreSettingsFacade);

  readonly document = input.required<ReceivedDocument>();
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly storeId = input<number | null>(null);

  readonly candidates = signal<ReceivedDocumentMatchCandidate[]>([]);
  readonly warnings = signal<string[]>([]);
  readonly allocations = signal<ReceivedDocumentMatchAllocation[]>([]);
  readonly documentVersion = signal<number | null>(null);
  readonly matchingStatus = signal<string>('pending');
  readonly lineBalances = signal<ReceivedDocumentMatchAllocationsResponse['lines']>([]);
  readonly targetBalances = signal<ReceivedDocumentMatchAllocationsResponse['targets']>([]);
  readonly receiptTargets = signal<ReceivedDocumentMatchAllocationsResponse['receipt_targets']>([]);
  readonly candidatesLoading = signal(false);
  readonly allocationsLoading = signal(false);
  readonly candidatesError = signal<string | null>(null);
  readonly allocationsError = signal<string | null>(null);
  readonly allocationsLoaded = signal(false);

  private epoch = 0;
  private lastContextKey = '';
  private candidatesRequest?: Subscription;
  private allocationsRequest?: Subscription;

  constructor() {
    effect(() => {
      const document = this.document();
      const scope = this.scope();
      const storeId = this.storeId();
      const key = `${scope}:${storeId ?? ''}:${document.id}:${document.version}`;
      if (key === this.lastContextKey) return;
      this.lastContextKey = key;
      untracked(() => this.loadForContext(document, scope, storeId));
    });
    this.destroyRef.onDestroy(() => this.cancelRequests());
  }

  reload(): void {
    this.loadForContext(this.document(), this.scope(), this.storeId());
  }

  candidateRetry(): void {
    this.candidatesRequest?.unsubscribe();
    this.fetchCandidates(this.document(), this.scope(), this.storeId(), this.epoch);
  }

  allocationRetry(): void {
    this.allocationsRequest?.unsubscribe();
    this.fetchAllocations(this.document(), this.scope(), this.storeId(), this.epoch);
  }

  matchingStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      unlinked: 'Sin conciliación',
      partially_linked: 'Conciliación parcial',
      linked: 'Conciliación registrada',
      reviewed: 'Revisión requerida',
    };
    return labels[value] ?? this.humanizeCode(value);
  }

  reasonLabel(code: string): string { return REASON_LABELS[code] ?? this.humanizeCode(code); }
  warningLabel(code: string): string { return WARNING_LABELS[code] ?? this.humanizeCode(code); }
  tierLabel(tier: 'strong' | 'review'): string { return tier === 'strong' ? 'Evidencia fuerte' : 'Requiere revisión'; }

  documentLinesFor(candidateLine: ReceivedDocumentMatchCandidateLine): ReceivedDocumentItem[] {
    const ids = new Set(candidateLine.matched_document_item_ids);
    return (this.document().items ?? []).filter((line) => line.id != null && ids.has(line.id));
  }

  receiptRows(candidate: ReceivedDocumentMatchCandidate, purchaseOrderItemId: number): Array<{
    receptionId: number;
    receivedAt: string;
    quantity: string;
    note: string | null;
  }> {
    return candidate.receptions.flatMap((reception) => reception.items
      .filter((item) => item.purchase_order_item_id === purchaseOrderItemId)
      .map((item) => ({
        receptionId: reception.id,
        receivedAt: reception.received_at,
        quantity: item.quantity_received,
        note: item.note,
      })));
  }

  allocationTarget(allocation: ReceivedDocumentMatchAllocation): string {
    if (allocation.purchase_order_item_id != null) {
      const order = allocation.purchase_order_id == null ? 'OC' : `OC #${allocation.purchase_order_id}`;
      const reception = allocation.reception_id == null ? '' : ` · recepción #${allocation.reception_id}`;
      return `${order}, línea #${allocation.purchase_order_item_id}${reception}`;
    }
    if (allocation.expense_item_id != null) return `Gasto #${allocation.expense_id ?? '—'}, línea #${allocation.expense_item_id}`;
    return allocation.expense_id == null ? 'Destino no disponible' : `Gasto #${allocation.expense_id}`;
  }

  statusLabel(status: string): string {
    if (status === 'active') return 'Activa';
    if (status === 'revoked') return 'Revocada';
    return this.humanizeCode(status);
  }

  targetTypeLabel(type: string): string {
    if (type === 'purchase_order_item') return 'Línea de orden';
    if (type === 'expense_item') return 'Línea de gasto';
    if (type === 'expense') return 'Gasto';
    return this.humanizeCode(type);
  }

  receiptStateLabel(state: string | null | undefined): string {
    if (state === 'received') return 'Mercancía recibida';
    if (state === 'receipt_pending') return 'Recepción registrada, cantidad pendiente';
    if (state === 'receipt_not_linked') return 'Sin recepción física vinculada';
    return 'Estado de recepción no disponible';
  }

  money(value: string | null | undefined, currency: string | null | undefined): string {
    if (value == null || value === '') return 'Importe no informado';
    const code = currency?.trim().toUpperCase();
    if (!code || !/^[A-Z]{3}$/.test(code)) return `${value} · moneda no identificada`;
    const tenantCurrency = this.currency.currentCurrency();
    if (tenantCurrency?.code.toUpperCase() === code) return this.currency.format(value, 2);
    return `${value} ${code}`;
  }

  poMoney(value: string | null | undefined): string {
    return value == null || value === ''
      ? 'Importe no disponible'
      : `${value} · moneda de OC no registrada`;
  }

  dateOnly(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : 'Fecha no informada';
  }

  dateTime(value: string | null | undefined): string {
    if (!value) return 'Fecha no informada';
    const timezone = this.storeSettings.timezone() || 'America/Bogota';
    return formatStoreDateTime(value, timezone, { dateStyle: 'short', timeStyle: 'short' }) || 'Fecha no disponible';
  }

  private loadForContext(document: ReceivedDocument, scope: ReceivedDocumentsScope, storeId: number | null): void {
    this.epoch++;
    const epoch = this.epoch;
    this.cancelRequests();
    this.candidates.set([]);
    this.warnings.set([]);
    this.allocations.set([]);
    this.lineBalances.set([]);
    this.targetBalances.set([]);
    this.receiptTargets.set([]);
    this.documentVersion.set(null);
    this.matchingStatus.set('pending');
    this.candidatesError.set(null);
    this.allocationsError.set(null);
    this.allocationsLoaded.set(false);
    this.fetchCandidates(document, scope, storeId, epoch);
    this.fetchAllocations(document, scope, storeId, epoch);
  }

  private fetchCandidates(document: ReceivedDocument, scope: ReceivedDocumentsScope, storeId: number | null, epoch: number): void {
    this.candidatesLoading.set(true);
    this.candidatesError.set(null);
    this.candidatesRequest = this.api.getMatchCandidates(scope, document.id, {}, storeId ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => {
        if (epoch === this.epoch) this.candidatesLoading.set(false);
      }))
      .subscribe({
        next: (response) => {
          if (epoch !== this.epoch || document.id !== this.document().id || scope !== this.scope() || storeId !== this.storeId()) return;
          if (!response?.success || !response.data) {
            this.candidatesError.set('El servidor no confirmó la consulta de sugerencias.');
            return;
          }
          this.candidates.set(response.data.candidates ?? []);
          this.warnings.set(response.data.warnings ?? []);
        },
        error: (error: unknown) => {
          if (epoch === this.epoch) this.candidatesError.set(describeApiFailure(error).message || 'No se pudieron cargar las sugerencias de compra.');
        },
      });
  }

  private fetchAllocations(document: ReceivedDocument, scope: ReceivedDocumentsScope, storeId: number | null, epoch: number): void {
    this.allocationsLoading.set(true);
    this.allocationsError.set(null);
    this.allocationsRequest = this.api.getMatchAllocations(scope, document.id, storeId ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => {
        if (epoch === this.epoch) this.allocationsLoading.set(false);
      }))
      .subscribe({
        next: (response) => {
          if (epoch !== this.epoch || document.id !== this.document().id || scope !== this.scope() || storeId !== this.storeId()) return;
          if (!response?.success || !response.data) {
            this.allocationsError.set('El servidor no confirmó la consulta de asignaciones.');
            return;
          }
          const data = response.data;
          this.allocations.set(data.allocations ?? []);
          this.documentVersion.set(data.document_version);
          this.matchingStatus.set(data.matching_status);
          this.lineBalances.set(data.lines ?? []);
          this.targetBalances.set(data.targets ?? []);
          this.receiptTargets.set(data.receipt_targets ?? []);
          this.allocationsLoaded.set(true);
        },
        error: (error: unknown) => {
          if (epoch === this.epoch) this.allocationsError.set(describeApiFailure(error).message || 'No se pudieron cargar las asignaciones registradas.');
        },
      });
  }

  private cancelRequests(): void {
    this.candidatesRequest?.unsubscribe();
    this.allocationsRequest?.unsubscribe();
    this.candidatesRequest = undefined;
    this.allocationsRequest = undefined;
  }

  private humanizeCode(value: string): string {
    return value.replace(/_/g, ' ').toLocaleLowerCase();
  }
}
