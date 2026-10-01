import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type { ManualReceivedDocumentInput, ManualReceivedDocumentItemInput, ManualReceivedDocumentTaxInput, ReceivedDocument, ReceivedDocumentReviewInput, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

type TaxForm = FormGroup<{
  tax_type: FormControl<string>; scheme_code: FormControl<string>; tax_basis_type: FormControl<string>;
  base_quantity: FormControl<string>; base_unit_code: FormControl<string>; per_unit_amount: FormControl<string>;
  tax_name: FormControl<string>; rate: FormControl<string>; base_amount: FormControl<string>; amount: FormControl<string>;
}>;
type ItemForm = FormGroup<{
  external_code: FormControl<string>; description: FormControl<string>; quantity: FormControl<string>; unit_code: FormControl<string>;
  unit_price: FormControl<string>; discount_amount: FormControl<string>; net_amount: FormControl<string>; total_amount: FormControl<string>;
  taxes: FormArray<TaxForm>;
}>;
type DocumentForm = FormGroup<{
  document_type: FormControl<string>; invoice_number: FormControl<string>; document_key: FormControl<string>; reference_key: FormControl<string>; reference_number: FormControl<string>;
  issuer_tax_id: FormControl<string>; issuer_name: FormControl<string>; receiver_tax_id: FormControl<string>; receiver_name: FormControl<string>;
  issue_date: FormControl<string>; due_date: FormControl<string>; currency: FormControl<string>;
  subtotal_amount: FormControl<string>; discount_amount: FormControl<string>; charge_amount: FormControl<string>; tax_exclusive_amount: FormControl<string>;
  tax_inclusive_amount: FormControl<string>; tax_amount: FormControl<string>; total_amount: FormControl<string>; prepaid_amount: FormControl<string>;
  payable_rounding_amount: FormControl<string>; withholding_amount: FormControl<string>; reviewer_note: FormControl<string>;
  items: FormArray<ItemForm>; taxes: FormArray<TaxForm>;
}>;

const TAX_TYPES = ['iva', 'inc', 'ica', 'ibua', 'icui', 'withholding', 'reteiva', 'reteica', 'unclassified'];
const MONEY = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;
const NEGATIVE_MONEY = /^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;
const QUANTITY = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,4})?$/;
const UNIT_PRICE = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
const RATE = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,5})?$/;

@Component({
  selector: 'app-received-document-form', standalone: true,
  imports: [ModalComponent, ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './received-document-form.component.html',
  styles: [`.field{display:flex;flex-direction:column;gap:.375rem;color:var(--color-text-primary);font-size:.875rem;font-weight:500}.field input,.field select,.field textarea{min-height:2.75rem;width:100%;border:1px solid var(--color-border);border-radius:.5rem;background:var(--color-background);padding:.5rem .75rem;color:var(--color-text-primary);font-size:.875rem;font-weight:400}.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--color-primary);outline-offset:1px}`],
})
export class ReceivedDocumentFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(ReceivedDocumentsService);
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly document = input<ReceivedDocument | null>(null);
  readonly isOpen = model(false);
  readonly saved = output<number>();
  readonly reloadRequested = output<void>();
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly submitAttempted = signal(false);
  readonly overflow = signal<string[]>([]);
  readonly taxTypes = TAX_TYPES;
  readonly form: DocumentForm = this.createForm();
  readonly headerTaxes = this.form.controls.taxes;
  readonly items = this.form.controls.items;
  readonly canClose = (): boolean => !this.busy();
  readonly headerAmounts = [
    { key: 'subtotal_amount', label: 'Subtotal' }, { key: 'discount_amount', label: 'Descuento' },
    { key: 'charge_amount', label: 'Cargo' }, { key: 'tax_exclusive_amount', label: 'Base antes de impuestos' },
    { key: 'tax_inclusive_amount', label: 'Total con impuestos' }, { key: 'tax_amount', label: 'Impuestos' },
    { key: 'total_amount', label: 'Total documento' }, { key: 'prepaid_amount', label: 'Anticipos' },
    { key: 'payable_rounding_amount', label: 'Redondeo' }, { key: 'withholding_amount', label: 'Retenciones' },
  ] as const;
  private request?: Subscription;
  private lastKey = '';

  constructor() {
    effect(() => {
      const open = this.isOpen(); const scope = this.scope(); const store = this.selectedStoreId(); const doc = this.document();
      const key = `${open}:${scope}:${store ?? ''}:${doc?.id ?? 'new'}:${doc?.version ?? 0}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      untracked(() => this.reset(doc));
    });
  }

  get noteOnly(): boolean { return !!this.document() && !this.canEditFacts(this.document()!); }
  get isReview(): boolean { return this.document() !== null; }
  get documentTypeControl(): FormControl<string> { return this.form.controls.document_type; }
  taxLabel(type: string): string { return ({ iva: 'IVA', inc: 'INC', ica: 'ICA', ibua: 'IBUA', icui: 'ICUI', withholding: 'Retención', reteiva: 'ReteIVA', reteica: 'ReteICA', unclassified: 'Sin clasificar' } as Record<string, string>)[type] ?? 'Sin clasificar'; }

  addItem(): void { if (this.items.length < 500) this.items.push(this.createItem()); }
  removeItem(index: number): void { if (index >= 0 && index < this.items.length) this.items.removeAt(index); }
  addHeaderTax(): void { if (this.headerTaxes.length < 100) this.headerTaxes.push(this.createTax()); }
  removeHeaderTax(index: number): void { if (index >= 0 && index < this.headerTaxes.length) this.headerTaxes.removeAt(index); }
  itemTaxes(index: number): FormArray<TaxForm> { return this.items.at(index).controls.taxes; }
  addItemTax(index: number): void { const taxes = this.itemTaxes(index); if (taxes.length < 20) taxes.push(this.createTax()); }
  removeItemTax(itemIndex: number, taxIndex: number): void { this.itemTaxes(itemIndex).removeAt(taxIndex); }

  submit(): void {
    this.submitAttempted.set(true);
    if (this.busy() || this.conflict() || this.overflow().length > 0 || this.form.invalid) { this.form.markAllAsTouched(); return; }
    const doc = this.document();
    const facts = this.toPayload();
    this.busy.set(true); this.error.set(null);
    const request = doc
      ? this.service.updateReview(this.scope(), doc.id, this.reviewPayload(doc, facts), this.selectedStoreId() ?? undefined)
      : this.service.createManual(this.scope(), facts, this.selectedStoreId() ?? undefined);
    this.request = request.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))).subscribe({
      next: (response) => { this.isOpen.set(false); this.saved.emit(response.data.id); },
      error: (err: unknown) => {
        const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status?: unknown }).status) : 0;
        if (status === 409) { this.conflict.set(true); this.error.set('El documento cambió desde que lo abriste. Recarga el detalle antes de volver a guardar; no se aplicaron cambios.'); return; }
        this.error.set(describeApiFailure(err).message || 'No se pudo guardar la revisión.');
      },
    });
  }

  reloadConflict(): void { this.isOpen.set(false); this.reloadRequested.emit(); }
  onClosed(): void { this.request?.unsubscribe(); this.request = undefined; this.busy.set(false); this.error.set(null); this.conflict.set(false); this.overflow.set([]); this.submitAttempted.set(false); this.form.enable({ emitEvent: false }); this.form.reset(); this.items.clear(); this.headerTaxes.clear(); }
  private reset(doc: ReceivedDocument | null): void {
    this.request?.unsubscribe(); this.request = undefined; this.busy.set(false); this.error.set(null); this.conflict.set(false);
    this.form.enable({ emitEvent: false }); this.form.reset(); this.items.clear(); this.headerTaxes.clear(); this.overflow.set([]); this.submitAttempted.set(false);
    if (!this.isOpen()) return;
    const facts = doc ? this.snapshotFacts(doc) : {};
    this.form.patchValue({
      document_type: this.str(facts['document_type'] ?? doc?.document_type), invoice_number: this.str(facts['invoice_number'] ?? doc?.invoice_number),
      document_key: this.str(facts['document_key'] ?? doc?.document_key), reference_key: this.str(facts['reference_key'] ?? facts['original_reference_key']),
      reference_number: this.str(facts['reference_number'] ?? facts['original_reference_number']), issuer_tax_id: this.str(facts['issuer_tax_id'] ?? doc?.issuer_tax_id),
      issuer_name: this.str(facts['issuer_name'] ?? doc?.issuer_name), receiver_tax_id: this.str(facts['receiver_tax_id'] ?? doc?.receiver_tax_id), receiver_name: this.str(facts['receiver_name'] ?? doc?.receiver_name),
      issue_date: this.dateInput(facts['issue_date'] ?? doc?.issue_date), due_date: this.dateInput(facts['due_date'] ?? doc?.due_date), currency: this.str(facts['currency'] ?? doc?.currency),
      subtotal_amount: this.str(facts['subtotal_amount'] ?? doc?.subtotal_amount), discount_amount: this.str(facts['discount_amount'] ?? doc?.discount_amount),
      charge_amount: this.str(facts['charge_amount']), tax_exclusive_amount: this.str(facts['tax_exclusive_amount']), tax_inclusive_amount: this.str(facts['tax_inclusive_amount']),
      tax_amount: this.str(facts['tax_amount'] ?? doc?.tax_amount), total_amount: this.str(facts['total_amount'] ?? doc?.total_amount), prepaid_amount: this.str(facts['prepaid_amount']),
      payable_rounding_amount: this.str(facts['payable_rounding_amount']), withholding_amount: this.str(facts['withholding_amount']), reviewer_note: '',
    });
    if (this.canEditFacts(doc)) {
      const lineFacts = Array.isArray(facts['items']) ? facts['items'] : doc?.items ?? [];
      const overflowMessages: string[] = [];
      if (lineFacts.length > 500) overflowMessages.push(`El documento contiene ${lineFacts.length} líneas; el límite editable es 500. No se guardará una versión truncada.`);
      for (const line of lineFacts.slice(0, 500)) this.items.push(this.createItem(line as Record<string, unknown>));
      const taxFacts = Array.isArray(facts['taxes']) ? facts['taxes'] : (doc?.taxes ?? []).filter((tax) => tax.item_id == null);
      if (taxFacts.length > 100) overflowMessages.push(`Hay ${taxFacts.length} impuestos de cabecera; el límite editable es 100. No se guardará una versión truncada.`);
      for (const tax of taxFacts.slice(0, 100)) this.headerTaxes.push(this.createTax(tax as Record<string, unknown>));
      for (const [index, line] of lineFacts.slice(0, 500).entries()) {
        const nested = (line as Record<string, unknown>)['taxes'];
        if (Array.isArray(nested) && nested.length > 20) overflowMessages.push(`La línea ${index + 1} contiene ${nested.length} impuestos; el límite editable es 20. No se guardará una versión truncada.`);
      }
      this.overflow.set(overflowMessages);
    }
    if (doc && !this.canEditFacts(doc)) this.disableFacts();
  }

  private createForm(): DocumentForm {
    const text = (required = false) => new FormControl('', { nonNullable: true, validators: required ? [Validators.required] : [] });
    const money = (required = false) => new FormControl('', { nonNullable: true, validators: [...(required ? [Validators.required] : []), Validators.pattern(MONEY)] });
    return this.fb.group({
      document_type: text(true), invoice_number: text(true), document_key: text(), reference_key: text(), reference_number: text(),
      issuer_tax_id: text(true), issuer_name: text(true), receiver_tax_id: text(true), receiver_name: text(true), issue_date: text(true), due_date: text(), currency: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[A-Z]{3}$/)] }),
      subtotal_amount: money(true), discount_amount: money(true), charge_amount: money(), tax_exclusive_amount: money(), tax_inclusive_amount: money(), tax_amount: money(true), total_amount: money(true), prepaid_amount: money(), payable_rounding_amount: new FormControl('', { nonNullable: true, validators: [Validators.pattern(NEGATIVE_MONEY)] }), withholding_amount: money(), reviewer_note: text(),
      items: this.fb.array<ItemForm>([], { validators: [Validators.minLength(1)] }), taxes: this.fb.array<TaxForm>([]),
    }) as DocumentForm;
  }
  private createTax(value: Record<string, unknown> = {}): TaxForm {
    const c = (v: unknown, validators: readonly import('@angular/forms').ValidatorFn[] = []) => new FormControl(this.str(v), { nonNullable: true, validators: [...validators] });
    const metadata = this.metadata(value['metadata']);
    return this.fb.group({
      tax_type: c(value['tax_type'] ?? 'unclassified', [Validators.required]), scheme_code: c(value['scheme_code']),
      tax_basis_type: c(value['tax_basis_type'] ?? metadata['tax_basis_type']),
      base_quantity: c(value['base_quantity'] ?? metadata['base_quantity'], [Validators.pattern(MONEY)]),
      base_unit_code: c(value['base_unit_code'] ?? metadata['base_unit_code'], [Validators.maxLength(30)]),
      per_unit_amount: c(value['per_unit_amount'] ?? metadata['per_unit_amount'], [Validators.pattern(MONEY)]),
      tax_name: c(value['tax_name'], [Validators.required]), rate: c(value['rate'], [Validators.pattern(RATE)]),
      base_amount: c(value['base_amount'], [Validators.pattern(MONEY)]), amount: c(value['amount'], [Validators.required, Validators.pattern(MONEY)]),
    }, { validators: (control: AbstractControl) => this.taxBasisErrors(control) }) as TaxForm;
  }
  private createItem(value: Record<string, unknown> = {}): ItemForm {
    const text = (v: unknown, required = false) => new FormControl(this.str(v), { nonNullable: true, validators: required ? [Validators.required] : [] });
    const quantity = (v: unknown, required = false) => new FormControl(this.str(v), { nonNullable: true, validators: [...(required ? [Validators.required] : []), Validators.pattern(QUANTITY)] });
    const unitPrice = (v: unknown, required = false) => new FormControl(this.str(v), { nonNullable: true, validators: [...(required ? [Validators.required] : []), Validators.pattern(UNIT_PRICE)] });
    const money = (v: unknown, required = false) => new FormControl(this.str(v), { nonNullable: true, validators: [...(required ? [Validators.required] : []), Validators.pattern(MONEY)] });
    const taxes = this.fb.array<TaxForm>([]);
    const nested = Array.isArray(value['taxes']) ? value['taxes'] : [];
    for (const tax of nested.slice(0, 20)) taxes.push(this.createTax(tax as Record<string, unknown>));
    return this.fb.group({ external_code: text(value['external_code']), description: text(value['description'], true), quantity: quantity(value['quantity'], true), unit_code: text(value['unit_code']), unit_price: unitPrice(value['unit_price'], true), discount_amount: money(value['discount_amount'], true), net_amount: money(value['net_amount'], true), total_amount: money(value['total_amount'], true), taxes }) as ItemForm;
  }
  private toPayload(): ManualReceivedDocumentInput {
    const raw = this.form.getRawValue();
    const taxes = (rows: typeof raw.taxes): ManualReceivedDocumentTaxInput[] => rows.map((tax) => ({ tax_type: tax.tax_type, scheme_code: this.optional(tax.scheme_code), tax_basis_type: tax.tax_basis_type === 'unit' || tax.tax_basis_type === 'monetary' ? tax.tax_basis_type : undefined, base_quantity: this.optional(tax.base_quantity), base_unit_code: this.optional(tax.base_unit_code), per_unit_amount: this.optional(tax.per_unit_amount), tax_name: tax.tax_name, rate: this.optional(tax.rate), base_amount: this.optional(tax.base_amount), amount: tax.amount }));
    const items: ManualReceivedDocumentItemInput[] = raw.items.map((item) => ({ external_code: this.optional(item.external_code), description: item.description, quantity: item.quantity, unit_code: this.optional(item.unit_code), unit_price: item.unit_price, discount_amount: item.discount_amount, net_amount: item.net_amount, total_amount: item.total_amount, taxes: taxes(item.taxes) }));
    return { document_type: raw.document_type as ManualReceivedDocumentInput['document_type'], invoice_number: raw.invoice_number, document_key: this.optional(raw.document_key), reference_key: this.optional(raw.reference_key), reference_number: this.optional(raw.reference_number), issuer_tax_id: raw.issuer_tax_id, issuer_name: raw.issuer_name, receiver_tax_id: raw.receiver_tax_id, receiver_name: raw.receiver_name, issue_date: raw.issue_date, due_date: this.optional(raw.due_date), currency: raw.currency, subtotal_amount: raw.subtotal_amount, discount_amount: raw.discount_amount, charge_amount: this.optional(raw.charge_amount), tax_exclusive_amount: this.optional(raw.tax_exclusive_amount), tax_inclusive_amount: this.optional(raw.tax_inclusive_amount), tax_amount: raw.tax_amount, total_amount: raw.total_amount, prepaid_amount: this.optional(raw.prepaid_amount), payable_rounding_amount: this.optional(raw.payable_rounding_amount), withholding_amount: this.optional(raw.withholding_amount), reviewer_note: this.optional(raw.reviewer_note), items, taxes: taxes(raw.taxes) };
  }
  private reviewPayload(doc: ReceivedDocument, facts: ManualReceivedDocumentInput): ReceivedDocumentReviewInput {
    return { expected_version: doc.version, reviewer_note: facts.reviewer_note, ...(this.canEditFacts(doc) ? { facts } : {}) };
  }
  private canEditFacts(doc: ReceivedDocument | null): boolean {
    if (!doc) return true;
    const meta = this.metadata(doc.metadata); const raw = this.metadata(doc.raw_payload);
    const source = meta['source_format'] ?? raw['source_format'];
    const extraction = this.metadata(meta['extraction_snapshot']);
    const fileEditable = source === 'pending_file' && doc.processing_status === 'ready' && !!Object.keys(extraction).length;
    const terminal = ['recognized', 'accepted', 'posted'].includes(doc.fiscal_status) || ['recognized', 'accepted', 'posted'].includes(doc.posting_status) || !!doc.accepted_at;
    return !terminal && (source === 'manual_entry' || fileEditable);
  }
  private snapshotFacts(doc: ReceivedDocument): Record<string, unknown> {
    const meta = this.metadata(doc.metadata); const raw = this.metadata(doc.raw_payload);
    const normalized = this.metadata(raw['normalized']);
    const reviewed = this.metadata(meta['reviewed_snapshot']); const extraction = this.metadata(meta['extraction_snapshot']);
    return Object.keys(reviewed).length ? reviewed : Object.keys(extraction).length ? extraction : Object.keys(normalized).length ? normalized : {};
  }
  private disableFacts(): void { for (const [key, control] of Object.entries(this.form.controls)) if (key !== 'reviewer_note') control.disable({ emitEvent: false }); }
  private taxBasisErrors(control: AbstractControl): ValidationErrors | null {
    const value = control.getRawValue() as Record<string, unknown>;
    const basis = value['tax_basis_type'];
    if (basis !== 'unit' && !String(value['base_amount'] ?? '').trim()) return { taxBaseRequired: true };
    if (basis === 'unit' && (!String(value['base_quantity'] ?? '').trim() || !String(value['base_unit_code'] ?? '').trim() || !String(value['per_unit_amount'] ?? '').trim())) return { nominalTaxBasisRequired: true };
    return null;
  }
  private str(v: unknown): string { return v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''; }
  private optional(v: string): string | undefined { return v.trim() === '' ? undefined : v; }
  private dateInput(v: unknown): string { const s = this.str(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; }
  private metadata(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
}
