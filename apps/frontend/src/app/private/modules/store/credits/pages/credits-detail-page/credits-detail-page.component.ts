import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  ToastService,
  ModalComponent,
  CardComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { CreditsApiService } from '../../services/credits.service';
import { PaymentMethodsService } from '../../../settings/payments/services/payment-methods.service';
import { Credit, CreditInstallment } from '../../interfaces/credit.interface';

@Component({
  selector: 'app-credits-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    FormsModule,
    ModalComponent,
    CurrencyPipe,
    CardComponent,
  ],
  templateUrl: './credits-detail-page.component.html',
  styleUrls: ['./credits-detail-page.component.scss'],
})
export class CreditsDetailPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private credits_service = inject(CreditsApiService);
  private toast = inject(ToastService);
  private payment_methods_service = inject(PaymentMethodsService);

  credit = signal<Credit | null>(null);
  loading = signal(true);

  // Payment modal
  showPaymentModal = signal(false);
  selectedInstallment = signal<CreditInstallment | null>(null);
  paymentAmount = 0;
  paymentMethodId: number | null = null;
  paymentReference = '';
  paymentNotes = '';
  isProcessingPayment = signal(false);
  paymentMethods = signal<any[]>([]);

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.loadCredit(id);

    this.payment_methods_service
      .getStorePaymentMethods({ is_active: true } as any)
      .subscribe({
        next: (response: any) => {
          const methods = response.data || response;
          this.paymentMethods.set(Array.isArray(methods) ? methods : []);
        },
      });
  }

  loadCredit(id: number) {
    this.loading.set(true);
    this.credits_service.getById(id).subscribe({
      next: (response) => {
        this.credit.set(response.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  openPaymentModal(installment: CreditInstallment): void {
    this.selectedInstallment.set(installment);
    this.paymentAmount = Number(installment.remaining_balance);
    this.paymentMethodId = null;
    this.paymentReference = '';
    this.paymentNotes = '';
    this.showPaymentModal.set(true);
  }

  closePaymentModal(): void {
    this.showPaymentModal.set(false);
    this.selectedInstallment.set(null);
  }

  submitPayment(): void {
    const installment = this.selectedInstallment();
    const credit = this.credit();
    if (!installment || !credit) return;

    this.isProcessingPayment.set(true);

    this.credits_service
      .registerPayment(credit.id, {
        installment_id: installment.id,
        amount: this.paymentAmount,
        store_payment_method_id: this.paymentMethodId || undefined,
        payment_reference: this.paymentReference || undefined,
        notes: this.paymentNotes || undefined,
      })
      .subscribe({
        next: () => {
          this.isProcessingPayment.set(false);
          this.closePaymentModal();
          this.loadCredit(credit.id);
          this.toast.success('Pago registrado correctamente');
        },
        error: (err: any) => {
          this.isProcessingPayment.set(false);
          this.toast.error(err.error?.message || 'Error al registrar el pago');
        },
      });
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      active: 'Activo',
      paid: 'Pagado',
      overdue: 'Vencido',
      cancelled: 'Cancelado',
      defaulted: 'Incobrable',
    };
    return labels[state] || state;
  }

  getStateBadgeClasses(state: string): Record<string, boolean> {
    const map: Record<string, Record<string, boolean>> = {
      pending: { 'bg-gray-100': true, 'text-gray-700': true },
      active: { 'bg-blue-100': true, 'text-blue-700': true },
      paid: { 'bg-emerald-100': true, 'text-emerald-700': true },
      overdue: { 'bg-red-100': true, 'text-red-700': true },
      cancelled: { 'bg-gray-100': true, 'text-gray-700': true },
      defaulted: { 'bg-red-100': true, 'text-red-700': true },
    };
    return map[state] || { 'bg-gray-100': true, 'text-gray-700': true };
  }

  getInstallmentStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      paid: 'Pagada',
      overdue: 'Vencida',
      partial: 'Parcial',
      forgiven: 'Condonada',
    };
    return labels[state] || state;
  }

  getInstallmentBadgeClasses(state: string): Record<string, boolean> {
    const map: Record<string, Record<string, boolean>> = {
      pending: { 'bg-blue-100': true, 'text-blue-700': true },
      paid: { 'bg-emerald-100': true, 'text-emerald-700': true },
      overdue: { 'bg-red-100': true, 'text-red-700': true },
      partial: { 'bg-amber-100': true, 'text-amber-700': true },
      forgiven: { 'bg-purple-100': true, 'text-purple-700': true },
    };
    return map[state] || { 'bg-gray-100': true, 'text-gray-700': true };
  }

  getFrequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      weekly: 'Semanal',
      biweekly: 'Quincenal',
      monthly: 'Mensual',
    };
    return labels[frequency] || frequency;
  }

  getProgressPercentage(): number {
    const c = this.credit();
    if (!c || Number(c.total_amount) === 0) return 0;
    return Math.round((Number(c.total_paid) / Number(c.total_amount)) * 100);
  }

  getAllPayments(): any[] {
    const c = this.credit();
    if (!c?.installments) return [];
    const payments: any[] = [];
    for (const inst of c.installments) {
      if (inst.credit_installment_payments) {
        for (const p of inst.credit_installment_payments) {
          payments.push({ ...p, installment_number: inst.installment_number });
        }
      }
    }
    return payments.sort(
      (a, b) =>
        new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
    );
  }
}
