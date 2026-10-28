/**
 * Bulk e-invoicing modal. One modal, one flow:
 *
 *   previewing → ready → [credit] → running → done
 *
 * - `ready`: summary chips + per-order holder/payment table (nothing is
 *   emitted until the user confirms).
 * - `credit`: only when an included order goes to credit; one due date and
 *   payment means for the WHOLE batch.
 * - `running`: waiting view. Chunks of 5 go one after another; every order
 *   moves from pending to «Facturada» / «Falló» as its chunk returns. The modal
 *   cannot be closed while it runs (`canClose`, no close button, no Escape).
 * - `done`: final summary. Closing it emits `completed` so the page clears the
 *   selection and refreshes the list.
 *
 * Zoneless: every template-read value is a signal; form status reaches
 * computeds through `toSignal(statusChanges)`, never `form.invalid`.
 */

import {
  ChangeDetectionStrategy,
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { startWith } from 'rxjs';

import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { unpaidFinalConsumerConfirm } from '../utils/unpaid-final-consumer-confirm.util';
import { AlertBannerComponent } from '../../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { SelectorComponent } from '../../../../../shared/components/selector/selector.component';
import { CurrencyPipe } from '../../../../../shared/pipes';
import { toLocalDateString } from '../../../../../shared/utils/date.util';
import {
  CREDIT_PAYMENT_MEANS_OPTIONS,
  CREDIT_TERM_DAYS,
  localDatePlusDays,
  notBeforeToday,
} from '../components/credit-invoice-modal/credit-invoice-modal.component';
import type {
  BulkInvoiceCredit,
  BulkInvoicePreviewResult,
} from './orders-bulk-invoice.interface';
import {
  buildInvoiceQueue,
  chunkBy,
  describeResultError,
  formatHolder,
  paymentLabel,
  partialPaymentRows,
  percentDone,
  queueRequiresCredit,
  rowHolderText,
  rowKind,
  rowProblemText,
  sortPreviewRows,
  summarizeRun,
  unpaidFinalConsumerCount,
  type BulkInvoiceRunSummary,
} from './orders-bulk-invoice.util';
import { OrdersBulkService } from './orders-bulk.service';

export type OrdersBulkInvoiceStage =
  | 'previewing'
  | 'preview-failed'
  | 'ready'
  | 'credit'
  | 'running'
  | 'done';

/** One line of the waiting list. */
export interface InvoiceRunEntry {
  id: number;
  order_number: string;
  status: 'pending' | 'running' | 'ok' | 'error';
  /** «Facturada · N°» or «Falló · motivo» once settled. */
  detail: string;
}

@Component({
  selector: 'app-orders-bulk-invoice-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    CurrencyPipe,
  ],
  templateUrl: './orders-bulk-invoice-modal.component.html',
  styles: [
    `
      .run-bar {
        transition: width 400ms ease;
      }
      .run-row {
        transition:
          background-color 350ms ease,
          border-color 350ms ease;
      }
      .run-icon {
        animation: run-pop 380ms ease-out;
      }
      @keyframes run-pop {
        0% {
          transform: scale(0.4);
          opacity: 0;
        }
        70% {
          transform: scale(1.2);
          opacity: 1;
        }
        100% {
          transform: scale(1);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .run-bar,
        .run-row {
          transition: none;
        }
        .run-icon {
          animation: none;
        }
      }
    `,
  ],
})
export class OrdersBulkInvoiceModalComponent {
  private readonly bulkService = inject(OrdersBulkService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);

  readonly modalOpen = model<boolean>(false);
  /** True while the chunks are being sent. The page locks every other action on it. */
  readonly invoiceRunning = model<boolean>(false);
  readonly ids = input<number[]>([]);

  /** Emitted when the user closes the modal after a run: clear selection + refresh. */
  readonly completed = output<BulkInvoiceRunSummary>();

  readonly stage = signal<OrdersBulkInvoiceStage>('previewing');
  readonly preview = signal<BulkInvoicePreviewResult | null>(null);
  readonly failureMessage = signal<string>('');
  /** «Emitir también estas N órdenes como Consumidor final». */
  readonly allowFinalConsumer = signal<boolean>(false);
  readonly runEntries = signal<InvoiceRunEntry[]>([]);

  protected readonly termDays = CREDIT_TERM_DAYS;
  protected readonly paymentMeansOptions = CREDIT_PAYMENT_MEANS_OPTIONS;
  protected readonly today = toLocalDateString();

  readonly creditForm = this.fb.nonNullable.group({
    due_date: ['', [Validators.required, notBeforeToday]],
    payment_means_code: [''],
  });
  private readonly creditStatus = toSignal(
    this.creditForm.statusChanges.pipe(startWith(this.creditForm.status)),
    { initialValue: this.creditForm.status },
  );
  private readonly dueDateValue = toSignal(
    this.creditForm.controls.due_date.valueChanges.pipe(
      startWith(this.creditForm.controls.due_date.value),
    ),
    { initialValue: this.creditForm.controls.due_date.value },
  );

  protected readonly selectedDays = computed<number | null>(() => {
    const value = this.dueDateValue();
    return this.termDays.find((d) => localDatePlusDays(d) === value) ?? null;
  });

  protected readonly dueDateError = computed<string>(() => {
    this.creditStatus();
    const control = this.creditForm.controls.due_date;
    if (!control.touched && !control.dirty) return '';
    if (control.hasError('required')) return 'Indica la fecha de vencimiento.';
    if (control.hasError('pastDate'))
      return 'La fecha de vencimiento no puede ser anterior a hoy.';
    return '';
  });

  // ── derived state ──────────────────────────────────────────────────────────

  readonly rows = computed(() => sortPreviewRows(this.preview()?.results ?? []));
  readonly queue = computed(() =>
    buildInvoiceQueue(this.rows(), this.allowFinalConsumer()),
  );
  readonly includedCount = computed(() => this.queue().length);
  readonly needsCredit = computed(() => queueRequiresCredit(this.queue()));
  readonly cfCount = computed(() => this.preview()?.summary.cf_overridable ?? 0);
  readonly partialRows = computed(() => partialPaymentRows(this.rows()));
  readonly storeEligible = computed(() => this.preview()?.store_eligible ?? false);

  readonly canConfirm = computed(
    () =>
      this.stage() === 'ready' &&
      this.storeEligible() &&
      this.includedCount() > 0,
  );
  readonly canStartFromCredit = computed(
    () => this.stage() === 'credit' && this.creditStatus() === 'VALID',
  );

  readonly doneCount = computed(
    () =>
      this.runEntries().filter((e) => e.status === 'ok' || e.status === 'error')
        .length,
  );
  readonly runTotal = computed(() => this.runEntries().length);
  readonly runPercent = computed(() =>
    percentDone(this.doneCount(), this.runTotal()),
  );
  readonly runSummary = computed(() => {
    const entries = this.runEntries();
    const failed = entries.filter((e) => e.status === 'error').length;
    return {
      total: entries.length,
      successful: entries.filter((e) => e.status === 'ok').length,
      failed,
    };
  });

  /** `app-modal` asks this before closing: never while chunks are in flight. */
  protected readonly canCloseFn = (): boolean => !this.invoiceRunning();

  private hasRun = false;

  constructor() {
    effect(() => {
      const open = this.modalOpen();
      if (!open) {
        untracked(() => {
          if (this.hasRun) this.completed.emit(summarizeRun(this.finalResults()));
          this.reset();
        });
        return;
      }
      untracked(() => this.runPreview());
    });
  }

  // ── template helpers (pure delegations) ────────────────────────────────────

  protected readonly paymentLabel = paymentLabel;
  protected readonly formatHolder = formatHolder;
  protected readonly rowHolderText = rowHolderText;
  protected readonly rowProblemText = rowProblemText;
  protected readonly rowKind = rowKind;

  protected asNumber(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  // ── actions ────────────────────────────────────────────────────────────────

  /**
   * Opting in sends unpaid rows out cash as if paid: confirm first. «Volver»
   * leaves it off and unticks the checkbox (the signal did not change).
   */
  async onToggleFinalConsumer(
    checked: boolean,
    checkbox?: HTMLInputElement,
  ): Promise<void> {
    const unpaid = checked ? unpaidFinalConsumerCount(this.rows()) : 0;
    if (unpaid > 0) {
      const ok = await this.dialogService.confirm(unpaidFinalConsumerConfirm(unpaid), {
        size: 'md',
      });
      if (!ok) {
        if (checkbox) checkbox.checked = false;
        return;
      }
    }
    this.allowFinalConsumer.set(checked);
  }

  onRetryPreview(): void {
    this.runPreview();
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;
    if (this.needsCredit()) {
      this.stage.set('credit');
      return;
    }
    this.startRun(undefined);
  }

  onBackFromCredit(): void {
    this.stage.set('ready');
  }

  onConfirmCredit(): void {
    this.creditForm.markAllAsTouched();
    if (!this.canStartFromCredit()) return;
    const { due_date, payment_means_code } = this.creditForm.getRawValue();
    this.startRun({
      due_date,
      ...(payment_means_code ? { payment_means_code } : {}),
    });
  }

  applyTerm(days: number): void {
    this.creditForm.controls.due_date.setValue(localDatePlusDays(days));
    this.creditForm.controls.due_date.markAsDirty();
  }

  onClose(): void {
    if (this.invoiceRunning()) return;
    this.modalOpen.set(false);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private runPreview(): void {
    const ids = this.ids();
    if (ids.length === 0) return;
    this.stage.set('previewing');
    this.preview.set(null);
    this.failureMessage.set('');
    this.bulkService
      .previewInvoice(ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.preview.set(result);
          this.stage.set('ready');
        },
        error: (err: unknown) => {
          this.failureMessage.set(extractApiErrorMessage(err));
          this.stage.set('preview-failed');
        },
      });
  }

  private startRun(credit: BulkInvoiceCredit | undefined): void {
    const queue = this.queue();
    if (queue.length === 0) return;
    const chunks = chunkBy(queue);

    this.runEntries.set(
      queue.map((e, i) => ({
        id: e.row.id,
        order_number: e.row.order_number,
        status: i < chunks[0].length ? 'running' : 'pending',
        detail: '',
      })),
    );
    this.hasRun = true;
    this.invoiceRunning.set(true);
    this.stage.set('running');

    let chunkIndex = 0;
    this.bulkService
      .invoiceInChunks(
        chunks.map((c) => c.map((e) => e.item)),
        credit,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome) => {
          const byId = new Map(outcome.results.map((r) => [r.id, r]));
          const next = chunks[chunkIndex + 1]?.map((e) => e.row.id) ?? [];
          this.runEntries.update((entries) =>
            entries.map((entry) => {
              const result = byId.get(entry.id);
              if (result) {
                return result.status === 'ok'
                  ? {
                      ...entry,
                      status: 'ok' as const,
                      detail: `Facturada · ${result.invoice_number ?? 'sin número'}`,
                    }
                  : {
                      ...entry,
                      status: 'error' as const,
                      detail: `Falló · ${describeResultError(result)}`,
                    };
              }
              return next.includes(entry.id)
                ? { ...entry, status: 'running' as const }
                : entry;
            }),
          );
          chunkIndex += 1;
        },
        error: (err: unknown) => {
          // invoiceInChunks degrades failed chunks itself; this is exceptional.
          this.runEntries.update((entries) =>
            entries.map((e) =>
              e.status === 'ok' || e.status === 'error'
                ? e
                : {
                    ...e,
                    status: 'error' as const,
                    detail: `Falló · ${extractApiErrorMessage(err)}`,
                  },
            ),
          );
          this.finishRun();
        },
        complete: () => this.finishRun(),
      });
  }

  private finishRun(): void {
    this.stage.set('done');
    this.invoiceRunning.set(false);
  }

  private finalResults(): { id: number; status: 'ok' | 'error' }[] {
    return this.runEntries().map((e) => ({
      id: e.id,
      status: e.status === 'ok' ? 'ok' : 'error',
    }));
  }

  private reset(): void {
    this.hasRun = false;
    this.invoiceRunning.set(false);
    this.stage.set('previewing');
    this.preview.set(null);
    this.failureMessage.set('');
    this.allowFinalConsumer.set(false);
    this.runEntries.set([]);
    this.creditForm.reset({ due_date: '', payment_means_code: '' });
  }
}
