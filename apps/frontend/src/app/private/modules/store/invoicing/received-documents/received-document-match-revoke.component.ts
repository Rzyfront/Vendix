import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Subscription, finalize, map, startWith } from 'rxjs';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type {
  ReceivedDocument,
  ReceivedDocumentMatchAllocation,
  ReceivedDocumentsScope,
} from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

type RevokeForm = FormGroup<{ reason: FormControl<string> }>;

@Component({
  selector: 'app-received-document-match-revoke',
  standalone: true,
  imports: [ModalComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './received-document-match-revoke.component.html',
  styles: [`.field{display:flex;flex-direction:column;gap:.375rem;color:var(--color-text-primary);font-size:.875rem;font-weight:500}.field textarea{min-height:2.75rem;width:100%;border:1px solid var(--color-border);border-radius:.5rem;background:var(--color-background);padding:.5rem .75rem;color:var(--color-text-primary);font-size:.875rem;font-weight:400}.field textarea:focus{outline:2px solid var(--color-primary);outline-offset:1px}`],
})
export class ReceivedDocumentMatchRevokeComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthFacade);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly api = inject(ReceivedDocumentsService);
  private readonly currency = inject(CurrencyFormatService);

  readonly document = input.required<ReceivedDocument>();
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly storeId = input<number | null>(null);
  readonly allocation = input.required<ReceivedDocumentMatchAllocation>();
  readonly allocationsLoaded = input(false);
  readonly documentVersion = input<number | null>(null);
  readonly changed = output<void>();
  readonly reloadRequested = output<void>();

  readonly isOpen = signal(false);
  readonly confirmationOpen = signal(false);
  readonly pending = signal(false);
  readonly conflict = signal(false);
  readonly attempted = signal(false);
  readonly error = signal<string | null>(null);
  readonly form: RevokeForm = this.createForm();
  readonly formStatus = toSignal(this.form.statusChanges.pipe(startWith(this.form.status)), { initialValue: this.form.status });
  readonly formValues = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue()), startWith(this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  readonly permission = computed(() => this.auth.hasPermission(`${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:match:revoke`));
  readonly eligible = computed(() => {
    const doc = this.document();
    const terminal = ['recognized', 'accepted', 'posted'].includes(doc.fiscal_status)
      || ['recognized', 'accepted', 'posted'].includes(doc.posting_status)
      || !!doc.accepted_at;
    return doc.processing_status === 'ready' && doc.validation_status === 'valid' && !terminal;
  });
  readonly canOpen = computed(() => this.permission() && this.eligible() && this.allocationsLoaded()
    && this.documentVersion() != null && this.allocation().status === 'active');
  readonly canRevoke = computed(() => this.canOpen() && !this.pending() && !this.conflict()
    && this.formStatus() === 'VALID' && this.formValues().reason.trim().length >= 10);
  readonly canClose = (): boolean => !this.pending();
  readonly target = computed(() => {
    const item = this.allocation();
    if (item.purchase_order_item_id != null) {
      return `orden de compra #${item.purchase_order_id ?? '—'}, línea #${item.purchase_order_item_id}`;
    }
    if (item.expense_item_id != null) return `gasto #${item.expense_id ?? '—'}, línea #${item.expense_item_id}`;
    return `gasto #${item.expense_id ?? '—'}`;
  });

  private request?: Subscription;
  private contextKey = '';

  constructor() {
    effect(() => {
      const key = `${this.scope()}:${this.storeId() ?? ''}:${this.document().id}:${this.document().version}:${this.allocation().id}:${this.documentVersion() ?? ''}`;
      if (key === this.contextKey) return;
      this.contextKey = key;
      untracked(() => this.reset());
    });
    this.destroyRef.onDestroy(() => {
      this.request?.unsubscribe();
      this.request = undefined;
    });
  }

  open(): void {
    if (!this.canOpen()) return;
    this.resetForm();
    this.isOpen.set(true);
  }

  prepareConfirmation(): void {
    this.attempted.set(true);
    this.form.markAllAsTouched();
    if (this.canRevoke()) this.confirmationOpen.set(true);
  }

  confirmRevoke(): void {
    if (!this.canRevoke()) return;
    const version = this.documentVersion();
    if (version == null) return;
    const payload = { expected_version: version, reason: this.formValues().reason.trim() };
    this.pending.set(true);
    this.error.set(null);
    this.request = this.api.revokeMatch(this.scope(), this.document().id, this.allocation().id, payload, this.storeId() ?? undefined)
      .pipe(finalize(() => this.pending.set(false)))
      .subscribe({
        next: (response) => {
          if (!response?.success || !response.data?.allocation || response.data.allocation.status !== 'revoked') {
            this.error.set('El servidor no confirmó la revocación. Recarga el historial antes de volver a intentar.');
            this.confirmationOpen.set(false);
            return;
          }
          this.confirmationOpen.set(false);
          this.isOpen.set(false);
          this.changed.emit();
        },
        error: (failure: unknown) => {
          const status = typeof failure === 'object' && failure !== null && 'status' in failure ? Number((failure as { status?: unknown }).status) : 0;
          this.confirmationOpen.set(false);
          if (status === 409) {
            this.conflict.set(true);
            this.error.set('La versión del documento o la asignación cambió. Recarga el detalle antes de volver a intentarlo.');
            return;
          }
          this.error.set(describeApiFailure(failure).message || 'No se pudo revocar la asignación.');
        },
      });
  }

  reloadAfterConflict(): void {
    this.request?.unsubscribe();
    this.isOpen.set(false);
    this.confirmationOpen.set(false);
    this.reloadRequested.emit();
  }

  onClosed(): void { this.reset(); }

  formValue(): string { return this.formValues().reason; }

  money(value: string, currency: string): string {
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return `${value} · moneda no identificada`;
    const configured = this.currency.currentCurrency();
    return configured?.code.toUpperCase() === code ? this.currency.format(value, 2) : `${value} ${code}`;
  }

  dateTimeLabel(value: string | null | undefined): string {
    if (!value) return 'Fecha no disponible';
    const timezone = this.storeSettings.timezone() || 'America/Bogota';
    return formatStoreDateTime(value, timezone, { dateStyle: 'short', timeStyle: 'short' }) || 'Fecha no disponible';
  }

  receiptStateLabel(state: string | null | undefined): string {
    if (state === 'received') return 'Mercancía recibida';
    if (state === 'receipt_pending') return 'Recepción registrada, cantidad pendiente';
    if (state === 'receipt_not_linked') return 'Sin recepción física vinculada';
    return 'Estado de recepción no disponible';
  }

  private createForm(): RevokeForm {
    return this.fb.nonNullable.group({
      reason: ['', [Validators.required, (control: AbstractControl) => this.validateReason(control)]],
    }) as RevokeForm;
  }

  private validateReason(control: AbstractControl): ValidationErrors | null {
    const value = typeof control.value === 'string' ? control.value : '';
    const trimmed = value.trim();
    if (/[\x00-\x1f\x7f]/.test(value)) return { controlCharacters: true };
    if (trimmed.length < 10 || trimmed.length > 500) return { reasonLength: true };
    return null;
  }

  private resetForm(): void {
    this.form.reset({ reason: '' });
    this.error.set(null);
    this.conflict.set(false);
    this.attempted.set(false);
    this.confirmationOpen.set(false);
  }

  private reset(): void {
    this.request?.unsubscribe();
    this.request = undefined;
    this.pending.set(false);
    this.isOpen.set(false);
    this.confirmationOpen.set(false);
    this.resetForm();
  }
}
