import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pos-payment-interface',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      *ngIf="isOpen"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
        <h2 class="text-lg font-semibold mb-4">Procesar Pago</h2>
        <p class="mb-4">Monto: {{ cartState?.summary?.total || 0 }}</p>
        <div class="flex gap-2">
          <button
            (click)="closed.emit()"
            class="flex-1 px-4 py-2 border rounded"
          >
            Cancelar
          </button>
          <button
            (click)="confirmPayment()"
            class="flex-1 px-4 py-2 bg-blue-600 text-white rounded"
          >
            Pagar
          </button>
        </div>
      </div>
    </div>
  `,
})
export class PosPaymentInterfaceComponent {
  @Input() isOpen = false;
  @Input() cartState: any = null;
  @Output() closed = new EventEmitter<void>();
  @Output() paymentCompleted = new EventEmitter<any>();

  confirmPayment() {
    this.paymentCompleted.emit({
      paymentMethodId: 'cash',
      amountReceived: this.cartState?.summary?.total || 0,
      paymentReference: '',
      requires_payment: true,
    });
  }
}
