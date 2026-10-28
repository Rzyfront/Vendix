/**
 * Non-blocking warning of the POS when the selected customer cannot be the
 * holder of an electronic invoice (S7c). Never silent, never a gate:
 *
 *  - only checks when the store's e-invoicing is live (`is_live` of
 *    `dian-config/emission-status`, read once per mount; fail-closed),
 *  - calls `GET store/invoicing/holder-check` each time the customer changes,
 *  - shows the missing fields with two actions: «Completar datos» (the shared
 *    completion modal, saves to the customer and re-checks) and «Seguir como
 *    Consumidor final» (dismisses the warning for this sale).
 *
 * It does not touch the cart, the charge or the payment logic.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { DianConfigApiService } from '../../../../../shared/services/dian';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CustomerHolderCompletionModalComponent } from '../../customers/components/customer-holder-completion-modal/customer-holder-completion-modal.component';
import {
  missingFieldLabels,
  type HolderIssue,
} from '../../customers/components/customer-holder-completion-modal/holder-issue.model';
import { InvoicingService } from '../../invoicing/services/invoicing.service';

@Component({
  selector: 'app-pos-holder-warning',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent, CustomerHolderCompletionModalComponent],
  template: `
    @if (visibleIssue(); as data) {
      <div
        class="fixed bottom-24 left-3 right-3 z-40 mx-auto max-w-md rounded-xl border border-yellow-300 bg-yellow-50 p-3 shadow-lg lg:bottom-6 lg:left-auto lg:right-[430px] lg:mx-0"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-start gap-2.5">
          <app-icon name="alert-triangle" [size]="18" class="mt-0.5 shrink-0 text-yellow-600" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-slate-900">
              Datos del cliente incompletos para facturar
            </p>
            <p class="mt-0.5 text-xs leading-snug text-slate-700">
              {{ data.message }}
            </p>
            @if (labels().length > 0) {
              <p class="mt-1 text-xs font-medium text-slate-800">
                Falta: {{ labels().join(', ') }}.
              </p>
            }
            <p class="mt-1 text-xs leading-snug text-slate-700">
              Si sigues así, la factura saldrá a Consumidor final.
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <app-button size="sm" variant="primary" (clicked)="showModal.set(true)">
                Completar datos
              </app-button>
              <app-button size="sm" variant="outline" (clicked)="dismiss()">
                Seguir como Consumidor final
              </app-button>
            </div>
          </div>
        </div>
      </div>
    }

    <app-customer-holder-completion-modal
      [(isOpen)]="showModal"
      [issue]="issue()"
      finalConsumerLabel="Seguir como Consumidor final"
      (saved)="onSaved()"
      (useFinalConsumer)="dismiss()"
    ></app-customer-holder-completion-modal>
  `,
})
export class PosHolderWarningComponent {
  private readonly invoicingService = inject(InvoicingService);
  private readonly dianConfigApi = inject(DianConfigApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Customer assigned to the sale, or null. */
  readonly customerId = input<number | null>(null);

  readonly issue = signal<HolderIssue | null>(null);
  readonly showModal = signal(false);
  private readonly live = signal(false);
  /** Customers whose warning was dismissed for the current sale. */
  private readonly dismissed = signal<ReadonlySet<number>>(new Set<number>());

  readonly visibleIssue = computed(() => {
    const issue = this.issue();
    return issue && !this.dismissed().has(issue.customer_id) ? issue : null;
  });
  readonly labels = computed(() =>
    missingFieldLabels(this.issue()?.missing_fields ?? []),
  );

  constructor() {
    // One read per mount: `is_live` only changes from the fiscal settings.
    this.dianConfigApi
      .getDianEmissionStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => this.live.set(r?.data?.is_live === true),
        error: () => this.live.set(false),
      });

    effect(() => {
      const id = this.customerId();
      const live = this.live();
      untracked(() => {
        if (id == null) {
          // Sale without customer (or a new sale): start clean.
          this.issue.set(null);
          this.dismissed.set(new Set<number>());
          return;
        }
        if (live) this.check(id);
      });
    });
  }

  dismiss(): void {
    const issue = this.issue();
    if (!issue) return;
    this.showModal.set(false);
    this.dismissed.update((prev) => new Set(prev).add(issue.customer_id));
  }

  onSaved(): void {
    const id = this.customerId();
    if (id != null) this.check(id);
  }

  private check(customerId: number): void {
    this.invoicingService
      .holderCheck(customerId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // Ignore a late answer for a customer that is no longer selected.
          if (this.customerId() !== customerId) return;
          const data = res?.data;
          if (!data?.holder_issue) {
            this.issue.set(null);
            return;
          }
          this.issue.set({
            customer_id: customerId,
            customer_name: data.holder.name ?? '',
            issue_code: data.holder_issue.code,
            missing_fields: data.holder_issue.missing_fields,
            message: data.holder_issue.message,
            cf_overridable: data.cf_overridable,
          });
        },
        // A failed check must not block or nag the cashier: the emission
        // itself still validates the holder (409) on the backend.
        error: () => this.issue.set(null),
      });
  }
}
