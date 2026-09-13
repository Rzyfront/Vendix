import {Component, input, output, inject, effect, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';

import { CarteraService } from '../../services/cartera.service';
import {
  AccountReceivable,
  ArPayment,
  PaymentAgreement,
  AgreementInstallment,
} from '../../interfaces/cartera.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'vendix-receivable-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './receivable-detail-modal.component.html',
})
export class ReceivableDetailModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly receivable = input<AccountReceivable | null>(null);
  readonly paymentRequested = output<AccountReceivable>();
  readonly writeOffRequested = output<AccountReceivable>();

  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);

  detail = signal<AccountReceivable | null>(null);
  is_loading = signal(false);

  /**
   * Plan de pagos agregado: total de cuotas, cuántas pagadas/parciales/pendientes,
   * fecha del último pago registrado y fecha de la próxima cuota pendiente.
   *
   * Solo devuelve datos si la cuenta cargó `payment_agreements.agreement_installments`
   * (devuelto por `GET /store/accounting/customer-receivables/:id`).
   */
  readonly installmentSummary = computed(() => {
    const d = this.detail();
    const agreementInsts: AgreementInstallment[] = (d?.payment_agreements ?? [])
      .flatMap((pa) => pa.agreement_installments ?? [])
      .filter((i): i is AgreementInstallment => !!i);

    const orderInsts: AgreementInstallment[] = (
      ((d as any)?.order_installments as any[]) ?? []
    ).map((oi: any) => ({
      id: oi.id,
      payment_agreement_id: 0,
      installment_number: oi.installment_number,
      due_date: oi.due_date,
      amount: Number(oi.amount),
      paid_amount: Number(oi.amount_paid || 0),
      state: oi.state,
      paid_at: oi.paid_at,
      created_at: oi.created_at,
    }));

    const all: AgreementInstallment[] =
      agreementInsts.length > 0 ? agreementInsts : orderInsts;

    if (all.length === 0) {
      return null;
    }

    const paid: AgreementInstallment[] = all.filter(
      (i) => i.state === 'paid',
    );
    let lastPaid: AgreementInstallment | null = null;
    if (paid.length > 0) {
      lastPaid = paid[0];
      for (const current of paid) {
        const latestDate = lastPaid.paid_at ?? lastPaid.due_date;
        const currentDate = current.paid_at ?? current.due_date;
        if (new Date(currentDate).getTime() > new Date(latestDate).getTime()) {
          lastPaid = current;
        }
      }
    }

    // Próxima cuota pendiente: orden cronológico por `due_date` ascendente.
    // Prioriza la cuota vencida más antigua sobre la siguiente del plan
    // contractual — más útil para gestión de cobro.
    const upcoming: AgreementInstallment[] = all
      .filter((i) => i.state !== 'paid')
      .sort(
        (a, b) =>
          new Date(a.due_date).getTime() - new Date(b.due_date).getTime(),
      );
    const nextDue: AgreementInstallment | null = upcoming[0]
      ? upcoming[0]
      : null;

    const pendingCount = all.filter((i) => i.state === 'pending').length;
    const partialCount = all.filter((i) => i.state === 'partial').length;
    const paidAmount = paid.reduce(
      (acc, i) => acc + (Number(i.paid_amount) || 0),
      0,
    );
    const totalAmount = all.reduce(
      (acc, i) => acc + (Number(i.amount) || 0),
      0,
    );

    return {
      total: all.length,
      paidCount: paid.length,
      pendingCount,
      partialCount,
      paidAmount,
      totalAmount,
      lastPaid,
      nextDue,
    };
  });

  constructor() {
    effect(() => {
      if (this.isOpen() && this.receivable()) {
        this.loadDetail();
      }
      if (this.isOpen() === false) {
        this.detail.set(null);
      }
    });
  }

  private async loadDetail(): Promise<void> {
    const rec = this.receivable();
    if (!rec) return;
    this.is_loading.set(true);
    try {
      const response = await firstValueFrom(this.carteraService.getReceivable(rec.id));
      this.detail.set(response.data);
      this.is_loading.set(false);
    } catch {
      this.detail.set(rec);
      this.is_loading.set(false);
    }
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      open: 'Abierta',
      partial: 'Parcial',
      overdue: 'Vencida',
      paid: 'Pagada',
      written_off: 'Castigada',
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      open: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      partial: 'bg-warning-light text-warning',
      overdue: 'bg-error-light text-error',
      paid: 'bg-success-light text-success',
      written_off: 'bg-[var(--color-surface-secondary)] text-text-secondary',
    };
    return classes[status] || 'bg-[var(--color-surface-secondary)] text-text-secondary';
  }

  getPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia',
      check: 'Cheque',
    };
    return labels[method] || method;
  }

  getInstallmentStatusLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      partial: 'Parcial',
      paid: 'Pagada',
    };
    return labels[state] || state;
  }

  getInstallmentStatusClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-[var(--color-surface-secondary)] text-text-secondary',
      partial: 'bg-warning-light text-warning',
      paid: 'bg-success-light text-success',
    };
    return classes[state] || 'bg-[var(--color-surface-secondary)] text-text-secondary';
  }
}
