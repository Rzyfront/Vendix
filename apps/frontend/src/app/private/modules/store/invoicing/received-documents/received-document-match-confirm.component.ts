import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, finalize, map, startWith } from 'rxjs';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type {
  ConfirmReceivedDocumentMatchInput,
  ReceivedDocument,
  ReceivedDocumentMatchCandidate,
  ReceivedDocumentMatchCandidateLine,
  ReceivedDocumentMatchLineBalance,
  ReceivedDocumentMatchReceiptTarget,
  ReceivedDocumentMatchTargetBalance,
  ReceivedDocumentsScope,
} from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

type MatchForm = FormGroup<{
  source_quantity: FormControl<string>;
  target_quantity: FormControl<string>;
  allocated_net_amount: FormControl<string>;
  target_unit_code: FormControl<string>;
  manual_reason: FormControl<string>;
}>;

const POSITIVE_QUANTITY = /^(?=.*[1-9])(?:0|[1-9]\d{0,10})(?:\.\d{1,4})?$/;
const NON_NEGATIVE_MONEY = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;

@Component({
  selector: 'app-received-document-match-confirm',
  standalone: true,
  imports: [ModalComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './received-document-match-confirm.component.html',
  styles: [`.field{display:flex;flex-direction:column;gap:.375rem;color:var(--color-text-primary);font-size:.875rem;font-weight:500}.field input,.field select,.field textarea{min-height:2.75rem;width:100%;border:1px solid var(--color-border);border-radius:.5rem;background:var(--color-background);padding:.5rem .75rem;color:var(--color-text-primary);font-size:.875rem;font-weight:400}.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--color-primary);outline-offset:1px}`],
})
export class ReceivedDocumentMatchConfirmComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthFacade);
  private readonly api = inject(ReceivedDocumentsService);
  private readonly currency = inject(CurrencyFormatService);

  readonly document = input.required<ReceivedDocument>();
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly storeId = input<number | null>(null);
  readonly candidates = input.required<ReceivedDocumentMatchCandidate[]>();
  readonly lineBalances = input.required<ReceivedDocumentMatchLineBalance[]>();
  readonly targetBalances = input.required<ReceivedDocumentMatchTargetBalance[]>();
  readonly receiptTargets = input.required<ReceivedDocumentMatchReceiptTarget[]>();
  readonly documentVersion = input<number | null>(null);
  readonly allocationsLoaded = input(false);
  readonly isOpen = model(false);
  readonly changed = output<void>();
  readonly reloadRequested = output<void>();

  readonly confirmationOpen = signal(false);
  readonly selectedDocumentItemId = signal<number | null>(null);
  readonly selectedPurchaseOrderId = signal<number | null>(null);
  readonly selectedPurchaseOrderItemId = signal<number | null>(null);
  readonly selectedReceptionItemKey = signal<string>('');
  readonly pending = signal(false);
  readonly conflict = signal(false);
  readonly submitAttempted = signal(false);
  readonly error = signal<string | null>(null);
  readonly idempotencyKey = signal(crypto.randomUUID());
  readonly form: MatchForm = this.createForm();
  readonly formStatus = toSignal(this.form.statusChanges.pipe(startWith(this.form.status)), { initialValue: this.form.status });
  readonly formValues = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue()), startWith(this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  readonly permission = computed(() => this.auth.hasPermission(`${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:match:confirm`));
  readonly eligible = computed(() => {
    const doc = this.document();
    const terminal = ['recognized', 'accepted', 'posted'].includes(doc.fiscal_status)
      || ['recognized', 'accepted', 'posted'].includes(doc.posting_status)
      || !!doc.accepted_at;
    return doc.processing_status === 'ready' && doc.validation_status === 'valid' && !terminal;
  });
  readonly sourceLines = computed(() => (this.document().items ?? []).filter((item) => item.id != null));
  readonly selectedCandidate = computed(() => this.candidates().find((candidate) => candidate.purchase_order_id === this.selectedPurchaseOrderId()) ?? null);
  readonly selectedTargetLine = computed(() => this.selectedCandidate()?.items.find((item) => item.id === this.selectedPurchaseOrderItemId()) ?? null);
  readonly selectedSourceLine = computed(() => this.sourceLines().find((line) => line.id === this.selectedDocumentItemId()) ?? null);
  readonly selectedSourceBalance = computed(() => this.lineBalances().find((line) => line.document_item_id === this.selectedDocumentItemId()) ?? null);
  readonly selectedTargetBalance = computed(() => {
    const id = this.selectedPurchaseOrderItemId();
    if (id == null) return null;
    const allocationBalance = this.targetBalances().find((target) => target.target_type === 'purchase_order_item' && target.target_id === id);
    if (allocationBalance) return allocationBalance;
    const candidateLine = this.selectedTargetLine();
    if (!candidateLine || candidateLine.id !== id) return null;
    return {
      target_type: 'purchase_order_item' as const,
      target_id: candidateLine.id,
      allocated_quantity: candidateLine.allocated_quantity,
      remaining_quantity: candidateLine.remaining_quantity,
      quantity_ordered: candidateLine.quantity_ordered,
      quantity_received: candidateLine.quantity_received,
      current_document_allocated_quantity: '0',
    };
  });
  readonly selectedReceipt = computed(() => {
    const [receptionId, itemId] = this.parseReceptionKey(this.selectedReceptionItemKey());
    return receptionId == null || itemId == null ? null : { receptionId, itemId };
  });
  readonly selectedReceiptBalance = computed(() => {
    const receipt = this.selectedReceipt();
    if (!receipt) return null;
    const allocated = this.receiptTargets().find((row) => row.reception_id === receipt.receptionId && row.reception_item_id === receipt.itemId);
    if (allocated) return allocated;
    for (const reception of this.selectedCandidate()?.receptions ?? []) {
      if (reception.id !== receipt.receptionId) continue;
      const item = reception.items.find((row) => row.id === receipt.itemId);
      if (item) return { ...item, reception_id: reception.id, reception_item_id: item.id };
    }
    return null;
  });
  readonly requiresManualReason = computed(() => {
    const target = this.selectedTargetLine();
    const source = this.selectedSourceLine();
    const targetUnit = this.targetUnit(target);
    const sourceUnit = source?.unit_code?.trim().toLocaleLowerCase() ?? '';
    return !!this.selectedCandidate()?.location.is_central_warehouse
      || target?.purchase_uom_id == null
      || !targetUnit
      || !sourceUnit
      || sourceUnit !== targetUnit.toLocaleLowerCase();
  });
  readonly targetUnitRequired = computed(() => this.selectedTargetLine() != null && !this.targetUnit(this.selectedTargetLine()));
  readonly targetQuantityRequired = computed(() => {
    const sourceUnit = this.selectedSourceLine()?.unit_code?.trim().toLocaleLowerCase() ?? '';
    const targetUnit = this.formValues().target_unit_code.trim().toLocaleLowerCase();
    return !sourceUnit || !targetUnit || sourceUnit !== targetUnit;
  });
  readonly canConfirm = computed(() => this.permission() && this.eligible() && this.allocationsLoaded()
    && this.documentVersion() != null && !this.pending() && !this.conflict()
    && this.formStatus() === 'VALID' && this.selectedDocumentItemId() != null
    && this.selectedPurchaseOrderId() != null && this.selectedPurchaseOrderItemId() != null
    && (!this.targetUnitRequired() || this.formValues().target_unit_code.trim().length > 0)
    && (!this.targetQuantityRequired() || this.formValues().target_quantity.trim().length > 0)
    && (!this.requiresManualReason() || this.formValues().manual_reason.trim().length >= 10));
  readonly canClose = (): boolean => !this.pending();
  readonly targetUnitLocked = computed(() => this.selectedTargetLine()?.purchase_uom_id != null
    && !!this.selectedTargetLine()?.purchase_uom_code?.trim());

  private request?: Subscription;
  private lastResetKey = '';

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.idempotencyKey.set(crypto.randomUUID()));
    effect(() => {
      const open = this.isOpen();
      const doc = this.document();
      const scope = this.scope();
      const storeId = this.storeId();
      const key = `${open}:${scope}:${storeId ?? ''}:${doc.id}:${doc.version}`;
      if (key === this.lastResetKey) return;
      this.lastResetKey = key;
      untracked(() => this.resetSession());
    });
  }

  openForm(): void {
    if (!this.permission() || !this.eligible() || !this.allocationsLoaded()) return;
    this.isOpen.set(true);
  }

  selectSource(event: Event): void {
    const id = this.readId(event);
    this.selectedDocumentItemId.set(id);
    this.rotateIdempotencyKey();
    const balance = this.lineBalances().find((row) => row.document_item_id === id);
    this.form.patchValue({
      source_quantity: balance?.remaining_quantity ?? '',
      allocated_net_amount: balance?.remaining_net_amount ?? '',
    });
  }

  selectPurchaseOrder(event: Event): void {
    this.selectedPurchaseOrderId.set(this.readId(event));
    this.rotateIdempotencyKey();
    this.selectedPurchaseOrderItemId.set(null);
    this.selectedReceptionItemKey.set('');
    this.form.patchValue({ target_unit_code: '', target_quantity: '' });
    this.form.controls.manual_reason.updateValueAndValidity();
  }

  selectPurchaseOrderItem(event: Event): void {
    const id = this.readId(event);
    this.selectedPurchaseOrderItemId.set(id);
    this.rotateIdempotencyKey();
    this.selectedReceptionItemKey.set('');
    this.form.patchValue({ target_unit_code: this.targetUnit(this.selectedTargetLine()), target_quantity: '' });
    this.form.controls.manual_reason.updateValueAndValidity();
  }

  selectReception(event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    this.selectedReceptionItemKey.set(value);
    this.rotateIdempotencyKey();
  }

  receptionsForSelectedLine(): Array<{ key: string; label: string; target: ReceivedDocumentMatchReceiptTarget | null; allocatedQuantity: string; remainingQuantity: string }> {
    const candidate = this.selectedCandidate();
    const lineId = this.selectedPurchaseOrderItemId();
    if (!candidate || lineId == null) return [];
    return candidate.receptions.flatMap((reception) => reception.items
      .filter((item) => item.purchase_order_item_id === lineId)
      .map((item) => {
        const target = this.receiptTargets().find((row) => row.reception_id === reception.id && row.reception_item_id === item.id) ?? null;
        return {
          key: `${reception.id}:${item.id}`,
          label: `Recepción #${reception.id} · línea #${item.id} · recibido ${item.quantity_received} · asignado global ${target?.allocated_quantity ?? item.allocated_quantity} · restante ${target?.remaining_quantity ?? item.remaining_quantity}`,
          target,
          allocatedQuantity: target?.allocated_quantity ?? item.allocated_quantity,
          remainingQuantity: target?.remaining_quantity ?? item.remaining_quantity,
        };
      }));
  }

  needsReason(): boolean { return this.requiresManualReason(); }
  unitForLine(line: ReceivedDocumentMatchCandidateLine): string { return this.targetUnit(line) || 'unidad no registrada'; }
  lineBalance(documentItemId: number | undefined): ReceivedDocumentMatchLineBalance | undefined {
    return documentItemId == null ? undefined : this.lineBalances().find((balance) => balance.document_item_id === documentItemId);
  }
  sourceLineAvailable(documentItemId: number | undefined): boolean {
    const balance = this.lineBalance(documentItemId);
    return !!balance && this.isPositiveDecimal(balance.remaining_quantity);
  }
  poAmount(value: string | null): string { return value == null ? 'No disponible · moneda de OC no registrada' : `${value} · moneda de OC no registrada`; }
  documentMoney(value: string | null | undefined): string {
    if (value == null || value === '') return 'Importe no disponible';
    const code = this.document().currency?.trim().toUpperCase();
    if (!code || !/^[A-Z]{3}$/.test(code)) return `${value} · moneda no identificada`;
    const tenant = this.currency.currentCurrency();
    return tenant?.code.toUpperCase() === code ? this.currency.format(value, 2) : `${value} ${code}`;
  }

  prepareConfirmation(): void {
    this.submitAttempted.set(true);
    this.form.markAllAsTouched();
    if (!this.canConfirm()) return;
    this.confirmationOpen.set(true);
  }

  confirm(): void {
    if (!this.canConfirm()) return;
    const docItem = this.selectedDocumentItemId();
    const poId = this.selectedPurchaseOrderId();
    const poItemId = this.selectedPurchaseOrderItemId();
    const version = this.documentVersion();
    if (docItem == null || poId == null || poItemId == null || version == null) return;
    const raw = this.form.getRawValue();
    const receipt = this.selectedReceipt();
    const payload: ConfirmReceivedDocumentMatchInput = {
      expected_version: version,
      idempotency_key: this.idempotencyKey(),
      document_item_id: docItem,
      purchase_order_id: poId,
      purchase_order_item_id: poItemId,
      ...(receipt ? { reception_id: receipt.receptionId, reception_item_id: receipt.itemId } : {}),
      source_quantity: raw.source_quantity,
      ...(raw.target_quantity ? { target_quantity: raw.target_quantity } : {}),
      allocated_net_amount: raw.allocated_net_amount,
      ...(raw.target_unit_code.trim() ? { target_unit_code: raw.target_unit_code.trim() } : {}),
      ...(raw.manual_reason.trim() ? { manual_reason: raw.manual_reason.trim() } : {}),
    };
    this.pending.set(true);
    this.error.set(null);
    this.request = this.api.confirmMatch(this.scope(), this.document().id, payload, this.storeId() ?? undefined)
      .pipe(finalize(() => this.pending.set(false)))
      .subscribe({
        next: (response) => {
          if (!response?.success || !response.data?.allocation) {
            this.error.set('El servidor no confirmó la asignación. Verifica el historial antes de intentar otra vez.');
            this.confirmationOpen.set(false);
            return;
          }
          this.confirmationOpen.set(false);
          this.isOpen.set(false);
          this.idempotencyKey.set(crypto.randomUUID());
          this.changed.emit();
        },
        error: (failure: unknown) => {
          const status = typeof failure === 'object' && failure !== null && 'status' in failure ? Number((failure as { status?: unknown }).status) : 0;
          if (status === 409) {
            this.conflict.set(true);
            this.confirmationOpen.set(false);
            this.error.set('El documento cambió desde la última consulta. Recarga asignaciones y saldos antes de confirmar otra vez.');
            return;
          }
          this.error.set(describeApiFailure(failure).message || 'No se pudo confirmar la asignación.');
          this.confirmationOpen.set(false);
        },
      });
  }

  reloadAfterConflict(): void {
    this.request?.unsubscribe();
    this.isOpen.set(false);
    this.confirmationOpen.set(false);
    this.reloadRequested.emit();
  }

  onClosed(): void { this.resetSession(); }

  formValue(field: 'target_unit_code' | 'manual_reason' | 'target_quantity'): string { return this.formValues()[field]; }

  private createForm(): MatchForm {
    return this.fb.nonNullable.group({
      source_quantity: ['', [Validators.required, Validators.pattern(POSITIVE_QUANTITY)]],
      target_quantity: ['', [Validators.pattern(POSITIVE_QUANTITY)]],
      allocated_net_amount: ['', [Validators.required, Validators.pattern(NON_NEGATIVE_MONEY)]],
      target_unit_code: ['', [Validators.maxLength(30)]],
      manual_reason: ['', [Validators.maxLength(500)]],
    }) as MatchForm;
  }

  private resetSession(): void {
    this.request?.unsubscribe();
    this.request = undefined;
    this.pending.set(false);
    this.confirmationOpen.set(false);
    this.selectedDocumentItemId.set(null);
    this.selectedPurchaseOrderId.set(null);
    this.selectedPurchaseOrderItemId.set(null);
    this.selectedReceptionItemKey.set('');
    this.conflict.set(false);
    this.submitAttempted.set(false);
    this.error.set(null);
    this.rotateIdempotencyKey();
    this.form.reset({ source_quantity: '', target_quantity: '', allocated_net_amount: '', target_unit_code: '', manual_reason: '' });
  }

  private targetUnit(line: ReceivedDocumentMatchCandidateLine | null): string {
    return line?.purchase_uom_code?.trim() || line?.product_purchase_uom_code?.trim() || '';
  }

  private rotateIdempotencyKey(): void { this.idempotencyKey.set(crypto.randomUUID()); }

  private isPositiveDecimal(value: string): boolean {
    return /[1-9]/.test(value.replace(/[.]/g, ''));
  }

  private readId(event: Event): number | null {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    if (!/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
  }

  private parseReceptionKey(value: string): [number | null, number | null] {
    const [receptionId, itemId] = value.split(':');
    const parse = (raw: string | undefined): number | null => raw && /^[1-9]\d*$/.test(raw) && Number(raw) <= 2147483647 ? Number(raw) : null;
    return [parse(receptionId), parse(itemId)];
  }
}
