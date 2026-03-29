import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { LayawayApiService } from '../../services/layaway.service';
import { LayawayPlan, LayawayInstallment } from '../../interfaces/layaway.interface';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { BadgeComponent, BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { PaymentMethodsService } from '../../../settings/payments/services/payment-methods.service';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { TableColumn, TableComponent } from '../../../../../../shared/components/table/table.component';

@Component({
  selector: 'app-layaway-detail-page',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, FormsModule, ModalComponent, StatsComponent, StickyHeaderComponent, CardComponent, BadgeComponent, CurrencyPipe, TableComponent],
  templateUrl: './layaway-detail-page.component.html',
  styleUrls: ['./layaway-detail-page.component.scss'],
})
export class LayawayDetailPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private layaway_service = inject(LayawayApiService);
  private toast = inject(ToastService);
  private payment_methods_service = inject(PaymentMethodsService);
  private currencyFormat = inject(CurrencyFormatService);

  plan = signal<LayawayPlan | null>(null);
  loading = signal(true);

  // Products table columns
  productColumns: TableColumn[] = [
    { key: 'product_name', label: 'Producto', align: 'left' },
    { key: 'sku', label: 'SKU', align: 'left', width: '80px', defaultValue: '—' },
    { key: 'quantity', label: 'Cant.', align: 'center', width: '60px' },
    { key: 'unit_price', label: 'Precio', align: 'right', width: '120px', transform: (v: number) => this.currencyFormat.format(v) },
    { key: 'subtotal', label: 'Subtotal', align: 'right', width: '120px', transform: (v: number) => this.currencyFormat.format(v) },
  ];

  // Header
  headerSubtitle = computed(() => {
    const p = this.plan();
    if (!p) return '';
    const customer = p.customer ? `${p.customer.first_name} ${p.customer.last_name}` : '';
    return customer ? `Cliente: ${customer}` : '';
  });

  // Payment modal
  showPaymentModal = signal(false);
  selectedInstallment = signal<LayawayInstallment | null>(null);
  paymentAmount = 0;
  paymentMethodId: number | null = null;
  paymentReference = '';
  paymentNotes = '';
  isProcessingPayment = signal(false);
  paymentMethods = signal<any[]>([]);

  // Cancel modal
  showCancelModal = signal(false);
  cancelReason = '';
  isProcessingCancel = signal(false);

  // Complete confirmation
  isProcessingComplete = signal(false);
  showCompleteModal = signal(false);

  // Modify installments modal
  showModifyModal = signal(false);
  modifiedInstallments: { amount: number; due_date: string }[] = [];
  isProcessingModify = signal(false);

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.loadPlan(id);
    this.payment_methods_service.getStorePaymentMethods({ is_active: true } as any).subscribe({
      next: (response: any) => {
        const methods = response.data || response;
        this.paymentMethods.set(Array.isArray(methods) ? methods : []);
      },
    });
  }

  loadPlan(id: number) {
    this.loading.set(true);
    this.layaway_service.getById(id).subscribe({
      next: (response) => {
        this.plan.set(response.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      completed: 'Completado',
      cancelled: 'Cancelado',
      overdue: 'Vencido',
      defaulted: 'Incumplido',
    };
    return labels[state] || state;
  }

  getStateColor(state: string): string {
    const colors: Record<string, string> = {
      active: 'blue',
      completed: 'green',
      cancelled: 'gray',
      overdue: 'red',
      defaulted: 'red',
    };
    return colors[state] || 'gray';
  }

  headerBadgeColor(): 'green' | 'blue' | 'yellow' | 'gray' | 'red' {
    const state = this.plan()?.state;
    const map: Record<string, 'green' | 'blue' | 'yellow' | 'gray' | 'red'> = {
      active: 'blue',
      completed: 'green',
      cancelled: 'gray',
      overdue: 'red',
      defaulted: 'red',
    };
    return map[state || ''] || 'gray';
  }

  getInstallmentStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      paid: 'Pagada',
      overdue: 'Vencida',
      cancelled: 'Cancelada',
    };
    return labels[state] || state;
  }

  getInstallmentBadgeVariant(state: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      pending: 'warning',
      paid: 'success',
      overdue: 'error',
      cancelled: 'neutral',
    };
    return variants[state] || 'neutral';
  }

  getStateBadgeVariant(state: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      active: 'primary',
      completed: 'success',
      cancelled: 'neutral',
      overdue: 'error',
      defaulted: 'error',
    };
    return variants[state] || 'neutral';
  }

  getProgressPercentage(): number {
    const p = this.plan();
    if (!p || Number(p.total_amount) === 0) return 0;
    return Math.round((Number(p.paid_amount) / Number(p.total_amount)) * 100);
  }

  formatCurrency(value: number | string): string {
    return '$' + Number(value).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  getPaidInstallmentsText(): string {
    const plan = this.plan();
    if (!plan?.layaway_installments) return '';
    const paid = plan.layaway_installments.filter(i => i.state === 'paid').length;
    return `${paid} de ${plan.num_installments} pagadas`;
  }

  canPerformActions(): boolean {
    const state = this.plan()?.state;
    return state === 'active' || state === 'overdue';
  }

  // Payment modal methods
  openPaymentModal(installment: LayawayInstallment): void {
    this.selectedInstallment.set(installment);
    this.paymentAmount = Number(installment.amount);
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
    const plan = this.plan();
    if (!installment || !plan) return;

    this.isProcessingPayment.set(true);
    this.layaway_service.makePayment(plan.id, {
      installment_id: installment.id,
      amount: this.paymentAmount,
      store_payment_method_id: this.paymentMethodId || undefined,
      transaction_id: this.paymentReference || undefined,
      notes: this.paymentNotes || undefined,
    }).subscribe({
      next: () => {
        this.isProcessingPayment.set(false);
        this.closePaymentModal();
        this.loadPlan(plan.id);
        this.toast.success('Pago registrado correctamente');
      },
      error: (err: any) => {
        this.isProcessingPayment.set(false);
        this.toast.error(err.error?.message || 'Error al registrar el pago');
      },
    });
  }

  // Cancel modal methods
  openCancelModal(): void {
    this.cancelReason = '';
    this.showCancelModal.set(true);
  }

  closeCancelModal(): void {
    this.showCancelModal.set(false);
  }

  submitCancel(): void {
    const plan = this.plan();
    if (!plan || !this.cancelReason.trim()) return;

    this.isProcessingCancel.set(true);
    this.layaway_service.cancel(plan.id, { cancellation_reason: this.cancelReason }).subscribe({
      next: () => {
        this.isProcessingCancel.set(false);
        this.closeCancelModal();
        this.loadPlan(plan.id);
        this.toast.success('Plan cancelado');
      },
      error: (err: any) => {
        this.isProcessingCancel.set(false);
        this.toast.error(err.error?.message || 'Error al cancelar el plan');
      },
    });
  }

  // Complete modal methods
  openCompleteModal(): void {
    this.showCompleteModal.set(true);
  }

  closeCompleteModal(): void {
    this.showCompleteModal.set(false);
  }

  submitComplete(): void {
    const plan = this.plan();
    if (!plan) return;

    this.isProcessingComplete.set(true);
    this.layaway_service.complete(plan.id).subscribe({
      next: () => {
        this.isProcessingComplete.set(false);
        this.closeCompleteModal();
        this.loadPlan(plan.id);
        this.toast.success('Plan completado exitosamente');
      },
      error: (err: any) => {
        this.isProcessingComplete.set(false);
        this.toast.error(err.error?.message || 'Error al completar el plan');
      },
    });
  }

  // Modify installments modal methods
  openModifyModal(): void {
    const plan = this.plan();
    if (!plan) return;
    this.modifiedInstallments = (plan.layaway_installments || [])
      .filter(i => i.state === 'pending' || i.state === 'overdue')
      .map(i => ({ amount: Number(i.amount), due_date: i.due_date.split('T')[0] }));
    this.showModifyModal.set(true);
  }

  closeModifyModal(): void {
    this.showModifyModal.set(false);
  }

  addInstallment(): void {
    const last = this.modifiedInstallments[this.modifiedInstallments.length - 1];
    const next_date = last ? new Date(last.due_date) : new Date();
    next_date.setMonth(next_date.getMonth() + 1);
    this.modifiedInstallments.push({
      amount: 0,
      due_date: next_date.toISOString().split('T')[0],
    });
  }

  removeInstallment(index: number): void {
    this.modifiedInstallments.splice(index, 1);
  }

  getModifyTotal(): number {
    return this.modifiedInstallments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  }

  isModifyTotalValid(): boolean {
    const plan = this.plan();
    if (!plan) return false;
    return this.getModifyTotal().toFixed(2) === Number(plan.remaining_amount).toFixed(2);
  }

  submitModify(): void {
    const plan = this.plan();
    if (!plan) return;

    this.isProcessingModify.set(true);
    this.layaway_service.modifyInstallments(plan.id, {
      installments: this.modifiedInstallments,
    }).subscribe({
      next: () => {
        this.isProcessingModify.set(false);
        this.closeModifyModal();
        this.loadPlan(plan.id);
        this.toast.success('Cuotas modificadas correctamente');
      },
      error: (err: any) => {
        this.isProcessingModify.set(false);
        this.toast.error(err.error?.message || 'Error al modificar cuotas');
      },
    });
  }
}
