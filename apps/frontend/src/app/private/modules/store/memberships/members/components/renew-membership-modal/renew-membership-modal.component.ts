import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  PaymentModalComponent,
  ToastService,
  type PaymentSubmit,
} from '../../../../../../../shared/components/index';

import { GymMembership, RenewMembershipDto } from '../../interfaces';
import { MembershipsService } from '../../services';

/**
 * Generic membership renew/charge modal (Membership Suite).
 *
 * Thin wrapper around the shared `app-payment-modal` (charge-consolidation
 * Phase 4). The shared collector owns the payment-method grid, the optional
 * amount override and the live "Cobrar {total}" submit button; this wrapper
 * only supplies the suggested renewal amount (the plan price), maps the emitted
 * normalized {@link PaymentSubmit} to `RenewMembershipDto` and calls the SAME
 * backend endpoint as before (`MembershipsService.renew` →
 * `POST /store/memberships/:id/renew`).
 *
 * The real outcome is surfaced as a faithful toast: success, pending payment,
 * or error. Zoneless + signals only. Emits `renewed` with the refreshed
 * membership so the parent updates its view. The public contract
 * (open / membership / renewed) is intentionally unchanged.
 */
@Component({
  selector: 'app-membership-renew-modal',
  standalone: true,
  imports: [PaymentModalComponent],
  template: `
    <app-payment-modal
      [(open)]="open"
      title="Renovar membresía"
      [subtitle]="modalSubtitle()"
      size="md"
      context="membership"
      [amount]="planPrice()"
      [isProcessing]="isSubmitting()"
      (submit)="onCollectorSubmit($event)"
    />
  `,
})
export class RenewMembershipModalComponent {
  private readonly membershipsService = inject(MembershipsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model<boolean>(false);
  readonly membership = input<GymMembership | null>(null);
  readonly renewed = output<GymMembership>();

  readonly isSubmitting = signal(false);

  /** Plan base price coerced to a number (Decimal → string) as the suggested charge. */
  readonly planPrice = computed(
    () => Number(this.membership()?.plan?.price ?? 0) || 0,
  );

  /** Keep the plan name visible now that the standalone summary card is gone. */
  readonly modalSubtitle = computed(() => {
    const name = this.membership()?.plan?.name;
    return name
      ? `${name} · Cobra el plan y extiende un período de vigencia.`
      : 'Cobra el plan y extiende un período de vigencia.';
  });

  /**
   * Map the collector's normalized `PaymentSubmit` to the membership renew DTO
   * and call the unchanged backend endpoint.
   *
   *   RenewMembershipDto = {
   *     store_payment_method_id: submit.storePaymentMethodId,
   *     amount: submit.amount,
   *   }
   */
  onCollectorSubmit(submit: PaymentSubmit): void {
    const membership = this.membership();
    if (!membership) return;

    // The membership context always charges against a real store payment method
    // (loaded from the catalog); a null id would mean a manual method, which
    // this context never enables. Guard defensively.
    if (submit.storePaymentMethodId == null) {
      this.toastService.warning('Selecciona un método de pago');
      return;
    }

    const dto: RenewMembershipDto = {
      store_payment_method_id: submit.storePaymentMethodId,
      amount: submit.amount,
    };

    this.isSubmitting.set(true);
    this.membershipsService
      .renew(membership.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isSubmitting.set(false);
          if (result.renewed) {
            this.toastService.success(
              'Membresía renovada y cobrada correctamente',
            );
          } else {
            this.toastService.info(
              'Cobro iniciado; la membresía se activará al confirmarse el pago',
            );
          }
          this.open.set(false);
          if (result.membership) this.renewed.emit(result.membership);
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al renovar la membresía',
          );
        },
      });
  }
}
